// Global leaderboards, feedback, and telemetry on Firestore.
// Firebase web config is public by design; access control lives in firestore.rules.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebaseClient';
// The Firestore SDK (~88KB gzip) loads lazily on first data access — every
// entry point below is already async, so each grabs { fs, db } on demand.
import { firestore, type FirestoreNS } from './firestoreLazy';
import { ensureServerUid } from './anonAuth';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { progress } from './storage';
import { canSubmitScore, canWriteAnalytics } from './consent';
import { isSampledRun } from './writePolicy';
import { sanitizeFirestoreData } from './firestoreSanitize';
import { normalizeRunAnalyticsDoc, type NormalizedRunAnalytics } from './analyticsSchema';
import { type PrivateRunAnalyticsDoc, type RunCheckpointDoc, type RunEvent, type RunEventChunkDoc, type RunUploadBundle, type PublicRunDoc, type RunWaveSnapshot } from './runTelemetry';
import { actionHash, decodeReplayActionBundle, type ReplayActionPack } from './replayCodec';

const VALID_MAPS = new Set(ALL_MAPS.map((m) => m.id));
const VALID_DIFFS = new Set(DIFFICULTIES.map((d) => d.id));
const DAILY_BOARD_RE = /^daily-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const WEEKLY_BOARD_RE = /^weekly-[0-9]{4}-W[0-9]{2}$/;
const LEADERBOARD_CACHE_TTL_MS = 30_000;
const REPLAY_TOKEN_KEY = 'nvd-replay-tokens-v1';
const topCache = new Map<string, { expires: number; rows: ScoreEntry[] }>();
const globalTopCache = new Map<string, { expires: number; rows: RankedScoreEntry[] }>();

// Firestore web writes/reads resolve only on server ack and DO NOT reject when the
// network is blocked (a common portal-iframe CSP config) or offline — the promise
// just hangs forever, freezing any UI that awaits it. Race every network call
// against a timeout so callers always settle into their existing catch/empty path.
const NET_TIMEOUT_MS = 8000;
const MAX_REPLAY_CHUNK_EVENTS = 650;

// Retention: expiresAt drives Firestore TTL policies (see docs/tech_spec.md).
// TTL requires a real Timestamp field — plain number `ts` fields are invisible
// to TTL, which is why raw streams never expired before this.
const CHECKPOINT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // live diagnostics: 30 days
const TELEMETRY_TTL_MS = 180 * 24 * 60 * 60 * 1000; // compact outcome rows: 180 days
const REPLAY_STREAM_TTL_MS = 3 * 24 * 60 * 60 * 1000; // unsubmitted live replay chunks
function ttlTimestamp(fs: FirestoreNS, ms: number) {
  return fs.Timestamp.fromMillis(Date.now() + ms);
}
function withTimeout<T>(p: Promise<T>, ms = NET_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('network-timeout')), ms)),
  ]);
}

export interface ScoreEntry {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid?: string;
  runId?: string;
  replayToken?: string;
  meta?: string;
  daily?: string;
  weekly?: string;
  gauntlet?: string;
  checkpoint?: boolean;
  verify?: RunVerifyRowStatus;
}

export type RunVerifyVerdict = 'verified' | 'divergent' | 'unverifiable';

export interface RunVerifyDivergence {
  field?: string;
  expected?: unknown;
  actual?: unknown;
  at?: { eventIndex?: number; t?: number; wave?: number; type?: string };
}

export interface RunVerifyResult {
  runId: string;
  verdict: RunVerifyVerdict;
  reason?: string;
  divergence?: RunVerifyDivergence;
}

export interface RunVerifyRowStatus extends RunVerifyResult {
  checkedAt?: number;
}

export interface RankedScoreEntry extends ScoreEntry {
  board: string;
  map: string;
  diff: string;
  mapName: string;
  diffName: string;
}

export interface RunBoardScoreRow extends ScoreEntry {
  board: string;
  kind: 'campaign' | 'freeplay' | 'daily' | 'weekly' | 'gauntlet';
  map?: string;
  diff?: string;
  mapName?: string;
  diffName?: string;
}

export interface LeaderboardFetchResult<T> {
  rows: T[];
  error: boolean;
}

export type ReplayIntegrity = 'complete' | 'partial';

export interface RunReplayDoc extends PublicRunDoc {
  integrity: ReplayIntegrity;
  chunks: RunEventChunkDoc[];
  events: RunEvent[];
  snapshots: RunWaveSnapshot[];
}

function cloneScores<T extends ScoreEntry>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/** board id for a mode: mapId_diffId, with _fp for freeplay runs */
export function boardId(mapId: string, diffId: string, freeplay: boolean): string {
  return `${mapId}_${diffId}${freeplay ? '_fp' : ''}`;
}

export function dailyBoardId(dailyId: string): string {
  return DAILY_BOARD_RE.test(dailyId) ? dailyId : '';
}

export function weeklyBoardId(weeklyId: string): string {
  return WEEKLY_BOARD_RE.test(weeklyId) ? weeklyId : '';
}

function validBoard(board: string): boolean {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  return !!match?.groups && VALID_MAPS.has(match.groups.map) && VALID_DIFFS.has(match.groups.diff);
}

function validDailyBoard(board: string): boolean {
  return DAILY_BOARD_RE.test(board);
}

function validWeeklyBoard(board: string): boolean {
  return WEEKLY_BOARD_RE.test(board);
}

function isValidRunId(id: string): boolean {
  return /^r_[A-Za-z0-9_-]{8,80}$/.test(id);
}

function isValidReplayToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function loadReplayTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem(REPLAY_TOKEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function saveReplayToken(runId: string, token: string): void {
  try {
    const rows = Object.entries(loadReplayTokens())
      .filter(([id, value]) => isValidRunId(id) && isValidReplayToken(String(value)) && id !== runId)
      .slice(-39);
    rows.push([runId, token]);
    localStorage.setItem(REPLAY_TOKEN_KEY, JSON.stringify(Object.fromEntries(rows)));
  } catch {
    // Replay token persistence is only for score retry; failed storage is non-fatal.
  }
}

function replayTokenFor(runId: string): string {
  const existing = loadReplayTokens()[runId];
  if (isValidReplayToken(existing)) return existing;
  const token = randomToken();
  saveReplayToken(runId, token);
  return token;
}

function invalidateBoardCache(board: string): void {
  for (const key of topCache.keys()) {
    if (key.startsWith(`${board}:`)) topCache.delete(key);
  }
  globalTopCache.clear();
}

function invalidateDailyBoardCache(board: string): void {
  for (const key of topCache.keys()) {
    if (key.startsWith(`daily:${board}:`)) topCache.delete(key);
  }
}

function invalidateRitualBoardCache(kind: 'weekly' | 'gauntlet', board: string): void {
  for (const key of topCache.keys()) {
    if (key.startsWith(`${kind}:${board}:`)) topCache.delete(key);
  }
}

function boardMeta(board: string): Omit<RankedScoreEntry, keyof ScoreEntry> | null {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  if (!match?.groups || !VALID_MAPS.has(match.groups.map) || !VALID_DIFFS.has(match.groups.diff)) return null;
  const map = ALL_MAPS.find((m) => m.id === match.groups!.map);
  const diff = DIFFICULTIES.find((d) => d.id === match.groups!.diff);
  return {
    board,
    map: match.groups.map,
    diff: match.groups.diff,
    mapName: map?.name ?? match.groups.map,
    diffName: diff?.name ?? match.groups.diff,
  };
}

function scorePayload(entry: ScoreEntry, serverUid: string): ScoreEntry {
  const payload: ScoreEntry = {
    name: entry.name.slice(0, 20),
    cash: Math.max(0, Math.floor(entry.cash)),
    kills: Math.max(0, Math.floor(entry.kills)),
    wave: Math.max(0, Math.floor(entry.wave)),
    freeplay: entry.freeplay,
    ts: Math.floor(entry.ts),
    // Identity is the authenticated anonymous uid; the server re-derives it
    // from the callable auth context anyway, this just keeps the claim honest.
    uid: serverUid.slice(0, 40),
  };
  if (entry.runId && isValidRunId(entry.runId)) payload.runId = entry.runId;
  if (entry.replayToken && isValidReplayToken(entry.replayToken)) payload.replayToken = entry.replayToken;
  if (entry.meta) payload.meta = entry.meta.slice(0, 240);
  if (entry.daily) payload.daily = entry.daily.slice(0, 80);
  if (entry.weekly) payload.weekly = entry.weekly.slice(0, 80);
  if (entry.gauntlet) payload.gauntlet = entry.gauntlet.slice(0, 80);
  if (entry.checkpoint !== undefined) payload.checkpoint = !!entry.checkpoint;
  return payload;
}

// Scores are written SERVER-SIDE by submitScore/submitDailyScore/submitWeeklyScore/submitGauntletScore Cloud Functions
// (us-central1): they require a matching runs/{runId} replay, sanity-bound the claim,
// and rate-limit per uid. Clients can no longer write boards directly (firestore.rules).
const functions = getFunctions(app, 'us-central1');

interface SubmitScoreResult {
  accepted: boolean;
  reason?: string;
  claimed?: { cash: number; kills: number; wave: number };
  accepted_values?: { cash: number; kills: number; wave: number };
}
export interface RunReplaySubmitResult {
  ok: boolean;
  runId?: string;
  replayToken?: string;
}
export interface FeedbackReceipt {
  id: string;
  token: string;
  text?: string;
  ctx?: string;
  ts?: number;
}
interface SubmitFeedbackResult {
  accepted: boolean;
  reason?: string;
  id?: string;
  token?: string;
}
interface FeedbackRepliesResult {
  replies?: {
    id: string;
    ctx?: string;
    ts?: number;
    reply?: string;
    replyTs?: number;
    status?: string;
  }[];
}

function normalizeVerify(data: unknown, fallbackRunId = ''): RunVerifyRowStatus | undefined {
  if (data === 'verified' || data === 'divergent' || data === 'unverifiable') {
    return { runId: fallbackRunId, verdict: data };
  }
  if (!data || typeof data !== 'object') return undefined;
  const raw = data as Record<string, unknown>;
  const verdict = raw.verdict;
  if (verdict !== 'verified' && verdict !== 'divergent' && verdict !== 'unverifiable') return undefined;
  const rawDivergence = raw.divergence ?? raw.firstDivergence;
  const divergence = rawDivergence && typeof rawDivergence === 'object'
    ? rawDivergence as RunVerifyDivergence
    : undefined;
  return {
    runId: typeof raw.runId === 'string' ? raw.runId : fallbackRunId,
    verdict,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    divergence,
    checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : undefined,
  };
}

const callSubmitScore =
  httpsCallable<{ board: string; entry: ScoreEntry }, SubmitScoreResult>(functions, 'submitScore');
const callSubmitDailyScore =
  httpsCallable<{ dailyId: string; entry: ScoreEntry }, SubmitScoreResult>(functions, 'submitDailyScore');
const callSubmitWeeklyScore =
  httpsCallable<{ weeklyId: string; entry: ScoreEntry }, SubmitScoreResult>(functions, 'submitWeeklyScore');
const callSubmitGauntletScore =
  httpsCallable<{ week: string; entry: ScoreEntry }, SubmitScoreResult>(functions, 'submitGauntletScore');
const callSubmitFeedback =
  httpsCallable<{ uid: string; text: string; ctx: string }, SubmitFeedbackResult>(functions, 'submitFeedback');
const callFetchFeedbackReplies =
  httpsCallable<{ receipts: { id: string; token: string }[] }, FeedbackRepliesResult>(functions, 'fetchFeedbackReplies');
const callVerifyRun =
  httpsCallable<{ runId: string }, RunVerifyResult>(functions, 'verifyRun');

export async function verifyRun(runId: string): Promise<RunVerifyResult> {
  if (!isValidRunId(runId)) return { runId, verdict: 'unverifiable', reason: 'invalid run id' };
  const res = await withTimeout(callVerifyRun({ runId }), 60_000);
  const normalized = normalizeVerify(res.data, runId);
  return normalized ?? { runId, verdict: 'unverifiable', reason: 'verifyRun returned an invalid result' };
}

export async function submitScore(board: string, entry: ScoreEntry): Promise<boolean> {
  if (!canSubmitScore()) return false; // under-13 / pre-gate may play, never post
  if (!validBoard(board) || entry.daily) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  const payload = scorePayload(entry, serverUid);
  try {
    const res = await withTimeout(callSubmitScore({ board, entry: payload }));
    if (res.data?.accepted) { invalidateBoardCache(board); return true; }
    // A definitive server REJECTION (with a reason) must NOT fall back to a direct
    // write — that would bypass validation. Only an unreachable CF falls through.
    if (res.data?.reason) { console.warn('Score rejected by server', res.data.reason); return false; }
  } catch (error) {
    console.warn('Score submit failed', error);
  }
  return false;
}

export async function submitDailyScore(dailyId: string, entry: ScoreEntry): Promise<boolean> {
  if (!canSubmitScore()) return false;
  const board = dailyBoardId(dailyId);
  if (!validDailyBoard(board)) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  const payload = scorePayload({ ...entry, freeplay: false, daily: board }, serverUid);
  try {
    const res = await withTimeout(callSubmitDailyScore({ dailyId: board, entry: payload }));
    if (res.data?.accepted) { invalidateDailyBoardCache(board); return true; }
    if (res.data?.reason) { console.warn('Daily score rejected by server', res.data.reason); return false; }
  } catch (error) {
    console.warn('Daily score submit failed', error);
  }
  return false;
}

export async function submitWeeklyScore(weeklyId: string, entry: ScoreEntry): Promise<boolean> {
  if (!canSubmitScore()) return false;
  const board = weeklyBoardId(weeklyId);
  if (!validWeeklyBoard(board)) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  const payload = scorePayload({ ...entry, freeplay: false, weekly: board }, serverUid);
  try {
    const res = await withTimeout(callSubmitWeeklyScore({ weeklyId: board, entry: payload }));
    if (res.data?.accepted) { invalidateRitualBoardCache('weekly', board); return true; }
    if (res.data?.reason) { console.warn('Weekly score rejected by server', res.data.reason); return false; }
  } catch (error) {
    console.warn('Weekly score submit failed', error);
  }
  return false;
}

export async function submitGauntletScore(week: string, entry: ScoreEntry): Promise<boolean> {
  if (!canSubmitScore()) return false;
  const board = weeklyBoardId(week);
  if (!validWeeklyBoard(board)) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  const payload = scorePayload({ ...entry, freeplay: false, gauntlet: board }, serverUid);
  try {
    const res = await withTimeout(callSubmitGauntletScore({ week: board, entry: payload }));
    if (res.data?.accepted) { invalidateRitualBoardCache('gauntlet', board); return true; }
    if (res.data?.reason) { console.warn('Gauntlet score rejected by server', res.data.reason); return false; }
  } catch (error) {
    console.warn('Gauntlet score submit failed', error);
  }
  return false;
}

/** player feedback -> callable. A local private token correlates replies without login. */
export async function submitFeedback(text: string, ctx: string): Promise<FeedbackReceipt | null> {
  if (!canSubmitScore()) return null;
  const serverUid = await ensureServerUid();
  if (!serverUid) return null;
  try {
    const res = await withTimeout(callSubmitFeedback({
      uid: serverUid,
      text: text.slice(0, 1000),
      ctx: ctx.slice(0, 200),
    }));
    if (!res.data?.accepted || !res.data.id || !res.data.token) return null;
    return { id: res.data.id, token: res.data.token };
  } catch (error) {
    console.warn('Feedback submit failed', error);
    return null;
  }
}

export interface FeedbackReply {
  id: string;
  text: string;
  ctx: string;
  ts: number;
  reply: string;
  replyTs: number;
  status: string;
}

/** Fetch only feedback replies this browser has a private receipt for. */
export async function fetchFeedbackReplies(receipts: FeedbackReceipt[]): Promise<FeedbackReply[]> {
  const local = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const clean = receipts
    .filter((receipt) => /^[A-Za-z0-9_-]{8,80}$/.test(receipt.id) && /^[A-Za-z0-9_-]{16,128}$/.test(receipt.token))
    .filter((receipt, index, rows) => rows.findIndex((row) => row.id === receipt.id) === index)
    .slice(-20);
  if (clean.length === 0) return [];
  try {
    const res = await withTimeout(callFetchFeedbackReplies({
      receipts: clean.map(({ id, token }) => ({ id, token })),
    }));
    return (res.data?.replies ?? [])
      .map((data) => {
        const receipt = local.get(data.id);
        return {
          id: data.id,
          text: receipt?.text ?? '',
          ctx: data.ctx ?? receipt?.ctx ?? '',
          ts: Number(data.ts ?? receipt?.ts ?? 0),
          reply: data.reply ?? '',
          replyTs: Number(data.replyTs ?? 0),
          status: data.status ?? 'open',
        };
      })
      .filter((row) => !!row.reply);
  } catch (error) {
    console.warn('Feedback reply fetch failed', error);
    return [];
  }
}

/** Build/version tag stamped on every telemetry event, so the dashboard can compare
 *  player outcomes BEFORE vs AFTER a balance patch. Bump this when you ship changes. */
export const TELEMETRY_BUILD = 'hollow-1';

export interface TelemetryEvent {
  kind: string;
  map: string;
  diff: string;
  wave: number;
  kills: number;
  cash: number;
  won: boolean;
  freeplay: boolean;
  durationS: number;
  leaks?: number;
  coresLeft?: number;
  /** comma-separated tower def ids fielded this run (for popularity analysis) */
  towers?: string;
  /** top damage contributors this run: "towerId:pct,..." (causal "who carried") */
  dmg?: string;
  /** commander abilities cast this run */
  abilities?: number;
  /** stamped automatically from TELEMETRY_BUILD — don't pass at the call site */
  build?: string;
}

/** anonymous gameplay telemetry -> telemetry collection (write-only for players). */
export function logTelemetry(e: TelemetryEvent): void {
  if (!canWriteAnalytics()) return; // restricted tier (under-13 / opted-out / GPC) writes nothing
  void (async () => {
    try {
      const serverUid = await ensureServerUid();
      if (!serverUid) return;
      const { fs, db } = await firestore();
      await fs.addDoc(fs.collection(db, 'telemetry'), {
        uid: serverUid,
        ts: Date.now(),
        kind: e.kind.slice(0, 30),
        map: e.map.slice(0, 30),
        diff: e.diff.slice(0, 30),
        wave: Math.max(0, Math.floor(e.wave)),
        kills: Math.max(0, Math.floor(e.kills)),
        cash: Math.max(0, Math.floor(e.cash)),
        won: e.won,
        freeplay: e.freeplay,
        durationS: Math.max(0, Math.floor(e.durationS)),
        leaks: Math.max(0, Math.floor(e.leaks ?? 0)),
        coresLeft: Math.max(0, Math.floor(e.coresLeft ?? 0)),
        towers: (e.towers ?? '').slice(0, 200),
        dmg: (e.dmg ?? '').slice(0, 120),
        abilities: Math.max(0, Math.floor(e.abilities ?? 0)),
        build: TELEMETRY_BUILD.slice(0, 30),
        expiresAt: ttlTimestamp(fs, TELEMETRY_TTL_MS),
      });
    } catch (error) {
      console.warn('Telemetry log failed', error);
      // Fire-and-forget telemetry must never affect the game loop.
    }
  })();
}

function sameReplayDoc(existing: PublicRunDoc | null, run: PublicRunDoc): boolean {
  return !!existing
    && existing.runId === run.runId
    && existing.replayTokenHash === run.replayTokenHash
    && existing.createdAt === run.createdAt
    && existing.endedAt === run.endedAt
    && Number(existing.eventCount ?? -1) === Number(run.eventCount ?? -2)
    && JSON.stringify(existing.manifest ?? null) === JSON.stringify(run.manifest ?? null);
}

export async function streamRunReplayChunk(chunk: RunEventChunkDoc, build: string): Promise<boolean> {
  if (!canSubmitScore()) return false;
  if (!isValidRunId(chunk.runId) || !validActionPack(chunk.actions)) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  const { fs, db } = await firestore();
  const now = Date.now();
  const expiresAt = ttlTimestamp(fs, REPLAY_STREAM_TTL_MS);
  const parentDoc = sanitizeFirestoreData({
    schemaVersion: 1,
    uid: serverUid,
    runId: chunk.runId,
    build: build.slice(0, 30),
    updatedAt: now,
    expiresAt,
  });
  const chunkDoc = sanitizeFirestoreData({
    schemaVersion: chunk.schemaVersion,
    uid: serverUid,
    runId: chunk.runId,
    chunk: Math.max(0, Math.floor(chunk.chunk)),
    actions: chunk.actions,
    createdAt: now,
    build: build.slice(0, 30),
    expiresAt,
  });
  try {
    const batch = fs.writeBatch(db);
    batch.set(fs.doc(db, 'replayStreams', serverUid, 'runs', chunk.runId), parentDoc, { merge: true });
    batch.set(fs.doc(db, 'replayStreams', serverUid, 'runs', chunk.runId, 'chunks', `c${chunkDoc.chunk}`), chunkDoc, { merge: false });
    await withTimeout(batch.commit());
    return true;
  } catch (error) {
    console.warn('Run replay stream failed', error);
    return false;
  }
}

export async function submitRunReplay(bundle: RunUploadBundle): Promise<RunReplaySubmitResult> {
  // Replay backs leaderboard verification, so it is SCORE-tier (every adult who posts),
  // not analytics-tier — a privacy-conscious adult must still produce a verifiable replay.
  if (!canSubmitScore()) return { ok: false };
  if (!isValidRunId(bundle.run.runId)) return { ok: false };
  const serverUid = await ensureServerUid();
  if (!serverUid) return { ok: false };
  const replayToken = replayTokenFor(bundle.run.runId);
  const replayTokenHash = await sha256Hex(replayToken);
  const run: PublicRunDoc = sanitizeFirestoreData({ ...bundle.run, replayTokenHash });
  const ownerDoc = sanitizeFirestoreData({
    schemaVersion: 1,
    uid: serverUid,
    runId: run.runId,
    createdAt: run.createdAt,
    build: run.build,
  });
  const streamSealDoc = sanitizeFirestoreData({
    schemaVersion: 1,
    uid: serverUid,
    runId: run.runId,
    build: run.build,
    updatedAt: Date.now(),
    submitted: true,
    sealedAt: Date.now(),
    chunkCount: run.chunkCount,
    eventCount: run.eventCount,
    manifest: run.manifest,
    summary: run.summary,
  });
  const chunks = bundle.chunks.map((chunk) => sanitizeFirestoreData(chunk));
  const { fs, db } = await firestore();
  try {
    // ONE atomic batch (single round-trip) instead of N parallel setDoc()s. Firing every chunk
    // write concurrently used to overrun Firestore's write stream ("resource-exhausted: Write
    // stream exhausted maximum allowed queued writes") and time out the whole submit.
    const batch = fs.writeBatch(db);
    batch.set(fs.doc(db, 'replayOwners', serverUid, 'runs', run.runId), ownerDoc);
    batch.set(fs.doc(db, 'replayStreams', serverUid, 'runs', run.runId), streamSealDoc, { merge: true });
    batch.set(fs.doc(db, 'runs', run.runId), run);
    for (const chunk of chunks) {
      batch.set(fs.doc(db, 'runs', run.runId, 'chunks', `c${chunk.chunk}`), chunk);
    }
    await withTimeout(batch.commit());
    return { ok: true, runId: run.runId, replayToken };
  } catch (error) {
    console.warn('Run replay submit failed', error);
    try {
      const snap = await withTimeout(fs.getDoc(fs.doc(db, 'runs', run.runId)));
      const existing = snap.exists() ? (snap.data() as PublicRunDoc) : null;
      if (sameReplayDoc(existing, run)) return { ok: true, runId: run.runId, replayToken };
    } catch {
      // Preserve the original upload failure.
    }
    return { ok: false };
  }
}

const replayCache = new Map<string, { expires: number; doc: RunReplayDoc | null }>();

function validActionPack(pack: unknown): pack is ReplayActionPack {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return false;
  const data = pack as Partial<ReplayActionPack>;
  return data.codec === 'r3'
    && Number.isInteger(data.count)
    && (data.count ?? -1) >= 0
    && (data.count ?? 0) <= MAX_REPLAY_CHUNK_EVENTS
    && Array.isArray(data.towerIds)
    && data.towerIds.every((id) => typeof id === 'string' && id.length <= 40)
    && typeof data.data === 'string'
    && data.data.length <= 200_000;
}

function validManifest(manifest: PublicRunDoc['manifest']): manifest is NonNullable<PublicRunDoc['manifest']> {
  return !!manifest
    && manifest.complete === true
    && Array.isArray(manifest.chunkEventCounts)
    && manifest.chunkEventCounts.every((count) => Number.isInteger(count) && count >= 0 && count <= MAX_REPLAY_CHUNK_EVENTS)
    && typeof manifest.actionHash === 'string'
    && /^[a-f0-9]{8}$/.test(manifest.actionHash);
}

/** Read a run replay by id (public get), reassembling overflow action chunks. */
export async function fetchRunReplay(runId: string): Promise<RunReplayDoc | null> {
  if (!isValidRunId(runId)) return null;
  const cached = replayCache.get(runId);
  if (cached && cached.expires > Date.now()) return cached.doc;
  try {
    const { fs, db } = await firestore();
    const snap = await withTimeout(fs.getDoc(fs.doc(db, 'runs', runId)));
    const doc = snap.exists() ? (snap.data() as PublicRunDoc) : null;
    const chunkCount = Math.max(0, Math.min(100, Math.floor(Number(doc?.chunkCount ?? 0))));
    const fetchedChunks: { i: number; exists: boolean; actions: ReplayActionPack | null }[] = [];
    if (doc && chunkCount > 0) {
      const chunkSnaps = await withTimeout(Promise.all(
        Array.from({ length: chunkCount }, (_, i) => fs.getDoc(fs.doc(db, 'runs', runId, 'chunks', `c${i}`))),
      ));
      chunkSnaps
        .map((chunkSnap, i) => {
          const data = chunkSnap.exists() ? chunkSnap.data() as { chunk?: number; actions?: unknown } : null;
          const chunk = {
            i,
            exists: chunkSnap.exists(),
            actions: validActionPack((data as { actions?: unknown } | null)?.actions) ? (data as { actions: ReplayActionPack }).actions : null,
          };
          fetchedChunks.push(chunk);
          return chunk;
        });
    }
    const integrity: ReplayIntegrity = (() => {
      if (!doc?.manifest) return 'partial';
      if (!validActionPack(doc.actions) || !validManifest(doc.manifest)) return 'partial';
      if (chunkCount !== doc.manifest.chunkEventCounts.length) return 'partial';
      if (fetchedChunks.length !== chunkCount) return 'partial';
      for (let i = 0; i < chunkCount; i++) {
        const chunk = fetchedChunks.find((row) => row.i === i);
        if (!chunk?.exists || !chunk.actions || chunk.actions.count !== doc.manifest.chunkEventCounts[i]) return 'partial';
      }
      const expectedEventCount = doc.actions.count + doc.manifest.chunkEventCounts.reduce((sum, count) => sum + count, 0);
      if (Number(doc.eventCount ?? 0) !== expectedEventCount) return 'partial';
      const sortedChunks = fetchedChunks
        .filter((chunk): chunk is { i: number; exists: boolean; actions: ReplayActionPack } => !!chunk.actions)
        .sort((a, b) => a.i - b.i)
        .map((chunk) => ({ actions: chunk.actions }));
      if (actionHash(doc.actions, sortedChunks) !== doc.manifest.actionHash) return 'partial';
      return 'complete';
    })();
    // light defensive normalization so a partial doc can't crash the viewer
    const chunks = fetchedChunks
      .filter((chunk): chunk is { i: number; exists: boolean; actions: ReplayActionPack } => !!chunk.actions)
      .sort((a, b) => a.i - b.i)
      .map((chunk) => ({
        schemaVersion: doc?.schemaVersion ?? 0,
        runId,
        chunk: chunk.i,
        actions: chunk.actions,
      }));
    const events = doc && validActionPack(doc.actions)
      ? decodeReplayActionBundle(doc.actions, chunks)
      : Array.isArray(doc?.events) ? doc.events : [];
    const snapshots = Array.isArray(doc?.snapshots) ? doc.snapshots : [];
    const safe = doc && doc.summary && doc.setup ? {
      ...doc,
      final: doc.final ?? { towers: [], damageByTower: {}, killsByEnemy: {}, abilitiesCast: 0, cashEarned: 0, leaks: 0 },
      chunks,
      events,
      snapshots,
      integrity,
    } : null;
    replayCache.set(runId, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, doc: safe });
    return safe;
  } catch (error) {
    console.warn('Run replay fetch failed', error);
    return null;
  }
}

