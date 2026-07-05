import {
  DAILY_ARSENAL_IDS,
  DAILY_BOON_IDS,
  DAILY_TWIST_IDS,
  buildArsenalForId,
  buildTwistForId,
  dailyBoonCatalog,
  type DailyArsenalId,
  type DailyBoonId,
  type DailyChallenge,
  type DailyTwist,
  type DailyTwistId,
} from './dailyChallenge';
import { firestore } from './firestoreLazy';
import { ALL_MAPS, DIFFICULTIES } from './maps';

export type WeeklyChallenge = DailyChallenge & {
  weekKey: string;
  twistIds: [DailyTwistId, DailyTwistId, DailyTwistId];
  twists: [DailyTwist, DailyTwist, DailyTwist];
};

export interface WeeklyOverrideDoc {
  week: string;
  arsenalId?: DailyArsenalId;
  twistIds?: [DailyTwistId, DailyTwistId, DailyTwistId];
  boonId?: DailyBoonId;
  note?: string;
}

export interface WeeklyGauntletDoc {
  week: string;
  runId: string;
  callsign: string;
  map: string;
  diff: string;
  seed: number;
  wave: number;
  kills: number;
}

const WEEK_RE = /^weekly-\d{4}-W\d{2}$/;
let overrideLoadedForWeek = '';
let cachedOverride: WeeklyOverrideDoc | null = null;
let overrideLoadWeek = '';
let overrideLoadPromise: Promise<void> | null = null;
let cachedGauntlet: WeeklyGauntletDoc | null = null;

export function weeklyChallenge(now = new Date()): WeeklyChallenge {
  const weekKey = isoWeekId(now);
  return weeklyChallengeForId(weekKey, cachedOverride?.week === weekKey ? cachedOverride : null) ?? weeklyChallengeForId(weekKey)!;
}

export function weeklyChallengeForId(id: string, override?: WeeklyOverrideDoc | null): WeeklyChallenge | null {
  if (!WEEK_RE.test(id)) return null;
  const seed = hash(id);
  const map = ALL_MAPS[seed % ALL_MAPS.length];
  const diffPool = DIFFICULTIES.filter((d) => d.id !== 'easy');
  const diff = diffPool[Math.floor(seed / 7) % diffPool.length] ?? DIFFICULTIES[1];
  const cleanOverride = override?.week === id ? override : null;
  const arsenal = buildArsenalForId(seed, cleanOverride?.arsenalId ?? DAILY_ARSENAL_IDS[seed % DAILY_ARSENAL_IDS.length]);
  const twistIds = cleanOverride?.twistIds ?? weeklyTwistIds(seed);
  const twists = twistIds.map((twistId) => buildTwistForId(twistId)) as WeeklyChallenge['twists'];
  const twist = combineTwists(twists);
  const boon = dailyBoonCatalog().find((item) => item.id === cleanOverride?.boonId)
    ?? dailyBoonCatalog()[Math.floor(seed / 23) % DAILY_BOON_IDS.length];
  return {
    id,
    dateKey: id.replace(/^weekly-/, ''),
    weekKey: id,
    mapId: map.id,
    diffId: diff.id,
    title: `Weekly Mutation ${id.slice(7)}: ${map.name}`,
    arsenal,
    twist,
    twistIds,
    twists,
    boon,
    rules: [
      arsenal.desc,
      ...twists.map((item) => item.desc),
      boon.desc,
      'Starts at wave 1 with normal protocol cash and cores. Ranked by wave, then hulls destroyed.',
    ],
  };
}

export function weeklyChallengeSignature(challenge: WeeklyChallenge): string {
  return [
    challenge.id,
    challenge.mapId,
    challenge.diffId,
    challenge.arsenal.id,
    ...challenge.twistIds,
    challenge.boon.id,
  ].join('|');
}

export function weeklyModifierNames(challenge: WeeklyChallenge): string[] {
  return [challenge.arsenal.name, ...challenge.twists.map((twist) => twist.name), challenge.boon.name];
}

export function weeklyBoardId(id: string): string {
  return WEEK_RE.test(id) ? id : '';
}

export function currentWeeklyId(now = new Date()): string {
  return isoWeekId(now);
}

export function sanitizeWeeklyGauntletDoc(raw: unknown): WeeklyGauntletDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const week = typeof data.week === 'string' && WEEK_RE.test(data.week) ? data.week : '';
  const runId = typeof data.runId === 'string' && /^r_[A-Za-z0-9_-]{8,80}$/.test(data.runId) ? data.runId : '';
  const map = typeof data.map === 'string' && ALL_MAPS.some((item) => item.id === data.map) ? data.map : '';
  const diff = typeof data.diff === 'string' && DIFFICULTIES.some((item) => item.id === data.diff) ? data.diff : '';
  const seed = Math.floor(Number(data.seed));
  const wave = Math.floor(Number(data.wave));
  const kills = Math.floor(Number(data.kills));
  if (!week || !runId || !map || !diff || !Number.isFinite(seed) || seed < 0) return null;
  return {
    week,
    runId,
    callsign: String(data.callsign ?? 'WARDEN').slice(0, 20),
    map,
    diff,
    seed: seed >>> 0,
    wave: Math.max(0, Math.min(10000, wave || 0)),
    kills: Math.max(0, Math.min(9999999, kills || 0)),
  };
}

