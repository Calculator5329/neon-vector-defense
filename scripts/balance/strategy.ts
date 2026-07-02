// Strategy-matrix sims: constrain the bot to a single playstyle and see which
// strategies dominate, which towers can solo-carry, and which are never worth
// building. All strategies share the same cadence/diligence so the ONLY variable
// is the tower selection — an apples-to-apples comparison.

import { TOWERS } from '../../src/game/towers';
import type { Profile, PlanStep } from '../../src/game/bot';
import { runInstrumented } from './run';
import type { GameMap, DifficultyDef } from '../../src/game/types';

/** A repeating build order that places one tower kind, pushed to a tier target. */
function spamProfile(towerId: string, a: number, b: number): Profile {
  const step: PlanStep = { tower: towerId, a, b };
  return {
    actInterval: 0.5,
    plan: Array.from({ length: 24 }, () => ({ ...step })),
    filler: { ...step },
    upgradeDiligence: 1.0,
    abilityChance: 1.0,
    reserve: 1.0,
  };
}

/** A profile that cycles through a list of towers, each to a tier target. */
function mixProfile(steps: PlanStep[], filler: PlanStep): Profile {
  return {
    actInterval: 0.5,
    plan: steps,
    filler,
    upgradeDiligence: 1.0,
    abilityChance: 1.0,
    reserve: 1.0,
  };
}

function rep(steps: PlanStep[], times: number): PlanStep[] {
  const out: PlanStep[] = [];
  for (let i = 0; i < times; i++) for (const s of steps) out.push({ ...s });
  return out;
}

export interface NamedStrategy { name: string; desc: string; profile: Profile }

/** The constrained strategies we pit against each other. */
export function strategies(): NamedStrategy[] {
  return [
    {
      name: 'kinetic-only', desc: 'Pulse + Railgun — kinetic damage, helpless vs Aegis armor',
      profile: mixProfile(
        rep([{ tower: 'pulse', a: 4, b: 2 }, { tower: 'rail', a: 4, b: 0 }], 6),
        { tower: 'pulse', a: 4, b: 2 }),
    },
    {
      name: 'energy-only', desc: 'Tesla + Drone + Prism — pure energy, ignores armor',
      profile: mixProfile(
        rep([{ tower: 'tesla', a: 4, b: 0 }, { tower: 'drone', a: 4, b: 0 }, { tower: 'prismarr', a: 4, b: 2 }], 5),
        { tower: 'tesla', a: 4, b: 0 }),
    },
    { name: 'pulse-spam', desc: 'Only Pulse Turrets, maxed', profile: spamProfile('pulse', 6, 4) },
    { name: 'tesla-spam', desc: 'Only Tesla Coils, maxed', profile: spamProfile('tesla', 6, 0) },
    { name: 'rail-spam', desc: 'Only Railguns, maxed', profile: spamProfile('rail', 6, 0) },
    { name: 'cheap-rush', desc: 'Wall of cheap low-tier Pulse + Tesla, no commits',
      profile: mixProfile(rep([{ tower: 'pulse', a: 2, b: 1 }, { tower: 'tesla', a: 2, b: 0 }], 8),
        { tower: 'pulse', a: 1, b: 0 }) },
    {
      name: 'one-of-each', desc: 'One of every tower, mid-tier — diversity over focus',
      profile: mixProfile(
        TOWERS.map((t) => ({ tower: t.id, a: 4, b: 0 })),
        { tower: 'pulse', a: 4, b: 2 }),
    },
    {
      name: 'few-max-tier', desc: 'A handful of fully-committed end-game towers',
      profile: mixProfile(
        [{ tower: 'prismarr', a: 6, b: 4 }, { tower: 'watchfire', a: 6, b: 0 },
         { tower: 'tesla', a: 6, b: 0 }, { tower: 'rail', a: 6, b: 0 },
         { tower: 'requiem', a: 6, b: 0 }, { tower: 'gauss', a: 6, b: 0 }],
        { tower: 'prismarr', a: 6, b: 4 }),
    },
    {
      name: 'many-cheap', desc: 'Many low-cost towers, lightly upgraded',
      profile: mixProfile(
        rep([{ tower: 'pulse', a: 3, b: 1 }, { tower: 'tesla', a: 3, b: 0 }, { tower: 'cryo', a: 2, b: 0 }], 6),
        { tower: 'pulse', a: 2, b: 0 }),
    },
    {
      name: 'support-meta', desc: 'EMP-buffed core of Prism + Tesla',
      profile: mixProfile(
        rep([{ tower: 'emp', a: 4, b: 0 }, { tower: 'prismarr', a: 4, b: 2 }, { tower: 'tesla', a: 4, b: 0 }], 5),
        { tower: 'tesla', a: 4, b: 0 }),
    },
  ];
}

export interface StrategyResult {
  name: string;
  desc: string;
  map: string;
  diff: string;
  avgWave: number;
  bestWave: number;
  winRate: number;
  avgLives: number;
}

export function runStrategies(map: GameMap, diff: DifficultyDef, seeds: number): StrategyResult[] {
  const out: StrategyResult[] = [];
  for (const strat of strategies()) {
    let waveSum = 0, best = 0, wins = 0, lives = 0;
    for (let s = 0; s < seeds; s++) {
      const r = runInstrumented(map, diff, strat.profile, `strat-${strat.name}-${s}`);
      waveSum += r.finalWave;
      best = Math.max(best, r.finalWave);
      if (r.won) wins++;
      lives += r.livesLeft;
    }
    out.push({
      name: strat.name, desc: strat.desc, map: map.id, diff: diff.id,
      avgWave: Math.round((waveSum / seeds) * 10) / 10,
      bestWave: best,
      winRate: Math.round((wins / seeds) * 100) / 100,
      avgLives: Math.round(lives / seeds),
    });
  }
  return out.sort((a, b) => b.avgWave - a.avgWave);
}

export interface SoloResult {
  id: string;
  name: string;
  cost: number;
  avgWave: number;
  bestWave: number;
  winRate: number;
}

/** Spam each tower alone (maxed on its stronger track) — reveals solo carry power. */
export function runSoloViability(map: GameMap, diff: DifficultyDef, seeds: number): SoloResult[] {
  const out: SoloResult[] = [];
  for (const def of TOWERS) {
    // support towers can't solo (no damage); still report to expose that
    const profile = spamProfile(def.id, 6, 0);
    let waveSum = 0, best = 0, wins = 0;
    for (let s = 0; s < seeds; s++) {
      const r = runInstrumented(map, diff, profile, `solo-${s}`);
      waveSum += r.finalWave;
      best = Math.max(best, r.finalWave);
      if (r.won) wins++;
    }
    out.push({
      id: def.id, name: def.name, cost: def.cost,
      avgWave: Math.round((waveSum / seeds) * 10) / 10,
      bestWave: best,
      winRate: Math.round((wins / seeds) * 100) / 100,
    });
  }
  return out.sort((a, b) => b.avgWave - a.avgWave);
}