export interface RunSnapshotRow {
  map: string; diff: string; wave: number; outcome: string;
  snapshots: { wave: number; lives: number; leaks: number }[];
}

/** Admin-only: list recent runs and return just their per-wave cores/leak snapshots
 *  (the live data source for the balance canary). `runs` list is admin-gated by rules;
 *  snapshots are embedded in each doc, so no chunk/subcollection reads. */
export async function fetchRunSnapshots(max = 300): Promise<RunSnapshotRow[]> {
  try {
    const { fs, db } = await firestore();
    const q = fs.query(fs.collection(db, 'runs'), fs.orderBy('endedAt', 'desc'), fs.limit(max));
    const snap = await withTimeout(fs.getDocs(q));
    return snap.docs.map((d) => {
      const r = d.data() as PublicRunDoc;
      return {
        map: r.summary?.map ?? '', diff: r.summary?.diff ?? '', wave: r.summary?.wave ?? 0,
        outcome: r.summary?.outcome ?? '',
        snapshots: [],
      };
    }).filter((r) => r.map && r.diff);
  } catch (error) {
    console.warn('Run snapshots fetch failed', error);
    return [];
  }
}

export async function submitRunAnalytics(doc: PrivateRunAnalyticsDoc): Promise<boolean> {
  // Sampling stays keyed on the LOCAL uid so unsampled runs never trigger a sign-in.
  if (!canWriteAnalytics() || !isSampledRun(progress.uid, doc.runId)) return false;
  if (!isValidRunId(doc.runId)) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  try {
    const { fs, db } = await firestore();
    await withTimeout(fs.setDoc(fs.doc(db, 'runAnalytics', doc.runId), { ...doc, uid: serverUid.slice(0, 40) }));
    return true;
  } catch (error) {
    console.warn('Run analytics submit failed', error);
    return false;
  }
}

