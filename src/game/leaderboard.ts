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
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchTop(board: string, limit = 10): Promise<ScoreEntry[]> {
  try {
    const res = await fetch(`${BASE}/boards/${board}:runQuery?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'scores' }],
          orderBy: [{ field: { fieldPath: 'cash' }, direction: 'DESCENDING' }],
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
        };
      });
  } catch {
    return [];
  }
}
