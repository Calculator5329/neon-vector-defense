// Static tower & upgrade cost-efficiency analyzer.
//
// Everything here is computed from the tower + enemy definitions — no simulation.
// The DPS heuristics are style-aware (a Tesla hits `count` hulls per discharge; a
// beam pierces a line; a cryo pulse is pure utility) and deliberately approximate:
// they are meant to surface RELATIVE over/under-valued towers and dead/OP upgrade
// steps, not to predict exact in-game numbers.

import { TOWERS, computeStats } from '../../src/game/towers';
import type { TowerDef, TowerStats, DamageType } from '../../src/game/types';

/** how many hulls a single AoE/multi-target volley realistically lands on */
const AOE_TARGETS = 5;
/** splash blast treated as roughly this many hulls caught */
const SPLASH_TARGETS = 3;

export interface Dps {
  /** sustained single-target dps (the headline "raw DPS") */
  single: number;
  /** potential dps when the lane is packed (multi-target / pierce / splash / aura) */
  aoe: number;
  /** sustained burn dps stacked on top */
  burn: number;
  /** non-damage value this build provides */
  utility: string[];
}

/** Style-aware DPS model. Returns single-target and crowd (aoe) sustained dps. */
export function dpsOf(def: TowerDef, s: TowerStats): Dps {
  const util: string[] = [];
  if (s.slowPower > 0) util.push(`slow ${Math.round(s.slowPower * 100)}%`);
  if (s.detection) util.push('detect');
  if (s.drag > 0) util.push(`drag ${s.drag}`);
  if (s.execute > 0) util.push(`execute<${Math.round(s.execute * 100)}%`);
  if (s.burnZoneDps > 0) util.push(`burn zone ${s.burnZoneDps}/s`);
  if (s.droneSwarm > 0) util.push(`${s.droneSwarm} interceptors`);
  if (s.buffRate > 0) util.push(`+${Math.round(s.buffRate * 100)}% rate aura`);
  if (s.buffRange > 0) util.push(`+${Math.round(s.buffRange * 100)}% range aura`);
  if (s.shred) util.push('armor shred');

  const burn = s.burnDps + s.burnZoneDps; // sustained while applied; fair sustained add for clouds/napalm
  const rate = s.fireRate;
  const dmg = s.damage;
  let single = 0;
  let aoe = 0;

  switch (def.style) {
    case 'bolt': {
      const shots = s.count * Math.max(1, s.droneSwarm);
      const shotDmg = s.droneSwarm > 0 ? dmg * 0.72 : dmg;
      single = shotDmg * rate * shots;
      aoe = single * Math.max(s.pierce, s.splash > 0 ? SPLASH_TARGETS : 1);
      break;
    }
    case 'missile': {
      single = dmg * rate * s.count;
      aoe = single * (s.splash > 0 ? SPLASH_TARGETS : 1);
      break;
    }
    case 'arc': { // tesla: hits `count` hulls per discharge, chains to a few more
      single = dmg * rate;
      aoe = dmg * rate * (s.count + s.chain);
      break;
    }
    case 'beam': { // prism: a line that pierces `pierce` hulls per shot
      single = dmg * rate;
      aoe = dmg * rate * Math.min(s.pierce, AOE_TARGETS * 2);
      break;
    }
    case 'rail': { // hitscan slug, `count` shots each piercing `pierce`
      single = dmg * rate * s.count;
      aoe = single * s.pierce;
      if (s.execute > 0) util.push('finisher');
      break;
    }
    case 'pulse': { // cryo / locust cloud: hits everything in range each pulse
      single = dmg * rate;
      aoe = (dmg * rate + burn) * AOE_TARGETS;
      break;
    }
    case 'gravity': { // anchor: AoE crush + path drag
      single = dmg * rate;
      aoe = dmg * rate * AOE_TARGETS;
      break;
    }
    case 'nova': { // requiem: expanding ring, hits each crossed hull once per fire
      single = dmg * rate;
      aoe = dmg * rate * AOE_TARGETS;
      break;
    }
    case 'resonance': { // cantor: low direct damage, value is the +10%/stack mark
      single = dmg * rate;
      aoe = dmg * rate * s.count;
      util.push(`mark ${s.count}× (+10%/stack dmg taken)`);
      break;
    }
    case 'sweep': { // watchfire: damage IS dps, continuous, `count` beams, no cooldown
      single = dmg; // a target soaks full dps while the beam is on it
      aoe = dmg * Math.max(1, s.count);
      util.push('continuous beam');
      break;
    }
    case 'support': { // emp: no direct damage
      single = 0;
      aoe = 0;
      break;
    }
  }
  return { single, aoe, burn, utility: util };
}

