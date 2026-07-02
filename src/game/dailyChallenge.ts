import { ALL_MAPS, DIFFICULTIES } from './maps';
import { TOWERS } from './towers';
import type { DamageType, FireStyle, TowerDef, WaveGroup } from './types';

export type DailyArsenalId = 'fixedPool' | 'banDamage' | 'tierCap4' | 'noSupport' | 'budgetBuild';
export type DailyTwistId = 'fogProtocol' | 'rushHour' | 'glassCannon' | 'thrifty' | 'veteranHulls';
export type DailyBoonId = 'salvageCache' | 'abilityRecharge' | 'doublePickups';

export interface DailyArsenalConstraint {
  id: DailyArsenalId;
  name: string;
  short: string;
  desc: string;
  towerIds?: string[];
  bannedDamageType?: DamageType;
  bannedStyle?: FireStyle;
  upgradeTierCap?: number;
  costMultiplier?: number;
}

export interface DailyTwist {
  id: DailyTwistId;
  name: string;
  short: string;
  desc: string;
  waveGapMultiplier?: number;
  towerDamageMultiplier?: number;
  startingLivesMultiplier?: number;
  killRewardMultiplier?: number;
  waveBonusMultiplier?: number;
  sensorBlackout?: boolean;
  enemyHpMultiplier?: number;
  enemyDamageTakenMultiplier?: number;
}

export interface DailyBoon {
  id: DailyBoonId;
  name: string;
  short: string;
  desc: string;
  creditCacheWave?: number;
  creditCacheAmount?: number;
  freeAbilityRecharge?: boolean;
  pickupDropMultiplier?: number;
}

export interface DailyChallenge {
  id: string;
  dateKey: string;
  mapId: string;
  diffId: string;
  title: string;
  arsenal: DailyArsenalConstraint;
  twist: DailyTwist;
  boon: DailyBoon;
  rules: string[];
}

const DAMAGE_TYPES: DamageType[] = ['kinetic', 'energy', 'explosive', 'cryo'];
const FIXED_POOL_CORE = ['pulse', 'emp'];
const FIXED_POOL_ROTATION = TOWERS
  .map((tower) => tower.id)
  .filter((id) => !FIXED_POOL_CORE.includes(id));

const TWISTS: Omit<DailyTwist, 'desc'>[] = [
  { id: 'fogProtocol', name: 'Fog Protocol', short: 'FOG', sensorBlackout: true },
  { id: 'rushHour', name: 'Rush Hour', short: 'RUSH', waveGapMultiplier: 0.6 },
  { id: 'glassCannon', name: 'Glass Cannon', short: 'GLASS', towerDamageMultiplier: 1.3, startingLivesMultiplier: 0.6 },
  { id: 'thrifty', name: 'Thrifty', short: 'THRIFT', killRewardMultiplier: 0.7, waveBonusMultiplier: 1.5 },
  { id: 'veteranHulls', name: 'Veteran Hulls', short: 'VETERAN', enemyHpMultiplier: 1.12, enemyDamageTakenMultiplier: 0.92 },
];

const BOONS: DailyBoon[] = [
  {
    id: 'salvageCache',
    name: 'Salvage Cache',
    short: 'CACHE',
    desc: 'A sealed cache opens before wave 5 for +350 credits.',
    creditCacheWave: 5,
    creditCacheAmount: 350,
  },
  {
    id: 'abilityRecharge',
    name: 'Emergency Recharge',
    short: 'RECHARGE',
    desc: 'Once per run, one commander ability can fire through its cooldown.',
    freeAbilityRecharge: true,
  },
  {
    id: 'doublePickups',
    name: 'Double Drops',
    short: 'DROPS',
    desc: 'Combat pickups drop twice as often.',
    pickupDropMultiplier: 2,
  },
];

export function dailyChallenge(now = new Date()): DailyChallenge {
  const dateKey = now.toISOString().slice(0, 10);
  const seed = hash(dateKey);
  const map = ALL_MAPS[seed % ALL_MAPS.length];
  const diffPool = DIFFICULTIES.filter((d) => d.id !== 'easy');
  const diff = diffPool[Math.floor(seed / 7) % diffPool.length] ?? DIFFICULTIES[1];
  const arsenal = buildArsenal(seed);
  const twist = buildTwist(seed);
  const boon = BOONS[Math.floor(seed / 23) % BOONS.length];
  const title = `Daily Challenge ${dateKey.slice(5)}: ${map.name}`;
  return {
    id: `daily-${dateKey}`,
    dateKey,
    mapId: map.id,
    diffId: diff.id,
    title,
    arsenal,
    twist,
    boon,
    rules: [
      arsenal.desc,
      twist.desc,
      boon.desc,
      'Starts at wave 1 with normal protocol cash and cores. Ranked by wave, then hulls destroyed.',
    ],
  };
}

