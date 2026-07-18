import type { BalanceConfigDoc } from './balanceConfig';
import type { TowerDef, TowerStats } from './types';

export const BALANCE_MULT_MIN = 0.25;
export const BALANCE_MULT_MAX = 4;

export const TOWER_BALANCE_FIELDS = [
  'costMult',
  'damageMult',
  'rangeMult',
  'fireRateMult',
  'projectileSpeedMult',
  'splashMult',
  'slowMult',
  'burnMult',
] as const;

export const ENEMY_BALANCE_FIELDS = ['hpMult', 'rewardMult', 'speedMult'] as const;
export const DIFF_BALANCE_FIELDS = [
  'hpMult',
  'lateScale',
  'costMult',
  'cashMult',
  'livesMult',
  'earlyWaveCashMult',
  'earlyWaveCashStart',
  'earlyWaveCashEnd',
] as const;
export const INCOME_BALANCE_FIELDS = ['killMult', 'waveBonusMult'] as const;
export const GLOBAL_BALANCE_FIELDS = ['abilityCooldownMult'] as const;

export type TowerBalanceField = typeof TOWER_BALANCE_FIELDS[number];
export type EnemyBalanceField = typeof ENEMY_BALANCE_FIELDS[number];
export type DiffBalanceField = typeof DIFF_BALANCE_FIELDS[number];
export type IncomeBalanceField = typeof INCOME_BALANCE_FIELDS[number];
export type GlobalBalanceField = typeof GLOBAL_BALANCE_FIELDS[number];
export type NestedBalanceSection = 'towers' | 'enemies' | 'diffs';
export type FlatBalanceSection = 'income' | 'global';

export interface BalanceOverrideRow {
  path: string;
  value: number | string;
}

export interface TowerPreviewStats {
  cost: number;
  damage: number;
  range: number;
  fireRate: number;
  projectileSpeed: number;
  splash: number;
  slowPower: number;
  burnDps: number;
  burnZoneRadius: number;
  burnZoneDps: number;
}

export interface TowerPreviewRow {
  label: string;
  tierA: number;
  tierB: number;
  staticStats: TowerPreviewStats;
  overriddenStats: TowerPreviewStats;
}

const NESTED_FIELDS = {
  towers: TOWER_BALANCE_FIELDS,
  enemies: ENEMY_BALANCE_FIELDS,
  diffs: DIFF_BALANCE_FIELDS,
} as const;

const FLAT_FIELDS = {
  income: INCOME_BALANCE_FIELDS,
  global: GLOBAL_BALANCE_FIELDS,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const version = value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 30);
  return version || undefined;
}

export function clampBalanceMult(input: unknown, fallback = 1): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(BALANCE_MULT_MAX, Math.max(BALANCE_MULT_MIN, n));
}

