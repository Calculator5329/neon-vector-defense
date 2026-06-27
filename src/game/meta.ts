// Meta-progression layer: Warden Rank · Salvage · Operations Board · Watch Streak.
//
// CRITICAL: this layer is COSMETIC/QoL only and is read-only with respect to the Game.
// It must never feed engine combat math, starting cash/lives, tower unlock thresholds, or
// score. The bot-tuned ladder stays clean by construction — meta.ts adds zero run modifiers
// and is imported by NOTHING in engine.ts / towers.ts / bot.ts / the score-replay path.
//
// 100% client-side: localStorage only, deterministic daily/weekly quests via date-hash
// (same FNV-1a pattern as freeplay.ts), no backend, no rules change.

import { progress } from './storage';

const META_KEY = 'nvd-meta-v2'; // v2: re-seed (v1 over-credited lifetime kills → absurd ranks)
const DEMO_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1';
const CREDITED_CAP = 60; // ring-buffer of recent runIds for idempotency

// ---- deterministic helpers (copied from freeplay.ts; meta stays self-contained) ----
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pickMany<T>(items: T[], seed: number, count: number): T[] {
  const pool = [...items]; const out: T[] = []; let s = seed;
  while (pool.length && out.length < count) {
    s = Math.imul(s ^ 0x9e3779b9, 1664525) + 1013904223;
    out.push(pool.splice(Math.abs(s) % pool.length, 1)[0]);
  }
  return out;
}

// ---- persisted state ----
export interface MetaState {
  xp: number;
  salvage: number;
  salvageLifetime: number;
  seeded: boolean;
  questProgress: Record<string, number>;
  questClaimed: string[];
  creditedRuns: string[];
  bestStreak: number;
  comebackSeenFor: string;
  cosmetics: string[];
  cosmeticEquipped: Record<string, string>;
}

function fresh(): MetaState {
  return {
    xp: 0, salvage: 0, salvageLifetime: 0, seeded: false,
    questProgress: {}, questClaimed: [], creditedRuns: [],
    bestStreak: 0, comebackSeenFor: '', cosmetics: [], cosmeticEquipped: {},
  };
}
function load(): MetaState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(META_KEY) : null;
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* corrupted/unavailable — start fresh */ }
  return fresh();
}
let cache = load();
function save() {
  if (DEMO_MODE) return;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(META_KEY, JSON.stringify(cache)); }
  catch { /* full or blocked — non-fatal */ }
}

// One-time seed so existing players don't start at rank 1. Reads lifetime counters once;
// afterwards XP only accrues from per-run creditRun (no double counting).
function ensureSeeded() {
  if (cache.seeded) return;
  const r = progress.record;
  // SUBLINEAR in kills (sqrt) so a veteran's millions of lifetime hulls can't explode XP into
  // an absurd rank. Lands a hardcore ~10M-kill/1500-wave player near Ascendant, with headroom.
  cache.xp = Math.round(progress.totalWaves * 5 + Math.sqrt(Math.max(0, r.kills)) * 5 + r.victories * 150);
  cache.seeded = true;
  save();
}

