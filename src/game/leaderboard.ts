// Global leaderboards, feedback, and telemetry on Firestore.
// Firebase web config is public by design; access control lives in firestore.rules.

import {
  addDoc,
  collection,
  doc as firestoreDoc,
  getDoc,
  getDocs,
  limit as limitResults,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebaseClient';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { progress } from './storage';
import type { PrivateRunAnalyticsDoc, RunUploadBundle } from './runTelemetry';

const VALID_MAPS = new Set(ALL_MAPS.map((m) => m.id));
const VALID_DIFFS = new Set(DIFFICULTIES.map((d) => d.id));

export interface ScoreEntry {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid?: string;
  runId?: string;
}

export interface RankedScoreEntry extends ScoreEntry {
  board: string;
  map: string;
  diff: string;
  mapName: string;
  diffName: string;
}

/** board id for a mode: mapId_diffId, with _fp for freeplay runs */
export function boardId(mapId: string, diffId: string, freeplay: boolean): string {
  return `${mapId}_${diffId}${freeplay ? '_fp' : ''}`;
}

function validBoard(board: string): boolean {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  return !!match?.groups && VALID_MAPS.has(match.groups.map) && VALID_DIFFS.has(match.groups.diff);
}

function isValidRunId(id: string): boolean {
  return /^r_[A-Za-z0-9_-]{8,80}$/.test(id);
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

export async function submitScore(board: string, entry: ScoreEntry): Promise<boolean> {
  if (!validBoard(board)) return false;
  try {
    const payload: ScoreEntry = {
      name: entry.name.slice(0, 20),
      cash: Math.max(0, Math.floor(entry.cash)),
      kills: Math.max(0, Math.floor(entry.kills)),
      wave: Math.max(0, Math.floor(entry.wave)),
      freeplay: entry.freeplay,
      ts: Math.floor(entry.ts),
      uid: (entry.uid ?? progress.uid).slice(0, 40),
    };
    if (entry.runId && isValidRunId(entry.runId)) payload.runId = entry.runId;
    await addDoc(collection(db, 'boards', board, 'scores'), payload);
    return true;
  } catch (error) {
    console.warn('Score submit failed', error);
    return false;
  }
}

/** player feedback -> feedback collection. A local per-device id correlates replies without login. */
export async function submitFeedback(text: string, ctx: string): Promise<string | null> {
  try {
    const ref = await addDoc(collection(db, 'feedback'), {
      uid: progress.uid,
      text: text.slice(0, 1000),
      ts: Date.now(),
      ctx: ctx.slice(0, 200),
      status: 'open',
    });
    return ref.id;
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

type FeedbackData = {
  text?: string;
  ctx?: string;
  ts?: number;
  reply?: string;
  replyTs?: number;
  status?: string;
};

/** Fetch only feedback documents this browser created, so replies can show without player login. */
export async function fetchFeedbackReplies(ids: string[]): Promise<FeedbackReply[]> {
  const clean = [...new Set(ids)]
    .filter((id) => /^[A-Za-z0-9_-]{8,80}$/.test(id))
    .slice(-20);
  if (clean.length === 0) return [];
  try {
    const snaps = await Promise.all(clean.map(async (id) => {
      try {
        return await getDoc(firestoreDoc(db, 'feedback', id));
      } catch {
        return null;
      }
    }));
    return snaps
      .filter((snap): snap is NonNullable<typeof snap> => snap !== null && snap.exists())
      .map((snap) => {
        const data = snap.data() as FeedbackData;
        return {
          id: snap.id,
          text: data.text ?? '',
          ctx: data.ctx ?? '',
          ts: Number(data.ts ?? 0),
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
  void (async () => {
    try {
      await addDoc(collection(db, 'telemetry'), {
        uid: progress.uid,
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
      });
    } catch (error) {
      console.warn('Telemetry log failed', error);
      // Fire-and-forget telemetry must never affect the game loop.
    }
  })();
}

export async function submitRunReplay(bundle: RunUploadBundle): Promise<boolean> {
  if (!isValidRunId(bundle.run.runId)) return false;
  try {
    await setDoc(firestoreDoc(db, 'runs', bundle.run.runId), bundle.run);
    await Promise.all(bundle.chunks.map((chunk) =>
      setDoc(firestoreDoc(db, 'runs', bundle.run.runId, 'chunks', `c${chunk.chunk}`), chunk)));
    return true;
  } catch (error) {
    console.warn('Run replay submit failed', error);
    return false;
  }
}

export async function submitRunAnalytics(doc: PrivateRunAnalyticsDoc): Promise<boolean> {
  if (!isValidRunId(doc.runId)) return false;
  try {
    await setDoc(firestoreDoc(db, 'runAnalytics', doc.runId), doc, { merge: true });
    return true;
  } catch (error) {
    console.warn('Run analytics submit failed', error);
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

/** Admin-only: read recent telemetry events for the dashboard. */
export async function fetchTelemetry(limit = 1000): Promise<TelemetryRow[]> {
  try {
    const q = query(collection(db, 'telemetry'), orderBy('ts', 'desc'), limitResults(limit));
    const snap = await getDocs(q);
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
    const q = query(collection(db, 'runAnalytics'), orderBy('endedAt', 'desc'), limitResults(limit));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as PrivateRunAnalyticsDoc) }));
  } catch {
    return [];
  }
}

export async function fetchTop(board: string, limit = 10): Promise<ScoreEntry[]> {
  if (!validBoard(board)) return [];
  const sortField = board.endsWith('_fp') ? 'wave' : 'cash';
  try {
    const q = query(collection(db, 'boards', board, 'scores'), orderBy(sortField, 'desc'), limitResults(limit));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
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
      };
    });
  } catch {
    return [];
  }
}

export async function fetchGlobalTop(freeplay: boolean, limit = 20): Promise<RankedScoreEntry[]> {
  const boards = ALL_MAPS.flatMap((map) =>
    DIFFICULTIES.map((diff) => boardId(map.id, diff.id, freeplay)));
  const perBoardLimit = Math.max(3, Math.min(10, limit));
  const rows = await Promise.all(boards.map(async (board) => {
    const meta = boardMeta(board);
    if (!meta) return [];
    const scores = await fetchTop(board, perBoardLimit);
    return scores.map((score) => ({ ...score, ...meta }));
  }));
  const sortField: keyof ScoreEntry = freeplay ? 'wave' : 'cash';
  return rows
    .flat()
    .sort((a, b) => (Number(b[sortField]) - Number(a[sortField])) || b.kills - a.kills || b.ts - a.ts)
    .slice(0, limit);
}