const KINETIC: DamageType = 'kinetic';

/** Effective single-target dps against a hull archetype (0 = can't hurt it). */
export function effectiveVs(def: TowerDef, s: TowerStats, archetype: 'armored' | 'explosiveImmune' | 'cryoImmune' | 'cloaked' | 'boss'): number {
  const base = dpsOf(def, s).single + s.burnDps + s.burnZoneDps;
  switch (archetype) {
    case 'armored': // immune to kinetic unless the round shreds armor
      return s.damageType === KINETIC && !s.shred ? 0 : base;
    case 'explosiveImmune':
      return s.damageType === 'explosive' ? 0 : base;
    case 'cryoImmune':
      return s.damageType === 'cryo' ? 0 : base;
    case 'cloaked': // can't even target it without sensors
      return def.style === 'support' ? 0 : (s.detection ? base : 0);
    case 'boss': // bosses ignore slow/drag/execute; raw damage still lands
      return base;
  }
}

// ---- upgrade cost model (mirrors engine.upgradeCost, costMult = 1) ----

/** Cost to buy a single upgrade step on a track at a given current tier. */
export function stepCost(def: TowerDef, track: 0 | 1, tier: number): number {
  if (tier >= 6) return 0;
  const bonusMult = tier === 4 ? 3.2 : tier === 5 ? 6.5 : 1;
  return Math.round((def.tracks[track].upgrades[tier].cost * bonusMult) / 5) * 5;
}

/** Total credits to reach (tierA, tierB) from scratch: placement + every step. */
export function totalCost(def: TowerDef, tierA: number, tierB: number): number {
  let c = def.cost;
  for (let i = 0; i < tierA; i++) c += stepCost(def, 0, i);
  for (let i = 0; i < tierB; i++) c += stepCost(def, 1, i);
  return c;
}

export interface BuildPoint {
  label: string;
  tierA: number;
  tierB: number;
  cost: number;
  single: number;
  aoe: number;
  burn: number;
  dpsPerCredit: number;   // single / cost
  aoePerCredit: number;   // aoe / cost
  vsArmored: number;
  vsExplosiveImmune: number;
  vsCryoImmune: number;
  vsCloaked: number;
  vsBoss: number;
  utility: string[];
}

function buildPoint(def: TowerDef, label: string, tierA: number, tierB: number): BuildPoint {
  const s = computeStats(def, tierA, tierB);
  const d = dpsOf(def, s);
  const cost = totalCost(def, tierA, tierB);
  return {
    label, tierA, tierB, cost,
    single: round(d.single), aoe: round(d.aoe), burn: round(d.burn),
    dpsPerCredit: round((d.single / cost) * 1000) / 1000,
    aoePerCredit: round((d.aoe / cost) * 1000) / 1000,
    vsArmored: round(effectiveVs(def, s, 'armored')),
    vsExplosiveImmune: round(effectiveVs(def, s, 'explosiveImmune')),
    vsCryoImmune: round(effectiveVs(def, s, 'cryoImmune')),
    vsCloaked: round(effectiveVs(def, s, 'cloaked')),
    vsBoss: round(effectiveVs(def, s, 'boss')),
    utility: d.utility,
  };
}

export interface UpgradeStep {
  track: 0 | 1;
  trackName: string;
  tier: number; // 1..6 (the tier this step grants)
  name: string;
  desc: string;
  cost: number;
  deltaSingle: number; // single-target dps gained
  deltaAoe: number;    // crowd dps gained
  valuePerCredit: number; // max(deltaSingle, deltaAoe*0.5) / cost — utility steps score low
  flag: 'dead' | 'weak' | 'ok' | 'strong' | 'op';
}

