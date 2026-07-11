/**
 * Lantern 7 — server-side leaderboard gate + data deletion.
 *
 * submitScore / submitDailyScore / submitWeeklyScore / submitGauntletScore:
 *   the ONLY writers to boards/* and ritual board collections.
 *   Clients no longer write board entries directly (firestore.rules: create:if false).
 *   We require a matching runs/{runId} replay to exist and sanity-bound the claimed
 *   score against the run's recorded summary, then rate-limit per uid, then write.
 *
 * deleteMyData: cascade-delete all docs keyed by a given anonymous uid.
 *
 * Trust model: the player uid is the Firebase Anonymous Auth uid from the
 * callable auth context — payload uids are ignored. Rate limits key on that
 * verified identity, so an attacker can no longer mint a fresh bucket per
 * request. Casual cheating is stopped (a forged score with no real replay, or
 * one wildly inconsistent with its replay, is rejected). A hand-crafted fake
 * replay can still pass — accepted launch posture (pragmatic MVP).
 */

import { initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { isAdminEmail } from './adminEmails.js';
import { mergeGlobalTopRows, type GlobalTopRow } from './aggregateHelpers.js';
import { partitionRunDeletions, validDeletedRunIds } from './deleteHelpers.js';
import {
  dailyChallengeForId,
  reSimulate,
  setBalanceDoc,
  setDailyOverrideDoc,
  setWeeklyOverrideDoc,
  weeklyChallengeForId,
  type ReSimResult,
} from './generated/reSimulate.js';
import { validateReplayManifest, type ReplayChunkInput } from './replayIntegrity.js';
import { applySalvagePurchase, readEntitlementState } from './entitlementHelpers.js';
import {
  canonicalLeaderboardCash,
  feedbackTokenHash,
  newFeedbackToken,
  RateLimitUnavailableError,
  rateLimitOk,
  replayTokenHash,
  sanitizeFeedbackReceipts,
  validUid,
  type RateLimitStore,
} from './securityHelpers.js';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db: Firestore = getFirestore();

const VALID_MAPS = new Set([
  'orbital', 'carousel', 'reactor', 'splice', 'mobius', 'mirror',
  'hyperlane', 'blackout', 'throat', 'foundry', 'umbral', 'cinder',
]);
const VALID_DIFFS = new Set(['easy', 'normal', 'hard', 'extinction']);

const BOARD_RE = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?<fp>_fp)?$/;
const DAILY_BOARD_RE = /^daily-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const WEEKLY_BOARD_RE = /^weekly-[0-9]{4}-W[0-9]{2}$/;
const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;
const UID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const REPLAY_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const CASH_MAX = 100_000_000;
const KILLS_MAX = 10_000_000;
const WAVE_MAX = 10_000;

const SCORE_SLACK = 1.25;
const WAVE_SLACK = 2;
const MIN_RUN_DURATION_S = 3;
const MAX_RUN_DURATION_S = 86_400;
const VERIFY_REASON_COLLECTION = 'runVerificationReasons';

const APP_CHECK_ENFORCED = process.env.ENFORCE_APP_CHECK === 'true';

function callableOptions(maxInstances: number, timeoutSeconds?: number) {
  return {
    region: 'us-central1' as const,
    cors: true,
    maxInstances,
    enforceAppCheck: APP_CHECK_ENFORCED,
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
  };
}

interface ClaimedScore {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid: string;
  runId: string;
  replayToken: string;
  meta?: string;
  daily?: string;
  weekly?: string;
  gauntlet?: string;
  checkpoint?: boolean;
}

interface SubmitResult {
  accepted: boolean;
  reason?: string;
  claimed: { cash: number; kills: number; wave: number };
  accepted_values?: { cash: number; kills: number; wave: number };
}

interface CanonicalScore {
  cash: number;
  kills: number;
  wave: number;
}

interface VerifyRunResult {
  runId: string;
  verdict: ReSimResult['verdict'];
  reason?: string;
  divergence?: ReSimResult['divergence'];
  rowsUpdated: number;
}

type ScoreBoardKind = 'standard' | 'daily' | 'weekly' | 'gauntlet';

interface WeeklyGauntletResult {
  published: boolean;
  reason?: string;
  gauntlet?: {
    week: string;
    runId: string;
    callsign: string;
    map: string;
    diff: string;
    seed: number;
    wave: number;
    kills: number;
  };
}