// ---- rank curve ----
export interface RankInfo { rank: number; title: string; xpIntoRank: number; xpForRank: number; totalXp: number; pct: number; }
const RANK_BANDS = ['Recruit', 'Sentinel', 'Warden', 'Vanguard', 'Architect', 'Luminary', 'Ascendant'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const MAX_RANK = RANK_BANDS.length * ROMAN.length; // 35 = "Ascendant V" ceiling — rank can never overflow

/** Cumulative XP required to REACH rank n (rank 1 = 0). Quadratic-ish, slows over time. */
export function xpForRank(n: number): number {
  if (n <= 1) return 0;
  return Math.round(120 * Math.pow(n - 1, 1.55));
}
export function rankTitle(rank: number): string {
  const r = Math.max(1, Math.min(MAX_RANK, rank));
  const band = Math.min(RANK_BANDS.length - 1, Math.floor((r - 1) / ROMAN.length));
  const sub = Math.min(ROMAN.length - 1, (r - 1) % ROMAN.length);
  return `${RANK_BANDS[band]} ${ROMAN[sub]}`;
}
export function rankFromXp(xp: number): RankInfo {
  let rank = 1;
  while (rank < MAX_RANK && xpForRank(rank + 1) <= xp) rank++;
  const capped = rank >= MAX_RANK;
  const base = xpForRank(rank), next = xpForRank(rank + 1);
  const span = Math.max(1, next - base);
  const into = xp - base;
  return { rank, title: rankTitle(rank), xpIntoRank: into, xpForRank: span, totalXp: xp, pct: capped ? 0.999 : Math.min(0.999, into / span) };
}

// ---- run reward derivation (pure; reads only engine-computed values) ----
export type RunOutcome = 'victory' | 'armistice' | 'gameover' | 'abandoned';
export interface RunRewardInput {
  wave: number; kills: number; cashEarned: number; won: boolean;
  freeplay: boolean; diffId: string; isDailyFreeplay: boolean; outcome: RunOutcome;
}
export interface RunMetaReward { xp: number; salvage: number; breakdown: { label: string; xp: number; salvage: number }[]; }

const DIFF_MULT: Record<string, number> = { easy: 0.8, normal: 1, hard: 1.4, extinction: 1.8, ngplus: 1.6 };

export function deriveRunReward(input: RunRewardInput): RunMetaReward {
  if (input.outcome === 'abandoned') return { xp: 0, salvage: 0, breakdown: [] };
  const mult = DIFF_MULT[input.diffId] ?? 1;
  const breakdown: { label: string; xp: number; salvage: number }[] = [];
  const add = (label: string, xp: number, salvage: number) => breakdown.push({ label, xp: Math.round(xp), salvage: Math.round(salvage) });

  add(`Wave ${input.wave}`, input.wave * 10 * mult, input.wave * 2);
  add(`${input.kills.toLocaleString()} hulls`, input.kills * 1 * mult, input.cashEarned / 200);
  if (input.won) add('Sector held', 250 * mult, 60);
  if (input.outcome === 'armistice') add('The Long Signal', 400 * mult, 0);
  if (input.isDailyFreeplay) add('Daily op', 50, 20);

  const xp = breakdown.reduce((s, b) => s + b.xp, 0);
  const salvage = breakdown.reduce((s, b) => s + b.salvage, 0);
  return { xp: Math.round(xp), salvage: Math.round(salvage), breakdown };
}

// ---- quests (deterministic per date) ----
export type QuestPeriod = 'daily' | 'weekly';
export type QuestMetric = 'wavesCleared' | 'kills' | 'runsCompleted' | 'campaignWins' | 'freeplayWave' | 'towerKindsUsed' | 'abilitiesCast' | 'reachWave';
export interface QuestDef {
  id: string; period: QuestPeriod; metric: QuestMetric; target: number;
  title: string; desc: string; rewardXp: number; rewardSalvage: number;
  scope?: { freeplay?: boolean };
}
export interface QuestWithProgress extends QuestDef { progress: number; complete: boolean; claimed: boolean; }
export interface QuestRunExtras { towerKindsUsed: number; abilitiesCast: number; }

// metric → { copy, [dailyBase, weeklyBase], jitter steps, max-type? }
const METRICS: Record<QuestMetric, { verb: (n: number) => string; daily: number; weekly: number; step: number; max?: boolean; scope?: { freeplay?: boolean } }> = {
  wavesCleared: { verb: (n) => `Clear ${n} waves`, daily: 20, weekly: 120, step: 5 },
  kills: { verb: (n) => `Destroy ${n.toLocaleString()} hulls`, daily: 600, weekly: 4000, step: 100 },
  runsCompleted: { verb: (n) => `Complete ${n} runs`, daily: 2, weekly: 10, step: 1 },
  campaignWins: { verb: (n) => `Win ${n} campaign${n > 1 ? 's' : ''}`, daily: 1, weekly: 3, step: 1 },
  freeplayWave: { verb: (n) => `Reach wave ${n} in Freeplay`, daily: 25, weekly: 45, step: 5, max: true, scope: { freeplay: true } },
  towerKindsUsed: { verb: (n) => `Field ${n} tower types in a run`, daily: 5, weekly: 8, step: 1, max: true },
  abilitiesCast: { verb: (n) => `Invoke ${n} commander abilities`, daily: 8, weekly: 40, step: 2 },
  reachWave: { verb: (n) => `Reach wave ${n}`, daily: 18, weekly: 35, step: 3, max: true },
};
const DAILY_POOL: QuestMetric[] = ['wavesCleared', 'kills', 'runsCompleted', 'reachWave', 'abilitiesCast', 'towerKindsUsed'];
const WEEKLY_POOL: QuestMetric[] = ['kills', 'campaignWins', 'wavesCleared', 'reachWave', 'freeplayWave'];

function dateKey(now: Date): string { return now.toISOString().slice(0, 10); }
function weekKey(now: Date): string {
  // ISO-week (Monday-anchored), UTC — matches the daily-seed UTC convention.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function makeQuest(period: QuestPeriod, key: string, slot: number, metric: QuestMetric): QuestDef {
  const m = METRICS[metric];
  const seed = hash(`${period}:${key}:${slot}:${metric}`);
  const base = period === 'daily' ? m.daily : m.weekly;
  const jitter = (seed % 5) * m.step; // 0..4 steps of variance, identical for all players that period
  const target = base + jitter;
  const rewardXp = period === 'daily' ? 80 + target * (metric === 'kills' ? 0.1 : 4) : 350 + target * (metric === 'kills' ? 0.15 : 8);
  const rewardSalvage = period === 'daily' ? 30 + Math.round(target * (metric === 'kills' ? 0.02 : 1)) : 120 + Math.round(target * (metric === 'kills' ? 0.04 : 3));
  return {
    id: `q-${period === 'daily' ? 'd' : 'w'}-${key}-${slot}`,
    period, metric, target,
    title: m.verb(target),
    desc: period === 'daily' ? 'Daily operation' : 'Weekly operation',
    rewardXp: Math.round(rewardXp), rewardSalvage: Math.round(rewardSalvage),
    scope: m.scope,
  };
}

export function dailyQuests(now = new Date()): QuestDef[] {
  const key = dateKey(now);
  const metrics = pickMany(DAILY_POOL, hash(`daily:${key}`), 3);
  return metrics.map((m, i) => makeQuest('daily', key, i, m));
}
export function weeklyQuests(now = new Date()): QuestDef[] {
  const key = weekKey(now);
  const metrics = pickMany(WEEKLY_POOL, hash(`weekly:${key}`), 2);
  return metrics.map((m, i) => makeQuest('weekly', key, i, m));
}
export function operationsBoard(now = new Date()): QuestDef[] {
  return [...dailyQuests(now), ...weeklyQuests(now)];
}

// ---- streak (reads existing sessionDays) ----
export interface StreakInfo { current: number; best: number; activeToday: boolean; brokenYesterday: boolean; lastDay: string; }
function dayKeyOffset(now: Date, deltaDays: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + deltaDays));
  return d.toISOString().slice(0, 10);
}
export function computeStreak(sessionDays: Record<string, number>, now = new Date()): StreakInfo {
  const today = dayKeyOffset(now, 0);
  const yesterday = dayKeyOffset(now, -1);
  const activeToday = (sessionDays[today] ?? 0) > 0;
  // walk back from the most recent active anchor day
  let anchor = activeToday ? 0 : (sessionDays[yesterday] ?? 0) > 0 ? -1 : null;
  let current = 0, lastDay = '';
  if (anchor !== null) {
    let i = anchor;
    while ((sessionDays[dayKeyOffset(now, i)] ?? 0) > 0) { current++; if (!lastDay) lastDay = dayKeyOffset(now, i); i--; }
  }
  // broken-yesterday: had a streak ending yesterday-or-before but NOT today, comeback-eligible
  const brokenYesterday = !activeToday && current > 0;
  const best = Math.max(cache.bestStreak, current);
  return { current, best, activeToday, brokenYesterday, lastDay };
}

