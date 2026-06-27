/**
 * Neon Vector Defense — server-side leaderboard gate + data deletion.
 *
 * submitScore / submitDailyScore: the ONLY writers to boards/* and dailyBoards/*.
 *   Clients no longer write board entries directly (firestore.rules: create:if false).
 *   We require a matching runs/{runId} replay to exist and sanity-bound the claimed
 *   score against the run's recorded summary, then rate-limit per uid, then write.
 *
 * deleteMyData: cascade-delete all docs keyed by a given anonymous uid.
 *
 * Trust model: the player uid is anonymous and supplied in the payload — NOT an
 * authenticated identity. Used only for rate-limit bucketing and the stored `uid`.
 * Casual cheating is stopped (a forged score with no real replay, or one wildly
 * inconsistent with its replay, is rejected). A hand-crafted fake replay can still
 * pass — accepted launch posture (pragmatic MVP).
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { validDeletedRunIds } from './deleteHelpers.js';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db: Firestore = getFirestore();

const VALID_MAPS = new Set([
  'orbital', 'reactor', 'hyperlane', 'mobius', 'blackout', 'throat', 'umbral', 'cinder',
]);
const VALID_DIFFS = new Set(['easy', 'normal', 'hard', 'extinction', 'ngplus']);

const BOARD_RE = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?<fp>_fp)?$/;
const DAILY_BOARD_RE = /^daily-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;
const UID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const CASH_MAX = 100_000_000;
const KILLS_MAX = 10_000_000;
const WAVE_MAX = 10_000;

const SCORE_SLACK = 1.25;
const WAVE_SLACK = 2;
const MIN_RUN_DURATION_S = 3;
const MAX_RUN_DURATION_S = 86_400;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IN_WINDOW = 8;

interface ClaimedScore {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid: string;
  runId: string;
  meta?: string;
  daily?: string;
  checkpoint?: boolean;
}

interface SubmitResult {
  accepted: boolean;
  reason?: string;
  claimed: { cash: number; kills: number; wave: number };
  accepted_values?: { cash: number; kills: number; wave: number };
}

function n(v: unknown, fallback = 0): number {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function validBoard(board: string): boolean {
  const m = BOARD_RE.exec(board);
  return !!m?.groups && VALID_MAPS.has(m.groups.map) && VALID_DIFFS.has(m.groups.diff);
}

function boardIsFreeplay(board: string): boolean {
  return board.endsWith('_fp');
}

function readClaim(raw: unknown): ClaimedScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const name = String(d.name ?? '').slice(0, 20);
  const uid = String(d.uid ?? '');
  const runId = String(d.runId ?? '');
  if (name.length < 1) return null;
  if (!UID_RE.test(uid)) return null;
  if (!RUN_ID_RE.test(runId)) return null;
  const claim: ClaimedScore = {
    name,
    cash: Math.max(0, Math.floor(n(d.cash))),
    kills: Math.max(0, Math.floor(n(d.kills))),
    wave: Math.max(0, Math.floor(n(d.wave))),
    freeplay: !!d.freeplay,
    ts: Math.floor(n(d.ts, Date.now())),
    uid,
    runId,
  };
  if (claim.cash >= CASH_MAX || claim.kills >= KILLS_MAX || claim.wave > WAVE_MAX) return null;
  if (typeof d.meta === 'string') claim.meta = d.meta.slice(0, 240);
  if (typeof d.daily === 'string') claim.daily = d.daily.slice(0, 80);
  if (d.checkpoint !== undefined) claim.checkpoint = !!d.checkpoint;
  return claim;
}

interface RunSummary {
  wave: number; kills: number; credits: number; cashEarned: number;
  coresLeft: number; durationS: number; freeplay: boolean;
  map: string; diff: string; outcome: string;
}

/** Verify runs/{runId} exists and the claimed score is plausibly produced by it. */
async function checkReplay(claim: ClaimedScore, board: string, isDaily: boolean): Promise<string | null> {
  const snap = await db.doc(`runs/${claim.runId}`).get();
  if (!snap.exists) return 'no-replay';
  const run = snap.data() as Record<string, unknown>;

  const eventCount = n(run.eventCount, 0);
  if (eventCount <= 0) return 'empty-replay';

  const summary = (run.summary ?? {}) as Partial<RunSummary>;
  const recWave = n(summary.wave);
  const recKills = n(summary.kills);
  const recCashEarned = n(summary.cashEarned);
  const recCredits = n(summary.credits);
  const recDuration = n(summary.durationS);

  if (recDuration < MIN_RUN_DURATION_S) return 'too-short';
  if (recDuration > MAX_RUN_DURATION_S) return 'too-long';

  const createdAt = n(run.createdAt);
  const endedAt = n(run.endedAt);
  if (createdAt <= 0 || endedAt < createdAt) return 'bad-timestamps';

  const cashCeiling = Math.max(recCashEarned, recCredits) * SCORE_SLACK + 5;
  if (claim.cash > cashCeiling) return 'cash-too-high';
  if (claim.kills > recKills * SCORE_SLACK + 2) return 'kills-too-high';
  if (claim.wave > recWave + WAVE_SLACK) return 'wave-too-high';

  const wantFreeplay = isDaily || boardIsFreeplay(board);
  if (claim.freeplay !== wantFreeplay) return 'freeplay-mismatch';

  if (!isDaily) {
    const m = BOARD_RE.exec(board);
    const setup = (run.setup ?? {}) as { map?: string; diff?: string };
    const runMap = String(summary.map ?? setup.map ?? '');
    const runDiff = String(summary.diff ?? setup.diff ?? '');
    if (m?.groups && runMap && runMap !== m.groups.map) return 'map-mismatch';
    if (m?.groups && runDiff && runDiff !== m.groups.diff) return 'diff-mismatch';
  }

  return null;
}