export function sanitizeWeeklyOverrideDoc(raw: unknown): WeeklyOverrideDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const week = typeof data.week === 'string' && WEEK_RE.test(data.week) ? data.week : '';
  if (!week) return null;
  const doc: WeeklyOverrideDoc = { week };
  if (typeof data.arsenalId === 'string' && DAILY_ARSENAL_IDS.includes(data.arsenalId as DailyArsenalId)) {
    doc.arsenalId = data.arsenalId as DailyArsenalId;
  }
  if (Array.isArray(data.twistIds)) {
    const twistIds = data.twistIds.filter((id): id is DailyTwistId =>
      typeof id === 'string' && DAILY_TWIST_IDS.includes(id as DailyTwistId));
    if (twistIds.length === 3 && new Set(twistIds).size === 3) {
      doc.twistIds = twistIds as WeeklyOverrideDoc['twistIds'];
    }
  }
  if (typeof data.boonId === 'string' && DAILY_BOON_IDS.includes(data.boonId as DailyBoonId)) {
    doc.boonId = data.boonId as DailyBoonId;
  }
  if (typeof data.note === 'string') doc.note = data.note.slice(0, 240);
  return doc;
}

export function setWeeklyOverrideDoc(raw: unknown): void {
  cachedOverride = sanitizeWeeklyOverrideDoc(raw);
  overrideLoadedForWeek = cachedOverride?.week ?? overrideLoadedForWeek;
}

export function getWeeklyOverrideDoc(): WeeklyOverrideDoc | null {
  return cachedOverride ? { ...cachedOverride, twistIds: cachedOverride.twistIds ? [...cachedOverride.twistIds] as WeeklyOverrideDoc['twistIds'] : undefined } : null;
}

export function getWeeklyGauntletDoc(): WeeklyGauntletDoc | null {
  return cachedGauntlet ? { ...cachedGauntlet } : null;
}

export async function loadRemoteWeeklyOverride(now = new Date()): Promise<void> {
  const week = isoWeekId(now);
  if (overrideLoadedForWeek === week) return;
  if (overrideLoadWeek === week && overrideLoadPromise) return overrideLoadPromise;
  overrideLoadWeek = week;
  overrideLoadPromise = (async () => {
    try {
      const { fs, db } = await firestore();
      const snap = await Promise.race([
        fs.getDoc(fs.doc(db, 'config', 'weeklyOverride')),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
      ]);
      const doc = snap.exists() ? sanitizeWeeklyOverrideDoc(snap.data()) : null;
      cachedOverride = doc?.week === week ? doc : null;
    } catch {
      cachedOverride = null;
    } finally {
      overrideLoadedForWeek = week;
      overrideLoadPromise = null;
    }
  })();
  return overrideLoadPromise;
}

export async function loadRemoteWeeklyGauntlet(now = new Date()): Promise<WeeklyGauntletDoc | null> {
  const week = isoWeekId(now);
  try {
    const { fs, db } = await firestore();
    const snap = await Promise.race([
      fs.getDoc(fs.doc(db, 'config', 'weeklyGauntlet')),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    const doc = snap.exists() ? sanitizeWeeklyGauntletDoc(snap.data()) : null;
    cachedGauntlet = doc?.week === week ? doc : null;
  } catch {
    cachedGauntlet = null;
  }
  return cachedGauntlet ? { ...cachedGauntlet } : null;
}

function weeklyTwistIds(seed: number): WeeklyChallenge['twistIds'] {
  const pool = [...DAILY_TWIST_IDS];
  const out: DailyTwistId[] = [];
  let s = seed;
  while (pool.length && out.length < 3) {
    s = Math.imul(s ^ 0x9e3779b9, 1664525) + 1013904223;
    out.push(pool.splice(Math.abs(s) % pool.length, 1)[0]);
  }
  return out as WeeklyChallenge['twistIds'];
}

function combineTwists(twists: WeeklyChallenge['twists']): DailyTwist {
  const mult = (key: keyof DailyTwist) => {
    const value = twists.reduce((n, twist) => n * (typeof twist[key] === 'number' ? Number(twist[key]) : 1), 1);
    return value === 1 ? undefined : Math.round(value * 1000) / 1000;
  };
  const first = twists[0];
  const twist: DailyTwist = {
    id: first.id,
    name: `Stacked: ${twists.map((item) => item.short).join(' + ')}`,
    short: 'STACK',
    desc: `Stacked weekly mutation: ${twists.map((item) => item.name).join(' + ')}.`,
  };
  const waveGapMultiplier = mult('waveGapMultiplier');
  const towerDamageMultiplier = mult('towerDamageMultiplier');
  const startingLivesMultiplier = mult('startingLivesMultiplier');
  const killRewardMultiplier = mult('killRewardMultiplier');
  const waveBonusMultiplier = mult('waveBonusMultiplier');
  const enemyHpMultiplier = mult('enemyHpMultiplier');
  const enemyDamageTakenMultiplier = mult('enemyDamageTakenMultiplier');
  if (waveGapMultiplier !== undefined) twist.waveGapMultiplier = waveGapMultiplier;
  if (towerDamageMultiplier !== undefined) twist.towerDamageMultiplier = towerDamageMultiplier;
  if (startingLivesMultiplier !== undefined) twist.startingLivesMultiplier = startingLivesMultiplier;
  if (killRewardMultiplier !== undefined) twist.killRewardMultiplier = killRewardMultiplier;
  if (waveBonusMultiplier !== undefined) twist.waveBonusMultiplier = waveBonusMultiplier;
  if (enemyHpMultiplier !== undefined) twist.enemyHpMultiplier = enemyHpMultiplier;
  if (enemyDamageTakenMultiplier !== undefined) twist.enemyDamageTakenMultiplier = enemyDamageTakenMultiplier;
  if (twists.some((item) => item.sensorBlackout)) twist.sensorBlackout = true;
  return twist;
}

function isoWeekId(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `weekly-${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