// ---- the meta singleton ----
function progressFor(q: QuestDef): number { return cache.questProgress[q.id] ?? 0; }

export const meta = {
  get xp(): number { ensureSeeded(); return cache.xp; },
  get rank(): RankInfo { ensureSeeded(); return rankFromXp(cache.xp); },
  get salvage(): number { return cache.salvage; },
  get salvageLifetime(): number { return cache.salvageLifetime; },
  get streak(): StreakInfo { return computeStreak(progress.sessionDays); },

  board(now = new Date()): QuestWithProgress[] {
    return operationsBoard(now).map((q) => {
      const prog = progressFor(q);
      return { ...q, progress: prog, complete: prog >= q.target, claimed: cache.questClaimed.includes(q.id) };
    });
  },

  /** Credit a finished run (XP + salvage + quest progress). Idempotent per runId. */
  creditRun(runId: string, input: RunRewardInput, extras: QuestRunExtras, now = new Date()): RunMetaReward {
    ensureSeeded();
    const zero: RunMetaReward = { xp: 0, salvage: 0, breakdown: [] };
    if (DEMO_MODE) return zero;
    if (runId && cache.creditedRuns.includes(runId)) return zero;
    if (input.outcome === 'abandoned') return zero;

    const reward = deriveRunReward(input);
    cache.xp += reward.xp;
    cache.salvage += reward.salvage;
    cache.salvageLifetime += reward.salvage;
    advanceQuests(input, extras, now);

    if (runId) {
      cache.creditedRuns.push(runId);
      if (cache.creditedRuns.length > CREDITED_CAP) cache.creditedRuns = cache.creditedRuns.slice(-CREDITED_CAP);
    }
    const s = computeStreak(progress.sessionDays, now);
    if (s.current > cache.bestStreak) cache.bestStreak = s.current;
    save();
    return reward;
  },

  claimQuest(id: string, now = new Date()): RunMetaReward | null {
    const q = operationsBoard(now).find((x) => x.id === id);
    if (!q) return null;
    if (cache.questClaimed.includes(id)) return null;
    if (progressFor(q) < q.target) return null;
    cache.questClaimed.push(id);
    cache.xp += q.rewardXp;
    cache.salvage += q.rewardSalvage;
    cache.salvageLifetime += q.rewardSalvage;
    save();
    return { xp: q.rewardXp, salvage: q.rewardSalvage, breakdown: [{ label: q.title, xp: q.rewardXp, salvage: q.rewardSalvage }] };
  },

  markComebackSeen(dayKey: string) { cache.comebackSeenFor = dayKey; save(); },
  get comebackSeenFor(): string { return cache.comebackSeenFor; },

  owns(id: string): boolean { return cache.cosmetics.includes(id); },
  buyCosmetic(id: string, cost: number): boolean {
    if (cache.cosmetics.includes(id) || cache.salvage < cost) return false;
    cache.salvage -= cost; cache.cosmetics.push(id); save(); return true;
  },
  equip(slot: string, id: string) { cache.cosmeticEquipped[slot] = id; save(); },

  reset() { cache = fresh(); save(); },
};

// advance quest counters from a finished run (called inside creditRun, after idempotency check)
function advanceQuests(input: RunRewardInput, extras: QuestRunExtras, now: Date) {
  const board = operationsBoard(now);
  const contrib: Record<QuestMetric, number> = {
    wavesCleared: input.wave,
    kills: input.kills,
    runsCompleted: 1,
    campaignWins: input.won && !input.freeplay ? 1 : 0,
    freeplayWave: input.freeplay ? input.wave : 0,
    towerKindsUsed: extras.towerKindsUsed,
    abilitiesCast: extras.abilitiesCast,
    reachWave: input.wave,
  };
  for (const q of board) {
    if (q.scope?.freeplay != null && q.scope.freeplay !== input.freeplay) continue;
    const m = METRICS[q.metric];
    const v = contrib[q.metric];
    const prev = cache.questProgress[q.id] ?? 0;
    cache.questProgress[q.id] = m.max ? Math.max(prev, v) : prev + v;
  }
}
