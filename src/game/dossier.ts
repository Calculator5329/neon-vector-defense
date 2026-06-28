// Mission Dossier — a 1200×630 shareable "result card" rendered from a finished run.
// Both a live finished Game and a fetched PublicRunDoc converge on one DossierInput so
// the card looks identical from the run-end overlay and from a ?run= deep link.
// Pure canvas, no RNG (stable output), no live-Game/scene-renderer dependency.

import { TOWER_MAP } from './towers';
import { ALL_MAPS } from './maps';
import { drawTowerBody } from './render';
import { TELEMETRY_BUILD } from './leaderboard';
import { meta } from './meta';
import { paletteById } from './palette';
import type { Game } from './engine';
import type { PublicRunDoc, RunOutcome } from './runTelemetry';
import type { TowerDef } from './types';

/** hex (#rgb/#rrggbb) → rgba() string for translucent accent fills. */
function hexA(hex: string, a: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(75,207,250,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface DossierTower { id: string; name: string; color: string; glow: string; damage: number; pct: number; tierA: number; tierB: number; }
export interface DossierPlacement { x: number; y: number; def: TowerDef; }

export interface DossierInput {
  callsign: string;
  mapId: string; mapName: string;
  diffName: string;
  freeplay: boolean;
  daily: boolean;
  outcome: RunOutcome;
  wave: number; kills: number; cashEarned: number; coresLeft: number; durationS: number;
  topTowers: DossierTower[];
  placements: DossierPlacement[];
  runId: string;
}

const CARD_W = 1200, CARD_H = 630;

const OUTCOME: Record<RunOutcome, { word: string; color: string }> = {
  victory: { word: 'SECTOR SECURED', color: '#2ed573' },
  armistice: { word: 'THE LONG SIGNAL', color: '#ffd32a' },
  gameover: { word: 'GRID OFFLINE', color: '#ff4757' },
  abandoned: { word: 'SIGNAL LOST', color: '#9aa6c8' },
};

export function buildDossierInputFromRun(run: PublicRunDoc): DossierInput {
  const s = run.summary;
  const towers = run.final?.towers ?? [];
  // best tier instance per tower id (for nicer icons)
  const tierFor = (id: string) => {
    let best = { a: 0, b: 0, sum: -1 };
    for (const t of towers) {
      if (t.towerId !== id) continue;
      const sum = t.tierA + t.tierB;
      if (sum > best.sum) best = { a: t.tierA, b: t.tierB, sum };
    }
    return best;
  };
  const dmg = run.final?.damageByTower ?? {};
  const ranked = Object.entries(dmg).filter(([id]) => TOWER_MAP[id]).sort((a, b) => b[1] - a[1]);
  const maxDmg = ranked[0]?.[1] ?? 1;
  const topTowers: DossierTower[] = ranked.slice(0, 3).map(([id, damage]) => {
    const def = TOWER_MAP[id]; const tr = tierFor(id);
    return { id, name: def.name, color: def.color, glow: def.glow, damage, pct: damage / maxDmg, tierA: tr.a, tierB: tr.b };
  });
  const placements: DossierPlacement[] = towers
    .filter((t) => TOWER_MAP[t.towerId])
    .map((t) => ({ x: t.x, y: t.y, def: TOWER_MAP[t.towerId] }));
  return {
    callsign: s.callsign || 'WARDEN',
    mapId: s.map, mapName: s.mapName, diffName: s.diffName,
    freeplay: s.freeplay, daily: false,
    outcome: s.outcome, wave: s.wave, kills: s.kills,
    cashEarned: s.cashEarned, coresLeft: s.coresLeft, durationS: s.durationS,
    topTowers, placements, runId: run.runId,
  };
}

export function buildDossierInputFromGame(game: Game, callsign: string): DossierInput {
  const input = buildDossierInputFromRun(game.buildRunUploadBundle(callsign, TELEMETRY_BUILD).run);
  input.daily = game.freeplay ? Boolean(game.freeplayMeta().daily) : false;
  return input;
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export async function renderDossierCanvas(input: DossierInput): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* fonts optional */ }
  }
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext('2d')!;
  const map = ALL_MAPS.find((m) => m.id === input.mapId);
  const th = map?.theme ?? { bg1: '#0a1030', bg2: '#04060f', path: '#2a3a7a', pathEdge: '#4bcffa' };
  const oc = OUTCOME[input.outcome];
  // tint the card's neon identity with the player's equipped Signal Palette (cosmetic = social proof)
  const accent = paletteById(meta.equippedPalette).color;

  // backdrop
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, th.bg1); bg.addColorStop(1, th.bg2);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CARD_W, CARD_H);
  // subtle starfield (deterministic)
  ctx.fillStyle = 'rgba(180,200,255,0.5)';
  for (let i = 0; i < 90; i++) {
    const x = (i * 7919) % CARD_W, y = (i * 104729) % CARD_H, r = (i % 3) * 0.6 + 0.4;
    ctx.globalAlpha = 0.1 + ((i * 13) % 7) / 18;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // mini "battle map" — top-right, balancing the big outcome word on the left
  const panel = { x: 700, y: 96, w: 456, h: 212 };
  drawMiniLane(ctx, input, th, panel);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#9fb2dd'; ctx.font = "13px 'Orbitron', sans-serif";
  ctx.fillText('BATTLE MAP', panel.x + 2, panel.y - 8);

  // neon frame (palette-tinted)
  ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.strokeRect(14, 14, CARD_W - 28, CARD_H - 28);
  ctx.strokeStyle = hexA(accent, 0.25); ctx.lineWidth = 1; ctx.strokeRect(22, 22, CARD_W - 44, CARD_H - 44);

  // header band
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = hexA(accent, 0.85);
  ctx.font = "16px 'Orbitron', sans-serif";
  ctx.fillText('LANTERN SEVEN · MISSION DOSSIER', 48, 64);
  ctx.fillStyle = oc.color;
  ctx.font = "700 60px 'Orbitron', sans-serif";
  ctx.shadowColor = oc.color; ctx.shadowBlur = 24;
  ctx.fillText(oc.word, 46, 124);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#eaf2ff';
  ctx.font = "700 30px 'Orbitron', sans-serif";
  ctx.fillText(input.callsign.toUpperCase(), 48, 168);
  ctx.fillStyle = '#9fb2dd';
  ctx.font = "18px 'Orbitron', sans-serif";
  const tags = `${input.mapName} · ${input.diffName}${input.daily ? ' · DAILY' : input.freeplay ? ' · FREEPLAY' : ''}`;
  ctx.fillText(tags, 48, 196);

  // stat strip
  const stats = [
    { g: '◈', label: 'WAVE', v: `${input.wave}` },
    { g: '☠', label: 'HULLS', v: input.kills.toLocaleString() },
    { g: '⌬', label: 'CREDITS', v: Math.round(input.cashEarned).toLocaleString() },
    { g: '⬢', label: 'CORES', v: `${input.coresLeft}` },
    { g: '⏱', label: 'TIME', v: fmtDur(input.durationS) },
  ];
  const sxStart = 48; const sy = 238;
  // keep the strip clear of the BATTLE MAP panel (x=700); compress the gaps if huge
  // (7-digit) numbers would otherwise overrun into it
  const avail = 700 - sxStart - 12;
  ctx.font = "700 30px 'Orbitron', sans-serif";
  const advances = stats.map((st) => Math.max(ctx.measureText(st.v).width + 36, 104));
  const total = advances.reduce((a, b) => a + b, 0);
  const k = total > avail ? avail / total : 1;
  let sx = sxStart;
  for (let i = 0; i < stats.length; i++) {
    const st = stats[i];
    ctx.fillStyle = '#eaf2ff'; ctx.font = "700 30px 'Orbitron', sans-serif";
    ctx.fillText(st.v, sx, sy + 26);
    ctx.fillStyle = '#7f93c2'; ctx.font = "12px 'Orbitron', sans-serif";
    ctx.fillText(st.label, sx, sy - 6);
    sx += advances[i] * k;
  }

  // top-3 carrying towers — full-width bars (the map now lives top-right)
  ctx.fillStyle = '#9fb2dd'; ctx.font = "14px 'Orbitron', sans-serif";
  ctx.fillText('TOP INSTRUMENTS', 48, 344);
  let ty = 364;
  const rowW = CARD_W - 48;
  if (input.topTowers.length === 0) {
    ctx.fillStyle = '#566089'; ctx.font = "16px sans-serif";
    ctx.fillText('No shots fired.', 60, ty + 30);
  }
  for (const tw of input.topTowers) {
    // icon
    ctx.save();
    ctx.translate(76, ty + 30);
    ctx.scale(0.62, 0.62);
    try { drawTowerBody(ctx, { x: 0, y: 0 }, TOWER_MAP[tw.id], -Math.PI / 2, tw.tierA, tw.tierB, 1, 0, 0, 0); } catch { /* sprite warmup edge */ }
    ctx.restore();
    // name + bar
    ctx.fillStyle = tw.glow; ctx.font = "700 20px 'Orbitron', sans-serif";
    ctx.fillText(tw.name, 116, ty + 22);
    const barX = 116, barY = ty + 34, barW = rowW - 116, barH = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, barX, barY, barW, barH, 6); ctx.fill();
    ctx.fillStyle = tw.color;
    roundRect(ctx, barX, barY, Math.max(8, barW * tw.pct), barH, 6); ctx.fill();
    ctx.fillStyle = '#cfe0ff'; ctx.font = "13px 'Orbitron', sans-serif";
    ctx.fillText(`${Math.round(tw.damage).toLocaleString()} dmg`, barX, barY + 30);
    ty += 72;
  }

  // footer — single line, clear of the border (brand left; watch-URL or tagline right)
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = hexA(accent, 0.95); ctx.font = "700 18px 'Orbitron', sans-serif";
  ctx.fillText('NEON VECTOR DEFENSE', 48, CARD_H - 30);
  ctx.textAlign = 'right';
  if (input.runId) {
    // stamp the deep-link so the image alone routes viewers back to the replay
    const url = dossierShareUrl(input.runId).replace(/^https?:\/\//, '');
    ctx.fillStyle = hexA(accent, 0.9); ctx.font = "15px 'Orbitron', sans-serif";
    ctx.fillText(`▶ WATCH  ${url}`, CARD_W - 48, CARD_H - 30);
  } else {
    ctx.fillStyle = '#8295bd'; ctx.font = "15px system-ui, -apple-system, sans-serif";
    ctx.fillText('Hold the last lighthouse.', CARD_W - 48, CARD_H - 30);
  }
  ctx.textAlign = 'left';

  return cv;
}

