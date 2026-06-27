// Balance canary: overlay the bot model's per-wave cores curve against the LIVE player
// median (from runs/{runId} snapshots) per {map,diff}, and flag waves where reality
// diverges from the model. Pure compute — no React/Firebase — so it's unit-testable.

import type { GhostCurve, GhostPoint } from './ghostCurve';
import type { RunSnapshotRow } from './leaderboard';

export interface LiveWavePoint { wave: number; coresMedian: number; coreFraction: number; n: number; }
export interface CanaryDivergence { wave: number; model: number; live: number; delta: number; n: number; severity: 'soft' | 'hard'; }
export interface CanarySeries {
  map: string; diff: string; startingLives: number; runs: number;
  model: GhostPoint[];          // model coreFraction per wave (from the ghost curve)
  live: LiveWavePoint[];        // live median coreFraction per wave
  divergences: CanaryDivergence[];
}

const MIN_N = 5;            // ignore waves with too few live samples (noisy median)
const SOFT = 0.12, HARD = 0.25; // |liveFraction − modelFraction| thresholds

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function modelFractionAt(model: GhostPoint[], wave: number): number | null {
  let best: GhostPoint | null = null;
  for (const p of model) { if (p.wave <= wave) best = p; else break; }
  return best ? best.coreFraction : null;
}

export function computeCanary(rows: RunSnapshotRow[], ghost: GhostCurve, opts?: { softPct?: number; hardPct?: number; minN?: number }): CanarySeries {
  const soft = opts?.softPct ?? SOFT, hard = opts?.hardPct ?? HARD, minN = opts?.minN ?? MIN_N;
  const startingLives = ghost.startingLives;
  const relevant = rows.filter((r) => r.map === ghost.map && r.diff === ghost.diff);

  // bucket live cores by wave across all runs
  const byWave = new Map<number, number[]>();
  for (const r of relevant) {
    for (const s of r.snapshots) {
      if (s.wave == null) continue;
      const arr = byWave.get(s.wave) ?? [];
      arr.push(s.lives);
      byWave.set(s.wave, arr);
    }
  }
  const live: LiveWavePoint[] = [...byWave.entries()]
    .map(([wave, lives]) => {
      const coresMedian = median(lives);
      return { wave, coresMedian, coreFraction: startingLives ? coresMedian / startingLives : 0, n: lives.length };
    })
    .sort((a, b) => a.wave - b.wave);

  const model = ghost.points;
  const divergences: CanaryDivergence[] = [];
  for (const lp of live) {
    if (lp.n < minN) continue;
    const mf = modelFractionAt(model, lp.wave);
    if (mf == null) continue;
    const delta = lp.coreFraction - mf;
    const abs = Math.abs(delta);
    if (abs < soft) continue;
    divergences.push({ wave: lp.wave, model: mf, live: lp.coreFraction, delta, n: lp.n, severity: abs >= hard ? 'hard' : 'soft' });
  }
  divergences.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { map: ghost.map, diff: ghost.diff, startingLives, runs: relevant.length, model, live, divergences };
}
