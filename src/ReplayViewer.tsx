import { useEffect, useMemo, useRef, useState } from 'react';
import { W, H } from './game/engine';
import { buildBackground, drawTowerBody, drawMarkers, drawBlockers } from './game/render';
import { TOWER_MAP } from './game/towers';
import { ALL_MAPS } from './game/maps';
import { getWave } from './game/waves';
import { ENEMIES } from './game/enemies';
import { fetchRunReplay } from './game/leaderboard';
import { appMetrics } from './game/metrics';
import { sfx } from './game/sound';
import DossierShare from './DossierShare';
import { buildDossierInputFromRun } from './game/dossier';
import type { PublicRunDoc, RunWaveSnapshot, RunOutcome } from './game/runTelemetry';
import type { TowerDef, EnemyDef } from './game/types';

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
const PLAY_SECONDS = 24; // wall-clock to play the whole captured window at 1× (game length agnostic)

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
      damage: ts.damage, name: ts.name,
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
function posAtDist(geom: PathGeom, d: number): { x: number; y: number; angle: number } {
  const { pts, cum } = geom;
  const dist = Math.max(0, Math.min(geom.len, d));
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= dist) {
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (dist - cum[i - 1]) / seg;
      const a = pts[i - 1], b = pts[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

interface Ghost { x: number; y: number; angle: number; def: EnemyDef; cloaked: boolean; }

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
  for (const grp of groups) {
    const def = ENEMIES[grp.type];
    if (!def) continue;
    for (let i = 0; i < grp.count; i++) {
      const spawnT = startT + (grp.delay ?? 0) + i * grp.gap;
      const age = t - spawnT;
      if (age <= 0) continue;
      const dist = def.speed * age;
      if (dist >= geom.len) continue; // exited the lane
      const p = posAtDist(geom, dist);
      out.push({ x: p.x, y: p.y, angle: p.angle, def, cloaked: grp.cloaked ?? false });
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

function isBossWave(wave: number): boolean {
  try { return getWave(wave).some((g) => ENEMIES[g.type]?.boss); } catch { return false; }
}

/** Floating "WAVE N" / boss callout that fades over the first ~1.8 wall-clock s of each wave. */
function drawCallout(ctx: CanvasRenderingContext2D, win: { wave: number; startT: number }, time: number, span: number) {
  const age = time - win.startT;
  const showGame = (span / PLAY_SECONDS) * 1.8; // ~1.8s of wall-clock at 1×, in game-seconds
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
    const a = snaps[0].t;
    const b = Math.max(snaps[snaps.length - 1].t, a + 1);
    const sp = b - a;
    // fade window in game-seconds, sized so a placement reads as ~0.4s of wall-clock at 1×
    return { t0: a, tEnd: b, span: sp, fade: Math.max(FADE_S, (sp / PLAY_SECONDS) * 0.4) };
  }, [run]);

  const tRef = useRef(t0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const lastTsRef = useRef(0);
  const rafRef = useRef(0);
  const lastIdxRef = useRef(-1);

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
      drawBlockers(ctx, gameMap, time);
      drawMarkers(ctx, gameMap, time);
    } else {
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, W, H);
    }

    // re-enact the armada streaming down the lane for the active wave
    const win = waveWindow(run, time);
    const ghosts = geom ? reenactEnemies(geom, win.wave, win.startT, time) : [];

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
    for (const gh of ghosts) drawGhost(ctx, gh);

    // towers — aim at the nearest in-range hull and fire; fade in by placedAtS
    const beams: { x: number; y: number; tx: number; ty: number; color: string }[] = [];
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
        if (cyc < 0.5) { flash = 1 - cyc * 2; beams.push({ x: tw.x, y: tw.y, tx: target.x, ty: target.y, color: tw.def.glow }); }
      }
      drawTowerBody(ctx, { x: tw.x, y: tw.y }, tw.def, angle, tw.tierA, tw.tierB, alpha, flash, time, 0);
    }

    // weapon fire (over towers, additive)
    if (beams.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of beams) {
        ctx.strokeStyle = rgba(b.color, 0.45);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.tx, b.ty); ctx.stroke();
        ctx.fillStyle = rgba(b.color, 0.85);
        ctx.beginPath(); ctx.arc(b.tx, b.ty, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // wave / boss callout (events narration)
    drawCallout(ctx, win, time, span);
  };

  // ── animation / scrub loop ──
  useEffect(() => {
    const step = (ts: number) => {
      rafRef.current = requestAnimationFrame(step);
      const last = lastTsRef.current || ts;
      const dt = Math.min(0.1, (ts - last) / 1000);
      lastTsRef.current = ts;

      if (playingRef.current) {
        tRef.current += dt * speedRef.current * (span / PLAY_SECONDS);
        if (tRef.current >= tEnd) {
          tRef.current = tEnd;
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const frame = reconstructAt(run, tRef.current);
      draw(frame);
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
    if (tRef.current >= tEnd) { playingRef.current = false; setPlaying(false); }
  };
  const togglePlay = () => {
    sfx.click();
    if (!playingRef.current && tRef.current >= tEnd) tRef.current = t0; // replay from start
    playingRef.current = !playingRef.current;
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
          {[1, 2, 4].map((sp) => (
            <button key={sp} className={`replay-btn spd ${speed === sp ? 'on' : ''}`} onClick={() => setSpd(sp)}>{sp}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