export async function submitRunCheckpoint(doc: RunCheckpointDoc): Promise<boolean> {
  if (!canWriteAnalytics() || !isSampledRun(progress.uid, doc.runId)) return false;
  if (!isValidRunId(doc.runId)) return false;
  const serverUid = await ensureServerUid();
  if (!serverUid) return false;
  try {
    const { fs, db } = await firestore();
    const chunkId = `c${String(Math.max(0, Math.floor(doc.chunk))).padStart(6, '0')}`;
    await withTimeout(fs.setDoc(fs.doc(db, 'runCheckpoints', doc.runId, 'chunks', chunkId), {
      ...doc,
      uid: serverUid.slice(0, 40),
      expiresAt: ttlTimestamp(fs, CHECKPOINT_TTL_MS),
    }));
    return true;
  } catch (error) {
    console.warn('Run checkpoint submit failed', error);
    return false;
  }
}

export interface TelemetryRow extends TelemetryEvent {
  uid: string;
  ts: number;
}

type TelemetryData = TelemetryRow;

export interface RunAnalyticsRow extends NormalizedRunAnalytics {}

export function normalizeRunAnalytics(id: string, data: Partial<PrivateRunAnalyticsDoc>): RunAnalyticsRow {
  return normalizeRunAnalyticsDoc(id, data);
}

