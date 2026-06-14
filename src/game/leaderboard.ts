// Global leaderboards on Firestore via REST — no SDK, ~zero bundle cost.
// Security lives in firestore.rules (public read, validated append-only).
// The API key is a Firebase *web* key: public by design.

const PROJECT = 'neon-vector-defense-7';
const API_KEY = 'AIzaSyAxKfk-rZAFLS7OeqCqIFEzNYKlv3tdrhs';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export interface ScoreEntry {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid?: string;
}

/** board id for a mode: mapId:diffId, with :fp for freeplay runs */
export function boardId(mapId: string, diffId: string, freeplay: boolean): string {
  return `${mapId}_${diffId}${freeplay ? '_fp' : ''}`;
}

export async function submitScore(board: string, entry: ScoreEntry): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/boards/${board}/scores?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: { stringValue: entry.name.slice(0, 20) },
          cash: { integerValue: String(Math.floor(entry.cash)) },
          kills: { integerValue: String(entry.kills) },
          wave: { integerValue: String(entry.wave) },
          freeplay: { booleanValue: entry.freeplay },
          ts: { integerValue: String(entry.ts) },
          uid: { stringValue: (entry.uid ?? '').slice(0, 40) },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** player feedback → feedback collection (write-only). ctx = where in the app. */
export async function submitFeedback(uid: string, text: string, ctx: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/feedback?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: uid.slice(0, 40) },
          text: { stringValue: text.slice(0, 1000) },
          ts: { integerValue: String(Date.now()) },
          ctx: { stringValue: ctx.slice(0, 200) },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface TelemetryEvent {
  uid: string;
  kind: string;
  map: string;
  diff: string;
  wave: number;
  kills: number;
  cash: number;
  won: boolean;
  freeplay: boolean;
  durationS: number;
  /** comma-separated tower def ids fielded this run (for popularity analysis) */
  towers?: string;
}

/** anonymous gameplay telemetry → telemetry collection (write-only, fire-and-forget) */
export function logTelemetry(e: TelemetryEvent): void {
  try {
    void fetch(`${BASE}/telemetry?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: e.uid.slice(0, 40) },
          ts: { integerValue: String(Date.now()) },
          kind: { stringValue: e.kind.slice(0, 30) },
          map: { stringValue: e.map.slice(0, 30) },
          diff: { stringValue: e.diff.slice(0, 30) },
          wave: { integerValue: String(e.wave) },
          kills: { integerValue: String(e.kills) },
          cash: { integerValue: String(Math.floor(e.cash)) },
          won: { booleanValue: e.won },
          freeplay: { booleanValue: e.freeplay },
          durationS: { integerValue: String(Math.floor(e.durationS)) },
          towers: { stringValue: (e.towers ?? '').slice(0, 200) },
        },
      }),
    }).catch(() => {});
  } catch { /* fire-and-forget */ }
}

export interface TelemetryRow extends TelemetryEvent {
  ts: number;
}

/** Admin-only: read recent telemetry events for the dashboard.
 *  Requires the telemetry collection to allow read (see firestore.rules). */
export async function fetchTelemetry(limit = 1000): Promise<TelemetryRow[]> {
  try {
    const res = await fetch(`${BASE}:runQuery?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'telemetry' }],
          orderBy: [{ field: { fieldPath: 'ts' }, direction: 'DESCENDING' }],
          limit,
        },
      }),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows
      .filter((r: { document?: unknown }) => r.document)
      .map((r: { document: { fields: Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean }> } }) => {
        const f = r.document.fields;
        return {
          uid: f.uid?.stringValue ?? '',
          ts: Number(f.ts?.integerValue ?? 0),
          kind: f.kind?.stringValue ?? '',
          map: f.map?.stringValue ?? '',
          diff: f.diff?.stringValue ?? '',
          wave: Number(f.wave?.integerValue ?? 0),
          kills: Number(f.kills?.integerValue ?? 0),
          cash: Number(f.cash?.integerValue ?? 0),
          won: f.won?.booleanValue ?? false,
          freeplay: f.freeplay?.booleanValue ?? false,
          durationS: Number(f.durationS?.integerValue ?? 0),
          towers: f.towers?.stringValue ?? '',
        } as TelemetryRow;
      });
  } catch {
    return [];
  }
}

export async function fetchTop(board: string, limit = 10): Promise<ScoreEntry[]> {
  // endless freeplay boards rank by wave reached (the meaningful metric);
  // campaign boards rank by cash earned.
  const sortField = board.endsWith('_fp') ? 'wave' : 'cash';
  try {
    const res = await fetch(`${BASE}/boards/${board}:runQuery?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'scores' }],
          orderBy: [{ field: { fieldPath: sortField }, direction: 'DESCENDING' }],
          limit,
        },
      }),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows
      .filter((r: { document?: unknown }) => r.document)
      .map((r: { document: { fields: Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean }> } }) => {
        const f = r.document.fields;
        return {
          name: f.name?.stringValue ?? '???',
          cash: Number(f.cash?.integerValue ?? 0),
          kills: Number(f.kills?.integerValue ?? 0),
          wave: Number(f.wave?.integerValue ?? 0),
          freeplay: f.freeplay?.booleanValue ?? false,
          ts: Number(f.ts?.integerValue ?? 0),
          uid: f.uid?.stringValue ?? '',
        };
      });
  } catch {
    return [];
  }
}
