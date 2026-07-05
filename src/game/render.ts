import type { DamageType, Enemy, EnemyDef, GameMap, Pickup, Tower, TowerDef, Vec } from './types';
import { Game, W, H } from './engine';
import { BULWARK_RADIUS, ELITE_AFFIX_META } from './eliteAffixes';

// ============================================================
// Sprite caching — all hulls are pre-rendered as crisp vector
// art on offscreen canvases at 3x resolution, then blitted
// with rotation each frame. SVG-quality art, canvas speed.
// ============================================================

const SS = 3; // supersample factor

// ---------- adaptive quality ----------
// When the frame rate sags on a packed late-game board, the main loop flips this
// flag (App.tsx, fps EMA). It drops the cheapest-to-lose per-hull FX and lowers the
// enemy-count threshold for level-of-detail. Render stays correct, just plainer.
let qualityLite = false;
export function setRenderQuality(lite: boolean) { qualityLite = lite; }

// Accessibility: when on, suppress camera shake + the red hurt vignette (motion/flash
// that can trigger vestibular discomfort). Set from the Settings panel.
let reducedMotion = false;
export function setReducedMotion(v: boolean) { reducedMotion = v; }
/** above this many live hulls, per-enemy flourishes (flame, shadow, status ring) are dropped */
const LOD_HULLS = 160;
const LOD_HULLS_LITE = 90;

function makeSprite(size: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size * SS;
  cv.height = size * SS;
  const c = cv.getContext('2d')!;
  c.scale(SS, SS);
  c.translate(size / 2, size / 2);
  draw(c);
  return cv;
}

function blit(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, rot: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const w = sprite.width / SS * scale, h = sprite.height / SS * scale;
  ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// ---------- enemy hull art ----------

const enemySprites = new Map<string, HTMLCanvasElement>();
const hollowSprites = new Map<string, HTMLCanvasElement>();
const eliteSprites = new Map<string, HTMLCanvasElement>();
const DAMAGE_TYPE_COLORS: Record<DamageType, string> = {
  kinetic: '#d8dff0',
  energy: '#4bcffa',
  explosive: '#ff9f43',
  cryo: '#7efff5',
};

function enemySprite(def: EnemyDef): HTMLCanvasElement {
  let s = enemySprites.get(def.id);
  if (s) return s;
  const r = def.radius;
  const size = r * 4 + 24;
  s = makeSprite(size, (c) => {
    c.shadowColor = def.glow;
    c.shadowBlur = def.boss ? 16 : 9;
    c.lineJoin = 'round';
    drawHull(c, def, r);
  });
  enemySprites.set(def.id, s);
  return s;
}

/** Portrait tint, baked once per hull instead of a per-draw ctx.filter
 *  (canvas filters force a full rasterization pass — death at hundreds of hulls). */
function corruptedSprite(def: EnemyDef): HTMLCanvasElement {
  let s = hollowSprites.get(def.id);
  if (s) return s;
  const base = enemySprite(def);
  const cv = document.createElement('canvas');
  cv.width = base.width;
  cv.height = base.height;
  const c = cv.getContext('2d')!;
  c.filter = 'hue-rotate(115deg) saturate(1.35) brightness(1.08)';
  c.drawImage(base, 0, 0);
  hollowSprites.set(def.id, s = cv);
  return s;
}

function eliteSprite(id: keyof typeof ELITE_AFFIX_META, r: number): HTMLCanvasElement {
  const key = `${id}:${Math.round(r)}`;
  let s = eliteSprites.get(key);
  if (s) return s;
  const meta = ELITE_AFFIX_META[id];
  const size = r * 4 + 36;
  s = makeSprite(size, (c) => {
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = meta.glow;
    c.fillStyle = meta.color;
    c.shadowColor = meta.glow;
    c.shadowBlur = 10;
    c.lineWidth = 1.8;
    c.setLineDash(id === 'frenzied' ? [5, 5] : id === 'bulwark' ? [10, 6] : []);
    circle(c, 0, 0, r + 7);
    c.stroke();
    c.setLineDash([]);
    path(c, [[-r * 0.48, -r * 1.28], [-r * 0.18, -r * 1.76], [0, -r * 1.32], [r * 0.18, -r * 1.76], [r * 0.48, -r * 1.28]]);
    c.fill();
    c.stroke();
    if (id === 'splitting') {
      c.fillStyle = withAlphaCss(meta.glow, 0.85);
      path(c, [[-r * 0.92, r * 0.78], [-r * 0.48, r * 0.48], [-r * 0.52, r * 1.0]]);
      c.fill();
      path(c, [[r * 0.92, r * 0.78], [r * 0.48, r * 0.48], [r * 0.52, r * 1.0]]);
      c.fill();
    }
  });
  eliteSprites.set(key, s);
  return s;
}

function drawHull(c: CanvasRenderingContext2D, def: EnemyDef, r: number) {
  const dark = shade(def.color, -0.45);
  const lite = shade(def.color, 0.35);
  c.strokeStyle = def.glow;
  c.lineWidth = 1.2;

  switch (def.shape) {
    case 'tri': { // dart drone: swept delta with fins
      grad(c, def.color, dark, -r, r);
      path(c, [[r * 1.15, 0], [-r * 0.55, -r * 0.95], [-r * 0.25, -r * 0.3], [-r * 0.85, 0], [-r * 0.25, r * 0.3], [-r * 0.55, r * 0.95]]);
      c.fill(); c.stroke();
      // canopy
      c.fillStyle = lite;
      path(c, [[r * 0.7, 0], [r * 0.1, -r * 0.22], [-r * 0.1, 0], [r * 0.1, r * 0.22]]);
      c.fill();
      // wing stripes
      c.strokeStyle = withAlpha('#000000', 0.35);
      line(c, -r * 0.4, -r * 0.65, r * 0.25, -r * 0.18);
      line(c, -r * 0.4, r * 0.65, r * 0.25, r * 0.18);
      break;
    }
    case 'diamond': { // interceptor: arrowhead + twin tail blades
      grad(c, def.color, dark, -r, r);
      path(c, [[r * 1.2, 0], [0, -r * 0.6], [-r * 0.5, -r * 0.25], [-r * 0.5, r * 0.25], [0, r * 0.6]]);
      c.fill(); c.stroke();
      // tail blades
      c.fillStyle = dark;
      path(c, [[-r * 0.35, -r * 0.2], [-r * 1.05, -r * 0.75], [-r * 0.65, -r * 0.05]]);
      c.fill(); c.stroke();
      path(c, [[-r * 0.35, r * 0.2], [-r * 1.05, r * 0.75], [-r * 0.65, r * 0.05]]);
      c.fill(); c.stroke();
      c.fillStyle = lite;
      circle(c, r * 0.45, 0, r * 0.18);
      c.fill();
      break;
    }
    case 'ship': { // blockade runner: sleek fuselage, swept wings, twin engines
      c.fillStyle = dark;
      path(c, [[r * 0.15, -r * 0.25], [-r * 0.4, -r * 1.05], [-r * 0.95, -r * 0.85], [-r * 0.55, -r * 0.15]]);
      c.fill(); c.stroke();
      path(c, [[r * 0.15, r * 0.25], [-r * 0.4, r * 1.05], [-r * 0.95, r * 0.85], [-r * 0.55, r * 0.15]]);
      c.fill(); c.stroke();
      grad(c, def.color, dark, -r, r);
      path(c, [[r * 1.25, 0], [r * 0.45, -r * 0.32], [-r * 0.85, -r * 0.28], [-r * 1.0, 0], [-r * 0.85, r * 0.28], [r * 0.45, r * 0.32]]);
      c.fill(); c.stroke();
      c.fillStyle = lite;
      path(c, [[r * 0.95, 0], [r * 0.4, -r * 0.16], [r * 0.15, 0], [r * 0.4, r * 0.16]]);
      c.fill();
      // engine nozzles
      c.fillStyle = '#1a2238';
      c.fillRect(-r * 1.05, -r * 0.55, r * 0.25, r * 0.32);
      c.fillRect(-r * 1.05, r * 0.23, r * 0.25, r * 0.32);
      break;
    }
    case 'hex': { // armored cell: hex chassis, inner core, vents
      grad(c, def.color, dark, -r, r);
      poly(c, 6, r, Math.PI / 6);
      c.fill(); c.stroke();
      c.fillStyle = dark;
      poly(c, 6, r * 0.62, Math.PI / 6);
      c.fill();
      // vents
      c.strokeStyle = withAlpha(def.glow, 0.55);
      c.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        line(c, Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      }
      // core
      const g = c.createRadialGradient(0, 0, 1, 0, 0, r * 0.42);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, def.glow);
      g.addColorStop(1, withAlpha(def.glow, 0));
      c.fillStyle = g;
      circle(c, 0, 0, r * 0.42);
      c.fill();
      break;
    }
    case 'pent': { // siege frame: heavy pentagon, plating, rivets
      grad(c, def.color, dark, -r, r);
      poly(c, 5, r, -Math.PI / 2);
      c.fill(); c.stroke();
      c.strokeStyle = withAlpha('#000000', 0.4);
      c.lineWidth = 1.4;
      poly(c, 5, r * 0.7, -Math.PI / 2);
      c.stroke();
      // plate seams
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        line(c, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, Math.cos(a) * r, Math.sin(a) * r);
      }
      // rivets
      c.fillStyle = lite;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + Math.PI / 5 + (i * Math.PI * 2) / 5;
        circle(c, Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.08);
        c.fill();
      }
      c.fillStyle = def.glow;
      circle(c, 0, 0, r * 0.22);
      c.fill();
      break;
    }
    case 'capital': { // warship: long hull, prow, bridge, gun blisters
      const L = r * 1.4;
      c.fillStyle = dark; // lower decks
      path(c, [[L * 0.2, -r * 0.78], [-L * 0.75, -r * 0.7], [-L * 0.95, -r * 0.3], [-L * 0.95, r * 0.3], [-L * 0.75, r * 0.7], [L * 0.2, r * 0.78]]);
      c.fill(); c.stroke();
      grad(c, def.color, dark, -L, L); // main hull
      path(c, [[L * 1.05, 0], [L * 0.45, -r * 0.55], [-L * 0.8, -r * 0.48], [-L * 0.6, 0], [-L * 0.8, r * 0.48], [L * 0.45, r * 0.55]]);
      c.fill(); c.stroke();
      // prow blade
      c.fillStyle = shade(def.color, 0.2);
      path(c, [[L * 1.05, 0], [L * 0.5, -r * 0.18], [L * 0.35, 0], [L * 0.5, r * 0.18]]);
      c.fill();
      // bridge
      c.fillStyle = dark;
      c.fillRect(-L * 0.35, -r * 0.22, L * 0.45, r * 0.44);
      c.strokeRect(-L * 0.35, -r * 0.22, L * 0.45, r * 0.44);
      // gun blisters
      c.fillStyle = shade(def.color, -0.2);
      for (const gx of [L * 0.25, -L * 0.05, -L * 0.45]) {
        circle(c, gx, -r * 0.6, r * 0.13); c.fill();
        circle(c, gx, r * 0.6, r * 0.13); c.fill();
      }
      // hull seams
      c.strokeStyle = withAlpha('#000000', 0.35);
      c.lineWidth = 1;
      line(c, L * 0.45, -r * 0.4, -L * 0.7, -r * 0.34);
      line(c, L * 0.45, r * 0.4, -L * 0.7, r * 0.34);
      break;
    }
  }
}