/** Admin-only: read recent telemetry events for the dashboard. */
export async function fetchTelemetry(limit = 1000): Promise<TelemetryRow[]> {
  try {
    const { fs, db } = await firestore();
    const q = fs.query(fs.collection(db, 'telemetry'), fs.orderBy('ts', 'desc'), fs.limit(limit));
    const snap = await withTimeout(fs.getDocs(q));
    return snap.docs.map((d) => {
      const data = d.data() as Partial<TelemetryData>;
      return {
        uid: data.uid ?? '',
        ts: Number(data.ts ?? 0),
        kind: data.kind ?? '',
        map: data.map ?? '',
        diff: data.diff ?? '',
        wave: Number(data.wave ?? 0),
        kills: Number(data.kills ?? 0),
        cash: Number(data.cash ?? 0),
        won: data.won ?? false,
        freeplay: data.freeplay ?? false,
        durationS: Number(data.durationS ?? 0),
        leaks: Number(data.leaks ?? 0),
        coresLeft: Number(data.coresLeft ?? 0),
        towers: data.towers ?? '',
        dmg: data.dmg ?? '',
        abilities: Number(data.abilities ?? 0),
        build: data.build ?? '',
      };
    });
  } catch {
    return [];
  }
}

export async function fetchRunAnalytics(limit = 1000): Promise<RunAnalyticsRow[]> {
  try {
    const { fs, db } = await firestore();
    const q = fs.query(fs.collection(db, 'runAnalytics'), fs.orderBy('endedAt', 'desc'), fs.limit(limit));
    const snap = await withTimeout(fs.getDocs(q));
    return snap.docs.map((d) => normalizeRunAnalytics(d.id, d.data() as Partial<PrivateRunAnalyticsDoc>));
  } catch {
    return [];
  }
}

