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
import type { PrivateRunAnalyticsDoc, RunCheckpointDoc, RunUploadBundle, PublicRunDoc } from './runTelemetry';

const VALID_MAPS = new Set(ALL_MAPS.map((m) => m.id));
const VALID_DIFFS = new Set(DIFFICULTIES.map((d) => d.id));
const DAILY_BOARD_RE = /^daily-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const LEADERBOARD_CACHE_TTL_MS = 30_000;
const REPLAY_TOKEN_KEY = 'nvd-replay-tokens-v1';
const topCache = new Map<string, { expires: number; rows: ScoreEntry[] }>();
const globalTopCache = new Map<string, { expires: number; rows: RankedScoreEntry[] }>();

// Firestore web writes/reads resolve only on server ack and DO NOT reject when the
// network is blocked (a common portal-iframe CSP config) or offline — the promise
// just hangs forever, freezing any UI that awaits it. Race every network call
// against a timeout so callers always settle into their existing catch/empty path.
const NET_TIMEOUT_MS = 8000;

// Retention: expiresAt drives Firestore TTL policies (see docs/tech_spec.md).
// TTL requires a real Timestamp field — plain number `ts` fields are invisible
// to TTL, which is why raw streams never expired before this.
const CHECKPOINT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // live diagnostics: 30 days
const TELEMETRY_TTL_MS = 180 * 24 * 60 * 60 * 1000; // compact outcome rows: 180 days
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
  checkpoint?: boolean;
}

export interface RankedScoreEntry extends ScoreEntry {
  board: string;
  map: string;
  diff: string;
  mapName: string;
  diffName: string;
}