// ---------- small drawing helpers ----------

function path(c: CanvasRenderingContext2D, pts: number[][]) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

function poly(c: CanvasRenderingContext2D, n: number, r: number, rot = 0) {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i * Math.PI * 2) / n;
    if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

function line(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function grad(c: CanvasRenderingContext2D, top: string, bottom: string, y0: number, y1: number) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ============================================================
// Background cache — gradient, nebulae, stars, grid, path and
// structures pre-rendered once per map; only subtle animation
// is drawn live each frame.
// ============================================================

const bgCache = new Map<string, HTMLCanvasElement>();
interface Star { x: number; y: number; r: number; tw: number }
const twinkleCache = new Map<string, Star[]>();

// cached cumulative segment lengths for lane-traffic animation
const laneCache = new Map<string, { cum: number[]; total: number }>();
function lanePos(map: GameMap, dist: number): Vec {
  let lc = laneCache.get(map.id);
  if (!lc) {
    const cum = [0];
    for (let i = 1; i < map.path.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(map.path[i].x - map.path[i - 1].x, map.path[i].y - map.path[i - 1].y));
    }
    lc = { cum, total: cum[cum.length - 1] };
    laneCache.set(map.id, lc);
  }
  const d = ((dist % lc.total) + lc.total) % lc.total;
  for (let i = 1; i < lc.cum.length; i++) {
    if (d <= lc.cum[i]) {
      const t = (d - lc.cum[i - 1]) / Math.max(1e-6, lc.cum[i] - lc.cum[i - 1]);
      const a = map.path[i - 1], b = map.path[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return { ...map.path[map.path.length - 1] };
}

// deterministic pseudo-random so the background is stable per map
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildBackground(map: GameMap): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const th = map.theme;
  const rnd = mulberry(map.id.length * 7919 + map.path.length);

  // deep space gradient
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, th.bg1);
  g.addColorStop(1, th.bg2);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // nebula clouds
  const hues = [th.pathEdge, shade(th.pathEdge, 0.3), '#1b3c8f'];
  for (let i = 0; i < 7; i++) {
    const x = rnd() * W, y = rnd() * H, r = 160 + rnd() * 320;
    const ng = c.createRadialGradient(x, y, 0, x, y, r);
    const col = hues[i % hues.length];
    ng.addColorStop(0, withAlphaCss(col, 0.10 + rnd() * 0.07));
    ng.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = ng;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // distant static stars
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W, y = rnd() * H;
    c.globalAlpha = 0.15 + rnd() * 0.5;
    c.fillStyle = rnd() < 0.15 ? '#ffe9c4' : '#cdd9ff';
    c.beginPath();
    c.arc(x, y, rnd() * 1.3 + 0.2, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;

  // grid
  c.strokeStyle = 'rgba(120,150,255,0.045)';
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= W; x += 64) { c.moveTo(x, 0); c.lineTo(x, H); }
  for (let y = 0; y <= H; y += 64) { c.moveTo(0, y); c.lineTo(W, y); }
  c.stroke();

  // ---- the lane ----
  c.lineJoin = 'round';
  c.lineCap = 'round';

  // wide outer energy glow
  c.strokeStyle = th.pathEdge;
  c.shadowColor = th.pathEdge;
  c.shadowBlur = 26;
  c.globalAlpha = 0.85;
  c.lineWidth = map.pathWidth + 8;
  strokePath(c, map.path);
  c.globalAlpha = 1;

  // road bed
  c.shadowBlur = 0;
  c.strokeStyle = th.path;
  c.lineWidth = map.pathWidth;
  strokePath(c, map.path);

  // inner shading (recessed look)
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = map.pathWidth - 12;
  strokePath(c, map.path);

  // causeway cross-struts: the lane is built, not painted
  c.strokeStyle = 'rgba(0,0,0,0.30)';
  c.lineWidth = 2.5;
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1], b = map.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    const px = Math.cos(ang) * (map.pathWidth / 2 - 7), py = Math.sin(ang) * (map.pathWidth / 2 - 7);
    for (let d = 20; d < len - 10; d += 38) {
      const x = a.x + ((b.x - a.x) * d) / len, y = a.y + ((b.y - a.y) * d) / len;
      c.beginPath();
      c.moveTo(x - px, y - py);
      c.lineTo(x + px, y + py);
      c.stroke();
    }
  }

  // hazard chevrons near exit
  const exit = map.path[map.path.length - 1];
  const preExit = map.path[map.path.length - 2];
  const ang = Math.atan2(exit.y - preExit.y, exit.x - preExit.x);
  c.save();
  c.translate(
    Math.max(30, Math.min(W - 30, exit.x)) - Math.cos(ang) * 50,
    Math.max(30, Math.min(H - 30, exit.y)) - Math.sin(ang) * 50,
  );
  c.rotate(ang);
  c.strokeStyle = 'rgba(255,71,87,0.65)';
  c.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.moveTo(i * 10 - 12, -map.pathWidth * 0.32);
    c.lineTo(i * 10, 0);
    c.lineTo(i * 10 - 12, map.pathWidth * 0.32);
    c.stroke();
  }
  c.restore();

  return cv;
}

function withAlphaCss(col: string, a: number): string {
  if (col.startsWith('#')) return withAlpha(col, a);
  return col.replace('rgb(', 'rgba(').replace(')', `,${a})`);
}

function strokePath(c: CanvasRenderingContext2D, pts: Vec[]) {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.stroke();
}

// ============================================================
// Frame render
// ============================================================

export interface RenderUi {
  hover: Vec | null;
  placing: TowerDef | null;
  canPlaceHere: boolean;
  placingTiers?: { a: number; b: number } | null;
  placingRange?: number;
  placingLabel?: string | null;
  keyboardCursor?: boolean;
  selected: Tower | null;
  /** ability awaiting a target click */
  aimingStrike: boolean;
}

