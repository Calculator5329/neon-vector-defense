import type { RunAnalyticsRow } from './game/leaderboard';
import { TOWERS } from './game/towers';

export interface InsightBuildSelection {
  build: string;
  compareBuild: string;
}

export interface SurvivalPoint {
  wave: number;
  reached: number;
  cleared: number;
  clearRate: number;
}

export interface SurvivalCurve {
  diff: string;
  runs: number;
  points: SurvivalPoint[];
  cliffs: SurvivalPoint[];
}

export interface AbandonmentBucket {
  wave: number;
  abandons: number;
  firstSession: number;
  returning: number;
  quitWithCash: number;
  quitWithCashRate: number;
}

export interface ArsenalHealthRow {
  towerId: string;
  name: string;
  runs: number;
  wins: number;
  usageRate: number;
  winRate: number;
  winPresence: number;
  avgDamageShare: number;
  flags: Array<'dead' | 'dominant'>;
}

export interface InsightMetricSet {
  label: string;
  rows: number;
  wins: number;
  winRate: number;
  avgWave: number;
  survival: SurvivalCurve[];
  abandonment: {
    total: number;
    firstSession: number;
    returning: number;
    quitWithCash: number;
    quitWithCashRate: number;
    buckets: AbandonmentBucket[];
  };
  arsenal: ArsenalHealthRow[];
}

export interface AdminInsightsReport {
  rows: number;
  builds: string[];
  activeBuild: string;
  compareBuild: string;
  active: InsightMetricSet;
  compare: InsightMetricSet | null;
}

const CASH_QUIT_THRESHOLD = 800;
const MIN_CLIFF_REACHED = 2;

export function buildAdminInsights(
  rows: RunAnalyticsRow[],
  selection: Partial<InsightBuildSelection> = {},
): AdminInsightsReport {
  const builds = [...new Set(rows.map((row) => row.build).filter(Boolean))].sort();
  const activeBuild = selection.build && (selection.build === 'all' || builds.includes(selection.build)) ? selection.build : 'all';
  const compareBuild = selection.compareBuild && (selection.compareBuild === 'none' || builds.includes(selection.compareBuild))
    ? selection.compareBuild
    : 'none';
  const activeRows = filterBuild(rows, activeBuild);
  const compareRows = compareBuild === 'none' ? [] : filterBuild(rows, compareBuild);
  return {
    rows: rows.length,
    builds,
    activeBuild,
    compareBuild,
    active: metricSet(activeBuild === 'all' ? 'All builds' : activeBuild, activeRows),
    compare: compareBuild === 'none' ? null : metricSet(compareBuild, compareRows),
  };
}

export function survivalCurves(rows: RunAnalyticsRow[]): SurvivalCurve[] {
  const diffs = [...new Set(rows.map((row) => row.summary.diff).filter(Boolean))].sort();
  return diffs.map((diff) => {
    const slice = rows.filter((row) => row.summary.diff === diff);
    const maxWave = Math.max(0, ...slice.map((row) => safeInt(row.summary.wave)));
    const points: SurvivalPoint[] = [];
    for (let wave = 1; wave <= maxWave; wave++) {
      const reached = slice.filter((row) => safeInt(row.summary.wave) >= wave).length;
      if (reached === 0) continue;
      const cleared = slice.filter((row) => clearedWave(row, wave)).length;
      points.push({ wave, reached, cleared, clearRate: cleared / reached });
    }
    const cliffs = [...points]
      .filter((point) => point.reached >= MIN_CLIFF_REACHED && point.clearRate < 0.7)
      .sort((a, b) => a.clearRate - b.clearRate || b.reached - a.reached)
      .slice(0, 4);
    return { diff, runs: slice.length, points, cliffs };
  });
}

