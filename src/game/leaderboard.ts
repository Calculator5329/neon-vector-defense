// Global leaderboards, feedback, and telemetry on Firestore.
// Firebase web config is public by design; access control lives in firestore.rules.

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitResults,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from './firebaseClient';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { progress } from './storage';

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
}

/** board id for a mode: mapId_diffId, with _fp for freeplay runs */
export function boardId(mapId: string, diffId: string, freeplay: boolean): string {
  return `${mapId}_${diffId}${freeplay ? '_fp' : ''}`;
}

function validBoard(board: string): boolean {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  return !!match?.groups && VALID_MAPS.has(match.groups.map) && VALID_DIFFS.has(match.groups.diff);
}

export async function submitScore(board: string, entry: ScoreEntry): Promise<boolean> {
  if (!validBoard(board)) return false;
  try {
    await addDoc(collection(db, 'boards', board, 'scores'), {
      name: entry.name.slice(0, 20),
      cash: Math.max(0, Math.floor(entry.cash)),
      kills: Math.max(0, Math.floor(entry.kills)),
      wave: Math.max(0, Math.floor(entry.wave)),
      freeplay: entry.freeplay,
      ts: Math.floor(entry.ts),
      uid: (entry.uid ?? progress.uid).slice(0, 40),
    });
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
        return await getDoc(doc(db, 'feedback', id));
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

export interface TelemetryRow extends TelemetryEvent {
  uid: string;
  ts: number;
}

type TelemetryData = TelemetryRow;

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
      };
    });
  } catch {
    return [];
  }
}
