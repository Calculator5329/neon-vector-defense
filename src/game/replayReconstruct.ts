import { TOWER_MAP } from './towers';
import { getWave } from './waves';
import { ENEMIES } from './enemies';
import {
  decodeReplayDeathRecords,
  type PublicRunDoc,
  type RunEvent,
  type RunWaveSnapshot,
} from './runTelemetry';
import type { AbilityId, EnemyDef, TargetMode, TowerDef } from './types';

export interface ReconTower {
  uid: number;
  def: TowerDef;
  x: number;
  y: number;
  tierA: number;
  tierB: number;
  placedAtS: number;
  soldAtS?: number;
  damage: number;
  name: string;
}

export interface ReconFrame {
  idx: number;
  snap: RunWaveSnapshot;
  towers: ReconTower[];
  maxDamage: number;
  terminal: boolean;
}

export interface PathGeom { pts: { x: number; y: number }[]; cum: number[]; len: number; }

export interface Ghost {
  x: number;
  y: number;
  angle: number;
  wp: number;
  dist: number;
  uid: number;
  def: EnemyDef;
  cloaked: boolean;
  slow: number;
  resonance: number;
  burnTimer: number;
  hpPct: number;
  spawnT: number;
  endT?: number;
  endKind?: 'kill' | 'leak';
  endX?: number;
  endY?: number;
  sourceTowerUid?: number;
  reward?: number;
  boss?: boolean;
}

export interface ReplayEnemyRecord {
  uid: number;
  def: EnemyDef;
  wave: number;
  spawnT: number;
  spawnDist: number;
  cloaked: boolean;
  parentUid?: number;
  endT?: number;
  endKind?: 'kill' | 'leak';
  endDist?: number;
  endX?: number;
  endY?: number;
  sourceTowerUid?: number;
  reward?: number;
}

export interface ReplayCombatTimeline {
  enemies: ReplayEnemyRecord[];
  effects: ReplayEnemyRecord[];
  authoritativeDeaths: boolean;
}

interface ReplayWaveGroup { type: string; count: number; gap: number; delay: number; cloaked: boolean; }

export function reconstructAt(run: PublicRunDoc, t: number): ReconFrame {
  const snaps = run.snapshots.length
    ? run.snapshots
    : [synthSnapshot(run)];
  let idx = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].t <= t) idx = i;
    else break;
  }
  const snap = snaps[idx];
  const towers: ReconTower[] = [];
  let maxDamage = 1;
  for (const ts of snap.towers ?? []) {
    if (ts.placedAtS > t) continue;
    if (ts.soldAtS != null && ts.soldAtS <= t) continue;
    const def = TOWER_MAP[ts.towerId];
    if (!def) continue;
    if (ts.damage > maxDamage) maxDamage = ts.damage;
    towers.push({
      uid: ts.towerUid, def, x: ts.x, y: ts.y,
      tierA: ts.tierA, tierB: ts.tierB,
      placedAtS: ts.placedAtS, soldAtS: ts.soldAtS ?? undefined,
      damage: ts.damage, name: ts.name ?? def.name,
    });
  }
  const terminal = idx === snaps.length - 1;
  return { idx, snap, towers, maxDamage, terminal };
}

function synthSnapshot(run: PublicRunDoc): RunWaveSnapshot {
  const f = run.final;
  return {
    label: 'run_end', t: run.summary.durationS, wave: run.summary.wave,
    cash: run.summary.credits, lives: run.summary.coresLeft, kills: run.summary.kills,
    leaks: run.summary.leaks, towerCount: f.towers.length, enemyCount: 0,
    damageByTower: f.damageByTower, killsByEnemy: f.killsByEnemy, towers: f.towers,
  };
}

export function buildGeom(path: { x: number; y: number }[]): PathGeom {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  return { pts: path, cum, len: cum[cum.length - 1] || 1 };
}

export function posAtDist(geom: PathGeom, d: number): { x: number; y: number; angle: number; wp: number; dist: number } {
  const { pts, cum } = geom;
  const dist = Math.max(0, Math.min(geom.len, d));
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= dist) {
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (dist - cum[i - 1]) / seg;
      const a = pts[i - 1], b = pts[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x), wp: i, dist };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, angle: 0, wp: pts.length - 1, dist };
}

