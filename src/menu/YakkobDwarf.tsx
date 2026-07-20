import { useEffect, useRef, useState } from 'react';
import { sfx } from '../game/sound';

// The unlock ritual for THE YAKKOB: a pixelated dwarf digs a hole in the corner of the
// main menu. He arrives with a medieval lute fanfare and a pulsing "!" to pull the eye.
// Click him and the vault opens — THE YAKKOB takes the Weekly Mutation's slot in the dock.
//
// Everything is drawn procedurally on a low-res canvas (imageSmoothing off → chunky pixels),
// so there is no sprite asset to ship. Parent unmounts this once meta.yakkobUnlocked is true.

const W = 132;         // backing-store width (kept small; CSS scales it up → crisp pixels)
const H = 116;
const U = 4;           // pixel unit — every shape snaps to this grid for the blocky look
const GROUND_Y = 84;   // top of the dirt

// palette
const C = {
  sky: 'transparent',
  dirt: '#5b3a24',
  dirtDark: '#3e2716',
  hole: '#241407',
  helmet: '#c0392b',
  helmetHi: '#e05a4b',
  skin: '#f0b27a',
  nose: '#d98c53',
  beard: '#ecf0f1',
  beardSh: '#c3ccce',
  tunic: '#3f7bbf',
  tunicSh: '#2c5a91',
  belt: '#4e342e',
  boots: '#2b2b2b',
  wood: '#8b5a2b',
  metal: '#c9d0d4',
  metalHi: '#eef3f5',
  spark: '#ffd54a',
};

// snap-to-grid filled block
function blk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x / U) * U, Math.round(y / U) * U, Math.max(U, Math.round(w / U) * U), Math.max(U, Math.round(h / U) * U));
}

interface Dirt { x: number; y: number; vx: number; vy: number; life: number; }