function n(v: unknown, fallback = 0): number {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/** Verified anonymous identity for player callables. Payload uids are never trusted. */
function requireAuthUid(req: CallableRequest): string {
  const uid = String(req.auth?.uid ?? '');
  if (!uid || !UID_RE.test(uid)) throw new HttpsError('unauthenticated', 'auth-required');
  return uid;
}

function requireAdmin(req: CallableRequest): void {
  const email = String(req.auth?.token?.email ?? '').toLowerCase();
  if (!req.auth || req.auth.token?.email_verified !== true || !isAdminEmail(email)) {
    throw new HttpsError('permission-denied', 'admin-only');
  }
}

function validBoard(board: string): boolean {
  const m = BOARD_RE.exec(board);
  return !!m?.groups && VALID_MAPS.has(m.groups.map) && VALID_DIFFS.has(m.groups.diff);
}

function boardIsFreeplay(board: string): boolean {
  return board.endsWith('_fp');
}

function dailyIdForOffset(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return `daily-${d.toISOString().slice(0, 10)}`;
}

function dailyIsCurrent(board: string): boolean {
  return board === dailyIdForOffset(0) || board === dailyIdForOffset(-1);
}

function isoWeekId(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `weekly-${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weeklyIdForOffset(offsetDays: number): string {
  return isoWeekId(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

function weeklyIsCurrent(board: string): boolean {
  return board === weeklyIdForOffset(0) || board === weeklyIdForOffset(-7);
}

function isoWeekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function readClaim(raw: unknown): ClaimedScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const name = String(d.name ?? '').slice(0, 20);
  const uid = String(d.uid ?? '');
  const runId = String(d.runId ?? '');
  const replayToken = String(d.replayToken ?? '');
  if (name.length < 1) return null;
  if (!UID_RE.test(uid)) return null;
  if (!RUN_ID_RE.test(runId)) return null;
  if (!REPLAY_TOKEN_RE.test(replayToken)) return null;
  const claim: ClaimedScore = {
    name,
    cash: Math.max(0, Math.floor(n(d.cash))),
    kills: Math.max(0, Math.floor(n(d.kills))),
    wave: Math.max(0, Math.floor(n(d.wave))),
    freeplay: !!d.freeplay,
    ts: Math.floor(n(d.ts, Date.now())),
    uid,
    runId,
    replayToken,
  };
  if (claim.cash >= CASH_MAX || claim.kills >= KILLS_MAX || claim.wave > WAVE_MAX) return null;
  if (typeof d.meta === 'string') claim.meta = d.meta.slice(0, 240);
  if (typeof d.daily === 'string') claim.daily = d.daily.slice(0, 80);
  if (typeof d.weekly === 'string') claim.weekly = d.weekly.slice(0, 80);
  if (typeof d.gauntlet === 'string') claim.gauntlet = d.gauntlet.slice(0, 80);
  if (d.checkpoint !== undefined) claim.checkpoint = !!d.checkpoint;
  return claim;
}

interface RunSummary {
  wave: number; kills: number; credits: number; cashEarned: number;
  coresLeft: number; durationS: number; freeplay: boolean;
  map: string; diff: string; outcome: string; daily?: string; weekly?: string; gauntlet?: string; scoreMultiplierEnd?: number;
}

/** Verify runs/{runId} exists and return the replay-derived canonical score. */
async function checkReplay(claim: ClaimedScore, board: string, kind: ScoreBoardKind): Promise<{ reason?: string; canonical?: CanonicalScore }> {
  const snap = await db.doc(`runs/${claim.runId}`).get();
  if (!snap.exists) return { reason: 'no-replay' };
  const run = snap.data() as Record<string, unknown>;

  const storedHash = String(run.replayTokenHash ?? '');
  if (!storedHash) return { reason: 'no-replay-token' };
  if (storedHash !== replayTokenHash(claim.replayToken)) return { reason: 'replay-token-mismatch' };

  const eventCount = n(run.eventCount, 0);
  if (eventCount <= 0) return { reason: 'empty-replay' };
  const chunkCount = Math.max(0, Math.min(100, Math.floor(n(run.chunkCount, 0))));
  if (!('manifest' in run)) return { reason: 'manifest-missing' };
  const chunkSnaps = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => db.doc(`runs/${claim.runId}/chunks/c${i}`).get()),
  );
  const chunks: ReplayChunkInput[] = chunkSnaps.map((chunkSnap) => {
    const data = chunkSnap.exists ? chunkSnap.data() as Record<string, unknown> : {};
    return {
      exists: chunkSnap.exists,
      actions: data.actions,
    };
  });
  const manifestStatus = validateReplayManifest(run, chunks);
  if (manifestStatus !== 'complete') return { reason: manifestStatus };

  const summary = (run.summary ?? {}) as Partial<RunSummary>;
  const recWave = n(summary.wave);
  const recKills = n(summary.kills);
  const recCashEarned = n(summary.cashEarned);
  const recCredits = n(summary.credits);
  const recDuration = n(summary.durationS);

  if (recDuration < MIN_RUN_DURATION_S) return { reason: 'too-short' };
  if (recDuration > MAX_RUN_DURATION_S) return { reason: 'too-long' };

  const createdAt = n(run.createdAt);
  const endedAt = n(run.endedAt);
  if (createdAt <= 0 || endedAt < createdAt) return { reason: 'bad-timestamps' };

  const ritual = kind !== 'standard';
  const wantFreeplay = !ritual && boardIsFreeplay(board);
  const canonicalCash = canonicalLeaderboardCash(Math.max(recCashEarned, recCredits), wantFreeplay, summary.scoreMultiplierEnd);
  const cashCeiling = Math.max(recCashEarned, recCredits, canonicalCash) * SCORE_SLACK + 5;
  if (claim.cash > cashCeiling) return { reason: 'cash-too-high' };
  if (claim.kills > recKills * SCORE_SLACK + 2) return { reason: 'kills-too-high' };
  if (claim.wave > recWave + WAVE_SLACK) return { reason: 'wave-too-high' };

  if (claim.freeplay !== wantFreeplay) return { reason: 'freeplay-mismatch' };

  if (kind === 'standard') {
    const m = BOARD_RE.exec(board);
    const setup = (run.setup ?? {}) as { map?: string; diff?: string };
    const runMap = String(summary.map ?? setup.map ?? '');
    const runDiff = String(summary.diff ?? setup.diff ?? '');
    if (m?.groups && runMap && runMap !== m.groups.map) return { reason: 'map-mismatch' };
    if (m?.groups && runDiff && runDiff !== m.groups.diff) return { reason: 'diff-mismatch' };
    if (summary.daily || summary.weekly || summary.gauntlet) return { reason: 'ritual-on-board' };
  } else if (kind === 'daily') {
    if (summary.freeplay) return { reason: 'daily-is-freeplay' };
    if (summary.daily !== board) return { reason: 'daily-mismatch' };
  } else if (kind === 'weekly') {
    if (summary.freeplay) return { reason: 'weekly-is-freeplay' };
    if (summary.weekly !== board) return { reason: 'weekly-mismatch' };
  } else {
    if (summary.freeplay) return { reason: 'gauntlet-is-freeplay' };
    if (summary.gauntlet !== board) return { reason: 'gauntlet-mismatch' };
  }

  return {
    canonical: {
      cash: canonicalCash,
      kills: Math.max(0, Math.floor(recKills)),
      wave: Math.max(0, Math.floor(recWave)),
    },
  };
}

async function processSubmit(claim: ClaimedScore, board: string, kind: ScoreBoardKind): Promise<SubmitResult> {
  const claimed = { cash: claim.cash, kills: claim.kills, wave: claim.wave };
  const acceptedAt = Date.now();

  const replay = await checkReplay(claim, board, kind);
  if (replay.reason || !replay.canonical) return { accepted: false, reason: replay.reason ?? 'bad-replay', claimed };
  const canonical = replay.canonical;

  if (!(await allowRateLimitedAction(claim.uid))) {
    return { accepted: false, reason: 'rate-limited', claimed };
  }

  const stored: Record<string, unknown> = {
    name: claim.name,
    cash: canonical.cash,
    kills: canonical.kills,
    wave: canonical.wave,
    freeplay: kind === 'standard' && boardIsFreeplay(board),
    ts: acceptedAt,
    clientTs: claim.ts,
    uid: claim.uid,
    runId: claim.runId,
    serverTs: FieldValue.serverTimestamp(),
  };
  if (claim.meta) stored.meta = claim.meta;
  if (claim.checkpoint !== undefined) stored.checkpoint = claim.checkpoint;
  if (kind === 'daily') stored.daily = board;
  if (kind === 'weekly') stored.weekly = board;
  if (kind === 'gauntlet') stored.gauntlet = board;

  const collPath = kind === 'daily'
    ? `dailyBoards/${board}/scores`
    : kind === 'weekly'
      ? `weeklyBoards/${board}/scores`
      : kind === 'gauntlet'
        ? `gauntletBoards/${board}/scores`
        : `boards/${board}/scores`;
  const docId = `${claim.uid}_${claim.runId}${claim.checkpoint ? `_w${canonical.wave}` : ''}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
  const rowRef = db.collection(collPath).doc(docId);
  await rowRef.set(stored, { merge: false });
  void verifyAcceptedRun(claim.runId, rowRef);

  // Maintain the single-doc global-top aggregate (campaign + freeplay lists)
  // so the client menu reads ONE doc instead of fanning out 40 board queries.
  // Daily boards are their own surface and stay out of the global view.
  // Best-effort: an aggregate failure must never reject an accepted score.
  if (kind === 'standard') {
    try {
      await updateGlobalTop({
        name: claim.name,
        cash: canonical.cash,
        kills: canonical.kills,
        wave: canonical.wave,
        freeplay: boardIsFreeplay(board),
        ts: acceptedAt,
        uid: claim.uid,
        runId: claim.runId,
        board,
        ...(claim.checkpoint !== undefined ? { checkpoint: claim.checkpoint } : {}),
      });
    } catch (error) {
      console.warn('globalTop aggregate update failed', error);
    }
  }

  return {
    accepted: true,
    claimed,
    accepted_values: canonical,
  };
}

const GLOBAL_TOP_PATH = 'aggregates/globalTop';

async function updateGlobalTop(entry: GlobalTopRow): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(GLOBAL_TOP_PATH);
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as { campaign?: GlobalTopRow[]; freeplay?: GlobalTopRow[] };
    const listKey = entry.freeplay ? 'freeplay' : 'campaign';
    const current = Array.isArray(data[listKey]) ? data[listKey]! : [];
    tx.set(ref, {
      schemaVersion: 1,
      campaign: listKey === 'campaign' ? mergeGlobalTopRows(current, entry) : (data.campaign ?? []),
      freeplay: listKey === 'freeplay' ? mergeGlobalTopRows(current, entry) : (data.freeplay ?? []),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });
  });
}

