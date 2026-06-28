import { useEffect, useMemo, useRef, useState } from 'react';
import { W, H } from './game/engine';
import { buildBackground, drawTowerBody, drawMarkers, drawBlockers, drawReplayEnemy, drawReplayMapEffects } from './game/render';
import { TOWER_MAP } from './game/towers';
import { ALL_MAPS } from './game/maps';
import { getWave } from './game/waves';
import { ENEMIES } from './game/enemies';
import { fetchRunReplay } from './game/leaderboard';
import { appMetrics } from './game/metrics';
import { sfx } from './game/sound';
import DossierShare from './DossierShare';
import { buildDossierInputFromRun } from './game/dossier';
import type { PublicRunDoc, RunWaveSnapshot, RunOutcome, RunEvent } from './game/runTelemetry';
import type { AbilityId, Enemy, EnemyDef, TowerDef } from './game/types';

// ── Reconstruction model ────────────────────────────────────────────────────
// A Battle Plan is a *reconstruction*, not a re-sim: the engine's update() loop
// uses Math.random (camera shake, spawn jitter) so a frame-perfect replay is
// impossible. We rebuild the board from per-wave snapshots — fade towers in at
// placedAtS, paint damageByTower as heat, scrub a credits/cores/leaks HUD. All
// motion is driven off the scrub time only, never RNG, so frames are stable.

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
  idx: number;            // active snapshot index
  snap: RunWaveSnapshot;  // active keyframe
  towers: ReconTower[];   // towers alive at scrub time t
  maxDamage: number;      // for normalizing heat intensity
  terminal: boolean;      // at/after the final keyframe
}

const FADE_S = 0.45;     // tower fade-in duration (game-seconds) after placedAtS
const REPLAY_SPEEDS = [1, 5, 10, 100] as const;
const CALLOUT_S = 1.8;
const EVENT_FEED_S = 3.2;
const ABILITY_DURATIONS: Partial<Record<AbilityId, number>> = {
  strike: 1.2,
  chrono: 6,
  overdrive: 8,
  salvage: 1.4,
  cascade: 1.7,
  mirror: 10,
};

/** Pure: derive what to draw at scrub position `t` (seconds). Exported for tests. */
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
    if (!def) continue; // forward-compat: skip renamed/removed towers
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

/** Fallback keyframe when a (legacy) doc has no snapshots — use the final state. */
function synthSnapshot(run: PublicRunDoc): RunWaveSnapshot {
  const f = run.final;
  return {
    label: 'run_end', t: run.summary.durationS, wave: run.summary.wave,
    cash: run.summary.credits, lives: run.summary.coresLeft, kills: run.summary.kills,
    leaks: run.summary.leaks, towerCount: f.towers.length, enemyCount: 0,
    damageByTower: f.damageByTower, killsByEnemy: f.killsByEnemy, towers: f.towers,
  };
}

