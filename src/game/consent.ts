// Shared consent + age-gate foundation. Single source of truth for the privacy
// contract every write/score path must honor. Framework-light (no React/router):
// a module-level cache backed by localStorage, plus a tiny pub/sub so the UI and
// storage layers can react without prop-drilling.
//
// Contract (do not drift):
//   localStorage 'nvd-consent-v1' = { ageBand, birthYear?, sell, gpc, ts }
//   consentTier() === 'full'  iff  ageBand==='adult' && sell!=='optout' && !gpc
//   canWriteAnalytics()       === consentTier()==='full'   (gates heavy writes + telemetry)
//   canSubmitScore()          === ageBand==='adult'        (under-13 may PLAY, never post)
//   run replay is gated on canSubmitScore (score-tier), NOT canWriteAnalytics, so a
//   privacy-conscious adult (opted out of sale / GPC on) can still post a verifiable score.
//   under-13 => permanent restricted COPPA-safe path; 'unknown' => restricted until answered.

const KEY = 'nvd-consent-v1';

/** Minimum age to post to a public leaderboard / persist a callsign (US COPPA line is <13). */
export const ADULT_MIN_AGE = 13;

export type AgeBand = 'unknown' | 'under13' | 'adult';
export type SellChoice = 'unset' | 'optout' | 'ok';
export type ConsentTier = 'full' | 'restricted';

export interface ConsentState {
  ageBand: AgeBand;
  /** retained only to recompute the band; never sent off-device */
  birthYear?: number;
  sell: SellChoice;
  /** Global Privacy Control signal observed from the browser */
  gpc: boolean;
  /** last time the user changed a consent value (or first init) */
  ts: number;
}

function defaults(): ConsentState {
  return { ageBand: 'unknown', sell: 'unset', gpc: false, ts: 0 };
}

/** True when the browser is asserting Global Privacy Control. */
function detectGpc(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function sanitize(raw: unknown): ConsentState {
  if (!raw || typeof raw !== 'object') return defaults();
  const o = raw as Partial<ConsentState>;
  const ageBand: AgeBand =
    o.ageBand === 'under13' || o.ageBand === 'adult' ? o.ageBand : 'unknown';
  const sell: SellChoice =
    o.sell === 'optout' || o.sell === 'ok' ? o.sell : 'unset';
  const birthYear =
    typeof o.birthYear === 'number' && Number.isFinite(o.birthYear) ? o.birthYear : undefined;
  return {
    ageBand,
    birthYear,
    sell,
    gpc: o.gpc === true,
    ts: typeof o.ts === 'number' && Number.isFinite(o.ts) ? o.ts : 0,
  };
}

function load(): ConsentState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const state = raw ? sanitize(JSON.parse(raw)) : defaults();
    // GPC is sticky-once-true: a header observed this load OR persisted earlier stays on.
    state.gpc = state.gpc || detectGpc();
    return state;
  } catch {
    const state = defaults();
    state.gpc = detectGpc();
    return state;
  }
}

let cache = load();

function save(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* storage full or blocked — non-fatal, in-memory state still governs this session */ }
}

// ---- pub/sub (router-free reactivity for the UI) ----
type Listener = (state: ConsentState) => void;
const listeners = new Set<Listener>();

/** Subscribe to consent changes. Returns an unsubscribe fn. */
export function onConsentChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(): void {
  const snapshot = consentState();
  for (const fn of [...listeners]) {
    try { fn(snapshot); } catch { /* a bad listener must not break consent writes */ }
  }
}

// ---- getters ----

/** Immutable snapshot of the current consent state (GPC re-checked lazily). */
export function consentState(): ConsentState {
  // The navigator flag can resolve after first paint; fold a late true back in.
  if (!cache.gpc && detectGpc()) { cache.gpc = true; save(); }
  return { ...cache };
}

export function ageBand(): AgeBand {
  return cache.ageBand;
}

export function sellChoice(): SellChoice {
  return cache.sell;
}

export function gpcActive(): boolean {
  if (!cache.gpc && detectGpc()) { cache.gpc = true; save(); }
  return cache.gpc;
}

/** 'full' unlocks heavy analytics; anything else is the restricted/COPPA-safe path. */
export function consentTier(): ConsentTier {
  return cache.ageBand === 'adult' && cache.sell !== 'optout' && !gpcActive()
    ? 'full'
    : 'restricted';
}

/** Gate for heavy analytics writes: runCheckpoints, runAnalytics, AND telemetry. */
export function canWriteAnalytics(): boolean {
  return consentTier() === 'full';
}

/** Gate for posting to any public leaderboard, persisting a callsign, AND the run replay
 *  (the replay backs score verification, so it is a score-tier — not analytics-tier — write). */
export function canSubmitScore(): boolean {
  return cache.ageBand === 'adult';
}

/** True until the entry age gate has been answered; blocks first paint. */
export function needsAgeGate(): boolean {
  return cache.ageBand === 'unknown';
}

// ---- setters ----

/**
 * Record the neutral age-gate answer from a birth year. Computes the band on-device.
 * Under-13 is a permanent restricted path: callers present this once at entry.
 * Invalid/empty years leave the band 'unknown' (gate stays up).
 */
export function setAgeFromBirthYear(birthYear: number): AgeBand {
  const year = Math.floor(birthYear);
  const nowYear = new Date().getFullYear();
  // reject implausible years; gate remains unanswered
  if (!Number.isFinite(year) || year < 1900 || year > nowYear) {
    return cache.ageBand;
  }
  const age = nowYear - year;
  cache.birthYear = year;
  cache.ageBand = age >= ADULT_MIN_AGE ? 'adult' : 'under13';
  cache.ts = Date.now();
  save();
  emit();
  return cache.ageBand;
}

/** Set the "sell/share my data" preference. 'optout' forces restricted tier. */
export function setSell(choice: SellChoice): void {
  if (choice !== 'unset' && choice !== 'optout' && choice !== 'ok') return;
  cache.sell = choice;
  cache.ts = Date.now();
  save();
  emit();
}

/** Convenience for a one-click "Do Not Sell/Share" control (CCPA). */
export function optOutOfSale(): void {
  setSell('optout');
}

/** Clear all consent state (e.g. a privacy "reset choices" affordance). Returns gate to 'unknown'. */
export function resetConsent(): void {
  cache = defaults();
  cache.gpc = detectGpc();
  save();
  emit();
}