export function waveWindow(run: PublicRunDoc, t: number): { wave: number; startT: number } {
  let best: { wave: number; startT: number } | null = null;
  for (const s of run.snapshots) {
    if (s.t <= t && s.label === 'wave_start') best = { wave: s.wave, startT: s.t };
    else if (s.t > t) break;
  }
  if (best) return best;
  const f = run.snapshots[0];
  return { wave: f?.wave ?? run.summary.wave, startT: f?.t ?? 0 };
}

function eventNum(e: RunEvent, key: string, fallback = 0): number {
  const value = e[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function eventStr(e: RunEvent, key: string, fallback = ''): string {
  const value = e[key];
  return typeof value === 'string' ? value : fallback;
}

function groupsFromWaveEvent(e: RunEvent | undefined): ReplayWaveGroup[] | null {
  if (!e || !Array.isArray(e.groups)) return null;
  const groups = e.groups
    .map((raw): ReplayWaveGroup | null => {
      if (!raw || typeof raw !== 'object') return null;
      const row = raw as Record<string, unknown>;
      const type = typeof row.type === 'string' ? row.type : '';
      const count = typeof row.count === 'number' && Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0;
      const gap = typeof row.gap === 'number' && Number.isFinite(row.gap) ? Math.max(0.03, row.gap) : 0.55;
      const delay = typeof row.delay === 'number' && Number.isFinite(row.delay) ? Math.max(0, row.delay) : 0;
      return type && count > 0 ? { type, count, gap, delay, cloaked: !!row.cloaked } : null;
    })
    .filter((g): g is ReplayWaveGroup => !!g);
  return groups.length ? groups : null;
}

function fallbackGroupsForWave(wave: number): ReplayWaveGroup[] {
  try {
    return getWave(wave).map((g) => ({
      type: g.type,
      count: g.count,
      gap: g.gap,
      delay: g.delay ?? 0,
      cloaked: !!g.cloaked,
    }));
  } catch {
    return [];
  }
}

function waveStarts(run: PublicRunDoc): { wave: number; startT: number; event?: RunEvent }[] {
  const byWave = new Map<number, { wave: number; startT: number; event?: RunEvent }>();
  for (const s of run.snapshots) {
    if (s.label === 'wave_start') byWave.set(s.wave, { wave: s.wave, startT: s.t });
  }
  for (const e of run.events) {
    if (e.type !== 'wave_start') continue;
    const wave = Math.max(0, Math.floor(e.wave));
    byWave.set(wave, { wave, startT: e.t, event: e });
  }
  if (byWave.size === 0 && run.snapshots[0]) byWave.set(run.snapshots[0].wave, { wave: run.snapshots[0].wave, startT: run.snapshots[0].t });
  return [...byWave.values()].sort((a, b) => a.startT - b.startT || a.wave - b.wave);
}

function legacySpawnRecords(run: PublicRunDoc): Map<number, ReplayEnemyRecord> {
  const records = new Map<number, ReplayEnemyRecord>();
  let syntheticUid = -1;
  const hasSpawnEvents = run.events.some((e) => e.type === 'enemy_spawn');

  if (hasSpawnEvents) {
    for (const e of run.events) {
      if (e.type !== 'enemy_spawn') continue;
      const def = ENEMIES[eventStr(e, 'enemyId')];
      if (!def) continue;
      const uid = Math.floor(eventNum(e, 'enemyUid', syntheticUid--));
      records.set(uid, {
        uid,
        def,
        wave: Math.max(0, Math.floor(e.wave)),
        spawnT: e.t,
        spawnDist: Math.max(0, eventNum(e, 'dist', 0)),
        cloaked: !!e.cloaked,
        parentUid: typeof e.parentUid === 'number' ? Math.floor(e.parentUid) : undefined,
      });
    }
    return records;
  }

  for (const win of waveStarts(run)) {
    const groups = groupsFromWaveEvent(win.event) ?? fallbackGroupsForWave(win.wave);
    for (const grp of groups) {
      const def = ENEMIES[grp.type];
      if (!def) continue;
      for (let i = 0; i < grp.count; i++) {
        const uid = syntheticUid--;
        records.set(uid, {
          uid,
          def,
          wave: win.wave,
          spawnT: win.startT + grp.delay + i * grp.gap,
          spawnDist: 0,
          cloaked: grp.cloaked,
        });
      }
    }
  }
  return records;
}

function applyLeakEvents(run: PublicRunDoc, records: Map<number, ReplayEnemyRecord>, syntheticUid: { value: number }): void {
  for (const e of run.events) {
    if (e.type !== 'leak') continue;
    const def = ENEMIES[eventStr(e, 'enemyId')];
    if (!def) continue;
    const uid = typeof e.enemyUid === 'number' ? Math.floor(e.enemyUid) : syntheticUid.value--;
    const dist = Math.max(0, eventNum(e, 'dist', 0));
    const existing = records.get(uid);
    const rec = existing ?? {
      uid,
      def,
      wave: Math.max(0, Math.floor(e.wave)),
      spawnT: Math.max(0, e.t - dist / Math.max(1, def.speed)),
      spawnDist: 0,
      cloaked: false,
    };
    if (rec.endKind === 'kill') continue;
    rec.endT = e.t;
    rec.endKind = 'leak';
    rec.endDist = dist;
    rec.endX = typeof e.x === 'number' ? e.x : undefined;
    rec.endY = typeof e.y === 'number' ? e.y : undefined;
    records.set(uid, rec);
  }
}

function buildAuthoritativeTimeline(run: PublicRunDoc): ReplayCombatTimeline {
  const records = new Map<number, ReplayEnemyRecord>();
  for (const death of decodeReplayDeathRecords(run.deathRecords)) {
    const def = ENEMIES[death.enemyId];
    if (!def) continue;
    const duration = Math.max(0.05, death.deathT - death.spawnT);
    records.set(death.uid, {
      uid: death.uid,
      def,
      wave: death.wave,
      spawnT: death.spawnT,
      spawnDist: 0,
      cloaked: false,
      endT: death.deathT,
      endKind: 'kill',
      endDist: Math.max(0, def.speed * duration),
    });
  }
  applyLeakEvents(run, records, { value: -1 });
  const enemies = [...records.values()].sort((a, b) => a.spawnT - b.spawnT || a.uid - b.uid);
  const effects = enemies
    .filter((e) => e.endT != null)
    .sort((a, b) => (a.endT ?? 0) - (b.endT ?? 0) || a.uid - b.uid);
  return { enemies, effects, authoritativeDeaths: true };
}

function buildLegacyTimeline(run: PublicRunDoc): ReplayCombatTimeline {
  const records = legacySpawnRecords(run);

  const assignEnd = (kind: 'kill' | 'leak', t: number, enemyId: string, uid?: number, e?: RunEvent) => {
    const exact = uid != null ? records.get(uid) : undefined;
    const candidates = exact ? [exact] : [...records.values()]
      .filter((r) => !r.endT && r.spawnT <= t && (!enemyId || r.def.id === enemyId))
      .sort((a, b) => b.spawnT - a.spawnT || b.uid - a.uid);
    const rec = candidates[0];
    if (!rec) return;
    rec.endT = Math.max(rec.spawnT + 0.05, t);
    rec.endKind = kind;
    rec.endDist = Math.max(rec.spawnDist, eventNum(e ?? ({} as RunEvent), 'dist', rec.spawnDist + rec.def.speed * (rec.endT - rec.spawnT)));
    rec.endX = e && typeof e.x === 'number' ? e.x : undefined;
    rec.endY = e && typeof e.y === 'number' ? e.y : undefined;
    rec.sourceTowerUid = e && typeof e.towerUid === 'number' ? e.towerUid : undefined;
    rec.reward = e && typeof e.reward === 'number' ? e.reward : undefined;
  };

  let hasKillEvents = false;
  for (const e of run.events) {
    if (e.type === 'enemy_kill') {
      hasKillEvents = true;
      assignEnd('kill', e.t, eventStr(e, 'enemyId'), Math.floor(eventNum(e, 'enemyUid', NaN)), e);
    } else if (e.type === 'leak') {
      const uid = typeof e.enemyUid === 'number' ? Math.floor(e.enemyUid) : undefined;
      assignEnd('leak', e.t, eventStr(e, 'enemyId'), uid, e);
    }
  }

  if (!hasKillEvents) {
    const snaps = [...run.snapshots].sort((a, b) => a.t - b.t);
    for (let i = 1; i < snaps.length; i++) {
      const prev = snaps[i - 1];
      const snap = snaps[i];
      const dt = Math.max(0.1, snap.t - prev.t);
      const enemyIds = new Set([...Object.keys(prev.killsByEnemy ?? {}), ...Object.keys(snap.killsByEnemy ?? {})]);
      for (const enemyId of enemyIds) {
        const delta = Math.max(0, Math.round((snap.killsByEnemy?.[enemyId] ?? 0) - (prev.killsByEnemy?.[enemyId] ?? 0)));
        for (let k = 0; k < delta; k++) assignEnd('kill', prev.t + dt * ((k + 1) / (delta + 1)), enemyId);
      }
    }
  }

  const enemies = [...records.values()].sort((a, b) => a.spawnT - b.spawnT || a.uid - b.uid);
  const effects = enemies
    .filter((e) => e.endT != null)
    .sort((a, b) => (a.endT ?? 0) - (b.endT ?? 0) || a.uid - b.uid);
  return { enemies, effects, authoritativeDeaths: false };
}

export function buildReplayCombatTimeline(run: PublicRunDoc): ReplayCombatTimeline {
  if (run.deathRecords?.codec === 'd1') return buildAuthoritativeTimeline(run);
  return buildLegacyTimeline(run);
}

export function ghostFromRecord(geom: PathGeom, rec: ReplayEnemyRecord, t: number, chrono: boolean): Ghost | null {
  if (t < rec.spawnT) return null;
  if (rec.endT != null && t >= rec.endT) return null;
  const age = Math.max(0, t - rec.spawnT);
  let dist = rec.spawnDist + rec.def.speed * age * (chrono ? 0.35 : 1);
  if (rec.endT != null && rec.endDist != null) {
    const f = Math.max(0, Math.min(1, (t - rec.spawnT) / Math.max(0.05, rec.endT - rec.spawnT)));
    dist = rec.spawnDist + (rec.endDist - rec.spawnDist) * f;
  }
  if (dist >= geom.len) return null;
  const p = posAtDist(geom, dist);
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + rec.uid * 0.041);
  const endFade = rec.endT == null ? 0 : Math.max(0, Math.min(1, (rec.endT - t) / 0.8));
  const hpPct = rec.endT != null
    ? Math.max(0.08, Math.min(1, endFade))
    : rec.def.boss ? Math.max(0.18, 0.82 - Math.min(0.55, age / 60) + pulse * 0.08) : 1;
  return {
    x: p.x, y: p.y, angle: p.angle, wp: p.wp, dist: p.dist, uid: rec.uid,
    def: rec.def, cloaked: rec.cloaked,
    slow: chrono ? 0.35 : 1,
    resonance: rec.def.id === 'prism' && pulse > 0.86 ? 1 : 0,
    burnTimer: rec.def.boss && pulse > 0.9 ? 0.6 : 0,
    hpPct,
    spawnT: rec.spawnT,
    endT: rec.endT,
    endKind: rec.endKind,
    endX: rec.endX,
    endY: rec.endY,
    sourceTowerUid: rec.sourceTowerUid,
    reward: rec.reward,
    boss: !!rec.def.boss,
  };
}

export function activeReplayGhosts(geom: PathGeom, timeline: ReplayCombatTimeline, t: number, chrono: boolean, cap = 360): Ghost[] {
  const out: Ghost[] = [];
  for (const rec of timeline.enemies) {
    if (rec.spawnT > t) break;
    const gh = ghostFromRecord(geom, rec, t, chrono);
    if (!gh) continue;
    out.push(gh);
    if (out.length >= cap) break;
  }
  return out;
}

export type ReplayTargetMode = TargetMode;
export type ReplayAbilityId = AbilityId;