export function abandonmentBuckets(rows: RunAnalyticsRow[]): InsightMetricSet['abandonment'] {
  const abandoned = rows.filter((row) => row.summary.outcome === 'abandoned');
  const buckets = new Map<number, AbandonmentBucket>();
  for (const row of abandoned) {
    const wave = safeInt(row.summary.wave);
    const bucket = buckets.get(wave) ?? {
      wave,
      abandons: 0,
      firstSession: 0,
      returning: 0,
      quitWithCash: 0,
      quitWithCashRate: 0,
    };
    bucket.abandons++;
    if (safeNumber(row.progression.runsBeforeStart) <= 0) bucket.firstSession++;
    else bucket.returning++;
    if (quitWithCash(row)) bucket.quitWithCash++;
    bucket.quitWithCashRate = bucket.quitWithCash / Math.max(1, bucket.abandons);
    buckets.set(wave, bucket);
  }
  const firstSession = abandoned.filter((row) => safeNumber(row.progression.runsBeforeStart) <= 0).length;
  const quitWithCashCount = abandoned.filter(quitWithCash).length;
  return {
    total: abandoned.length,
    firstSession,
    returning: abandoned.length - firstSession,
    quitWithCash: quitWithCashCount,
    quitWithCashRate: quitWithCashCount / Math.max(1, abandoned.length),
    buckets: [...buckets.values()].sort((a, b) => b.abandons - a.abandons || a.wave - b.wave),
  };
}

export function arsenalHealth(rows: RunAnalyticsRow[]): ArsenalHealthRow[] {
  const totalRuns = Math.max(1, rows.length);
  const totalWins = Math.max(1, rows.filter((row) => row.summary.outcome === 'victory').length);
  return TOWERS.map((tower) => {
    let runs = 0;
    let wins = 0;
    let winPresenceCount = 0;
    let damageShareTotal = 0;
    let damageShareRows = 0;
    for (const row of rows) {
      const placed = recordValue(row.placement.placedByTower, tower.id);
      const used = placed > 0 || row.placement.buildOrder.includes(tower.id);
      if (used) {
        runs++;
        if (row.summary.outcome === 'victory') wins++;
      }
      if (row.summary.outcome === 'victory' && used) winPresenceCount++;
      const share = damageShare(row, tower.id);
      if (share > 0) {
        damageShareTotal += share;
        damageShareRows++;
      }
    }
    const usageRate = runs / totalRuns;
    const winPresence = winPresenceCount / totalWins;
    const flags: ArsenalHealthRow['flags'] = [];
    if (usageRate < 0.05) flags.push('dead');
    if (winPresence > 0.6) flags.push('dominant');
    return {
      towerId: tower.id,
      name: tower.name,
      runs,
      wins,
      usageRate,
      winRate: wins / Math.max(1, runs),
      winPresence,
      avgDamageShare: damageShareRows ? damageShareTotal / damageShareRows : 0,
      flags,
    };
  }).sort((a, b) => b.usageRate - a.usageRate || b.winPresence - a.winPresence || a.name.localeCompare(b.name));
}

function metricSet(label: string, rows: RunAnalyticsRow[]): InsightMetricSet {
  const wins = rows.filter((row) => row.summary.outcome === 'victory').length;
  return {
    label,
    rows: rows.length,
    wins,
    winRate: wins / Math.max(1, rows.length),
    avgWave: rows.reduce((sum, row) => sum + safeNumber(row.summary.wave), 0) / Math.max(1, rows.length),
    survival: survivalCurves(rows),
    abandonment: abandonmentBuckets(rows),
    arsenal: arsenalHealth(rows),
  };
}

function filterBuild(rows: RunAnalyticsRow[], build: string): RunAnalyticsRow[] {
  return build === 'all' ? rows : rows.filter((row) => row.build === build);
}

function clearedWave(row: RunAnalyticsRow, wave: number): boolean {
  const finalWave = safeInt(row.summary.wave);
  return finalWave > wave || (finalWave >= wave && row.summary.outcome === 'victory');
}

function quitWithCash(row: RunAnalyticsRow): boolean {
  return safeNumber(row.abandonment.quitWithCash) >= CASH_QUIT_THRESHOLD
    || safeNumber(row.economy.cashFloatedEnd) >= CASH_QUIT_THRESHOLD
    || safeNumber(row.summary.credits) >= CASH_QUIT_THRESHOLD;
}

function damageShare(row: RunAnalyticsRow, towerId: string): number {
  const candidates = [
    (row.difficulty as Record<string, unknown>).damageByTower,
    (row.difficulty as Record<string, unknown>).damageShareByTower,
  ];
  for (const candidate of candidates) {
    const value = recordValue(asRecord(candidate), towerId);
    if (value > 0) return value > 1 ? value / 100 : value;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordValue(record: Record<string, unknown>, key: string): number {
  return safeNumber(record[key]);
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeInt(value: unknown): number {
  return Math.max(0, Math.floor(safeNumber(value)));
}