function sanitizeFlat<const F extends readonly string[]>(
  raw: unknown,
  fields: F,
): Partial<Record<F[number], number>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<F[number], number>> = {};
  for (const field of fields) {
    const key = field as F[number];
    if (field in raw) out[key] = clampBalanceMult(raw[field]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeNested<const F extends readonly string[]>(
  raw: unknown,
  fields: F,
): Record<string, Partial<Record<F[number], number>>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, Partial<Record<F[number], number>>> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const clean = sanitizeFlat(entry, fields);
    if (clean) out[id.slice(0, 48)] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeBalanceDoc(raw: unknown): BalanceConfigDoc {
  if (!isRecord(raw)) return {};
  const out: BalanceConfigDoc = {};
  const version = cleanVersion(raw.version);
  const income = sanitizeFlat(raw.income, INCOME_BALANCE_FIELDS);
  const global = sanitizeFlat(raw.global, GLOBAL_BALANCE_FIELDS);
  const diffs = sanitizeNested(raw.diffs, DIFF_BALANCE_FIELDS);
  const enemies = sanitizeNested(raw.enemies, ENEMY_BALANCE_FIELDS);
  const towers = sanitizeNested(raw.towers, TOWER_BALANCE_FIELDS);
  if (version) out.version = version;
  if (income) out.income = income;
  if (global) out.global = global;
  if (diffs) out.diffs = diffs;
  if (enemies) out.enemies = enemies;
  if (towers) out.towers = towers;
  return out;
}

function pruneFlat<const F extends readonly string[]>(
  raw: unknown,
  fields: F,
): Partial<Record<F[number], number>> | undefined {
  const clean = sanitizeFlat(raw, fields);
  if (!clean) return undefined;
  const out: Partial<Record<F[number], number>> = {};
  for (const field of fields) {
    const key = field as F[number];
    const value = clean[key];
    if (value !== undefined && value !== 1) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pruneNested<const F extends readonly string[]>(
  raw: unknown,
  fields: F,
): Record<string, Partial<Record<F[number], number>>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, Partial<Record<F[number], number>>> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const clean = pruneFlat(entry, fields);
    if (clean) out[id.slice(0, 48)] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function pruneIdentityBalanceDoc(raw: unknown): BalanceConfigDoc {
  const clean = sanitizeBalanceDoc(raw);
  const out: BalanceConfigDoc = {};
  if (clean.version) out.version = clean.version;
  const income = pruneFlat(clean.income, INCOME_BALANCE_FIELDS);
  const global = pruneFlat(clean.global, GLOBAL_BALANCE_FIELDS);
  const diffs = pruneNested(clean.diffs, DIFF_BALANCE_FIELDS);
  const enemies = pruneNested(clean.enemies, ENEMY_BALANCE_FIELDS);
  const towers = pruneNested(clean.towers, TOWER_BALANCE_FIELDS);
  if (income) out.income = income;
  if (global) out.global = global;
  if (diffs) out.diffs = diffs;
  if (enemies) out.enemies = enemies;
  if (towers) out.towers = towers;
  return out;
}

export function setBalanceVersion(doc: BalanceConfigDoc, version: string): BalanceConfigDoc {
  const next = sanitizeBalanceDoc(doc);
  const clean = cleanVersion(version);
  if (clean) next.version = clean;
  else delete next.version;
  return next;
}

export function setNestedBalanceMult(
  doc: BalanceConfigDoc,
  section: NestedBalanceSection,
  id: string,
  field: string,
  value: unknown,
): BalanceConfigDoc {
  const allowed = NESTED_FIELDS[section] as readonly string[];
  if (!allowed.includes(field) || !id) return sanitizeBalanceDoc(doc);
  const next = sanitizeBalanceDoc(doc);
  const clean = clampBalanceMult(value);
  const sectionDoc = { ...(next[section] ?? {}) } as Record<string, Record<string, number>>;
  const row = { ...(sectionDoc[id] ?? {}) };
  if (clean === 1) delete row[field];
  else row[field] = clean;
  if (Object.keys(row).length > 0) sectionDoc[id] = row;
  else delete sectionDoc[id];
  if (Object.keys(sectionDoc).length > 0) {
    if (section === 'towers') next.towers = sectionDoc as BalanceConfigDoc['towers'];
    else if (section === 'enemies') next.enemies = sectionDoc as BalanceConfigDoc['enemies'];
    else next.diffs = sectionDoc as BalanceConfigDoc['diffs'];
  } else {
    delete next[section];
  }
  return next;
}

export function setFlatBalanceMult(
  doc: BalanceConfigDoc,
  section: FlatBalanceSection,
  field: string,
  value: unknown,
): BalanceConfigDoc {
  const allowed = FLAT_FIELDS[section] as readonly string[];
  if (!allowed.includes(field)) return sanitizeBalanceDoc(doc);
  const next = sanitizeBalanceDoc(doc);
  const clean = clampBalanceMult(value);
  const sectionDoc = { ...(next[section] ?? {}) } as Record<string, number>;
  if (clean === 1) delete sectionDoc[field];
  else sectionDoc[field] = clean;
  if (Object.keys(sectionDoc).length > 0) {
    if (section === 'income') next.income = sectionDoc as BalanceConfigDoc['income'];
    else next.global = sectionDoc as BalanceConfigDoc['global'];
  } else {
    delete next[section];
  }
  return next;
}

export function balanceOverrideRows(raw: unknown): BalanceOverrideRow[] {
  const doc = pruneIdentityBalanceDoc(raw);
  const rows: BalanceOverrideRow[] = [];
  if (doc.version) rows.push({ path: 'version', value: doc.version });
  for (const section of ['income', 'global'] as const) {
    const fields = FLAT_FIELDS[section];
    const sectionDoc = doc[section] as Record<string, number | undefined> | undefined;
    if (!sectionDoc) continue;
    for (const field of fields) {
      const value = sectionDoc[field];
      if (value !== undefined) rows.push({ path: `${section}.${field}`, value });
    }
  }
  for (const section of ['diffs', 'enemies', 'towers'] as const) {
    const sectionDoc = doc[section];
    if (!sectionDoc) continue;
    const fields = NESTED_FIELDS[section];
    for (const id of Object.keys(sectionDoc).sort()) {
      const row = sectionDoc[id] as Record<string, number>;
      for (const field of fields) {
        const value = row[field];
        if (value !== undefined) rows.push({ path: `${section}.${id}.${field}`, value });
      }
    }
  }
  return rows;
}

function computeStaticStats(def: TowerDef, tierA: number, tierB: number): TowerStats {
  const stats = { ...def.base };
  for (let i = 0; i < tierA; i++) def.tracks[0].upgrades[i].apply(stats);
  for (let i = 0; i < tierB; i++) def.tracks[1].upgrades[i].apply(stats);
  return stats;
}

function projectStats(cost: number, stats: TowerStats): TowerPreviewStats {
  return {
    cost: Math.round(cost),
    damage: round(stats.damage),
    range: round(stats.range),
    fireRate: round(stats.fireRate),
    projectileSpeed: round(stats.projectileSpeed),
    splash: round(stats.splash),
    slowPower: round(stats.slowPower),
    burnDps: round(stats.burnDps),
    burnZoneRadius: round(stats.burnZoneRadius),
    burnZoneDps: round(stats.burnZoneDps),
  };
}

function applyTowerOverride(stats: TowerStats, raw: unknown): TowerStats {
  if (!isRecord(raw)) return { ...stats };
  return {
    ...stats,
    damage: stats.damage * clampBalanceMult(raw.damageMult),
    range: stats.range * clampBalanceMult(raw.rangeMult),
    fireRate: stats.fireRate * clampBalanceMult(raw.fireRateMult),
    projectileSpeed: stats.projectileSpeed * clampBalanceMult(raw.projectileSpeedMult),
    splash: stats.splash * clampBalanceMult(raw.splashMult),
    burnZoneRadius: stats.burnZoneRadius * clampBalanceMult(raw.splashMult),
    slowPower: Math.min(0.95, stats.slowPower * clampBalanceMult(raw.slowMult)),
    burnDps: stats.burnDps * clampBalanceMult(raw.burnMult),
    burnZoneDps: stats.burnZoneDps * clampBalanceMult(raw.burnMult),
  };
}

export function towerPreviewRows(def: TowerDef, raw: unknown): TowerPreviewRow[] {
  const doc = sanitizeBalanceDoc(raw);
  const override = doc.towers?.[def.id];
  return [0, 3, 6].map((tier) => {
    const baseStats = computeStaticStats(def, tier, 0);
    const costMult = isRecord(override) ? clampBalanceMult(override.costMult) : 1;
    return {
      label: tier === 0 ? 'base' : `A${tier}`,
      tierA: tier,
      tierB: 0,
      staticStats: projectStats(def.cost, baseStats),
      overriddenStats: projectStats(def.cost * costMult, applyTowerOverride(baseStats, override)),
    };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
