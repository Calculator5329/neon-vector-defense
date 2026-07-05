import { FREEPLAY_RELICS, relicById, type FreeplayRelic, type FreeplayRelicId } from './freeplay';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { getWave } from './waves';
import type { DifficultyDef, GameMap, Wave } from './types';

export const GAUNTLET_PROTOCOL_START_CORES = 150;
export const GAUNTLET_PROTOCOL_CREDIT_CARRY = 0.6;
export const GAUNTLET_PROTOCOL_LEG_WAVES = [20, 25, 30] as const;
export const GAUNTLET_PROTOCOL_DIFF_IDS = ['easy', 'normal', 'hard'] as const;
export const GAUNTLET_PROTOCOL_TOTAL_WAVES = GAUNTLET_PROTOCOL_LEG_WAVES.reduce((sum, waves) => sum + waves, 0);

export interface GauntletProtocolLeg {
  week: string;
  gauntletRunId: string;
  leg: 1 | 2 | 3;
  route: [string, string, string];
  startingCredits: number;
  startingCores: number;
  relicIds: FreeplayRelicId[];
  draftOfferIds?: FreeplayRelicId[];
  pickedRelicId?: FreeplayRelicId;
  previousRunId?: string;
  nextRunId?: string;
}

export interface GauntletProtocolRoute {
  week: string;
  route: [string, string, string];
}

export function currentGauntletProtocolId(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `weekly-${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function gauntletProtocolRouteForWeek(week = currentGauntletProtocolId()): GauntletProtocolRoute {
  const route = pickMany(ALL_MAPS.map((map) => map.id), hash(week), 3) as [string, string, string];
  return { week, route };
}

export function gauntletProtocolMap(route: GauntletProtocolRoute, leg: 1 | 2 | 3): GameMap {
  return ALL_MAPS.find((map) => map.id === route.route[leg - 1]) ?? ALL_MAPS[0];
}

export function gauntletProtocolDifficulty(leg: 1 | 2 | 3): DifficultyDef {
  return DIFFICULTIES.find((diff) => diff.id === GAUNTLET_PROTOCOL_DIFF_IDS[leg - 1]) ?? DIFFICULTIES[0];
}

export function gauntletProtocolWaveCount(leg: 1 | 2 | 3): number {
  return GAUNTLET_PROTOCOL_LEG_WAVES[leg - 1];
}

export function gauntletProtocolWave(leg: 1 | 2 | 3, wave: number): Wave {
  const n = Math.max(1, Math.floor(wave));
  const source = leg === 1 ? n : leg === 2 ? n + 5 : n + 12;
  return getWave(source).map((group) => ({ ...group }));
}

export function nextGauntletCredits(endingCredits: number): number {
  return Math.max(0, Math.floor(Math.max(0, Math.floor(endingCredits)) * GAUNTLET_PROTOCOL_CREDIT_CARRY));
}

export function gauntletProtocolDraftOffer(seed: number, leg: 2 | 3, owned: FreeplayRelicId[]): FreeplayRelic[] {
  const ownedSet = new Set(owned);
  // Leg 3 draws from the spicier half: the higher-scoreMult relics pressure score
  // and risk decisions harder than the safer utility-first half.
  const basePool = leg === 3
    ? [...FREEPLAY_RELICS].sort((a, b) => b.scoreMult - a.scoreMult).slice(0, Math.ceil(FREEPLAY_RELICS.length / 2))
    : FREEPLAY_RELICS;
  const pool = basePool.filter((relic) => !ownedSet.has(relic.id));
  const fallback = FREEPLAY_RELICS.filter((relic) => !ownedSet.has(relic.id));
  return pickMany(pool.length >= 3 ? pool : fallback, (seed >>> 0) + leg * 1009 + owned.length * 97, 3);
}

export function gauntletProtocolRelics(ids: FreeplayRelicId[]): FreeplayRelic[] {
  return ids.map(relicById);
}

function pickMany<T>(items: T[], seed: number, count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  let s = seed | 0;
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