export interface LeaderboardFetchResult<T> {
  rows: T[];
  error: boolean;
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

function validBoard(board: string): boolean {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  return !!match?.groups && VALID_MAPS.has(match.groups.map) && VALID_DIFFS.has(match.groups.diff);
}

function validDailyBoard(board: string): boolean {
  return DAILY_BOARD_RE.test(board);
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
  if (entry.checkpoint !== undefined) payload.checkpoint = !!entry.checkpoint;
  return payload;
}

// Scores are written SERVER-SIDE by the submitScore/submitDailyScore Cloud Functions
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

const callSubmitScore =
  httpsCallable<{ board: string; entry: ScoreEntry }, SubmitScoreResult>(functions, 'submitScore');
const callSubmitDailyScore =
  httpsCallable<{ dailyId: string; entry: ScoreEntry }, SubmitScoreResult>(functions, 'submitDailyScore');
const callSubmitFeedback =
  httpsCallable<{ uid: string; text: string; ctx: string }, SubmitFeedbackResult>(functions, 'submitFeedback');
const callFetchFeedbackReplies =
  httpsCallable<{ receipts: { id: string; token: string }[] }, FeedbackRepliesResult>(functions, 'fetchFeedbackReplies');

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
  const payload = scorePayload({ ...entry, freeplay: true, daily: board }, serverUid);
  try {
    const res = await withTimeout(callSubmitDailyScore({ dailyId: board, entry: payload }));
    if (res.data?.accepted) { invalidateDailyBoardCache(board); return true; }
    if (res.data?.reason) { console.warn('Daily score rejected by server', res.data.reason); return false; }
  } catch (error) {
    console.warn('Daily score submit failed', error);
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
    && Number(existing.eventCount ?? -1) === Number(run.eventCount ?? -2);
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
  const chunks = bundle.chunks.map((chunk) => sanitizeFirestoreData(chunk));
  const { fs, db } = await firestore();
  try {
    // ONE atomic batch (single round-trip) instead of N parallel setDoc()s. Firing every chunk
    // write concurrently used to overrun Firestore's write stream ("resource-exhausted: Write
    // stream exhausted maximum allowed queued writes") and time out the whole submit.
    const batch = fs.writeBatch(db);
    batch.set(fs.doc(db, 'replayOwners', serverUid, 'runs', run.runId), ownerDoc);
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

const replayCache = new Map<string, { expires: number; doc: PublicRunDoc | null }>();

/** Read a run replay by id (public get), reassembling overflow event chunks. */
export async function fetchRunReplay(runId: string): Promise<PublicRunDoc | null> {
  if (!isValidRunId(runId)) return null;
  const cached = replayCache.get(runId);
  if (cached && cached.expires > Date.now()) return cached.doc;
  try {
    const { fs, db } = await firestore();
    const snap = await withTimeout(fs.getDoc(fs.doc(db, 'runs', runId)));
    const doc = snap.exists() ? (snap.data() as PublicRunDoc) : null;
    let events = Array.isArray(doc?.events) ? doc.events : [];
    const chunkCount = Math.max(0, Math.min(100, Math.floor(Number(doc?.chunkCount ?? 0))));
    if (doc && chunkCount > 0) {
      const chunkSnaps = await withTimeout(Promise.all(
        Array.from({ length: chunkCount }, (_, i) => fs.getDoc(fs.doc(db, 'runs', runId, 'chunks', `c${i}`))),
      ));
      const chunkEvents = chunkSnaps
        .map((chunkSnap, i) => {
          const data = chunkSnap.exists() ? chunkSnap.data() as { chunk?: number; events?: unknown } : null;
          return { i, events: Array.isArray(data?.events) ? data.events as PublicRunDoc['events'] : [] };
        })
        .sort((a, b) => a.i - b.i)
        .flatMap((chunk) => chunk.events);
      events = [...events, ...chunkEvents];
    }
    // light defensive normalization so a partial/legacy doc can't crash the viewer
    const safe = doc && doc.summary && doc.setup ? {
      ...doc,
      snapshots: Array.isArray(doc.snapshots) ? doc.snapshots : [],
      events,
      final: doc.final ?? { towers: [], damageByTower: {}, killsByEnemy: {}, abilitiesCast: 0, cashEarned: 0, leaks: 0 },
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
        snapshots: (Array.isArray(r.snapshots) ? r.snapshots : []).map((s) => ({ wave: s.wave, lives: s.lives, leaks: s.leaks })),
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

export interface RunAnalyticsRow extends PrivateRunAnalyticsDoc {
  id: string;
}

function normalizeRunAnalytics(id: string, data: Partial<PrivateRunAnalyticsDoc>): RunAnalyticsRow {
  const summary = {
    callsign: '',
    map: '',
    mapName: '',
    diff: '',
    diffName: '',
    freeplay: false,
    outcome: 'abandoned' as const,
    phase: '',
    wave: 0,
    kills: 0,
    credits: 0,
    cashEarned: 0,
    leaks: 0,
    coresLeft: 0,
    durationS: 0,
    ...(data.summary ?? {}),
  };
  const appMenu = (data.menu ?? {}) as Partial<PrivateRunAnalyticsDoc['menu']>;
  const appControls = (data.controls ?? {}) as Partial<PrivateRunAnalyticsDoc['controls']>;
  const assistance = (data.assistance ?? {}) as Partial<PrivateRunAnalyticsDoc['assistance']>;
  const freeplay = (data.freeplay ?? {}) as Partial<PrivateRunAnalyticsDoc['freeplay']>;
  const performance = (data.performance ?? {}) as Partial<PrivateRunAnalyticsDoc['performance']>;
  return {
    id,
    schemaVersion: Number(data.schemaVersion ?? 1),
    runId: data.runId ?? id,
    uid: data.uid ?? '',
    createdAt: Number(data.createdAt ?? 0),
    endedAt: Number(data.endedAt ?? data.createdAt ?? 0),
    build: data.build ?? '',
    summary,
    onboarding: data.onboarding ?? {},
    abandonment: data.abandonment ?? {},
    difficulty: data.difficulty ?? {},
    economy: data.economy ?? {},
    menu: {
      pageAgeAtDeployS: Number(appMenu.pageAgeAtDeployS ?? 0),
      deployAttempts: Number(appMenu.deployAttempts ?? 0),
      deployBlocked: Number(appMenu.deployBlocked ?? 0),
      firstDeployAtS: Number(appMenu.firstDeployAtS ?? 0),
      tabSwitches: Number(appMenu.tabSwitches ?? 0),
      deployTabOpens: Number(appMenu.deployTabOpens ?? 0),
      leaderboardTabOpens: Number(appMenu.leaderboardTabOpens ?? 0),
      selectedMap: appMenu.selectedMap ?? null,
      selectedDiff: appMenu.selectedDiff ?? null,
      mapSelections: appMenu.mapSelections ?? {},
      protocolSelections: appMenu.protocolSelections ?? {},
      lockedMapClicks: appMenu.lockedMapClicks ?? {},
      lockedProtocolClicks: appMenu.lockedProtocolClicks ?? {},
    },
    controls: {
      keyboardInputs: Number(appControls.keyboardInputs ?? 0),
      pointerInputs: Number(appControls.pointerInputs ?? 0),
      touchInputs: Number(appControls.touchInputs ?? 0),
      soundToggles: Number(appControls.soundToggles ?? 0),
      musicToggles: Number(appControls.musicToggles ?? 0),
      pauseToggles: Number(appControls.pauseToggles ?? 0),
      firstPauseAt: Number(appControls.firstPauseAt ?? 0),
      speedChanges: Number(appControls.speedChanges ?? 0),
      speed1Clicks: Number(appControls.speed1Clicks ?? 0),
      speed2Clicks: Number(appControls.speed2Clicks ?? 0),
      speed4Clicks: Number(appControls.speed4Clicks ?? 0),
      autoToggles: Number(appControls.autoToggles ?? 0),
      sidePanelCollapses: Number(appControls.sidePanelCollapses ?? 0),
      sidePanelExpands: Number(appControls.sidePanelExpands ?? 0),
      abortArmed: Number(appControls.abortArmed ?? 0),
      abortConfirmed: Number(appControls.abortConfirmed ?? 0),
      placementCancels: Number(appControls.placementCancels ?? 0),
      abilityAimCancels: Number(appControls.abilityAimCancels ?? 0),
      waveLaunchClicks: Number(appControls.waveLaunchClicks ?? 0),
      waveLaunchKeys: Number(appControls.waveLaunchKeys ?? 0),
      cloakTipViews: Number(appControls.cloakTipViews ?? 0),
      tutorialViews: Number(appControls.tutorialViews ?? 0),
      briefingViews: Number(appControls.briefingViews ?? 0),
    },
    combat: {
      firstLeakWave: Number(data.combat?.firstLeakWave ?? 0),
      biggestLeakWave: Number(data.combat?.biggestLeakWave ?? 0),
      biggestLeakCores: Number(data.combat?.biggestLeakCores ?? 0),
      leaksByEnemy: data.combat?.leaksByEnemy ?? {},
      cloakedLeakCores: Number(data.combat?.cloakedLeakCores ?? 0),
      revealedLeakCores: Number(data.combat?.revealedLeakCores ?? 0),
      armoredLeakCores: Number(data.combat?.armoredLeakCores ?? 0),
      bossLeakCores: Number(data.combat?.bossLeakCores ?? 0),
      peakEnemies: Number(data.combat?.peakEnemies ?? 0),
      waveStarts: Number(data.combat?.waveStarts ?? 0),
      waveEnds: Number(data.combat?.waveEnds ?? 0),
      avgWaveDurationS: Number(data.combat?.avgWaveDurationS ?? 0),
      longestWaveDurationS: Number(data.combat?.longestWaveDurationS ?? 0),
      enemiesAtEnd: Number(data.combat?.enemiesAtEnd ?? 0),
      abilityCasts: data.combat?.abilityCasts ?? {},
      pickupCollects: data.combat?.pickupCollects ?? {},
    },
    placement: {
      firstTowerId: data.placement?.firstTowerId ?? null,
      buildOrder: data.placement?.buildOrder ?? [],
      upgradeOrder: data.placement?.upgradeOrder ?? [],
      placedByTower: data.placement?.placedByTower ?? {},
      soldByTower: data.placement?.soldByTower ?? {},
      failedByReason: data.placement?.failedByReason ?? {},
      failedByTower: data.placement?.failedByTower ?? {},
      failedUpgradeByReason: data.placement?.failedUpgradeByReason ?? {},
      placementCells: data.placement?.placementCells ?? {},
      failedPlacementCells: data.placement?.failedPlacementCells ?? {},
      sellCells: data.placement?.sellCells ?? {},
      beaconZonePlacements: Number(data.placement?.beaconZonePlacements ?? 0),
      darkZonePlacements: Number(data.placement?.darkZonePlacements ?? 0),
      blueprintSaves: Number(data.placement?.blueprintSaves ?? 0),
      blueprintApplies: Number(data.placement?.blueprintApplies ?? 0),
      blueprintApplyPlaced: Number(data.placement?.blueprintApplyPlaced ?? 0),
      targetModeChanges: Number(data.placement?.targetModeChanges ?? 0),
      quickSellbacks: Number(data.placement?.quickSellbacks ?? 0),
    },
    assistance: {
      aiMenuOpens: Number(assistance.aiMenuOpens ?? 0),
      aiGameOpens: Number(assistance.aiGameOpens ?? 0),
      aiQuestions: Number(assistance.aiQuestions ?? 0),
      aiSuccesses: Number(assistance.aiSuccesses ?? 0),
      aiErrors: Number(assistance.aiErrors ?? 0),
      aiQuotaErrors: Number(assistance.aiQuotaErrors ?? 0),
      feedbackMenuOpens: Number(assistance.feedbackMenuOpens ?? 0),
      feedbackGameOpens: Number(assistance.feedbackGameOpens ?? 0),
      feedbackSubmits: Number(assistance.feedbackSubmits ?? 0),
      feedbackSuccesses: Number(assistance.feedbackSuccesses ?? 0),
      feedbackErrors: Number(assistance.feedbackErrors ?? 0),
      feedbackRepliesViewed: Number(assistance.feedbackRepliesViewed ?? 0),
      widgetPauseS: Number(assistance.widgetPauseS ?? 0),
    },
    freeplay: {
      entered: Boolean(freeplay.entered ?? summary.freeplay),
      contractId: freeplay.contractId ?? null,
      dailyId: freeplay.dailyId ?? null,
      scoreMultiplierEnd: Number(freeplay.scoreMultiplierEnd ?? 1),
      contractSelections: freeplay.contractSelections ?? {},
      relicOffers: Number(freeplay.relicOffers ?? 0),
      relicSelections: freeplay.relicSelections ?? {},
      riskOffers: freeplay.riskOffers ?? {},
      riskAccepted: freeplay.riskAccepted ?? {},
      riskDeclined: freeplay.riskDeclined ?? {},
      riskCleared: freeplay.riskCleared ?? {},
      checkpointSubmits: Number(freeplay.checkpointSubmits ?? 0),
      mutatorWaves: freeplay.mutatorWaves ?? {},
      rivalSpawns: freeplay.rivalSpawns ?? {},
      rivalDefeats: freeplay.rivalDefeats ?? {},
    },
    towerInterest: {
      shopOpens: Number(data.towerInterest?.shopOpens ?? 0),
      shopSelections: data.towerInterest?.shopSelections ?? {},
      lockedTowerClicks: data.towerInterest?.lockedTowerClicks ?? {},
      unaffordableTowerClicks: data.towerInterest?.unaffordableTowerClicks ?? {},
      failedPlacements: Number(data.towerInterest?.failedPlacements ?? 0),
      upgradePanelOpens: Number(data.towerInterest?.upgradePanelOpens ?? 0),
      upgradePanelByTower: data.towerInterest?.upgradePanelByTower ?? {},
      failedUpgrades: Number(data.towerInterest?.failedUpgrades ?? 0),
      quickSellbacks: Number(data.towerInterest?.quickSellbacks ?? 0),
      targetModeChanges: Number(data.towerInterest?.targetModeChanges ?? 0),
      abilityUses: data.towerInterest?.abilityUses ?? {},
      pickupCollects: data.towerInterest?.pickupCollects ?? {},
    },
    progression: {
      lifetimeKillsAtStart: Number(data.progression?.lifetimeKillsAtStart ?? 0),
      runsBeforeStart: Number(data.progression?.runsBeforeStart ?? 0),
      victoriesBeforeStart: Number(data.progression?.victoriesBeforeStart ?? 0),
      firstSeenAt: Number(data.progression?.firstSeenAt ?? 0),
      lastSeenAt: Number(data.progression?.lastSeenAt ?? 0),
      sessions: Number(data.progression?.sessions ?? 0),
      sessionsToday: Number(data.progression?.sessionsToday ?? 0),
      daysSinceFirstSeen: Number(data.progression?.daysSinceFirstSeen ?? 0),
      daysSinceLastSeen: Number(data.progression?.daysSinceLastSeen ?? 0),
      unlocksEarned: data.progression?.unlocksEarned ?? [],
      unlocksViewed: data.progression?.unlocksViewed ?? [],
      unlockedTowerIdsUsed: data.progression?.unlockedTowerIdsUsed ?? [],
    },
    leaderboard: data.leaderboard ?? {},
    attention: {
      activeS: Number(data.attention?.activeS ?? 0),
      hiddenS: Number(data.attention?.hiddenS ?? 0),
      idleS: Number(data.attention?.idleS ?? 0),
      pausedS: Number(data.attention?.pausedS ?? 0),
      focusLosses: Number(data.attention?.focusLosses ?? 0),
      sessionS: Number(data.attention?.sessionS ?? 0),
      sidePanelS: Number(data.attention?.sidePanelS ?? 0),
      shopPanelS: Number(data.attention?.shopPanelS ?? 0),
      upgradePanelS: Number(data.attention?.upgradePanelS ?? 0),
      overlayS: Number(data.attention?.overlayS ?? 0),
      widgetOpenS: Number(data.attention?.widgetOpenS ?? 0),
      speed1S: Number(data.attention?.speed1S ?? 0),
      speed2S: Number(data.attention?.speed2S ?? 0),
      speed4S: Number(data.attention?.speed4S ?? 0),
    },
    performance: {
      viewportW: Number(performance.viewportW ?? 0),
      viewportH: Number(performance.viewportH ?? 0),
      devicePixelRatio: Number(performance.devicePixelRatio ?? 1),
      fpsMin: Number(performance.fpsMin ?? 0),
      fpsAvg: Number(performance.fpsAvg ?? 0),
      fpsSamples: Number(performance.fpsSamples ?? 0),
      longFrames: Number(performance.longFrames ?? 0),
      qualityDowngrades: Number(performance.qualityDowngrades ?? 0),
      qualityRecoveries: Number(performance.qualityRecoveries ?? 0),
      displayStandalone: Boolean(performance.displayStandalone ?? false),
      installPromptSeen: Number(performance.installPromptSeen ?? 0),
      installed: Number(performance.installed ?? 0),
      userAgent: performance.userAgent ?? '',
    },
  };
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
        freeplay: true,
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
  // migration): 40-board fan-out, up to ~400 reads. Goes away naturally once
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
