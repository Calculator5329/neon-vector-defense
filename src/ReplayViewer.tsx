import { useEffect, useMemo, useRef, useState } from 'react';
import { W, H } from './game/engine';
import { buildBackground, drawTowerBody, drawMarkers, drawBlockers, drawReplayEnemy, drawReplayMapEffects, render } from './game/render';
import { createReplayPlayback, type ReplayPlayback } from './game/reSimulate';
import { setReplaySilent } from './game/sound';
import { TOWER_MAP } from './game/towers';
import { ALL_MAPS } from './game/maps';
import { getWave } from './game/waves';
import { ENEMIES } from './game/enemies';
import { ELITE_AFFIX_META } from './game/eliteAffixes';
import { fetchRunReplay, type RunReplayDoc } from './game/leaderboard';
import { appMetrics } from './game/metrics';
import { sfx } from './game/sound';
import DossierShare from './DossierShare';
import { buildDossierInputFromRun } from './game/dossier';
import {
  activeReplayGhosts,
  buildGeom,
  buildReplayCombatTimeline,
  posAtDist,
  reconstructAt,
  replayUmbraPhaseFromEvent,
  waveWindow,
  type Ghost,
  type PathGeom,
  type ReconFrame,
  type ReplayCombatTimeline,
  type ReplayEnemyRecord,
} from './game/replayReconstruct';
import type { RunOutcome, RunEvent } from './game/runTelemetry';
import type { AbilityId, Enemy, TowerDef } from './game/types';

// ── Reconstruction model ────────────────────────────────────────────────────
// A Battle Plan is a *reconstruction*, not a re-sim: the engine's update() loop
// uses Math.random (camera shake, spawn jitter) so a frame-perfect replay is
// impossible. We rebuild the board from per-wave snapshots — fade towers in at
// placedAtS, paint damageByTower as heat, scrub a credits/cores/leaks HUD. All
// motion is driven off the scrub time only, never RNG, so frames are stable.

const FADE_S = 0.45;     // tower fade-in duration (game-seconds) after placedAtS
const REPLAY_SPEEDS = [0.5, 1, 2, 4, 5, 10] as const;
// Per-frame bounds for driver seeks. A long backward scrub re-simulates from t=0
// (up to ~90k ticks for a 25-minute run); slicing keeps every frame under
// SEEK_SLICE_MS so the UI stays at 60fps and a SIMULATING overlay shows
// convergence instead of a frozen canvas. The ms deadline (checked inside the
// driver) is the real bound — tick cost varies ~40x with enemy density — and
// the tick cap is just a safety ceiling for pathological hardware timers.
const SEEK_SLICE_TICKS_MAX = 30_000;
const SEEK_SLICE_MS = 8;
const CALLOUT_S = 1.8;
const EVENT_FEED_S = 3.2;
const ABILITY_DURATIONS: Partial<Record<AbilityId, number>> = {
  strike: 1.2,
  chrono: 6,
  overdrive: 8,
  salvage: 1.4,
  cascade: 1.7,
  mirror: 10,
  recalibrate: 1.4,
};

