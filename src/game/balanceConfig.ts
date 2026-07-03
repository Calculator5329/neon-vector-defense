// Remote balance config — hot-patch tower/enemy/difficulty numbers WITHOUT a redeploy.
// A single sparse Firestore doc (config/balance) is read once on boot; its values pass
// through a clamp layer into an always-valid singleton the engine consults at the points
// where static numbers become live. A missing doc / network failure / out-of-range field
// falls back to identity (1×) — the doc only OVERRIDES, never DEFINES.
//
// IMPORTANT: every diff field is a MULTIPLIER on top of the static DifficultyDef value
// (e.g. effectiveHpMult = diff.hpMult * cfg.diff(id).hpMult). An empty doc is an exact no-op.
//
// Wire shape (all optional, admin-authored, clamped to [0.25, 4]):
//   { version?, income?:{killMult?,waveBonusMult?}, global?:{abilityCooldownMult?},
//     diffs?:{ [diffId]:{hpMult?,lateScale?,costMult?,cashMult?,livesMult?} },
//     enemies?:{ [enemyId]:{hpMult?,rewardMult?,speedMult?} },
//     towers?:{ [towerId]:{costMult?,damageMult?,rangeMult?,fireRateMult?,projectileSpeedMult?,splashMult?,slowMult?,burnMult?} } }

import { firestore } from './firestoreLazy';

export interface BalanceConfigDoc {
  version?: string;
  income?: { killMult?: number; waveBonusMult?: number };
  global?: { abilityCooldownMult?: number };
  diffs?: Record<string, { hpMult?: number; lateScale?: number; costMult?: number; cashMult?: number; livesMult?: number }>;
  enemies?: Record<string, { hpMult?: number; rewardMult?: number; speedMult?: number }>;
  towers?: Record<string, {
    costMult?: number; damageMult?: number; rangeMult?: number; fireRateMult?: number;
    projectileSpeedMult?: number; splashMult?: number; slowMult?: number; burnMult?: number;
  }>;
}

export interface DiffOverride { hpMult: number; lateScale: number; costMult: number; cashMult: number; livesMult: number }
export interface EnemyOverride { hpMult: number; rewardMult: number; speedMult: number }
export interface TowerOverride {
  costMult: number; damageMult: number; rangeMult: number; fireRateMult: number;
  projectileSpeedMult: number; splashMult: number; slowMult: number; burnMult: number;
}

export interface ResolvedBalance {
  version: string;
  killMult: number;
  waveBonusMult: number;
  abilityCooldownMult: number;
  diff(id: string): DiffOverride;
  enemy(id: string): EnemyOverride;
  tower(id: string): TowerOverride;
}

const IDENTITY_DIFF: DiffOverride = { hpMult: 1, lateScale: 1, costMult: 1, cashMult: 1, livesMult: 1 };
const IDENTITY_ENEMY: EnemyOverride = { hpMult: 1, rewardMult: 1, speedMult: 1 };
const IDENTITY_TOWER: TowerOverride = {
  costMult: 1, damageMult: 1, rangeMult: 1, fireRateMult: 1,
  projectileSpeedMult: 1, splashMult: 1, slowMult: 1, burnMult: 1,
};

/** Reject NaN/Infinity, then bound to [min,max]; missing → default. */
function clampMult(n: unknown, def = 1, min = 0.25, max = 4): number {
  const x = typeof n === 'number' ? n : NaN;
  if (!Number.isFinite(x)) return def;
  return Math.min(max, Math.max(min, x));
}

const IDENTITY: ResolvedBalance = {
  version: '',
  killMult: 1,
  waveBonusMult: 1,
  abilityCooldownMult: 1,
  diff: () => IDENTITY_DIFF,
  enemy: () => IDENTITY_ENEMY,
  tower: () => IDENTITY_TOWER,
};

let current: ResolvedBalance = IDENTITY;
let currentDoc: BalanceConfigDoc | null = null;

/** Validate + clamp a raw (untrusted) doc into the always-valid resolved view, or reset to identity. */
export function setBalanceDoc(raw: BalanceConfigDoc | null | undefined): void {
  if (!raw || typeof raw !== 'object') { current = IDENTITY; currentDoc = null; return; }
  currentDoc = cloneBalanceDoc(raw);
  const version = typeof raw.version === 'string' ? raw.version.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 30) : '';
  const killMult = clampMult(raw.income?.killMult);
  const waveBonusMult = clampMult(raw.income?.waveBonusMult);
  const abilityCooldownMult = clampMult(raw.global?.abilityCooldownMult);
  const diffs = (raw.diffs && typeof raw.diffs === 'object') ? raw.diffs : {};
  const enemies = (raw.enemies && typeof raw.enemies === 'object') ? raw.enemies : {};
  const towers = (raw.towers && typeof raw.towers === 'object') ? raw.towers : {};
  current = {
    version,
    killMult,
    waveBonusMult,
    abilityCooldownMult,
    diff: (id) => {
      const d = diffs[id];
      if (!d || typeof d !== 'object') return IDENTITY_DIFF;
      return {
        hpMult: clampMult(d.hpMult), lateScale: clampMult(d.lateScale), costMult: clampMult(d.costMult),
        cashMult: clampMult(d.cashMult), livesMult: clampMult(d.livesMult),
      };
    },
    enemy: (id) => {
      const e = enemies[id];
      if (!e || typeof e !== 'object') return IDENTITY_ENEMY;
      return { hpMult: clampMult(e.hpMult), rewardMult: clampMult(e.rewardMult), speedMult: clampMult(e.speedMult) };
    },
    tower: (id) => {
      const t = towers[id];
      if (!t || typeof t !== 'object') return IDENTITY_TOWER;
      return {
        costMult: clampMult(t.costMult), damageMult: clampMult(t.damageMult),
        rangeMult: clampMult(t.rangeMult), fireRateMult: clampMult(t.fireRateMult),
        projectileSpeedMult: clampMult(t.projectileSpeedMult), splashMult: clampMult(t.splashMult),
        slowMult: clampMult(t.slowMult), burnMult: clampMult(t.burnMult),
      };
    },
  };
}

export function getBalance(): ResolvedBalance { return current; }
export function balanceVersion(): string { return current.version; }
export function balanceDocSnapshot(): BalanceConfigDoc | null {
  return currentDoc ? cloneBalanceDoc(currentDoc) : null;
}

function cloneBalanceDoc(raw: BalanceConfigDoc): BalanceConfigDoc {
  return JSON.parse(JSON.stringify(raw)) as BalanceConfigDoc;
}

/** Fetch config/balance once on boot (public read), races a timeout so a blocked/CSP
 *  Firestore promise can't hang. Any failure leaves identity balance in place. */
export async function loadRemoteBalance(): Promise<void> {
  try {
    const { fs, db } = await firestore();
    const snap = await Promise.race([
      fs.getDoc(fs.doc(db, 'config', 'balance')),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    if (snap.exists()) setBalanceDoc(snap.data() as BalanceConfigDoc);
  } catch {
    /* offline / blocked / missing — identity stays */
  }
}