// ── Color helper ─────────────────────────────────────────────────────────────
function rgba(hex: string, a: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(120,150,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  victory: 'VICTORY', armistice: 'ARMISTICE', gameover: 'GRID OVERRUN', abandoned: 'ABANDONED',
};
const OUTCOME_COLOR: Record<RunOutcome, string> = {
  victory: '#3ad6ff', armistice: '#8e7bef', gameover: '#ff5a6e', abandoned: '#9aa6c8',
};

// ── path geometry + enemy re-enactment ──────────────────────────────────────
// The run doc records no per-frame enemy positions, so we COSMETICALLY re-enact the
// armada: each wave's authored composition (getWave) streams down the recorded path at
// each enemy type's speed, driven purely off scrub time. Not a true sim — a reconstruction
// that makes the battle read as alive (enemies, tower fire, wave callouts).
interface PathGeom { pts: { x: number; y: number }[]; cum: number[]; len: number; }
function buildGeom(path: { x: number; y: number }[]): PathGeom {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  return { pts: path, cum, len: cum[cum.length - 1] || 1 };
}
function posAtDist(geom: PathGeom, d: number): { x: number; y: number; angle: number; wp: number; dist: number } {
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

interface Ghost {
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
}

interface ReplayShot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  style: TowerDef['style'];
  tierA: number;
  uid: number;
}

/** The current wave + its start time, from the recorded wave_start snapshots. */
function waveWindow(run: PublicRunDoc, t: number): { wave: number; startT: number } {
  let best: { wave: number; startT: number } | null = null;
  for (const s of run.snapshots) {
    if (s.t <= t && s.label === 'wave_start') best = { wave: s.wave, startT: s.t };
    else if (s.t > t) break;
  }
  if (best) return best;
  const f = run.snapshots[0];
  return { wave: f?.wave ?? run.summary.wave, startT: f?.t ?? 0 };
}

function reenactEnemies(geom: PathGeom, wave: number, startT: number, t: number, cap = 240): Ghost[] {
  const out: Ghost[] = [];
  let groups; try { groups = getWave(wave); } catch { return out; }
  let seq = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const def = ENEMIES[grp.type];
    if (!def) continue;
    for (let i = 0; i < grp.count; i++) {
      seq++;
      const spawnT = startT + (grp.delay ?? 0) + i * grp.gap;
      const age = t - spawnT;
      if (age <= 0) continue;
      const dist = def.speed * age;
      if (dist >= geom.len) continue; // exited the lane
      const p = posAtDist(geom, dist);
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + seq * 0.41);
      const hpPct = def.boss ? Math.max(0.18, 0.82 - Math.min(0.55, age / 60) + pulse * 0.08) : 1;
      out.push({
        x: p.x, y: p.y, angle: p.angle, wp: p.wp, dist: p.dist, uid: wave * 10000 + gi * 500 + i,
        def, cloaked: grp.cloaked ?? false,
        slow: 1,
        resonance: def.id === 'prism' && pulse > 0.86 ? 1 : 0,
        burnTimer: def.boss && pulse > 0.9 ? 0.6 : 0,
        hpPct,
      });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Draw one re-enacted hull as its shape, colored by type. */
function drawGhost(ctx: CanvasRenderingContext2D, gh: Ghost) {
  const r = gh.def.radius;
  ctx.save();
  ctx.translate(gh.x, gh.y);
  ctx.globalAlpha = gh.cloaked ? 0.4 : 1;
  ctx.rotate(gh.angle);
  ctx.fillStyle = gh.def.color;
  ctx.strokeStyle = gh.def.glow;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = gh.def.glow;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  const shape = gh.def.shape;
  if (shape === 'tri' || shape === 'ship') {
    ctx.moveTo(r, 0); ctx.lineTo(-r * 0.8, r * 0.7); ctx.lineTo(-r * 0.8, -r * 0.7); ctx.closePath();
  } else if (shape === 'diamond') {
    ctx.moveTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.lineTo(0, -r); ctx.closePath();
  } else { // hex / pent / capital → regular polygon
    const sides = shape === 'pent' ? 5 : shape === 'capital' ? 8 : 6;
    const rr = shape === 'capital' ? r * 1.3 : r;
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; const fn = i ? 'lineTo' : 'moveTo'; ctx[fn](Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function ghostToEnemy(gh: Ghost): Enemy {
  const maxHp = Math.max(1, gh.def.hp);
  return {
    uid: gh.uid,
    def: gh.def,
    hp: maxHp * gh.hpPct,
    maxHp,
    pos: { x: gh.x, y: gh.y },
    wp: gh.wp,
    dist: gh.dist,
    slow: gh.slow,
    slowTimer: gh.slow < 1 ? 1 : 0,
    burnDps: 0,
    burnTimer: gh.burnTimer,
    cloaked: gh.cloaked,
    resonance: gh.resonance,
    resonanceTimer: gh.resonance ? 1 : 0,
    phase: gh.uid * 0.013,
    dead: false,
    finished: false,
  };
}

function isBossWave(wave: number): boolean {
  try { return getWave(wave).some((g) => ENEMIES[g.type]?.boss); } catch { return false; }
}

function prettyAbility(id: string): string {
  return (id || 'Ability').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Human-readable label for a replay event, or null to ignore (leaks/target-changes are noise). */
function eventLabel(e: RunEvent): string | null {
  const tid = e.towerId as string | undefined;
  switch (e.type) {
    case 'tower_place': return `✚ Deployed ${(e.name as string) ?? TOWER_MAP[tid ?? '']?.name ?? 'tower'}`;
    case 'tower_upgrade': return `⬆ ${TOWER_MAP[tid ?? '']?.short ?? ''} ${(e.upgradeName as string) ?? 'upgrade'}`.trim();
    case 'tower_sell': return `✖ Sold ${TOWER_MAP[tid ?? '']?.name ?? 'tower'}`;
    case 'ability_cast': return `✦ ${prettyAbility(e.abilityId as string)}`;
    case 'receiver_build': return '◈ Receiver online';
    default: return null;
  }
}
/** The few most recent events at scrub time t (newest first), for the floating feed. */
function recentEvents(events: RunEvent[], t: number, windowS: number, max = 4): { label: string; age: number }[] {
  const out: { label: string; age: number }[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i];
    if (e.t > t) continue;
    if (t - e.t > windowS) break; // events are time-ordered ascending
    const label = eventLabel(e);
    if (label) out.push({ label, age: t - e.t });
  }
  return out;
}

function eventAbilityId(e: RunEvent): AbilityId | null {
  if (e.type !== 'ability_cast') return null;
  const id = e.abilityId;
  return id === 'strike' || id === 'chrono' || id === 'overdrive' || id === 'salvage' || id === 'cascade' || id === 'mirror'
    ? id
    : null;
}

function activeAbilityIds(events: RunEvent[], t: number): Set<AbilityId> {
  const active = new Set<AbilityId>();
  for (const e of events) {
    if (e.t > t) break;
    const id = eventAbilityId(e);
    if (!id) continue;
    const dur = ABILITY_DURATIONS[id] ?? 0;
    if (t - e.t >= 0 && t - e.t <= dur) active.add(id);
  }
  return active;
}

function drawReplayWeaponFire(ctx: CanvasRenderingContext2D, shots: ReplayShot[], time: number) {
  if (!shots.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const s of shots) {
    const dx = s.tx - s.x, dy = s.ty - s.y;
    const ang = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy) || 1;
    if (s.style === 'missile') {
      const p = 0.35 + 0.45 * ((time * 3 + s.uid * 0.17) % 1);
      const x = s.x + dx * p, y = s.y + dy * p;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = '#d8dff0';
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(2, -3); ctx.lineTo(-7, -2.4); ctx.lineTo(-9, 0); ctx.lineTo(-7, 2.4); ctx.lineTo(2, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(s.color, 0.8);
      ctx.beginPath();
      ctx.moveTo(-6, -2.4); ctx.lineTo(-18, 0); ctx.lineTo(-6, 2.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (s.style === 'arc') {
      ctx.strokeStyle = rgba(s.color, 0.72);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      const steps = 5;
      for (let i = 1; i < steps; i++) {
        const k = i / steps;
        const jitter = Math.sin(time * 28 + s.uid + i * 1.7) * 10;
        ctx.lineTo(s.x + dx * k + Math.cos(ang + Math.PI / 2) * jitter, s.y + dy * k + Math.sin(ang + Math.PI / 2) * jitter);
      }
      ctx.lineTo(s.tx, s.ty);
      ctx.stroke();
    } else if (s.style === 'pulse' || s.style === 'nova' || s.style === 'gravity' || s.style === 'rift') {
      ctx.strokeStyle = rgba(s.color, 0.55);
      ctx.lineWidth = s.style === 'gravity' || s.style === 'rift' ? 2.4 : 1.8;
      ctx.setLineDash(s.style === 'gravity' ? [4, 5] : []);
      ctx.beginPath();
      ctx.arc(s.tx, s.ty, 12 + ((time * 24 + s.uid) % 10), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (s.style === 'sweep') {
      const g = ctx.createLinearGradient(s.x, s.y, s.tx, s.ty);
      g.addColorStop(0, rgba(s.color, 0.55));
      g.addColorStop(1, rgba(s.color, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(ang) * Math.min(dist, 220), s.y + Math.sin(ang) * Math.min(dist, 220)); ctx.stroke();
    } else {
      ctx.strokeStyle = rgba(s.color, s.style === 'rail' ? 0.75 : 0.45);
      ctx.lineWidth = s.style === 'rail' ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.tx, s.ty); ctx.stroke();
    }
    ctx.fillStyle = rgba(s.color, 0.85);
    ctx.beginPath(); ctx.arc(s.tx, s.ty, s.style === 'rail' ? 4 : 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawReplayAbilityEffects(ctx: CanvasRenderingContext2D, events: RunEvent[], t: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.t > t) continue;
    const id = eventAbilityId(e);
    if (!id) continue;
    const age = t - e.t;
    const dur = ABILITY_DURATIONS[id] ?? 0;
    if (age > dur) {
      if (age > 12) break;
      continue;
    }
    const k = Math.max(0, 1 - age / Math.max(0.001, dur));
    if (id === 'strike') {
      const x = typeof e.x === 'number' ? e.x : W / 2;
      const y = typeof e.y === 'number' ? e.y : H / 2;
      ctx.strokeStyle = `rgba(255,211,42,${0.3 + k * 0.55})`;
      ctx.shadowColor = '#ffd32a';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 36 + age * 80, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + k * 0.5})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y); ctx.stroke();
    } else if (id === 'salvage') {
      ctx.fillStyle = `rgba(255,211,42,${0.08 + k * 0.18})`;
      ctx.fillRect(0, 0, W, H);
    } else if (id === 'cascade') {
      ctx.strokeStyle = `rgba(255,248,196,${0.25 + k * 0.45})`;
      ctx.lineWidth = 2;
      for (let r = 80; r < W; r += 170) {
        ctx.beginPath(); ctx.arc(W / 2, H / 2, r + age * 80, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (id === 'mirror') {
      ctx.strokeStyle = `rgba(179,136,255,${0.18 + k * 0.25})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.lineDashOffset = -t * 45;
      ctx.strokeRect(18, 18, W - 36, H - 36);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  const active = activeAbilityIds(events, t);
  if (active.has('chrono')) {
    ctx.fillStyle = 'rgba(80,160,255,0.13)';
    ctx.fillRect(0, 0, W, H);
  }
  if (active.has('overdrive')) {
    const a = 0.06 * (0.7 + 0.3 * Math.sin(t * 10));
    ctx.fillStyle = `rgba(255,170,60,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/** Floating "WAVE N" / boss callout that fades over the first few replay seconds of each wave. */
function drawCallout(ctx: CanvasRenderingContext2D, win: { wave: number; startT: number }, time: number, span: number) {
  const age = time - win.startT;
  void span;
  const showGame = CALLOUT_S;
  if (age < 0 || age > showGame) return;
  const k = 1 - age / showGame;
  const boss = isBossWave(win.wave);
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 1.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = "700 34px 'Orbitron', sans-serif";
  ctx.fillStyle = boss ? '#ff5a6e' : '#4bcffa';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 18;
  ctx.fillText(boss ? `⚠ CAPITAL HULL · WAVE ${win.wave}` : `WAVE ${win.wave}`, W / 2, 92);
  ctx.restore();
}

type Phase = 'loading' | 'notfound' | 'ready';

export default function ReplayViewer({ runId, onExit }: { runId: string; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<PublicRunDoc | null>(null);

  useEffect(() => {
    let live = true;
    appMetrics.recordReplayWatch();
    setPhase('loading');
    fetchRunReplay(runId).then((doc) => {
      if (!live) return;
      if (doc) { setRun(doc); setPhase('ready'); }
      else setPhase('notfound');
    });
    return () => { live = false; };
  }, [runId]);

  if (phase === 'loading') {
    return (
      <div className="replay-root" data-testid="replay-root">
        <div className="replay-status">Reconstructing battle plan<span className="replay-dots" /></div>
      </div>
    );
  }
  if (phase === 'notfound' || !run) {
    return (
      <div className="replay-root" data-testid="replay-root">
        <div className="replay-status">
          <div className="replay-lost">REPLAY UNAVAILABLE</div>
          <p>This battle plan has expired or the link is invalid.</p>
          <button className="replay-btn primary" onClick={() => { sfx.click(); onExit(); }}>RETURN TO GRID</button>
        </div>
      </div>
    );
  }
  return <ReplayStage run={run} onExit={onExit} />;
}

function isReplayShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return true;
  return Boolean(target.closest('button, a, [role="button"], [role="link"]'));
}

function ReplayStage({ run, onExit }: { run: PublicRunDoc; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  // The writer keeps only the last ~80 snapshots, so a long run's earliest keyframe
  // can be deep into the game (no wave-1 data). Clamp the scrub domain to the captured
  // window [t0, tEnd] instead of [0, durationS] so there's no dead lead-in.
  const { t0, tEnd, span, fade } = useMemo(() => {
    const snaps = run.snapshots.length ? run.snapshots : [reconstructAt(run, 0).snap];
    let a = snaps[0].t;
    // Freeplay (incl. Daily) opens deep into the run (~wave 50); skip the warmup so the
    // replay starts at the first "real" round (~wave 60) instead of the trivial opener.
    if (run.summary.freeplay && snaps.length > 1) {
      const skip = snaps.find((s) => s.wave >= snaps[0].wave + 10);
      if (skip) a = skip.t;
    }
    const b = Math.max(snaps[snaps.length - 1].t, a + 1);
    const sp = b - a;
    return { t0: a, tEnd: b, span: sp, fade: FADE_S };
  }, [run]);

  const tRef = useRef(t0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const lastTsRef = useRef(0);
  const rafRef = useRef(0);
  const lastIdxRef = useRef(-1);
  const needsDrawRef = useRef(true);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [hud, setHud] = useState(() => reconstructAt(run, t0));

  const gameMap = useMemo(() => ALL_MAPS.find((m) => m.id === run.setup.map) ?? null, [run.setup.map]);
  const bg = useMemo(() => (gameMap ? buildBackground(gameMap) : null), [gameMap]);
  const geom = useMemo(() => (gameMap ? buildGeom(gameMap.path) : null), [gameMap]);
  const dossierInput = useMemo(() => buildDossierInputFromRun(run), [run]);

  // Snapshot tick marks (positions along the [t0,tEnd] timeline).
  const ticks = useMemo(
    () => run.snapshots.map((s) => ({ pct: Math.max(0, Math.min(100, ((s.t - t0) / span) * 100)), label: s.label, wave: s.wave })),
    [run.snapshots, t0, span],
  );

  // ── draw one frame at the current scrub time ──
  const draw = (frame: ReconFrame) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = ctxRef.current ?? (ctxRef.current = c.getContext('2d'));
    if (!ctx) return;
    const time = tRef.current;

    if (bg && gameMap) {
      ctx.drawImage(bg, 0, 0);
      drawReplayMapEffects(ctx, gameMap, time);
      drawBlockers(ctx, gameMap, time);
      drawMarkers(ctx, gameMap, time);
    } else {
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, W, H);
    }

    // re-enact the armada streaming down the lane for the active wave
    const win = waveWindow(run, time);
    const activeAbilities = activeAbilityIds(run.events, time);
    const ghosts = geom ? reenactEnemies(geom, win.wave, win.startT, time) : [];
    const replayEnemies = ghosts.map((gh) => ghostToEnemy({ ...gh, slow: activeAbilities.has('chrono') ? 0.35 : gh.slow }));

    // coverage + heat per tower (lighter blend so overlaps glow)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const tw of frame.towers) {
      const intensity = Math.min(1, tw.damage / frame.maxDamage);
      ctx.strokeStyle = rgba(tw.def.glow, 0.06 + intensity * 0.12);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tw.x, tw.y, tw.def.base.range, 0, Math.PI * 2);
      ctx.stroke();
      if (intensity > 0.02) {
        const r = 24 + intensity * 40;
        const g = ctx.createRadialGradient(tw.x, tw.y, 2, tw.x, tw.y, r);
        g.addColorStop(0, rgba(tw.def.glow, 0.28 * intensity + 0.05));
        g.addColorStop(1, rgba(tw.def.glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // enemies (over the heat glow)
    if (gameMap) {
      for (const enemy of replayEnemies) drawReplayEnemy(ctx, enemy, time, gameMap, run.setup.diff, replayEnemies.length);
    } else {
      for (const gh of ghosts) drawGhost(ctx, gh);
    }

    // towers — aim at the nearest in-range hull and fire; fade in by placedAtS
    const shots: ReplayShot[] = [];
    for (const tw of frame.towers) {
      const alpha = Math.max(0, Math.min(1, (time - tw.placedAtS) / fade));
      if (alpha <= 0) continue;
      let target: Ghost | null = null;
      let bestD = tw.def.base.range * tw.def.base.range;
      for (const gh of ghosts) {
        const dx = gh.x - tw.x, dy = gh.y - tw.y, d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; target = gh; }
      }
      let angle = -Math.PI / 2 + Math.sin(time * 0.6 + tw.uid) * 0.06;
      let flash = 0;
      if (target) {
        angle = Math.atan2(target.y - tw.y, target.x - tw.x);
        const rate = Math.max(0.4, tw.def.base.fireRate || 1);
        const cyc = (time * rate + tw.uid * 0.37) % 1; // deterministic firing cadence
        if (cyc < 0.5) {
          flash = 1 - cyc * 2;
          shots.push({ x: tw.x, y: tw.y, tx: target.x, ty: target.y, color: tw.def.glow, style: tw.def.style, tierA: tw.tierA, uid: tw.uid });
        }
      }
      drawTowerBody(ctx, { x: tw.x, y: tw.y }, tw.def, angle, tw.tierA, tw.tierB, alpha, flash, time, 0, activeAbilities.has('overdrive'));
    }

    // weapon fire (over towers, additive)
    drawReplayWeaponFire(ctx, shots, time);
    drawReplayAbilityEffects(ctx, run.events, time);

    // wave / boss callout (events narration)
    drawCallout(ctx, win, time, span);

    // floating event feed — placements / upgrades / abilities as they happen
    const evWindow = EVENT_FEED_S;
    const feed = recentEvents(run.events, time, evWindow);
    if (feed.length) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = "14px 'Orbitron', sans-serif";
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 4;
      let ey = H - 130;
      for (const ev of feed) {
        ctx.globalAlpha = Math.min(1, (1 - ev.age / evWindow) * 1.5);
        ctx.fillStyle = ev.label[0] === '✦' ? '#ffd34d' : '#cfe0ff';
        ctx.fillText(ev.label, 28, ey);
        ey -= 26;
      }
      ctx.restore();
    }
  };

  // ── animation / scrub loop ──
  useEffect(() => {
    const step = (ts: number) => {
      rafRef.current = requestAnimationFrame(step);
      if (document.hidden) {
        lastTsRef.current = ts;
        return;
      }
      if (!playingRef.current && !needsDrawRef.current) {
        lastTsRef.current = ts;
        return;
      }
      const last = lastTsRef.current || ts;
      const dt = Math.min(0.1, (ts - last) / 1000);
      lastTsRef.current = ts;

      if (playingRef.current) {
        tRef.current += dt * speedRef.current;
        if (tRef.current >= tEnd) {
          tRef.current = tEnd;
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const frame = reconstructAt(run, tRef.current);
      draw(frame);
      needsDrawRef.current = false;
      // move playhead without a React render
      if (playheadRef.current) playheadRef.current.style.left = `${((tRef.current - t0) / span) * 100}%`;
      // only re-render HUD when the active keyframe changes
      if (frame.idx !== lastIdxRef.current) { lastIdxRef.current = frame.idx; setHud(frame); }
    };
    // paint a static first frame synchronously so the board shows the instant we mount,
    // even before rAF ramps or if the tab loads in the background
    draw(reconstructAt(run, tRef.current));
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, t0, tEnd, span]);

  // ── controls ──
  const seek = (t: number) => {
    tRef.current = Math.max(t0, Math.min(tEnd, t));
    lastIdxRef.current = -1; // force HUD refresh next frame
    needsDrawRef.current = true;
    if (tRef.current >= tEnd) { playingRef.current = false; setPlaying(false); }
  };
  const togglePlay = () => {
    sfx.click();
    if (!playingRef.current && tRef.current >= tEnd) tRef.current = t0; // replay from start
    playingRef.current = !playingRef.current;
    needsDrawRef.current = true;
    setPlaying(playingRef.current);
  };
  const stepSnap = (dir: -1 | 1) => {
    sfx.click();
    playingRef.current = false; setPlaying(false);
    const snaps = run.snapshots;
    const cur = tRef.current;
    if (dir > 0) {
      const next = snaps.find((s) => s.t > cur + 0.01);
      seek(next ? next.t : tEnd);
    } else {
      let prev = t0;
      for (const s of snaps) { if (s.t < cur - 0.01) prev = s.t; else break; }
      seek(prev);
    }
  };
  const setSpd = (s: number) => { sfx.click(); speedRef.current = s; setSpeed(s); };

  const onBarPoint = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seek(t0 + ratio * span);
  };

  // keyboard: space = play/pause, ←/→ = step, Esc = exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isReplayShortcutTarget(e.target)) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') stepSnap(1);
      else if (e.key === 'ArrowLeft') stepSnap(-1);
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = run.summary;
  const snap = hud.snap;
  const outcome = s.outcome;
  const showStamp = hud.terminal;

  return (
    <div className="replay-root" data-testid="replay-root">
      <div className="replay-topbar">
        <button className="replay-btn ghost" onClick={() => { sfx.click(); onExit(); }} data-testid="replay-exit">← GRID</button>
        <div className="replay-title">
          <b>{s.callsign}</b>
          <span>{s.mapName} · {s.diffName}{s.freeplay ? ' · FREEPLAY' : ''}</span>
        </div>
        <DossierShare input={dossierInput} runId={run.runId} compact />
      </div>

      <div className="replay-stage">
        <canvas ref={canvasRef} width={W} height={H} className="replay-canvas" />
        {showStamp && (
          <div className="replay-stamp" style={{ color: OUTCOME_COLOR[outcome] }}>
            <div className="replay-stamp-outcome">{OUTCOME_LABEL[outcome]}</div>
            <div className="replay-stamp-sub">WAVE {s.wave} · {s.kills.toLocaleString()} HULLS</div>
          </div>
        )}
      </div>

      <div className="replay-hud">
        <div className="replay-stat"><label>WAVE</label><b>{snap.wave}</b></div>
        <div className="replay-stat"><label>CORES</label><b>{snap.lives}</b></div>
        <div className="replay-stat"><label>CREDITS</label><b>{`⌬${Math.round(snap.cash).toLocaleString()}`}</b></div>
        <div className="replay-stat"><label>HULLS</label><b>{snap.kills.toLocaleString()}</b></div>
        <div className="replay-stat"><label>LEAKS</label><b>{snap.leaks}</b></div>
        <div className="replay-stat"><label>TOWERS</label><b>{hud.towers.length}</b></div>
      </div>

      <div className="replay-timeline">
        <div className="replay-bar" ref={barRef}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onBarPoint(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons & 1) onBarPoint(e.clientX); }}>
          {ticks.map((tk, i) => (
            <span key={i} className={`replay-tick ${tk.label === 'run_end' ? 'end' : ''}`} style={{ left: `${tk.pct}%` }} title={`Wave ${tk.wave} · ${tk.label}`} />
          ))}
          <div className="replay-playhead" ref={playheadRef} style={{ left: '0%' }} />
        </div>
      </div>

      <div className="replay-controls">
        <button className="replay-btn" onClick={() => stepSnap(-1)} title="Previous wave">◀</button>
        <button className="replay-btn primary" onClick={togglePlay} data-testid="replay-play">{playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
        <button className="replay-btn" onClick={() => stepSnap(1)} title="Next wave">▶</button>
        <div className="replay-speeds">
          {REPLAY_SPEEDS.map((sp) => (
            <button key={sp} className={`replay-btn spd ${speed === sp ? 'on' : ''}`} onClick={() => setSpd(sp)}>{sp}x</button>
          ))}
        </div>
      </div>
    </div>
  );
}
