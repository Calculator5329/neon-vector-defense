import { useEffect, useRef } from 'react';
import { drawEnemyPortrait } from './game/render';
import type { EnemyDef } from './game/types';

export default function EnemyPortrait({
  def,
  className = '',
  unknown = false,
}: {
  def: EnemyDef;
  className?: string;
  unknown?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(48, Math.round(Math.min(rect.width || 96, rect.height || 96)));

    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawCanvas = document.createElement('canvas');
    drawCanvas.width = size;
    drawCanvas.height = size;
    const drawCtx = drawCanvas.getContext('2d');
    if (!drawCtx) return;

    let raf = 0;
    const draw = (ts: number) => {
      drawEnemyPortrait(drawCtx, def, { time: ts / 1000, corrupted: def.id === 'umbra', unknown });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(drawCanvas, 0, 0, size, size);
      raf = window.requestAnimationFrame(draw);
    };
    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, [def, unknown]);

  return <canvas ref={canvasRef} className={`enemy-portrait-canvas ${className}`} aria-hidden="true" />;
}
