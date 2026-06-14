// Static per-wave DIFFICULTY ESTIMATE — a model of how hard each wave is for a
// PLAYER, computed from the enemy/wave/difficulty defs alone (no bot run needed).
//
// Core idea: a wave's difficulty ≈ the effective HP you must delete divided by the
// buying power you've accumulated by then, scaled by threat modifiers (cloak you
// can't see, armor that eats kinetic, bosses that stun, healers that sustain) and
// hull speed (less time in your kill-zone). Because it's economy-relative, it shows
// the late-game snowball directly: when income outruns incoming HP, the curve sags.
//
// Map-independent on purpose (composition + scaling + economy carry the signal),
// which is also why it answers "do we have to separate by map?" — no.

import { ENEMIES } from './enemies';
import { DIFFICULTIES } from './maps';
import { getWave, waveBonus, incomeMult } from './waves';
import type { DifficultyDef } from './types';

interface Layered { hp: number; reward: number; count: number; speed: number; flags: Set<string> }

const layerCache = new Map<string, Layered>();
/** Recursively roll up a hull and everything it spawns when destroyed. */
function layered(id: string): Layered {
  const hit = layerCache.get(id);
  if (hit) return hit;
  const d = ENEMIES[id];
  let hp = d.hp, reward = d.reward, count = 1, speed = d.speed;
  const flags = new Set<string>();
  if (d.armored) flags.add('armor');
  if (d.boss) flags.add('boss');
  if (d.heal) flags.add('heal');
  for (const c of d.children) {
    const L = layered(c);
    hp += L.hp; reward += L.reward; count += L.count;
    speed = Math.max(speed, L.speed);
    L.flags.forEach((f) => flags.add(f));
  }
  const out: Layered = { hp, reward, count, speed, flags };
  layerCache.set(id, out);
  return out;
}

/** HP multiplier the engine applies at a given wave (mirrors engine.makeEnemy). */
function hpScale(diff: DifficultyDef, wave: number): number {
  const ramp = Math.min(1, wave / 25);
  const diffMult = 1 + (diff.hpMult - 1) * ramp;
  const late = 1 + Math.max(0, wave - 25) * diff.lateScale;
  const fp = 1 + Math.max(0, wave - diff.waves) * 0.18;
  return diffMult * late * fp;
}

export interface WaveDifficulty {
  wave: number;
  /** total effective HP arriving (layered children included, difficulty-scaled) */
  effHP: number;
  /** total layered hull count */
  hulls: number;
  /** credits this wave pays out (kill rewards × taper + clear bonus) */
  income: number;
  /** cumulative buying power through this wave (starting cash + all income) */
  bank: number;
  /** effHP ÷ bank — HP you must delete per credit you could have spent */
  threat: number;
  /** fastest hull in the wave (px/s) */
  speedMax: number;
  /** combined threat modifier from cloak/armor/boss/heal */
  specialMult: number;
  /** which special threats are present this wave */
  tags: string[];
  /** normalized 0..100 difficulty estimate (≈70 = hard-but-fair) */
  index: number;
}

export interface DifficultyCurve { diff: string; name: string; waves: WaveDifficulty[] }

/** Build the per-wave difficulty estimate for every protocol. */
export function analyzeDifficulty(): DifficultyCurve[] {
  interface Raw { row: Omit<WaveDifficulty, 'index'>; raw: number }
  const perDiff: { diff: DifficultyDef; raws: Raw[] }[] = [];

  for (const diff of DIFFICULTIES) {
    const raws: Raw[] = [];
    let bank = diff.cash;
    for (let w = 1; w <= diff.waves; w++) {
      const groups = getWave(w);
      const scale = hpScale(diff, w);
      let effHP = 0, hulls = 0, reward = 0, speedMax = 0;
      const flags = new Set<string>();
      for (const g of groups) {
        const L = layered(g.type);
        effHP += g.count * L.hp * scale;
        hulls += g.count * L.count;
        reward += g.count * L.reward;
        speedMax = Math.max(speedMax, L.speed);
        L.flags.forEach((f) => flags.add(f));
        // Recruit never deploys phase-cloaks (engine.startWave strips them)
        if (g.cloaked && diff.id !== 'easy') flags.add('cloak');
      }
      const income = reward * incomeMult(w) + waveBonus(w);
      bank += income;

      let mult = 1;
      if (flags.has('cloak')) mult *= 1.35; // invisible without detector coverage
      if (flags.has('armor')) mult *= 1.15; // kinetic-resistant
      if (flags.has('boss')) mult *= 1.4;   // disruption pulses + huge single HP
      if (flags.has('heal')) mult *= 1.2;   // convoy sustain
      const speedNorm = Math.min(1.5, Math.max(0.85, speedMax / 120));
      const threat = effHP / Math.max(1, bank);
      const tags = ['cloak', 'armor', 'boss', 'heal'].filter((f) => flags.has(f));

      raws.push({
        row: {
          wave: w, effHP: Math.round(effHP), hulls, income: Math.round(income),
          bank: Math.round(bank), threat, speedMax, specialMult: Math.round(mult * 100) / 100, tags,
        },
        raw: threat * mult * speedNorm,
      });
    }
    perDiff.push({ diff, raws });
  }

  // Normalize across ALL protocols (so the heatmap compares them honestly — Recruit
  // should read greener than Extinction). Raw threat spans ~100× from early to late,
  // so a linear scale crushes the early game to ~0; a sqrt transform spreads it into
  // a legible range. The 95th-percentile raw is the "100" reference.
  const allRaw = perDiff.flatMap((p) => p.raws.map((r) => r.raw)).sort((a, b) => a - b);
  const ref = allRaw[Math.floor(allRaw.length * 0.95)] || 1;

  return perDiff.map(({ diff, raws }) => ({
    diff: diff.id, name: diff.name,
    waves: raws.map(({ row, raw }) => ({ ...row, index: Math.min(100, Math.round(Math.sqrt(raw / ref) * 100)) })),
  }));
}

/** Target difficulty presets the dev can tune toward. p = wave progress 0..1. */
export const DIFFICULTY_TARGETS: Record<string, (p: number) => number> = {
  'Gentle ramp': (p) => 20 + p * 50,
  'Standard arc': (p) => 28 + 52 * Math.pow(p, 0.7),
  'Relentless': (p) => 38 + p * 58,
  'Flat challenge': () => 60,
};