export function dailyChallengeForId(id: string): DailyChallenge | null {
  const match = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match) return null;
  return dailyChallenge(new Date(`${match[1]}T00:00:00.000Z`));
}

export function dailyModifierNames(challenge: DailyChallenge): string[] {
  return [challenge.arsenal.name, challenge.twist.name, challenge.boon.name];
}

export function dailyAllowsTower(challenge: DailyChallenge | null, def: TowerDef): boolean {
  if (!challenge) return true;
  const arsenal = challenge.arsenal;
  if (arsenal.towerIds && !arsenal.towerIds.includes(def.id)) return false;
  if (arsenal.bannedStyle && def.style === arsenal.bannedStyle) return false;
  if (arsenal.bannedDamageType && towerUsesDamage(def, arsenal.bannedDamageType)) return false;
  return true;
}

export function dailyTowerIds(challenge: DailyChallenge | null): string[] | null {
  if (!challenge) return null;
  return TOWERS.filter((tower) => dailyAllowsTower(challenge, tower)).map((tower) => tower.id);
}

export function applyDailyWaveTwist(challenge: DailyChallenge | null, wave: WaveGroup[]): WaveGroup[] {
  if (!challenge) return wave;
  let groups = wave.map((group) => ({ ...group }));
  if (challenge.twist.waveGapMultiplier) {
    groups = groups.map((group) => ({ ...group, gap: Math.max(0.05, group.gap * challenge.twist.waveGapMultiplier!) }));
  }
  return groups;
}

function buildArsenal(seed: number): DailyArsenalConstraint {
  const pick = seed % 5;
  if (pick === 0) {
    const towerIds = [...FIXED_POOL_CORE, ...pickMany(FIXED_POOL_ROTATION, seed + 47, 4)];
    return {
      id: 'fixedPool',
      name: 'Fixed Arsenal',
      short: 'POOL',
      desc: `Only ${towerIds.length} fixed instruments are available today.`,
      towerIds,
    };
  }
  if (pick === 1) {
    const bannedDamageType = DAMAGE_TYPES[Math.floor(seed / 11) % DAMAGE_TYPES.length];
    return {
      id: 'banDamage',
      name: `${labelDamage(bannedDamageType)} Ban`,
      short: 'BAN',
      desc: `${labelDamage(bannedDamageType)}-damage instruments are offline today.`,
      bannedDamageType,
    };
  }
  if (pick === 2) {
    return {
      id: 'tierCap4',
      name: 'Tier-4 Cap',
      short: 'T4',
      desc: 'Upgrade tracks stop at tier 4; bonus tiers are locked.',
      upgradeTierCap: 4,
    };
  }
  if (pick === 3) {
    return {
      id: 'noSupport',
      name: 'No Support',
      short: 'NO SUP',
      desc: 'Support towers are banned from today\'s grid.',
      bannedStyle: 'support',
    };
  }
  return {
    id: 'budgetBuild',
    name: 'Budget Build',
    short: 'BUDGET',
    desc: 'All tower and upgrade costs are increased by 25%.',
    costMultiplier: 1.25,
  };
}

function buildTwist(seed: number): DailyTwist {
  const base = TWISTS[Math.floor(seed / 17) % TWISTS.length];
  if (base.id === 'fogProtocol') {
    return { ...base, desc: 'Permanent sensor blackout: cloaked hulls need rank-3 detectors.' };
  }
  if (base.id === 'rushHour') {
    return { ...base, desc: 'Wave spacing is compressed by 40%.' };
  }
  if (base.id === 'glassCannon') {
    return { ...base, desc: 'Towers deal +30% damage, but reactor cores start at 60%.' };
  }
  if (base.id === 'thrifty') {
    return { ...base, desc: 'Kill rewards are reduced by 30%, while wave bonuses pay +50%.' };
  }
  return { ...base, desc: 'Enemy hulls carry stronger plating and resist more incoming damage.' };
}

function towerUsesDamage(def: TowerDef, type: DamageType): boolean {
  if (def.style === 'support') return false;
  if (def.base.damageType === type && def.base.damage > 0) return true;
  return def.tracks.some((track) => track.upgrades.some((upgrade) => {
    const stats = { ...def.base };
    upgrade.apply(stats);
    return stats.damageType === type && stats.damage > 0;
  }));
}

function labelDamage(type: DamageType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function pickMany<T>(items: T[], seed: number, count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  let s = seed;
  while (pool.length && out.length < count) {
    s = Math.imul(s ^ 0x9e3779b9, 1664525) + 1013904223;
    out.push(pool.splice(Math.abs(s) % pool.length, 1)[0]);
  }
  return out;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