type ScoreRowRef = DocumentReference<DocumentData>;

async function readReSimBundle(runId: string): Promise<{ bundle?: { run: Record<string, unknown>; chunks: Array<Record<string, unknown>> }; reason?: string }> {
  const runSnap = await db.doc(`runs/${runId}`).get();
  if (!runSnap.exists) return { reason: 'no-replay' };
  const run = runSnap.data() as Record<string, unknown>;
  const chunkCount = Math.max(0, Math.min(100, Math.floor(n(run.chunkCount, 0))));
  const chunkSnaps = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => db.doc(`runs/${runId}/chunks/c${i}`).get()),
  );
  if (chunkSnaps.some((snap) => !snap.exists)) return { reason: 'missing replay chunk' };
  return {
    bundle: {
      run,
      chunks: chunkSnaps.map((snap) => snap.data() as Record<string, unknown>),
    },
  };
}

async function scoreRowsForRun(runId: string): Promise<ScoreRowRef[]> {
  const snap = await db.collectionGroup('scores').where('runId', '==', runId).get();
  return snap.docs
    .map((docSnap) => docSnap.ref)
    .filter((ref) => /^(boards|dailyBoards|weeklyBoards|gauntletBoards|gauntletProtocolBoards)\/[^/]+\/scores\/[^/]+$/.test(ref.path));
}

async function writeScoreVerdict(rows: ScoreRowRef[], verdict: ReSimResult['verdict']): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 450) {
    const batch = db.batch();
    const slice = rows.slice(i, i + 450);
    for (const row of slice) {
      batch.update(row, {
        verify: verdict,
        verifyTs: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    written += slice.length;
  }
  return written;
}

function compactUnknown(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return typeof value === 'string' ? value.slice(0, 240) : value;
  }
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return String(value).slice(0, 240);
  }
}

function compactDivergence(result: ReSimResult): Record<string, unknown> | undefined {
  if (result.divergence) {
    return {
      field: result.divergence.field.slice(0, 80),
      expected: compactUnknown(result.divergence.expected),
      actual: compactUnknown(result.divergence.actual),
      ...(result.divergence.at ? { at: result.divergence.at } : {}),
    };
  }
  return undefined;
}

function compactReason(result: ReSimResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    verdict: result.verdict,
    reason: String(result.reason ?? result.divergence?.field ?? 'unknown').slice(0, 160),
  };
  const divergence = compactDivergence(result);
  if (divergence) out.divergence = divergence;
  return out;
}