export async function fetchRunAnalyticsById(runId: string): Promise<RunAnalyticsRow | null> {
  if (!isValidRunId(runId)) return null;
  try {
    const { fs, db } = await firestore();
    const snap = await withTimeout(fs.getDoc(fs.doc(db, 'runAnalytics', runId)));
    return snap.exists() ? normalizeRunAnalytics(snap.id, snap.data() as Partial<PrivateRunAnalyticsDoc>) : null;
  } catch {
    return null;
  }
}

function scoreRowFromData(data: Partial<ScoreEntry>): ScoreEntry {
  return {
    name: data.name ?? '???',
    cash: Number(data.cash ?? 0),
    kills: Number(data.kills ?? 0),
    wave: Number(data.wave ?? 0),
    freeplay: data.freeplay ?? false,
    ts: Number(data.ts ?? 0),
    uid: data.uid ?? '',
    runId: data.runId ?? '',
    meta: data.meta ?? '',
    daily: data.daily ?? '',
    weekly: data.weekly ?? '',
    gauntlet: data.gauntlet ?? '',
    checkpoint: data.checkpoint ?? false,
    verify: normalizeVerify(data.verify, data.runId),
  };
}

export async function fetchBoardRowsForRun(runId: string, dailyId = ''): Promise<RunBoardScoreRow[]> {
  if (!isValidRunId(runId)) return [];
  try {
    const { fs, db } = await firestore();
    const boards = ALL_MAPS.flatMap((map) => DIFFICULTIES.flatMap((diff) => [
      boardId(map.id, diff.id, false),
      boardId(map.id, diff.id, true),
    ]));
    const boardReads = boards.map(async (board): Promise<RunBoardScoreRow[]> => {
      const q = fs.query(fs.collection(db, 'boards', board, 'scores'), fs.where('runId', '==', runId), fs.limit(5));
      const snap = await fs.getDocs(q);
      const meta = boardMeta(board);
      return snap.docs.map((d) => ({
        ...scoreRowFromData(d.data() as Partial<ScoreEntry>),
        board,
        kind: board.endsWith('_fp') ? 'freeplay' : 'campaign',
        ...(meta ?? {}),
      }));
    });
    const dailyReads = dailyBoardId(dailyId)
      ? [fs.getDocs(fs.query(fs.collection(db, 'dailyBoards', dailyId, 'scores'), fs.where('runId', '==', runId), fs.limit(5)))
        .then((snap) => snap.docs.map((d): RunBoardScoreRow => ({
          ...scoreRowFromData(d.data() as Partial<ScoreEntry>),
          board: dailyId,
          kind: 'daily',
        })))]
      : [];
    const groups = await withTimeout(Promise.all([...boardReads, ...dailyReads]));
    return groups.flat();
  } catch (error) {
    console.warn('Run board row fetch failed', error);
    return [];
  }
}

