import { ALL_MAPS, DIFFICULTIES } from './maps';
import { firestore } from './firestoreLazy';
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

export interface DailyOverrideDoc {
  date: string;
  arsenalId?: DailyArsenalId;
  twistId?: DailyTwistId;
  boonId?: DailyBoonId;
  note?: string;
}

const DAMAGE_TYPES: DamageType[] = ['kinetic', 'energy', 'explosive', 'cryo'];
const FIXED_POOL_CORE = ['pulse', 'emp'];
const FIXED_POOL_ROTATION = TOWERS
  .map((tower) => tower.id)
  .filter((id) => !FIXED_POOL_CORE.includes(id));

export const DAILY_ARSENAL_IDS: DailyArsenalId[] = ['fixedPool', 'banDamage', 'tierCap4', 'noSupport', 'budgetBuild'];
export const DAILY_TWIST_IDS: DailyTwistId[] = ['fogProtocol', 'rushHour', 'glassCannon', 'thrifty', 'veteranHulls'];
export const DAILY_BOON_IDS: DailyBoonId[] = ['salvageCache', 'abilityRecharge', 'doublePickups'];

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let overrideLoadedForDate = '';
let cachedOverride: DailyOverrideDoc | null = null;
let overrideLoadDate = '';
let overrideLoadPromise: Promise<void> | null = null;

export function dailyChallenge(now = new Date()): DailyChallenge {
  const dateKey = toDateKey(now);
  return dailyChallengeForDate(dateKey, cachedOverride?.date === dateKey ? cachedOverride : null);
}

export function dailyChallengeForDate(dateKey: string, override?: DailyOverrideDoc | null): DailyChallenge {
  const cleanDate = DATE_RE.test(dateKey) ? dateKey : toDateKey(new Date());
  const seed = hash(cleanDate);
  const map = ALL_MAPS[seed % ALL_MAPS.length];
  const diffPool = DIFFICULTIES.filter((d) => d.id !== 'easy');
  const diff = diffPool[Math.floor(seed / 7) % diffPool.length] ?? DIFFICULTIES[1];
  const cleanOverride = override?.date === cleanDate ? override : null;
  const arsenal = buildArsenalForId(seed, cleanOverride?.arsenalId ?? DAILY_ARSENAL_IDS[seed % DAILY_ARSENAL_IDS.length]);
  const twist = buildTwistForId(cleanOverride?.twistId ?? DAILY_TWIST_IDS[Math.floor(seed / 17) % DAILY_TWIST_IDS.length]);
  const boon = BOONS.find((item) => item.id === cleanOverride?.boonId)
    ?? BOONS[Math.floor(seed / 23) % BOONS.length];
  const title = `Daily Challenge ${cleanDate.slice(5)}: ${map.name}`;
  return {
    id: `daily-${cleanDate}`,
    dateKey: cleanDate,
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
  return dailyChallengeForDate(match[1], cachedOverride?.date === match[1] ? cachedOverride : null);
}

export function dailyModifierNames(challenge: DailyChallenge): string[] {
  return [challenge.arsenal.name, challenge.twist.name, challenge.boon.name];
}

export function dailyChallengeSignature(challenge: DailyChallenge): string {
  return [
    challenge.id,
    challenge.mapId,
    challenge.diffId,
    challenge.arsenal.id,
    challenge.arsenal.name,
    challenge.twist.id,
    challenge.boon.id,
  ].join('|');
}

export function dailyArsenalCatalog(dateKey: string): DailyArsenalConstraint[] {
  const seed = hash(DATE_RE.test(dateKey) ? dateKey : toDateKey(new Date()));
  return DAILY_ARSENAL_IDS.map((id) => buildArsenalForId(seed, id));
}

export function dailyTwistCatalog(): DailyTwist[] {
  return DAILY_TWIST_IDS.map((id) => buildTwistForId(id));
}

export function dailyBoonCatalog(): DailyBoon[] {
  return DAILY_BOON_IDS.map((id) => BOONS.find((boon) => boon.id === id)!).filter(Boolean);
}

export function sanitizeDailyOverrideDoc(raw: unknown): DailyOverrideDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const date = typeof data.date === 'string' && DATE_RE.test(data.date) ? data.date : '';
  if (!date) return null;
  const doc: DailyOverrideDoc = { date };
  if (typeof data.arsenalId === 'string' && DAILY_ARSENAL_IDS.includes(data.arsenalId as DailyArsenalId)) {
    doc.arsenalId = data.arsenalId as DailyArsenalId;
  }
  if (typeof data.twistId === 'string' && DAILY_TWIST_IDS.includes(data.twistId as DailyTwistId)) {
    doc.twistId = data.twistId as DailyTwistId;
  }
  if (typeof data.boonId === 'string' && DAILY_BOON_IDS.includes(data.boonId as DailyBoonId)) {
    doc.boonId = data.boonId as DailyBoonId;
  }
  if (typeof data.note === 'string') doc.note = data.note.slice(0, 240);
  return doc;
}

export function setDailyOverrideDoc(raw: unknown): void {
  cachedOverride = sanitizeDailyOverrideDoc(raw);
  overrideLoadedForDate = cachedOverride?.date ?? overrideLoadedForDate;
}

export function getDailyOverrideDoc(): DailyOverrideDoc | null {
  return cachedOverride ? { ...cachedOverride } : null;
}

export async function loadRemoteDailyOverride(now = new Date()): Promise<void> {
  const dateKey = toDateKey(now);
  if (overrideLoadedForDate === dateKey) return;
  if (overrideLoadDate === dateKey && overrideLoadPromise) return overrideLoadPromise;
  overrideLoadDate = dateKey;
  overrideLoadPromise = (async () => {
    try {
      const { fs, db } = await firestore();
      const snap = await Promise.race([
        fs.getDoc(fs.doc(db, 'config', 'dailyOverride')),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
      ]);
      const doc = snap.exists() ? sanitizeDailyOverrideDoc(snap.data()) : null;
      cachedOverride = doc?.date === dateKey ? doc : null;
    } catch {
      cachedOverride = null;
    } finally {
      overrideLoadedForDate = dateKey;
      overrideLoadPromise = null;
    }
  })();
  return overrideLoadPromise;
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

function buildArsenalForId(seed: number, id: DailyArsenalId): DailyArsenalConstraint {
  if (id === 'fixedPool') {
    const towerIds = [...FIXED_POOL_CORE, ...pickMany(FIXED_POOL_ROTATION, seed + 47, 4)];
    return {
      id: 'fixedPool',
      name: 'Fixed Arsenal',
      short: 'POOL',
      desc: `Only ${towerIds.length} fixed instruments are available today.`,
      towerIds,
    };
  }
  if (id === 'banDamage') {
    const bannedDamageType = DAMAGE_TYPES[Math.floor(seed / 11) % DAMAGE_TYPES.length];
    return {
      id: 'banDamage',
      name: `${labelDamage(bannedDamageType)} Ban`,
      short: 'BAN',
      desc: `${labelDamage(bannedDamageType)}-damage instruments are offline today.`,
      bannedDamageType,
    };
  }
  if (id === 'tierCap4') {
    return {
      id: 'tierCap4',
      name: 'Tier-4 Cap',
      short: 'T4',
      desc: 'Upgrade tracks stop at tier 4; bonus tiers are locked.',
      upgradeTierCap: 4,
    };
  }
  if (id === 'noSupport') {
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

function buildTwistForId(id: DailyTwistId): DailyTwist {
  const base = TWISTS.find((twist) => twist.id === id) ?? TWISTS[0];
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

function toDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
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
