import { TOWER_MAP } from './towers';
import { getWave } from './waves';
import { ENEMIES } from './enemies';
import {
  type PublicRunDoc,
  type RunEvent,
  type RunWaveSnapshot,
} from './runTelemetry';
import { ELITE_AFFIX_IDS, ELITE_AFFIX_META } from './eliteAffixes';
import type { AbilityId, EliteAffixId, EnemyDef, TargetMode, TowerDef, UmbraPhase } from './types';

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
  elite?: EliteAffixId;
  umbraPhase?: UmbraPhase;
}

export interface ReplayUmbraPhasePoint {
  t: number;
  phase: UmbraPhase;
  enemyUid?: number;
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
  elite?: EliteAffixId;
  umbraPhases?: ReplayUmbraPhasePoint[];
}

export interface ReplayCombatTimeline {
  enemies: ReplayEnemyRecord[];
  effects: ReplayEnemyRecord[];
  authoritativeDeaths: boolean;
  umbraPhases: ReplayUmbraPhasePoint[];
}

interface ReplayWaveElite { i: number; a: EliteAffixId; }
interface ReplayWaveGroup { type: string; count: number; gap: number; delay: number; cloaked: boolean; elites?: ReplayWaveElite[]; }
interface ReplayPlannedSpawn {
  type: string;
  wave: number;
  spawnT: number;
  cloaked: boolean;
  elite?: EliteAffixId;
  consumed?: boolean;
}

function replayEvents(run: PublicRunDoc): RunEvent[] {
  return Array.isArray(run.events) ? run.events : [];
}

function replaySnapshots(run: PublicRunDoc): RunWaveSnapshot[] {
  return Array.isArray(run.snapshots) ? run.snapshots : [];
}

export function reconstructAt(run: PublicRunDoc, t: number): ReconFrame {
  const sourceSnapshots = replaySnapshots(run);
  const snaps = sourceSnapshots.length
    ? sourceSnapshots
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
  const snapshots = replaySnapshots(run);
  for (const s of snapshots) {
    if (s.t <= t && s.label === 'wave_start') best = { wave: s.wave, startT: s.t };
    else if (s.t > t) break;
  }
  if (best) return best;
  const f = snapshots[0];
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

function roundReplayT(n: number): number {
  return Math.max(0, Math.round(n * 10) / 10);
}

function isEliteAffixId(value: unknown): value is EliteAffixId {
  return typeof value === 'string' && ELITE_AFFIX_IDS.includes(value as EliteAffixId);
}

export function replayUmbraPhaseFromEvent(e: RunEvent): UmbraPhase | null {
  const value = typeof e.p === 'number' ? e.p : e.phase;
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function parseEliteRows(raw: unknown, count: number): ReplayWaveElite[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const elites = raw
    .map((entry): ReplayWaveElite | null => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const i = typeof row.i === 'number' && Number.isFinite(row.i) ? Math.floor(row.i) : -1;
      const a = isEliteAffixId(row.a) ? row.a : null;
      return i >= 0 && i < count && a ? { i, a } : null;
    })
    .filter((elite): elite is ReplayWaveElite => !!elite);
  return elites.length ? elites : undefined;
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
      if (!type || count <= 0) return null;
      const parsed: ReplayWaveGroup = { type, count, gap, delay, cloaked: !!row.cloaked };
      const elites = parseEliteRows(row.elites, count);
      if (elites) parsed.elites = elites;
      return parsed;
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
  const snapshots = replaySnapshots(run);
  for (const s of snapshots) {
    if (s.label === 'wave_start') byWave.set(s.wave, { wave: s.wave, startT: s.t });
  }
  for (const e of replayEvents(run)) {
    if (e.type !== 'wave_start') continue;
    const wave = Math.max(0, Math.floor(e.wave));
    byWave.set(wave, { wave, startT: e.t, event: e });
  }
  if (byWave.size === 0 && snapshots[0]) byWave.set(snapshots[0].wave, { wave: snapshots[0].wave, startT: snapshots[0].t });
  return [...byWave.values()].sort((a, b) => a.startT - b.startT || a.wave - b.wave);
}

function plannedSpawnsForWave(win: { wave: number; startT: number; event?: RunEvent }): ReplayPlannedSpawn[] {
  const groups = groupsFromWaveEvent(win.event) ?? fallbackGroupsForWave(win.wave);
  const spawns: ReplayPlannedSpawn[] = [];
  let cursor = win.startT;
  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const firstSpawnT = cursor + grp.delay;
    for (let i = 0; i < grp.count; i++) {
      spawns.push({
        type: grp.type,
        wave: win.wave,
        spawnT: roundReplayT(firstSpawnT + i * grp.gap),
        cloaked: grp.cloaked,
        elite: grp.elites?.find((entry) => entry.i === i)?.a,
      });
    }
    cursor = firstSpawnT + Math.max(0, grp.count - 1) * grp.gap;
  }
  return spawns;
}

function buildPlannedSpawns(run: PublicRunDoc): ReplayPlannedSpawn[] {
  return waveStarts(run).flatMap(plannedSpawnsForWave);
}

function eliteSpeedMult(elite: EliteAffixId | undefined): number {
  return elite ? ELITE_AFFIX_META[elite].speedMult : 1;
}