function drawMiniLane(ctx: CanvasRenderingContext2D, input: DossierInput, th: { path: string; pathEdge: string }, panel: { x: number; y: number; w: number; h: number }) {
  const map = ALL_MAPS.find((m) => m.id === input.mapId);
  ctx.save();
  // panel backing
  ctx.fillStyle = 'rgba(2,6,16,0.55)';
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(75,207,250,0.3)'; ctx.lineWidth = 1; ctx.stroke();
  if (!map) { ctx.restore(); return; }
  // fit 1280×720 board into the panel (with padding)
  const pad = 14;
  const aw = panel.w - pad * 2, ah = panel.h - pad * 2;
  const scale = Math.min(aw / 1280, ah / 720);
  const ox = panel.x + pad + (aw - 1280 * scale) / 2;
  const oy = panel.y + pad + (ah - 720 * scale) / 2;
  const tx = (x: number) => ox + x * scale;
  const tyc = (y: number) => oy + y * scale;
  // blockers
  ctx.fillStyle = 'rgba(90,110,170,0.18)';
  for (const b of map.blockers) { ctx.beginPath(); ctx.arc(tx(b.x), tyc(b.y), b.r * scale, 0, Math.PI * 2); ctx.fill(); }
  // path
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = th.pathEdge; ctx.lineWidth = Math.max(3, map.pathWidth * scale);
  tracePath(ctx, map.path, tx, tyc); ctx.stroke();
  ctx.strokeStyle = th.path; ctx.lineWidth = Math.max(1.5, (map.pathWidth - 10) * scale);
  tracePath(ctx, map.path, tx, tyc); ctx.stroke();
  // tower dots
  for (const p of input.placements) {
    ctx.fillStyle = p.def.glow;
    ctx.beginPath(); ctx.arc(tx(p.x), tyc(p.y), Math.max(2.5, 7 * scale), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function tracePath(ctx: CanvasRenderingContext2D, path: { x: number; y: number }[], tx: (n: number) => number, ty: (n: number) => number) {
  ctx.beginPath();
  path.forEach((p, i) => { const X = tx(p.x), Y = ty(p.y); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export async function dossierBlob(input: DossierInput): Promise<Blob | null> {
  const cv = await renderDossierCanvas(input);
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}

export function dossierShareUrl(runId: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://neon-vector-defense-7.web.app';
  return `${origin}/?run=${runId}`;
}