export function YakkobDwarf({ onUnlock }: { onUnlock: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unlocking, setUnlocking] = useState(false);
  const arrivedRef = useRef(false);

  // arrival fanfare — once, on mount (audio ctx resumes on the player's first menu click)
  useEffect(() => {
    if (arrivedRef.current) return;
    arrivedRef.current = true;
    try { sfx.yakkobArrival(); } catch { /* audio unavailable — visual still lands */ }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const dirt: Dirt[] = [];
    let raf = 0;
    let t = 0;
    let last = 0;
    let lastStrike = -1;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const spawnDirt = (x: number, y: number) => {
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 - 0.6 + Math.random() * 1.2;
        const sp = 26 + Math.random() * 34;
        dirt.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, life: 0.5 + Math.random() * 0.4 });
      }
    };

    const frame = (now: number) => {
      if (!last) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += reduce ? 0 : dt;

      // dig cycle: ~1.05s. Pick rears back, then chops down into the hole.
      const cycle = 1.05;
      const phase = (t % cycle) / cycle;             // 0..1
      // swing angle: eased up (rear back) then sharp down (strike)
      const swing = phase < 0.55
        ? -1.15 + (phase / 0.55) * 0.2               // rearing back, held high
        : -0.95 + ((phase - 0.55) / 0.45) * 2.05;    // chop down
      const struck = phase >= 0.92;
      const bob = Math.sin(t * 6) * U * 0.4;         // gentle body bob

      // strike moment → dirt burst + a soft earthen thump, once per cycle
      const cycleIdx = Math.floor(t / cycle);
      if (struck && cycleIdx !== lastStrike) {
        lastStrike = cycleIdx;
        spawnDirt(96, GROUND_Y - U);
      }

      ctx.clearRect(0, 0, W, H);

      // --- ground + hole ---
      blk(ctx, 0, GROUND_Y, W, H - GROUND_Y, C.dirt);
      blk(ctx, 0, GROUND_Y, W, U, C.dirtDark);
      // the dug hole to the dwarf's right, with a little mound of tailings on its far lip
      blk(ctx, 84, GROUND_Y - U, 36, U * 5, C.hole);
      blk(ctx, 84, GROUND_Y - U, 36, U, C.dirtDark);
      blk(ctx, 120, GROUND_Y - U * 2, 12, U * 2, C.dirt);

      // --- dwarf (facing right, standing at the hole's left lip) ---
      const bx = 40;                 // body left
      const by = 40 + bob;           // body top
      // boots
      blk(ctx, bx + U, GROUND_Y - U * 2, U * 2, U * 2, C.boots);
      blk(ctx, bx + U * 4, GROUND_Y - U * 2, U * 2, U * 2, C.boots);
      // tunic
      blk(ctx, bx, by + U * 3, U * 7, U * 6, C.tunic);
      blk(ctx, bx, by + U * 3, U * 2, U * 6, C.tunicSh);
      blk(ctx, bx, by + U * 6, U * 7, U, C.belt);
      // head + beard
      blk(ctx, bx + U, by - U * 2, U * 5, U * 4, C.skin);      // face
      blk(ctx, bx + U * 5, by, U, U, C.nose);                  // nose (facing right)
      blk(ctx, bx, by + U * 2, U * 7, U * 3, C.beard);         // beard
      blk(ctx, bx, by + U * 2, U * 7, U, C.beardSh);
      // eye
      blk(ctx, bx + U * 3, by - U, U, U, '#2b2b2b');
      // helmet
      blk(ctx, bx, by - U * 3, U * 7, U * 2, C.helmet);
      blk(ctx, bx, by - U * 3, U * 7, U, C.helmetHi);
      blk(ctx, bx + U * 3, by - U * 4, U, U, C.helmet);        // little crest

      // --- swinging pick (rotates about the shoulder) ---
      const shoulder = { x: bx + U * 6, y: by + U * 4 };
      ctx.save();
      ctx.translate(shoulder.x, shoulder.y);
      ctx.rotate(swing);
      // handle
      ctx.fillStyle = C.wood;
      ctx.fillRect(0, -U, U * 8, U);
      // pick head (a chunky T at the end)
      ctx.fillStyle = C.metal;
      ctx.fillRect(U * 7, -U * 3, U, U * 5);
      ctx.fillStyle = C.metalHi;
      ctx.fillRect(U * 7, -U * 3, U, U);
      ctx.restore();
      // arm to the handle
      blk(ctx, bx + U * 5, by + U * 3, U * 2, U * 2, C.skin);

      // strike spark at the pit
      if (struck) { blk(ctx, 92, GROUND_Y - U * 2, U, U, C.spark); blk(ctx, 100, GROUND_Y - U, U, U, C.spark); }

      // --- flying dirt ---
      for (let i = dirt.length - 1; i >= 0; i--) {
        const d = dirt[i];
        d.life -= dt;
        if (d.life <= 0) { dirt.splice(i, 1); continue; }
        d.vy += 150 * dt;              // gravity
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        blk(ctx, d.x, d.y, U, U, d.life > 0.25 ? C.dirt : C.dirtDark);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClick = () => {
    if (unlocking) return;
    setUnlocking(true);
    try { sfx.yakkobArrival(); } catch { /* non-fatal */ }
    // brief celebratory beat, then hand off to the parent (which stops rendering us)
    setTimeout(() => onUnlock(), 620);
  };

  return (
    <button
      type="button"
      className={`yakkob-dwarf${unlocking ? ' unlocking' : ''}`}
      data-testid="yakkob-dwarf"
      aria-label="Something is digging near the challenge dock. Click to investigate."
      title="…something's digging down there."
      onClick={handleClick}
    >
      <span className="yakkob-dwarf-ping" aria-hidden="true">!</span>
      <canvas ref={canvasRef} width={W} height={H} className="yakkob-dwarf-canvas" />
      <span className="yakkob-dwarf-label">{unlocking ? 'THE YAKKOB SURFACES' : 'dig here?'}</span>
    </button>
  );
}