export function render(ctx: CanvasRenderingContext2D, game: Game, ui: RenderUi) {
  let bg = bgCache.get(game.map.id);
  if (!bg) { bg = buildBackground(game.map); bgCache.set(game.map.id, bg); }

  ctx.save();
  // camera shake (suppressed in reduced-motion)
  if (game.shake > 0 && !reducedMotion) {
    const s = game.shake * game.shake * 7;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  ctx.drawImage(bg, 0, 0);
  drawAnimatedLane(ctx, game);
  drawBlockers(ctx, game.map, game.time);
  drawMarkers(ctx, game.map, game.time);

  // support auras
  for (const t of game.towers) {
    if (t.def.style === 'support') {
      ctx.save();
      ctx.globalAlpha = 0.05 + 0.02 * Math.sin(game.time * 2 + t.uid);
      ctx.fillStyle = t.def.glow;
      circle(ctx, t.pos.x, t.pos.y, t.stats.range);
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = t.def.glow;
      ctx.setLineDash([4, 10]);
      ctx.lineDashOffset = -game.time * 16;
      circle(ctx, t.pos.x, t.pos.y, t.stats.range);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // beacon zones (Blackout Reach)
  if (game.map.zones) {
    for (const z of game.map.zones) {
      ctx.save();
      const zg = ctx.createRadialGradient(z.x, z.y, z.r * 0.3, z.x, z.y, z.r);
      zg.addColorStop(0, 'rgba(255,190,80,0.07)');
      zg.addColorStop(1, 'rgba(255,190,80,0)');
      ctx.fillStyle = zg;
      circle(ctx, z.x, z.y, z.r);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,80,0.5)';
      ctx.shadowColor = '#ffbe50';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -game.time * 10;
      circle(ctx, z.x, z.y, z.r);
      ctx.stroke();
      ctx.setLineDash([]);
      // the beacon mast
      ctx.fillStyle = '#ffbe50';
      circle(ctx, z.x, z.y, 3 + Math.sin(game.time * 3) * 1);
      ctx.fill();
      ctx.restore();
    }
  }

  if (ui.selected) drawRange(ctx, ui.selected.pos, ui.selected.stats.range * ui.selected.rangeBuff * game.rangeFactor(ui.selected.pos), ui.selected.def.glow, true);
  if (ui.placing && ui.hover) {
    drawRange(ctx, ui.hover, ui.placingRange ?? ui.placing.base.range, ui.canPlaceHere ? ui.placing.glow : '#ff4757', ui.canPlaceHere);
  }

  // Watchfire sweep beams — rotating lances of light under the hulls
  for (const t of game.towers) {
    if (t.def.style !== 'sweep') continue;
    const range = t.stats.range * t.rangeBuff * game.rangeFactor(t.pos);
    const beams = Math.max(1, t.stats.count);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < beams; k++) {
      const dir = t.angle + (k * Math.PI * 2) / beams;
      ctx.save();
      ctx.translate(t.pos.x, t.pos.y);
      ctx.rotate(dir);
      const g = ctx.createLinearGradient(0, 0, range, 0);
      g.addColorStop(0, withAlphaCss(t.def.glow, 0.5));
      g.addColorStop(1, withAlphaCss(t.def.glow, 0));
      ctx.fillStyle = g;
      const half = Math.tan(0.16) * range;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(range, -half);
      ctx.lineTo(range, half);
      ctx.closePath();
      ctx.fill();
      // bright core line
      ctx.strokeStyle = withAlphaCss('#ffffff', 0.55);
      ctx.lineWidth = 2;
      line(ctx, 0, 0, range, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  for (const t of game.towers) drawTower(ctx, t, game.time, t === ui.selected, game);
  for (const e of game.enemies) drawEnemy(ctx, e, game.time, game.map, game);

  for (const p of game.pickups) drawPickup(ctx, p, game.time);

  // requiem waves
  for (const n of game.novas) {
    const a = 1 - n.r / n.maxR;
    ctx.save();
    ctx.strokeStyle = n.color;
    ctx.shadowColor = n.color;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = 0.25 + a * 0.6;
    ctx.lineWidth = 4 + a * 3;
    circle(ctx, n.pos.x, n.pos.y, n.r);
    ctx.stroke();
    ctx.globalAlpha = (0.25 + a * 0.6) * 0.5;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    circle(ctx, n.pos.x, n.pos.y, n.r - 3);
    ctx.stroke();
    ctx.restore();
  }

  // cinder burn zones
  for (const z of game.burnZones) {
    const a = Math.max(0, z.life / z.maxLife);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12 + a * 0.18;
    const g = ctx.createRadialGradient(z.pos.x, z.pos.y, 0, z.pos.x, z.pos.y, z.radius);
    g.addColorStop(0, withAlphaCss('#ffffff', 0.18));
    g.addColorStop(0.25, withAlphaCss(z.color, 0.34));
    g.addColorStop(1, withAlphaCss(z.color, 0));
    ctx.fillStyle = g;
    circle(ctx, z.pos.x, z.pos.y, z.radius);
    ctx.fill();
    ctx.globalAlpha = 0.25 + a * 0.35;
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -game.time * 18;
    circle(ctx, z.pos.x, z.pos.y, z.radius * (0.88 + 0.08 * Math.sin(game.time * 6 + z.uid)));
    ctx.stroke();
    ctx.restore();
  }

  drawProjectiles(ctx, game);
  drawBeams(ctx, game);
  drawParticles(ctx, game);

  // placement ghost
  if (ui.placing && ui.hover) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    const tiers = ui.placingTiers ?? { a: 0, b: 0 };
    drawTowerBody(ctx, ui.hover, ui.placing, -Math.PI / 2, tiers.a, tiers.b, ui.canPlaceHere ? 1 : 0.35, 0, game.time, 0);
    if (ui.keyboardCursor) {
      ctx.strokeStyle = ui.canPlaceHere ? ui.placing.glow : '#ff4757';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      line(ctx, ui.hover.x - 19, ui.hover.y, ui.hover.x - 7, ui.hover.y);
      line(ctx, ui.hover.x + 7, ui.hover.y, ui.hover.x + 19, ui.hover.y);
      line(ctx, ui.hover.x, ui.hover.y - 19, ui.hover.x, ui.hover.y - 7);
      line(ctx, ui.hover.x, ui.hover.y + 7, ui.hover.x, ui.hover.y + 19);
      circle(ctx, ui.hover.x, ui.hover.y, 5);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (!ui.canPlaceHere) {
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = 3;
      line(ctx, ui.hover.x - 10, ui.hover.y - 10, ui.hover.x + 10, ui.hover.y + 10);
      line(ctx, ui.hover.x + 10, ui.hover.y - 10, ui.hover.x - 10, ui.hover.y + 10);
    }
    if (ui.placingLabel) {
      const label = ui.placingLabel;
      ctx.font = "bold 10px 'Orbitron', sans-serif";
      ctx.textAlign = 'center';
      const w = Math.min(190, ctx.measureText(label).width + 16);
      const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, ui.hover.x));
      const y = Math.max(30, ui.hover.y - 36);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(3, 8, 18, 0.86)';
      ctx.fillRect(x - w / 2, y - 12, w, 22);
      ctx.strokeStyle = ui.canPlaceHere ? ui.placing.glow : '#ff4757';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - w / 2, y - 12, w, 22);
      ctx.fillStyle = ui.canPlaceHere ? '#eaf1ff' : '#ffd7dc';
      ctx.fillText(label, x, y + 3, w - 8);
    }
    ctx.restore();
  }

  // orbital strike reticle
  if (ui.aimingStrike && ui.hover) {
    const h = ui.hover;
    ctx.save();
    ctx.strokeStyle = '#ffd32a';
    ctx.shadowColor = '#ffd32a';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    circle(ctx, h.x, h.y, 95);
    ctx.stroke();
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -game.time * 40;
    circle(ctx, h.x, h.y, 60);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const aa = a + game.time;
      line(ctx, h.x + Math.cos(aa) * 75, h.y + Math.sin(aa) * 75, h.x + Math.cos(aa) * 100, h.y + Math.sin(aa) * 100);
    }
    ctx.restore();
  }

  ctx.restore(); // shake

  // ---- post effects (not shaken) ----

  // chrono field tint
  if (game.chronoTimer > 0) {
    const a = Math.min(0.16, game.chronoTimer * 0.5);
    ctx.fillStyle = `rgba(80,160,255,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
  // overdrive tint
  if (game.overdriveTimer > 0) {
    const a = Math.min(0.08, game.overdriveTimer * 0.3) * (0.7 + 0.3 * Math.sin(game.time * 10));
    ctx.fillStyle = `rgba(255,170,60,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
  // hurt vignette (suppressed in reduced-motion — full-screen red flash)
  if (game.hurtFlash > 0 && !reducedMotion) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, `rgba(255,40,60,${game.hurtFlash * 0.45})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // ambient vignette — constant per resolution, so bake it once and blit
  ctx.drawImage(vignetteSprite(), 0, 0);
  drawBossHud(ctx, game);
}

function drawBossHud(ctx: CanvasRenderingContext2D, game: Game) {
  let boss: Enemy | null = null;
  for (const e of game.enemies) {
    if (e.dead || e.finished || !e.def.boss) continue;
    if (!boss || e.dist > boss.dist) boss = e;
  }
  if (!boss) return;
  const w = 460;
  const h = 32;
  const x = (W - w) / 2;
  const y = 18;
  const hp = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const phase = boss.def.id === 'umbra' ? (boss.umbraPhase ?? 1) : 0;

  ctx.save();
  ctx.fillStyle = 'rgba(2,5,14,0.78)';
  ctx.strokeStyle = boss.def.id === 'umbra' ? 'rgba(179,136,255,0.78)' : 'rgba(255,127,80,0.65)';
  ctx.lineWidth = 1.4;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.font = "700 11px Orbitron, sans-serif";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eef7ff';
  ctx.fillText(boss.def.name, x + 12, y + 10);

  const barX = x + 12;
  const barY = y + 20;
  const barW = w - 24;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(barX, barY, barW, 6);
  ctx.fillStyle = hp > 0.5 ? '#7bed9f' : hp > 0.25 ? '#ffd32a' : '#ff5a6e';
  ctx.fillRect(barX, barY, barW * hp, 6);

  if (phase > 0) {
    const pipW = 32;
    for (let i = 1; i <= 3; i++) {
      const px = x + w - 12 - (4 - i) * (pipW + 6);
      ctx.fillStyle = i <= phase ? (i === 3 ? '#ff5a6e' : '#b388ff') : 'rgba(255,255,255,0.12)';
      ctx.fillRect(px, y + 7, pipW, 6);
    }
  }
  ctx.restore();
}

let vignetteCache: HTMLCanvasElement | null = null;
function vignetteSprite(): HTMLCanvasElement {
  if (vignetteCache) return vignetteCache;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const vg = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,8,0.42)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);
  return (vignetteCache = cv);
}

function drawAnimatedLane(ctx: CanvasRenderingContext2D, game: Game) {
  const th = game.map.theme;
  // corner beacon pylons: pulsing diamonds at every lane turn
  const path = game.map.path;
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    const ph = 0.55 + 0.45 * Math.sin(game.time * 2.2 + i * 1.1);
    ctx.save();
    ctx.globalAlpha = 0.5 * ph;
    ctx.fillStyle = th.pathEdge;
    ctx.shadowColor = th.pathEdge;
    ctx.shadowBlur = 10 * ph;
    const s = 3 + ph * 1.5;
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  // lane traffic: energy packets streaming along the corridor
  ctx.save();
  ctx.fillStyle = th.pathEdge;
  ctx.shadowColor = th.pathEdge;
  ctx.shadowBlur = 7;
  const lc = laneCache.get(game.map.id);
  const total = lc?.total ?? 3000;
  for (let k = 0; k < 10; k++) {
    const p = lanePos(game.map, game.time * 55 + (k * total) / 10);
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(game.time * 3 + k * 2);
    circle(ctx, p.x, p.y, 1.8);
    ctx.fill();
  }
  ctx.restore();

  // occasional shooting star
  const cycle = (game.time % 9) / 9;
  if (cycle < 0.08) {
    const seed = Math.floor(game.time / 9) * 97;
    const sx = ((seed * 13) % W), sy = ((seed * 29) % (H / 2));
    const t = cycle / 0.08;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = '#dfe8ff';
    ctx.shadowColor = '#dfe8ff';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.4;
    line(ctx, sx + t * 180, sy + t * 70, sx + t * 180 - 34, sy + t * 70 - 13);
    ctx.restore();
  }
  // flowing energy center line
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = withAlphaCss(th.pathEdge, 0.7);
  ctx.shadowColor = th.pathEdge;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 26]);
  ctx.lineDashOffset = -game.time * 60;
  strokePath(ctx, game.map.path);
  ctx.setLineDash([]);
  ctx.restore();

  // twinkling overlay stars
  let tws = twinkleCache.get(game.map.id);
  if (!tws) {
    const rnd = mulberry(game.map.path.length * 31);
    tws = Array.from({ length: 50 }, () => ({ x: rnd() * W, y: rnd() * H, r: rnd() * 1.4 + 0.4, tw: rnd() * Math.PI * 2 }));
    twinkleCache.set(game.map.id, tws);
  }
  for (const s of tws) {
    ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(game.time * 1.8 + s.tw));
    ctx.fillStyle = '#dfe8ff';
    circle(ctx, s.x, s.y, s.r);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawReplayMapEffects(ctx: CanvasRenderingContext2D, map: GameMap, time: number) {
  drawAnimatedLane(ctx, { map, time } as Game);
  if (!map.zones) return;
  for (const z of map.zones) {
    ctx.save();
    const zg = ctx.createRadialGradient(z.x, z.y, z.r * 0.3, z.x, z.y, z.r);
    zg.addColorStop(0, 'rgba(255,190,80,0.07)');
    zg.addColorStop(1, 'rgba(255,190,80,0)');
    ctx.fillStyle = zg;
    circle(ctx, z.x, z.y, z.r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,80,0.5)';
    ctx.shadowColor = '#ffbe50';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time * 10;
    circle(ctx, z.x, z.y, z.r);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffbe50';
    circle(ctx, z.x, z.y, 3 + Math.sin(time * 3) * 1);
    ctx.fill();
    ctx.restore();
  }
}

export function drawMarkers(ctx: CanvasRenderingContext2D, map: GameMap, time: number) {
  const a = map.path[0], b = map.path[map.path.length - 1];
  marker(ctx, a, '#2ed573', 'IN', time);
  marker(ctx, b, '#ff4757', 'OUT', time);
}

function marker(ctx: CanvasRenderingContext2D, p: Vec, color: string, label: string, time: number) {
  const x = Math.max(26, Math.min(W - 26, p.x));
  const y = Math.max(26, Math.min(H - 26, p.y));
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  circle(ctx, x, y, 17);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = time * (label === 'IN' ? 14 : -14);
  circle(ctx, x, y, 23);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = 'bold 10px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
  ctx.restore();
}

export function drawBlockers(ctx: CanvasRenderingContext2D, map: GameMap, time: number) {
  for (const b of map.blockers) {
    if (b.r <= 0) continue;
    ctx.save();
    const grd = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, b.r);
    grd.addColorStop(0, map.theme.pathEdge);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55 + 0.15 * Math.sin(time * 2);
    ctx.fillStyle = grd;
    circle(ctx, b.x, b.y, b.r);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = map.theme.pathEdge;
    ctx.lineWidth = 2;
    ctx.shadowColor = map.theme.pathEdge;
    ctx.shadowBlur = 10;
    circle(ctx, b.x, b.y, b.r * 0.55);
    ctx.stroke();
    ctx.translate(b.x, b.y);
    ctx.rotate(time * 0.6);
    for (let i = 0; i < 3; i++) {
      const a0 = (i * Math.PI * 2) / 3;
      line(ctx, Math.cos(a0) * b.r * 0.2, Math.sin(a0) * b.r * 0.2, Math.cos(a0) * b.r * 0.5, Math.sin(a0) * b.r * 0.5);
    }
    ctx.rotate(-time * 1.1);
    ctx.globalAlpha = 0.5;
    poly(ctx, 6, b.r * 0.32, 0);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRange(ctx: CanvasRenderingContext2D, pos: Vec, range: number, color: string, ok: boolean) {
  ctx.save();
  ctx.globalAlpha = ok ? 0.09 : 0.12;
  ctx.fillStyle = color;
  circle(ctx, pos.x, pos.y, Math.min(range, 1500));
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.stroke();
  ctx.restore();
}

// ---------- towers ----------

/** towers whose art differs from their mechanical fire style */
const ART_OVERRIDE: Record<string, string> = { oracle: 'oracle', locust: 'swarm' };

const AIMED_STYLES = ['bolt', 'rail', 'missile', 'beam', 'siphon', 'lure'];

function drawTower(ctx: CanvasRenderingContext2D, t: Tower, time: number, selected: boolean, game: Game) {
  const overdriven = game.overdriveTimer > 0 || game.frenzyTimer > 0;
  // idle scanning sway: turrets that haven't fired recently slowly sweep their arc
  const idle = t.flash <= 0 && t.recoil <= 0 && AIMED_STYLES.includes(t.def.style);
  const angle = idle ? t.angle + Math.sin(time * 0.6 + t.uid) * 0.18 : t.angle;
  drawTowerBody(ctx, t.pos, t.def, angle, t.tierA, t.tierB, 1, t.flash, time, t.recoil, overdriven);
  // veterancy stars on the field
  const rank = Game.rankOf(t);
  if (rank > 0) {
    ctx.save();
    ctx.fillStyle = '#ffd32a';
    ctx.shadowColor = '#ffd32a';
    ctx.shadowBlur = 5;
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★'.repeat(rank), t.pos.x, t.pos.y - 22);
    ctx.restore();
  }
  if (selected) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(t.pos.x, t.pos.y, 23, time * 1.5, time * 1.5 + Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // name tag so the selection is unmistakable even if the sidebar panel is missed
    ctx.save();
    ctx.font = "bold 9px 'Orbitron', sans-serif";
    ctx.textAlign = 'center';
    const label = t.def.name.toUpperCase();
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(5, 8, 18, 0.82)';
    ctx.fillRect(t.pos.x - w / 2 - 5, t.pos.y + 26, w + 10, 13);
    ctx.fillStyle = t.def.glow;
    ctx.fillText(label, t.pos.x, t.pos.y + 35);
    ctx.restore();
  }
}

// The tower base platform (hex plate, under-glow, bolts, ring, powered core) is
// identical every frame — only the head rotates/animates. Drawing it live cost a
// shadowBlur pass + 3-5 gradient allocations PER TOWER PER FRAME, the single biggest
// fixed render cost. Bake it once per visual variant and blit it instead.
const platformCache = new Map<string, HTMLCanvasElement>();
function towerPlatform(def: TowerDef, ascended: boolean, powered: boolean, overdriven: boolean): HTMLCanvasElement {
  const key = `${def.id}|${ascended ? 1 : 0}|${powered ? 1 : 0}|${overdriven ? 1 : 0}`;
  let s = platformCache.get(key);
  if (s) return s;
  s = makeSprite(72, (c) => {
    if (ascended) c.scale(1.18, 1.18);
    // grounding shadow + colored under-glow
    c.save();
    c.globalAlpha = 0.4;
    c.fillStyle = '#000008';
    c.beginPath();
    c.ellipse(0, 6, 18, 8, 0, 0, Math.PI * 2);
    c.fill();
    const ug = c.createRadialGradient(0, 0, 2, 0, 0, 24);
    ug.addColorStop(0, withAlpha(def.glow, 0.22));
    ug.addColorStop(1, withAlpha(def.glow, 0));
    c.globalAlpha = 1;
    c.fillStyle = ug;
    circle(c, 0, 0, 24);
    c.fill();
    c.restore();
    // base platform: dark hex plate + glow ring + bolts
    c.shadowColor = def.glow;
    c.shadowBlur = overdriven ? 16 : 9;
    const bg = c.createLinearGradient(0, -16, 0, 16);
    bg.addColorStop(0, '#1a2440');
    bg.addColorStop(1, '#0a0f20');
    c.fillStyle = bg;
    c.strokeStyle = overdriven ? '#ffb054' : def.color;
    c.lineWidth = 1.8;
    poly(c, 6, 16, Math.PI / 6);
    c.fill();
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = withAlpha(def.color, 0.8);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      circle(c, Math.cos(a) * 12, Math.sin(a) * 12, 1.3);
      c.fill();
    }
    c.strokeStyle = withAlpha(def.glow, 0.4);
    c.lineWidth = 1;
    circle(c, 0, 0, 10.5);
    c.stroke();
    if (powered) {
      const g = c.createRadialGradient(0, 0, 1, 0, 0, 13);
      g.addColorStop(0, withAlpha('#ffd32a', 0.55));
      g.addColorStop(1, 'rgba(255,211,42,0)');
      c.fillStyle = g;
      circle(c, 0, 0, 13);
      c.fill();
    }
  });
  platformCache.set(key, s);
  return s;
}

export function drawTowerBody(
  ctx: CanvasRenderingContext2D, pos: Vec, def: TowerDef,
  angle: number, tierA: number, tierB: number, alpha = 1, flash = 0, time = 0, recoil = 0, overdriven = false,
) {
  const ascended = tierA >= 5 || tierB >= 5; // bonus tiers transform the whole instrument
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pos.x, pos.y);

  // base platform — cached sprite (replaces a per-frame shadowBlur + 3 gradients/tower)
  const powered = tierA + tierB >= 6 || ascended;
  const plat = towerPlatform(def, ascended, powered, overdriven);
  const pdim = plat.width / SS;
  ctx.drawImage(plat, -pdim / 2, -pdim / 2, pdim, pdim);

  // muzzle-fire pulse (the cached plate bakes a fixed glow; add the firing flare live)
  if (flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fg = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
    fg.addColorStop(0, withAlpha(def.glow, Math.min(0.6, flash)));
    fg.addColorStop(1, withAlpha(def.glow, 0));
    ctx.fillStyle = fg;
    circle(ctx, 0, 0, 22);
    ctx.fill();
    ctx.restore();
  }

  if (ascended) {
    ctx.scale(1.18, 1.18); // head inherits the ascended scale (plate baked it)
    // halo crown — animated, stays live
    ctx.save();
    ctx.rotate(time * 0.7);
    ctx.strokeStyle = '#ffd32a';
    ctx.shadowColor = '#ffd32a';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 9]);
    circle(ctx, 0, 0, 21);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      path(ctx, [
        [Math.cos(a) * 21 - 2.4, Math.sin(a) * 21], [Math.cos(a) * 21, Math.sin(a) * 21 - 3.6],
        [Math.cos(a) * 21 + 2.4, Math.sin(a) * 21], [Math.cos(a) * 21, Math.sin(a) * 21 + 3.6],
      ]);
      ctx.fillStyle = '#fff3a0';
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.rotate(angle);
  const rec = -recoil * 3; // barrel kick-back
  const lite = shade(def.color, 0.4);
  const style = ART_OVERRIDE[def.id] ?? def.style;

  switch (style) {
    case 'oracle': { // a lidless lens that watches the lane
      ctx.translate(rec, 0);
      // outer eye
      ctx.fillStyle = '#0a1322';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(2, 0, 12, 7.5, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // iris
      const og = ctx.createRadialGradient(4, 0, 0.5, 4, 0, 5.5);
      og.addColorStop(0, '#ffffff');
      og.addColorStop(0.5, def.glow);
      og.addColorStop(1, shade(def.color, -0.3));
      ctx.fillStyle = og;
      circle(ctx, 4, 0, 5 + (flash > 0 ? 1.2 : 0));
      ctx.fill();
      // pupil slit
      ctx.fillStyle = '#020812';
      ctx.beginPath();
      ctx.ellipse(4, 0, 1.4, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // lashes of fate
      ctx.strokeStyle = withAlpha(def.glow, 0.7);
      ctx.lineWidth = 1.2;
      for (const a of [-0.9, -0.45, 0.45, 0.9]) {
        line(ctx, Math.cos(a) * 13 + 2, Math.sin(a) * 8, Math.cos(a) * 17 + 2, Math.sin(a) * 11);
      }
      break;
    }
    case 'swarm': { // locust reliquary: a humming hive casket
      ctx.rotate(-angle);
      ctx.fillStyle = '#1c2418';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.8;
      poly(ctx, 6, 10, 0);
      ctx.fill(); ctx.stroke();
      // comb cells
      ctx.fillStyle = withAlpha(def.glow, 0.5);
      for (const [cx, cy] of [[-4, -3], [4, -3], [0, 2], [-4, 5], [4, 5]] as const) {
        poly(ctx, 6, 2.6, 0);
        ctx.save(); ctx.translate(cx, cy); poly(ctx, 6, 2.4, 0); ctx.fill(); ctx.restore();
      }
      // orbiting locusts
      ctx.fillStyle = def.glow;
      for (let i = 0; i < 5; i++) {
        const a = time * (2.2 + i * 0.3) + i * 1.7;
        const rr = 13 + Math.sin(time * 5 + i) * 3;
        ctx.fillRect(Math.cos(a) * rr - 1, Math.sin(a) * rr - 1, 2.2, 1.4);
      }
      break;
    }
    case 'nova': { // drowned star: a grieving ember in a mourning ring
      ctx.rotate(-angle);
      // mourning ring
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -time * 6;
      circle(ctx, 0, 0, 12.5);
      ctx.stroke();
      ctx.setLineDash([]);
      // the ember
      const breathe = 6.5 + Math.sin(time * 1.4) * 1.6 + (flash > 0 ? 2.5 : 0);
      const ng = ctx.createRadialGradient(0, 0, 0.5, 0, 0, breathe + 4);
      ng.addColorStop(0, '#ffffff');
      ng.addColorStop(0.35, def.glow);
      ng.addColorStop(0.75, def.color);
      ng.addColorStop(1, withAlpha(def.color, 0));
      ctx.fillStyle = ng;
      circle(ctx, 0, 0, breathe + 4);
      ctx.fill();
      // dark spots: it is still dying
      ctx.fillStyle = withAlpha('#3a0f24', 0.65);
      circle(ctx, 2.2, -1.5, 1.6);
      ctx.fill();
      circle(ctx, -2, 2, 1.1);
      ctx.fill();
      break;
    }
    case 'bolt': { // pulse turret / drone carrier
      ctx.translate(rec, 0);
      // twin rail housing
      ctx.fillStyle = '#222d4d';
      ctx.fillRect(-2, -6.5, 13, 13);
      // barrel(s)
      ctx.fillStyle = def.color;
      if (tierA >= 2 && def.id === 'pulse') {
        ctx.fillRect(4, -4.5, 14, 3.2);
        ctx.fillRect(4, 1.3, 14, 3.2);
      } else {
        ctx.fillRect(4, -2.2, 16, 4.4);
      }
      ctx.fillStyle = lite;
      ctx.fillRect(15, -1.2, 4, 2.4);
      // dome
      const dg = ctx.createRadialGradient(-1, -2, 1, 0, 0, 8);
      dg.addColorStop(0, lite);
      dg.addColorStop(1, shade(def.color, -0.35));
      ctx.fillStyle = dg;
      circle(ctx, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.25);
      ctx.stroke();
      break;
    }
    case 'arc': { // tesla coil
      ctx.rotate(-angle);
      ctx.rotate(time * 1.2);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      const arms = tierA >= 3 ? 8 : 4;
      for (let i = 0; i < arms; i++) {
        ctx.rotate((Math.PI * 2) / arms);
        line(ctx, 0, 0, 11, 0);
        ctx.fillStyle = def.glow;
        circle(ctx, 11.5, 0, 2.4);
        ctx.fill();
      }
      // crackle between tips
      if (flash > 0) {
        ctx.strokeStyle = withAlpha('#ffffff', flash * 5);
        ctx.lineWidth = 1;
        circle(ctx, 0, 0, 11.5);
        ctx.stroke();
      }
      const cg = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 6.5);
      cg.addColorStop(0, '#fff');
      cg.addColorStop(0.5, def.glow);
      cg.addColorStop(1, shade(def.color, -0.3));
      ctx.fillStyle = cg;
      circle(ctx, 0, 0, 6 + Math.sin(time * 5) * 0.7);
      ctx.fill();
      break;
    }
    case 'pulse': { // cryo emitter
      ctx.rotate(-angle);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      // triple condenser ring
      circle(ctx, 0, 0, 8.5);
      ctx.stroke();
      ctx.globalAlpha *= 0.6;
      ctx.setLineDash([3, 4]);
      ctx.lineDashOffset = -time * 10;
      circle(ctx, 0, 0, 11.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = alpha;
      // frost crystals
      ctx.fillStyle = def.glow;
      for (let i = 0; i < 3; i++) {
        const a = time * 0.8 + (i * Math.PI * 2) / 3;
        path(ctx, [
          [Math.cos(a) * 8.5 - 1.6, Math.sin(a) * 8.5], [Math.cos(a) * 8.5, Math.sin(a) * 8.5 - 2.6], [Math.cos(a) * 8.5 + 1.6, Math.sin(a) * 8.5], [Math.cos(a) * 8.5, Math.sin(a) * 8.5 + 2.6],
        ]);
        ctx.fill();
      }
      const ig = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 5);
      ig.addColorStop(0, '#ffffff');
      ig.addColorStop(1, def.glow);
      ctx.fillStyle = ig;
      circle(ctx, 0, 0, 3.5 + Math.sin(time * 3) * 1.1);
      ctx.fill();
      break;
    }
    case 'rail': { // railgun
      ctx.translate(rec * 1.6, 0);
      // rail pair
      ctx.fillStyle = '#2a3354';
      ctx.fillRect(-4, -5.5, 12, 11);
      ctx.fillStyle = def.color;
      ctx.fillRect(-2, -3.2, 27, 2.2);
      ctx.fillRect(-2, 1.0, 27, 2.2);
      // capacitor fins
      ctx.fillStyle = shade(def.color, -0.3);
      for (const fx of [0, 5, 10]) ctx.fillRect(fx, -7, 3, 14);
      // muzzle charge
      ctx.fillStyle = def.glow;
      ctx.shadowColor = def.glow;
      ctx.shadowBlur = flash > 0 ? 14 : 5;
      ctx.fillRect(25, -2.4, 4, 4.8);
      ctx.shadowBlur = 0;
      break;
    }
    case 'missile': { // missile battery
      ctx.translate(rec, 0);
      ctx.fillStyle = '#26304f';
      ctx.fillRect(-8, -9, 17, 18);
      ctx.strokeStyle = withAlpha(def.color, 0.7);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-8, -9, 17, 18);
      // launch tubes (2, or 4 with Twin Launchers)
      const rows = tierA >= 2 ? [-7.5, -2.5, 2.5, 7.5] : [-5, 2];
      for (const ty of rows) {
        ctx.fillStyle = shade(def.color, -0.15);
        ctx.fillRect(-2, ty - 1.9, 13, 3.8);
        ctx.fillStyle = def.glow;
        ctx.fillRect(10, ty - 1, 2, 2);
      }
      // radar dish
      ctx.rotate(time * 2.4);
      ctx.strokeStyle = lite;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 5, -0.9, 0.9);
      ctx.stroke();
      break;
    }
    case 'beam': { // prism array
      ctx.translate(rec, 0);
      // prism crystal
      const pg = ctx.createLinearGradient(-6, -9, 14, 9);
      pg.addColorStop(0, shade(def.color, -0.3));
      pg.addColorStop(0.5, def.color);
      pg.addColorStop(1, lite);
      ctx.fillStyle = pg;
      path(ctx, [[15, 0], [-5, -9.5], [-1.5, 0], [-5, 9.5]]);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      // facet lines
      line(ctx, 15, 0, -1.5, 0);
      line(ctx, -5, -9.5, -1.5, 0);
      line(ctx, -5, 9.5, -1.5, 0);
      // focus core
      const fg = ctx.createRadialGradient(3, 0, 0.5, 3, 0, 4.5);
      fg.addColorStop(0, '#ffffff');
      fg.addColorStop(1, withAlpha('#ffffff', 0));
      ctx.fillStyle = fg;
      circle(ctx, 3, 0, 4.5 + (flash > 0 ? 2 : 0));
      ctx.fill();
      break;
    }
    case 'gravity': { // singularity anchor: caged black hole
      ctx.rotate(-angle);
      // accretion ring (counter-rotating)
      ctx.rotate(-time * 2.2);
      ctx.strokeStyle = def.glow;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate(time * 2.2 + time * 1.1);
      ctx.globalAlpha = alpha * 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 4, Math.PI / 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.rotate(-time * 1.1);
      // the hole itself: black core with bright rim
      const hg = ctx.createRadialGradient(0, 0, 1, 0, 0, 8);
      hg.addColorStop(0, '#000000');
      hg.addColorStop(0.62, '#05010a');
      hg.addColorStop(0.8, def.color);
      hg.addColorStop(1, withAlpha(def.glow, 0));
      ctx.fillStyle = hg;
      circle(ctx, 0, 0, 8);
      ctx.fill();
      // cage pylons
      ctx.strokeStyle = withAlpha(def.color, 0.85);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
        line(ctx, Math.cos(a) * 9, Math.sin(a) * 9, Math.cos(a) * 13.5, Math.sin(a) * 13.5);
      }
      break;
    }
    case 'resonance': { // starlight cantor: tuning-fork bell
      // bell horns
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(2, 0, 9, -Math.PI * 0.72, Math.PI * 0.72);
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = alpha * (0.45 + (flash > 0 ? 0.5 : 0));
      ctx.beginPath();
      ctx.arc(2, 0, 13, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.stroke();
      ctx.globalAlpha = alpha * (0.25 + (flash > 0 ? 0.4 : 0));
      ctx.beginPath();
      ctx.arc(2, 0, 17, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      // resonator crystal
      const rg = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 6);
      rg.addColorStop(0, '#ffffff');
      rg.addColorStop(0.6, def.glow);
      rg.addColorStop(1, def.color);
      ctx.fillStyle = rg;
      path(ctx, [[0, -6.5], [4.5, 0], [0, 6.5], [-4.5, 0]]);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'siphon': { // harmonic siphon: an antiphon intake
      ctx.translate(rec, 0);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      // paired intake vanes
      ctx.beginPath();
      ctx.arc(6, -3.5, 11, Math.PI * 0.58, Math.PI * 1.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(6, 3.5, 11, -Math.PI * 1.12, -Math.PI * 0.58);
      ctx.stroke();
      // return-note rails
      ctx.strokeStyle = withAlpha(def.glow, 0.75);
      ctx.lineWidth = 1.3;
      line(ctx, -8, -7, 14, -2.5);
      line(ctx, -8, 7, 14, 2.5);
      // resonant sink
      const sg = ctx.createRadialGradient(-2, 0, 0.5, -2, 0, 7.5 + (flash > 0 ? 2 : 0));
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(0.42, def.glow);
      sg.addColorStop(1, shade(def.color, -0.35));
      ctx.fillStyle = sg;
      path(ctx, [[-2, -8], [5, 0], [-2, 8], [-9, 0]]);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.45);
      ctx.stroke();
      if (flash > 0) {
        ctx.globalAlpha = alpha * Math.min(1, flash * 6);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        circle(ctx, -2, 0, 13);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      break;
    }
    case 'lure': { // vector lure: false-command signal dish
      ctx.translate(rec, 0);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.8;
      // antenna spine
      line(ctx, -10, 0, 15, 0);
      ctx.fillStyle = shade(def.color, -0.35);
      ctx.fillRect(-10, -4.5, 8, 9);
      // directional dish and reticle emitter
      ctx.beginPath();
      ctx.ellipse(5, 0, 8, 5.5, 0, -Math.PI * 0.62, Math.PI * 0.62);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(def.glow, 0.72);
      circle(ctx, 8, 0, 6 + (flash > 0 ? 1.8 : 0));
      ctx.stroke();
      ctx.fillStyle = def.glow;
      circle(ctx, 8, 0, 2.4);
      ctx.fill();
      // signal prongs
      ctx.strokeStyle = withAlpha('#ffffff', 0.5);
      line(ctx, 15, -5, 20, -8);
      line(ctx, 16, 0, 22, 0);
      line(ctx, 15, 5, 20, 8);
      break;
    }
    case 'sweep': { // watchfire beacon: a rotating lighthouse lens
      ctx.rotate(-angle);
      // outer housing ring
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      circle(ctx, 0, 0, 11);
      ctx.stroke();
      // the rotating lens drum (follows the beam angle)
      ctx.rotate(angle);
      const lg = ctx.createLinearGradient(-7, 0, 7, 0);
      lg.addColorStop(0, shade(def.color, -0.3));
      lg.addColorStop(0.5, '#ffffff');
      lg.addColorStop(1, shade(def.color, -0.3));
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
      // emitter glints at the lens poles
      ctx.fillStyle = def.glow;
      circle(ctx, 8, 0, 2);
      ctx.fill();
      circle(ctx, -8, 0, 2);
      ctx.fill();
      break;
    }
    case 'rift': { // abyss gate: a caged wound in space
      ctx.rotate(-angle);
      ctx.rotate(time * 0.6);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -time * 12;
      circle(ctx, 0, 0, 12.5);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.rotate(-time * 1.8);
      ctx.strokeStyle = withAlpha(def.glow, 0.72);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate(time * 3.1);
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 4, Math.PI / 2.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;

      const pulse = 8 + Math.sin(time * 4) * 1.2 + (flash > 0 ? 3 : 0);
      const rg = ctx.createRadialGradient(0, 0, 0.5, 0, 0, pulse + 9);
      rg.addColorStop(0, '#000000');
      rg.addColorStop(0.42, '#050012');
      rg.addColorStop(0.7, def.color);
      rg.addColorStop(1, withAlpha(def.glow, 0));
      ctx.fillStyle = rg;
      circle(ctx, 0, 0, pulse + 8);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = def.glow;
      ctx.shadowBlur = 10;
      for (let i = 0; i < 5; i++) {
        const a = time * 1.4 + (i * Math.PI * 2) / 5;
        path(ctx, [
          [Math.cos(a) * 15, Math.sin(a) * 15],
          [Math.cos(a + 0.14) * 9, Math.sin(a + 0.14) * 9],
          [Math.cos(a - 0.14) * 9, Math.sin(a - 0.14) * 9],
        ]);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      break;
    }
    case 'support': { // EMP spire
      ctx.rotate(-angle);
      // triple rotating antenna arcs
      ctx.rotate(time);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.arc(0, 0, 9.5, -0.45, 0.95);
        ctx.stroke();
        ctx.fillStyle = def.glow;
        circle(ctx, Math.cos(0.95) * 9.5, Math.sin(0.95) * 9.5, 1.7);
        ctx.fill();
      }
      // pulsing emitter
      const sg = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 6);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(0.55, def.glow);
      sg.addColorStop(1, withAlpha(def.glow, 0));
      ctx.fillStyle = sg;
      circle(ctx, 0, 0, 5 + Math.sin(time * 2.5) * 1.4);
      ctx.fill();
      break;
    }
  }
  // muzzle flash at the barrel while firing
  if (flash > 0.06 && (style === 'bolt' || style === 'rail' || style === 'missile' || style === 'oracle' || style === 'siphon' || style === 'lure')) {
    const fx = style === 'rail' ? 28 : 18;
    const mg = ctx.createRadialGradient(fx, 0, 0.5, fx, 0, 9);
    mg.addColorStop(0, '#ffffff');
    mg.addColorStop(0.4, def.glow);
    mg.addColorStop(1, withAlpha(def.glow, 0));
    ctx.fillStyle = mg;
    circle(ctx, fx, 0, 9);
    ctx.fill();
    // flash streaks
    ctx.strokeStyle = withAlpha('#ffffff', flash * 6);
    ctx.lineWidth = 1.2;
    line(ctx, fx + 4, -3, fx + 11, -5.5);
    line(ctx, fx + 5, 0, fx + 13, 0);
    line(ctx, fx + 4, 3, fx + 11, 5.5);
  }
  ctx.restore();

  // tier pips: track A above track B, bonus tiers gold
  if (tierA > 0 || tierB > 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(pos.x, pos.y + (ascended ? 26 : 22));
    ctx.shadowBlur = 4;
    for (let i = 0; i < tierA; i++) {
      ctx.fillStyle = i >= 4 ? '#ffd32a' : def.glow;
      ctx.shadowColor = def.glow;
      ctx.fillRect(-15 + i * 5.2, -3.6, 3.6, 2.6);
    }
    for (let i = 0; i < tierB; i++) {
      ctx.fillStyle = i >= 4 ? '#ffd32a' : '#ff6ec7';
      ctx.shadowColor = '#ff6ec7';
      ctx.fillRect(-15 + i * 5.2, 0.6, 3.6, 2.6);
    }
    ctx.restore();
  }
}

// ---------- enemies ----------

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, time: number, map: GameMap, game: Game) {
  const { def } = e;
  const next = map.path[Math.min(e.wp, map.path.length - 1)];
  const heading = Math.atan2(next.y - e.pos.y, next.x - e.pos.x);
  const wob = def.boss ? 0 : Math.sin(time * 6 + e.phase) * 1.2;
  // level-of-detail: on a packed board, drop the cheapest-to-lose per-hull flourishes
  const lod = game.enemies.length > (qualityLite ? LOD_HULLS_LITE : LOD_HULLS);

  ctx.save();
  if (e.cloaked) {
    ctx.globalAlpha = 0.34 + 0.08 * Math.sin(time * 7 + e.phase);
  }

  // hover shadow on the lane (dropped at high hull counts)
  if (!lod) {
    ctx.save();
    ctx.globalAlpha = (e.cloaked ? 0.12 : 0.3);
    ctx.fillStyle = '#000008';
    ctx.beginPath();
    ctx.ellipse(e.pos.x, e.pos.y + def.radius * 0.85, def.radius * 0.95, def.radius * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // engine flame behind hull — solid two-layer triangles (dropped at high hull counts)
  if (e.elite?.id === 'bulwark' && !lod) {
    const meta = ELITE_AFFIX_META.bulwark;
    ctx.save();
    ctx.globalAlpha = (e.cloaked ? 0.18 : 0.34) * (0.75 + 0.25 * Math.sin(time * 3 + e.phase));
    ctx.strokeStyle = meta.glow;
    ctx.shadowColor = meta.glow;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time * 24;
    circle(ctx, e.pos.x, e.pos.y, BULWARK_RADIUS);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (def.id === 'umbra' && !lod) {
    ctx.save();
    const phase = e.umbraPhase ?? 1;
    const color = phase === 3 ? '#ff5a6e' : phase === 2 ? '#7d5fff' : '#b388ff';
    ctx.globalAlpha = 0.18 + 0.08 * Math.sin(time * (phase === 3 ? 8 : 3) + e.phase);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = phase === 3 ? 3 : 2;
    ctx.setLineDash(phase === 1 ? [14, 8] : phase === 2 ? [4, 10] : []);
    ctx.lineDashOffset = -time * (phase === 3 ? 42 : 18);
    circle(ctx, e.pos.x, e.pos.y, def.radius + 18 + phase * 5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (e.mirrorResist && !lod) {
    const color = DAMAGE_TYPE_COLORS[e.mirrorResist.type];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.24 + 0.12 * Math.sin(time * 5 + e.phase);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = e.mirrorResist.weakenedTimer > 0 ? 1.5 : 2.6;
    ctx.setLineDash(e.mirrorResist.weakenedTimer > 0 ? [5, 10] : [16, 7]);
    ctx.lineDashOffset = -time * 28;
    circle(ctx, e.pos.x, e.pos.y, def.radius + 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (!lod) {
    const flick = 0.7 + 0.3 * Math.sin(time * 22 + e.phase);
    const fl = def.radius * (def.boss ? 1.5 : 1.05) * flick;
    ctx.save();
    ctx.translate(e.pos.x, e.pos.y + wob * 0.4);
    ctx.rotate(heading);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlphaCss(def.glow, 0.4);
    path(ctx, [
      [-def.radius * 0.85, -def.radius * 0.26],
      [-def.radius * 0.85 - fl, 0],
      [-def.radius * 0.85, def.radius * 0.26],
    ]);
    ctx.fill();
    ctx.fillStyle = withAlphaCss('#ffffff', 0.35);
    path(ctx, [
      [-def.radius * 0.85, -def.radius * 0.12],
      [-def.radius * 0.85 - fl * 0.55, 0],
      [-def.radius * 0.85, def.radius * 0.12],
    ]);
    ctx.fill();
    ctx.restore();
  }

  // hull sprite
  blit(ctx, enemySprite(def), e.pos.x, e.pos.y + wob * 0.4, heading);

  if (e.elite) {
    const meta = ELITE_AFFIX_META[e.elite.id];
    blit(ctx, eliteSprite(e.elite.id, def.radius), e.pos.x, e.pos.y + wob * 0.4, heading);
    if (e.elite.id === 'frenzied' && !lod) {
      ctx.save();
      ctx.translate(e.pos.x, e.pos.y + wob * 0.4);
      ctx.rotate(heading);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = withAlphaCss(meta.glow, 0.55);
      for (let i = 0; i < 3; i++) {
        const x = -def.radius * (1.25 + i * 0.22) - Math.sin(time * 18 + i) * 3;
        path(ctx, [[x, -4], [x - 12, 0], [x, 4]]);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // boss spine lights (animated, on top of sprite)
  if (def.boss) {
    ctx.save();
    ctx.translate(e.pos.x, e.pos.y);
    ctx.rotate(heading);
    const spineColor = e.mirrorResist ? DAMAGE_TYPE_COLORS[e.mirrorResist.type] : def.glow;
    ctx.fillStyle = spineColor;
    ctx.shadowColor = spineColor;
    ctx.shadowBlur = 8;
    for (let i = -1; i <= 1; i++) {
      const on = Math.sin(time * 4 + i * 1.3 + e.phase) > 0;
      ctx.globalAlpha = (e.cloaked ? 0.34 : 1) * (on ? 0.95 : 0.25);
      circle(ctx, i * def.radius * 0.5, 0, 2.8);
      ctx.fill();
    }
    ctx.restore();
  }

  // critical damage: flicker + sparks glow
  const pct = e.hp / e.maxHp;
  if (!lod && pct < 0.35 && Math.sin(time * 30 + e.phase * 3) > 0.4) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#ffae00';
    ctx.globalCompositeOperation = 'lighter';
    circle(ctx, e.pos.x + Math.sin(e.phase) * def.radius * 0.4, e.pos.y + Math.cos(e.phase) * def.radius * 0.3, 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  // seraph repair halo
  if (def.heal) {
    ctx.save();
    ctx.globalAlpha = (e.cloaked ? 0.34 : 1) * (0.18 + 0.08 * Math.sin(time * 3 + e.phase));
    ctx.strokeStyle = def.glow;
    ctx.shadowColor = def.glow;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 9]);
    ctx.lineDashOffset = -time * 20;
    circle(ctx, e.pos.x, e.pos.y, def.heal.radius);
    ctx.stroke();
    ctx.setLineDash([]);
    // rising repair motes
    ctx.globalAlpha = e.cloaked ? 0.3 : 0.8;
    ctx.fillStyle = def.glow;
    for (let i = 0; i < 3; i++) {
      const ph = (time * 0.7 + i / 3 + e.phase) % 1;
      circle(ctx, e.pos.x + Math.sin(e.phase + i * 2.1) * 9, e.pos.y - ph * 22 + 6, 1.6 * (1 - ph));
      ctx.fill();
    }
    ctx.restore();
  }

  // resonance marks: orbiting song-notes
  if (e.resonance > 0) {
    ctx.save();
    ctx.fillStyle = '#fff8c4';
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < e.resonance; i++) {
      const a = time * 2.6 + (i * Math.PI * 2) / e.resonance;
      const rr = def.radius + 8;
      path(ctx, [
        [e.pos.x + Math.cos(a) * rr, e.pos.y + Math.sin(a) * rr - 2.4],
        [e.pos.x + Math.cos(a) * rr + 2.2, e.pos.y + Math.sin(a) * rr],
        [e.pos.x + Math.cos(a) * rr, e.pos.y + Math.sin(a) * rr + 2.4],
        [e.pos.x + Math.cos(a) * rr - 2.2, e.pos.y + Math.sin(a) * rr],
      ]);
      ctx.fill();
    }
    ctx.restore();
  }

  if (e.exposed > 0 && !lod) {
    ctx.save();
    const stacks = Math.max(1, Math.min(5, Math.floor(e.exposed)));
    const pulse = 0.55 + 0.25 * Math.sin(time * 7 + e.phase);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,211,42,${0.24 + pulse * 0.22})`;
    ctx.lineWidth = 1.2;
    circle(ctx, e.pos.x, e.pos.y, def.radius + 7);
    ctx.stroke();
    ctx.fillStyle = '#ffd32a';
    for (let i = 0; i < stacks; i++) {
      const a = -Math.PI / 2 + (i - (stacks - 1) / 2) * 0.36;
      circle(ctx, e.pos.x + Math.cos(a) * (def.radius + 11), e.pos.y + Math.sin(a) * (def.radius + 11), 2.1);
      ctx.fill();
    }
    ctx.restore();
  }

  if ((e.focusMarkTimer ?? 0) > 0) {
    ctx.save();
    const pulse = 0.65 + 0.35 * Math.sin(time * 8 + e.phase);
    const rr = def.radius + 11 + (e.focusMark ?? 1) * 1.5;
    ctx.strokeStyle = `rgba(255,194,240,${0.45 + pulse * 0.35})`;
    ctx.lineWidth = 1.6;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const a = time * 1.4 + i * Math.PI / 2;
      const x = e.pos.x + Math.cos(a) * rr;
      const y = e.pos.y + Math.sin(a) * rr;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, a + Math.PI * 0.4, a + Math.PI * 1.25);
      ctx.stroke();
    }
    ctx.restore();
  }

  // slow ring — only for individually-slowed hulls (a global chrono field is shown
  // by the full-screen tint, so we don't stroke a dashed ring on every hull) and not
  // when the board is packed.
  if (e.slow < 1 && !lod) {
    ctx.save();
    ctx.strokeStyle = '#7efff5';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = time * 8;
    circle(ctx, e.pos.x, e.pos.y, def.radius + 5);
    ctx.stroke();
    ctx.restore();
  }
  if (e.burnTimer > 0) {
    ctx.save();
    ctx.fillStyle = '#ff9f43';
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const fy = e.pos.y - def.radius - 3 + Math.sin(time * 14 + e.phase + i * 2) * 2;
      circle(ctx, e.pos.x + (i - 0.5) * 7, fy, 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // health bar
  if (e.hp < e.maxHp || def.boss || (e.elite?.maxShield ?? 0) > 0) {
    const w = def.boss ? def.radius * 2.4 : 22;
    const hpct = Math.max(0, pct);
    const y = e.pos.y - def.radius - (def.boss ? 14 : 9);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(e.pos.x - w / 2 - 1, y - 1, w + 2, (def.boss ? 5 : 3.5) + 2);
    ctx.fillStyle = hpct > 0.5 ? '#2ed573' : hpct > 0.25 ? '#ffd32a' : '#ff4757';
    ctx.fillRect(e.pos.x - w / 2, y, w * hpct, def.boss ? 5 : 3.5);
    if ((e.elite?.maxShield ?? 0) > 0 && (e.elite?.shield ?? 0) > 0) {
      const sh = Math.max(0, Math.min(1, (e.elite?.shield ?? 0) / (e.elite?.maxShield ?? 1)));
      const sy = y - (def.boss ? 5 : 4);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(e.pos.x - w / 2 - 1, sy - 1, w + 2, 3);
      ctx.fillStyle = '#7efff5';
      ctx.fillRect(e.pos.x - w / 2, sy, w * sh, 1.5);
    }
  }
}

export function drawEnemyPortrait(
  ctx: CanvasRenderingContext2D,
  def: EnemyDef,
  options: { time?: number; corrupted?: boolean; unknown?: boolean } = {},
) {
  const time = options.time ?? 0;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const min = Math.min(w, h);
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(cx, cy, min * 0.06, cx, cy, min * 0.55);
  bg.addColorStop(0, options.unknown ? 'rgba(80,90,120,0.12)' : withAlphaCss(def.glow, 0.18));
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = options.unknown ? 'rgba(120,150,255,0.18)' : withAlphaCss(def.glow, 0.45);
  ctx.lineWidth = Math.max(1, min * 0.018);
  ctx.setLineDash([min * 0.06, min * 0.045]);
  ctx.lineDashOffset = -time * min * 0.08;
  circle(ctx, cx, cy, min * 0.34);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const sprite = options.corrupted ? corruptedSprite(def) : enemySprite(def);
  const spriteCss = Math.max(sprite.width, sprite.height) / SS;
  const scale = Math.max(0.8, (min * (def.boss ? 0.68 : 0.56)) / spriteCss);
  ctx.save();
  if (options.unknown) {
    ctx.globalAlpha = 0.84;
    ctx.filter = 'brightness(0.08) saturate(0)';
  }
  blit(ctx, sprite, cx, cy + Math.sin(time * 2) * min * 0.012, -Math.PI / 9 + Math.sin(time * 0.9) * 0.08, scale);
  ctx.restore();
}

export function drawReplayEnemy(
  ctx: CanvasRenderingContext2D,
  enemy: Enemy,
  time: number,
  map: GameMap,
  diffId: string,
  enemyCount: number,
) {
  drawEnemy(ctx, enemy, time, map, {
    enemies: { length: Math.max(0, enemyCount) } as Enemy[],
    diff: { id: diffId },
  } as Game);
}

// ---------- pickups ----------

const PICKUP_STYLE: Record<Pickup['kind'], { color: string; glyph: string }> = {
  credits: { color: '#ffd32a', glyph: '⌬' },
  frenzy: { color: '#ff9f43', glyph: '⚡' },
  cryoburst: { color: '#7efff5', glyph: '❄' },
  core: { color: '#2ed573', glyph: '⬢' },
};

function drawPickup(ctx: CanvasRenderingContext2D, p: Pickup, time: number) {
  const st = PICKUP_STYLE[p.kind];
  const bob = Math.sin(time * 3 + p.uid) * 3;
  const fade = Math.min(1, p.life / 1.2);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(p.pos.x, p.pos.y + bob);
  // beacon glow
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
  g.addColorStop(0, withAlphaCss(st.color, 0.45));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, 22);
  ctx.fill();
  // hex shell
  ctx.rotate(time * 1.4);
  ctx.strokeStyle = st.color;
  ctx.shadowColor = st.color;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2;
  poly(ctx, 6, 11, 0);
  ctx.stroke();
  ctx.rotate(-time * 1.4);
  // expiry arc
  ctx.beginPath();
  ctx.arc(0, 0, 14, -Math.PI / 2, -Math.PI / 2 + (p.life / p.maxLife) * Math.PI * 2);
  ctx.globalAlpha = fade * 0.6;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.globalAlpha = fade;
  // glyph
  ctx.shadowBlur = 0;
  ctx.fillStyle = st.color;
  ctx.font = 'bold 12px "Segoe UI Symbol", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(st.glyph, 0, 1);
  ctx.restore();
}