function legacySpawnRecords(run: PublicRunDoc): Map<number, ReplayEnemyRecord> {
  const records = new Map<number, ReplayEnemyRecord>();
  let syntheticUid = -1;
  const events = replayEvents(run);
  const hasSpawnEvents = events.some((e) => e.type === 'enemy_spawn');

  if (hasSpawnEvents) {
    for (const e of events) {
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

  for (const spawn of buildPlannedSpawns(run)) {
    const def = ENEMIES[spawn.type];
    if (!def) continue;
    const uid = syntheticUid--;
    records.set(uid, {
      uid,
      def,
      wave: spawn.wave,
      spawnT: spawn.spawnT,
      spawnDist: 0,
      cloaked: spawn.cloaked,
      elite: spawn.elite,
    });
  }
  return records;
}

function applyUmbraPhaseEvents(run: PublicRunDoc, records: Map<number, ReplayEnemyRecord>): ReplayUmbraPhasePoint[] {
  const phases: ReplayUmbraPhasePoint[] = [];
  for (const e of replayEvents(run)) {
    if (e.type !== 'umbra_phase') continue;
    const phase = replayUmbraPhaseFromEvent(e);
    if (!phase) continue;
    const enemyUid = typeof e.enemyUid === 'number' && Number.isFinite(e.enemyUid) ? Math.floor(e.enemyUid) : undefined;
    const point: ReplayUmbraPhasePoint = enemyUid == null ? { t: e.t, phase } : { t: e.t, phase, enemyUid };
    phases.push(point);
    let rec = enemyUid == null ? undefined : records.get(enemyUid);
    if (!rec) {
      rec = [...records.values()]
        .filter((candidate) => candidate.def.id === 'umbra' && candidate.spawnT <= e.t)
        .sort((a, b) => b.spawnT - a.spawnT || b.uid - a.uid)[0];
    }
    if (!rec) continue;
    (rec.umbraPhases ??= []).push(point);
  }
  phases.sort((a, b) => a.t - b.t || (a.enemyUid ?? 0) - (b.enemyUid ?? 0) || a.phase - b.phase);
  for (const rec of records.values()) {
    rec.umbraPhases?.sort((a, b) => a.t - b.t || a.phase - b.phase);
  }
  return phases;
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
    rec.endDist = Math.max(rec.spawnDist, eventNum(e ?? ({} as RunEvent), 'dist', rec.spawnDist + rec.def.speed * eliteSpeedMult(rec.elite) * (rec.endT - rec.spawnT)));
    rec.endX = e && typeof e.x === 'number' ? e.x : undefined;
    rec.endY = e && typeof e.y === 'number' ? e.y : undefined;
    rec.sourceTowerUid = e && typeof e.towerUid === 'number' ? e.towerUid : undefined;
    rec.reward = e && typeof e.reward === 'number' ? e.reward : undefined;
  };

  let hasKillEvents = false;
  for (const e of replayEvents(run)) {
    if (e.type === 'enemy_kill') {
      hasKillEvents = true;
      assignEnd('kill', e.t, eventStr(e, 'enemyId'), Math.floor(eventNum(e, 'enemyUid', NaN)), e);
    } else if (e.type === 'leak') {
      const uid = typeof e.enemyUid === 'number' ? Math.floor(e.enemyUid) : undefined;
      assignEnd('leak', e.t, eventStr(e, 'enemyId'), uid, e);
    }
  }

  if (!hasKillEvents) {
    const snaps = [...replaySnapshots(run)].sort((a, b) => a.t - b.t);
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

  const umbraPhases = applyUmbraPhaseEvents(run, records);
  const enemies = [...records.values()].sort((a, b) => a.spawnT - b.spawnT || a.uid - b.uid);
  const effects = enemies
    .filter((e) => e.endT != null)
    .sort((a, b) => (a.endT ?? 0) - (b.endT ?? 0) || a.uid - b.uid);
  return { enemies, effects, authoritativeDeaths: false, umbraPhases };
}

export function buildReplayCombatTimeline(run: PublicRunDoc): ReplayCombatTimeline {
  return buildLegacyTimeline(run);
}

export function ghostFromRecord(geom: PathGeom, rec: ReplayEnemyRecord, t: number, chrono: boolean): Ghost | null {
  if (t < rec.spawnT) return null;
  if (rec.endT != null && t >= rec.endT) return null;
  const age = Math.max(0, t - rec.spawnT);
  let dist = rec.spawnDist + rec.def.speed * eliteSpeedMult(rec.elite) * age * (chrono ? 0.35 : 1);
  if (rec.endT != null && rec.endDist != null) {
    const f = Math.max(0, Math.min(1, (t - rec.spawnT) / Math.max(0.05, rec.endT - rec.spawnT)));
    dist = rec.spawnDist + (rec.endDist - rec.spawnDist) * f;
  }
  if (dist >= geom.len) return null;
  const p = posAtDist(geom, dist);
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + rec.uid * 0.041);
  let umbraPhase: UmbraPhase | undefined = rec.def.id === 'umbra' ? 1 : undefined;
  let umbraPhaseT = rec.spawnT;
  if (rec.umbraPhases) {
    for (const phase of rec.umbraPhases) {
      if (phase.t <= t) {
        umbraPhase = phase.phase;
        umbraPhaseT = phase.t;
      } else break;
    }
  }
  const phaseCloaked = rec.def.id === 'umbra' && umbraPhase === 2 && t - umbraPhaseT <= 3.4;
  const endFade = rec.endT == null ? 0 : Math.max(0, Math.min(1, (rec.endT - t) / 0.8));
  const hpPct = rec.endT != null
    ? Math.max(0.08, Math.min(1, endFade))
    : rec.def.boss ? Math.max(0.18, 0.82 - Math.min(0.55, age / 60) + pulse * 0.08) : 1;
  return {
    x: p.x, y: p.y, angle: p.angle, wp: p.wp, dist: p.dist, uid: rec.uid,
    def: rec.def, cloaked: rec.cloaked || phaseCloaked,
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
    elite: rec.elite,
    umbraPhase,
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