async function writeVerificationReason(runId: string, result: ReSimResult, rows: ScoreRowRef[], source: string): Promise<void> {
  const ref = db.doc(`${VERIFY_REASON_COLLECTION}/${runId}`);
  if (result.verdict === 'verified') {
    await ref.delete().catch(() => undefined);
    return;
  }
  await ref.set({
    schemaVersion: 1,
    runId,
    ...compactReason(result),
    rowCount: rows.length,
    rowPaths: rows.slice(0, 20).map((row) => row.path),
    source,
    verifyTs: FieldValue.serverTimestamp(),
  }, { merge: false });
}

/** The bundled engine boots with identity balance and no daily override; inject
 *  the live config docs so re-simulation runs under the same math the player saw.
 *  reSimulate itself compares balance versions and returns 'unverifiable' when
 *  the run was recorded under a balance we no longer have. */
interface ReSimConfigDocs {
  balance: Record<string, unknown> | null;
  balanceExists: boolean;
  dailyOverride: Record<string, unknown> | null;
  weeklyOverride: Record<string, unknown> | null;
  weeklyGauntlet: Record<string, unknown> | null;
}

async function loadReSimConfig(): Promise<ReSimConfigDocs> {
  const [balanceSnap, overrideSnap, weeklyOverrideSnap, weeklyGauntletSnap] = await Promise.all([
    db.doc('config/balance').get(),
    db.doc('config/dailyOverride').get(),
    db.doc('config/weeklyOverride').get(),
    db.doc('config/weeklyGauntlet').get(),
  ]);
  const balance = balanceSnap.exists ? balanceSnap.data() as Record<string, unknown> : null;
  const dailyOverride = overrideSnap.exists ? overrideSnap.data() as Record<string, unknown> : null;
  const weeklyOverride = weeklyOverrideSnap.exists ? weeklyOverrideSnap.data() as Record<string, unknown> : null;
  const weeklyGauntlet = weeklyGauntletSnap.exists ? weeklyGauntletSnap.data() as Record<string, unknown> : null;
  setBalanceDoc(balance);
  setDailyOverrideDoc(dailyOverride);
  setWeeklyOverrideDoc(weeklyOverride);
  return { balance, balanceExists: balanceSnap.exists, dailyOverride, weeklyOverride, weeklyGauntlet };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function snapshotNotAuthentic(): ReSimResult {
  return { verdict: 'unverifiable', reason: 'snapshot not authentic' };
}

function authenticateSetupSnapshots(run: Record<string, unknown>, config: ReSimConfigDocs): ReSimResult | null {
  const setup = (run.setup ?? {}) as Record<string, unknown>;
  // Presence must be symmetric: identity balance (no live doc) means the run
  // must carry NO snapshot, and a published live doc means it must carry one
  // that canonically matches. Either asymmetry is a forgery or a stale record.
  if (config.balanceExists !== ('balance' in setup)) return snapshotNotAuthentic();
  if (config.balanceExists && canonicalJson(setup.balance) !== canonicalJson(config.balance)) {
    return snapshotNotAuthentic();
  }

  // setupReplayGame applies setup.daily whenever it is present, so it must be
  // authenticated whenever present — a non-daily run smuggling a daily snapshot
  // (easy boons) would otherwise re-simulate under forged rules.
  const summary = (run.summary ?? {}) as Record<string, unknown>;
  const dailyId = typeof summary.daily === 'string' ? summary.daily : '';
  if (!dailyId && 'daily' in setup) return snapshotNotAuthentic();
  if (dailyId) {
    const expectedDaily = dailyChallengeForId(dailyId);
    if (!expectedDaily || !('daily' in setup)) return snapshotNotAuthentic();
    if (canonicalJson(setup.daily) !== canonicalJson(expectedDaily)) return snapshotNotAuthentic();
  }
  const weeklyId = typeof summary.weekly === 'string' ? summary.weekly : '';
  if (!weeklyId && 'weekly' in setup) return snapshotNotAuthentic();
  if (weeklyId) {
    const expectedWeekly = weeklyChallengeForId(weeklyId);
    if (!expectedWeekly || !('weekly' in setup)) return snapshotNotAuthentic();
    if (canonicalJson(setup.weekly) !== canonicalJson(expectedWeekly)) return snapshotNotAuthentic();
  }
  const gauntletWeek = typeof summary.gauntlet === 'string' ? summary.gauntlet : '';
  if (!gauntletWeek && ('gauntlet' in setup || 'gauntletProtocol' in setup)) return snapshotNotAuthentic();
  if (gauntletWeek) {
    if ('gauntletProtocol' in setup) {
      const proto = setup.gauntletProtocol as Record<string, unknown>;
      if (proto.week !== gauntletWeek) return snapshotNotAuthentic();
    } else {
      if (!config.weeklyGauntlet || !('gauntlet' in setup)) return snapshotNotAuthentic();
      if (canonicalJson(setup.gauntlet) !== canonicalJson(config.weeklyGauntlet)) return snapshotNotAuthentic();
    }
  }
  return null;
}

async function verifyRunCore(runId: string, explicitRows?: ScoreRowRef[], source = 'callable'): Promise<VerifyRunResult> {
  const bundle = await readReSimBundle(runId);
  let result: ReSimResult;
  if (bundle.bundle) {
    const config = await loadReSimConfig();
    result = authenticateSetupSnapshots(bundle.bundle.run, config) ?? reSimulate(bundle.bundle);
  } else {
    result = { verdict: 'unverifiable', reason: bundle.reason ?? 'unverifiable' };
  }
  const rows = explicitRows ?? await scoreRowsForRun(runId);
  const rowsUpdated = await writeScoreVerdict(rows, result.verdict);
  await writeVerificationReason(runId, result, rows, source);
  return {
    runId,
    verdict: result.verdict,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.divergence ? { divergence: compactDivergence(result) as ReSimResult['divergence'] } : {}),
    rowsUpdated,
  };
}