async function readTop(board: string, limit = 10): Promise<ScoreEntry[]> {
  if (!validBoard(board)) return [];
  const cacheKey = `${board}:${limit}`;
  const cached = topCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cloneScores(cached.rows);
  const sortField = board.endsWith('_fp') ? 'wave' : 'cash';
  const fetchLimit = board.endsWith('_fp') ? Math.min(50, Math.max(limit, limit * 4)) : limit;
  const { fs, db } = await firestore();
  const q = fs.query(fs.collection(db, 'boards', board, 'scores'), fs.orderBy(sortField, 'desc'), fs.limit(fetchLimit));
  const snap = await withTimeout(fs.getDocs(q));
  const rows = snap.docs.map((d) => {
    const data = d.data() as Partial<ScoreEntry>;
    return {
      name: data.name ?? '???',
      cash: Number(data.cash ?? 0),
      kills: Number(data.kills ?? 0),
      wave: Number(data.wave ?? 0),
      freeplay: data.freeplay ?? false,
      ts: Number(data.ts ?? 0),
      uid: data.uid ?? '',
      runId: data.runId ?? '',
      meta: data.meta ?? '',
      daily: data.daily ?? '',
      checkpoint: data.checkpoint ?? false,
    };
  }).filter((row) => !row.daily).slice(0, limit);
  topCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows });
  return cloneScores(rows);
}

export async function fetchTopResult(board: string, limit = 10): Promise<LeaderboardFetchResult<ScoreEntry>> {
  try {
    return { rows: await readTop(board, limit), error: false };
  } catch {
    return { rows: [], error: true };
  }
}

export async function fetchTop(board: string, limit = 10): Promise<ScoreEntry[]> {
  const result = await fetchTopResult(board, limit);
  return result.rows;
}

export async function fetchDailyTop(dailyId: string, limit = 10): Promise<ScoreEntry[]> {
  const board = dailyBoardId(dailyId);
  if (!validDailyBoard(board)) return [];
  const cacheKey = `daily:${board}:${limit}`;
  const cached = topCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cloneScores(cached.rows);
  try {
    const { fs, db } = await firestore();
    const q = fs.query(fs.collection(db, 'dailyBoards', board, 'scores'), fs.orderBy('wave', 'desc'), fs.limit(limit));
    const snap = await withTimeout(fs.getDocs(q));
    const rows = snap.docs.map((d) => {
      const data = d.data() as Partial<ScoreEntry>;
      return {
        name: data.name ?? '???',
        cash: Number(data.cash ?? 0),
        kills: Number(data.kills ?? 0),
        wave: Number(data.wave ?? 0),
        freeplay: false,
        ts: Number(data.ts ?? 0),
        uid: data.uid ?? '',
        runId: data.runId ?? '',
        meta: data.meta ?? '',
        daily: data.daily ?? board,
        checkpoint: data.checkpoint ?? false,
      };
    });
    topCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows });
    return cloneScores(rows);
  } catch {
    return [];
  }
}

