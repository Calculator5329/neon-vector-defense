import type { Vec } from './types';

export const BONUS_ROUND_SECONDS = 15;
export const BONUS_SALVAGE_PER_HIT = 5;
export const BONUS_TARGET_RADIUS = 30;

export interface BonusTarget extends Vec { id: number; }

export interface BonusRoundState {
  wave: number;
  remaining: number;
  targets: BonusTarget[];
  hits: number;
}

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A separate run-seed/wave substream keeps the mini-game independent of combat RNG consumption. */
export function bonusTargets(runSeed: number, wave: number): BonusTarget[] {
  const rng = mulberry((runSeed ^ Math.imul(wave >>> 0, 0x9e3779b1) ^ 0x424f4e55) >>> 0);
  return Array.from({ length: 8 }, (_, id) => ({
    id,
    x: Math.round(150 + rng() * 980),
    y: Math.round(115 + rng() * 450),
  }));
}
