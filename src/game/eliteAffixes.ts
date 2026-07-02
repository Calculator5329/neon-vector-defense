import type { EliteAffixId, EnemyDef, Wave, WaveGroup } from './types';
import { ENEMIES } from './enemies';

export const ELITE_START_WAVE = 12;
export const BULWARK_RADIUS = 86;
export const BULWARK_DAMAGE_MULT = 0.78;

export const ELITE_AFFIX_IDS: EliteAffixId[] = ['shielded', 'frenzied', 'splitting', 'bulwark'];

export const ELITE_AFFIX_META: Record<EliteAffixId, {
  name: string;
  color: string;
  glow: string;
  rewardMult: number;
  speedMult: number;
}> = {
  shielded: { name: 'Shielded', color: '#7efff5', glow: '#c7fffb', rewardMult: 1.3, speedMult: 1 },
  frenzied: { name: 'Frenzied', color: '#ff9f43', glow: '#ffd08a', rewardMult: 1.35, speedMult: 1.22 },
  splitting: { name: 'Splitting', color: '#ff6ec7', glow: '#ffa7dd', rewardMult: 1.28, speedMult: 1 },
  bulwark: { name: 'Bulwark', color: '#ffd32a', glow: '#fff0a3', rewardMult: 1.32, speedMult: 0.96 },
};

export const ELITE_VARIANT_DEF: EnemyDef = {
  id: 'elite',
  name: 'Elite variants',
  hp: 1,
  speed: 0,
  radius: 18,
  reward: 0,
  color: '#ffd32a',
  glow: '#fff0a3',
  children: [],
  shape: 'diamond',
  lore: 'Priority hulls marked by crown-lit plating. Shielded, Frenzied, Splitting, and Bulwark variants appear inside normal waves with richer bounties.',
};

const HOLLOW_IDS = new Set(['wisp', 'gorge', 'lampblack']);

export function makeEliteState(id: EliteAffixId, maxHp: number, wave: number) {
  const meta = ELITE_AFFIX_META[id];
  const state: {
    id: EliteAffixId;
    rewardMult: number;
    speedMult: number;
    shield?: number;
    maxShield?: number;
  } = {
    id,
    rewardMult: meta.rewardMult,
    speedMult: meta.speedMult,
  };
  if (id === 'shielded') {
    const shield = Math.ceil(Math.max(7, Math.min(maxHp * 0.34 + wave * 0.3, maxHp * 0.58)));
    state.shield = shield;
    state.maxShield = shield;
  }
  return state;
}

export function eliteSplitChildren(typeId: string): string[] {
  if (HOLLOW_IDS.has(typeId)) return ['wisp', 'wisp'];
  const def = ENEMIES[typeId];
  if (def?.armored || (def?.hp ?? 0) >= 3) return ['raider', 'raider'];
  return ['scout', 'scout'];
}

export function planEliteWave(wave: number, groups: Wave, rng: () => number): Wave {
  if (wave < ELITE_START_WAVE) return groups;
  const candidates: { gi: number; i: number; roll: number }[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const def = ENEMIES[group.type];
    if (!def || def.boss || def.heal || group.count <= 0) continue;
    for (let i = 0; i < group.count; i++) candidates.push({ gi, i, roll: rng() });
  }
  if (candidates.length === 0) return groups;

  const cap = wave < 20 ? 1 : wave < 35 ? 2 : 3;
  const waveChance = Math.min(0.86, 0.28 + (wave - ELITE_START_WAVE) * 0.018);
  let desired = rng() < waveChance ? 1 : 0;
  if (cap >= 2 && rng() < waveChance * 0.55) desired++;
  if (cap >= 3 && rng() < waveChance * 0.35) desired++;
  desired = Math.min(desired, cap, candidates.length);
  if (desired <= 0) return groups;

  candidates.sort((a, b) => a.roll - b.roll);
  const out: WaveGroup[] = groups.map((group) => ({ ...group, elites: group.elites ? [...group.elites] : undefined }));
  for (let n = 0; n < desired; n++) {
    const pick = candidates[n];
    const affix = ELITE_AFFIX_IDS[Math.min(ELITE_AFFIX_IDS.length - 1, Math.floor(rng() * ELITE_AFFIX_IDS.length))];
    const elites = out[pick.gi].elites ?? (out[pick.gi].elites = []);
    elites.push({ i: pick.i, a: affix });
  }
  for (const group of out) {
    if (group.elites) group.elites.sort((a, b) => a.i - b.i);
  }
  return out;
}

export function eliteAffixForSpawn(group: WaveGroup, index: number): EliteAffixId | undefined {
  const elites = group.elites;
  if (!elites) return undefined;
  for (let i = 0; i < elites.length; i++) {
    if (elites[i].i === index) return elites[i].a;
  }
  return undefined;
}