export async function fetchWeeklyTop(weeklyId: string, limit = 10): Promise<ScoreEntry[]> {
  return fetchRitualTop('weeklyBoards', weeklyId, 'weekly', limit);
}

export async function fetchGauntletTop(week: string, limit = 10): Promise<ScoreEntry[]> {
  return fetchRitualTop('gauntletBoards', week, 'gauntlet', limit);
}

async function fetchRitualTop(collectionName: 'weeklyBoards' | 'gauntletBoards', boardIdValue: string, field: 'weekly' | 'gauntlet', limit = 10): Promise<ScoreEntry[]> {
  const board = weeklyBoardId(boardIdValue);
  if (!validWeeklyBoard(board)) return [];
  const cacheKey = `${field}:${board}:${limit}`;
  const cached = topCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cloneScores(cached.rows);
  try {
    const { fs, db } = await firestore();
    const q = fs.query(fs.collection(db, collectionName, board, 'scores'), fs.orderBy('wave', 'desc'), fs.limit(limit));
    const snap = await withTimeout(fs.getDocs(q));
    const rows = snap.docs.map((d) => {
      const data = d.data() as Partial<ScoreEntry>;
      return {
        name: data.name ?? '???',
        cash: Number(data.cash ?? 0),
        kills: Number(data.kills ?? 0),
        wave: Number(data.wave ?? 0),
        freeplay: false,
        ts: Number(data.ts ?? 0),
        uid: data.uid ?? '',
        runId: data.runId ?? '',
        meta: data.meta ?? '',
        daily: data.daily ?? '',
        weekly: field === 'weekly' ? data.weekly ?? board : data.weekly ?? '',
        gauntlet: field === 'gauntlet' ? data.gauntlet ?? board : data.gauntlet ?? '',
        checkpoint: data.checkpoint ?? false,
      };
    });
    topCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows });
    return cloneScores(rows);
  } catch {
    return [];
  }
}

interface GlobalTopAggregateRow extends ScoreEntry {
  board?: string;
}

/** Read the server-maintained aggregates/globalTop doc; null when absent (pre-migration). */
async function readGlobalTopAggregate(freeplay: boolean, limit: number): Promise<RankedScoreEntry[] | null> {
  const { fs, db } = await firestore();
  const snap = await withTimeout(fs.getDoc(fs.doc(db, 'aggregates', 'globalTop')));
  if (!snap.exists()) return null;
  const data = snap.data() as { campaign?: GlobalTopAggregateRow[]; freeplay?: GlobalTopAggregateRow[] };
  const list = freeplay ? data.freeplay : data.campaign;
  if (!Array.isArray(list)) return null;
  return list
    .map((row): RankedScoreEntry | null => {
      const meta = row.board ? boardMeta(row.board) : null;
      if (!meta) return null;
      return {
        name: String(row.name ?? '???'),
        cash: Number(row.cash ?? 0),
        kills: Number(row.kills ?? 0),
        wave: Number(row.wave ?? 0),
        freeplay: !!row.freeplay,
        ts: Number(row.ts ?? 0),
        uid: String(row.uid ?? ''),
        runId: String(row.runId ?? ''),
        checkpoint: row.checkpoint ?? false,
        verify: normalizeVerify(row.verify, row.runId),
        ...meta,
      };
    })
    .filter((row): row is RankedScoreEntry => row !== null)
    .slice(0, limit);
}

export async function fetchGlobalTopResult(freeplay: boolean, limit = 20): Promise<LeaderboardFetchResult<RankedScoreEntry>> {
  const cacheKey = `${freeplay ? 'fp' : 'campaign'}:${limit}`;
  const cached = globalTopCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return { rows: cloneScores(cached.rows), error: false };
  // Fast path: ONE aggregate-doc read, maintained by the score functions.
  try {
    const aggregated = await readGlobalTopAggregate(freeplay, limit);
    if (aggregated) {
      globalTopCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows: aggregated });
      return { rows: cloneScores(aggregated), error: false };
    }
  } catch {
    // fall through to the legacy fan-out below
  }
  // Legacy fallback (aggregate doc absent — no scores accepted since the
  // migration): 32-board fan-out, up to ~320 reads. Goes away naturally once
  // the first post-migration score lands.
  const boards = ALL_MAPS.flatMap((map) =>
    DIFFICULTIES.map((diff) => boardId(map.id, diff.id, freeplay)));
  const perBoardLimit = Math.max(3, Math.min(10, limit));
  try {
    const rows = await Promise.all(boards.map(async (board) => {
      const meta = boardMeta(board);
      if (!meta) return [];
      const scores = await readTop(board, perBoardLimit);
      return scores.map((score) => ({ ...score, ...meta }));
    }));
    const sortField: keyof ScoreEntry = freeplay ? 'wave' : 'cash';
    const sorted = rows
      .flat()
      .sort((a, b) => (Number(b[sortField]) - Number(a[sortField])) || b.kills - a.kills || b.ts - a.ts)
      .slice(0, limit)
      .map((row) => ({ ...row }));
    globalTopCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows: sorted });
    return { rows: cloneScores(sorted), error: false };
  } catch {
    return { rows: [], error: true };
  }
}

export async function fetchGlobalTop(freeplay: boolean, limit = 20): Promise<RankedScoreEntry[]> {
  const result = await fetchGlobalTopResult(freeplay, limit);
  return result.rows;
}