function verifyAcceptedRun(runId: string, row: ScoreRowRef): void {
  verifyRunCore(runId, [row], 'post-accept').catch((error) => {
    console.warn('post-accept replay verification failed', { runId, error });
  });
}

async function allowRateLimitedAction(key: string): Promise<boolean> {
  try {
    return await rateLimitOk(db as unknown as RateLimitStore, key);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) {
      throw new HttpsError('unavailable', 'rate-limit-unavailable');
    }
    throw error;
  }
}

interface FeedbackSubmitResult {
  accepted: boolean;
  reason?: string;
  id?: string;
  token?: string;
}

interface FeedbackReplyRow {
  id: string;
  ctx: string;
  ts: number;
  reply: string;
  replyTs: number;
  status: string;
}

interface FeedbackRepliesResult {
  replies: FeedbackReplyRow[];
}

interface EntitlementPurchaseResult {
  granted: boolean;
  alreadyOwned: boolean;
  cosmeticIds: string[];
  salvageBalance: number;
}

const ENTITLEMENT_REQUEST_RE = /^[A-Za-z0-9_-]{8,80}$/;

/**
 * The single grant path for cosmetic entitlements. The transaction owns the
 * catalog price, wallet check, entitlement snapshot, and immutable receipt.
 * A later payment webhook can call the same internal shape with a different
 * source; this task deliberately exposes only Salvage purchases.
 */
async function grantSalvageEntitlement(uid: string, cosmeticId: string, requestId: string): Promise<EntitlementPurchaseResult> {
  const entitlementRef = db.doc(`entitlements/${uid}`);
  const receiptRef = entitlementRef.collection('grants').doc(requestId);
  return db.runTransaction(async (tx) => {
    const [entitlementSnap, receiptSnap] = await Promise.all([
      tx.get(entitlementRef),
      tx.get(receiptRef),
    ]);
    const current = readEntitlementState(entitlementSnap.exists ? entitlementSnap.data() : undefined);

    if (receiptSnap.exists) {
      if (receiptSnap.get('cosmeticId') !== cosmeticId) {
        throw new HttpsError('already-exists', 'request-id-reused');
      }
      return {
        granted: true,
        alreadyOwned: current.cosmeticIds.includes(cosmeticId),
        cosmeticIds: current.cosmeticIds,
        salvageBalance: current.salvageBalance,
      };
    }

    const purchase = applySalvagePurchase(current, cosmeticId);
    if (!purchase.ok) {
      if (purchase.reason === 'unknown-cosmetic') throw new HttpsError('invalid-argument', 'unknown-cosmetic');
      throw new HttpsError('failed-precondition', 'insufficient-salvage');
    }
    if (purchase.alreadyOwned) {
      return {
        granted: true,
        alreadyOwned: true,
        cosmeticIds: purchase.state.cosmeticIds,
        salvageBalance: purchase.state.salvageBalance,
      };
    }

    tx.set(entitlementRef, {
      schemaVersion: 1,
      uid,
      cosmeticIds: purchase.state.cosmeticIds,
      salvageBalance: purchase.state.salvageBalance,
      salvageSpent: purchase.state.salvageSpent,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    tx.create(receiptRef, {
      schemaVersion: 1,
      uid,
      cosmeticId,
      source: 'salvage',
      cost: purchase.cost,
      requestId,
      grantedAt: FieldValue.serverTimestamp(),
    });
    return {
      granted: true,
      alreadyOwned: false,
      cosmeticIds: purchase.state.cosmeticIds,
      salvageBalance: purchase.state.salvageBalance,
    };
  });
}

const purchaseCosmeticEntitlement = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<EntitlementPurchaseResult> => {
    const uid = requireAuthUid(req);
    const data = req.data as Record<string, unknown> | undefined;
    const cosmeticId = typeof data?.cosmeticId === 'string' ? data.cosmeticId : '';
    const requestId = typeof data?.requestId === 'string' ? data.requestId : '';
    if (!ENTITLEMENT_REQUEST_RE.test(requestId)) throw new HttpsError('invalid-argument', 'bad-request-id');
    return grantSalvageEntitlement(uid, cosmeticId, requestId);
  },
);

export { purchaseCosmeticEntitlement };

function readFeedbackPayload(raw: unknown): { uid: string; text: string; ctx: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const uid = String(d.uid ?? '');
  if (!validUid(uid)) return null;
  const text = String(d.text ?? '').trim();
  const ctx = String(d.ctx ?? '').slice(0, 200);
  if (text.length < 1) return null;
  return { uid, text: text.slice(0, 1000), ctx };
}

function millis(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'toMillis' in v && typeof v.toMillis === 'function') {
    return Number(v.toMillis());
  }
  return 0;
}

export const submitFeedback = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<FeedbackSubmitResult> => {
    const authUid = requireAuthUid(req);
    const payload = readFeedbackPayload(req.data);
    if (!payload) throw new HttpsError('invalid-argument', 'bad-feedback');
    const feedback = { ...payload, uid: authUid };
    if (!(await allowRateLimitedAction(`feedback_${feedback.uid}`))) {
      return { accepted: false, reason: 'rate-limited' };
    }

    const token = newFeedbackToken();
    const ref = db.collection('feedback').doc();
    await ref.set({
      uid: feedback.uid,
      text: feedback.text,
      ts: Date.now(),
      ctx: feedback.ctx,
      status: 'open',
      replyTokenHash: feedbackTokenHash(token),
      serverTs: FieldValue.serverTimestamp(),
    });
    return { accepted: true, id: ref.id, token };
  },
);