export interface TowerEfficiency {
  id: string;
  name: string;
  style: string;
  damageType: DamageType;
  cost: number;
  unlockAt: number;
  builds: BuildPoint[];
  steps: UpgradeStep[];
  /** headline numbers at a representative mid build (track A, tier 4) */
  rawDpsT4: number;
  dpsPerCreditT4: number;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** True if any field of the stat block changed between two builds. */
function statsDiffer(a: TowerStats, b: TowerStats): boolean {
  const keys = Object.keys(a) as (keyof TowerStats)[];
  return keys.some((k) => a[k] !== b[k]);
}

/** Analyze every tower: canonical build points + per-step value, with flags. */
export function analyzeEfficiency(): { towers: TowerEfficiency[]; medianDpsPerCredit: number } {
  const towers: TowerEfficiency[] = [];

  for (const def of TOWERS) {
    const builds = [
      buildPoint(def, 'base', 0, 0),
      buildPoint(def, `A·t4 ${def.tracks[0].name}`, 4, 0),
      buildPoint(def, `B·t4 ${def.tracks[1].name}`, 0, 4),
      buildPoint(def, `A·max ${def.tracks[0].name}`, 6, 0),
      buildPoint(def, `B·max ${def.tracks[1].name}`, 0, 6),
      buildPoint(def, 'split·t4', 4, 4),
    ];

    const steps: UpgradeStep[] = [];
    for (const track of [0, 1] as const) {
      for (let tier = 0; tier < 6; tier++) {
        const before = computeStats(def, track === 0 ? tier : 0, track === 1 ? tier : 0);
        const after = computeStats(def, track === 0 ? tier + 1 : 0, track === 1 ? tier + 1 : 0);
        const dBefore = dpsOf(def, before);
        const dAfter = dpsOf(def, after);
        const cost = stepCost(def, track, tier);
        const deltaSingle = dAfter.single - dBefore.single;
        const deltaAoe = dAfter.aoe - dBefore.aoe;
        const up = def.tracks[track].upgrades[tier];
        // a step's "value" credits crowd-dps at half weight; pure utility scores ~0
        const value = Math.max(deltaSingle, deltaAoe * 0.5) / cost;
        const dpsOnlyGain = deltaSingle < 0.01 && deltaAoe < 0.01;
        // a step is only truly DEAD if it changes NOTHING in the stat block.
        // range/rate/coverage steps add no modeled dps but are real value -> 'ok'.
        const changed = statsDiffer(before, after);
        let flag: UpgradeStep['flag'];
        if (!changed) flag = 'dead';
        else if (dpsOnlyGain) flag = 'ok'; // utility / coverage / uptime
        else if (value >= 0.06) flag = 'op';
        else if (value >= 0.025) flag = 'strong';
        else if (value >= 0.008) flag = 'ok';
        else flag = 'weak';
        steps.push({
          track, trackName: def.tracks[track].name, tier: tier + 1,
          name: up.name, desc: up.desc, cost,
          deltaSingle: round(deltaSingle), deltaAoe: round(deltaAoe),
          valuePerCredit: round(value * 1000) / 1000, flag,
        });
      }
    }

    towers.push({
      id: def.id, name: def.name, style: def.style, damageType: def.base.damageType,
      cost: def.cost, unlockAt: def.unlockAt,
      builds, steps,
      rawDpsT4: builds[1].single,
      dpsPerCreditT4: builds[1].dpsPerCredit,
    });
  }

  // median dps-per-credit at t4 among damage-dealing towers, for over/under-valued flags
  const vals = towers.filter((t) => t.style !== 'support' && t.rawDpsT4 > 0).map((t) => t.dpsPerCreditT4).sort((a, b) => a - b);
  const medianDpsPerCredit = vals.length ? vals[Math.floor(vals.length / 2)] : 0;

  return { towers, medianDpsPerCredit };
}
