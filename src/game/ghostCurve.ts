// Bot-rival "ghost" curves: the matched-difficulty bot's per-wave cores pace, derived
// from the offline balance report. Pure + dependency-light (only DIFFICULTIES) so it
// bundles into the player path and is unit-testable. The player HUD races this curve;
// the run-end badge awards "out-warding the AI".

import { DIFFICULTIES } from './maps';

export interface GhostPoint {
  wave: number;
  cores: number;
  coreFraction: number;
  leakPct: number;
  pressure?: number;
  creditsStart?: number;
  towersStart?: number;
}
export interface GhostCurve {
  map: string; diff: string; skill: string;
  startingLives: number; avgFinalWave: number; winRate: number;
  points: GhostPoint[]; // sorted ascending by wave
}

// Lite subset of a report Curve (what the generated asset carries).
export interface CurvePointLite {
  wave: number;
  coreFraction: number;
  leakPct?: number;
  pressure?: number;
  creditsStart?: number;
  towersStart?: number;
}
export interface WaveCurveLite {
  map: string; diff: string; skill: string;
  winRate: number; avgFinalWave: number; points: CurvePointLite[];
}

function startingLivesFor(diffId: string): number {
  return DIFFICULTIES.find((d) => d.id === diffId)?.lives ?? 100;
}

/** Convert report curves (coreFraction = livesEnd/startingLives, post-wave) into absolute-cores ghosts. */
export function buildGhostCurves(curves: WaveCurveLite[]): GhostCurve[] {
  return curves.map((c) => {
    const startingLives = startingLivesFor(c.diff);
    const points: GhostPoint[] = (c.points ?? [])
      .map((p) => ({
        wave: p.wave,
        coreFraction: p.coreFraction,
        cores: Math.round(p.coreFraction * startingLives),
        leakPct: p.leakPct ?? 0,
        pressure: p.pressure,
        creditsStart: p.creditsStart,
        towersStart: p.towersStart,
      }))
      .sort((a, b) => a.wave - b.wave);
    return { map: c.map, diff: c.diff, skill: c.skill, startingLives, avgFinalWave: c.avgFinalWave, winRate: c.winRate, points };
  });
}

export function ghostCurveFor(curves: GhostCurve[], mapId: string, diffId: string): GhostCurve | null {
  return curves.find((c) => c.map === mapId && c.diff === diffId) ?? null;
}

export function ghostCurvesForMap(curves: GhostCurve[], mapId: string): GhostCurve[] {
  const order = new Map(DIFFICULTIES.map((d, i) => [d.id, i]));
  const skillOrder = new Map([['rookie', 0], ['standard', 1], ['expert', 2]]);
  return curves
    .filter((c) => c.map === mapId)
    .sort((a, b) => (order.get(a.diff) ?? 99) - (order.get(b.diff) ?? 99) || (skillOrder.get(a.skill) ?? 99) - (skillOrder.get(b.skill) ?? 99) || a.skill.localeCompare(b.skill));
}

/** Ghost point at an exact wave, else the nearest prior wave (the curve is post-wave keyframes). */
export function ghostAtWave(curve: GhostCurve, wave: number): GhostPoint | null {
  if (wave <= 0) {
    return { wave: 0, cores: curve.startingLives, coreFraction: 1, leakPct: 0 };
  }
  let best: GhostPoint | null = null;
  for (const p of curve.points) {
    if (p.wave <= wave) best = p;
    else break;
  }
  return best ?? curve.points[0] ?? null;
}

export interface GhostVerdict { beatCores: boolean; beatWave: boolean; deltaCores: number; deltaWave: number; refCores: number; refWave: number; }

/** Compare a finished run against the bot ghost. "Out-warded" = strictly beating its pace. */
export function judgeRun(curve: GhostCurve, finalWave: number, coresLeft: number): GhostVerdict {
  const refWave = curve.avgFinalWave;
  const ref = ghostAtWave(curve, finalWave);
  const refCores = ref?.cores ?? curve.startingLives;
  return {
    beatWave: finalWave > refWave,
    beatCores: coresLeft > refCores,
    deltaWave: Math.round(finalWave - refWave),
    deltaCores: Math.round(coresLeft - refCores),
    refCores, refWave: Math.round(refWave),
  };
}