export const fetchFeedbackReplies = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<FeedbackRepliesResult> => {
    const receipts = sanitizeFeedbackReceipts((req.data as Record<string, unknown> | undefined)?.receipts);
    if (receipts.length === 0) return { replies: [] };
    const rows = await Promise.all(receipts.map(async ({ id, token }) => {
      const snap = await db.doc(`feedback/${id}`).get();
      if (!snap.exists) return null;
      const data = snap.data() as Record<string, unknown>;
      if (data.replyTokenHash !== feedbackTokenHash(token)) return null;
      const reply = typeof data.reply === 'string' ? data.reply : '';
      if (!reply) return null;
      return {
        id,
        ctx: typeof data.ctx === 'string' ? data.ctx : '',
        ts: millis(data.ts),
        reply,
        replyTs: millis(data.replyTs),
        status: typeof data.status === 'string' ? data.status : 'open',
      };
    }));
    return { replies: rows.filter((row): row is FeedbackReplyRow => row !== null) };
  },
);

export const submitScore = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<SubmitResult> => {
    const authUid = requireAuthUid(req);
    const board = String((req.data as Record<string, unknown> | undefined)?.board ?? '');
    if (!validBoard(board)) throw new HttpsError('invalid-argument', 'bad-board');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    if (claim.daily || claim.weekly || claim.gauntlet) throw new HttpsError('invalid-argument', 'ritual-on-board');
    return processSubmit({ ...claim, uid: authUid }, board, 'standard');
  },
);

export const submitDailyScore = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<SubmitResult> => {
    const authUid = requireAuthUid(req);
    const dailyId = String((req.data as Record<string, unknown> | undefined)?.dailyId ?? '');
    if (!DAILY_BOARD_RE.test(dailyId)) throw new HttpsError('invalid-argument', 'bad-daily');
    if (!dailyIsCurrent(dailyId)) throw new HttpsError('failed-precondition', 'stale-daily');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    return processSubmit({ ...claim, uid: authUid, freeplay: false, daily: dailyId }, dailyId, 'daily');
  },
);

export const submitWeeklyScore = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<SubmitResult> => {
    const authUid = requireAuthUid(req);
    const weeklyId = String((req.data as Record<string, unknown> | undefined)?.weeklyId ?? '');
    if (!WEEKLY_BOARD_RE.test(weeklyId)) throw new HttpsError('invalid-argument', 'bad-weekly');
    if (!weeklyIsCurrent(weeklyId)) throw new HttpsError('failed-precondition', 'stale-weekly');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    return processSubmit({ ...claim, uid: authUid, freeplay: false, weekly: weeklyId }, weeklyId, 'weekly');
  },
);

export const submitGauntletScore = onCall(
  callableOptions(10),
  async (req: CallableRequest): Promise<SubmitResult> => {
    const authUid = requireAuthUid(req);
    const week = String((req.data as Record<string, unknown> | undefined)?.week ?? '');
    if (!WEEKLY_BOARD_RE.test(week)) throw new HttpsError('invalid-argument', 'bad-gauntlet');
    if (!weeklyIsCurrent(week)) throw new HttpsError('failed-precondition', 'stale-gauntlet');
    const gauntlet = await db.doc('config/weeklyGauntlet').get();
    if (!gauntlet.exists || gauntlet.get('week') !== week) throw new HttpsError('failed-precondition', 'gauntlet-not-crowned');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    return processSubmit({ ...claim, uid: authUid, freeplay: false, gauntlet: week }, week, 'gauntlet');
  },
);