/** Pure: derive what to draw at scrub position `t` (seconds). Exported for tests. */
/** Fallback keyframe when a (legacy) doc has no snapshots — use the final state. */
// ── Color helper ─────────────────────────────────────────────────────────────
function rgba(hex: string, a: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(120,150,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  victory: 'VICTORY', gameover: 'GRID OVERRUN', abandoned: 'ABANDONED',
};
const OUTCOME_COLOR: Record<RunOutcome, string> = {
  victory: '#3ad6ff', gameover: '#ff5a6e', abandoned: '#9aa6c8',
};

// ── path geometry + enemy re-enactment ──────────────────────────────────────
// The run doc records no per-frame enemy positions, so we COSMETICALLY re-enact the
// armada: each wave's authored composition (getWave) streams down the recorded path at
// each enemy type's speed, driven purely off scrub time. Not a true sim — a reconstruction
// that makes the battle read as alive (enemies, tower fire, wave callouts).
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
  const eliteMeta = gh.elite ? ELITE_AFFIX_META[gh.elite] : null;
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
    exposed: 0,
    exposedTimer: 0,
    phase: gh.uid * 0.013,
    dead: false,
    finished: false,
    elite: gh.elite && eliteMeta ? {
      id: gh.elite,
      rewardMult: eliteMeta.rewardMult,
      speedMult: eliteMeta.speedMult,
      shield: gh.elite === 'shielded' ? 1 : undefined,
      maxShield: gh.elite === 'shielded' ? 1 : undefined,
    } : undefined,
    umbraPhase: gh.umbraPhase,
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
    case 'umbra_phase': {
      const phase = replayUmbraPhaseFromEvent(e);
      return phase === 2 ? 'THE UMBRA phase-shifts' : phase === 3 ? 'THE UMBRA enrages' : null;
    }
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
  return id === 'strike' || id === 'chrono' || id === 'overdrive' || id === 'salvage' || id === 'cascade' || id === 'mirror' || id === 'recalibrate'
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

function effectPosition(geom: PathGeom, rec: ReplayEnemyRecord): { x: number; y: number } {
  if (rec.endX != null && rec.endY != null) return { x: rec.endX, y: rec.endY };
  const p = posAtDist(geom, Math.max(0, rec.endDist ?? rec.spawnDist));
  return { x: p.x, y: p.y };
}

function drawReplayCombatEffects(ctx: CanvasRenderingContext2D, geom: PathGeom | null, timeline: ReplayCombatTimeline, time: number) {
  if (!geom) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "700 11px 'Rajdhani', sans-serif";
  for (const rec of timeline.effects) {
    if (rec.endT == null) continue;
    const age = time - rec.endT;
    if (age < 0) break;
    if (age > 1.15) continue;
    const k = 1 - age / 1.15;
    const p = effectPosition(geom, rec);
    if (rec.endKind === 'leak') {
      ctx.strokeStyle = `rgba(255,90,110,${0.35 + k * 0.45})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, rec.def.radius + 10 + age * 46, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,90,110,${0.12 * k})`;
      ctx.fillRect(0, 0, W, H);
      continue;
    }
    const color = rec.def.glow;
    ctx.strokeStyle = rgba(color, 0.25 + k * 0.65);
    ctx.lineWidth = rec.def.boss ? 4 : 2.4;
    ctx.beginPath(); ctx.arc(p.x, p.y, rec.def.radius + 8 + age * (rec.def.boss ? 88 : 42), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = rgba(color, 0.18 * k);
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, rec.def.radius * (0.8 + age)), 0, Math.PI * 2); ctx.fill();
    const sparks = rec.def.boss ? 16 : 7;
    ctx.fillStyle = rgba('#ffffff', 0.8 * k);
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2 + rec.uid * 0.13;
      const d = (rec.def.radius + 8) * (1 + age * 2.1);
      ctx.fillRect(p.x + Math.cos(a) * d - 1.2, p.y + Math.sin(a) * d - 1.2, 2.4, 2.4);
    }
    if (rec.reward != null && rec.reward > 0 && age < 0.9) {
      ctx.globalAlpha = k;
      ctx.fillStyle = '#ffd32a';
      ctx.fillText(`+${rec.reward}`, p.x, p.y - rec.def.radius - 14 - age * 18);
      ctx.globalAlpha = 1;
    }
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
    } else if (id === 'recalibrate') {
      ctx.strokeStyle = `rgba(128,255,216,${0.22 + k * 0.35})`;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -t * 52;
      for (let r = 70; r < W; r += 190) {
        ctx.beginPath(); ctx.arc(W / 2, H / 2, r + age * 55, 0, Math.PI * 2); ctx.stroke();
      }
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

// Frame-accurate playback renders the real engine with the live renderer; there is
// no placement/selection/aim UI in a replay, so all interaction fields are inert.
const REPLAY_RENDER_UI = { hover: null, placing: null, canPlaceHere: false, selected: null, aimingStrike: false } as const;

/** Floating event feed (placements / upgrades / abilities) — shared by both replay paths. */
function drawEventFeed(ctx: CanvasRenderingContext2D, events: RunEvent[], time: number) {
  const feed = recentEvents(events, time, EVENT_FEED_S);
  if (!feed.length) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = "14px 'Orbitron', sans-serif";
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4;
  let ey = H - 130;
  for (const ev of feed) {
    ctx.globalAlpha = Math.min(1, (1 - ev.age / EVENT_FEED_S) * 1.5);
    ctx.fillStyle = ev.label[0] === '✦' ? '#ffd34d' : '#cfe0ff';
    ctx.fillText(ev.label, 28, ey);
    ey -= 26;
  }
  ctx.restore();
}

type Phase = 'loading' | 'notfound' | 'ready';

export default function ReplayViewer({ runId, onExit }: { runId: string; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<RunReplayDoc | null>(null);

  useEffect(() => {
    let live = true;
    setPhase('loading');
    fetchRunReplay(runId).then((doc) => {
      if (!live) return;
      // only count a watch once the run actually loads (was firing on mount, inflating
      // counts for expired/invalid links)
      if (doc) { appMetrics.recordReplayWatch(); setRun(doc); setPhase('ready'); }
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
          <p>This battle plan couldn't be loaded — shared replays are kept for a limited time, so the link may have expired, or it may be invalid.</p>
          <button className="replay-btn primary" onClick={() => { sfx.click(); onExit(); }}>RETURN TO THE GRID</button>
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

function ReplayStage({ run, onExit }: { run: RunReplayDoc; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [hintOpen, setHintOpen] = useState(true);

  // Scrub domain. v3 replays carry no snapshot keyframes — the domain is the decoded
  // action stream itself, [0 → last recorded second]. (Falling through to the legacy
  // synthetic snapshot pinned the window at t=durationS with a 1s span, which played
  // only "the last two seconds" of every v3 replay.) Legacy v2 docs keep the captured
  // snapshot window [t0, tEnd] so there's no dead lead-in.
  const { t0, tEnd, span, fade } = useMemo(() => {
    if (!run.snapshots.length && run.events.length) {
      const b = Math.max(run.events[run.events.length - 1].t, 1);
      return { t0: 0, tEnd: b, span: b, fade: FADE_S };
    }
    const snaps = run.snapshots.length ? run.snapshots : [reconstructAt(run, 0).snap];
    let a = snaps[0].t;
    // A PURE Freeplay/Daily run opens deep (~wave 50) on a trivial opener — skip ~10 waves of
    // warmup. Guarded on a deep first keyframe so a campaign-that-continued-into-freeplay (whose
    // snapshots start at wave 1) still plays back from wave 1.
    if (run.summary.freeplay && snaps.length > 1 && snaps[0].wave > 5) {
      const skip = snaps.find((s) => s.wave >= snaps[0].wave + 10);
      if (skip) a = skip.t;
    }
    const b = Math.max(snaps[snaps.length - 1].t, a + 1);
    const sp = b - a;
    return { t0: a, tEnd: b, span: sp, fade: FADE_S };
  }, [run]);

  const tRef = useRef(t0);
  const seekPendingRef = useRef(false); // a budgeted driver seek is still converging
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const lastTsRef = useRef(0);
  const rafRef = useRef(0);
  const lastIdxRef = useRef(-1);
  const needsDrawRef = useRef(true);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [hud, setHud] = useState(() => reconstructAt(run, t0));

  // Frame-accurate driver: re-runs the real deterministic engine so the replay
  // matches the actual game. Null for runs that can't be faithfully re-simulated on
  // this client (engine/balance drift, partial record, deep-freeplay marathon) — those
  // fall back to the cosmetic reconstruction below.
  const driver = useMemo<ReplayPlayback | null>(
    () => (run.integrity === 'complete' ? createReplayPlayback(run) : null),
    [run],
  );

  const gameMap = useMemo(() => ALL_MAPS.find((m) => m.id === run.setup.map) ?? null, [run.setup.map]);
  const bg = useMemo(() => (gameMap ? buildBackground(gameMap) : null), [gameMap]);
  const geom = useMemo(() => (gameMap ? buildGeom(gameMap.path) : null), [gameMap]);
  const combatTimeline = useMemo(() => buildReplayCombatTimeline(run), [run]);
  const dossierInput = useMemo(() => buildDossierInputFromRun(run), [run]);

  // Timeline waypoints: legacy docs use the captured snapshot keyframes; v3 docs derive
  // the same jump/tick points from the recorded wave_start actions + run_end.
  const waypoints = useMemo(() => {
    if (run.snapshots.length) return run.snapshots.map((s) => ({ t: s.t, wave: s.wave, label: s.label }));
    return run.events
      .filter((e) => e.type === 'wave_start' || e.type === 'run_end')
      .map((e) => ({ t: e.t, wave: Number(e.wave ?? 0), label: e.type }));
  }, [run]);

  // Waypoint tick marks (positions along the [t0,tEnd] timeline).
  const ticks = useMemo(
    () => waypoints.map((s) => ({ pct: Math.max(0, Math.min(100, ((s.t - t0) / span) * 100)), label: s.label, wave: s.wave })),
    [waypoints, t0, span],
  );

  // Driver-path HUD: read the live engine at the scrub position. (v3 docs have no
  // keyframes, and the legacy synthetic fallback would freeze the HUD at the
  // end-of-run totals while the canvas plays the early game.)
  const frameFromDriver = (g: ReplayPlayback['game'], time: number): ReconFrame => ({
    idx: Math.floor(time * 4), // HUD re-renders at 4 Hz, not every animation frame
    snap: {
      label: 'driver', t: time, wave: g.wave, cash: g.credits, lives: g.lives,
      kills: g.totalKills, leaks: g.runStats.leaks, towerCount: g.towers.length,
      enemyCount: g.enemies.length, damageByTower: {}, killsByEnemy: {}, towers: [],
    },
    towers: g.towers.map((t) => ({
      uid: t.uid, def: t.def, name: t.def.name, x: t.pos.x, y: t.pos.y,
      tierA: t.tierA, tierB: t.tierB, placedAtS: 0, damage: 0,
    })),
    maxDamage: 1,
    terminal: g.phase === 'gameover' || g.phase === 'victory',
  });

  // ── draw one frame at the current scrub time ──
  const draw = (frame: ReconFrame | null) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = ctxRef.current ?? (ctxRef.current = c.getContext('2d'));
    if (!ctx) return;
    const time = tRef.current;

    // Frame-accurate path: step the real engine toward `time` and draw it with the
    // live renderer. Audio is silenced only around the sim step so the engine's own
    // sfx/vox don't fire, while the viewer's UI clicks stay audible. Seeks are
    // budgeted per frame — while a long rewind converges, we render the engine's
    // in-flight state under a SIMULATING overlay instead of freezing the thread.
    if (driver) {
      setReplaySilent(true);
      let settled = true;
      try { settled = driver.seekTo(time, SEEK_SLICE_TICKS_MAX, SEEK_SLICE_MS); } finally { setReplaySilent(false); }
      seekPendingRef.current = !settled;
      render(ctx, driver.game, REPLAY_RENDER_UI);
      if (!settled) {
        const p = driver.seekProgress ?? 0;
        ctx.fillStyle = 'rgba(4, 7, 16, 0.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#7efff5';
        ctx.font = '600 15px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`SIMULATING… ${Math.round(p * 100)}%`, W / 2, H / 2);
        ctx.textAlign = 'start';
        return;
      }
      drawCallout(ctx, waveWindow(run, time), time, span);
      drawEventFeed(ctx, run.events, time);
      return;
    }
    if (!frame) return; // driver-less callers always pass a reconstructed frame

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
    const ghosts = geom ? activeReplayGhosts(geom, combatTimeline, time, activeAbilities.has('chrono')) : [];
    const replayEnemies = ghosts.map((gh) => ghostToEnemy(gh));

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
    drawReplayCombatEffects(ctx, geom, combatTimeline, time);
    drawReplayAbilityEffects(ctx, run.events, time);

    // wave / boss callout (events narration)
    drawCallout(ctx, win, time, span);

    // floating event feed — placements / upgrades / abilities as they happen
    drawEventFeed(ctx, run.events, time);
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

      if (playingRef.current && !seekPendingRef.current) {
        tRef.current += dt * speedRef.current;
        if (tRef.current >= tEnd) {
          tRef.current = tEnd;
          playingRef.current = false;
          setPlaying(false);
        }
      }
      let hudWave = 0;
      if (driver) {
        draw(null); // steps the engine toward tRef (budgeted) and renders it
        hudWave = driver.game.wave;
        // HUD re-renders at 4 Hz, and only once the seek has settled — building
        // a frame every rAF allocated a towers array per frame for no reason.
        if (!seekPendingRef.current) {
          const idx = Math.floor(tRef.current * 4);
          if (idx !== lastIdxRef.current) {
            lastIdxRef.current = idx;
            setHud(frameFromDriver(driver.game, tRef.current));
          }
        }
      } else {
        const frame = reconstructAt(run, tRef.current);
        draw(frame);
        hudWave = frame.snap.wave;
        // only re-render HUD when the active keyframe changes
        if (frame.idx !== lastIdxRef.current) { lastIdxRef.current = frame.idx; setHud(frame); }
      }
      // while a budgeted seek converges, keep pumping frames even when paused
      needsDrawRef.current = seekPendingRef.current;
      // move playhead + progress fill without a React render
      const posPct = ((tRef.current - t0) / span) * 100;
      if (playheadRef.current) playheadRef.current.style.left = `${posPct}%`;
      if (progressRef.current) progressRef.current.style.width = `${posPct}%`;
      if (barRef.current) {
        barRef.current.setAttribute('aria-valuenow', String(Math.round(tRef.current - t0)));
        barRef.current.setAttribute('aria-valuetext', `Wave ${hudWave}, ${Math.round(tRef.current - t0)} of ${Math.round(span)} seconds`);
      }
    };
    // paint a static first frame synchronously so the board shows the instant we mount,
    // even before rAF ramps or if the tab loads in the background
    draw(driver ? null : reconstructAt(run, tRef.current));
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
    const snaps = waypoints;
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
  const restart = () => { sfx.click(); tRef.current = t0; lastIdxRef.current = -1; needsDrawRef.current = true; playingRef.current = true; setPlaying(true); };
  const fineSeek = (deltaS: number) => { playingRef.current = false; setPlaying(false); seek(tRef.current + deltaS); };

  const onBarPoint = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seek(t0 + ratio * span);
  };

  // keyboard: space = play/pause, ←/→ = jump keyframe, Shift+←/→ = fine ±2s, Esc = exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isReplayShortcutTarget(e.target)) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') { e.shiftKey ? fineSeek(2) : stepSnap(1); }
      else if (e.key === 'ArrowLeft') { e.shiftKey ? fineSeek(-2) : stepSnap(-1); }
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
        {s.gauntletNextRunId && (
          <a className="replay-btn" href={`/?run=${s.gauntletNextRunId}`} onClick={() => sfx.click()}>NEXT LEG</a>
        )}
        <DossierShare input={dossierInput} runId={run.runId} compact />
      </div>

      {run.integrity === 'partial' && (
        <div className="replay-integrity-banner" role="status">
          PARTIAL RECORD &mdash; some events could not be recovered
        </div>
      )}

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

      {hintOpen && (
        <div className="replay-hint" role="note">
          <span>{driver ? 'Frame-accurate replay of the recorded run.' : 'Reconstructed from saved snapshots.'} <b>Space</b> play/pause · <b>←/→</b> jump wave · <b>Shift+←/→</b> nudge · drag the bar to scrub.</span>
          <button className="replay-hint-x" aria-label="Dismiss tip" onClick={() => { setHintOpen(false); sfx.click(); }}>✕</button>
        </div>
      )}

      <div className="replay-timeline">
        <div className="replay-bar" ref={barRef}
          role="slider" tabIndex={0}
          aria-label="Replay timeline — arrow keys to seek"
          aria-valuemin={0} aria-valuemax={Math.round(span)} aria-valuenow={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); fineSeek(2); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); fineSeek(-2); }
            else if (e.key === 'Home') { e.preventDefault(); seek(t0); }
            else if (e.key === 'End') { e.preventDefault(); seek(tEnd); }
          }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onBarPoint(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons & 1) onBarPoint(e.clientX); }}>
          <div className="replay-progress" ref={progressRef} style={{ width: '0%' }} />
          {ticks.map((tk, i) => (
            <span key={i} className={`replay-tick ${tk.label === 'run_end' ? 'end' : ''} ${tk.label === 'wave_start' ? 'wave' : ''}`} style={{ left: `${tk.pct}%` }} title={`Wave ${tk.wave}`}>
              {tk.label === 'wave_start' && tk.wave % 5 === 0 && <span className="replay-tick-label">W{tk.wave}</span>}
            </span>
          ))}
          <div className="replay-playhead" ref={playheadRef} style={{ left: '0%' }} />
        </div>
      </div>

      <div className="replay-controls">
        <button className="replay-btn" onClick={() => stepSnap(-1)} aria-label="Previous keyframe" title="Previous keyframe (←)">◀</button>
        <button className="replay-btn primary" onClick={togglePlay} data-testid="replay-play">{playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
        <button className="replay-btn" onClick={() => stepSnap(1)} aria-label="Next keyframe" title="Next keyframe (→)">▶</button>
        <button className="replay-btn" onClick={restart} aria-label="Restart replay" title="Restart">↺</button>
        <div className="replay-speeds">
          {REPLAY_SPEEDS.map((sp) => (
            <button key={sp} className={`replay-btn spd ${speed === sp ? 'on' : ''}`} aria-pressed={speed === sp} aria-label={`${sp}x speed`} onClick={() => setSpd(sp)}>{sp}x</button>
          ))}
        </div>
      </div>
    </div>
  );
}