/** Windowed per-uid rate limit via a counter doc, in a transaction. Fails OPEN on infra error. */
async function rateLimitOk(uid: string): Promise<boolean> {
  const ref = db.doc(`rateLimits/${uid}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const data = snap.exists ? (snap.data() as { windowStart?: number; count?: number }) : null;
      const windowStart = n(data?.windowStart, 0);
      const count = n(data?.count, 0);
      // expiresAt drives a Firestore TTL policy so these counters don't accumulate forever.
      const expiresAt = new Date(now + 24 * 60 * 60 * 1000);
      if (!data || now - windowStart >= RATE_WINDOW_MS) {
        tx.set(ref, { windowStart: now, count: 1, updatedAt: now, expiresAt });
        return true;
      }
      if (count >= RATE_MAX_IN_WINDOW) return false;
      tx.update(ref, { count: count + 1, updatedAt: now, expiresAt });
      return true;
    });
  } catch {
    return true;
  }
}

async function processSubmit(claim: ClaimedScore, board: string, isDaily: boolean): Promise<SubmitResult> {
  const claimed = { cash: claim.cash, kills: claim.kills, wave: claim.wave };

  const replayReason = await checkReplay(claim, board, isDaily);
  if (replayReason) return { accepted: false, reason: replayReason, claimed };

  if (!(await rateLimitOk(claim.uid))) {
    return { accepted: false, reason: 'rate-limited', claimed };
  }

  const stored: Record<string, unknown> = {
    name: claim.name,
    cash: claim.cash,
    kills: claim.kills,
    wave: claim.wave,
    freeplay: isDaily ? true : boardIsFreeplay(board),
    ts: claim.ts > 0 ? claim.ts : Date.now(),
    uid: claim.uid,
    runId: claim.runId,
    serverTs: FieldValue.serverTimestamp(),
  };
  if (claim.meta) stored.meta = claim.meta;
  if (claim.checkpoint !== undefined) stored.checkpoint = claim.checkpoint;
  if (isDaily) stored.daily = board;

  const collPath = isDaily ? `dailyBoards/${board}/scores` : `boards/${board}/scores`;
  await db.collection(collPath).add(stored);

  return {
    accepted: true,
    claimed,
    accepted_values: { cash: claim.cash, kills: claim.kills, wave: claim.wave },
  };
}

export const submitScore = onCall(
  { region: 'us-central1', cors: true, maxInstances: 10 },
  async (req: CallableRequest): Promise<SubmitResult> => {
    const board = String((req.data as Record<string, unknown> | undefined)?.board ?? '');
    if (!validBoard(board)) throw new HttpsError('invalid-argument', 'bad-board');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    if (claim.daily) throw new HttpsError('invalid-argument', 'daily-on-board');
    return processSubmit(claim, board, false);
  },
);

export const submitDailyScore = onCall(
  { region: 'us-central1', cors: true, maxInstances: 10 },
  async (req: CallableRequest): Promise<SubmitResult> => {
    const dailyId = String((req.data as Record<string, unknown> | undefined)?.dailyId ?? '');
    if (!DAILY_BOARD_RE.test(dailyId)) throw new HttpsError('invalid-argument', 'bad-daily');
    const claim = readClaim((req.data as Record<string, unknown> | undefined)?.entry);
    if (!claim) throw new HttpsError('invalid-argument', 'bad-entry');
    return processSubmit({ ...claim, freeplay: true, daily: dailyId }, dailyId, true);
  },
);

// ---- deleteMyData (1A) — cascade delete everything keyed by uid ----

interface DeleteResult {
  ok: boolean;
  uid: string;
  deleted: {
    telemetry: number;
    runAnalytics: number;
    runCheckpoints: number;
    boardScores: number;
    feedback: number;
    runs: number;
    rateLimits: number;
  };
  errors?: string[];
}

const BATCH = 300;

async function deleteByQuery(build: () => FirebaseFirestore.Query): Promise<number> {
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

async function deleteRunArtifacts(uid: string, knownRunIds: Iterable<string> = []): Promise<{ runCheckpoints: number; runs: number }> {
  const runIds = new Set<string>(validDeletedRunIds([...knownRunIds]));

  const ra = await db.collection('runAnalytics').where('uid', '==', uid).get();
  ra.docs.forEach((d) => runIds.add(d.id));

  try {
    const cg = await db.collectionGroup('chunks').where('uid', '==', uid).get();
    cg.docs.forEach((d) => {
      const parent = d.ref.parent.parent;
      if (parent && parent.parent.id === 'runCheckpoints') runIds.add(parent.id);
    });
  } catch {
    // collection-group index may not be built yet; fall back to runAnalytics-derived runIds.
  }

  let runCheckpoints = 0;
  let runs = 0;
  for (const runId of runIds) {
    runCheckpoints += await deleteByQuery(() => db.collection(`runCheckpoints/${runId}/chunks`));
    await db.doc(`runCheckpoints/${runId}`).delete().catch(() => undefined);
    await deleteByQuery(() => db.collection(`runs/${runId}/chunks`));
    const runRef = db.doc(`runs/${runId}`);
    if ((await runRef.get()).exists) { await runRef.delete().catch(() => undefined); runs++; }
  }
  return { runCheckpoints, runs };
}

// Admins (the operator) only — NOT public. uids appear in public leaderboard reads,
// so a public delete-by-uid endpoint would let anyone grief-delete other players'
// data. Players' own PII lives in localStorage and is cleared client-side; server
// records are anonymous + TTL-expiring. Server deletion-on-request is operator-run.
const ADMIN_EMAILS = new Set(['5329548871.eg@gmail.com', '5329548871,eg@gmail.com']);

export const deleteMyData = onCall(
  { region: 'us-central1', cors: true, maxInstances: 5, timeoutSeconds: 300 },
  async (req: CallableRequest): Promise<DeleteResult> => {
    const email = String(req.auth?.token?.email ?? '').toLowerCase();
    if (!req.auth || req.auth.token?.email_verified !== true || !ADMIN_EMAILS.has(email)) {
      throw new HttpsError('permission-denied', 'admin-only');
    }
    const uid = String((req.data as Record<string, unknown> | undefined)?.uid ?? '');
    if (!UID_RE.test(uid)) throw new HttpsError('invalid-argument', 'bad-uid');

    const deleted = {
      telemetry: 0, runAnalytics: 0, runCheckpoints: 0,
      boardScores: 0, feedback: 0, runs: 0, rateLimits: 0,
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
    await phase('boardScores', async () => { deleted.boardScores = await deleteByQuery(() => db.collectionGroup('scores').where('uid', '==', uid)); });
    await phase('runArtifacts', async () => { const r = await deleteRunArtifacts(uid, leaderboardRunIds); deleted.runCheckpoints = r.runCheckpoints; deleted.runs = r.runs; });
    await phase('runAnalytics', async () => { deleted.runAnalytics = await deleteByQuery(() => db.collection('runAnalytics').where('uid', '==', uid)); });
    await phase('rateLimits', async () => {
      const rl = db.doc(`rateLimits/${uid}`);
      if ((await rl.get()).exists) { await rl.delete(); deleted.rateLimits = 1; }
    });

    return errors.length ? { ok: false, uid, deleted, errors } : { ok: true, uid, deleted };
  },
);