export const submitGauntletProtocolScore = onCall(
  callableOptions(10, 300),
  async (req: CallableRequest): Promise<SubmitResult> => {
    const authUid = requireAuthUid(req);
    const week = String((req.data as Record<string, unknown> | undefined)?.week ?? '');
    if (!WEEKLY_BOARD_RE.test(week)) throw new HttpsError('invalid-argument', 'bad-gauntlet-protocol');
    if (!weeklyIsCurrent(week)) throw new HttpsError('failed-precondition', 'stale-gauntlet-protocol');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    const runIds = ((req.data as Record<string, unknown> | undefined)?.runIds as unknown[] | undefined ?? [])
      .map((id) => String(id))
      .filter((id, index, rows) => RUN_ID_RE.test(id) && rows.indexOf(id) === index)
      .slice(0, 3);
    if (runIds.length < 1 || claim.runId !== runIds[runIds.length - 1]) throw new HttpsError('invalid-argument', 'bad-leg-runids');

    const replay = await checkReplay({ ...claim, uid: authUid, freeplay: false, gauntlet: week }, week, 'gauntlet');
    if (replay.reason) return { accepted: false, reason: replay.reason, claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };

    const legDocs = await Promise.all(runIds.map((runId) => db.doc(`runs/${runId}`).get()));
    if (legDocs.some((snap) => !snap.exists)) {
      return { accepted: false, reason: 'missing-leg-replay', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
    }
    const runs = legDocs.map((snap) => snap.data() as Record<string, unknown>);
    const metas = runs.map((run) => ((run.setup as Record<string, unknown> | undefined)?.gauntletProtocol ?? null) as Record<string, unknown> | null);
    if (metas.some((meta) => !meta)) {
      return { accepted: false, reason: 'missing-gauntlet-protocol-setup', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
    }
    const route = canonicalJson(metas[0]?.route);
    const gauntletRunId = String(metas[0]?.gauntletRunId ?? '');
    for (let i = 0; i < runIds.length; i++) {
      const summary = (runs[i].summary ?? {}) as Record<string, unknown>;
      if (metas[i]?.week !== week || n(metas[i]?.leg) !== i + 1 || canonicalJson(metas[i]?.route) !== route || String(metas[i]?.gauntletRunId ?? '') !== gauntletRunId) {
        return { accepted: false, reason: 'leg-metadata-mismatch', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
      }
      if (summary.gauntlet !== week || n(summary.gauntletLeg) !== i + 1) {
        return { accepted: false, reason: 'leg-summary-mismatch', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
      }
      const outcome = String(summary.outcome ?? '');
      if (i < runIds.length - 1 && outcome !== 'victory') {
        return { accepted: false, reason: 'prior-leg-not-victory', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
      }
      if (runIds.length < 3 && i === runIds.length - 1 && outcome !== 'gameover') {
        return { accepted: false, reason: 'incomplete-run-not-overrun', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
      }
      if (i > 0) {
        const previousSummary = (runs[i - 1].summary ?? {}) as Record<string, unknown>;
        const expectedCash = Math.floor(Math.max(0, Math.floor(n(previousSummary.credits))) * 0.6);
        const expectedCores = Math.max(1, Math.floor(n(previousSummary.coresLeft)));
        if (n(metas[i]?.startingCredits) !== expectedCash || n(metas[i]?.startingCores) !== expectedCores) {
          return { accepted: false, reason: 'bank-mismatch', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
        }
      }
      const verified = await verifyRunCore(runIds[i], [], 'gauntlet-protocol-submit');
      if (verified.verdict !== 'verified') {
        return { accepted: false, reason: `leg-${i + 1}-${verified.verdict}`, claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
      }
    }

    if (!(await allowRateLimitedAction(authUid))) {
      return { accepted: false, reason: 'rate-limited', claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave } };
    }
    const acceptedAt = Date.now();
    const totals = runs.reduce<{ wave: number; kills: number; cash: number }>((acc, run) => {
      const summary = (run.summary ?? {}) as Record<string, unknown>;
      acc.wave += Math.max(0, Math.floor(n(summary.wave)));
      acc.kills += Math.max(0, Math.floor(n(summary.kills)));
      acc.cash += Math.max(0, Math.floor(n(summary.cashEarned)));
      return acc;
    }, { wave: 0, kills: 0, cash: 0 });
    const stored = {
      name: claim.name,
      cash: totals.cash,
      kills: totals.kills,
      wave: totals.wave,
      freeplay: false,
      ts: acceptedAt,
      clientTs: claim.ts,
      uid: authUid,
      runId: claim.runId,
      gauntlet: week,
      gauntletRunId,
      gauntletRunIds: runIds,
      route: metas[0]?.route,
      serverTs: FieldValue.serverTimestamp(),
      verify: 'verified',
    };
    const docId = `${authUid}_${gauntletRunId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
    await db.collection(`gauntletProtocolBoards/${week}/scores`).doc(docId).set(stored, { merge: false });
    return {
      accepted: true,
      claimed: { cash: claim.cash, kills: claim.kills, wave: claim.wave },
      accepted_values: { cash: totals.cash, kills: totals.kills, wave: totals.wave },
    };
  },
);

export const verifyRun = onCall(
  callableOptions(5, 300),
  async (req: CallableRequest): Promise<VerifyRunResult> => {
    requireAdmin(req);
    const runId = String((req.data as Record<string, unknown> | undefined)?.runId ?? '');
    if (!RUN_ID_RE.test(runId)) throw new HttpsError('invalid-argument', 'bad-run-id');
    return verifyRunCore(runId);
  },
);

// ---- deleteMyData (1A) — cascade delete everything keyed by uid ----

export const crownWeeklyGauntlet = onCall(
  callableOptions(5, 120),
  async (req: CallableRequest): Promise<WeeklyGauntletResult> => {
    requireAdmin(req);
    const now = new Date();
    const week = String((req.data as Record<string, unknown> | undefined)?.week ?? isoWeekId(now));
    if (!WEEKLY_BOARD_RE.test(week)) throw new HttpsError('invalid-argument', 'bad-week');
    const thisWeekStart = isoWeekStart(now);
    const prevStart = thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000;
    const prevEnd = thisWeekStart.getTime();
    const snap = await db.collectionGroup('scores')
      .where('freeplay', '==', false)
      .where('verify', '==', 'verified')
      .where('ts', '>=', prevStart)
      .where('ts', '<', prevEnd)
      .orderBy('ts', 'desc')
      .limit(100)
      .get();
    const candidates = snap.docs
      .filter((docSnap) => /^boards\/[^/]+\/scores\/[^/]+$/.test(docSnap.ref.path))
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return {
          runId: String(data.runId ?? ''),
          callsign: String(data.name ?? 'WARDEN').slice(0, 20),
          cash: n(data.cash),
          wave: Math.max(0, Math.floor(n(data.wave))),
          kills: Math.max(0, Math.floor(n(data.kills))),
        };
      })
      .filter((row) => RUN_ID_RE.test(row.runId))
      .sort((a, b) => b.cash - a.cash || b.wave - a.wave || b.kills - a.kills);
    const champion = candidates[0];
    if (!champion) return { published: false, reason: 'no-verified-campaign-row' };
    const runSnap = await db.doc(`runs/${champion.runId}`).get();
    const run = runSnap.exists ? runSnap.data() as Record<string, unknown> : null;
    const setup = (run?.setup ?? {}) as Record<string, unknown>;
    const summary = (run?.summary ?? {}) as Record<string, unknown>;
    const map = String(summary.map ?? setup.map ?? '');
    const diff = String(summary.diff ?? setup.diff ?? '');
    const seed = Math.floor(n(setup.seed, -1));
    if (!VALID_MAPS.has(map) || !VALID_DIFFS.has(diff) || seed < 0) {
      return { published: false, reason: 'champion-replay-missing-setup' };
    }
    const gauntlet = {
      week,
      runId: champion.runId,
      callsign: champion.callsign,
      map,
      diff,
      seed: seed >>> 0,
      wave: champion.wave,
      kills: champion.kills,
    };
    await db.doc('config/weeklyGauntlet').set({
      ...gauntlet,
      crownedAt: Date.now(),
      crownedBy: String(req.auth?.token?.email ?? '').slice(0, 120),
      source: 'callable',
    }, { merge: false });
    return { published: true, gauntlet };
  },
);

interface DeleteResult {
  ok: boolean;
  uid: string;
  deleted: {
    telemetry: number;
    runAnalytics: number;
    runCheckpoints: number;
    replayOwners: number;
    boardScores: number;
    feedback: number;
    entitlementGrants: number;
    entitlements: number;
    runs: number;
    rateLimits: number;
    /** owner-index runIds with no corroborating signal — left for manual review */
    skippedRuns: number;
  };
  errors?: string[];
}

const BATCH = 300;

async function deleteByQuery(build: () => Query): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await build().limit(BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < BATCH) break;
  }
  return total;
}

async function collectLeaderboardRunIds(uid: string): Promise<string[]> {
  const snap = await db.collectionGroup('scores').where('uid', '==', uid).get();
  return validDeletedRunIds(snap.docs.map((d) => d.get('runId')));
}

async function deleteRunArtifacts(uid: string, knownRunIds: Iterable<string> = []): Promise<{ runCheckpoints: number; replayOwners: number; runs: number; skippedRuns: number }> {
  // Corroborated signals: server-written board rows (knownRunIds) and
  // uid-matching runAnalytics / runCheckpoints docs. After the production
  // reset, skippedRuns should be 0 in practice; corroboration stays as defense
  // in depth for any imported or hand-authored owner-index rows.
  const corroborated = new Set<string>(validDeletedRunIds([...knownRunIds]));

  const ra = await db.collection('runAnalytics').where('uid', '==', uid).get();
  ra.docs.forEach((d) => corroborated.add(d.id));

  try {
    const cg = await db.collectionGroup('chunks').where('uid', '==', uid).get();
    cg.docs.forEach((d) => {
      const parent = d.ref.parent.parent;
      if (parent && parent.parent.id === 'runCheckpoints') corroborated.add(parent.id);
    });
  } catch {
    // collection-group index may not be built yet; fall back to runAnalytics-derived runIds.
  }

  const owners = await db.collection(`replayOwners/${uid}/runs`).get();
  const ownerIds = owners.docs.map((d) => d.id);
  // Owner-index rows alone must not delete public replays. Clean-slate rows are
  // uid-bound by rules, but this extra corroboration makes retries/imports safe.
  // Skipped ids are reported for manual operator review.
  const { deletable, skipped } = partitionRunDeletions(ownerIds, corroborated);

  let runCheckpoints = 0;
  let replayOwners = 0;
  let runs = 0;
  for (const runId of new Set([...deletable, ...skipped])) {
    // Private, uid-scoped artifacts are always safe to delete for this uid.
    runCheckpoints += await deleteByQuery(() => db.collection(`runCheckpoints/${runId}/chunks`).where('uid', '==', uid));
    const ownerRef = db.doc(`replayOwners/${uid}/runs/${runId}`);
    if ((await ownerRef.get()).exists) { await ownerRef.delete().catch(() => undefined); replayOwners++; }
  }
  for (const runId of deletable) {
    await db.doc(`runCheckpoints/${runId}`).delete().catch(() => undefined);
    await deleteByQuery(() => db.collection(`runs/${runId}/chunks`));
    const runRef = db.doc(`runs/${runId}`);
    if ((await runRef.get()).exists) { await runRef.delete().catch(() => undefined); runs++; }
  }
  return { runCheckpoints, replayOwners, runs, skippedRuns: skipped.length };
}

// Admins (the operator) only — NOT public. uids appear in public leaderboard reads,
// so a public delete-by-uid endpoint would let anyone grief-delete other players'
// data. Players' own PII lives in localStorage and is cleared client-side; server
// records are anonymous + TTL-expiring. Server deletion-on-request is operator-run.
export const deleteMyData = onCall(
  callableOptions(5, 300),
  async (req: CallableRequest): Promise<DeleteResult> => {
    requireAdmin(req);
    const uid = String((req.data as Record<string, unknown> | undefined)?.uid ?? '');
    if (!UID_RE.test(uid)) throw new HttpsError('invalid-argument', 'bad-uid');

    const deleted = {
      telemetry: 0, runAnalytics: 0, runCheckpoints: 0,
      replayOwners: 0, boardScores: 0, feedback: 0, entitlementGrants: 0, entitlements: 0,
      runs: 0, rateLimits: 0,
      skippedRuns: 0,
    };
    const errors: string[] = [];
    // Each phase is independent + idempotent so a partial failure (e.g. a missing
    // index) doesn't abort the rest — the user can safely retry to finish.
    const phase = async (name: string, fn: () => Promise<void>): Promise<void> => {
      try { await fn(); } catch (e) { errors.push(`${name}: ${String((e as Error)?.message ?? e)}`); }
    };

    let leaderboardRunIds: string[] = [];
    await phase('leaderboardRunIds', async () => { leaderboardRunIds = await collectLeaderboardRunIds(uid); });
    await phase('telemetry', async () => { deleted.telemetry = await deleteByQuery(() => db.collection('telemetry').where('uid', '==', uid)); });
    await phase('feedback', async () => { deleted.feedback = await deleteByQuery(() => db.collection('feedback').where('uid', '==', uid)); });
    await phase('entitlements', async () => {
      deleted.entitlementGrants = await deleteByQuery(() => db.collection(`entitlements/${uid}/grants`));
      const ref = db.doc(`entitlements/${uid}`);
      if ((await ref.get()).exists) { await ref.delete(); deleted.entitlements = 1; }
    });
    await phase('boardScores', async () => { deleted.boardScores = await deleteByQuery(() => db.collectionGroup('scores').where('uid', '==', uid)); });
    await phase('runArtifacts', async () => { const r = await deleteRunArtifacts(uid, leaderboardRunIds); deleted.runCheckpoints = r.runCheckpoints; deleted.replayOwners = r.replayOwners; deleted.runs = r.runs; deleted.skippedRuns = r.skippedRuns; });
    await phase('runAnalytics', async () => { deleted.runAnalytics = await deleteByQuery(() => db.collection('runAnalytics').where('uid', '==', uid)); });
    await phase('rateLimits', async () => {
      for (const key of [uid, `feedback_${uid}`]) {
        const rl = db.doc(`rateLimits/${key}`);
        if ((await rl.get()).exists) { await rl.delete(); deleted.rateLimits++; }
      }
    });

    return errors.length ? { ok: false, uid, deleted, errors } : { ok: true, uid, deleted };
  },
);