// ---------- projectiles / beams / particles ----------

function drawProjectiles(ctx: CanvasRenderingContext2D, game: Game) {
  // additive blending gives the glow; no shadowBlur, no per-projectile gradients
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of game.projectiles) {
    const ang = Math.atan2(p.vel.y, p.vel.x);
    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    ctx.rotate(ang);
    if (p.kind === 'missile') {
      ctx.fillStyle = '#d8dff0';
      path(ctx, [[7, 0], [3, -2.6], [-4, -2.6], [-6, 0], [-4, 2.6], [3, 2.6]]);
      ctx.fill();
      ctx.fillStyle = p.color;
      path(ctx, [[-4, -2.6], [-8, -4.5], [-6, 0], [-8, 4.5], [-4, 2.6], [-6, 0]]);
      ctx.fill();
      ctx.fillStyle = withAlphaCss('#ffb86c', 0.55);
      path(ctx, [[-6, -1.8], [-16, 0], [-6, 1.8]]);
      ctx.fill();
    } else if (p.kind === 'drone') {
      ctx.fillStyle = withAlphaCss(p.color, 0.82);
      path(ctx, [[8, 0], [-4, -4.5], [-1, 0], [-4, 4.5]]);
      ctx.fill();
      ctx.fillStyle = withAlphaCss('#ffffff', 0.72);
      path(ctx, [[5, 0], [0, -1.5], [-7, 0], [0, 1.5]]);
      ctx.fill();
    } else {
      // energy bolt: colored tail + white core
      ctx.fillStyle = withAlphaCss(p.color, 0.7);
      path(ctx, [[7, 0], [1, -2.1], [-14, 0], [1, 2.1]]);
      ctx.fill();
      ctx.fillStyle = withAlphaCss('#ffffff', 0.8);
      path(ctx, [[7, 0], [2, -1], [-5, 0], [2, 1]]);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawBeams(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of game.beams) {
    const a = b.life / b.maxLife;
    // wide soft pass + narrow hot core — additive, no shadowBlur
    ctx.globalAlpha = a * 0.4;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width * (1.4 + a);
    line(ctx, b.from.x, b.from.y, b.to.x, b.to.y);
    ctx.globalAlpha = a;
    ctx.lineWidth = b.width * 0.4;
    ctx.strokeStyle = '#ffffff';
    line(ctx, b.from.x, b.from.y, b.to.x, b.to.y);
  }
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.textAlign = 'center';
  ctx.font = 'bold 10px Rajdhani, sans-serif';
  for (const pt of game.particles) {
    const a = pt.life / pt.maxLife;
    if (pt.kind === 'ring') {
      ctx.globalAlpha = a;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 2.5;
      circle(ctx, pt.pos.x, pt.pos.y, pt.size * (1.45 - a * 0.95));
      ctx.stroke();
      ctx.globalAlpha = a * 0.3;
      ctx.lineWidth = 6;
      circle(ctx, pt.pos.x, pt.pos.y, pt.size * (1.45 - a * 0.95) * 0.92);
      ctx.stroke();
    } else if (pt.kind === 'text') {
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.fillText(pt.text ?? '', pt.pos.x, pt.pos.y);
    } else if (pt.kind === 'smoke') {
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = pt.color;
      circle(ctx, pt.pos.x, pt.pos.y, pt.size * (2.2 - a));
      ctx.fill();
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.pos.x - pt.size / 2, pt.pos.y - pt.size / 2, pt.size, pt.size);
    }
  }
  ctx.restore();
}
