import { doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { db } from './firebaseClient';
import { fetchGlobalTop, type RankedScoreEntry } from './leaderboard';

export interface ReplaySpotlight {
  runId: string;
  callsign: string;
  wave: number;
  mapName: string;
  diffName: string;
  freeplay: boolean;
}

// Matches the replay deep-link id shape used by the viewer (?run=<runId>).
const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;

/** An admin-pinned spotlight (config/spotlight), if one is set and well-formed. */
async function fetchPinnedSpotlight(): Promise<ReplaySpotlight | null> {
  try {
    const snap = await getDoc(firestoreDoc(db, 'config', 'spotlight'));
    if (!snap.exists()) return null;
    const d = snap.data() as Partial<ReplaySpotlight>;
    if (!d.runId || !RUN_ID_RE.test(d.runId)) return null;
    return {
      runId: d.runId,
      callsign: typeof d.callsign === 'string' ? d.callsign : 'WARDEN',
      wave: typeof d.wave === 'number' ? d.wave : 0,
      mapName: typeof d.mapName === 'string' ? d.mapName : '',
      diffName: typeof d.diffName === 'string' ? d.diffName : '',
      freeplay: !!d.freeplay,
    };
  } catch {
    return null;
  }
}

// FNV-1a, replicated from the daily-seed hash in freeplay.ts so we don't have to
// import/edit that module. Stable for a given input across runs.
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// How many of the strongest runs to rotate through. The daily pick lands inside
// this pool, so the spotlight only ever features high-wave (impressive) runs.
const TOP_N = 8;

/**
 * Pick a deterministic "Replay of the Day" from the live global leaderboards.
 *
 * Heuristic: pull the top rows from both the campaign and freeplay boards, keep
 * only entries that carry a valid replay runId, sort by wave descending, take the
 * top {@link TOP_N}, then deterministically index into that pool using an FNV-1a
 * hash of the UTC date key. The result rotates once per UTC day but stays stable
 * within a day, and always features one of the strongest available runs.
 *
 * Returns null when no qualifying rows exist (e.g. no replays yet) or on any
 * error — it never throws, so the menu can render it optimistically.
 */
export async function fetchReplayOfTheDay(now = new Date()): Promise<ReplaySpotlight | null> {
  try {
    // An admin pin (set from the dashboard) overrides the automatic daily pick.
    const pinned = await fetchPinnedSpotlight();
    if (pinned) return pinned;

    const [campaign, freeplay] = await Promise.all([
      fetchGlobalTop(false, 20),
      fetchGlobalTop(true, 20),
    ]);
    const merged: RankedScoreEntry[] = [...campaign, ...freeplay];

    const qualifiers = merged.filter((r) => !!r.runId && RUN_ID_RE.test(r.runId));
    if (qualifiers.length === 0) return null;

    const pool = qualifiers
      .slice()
      .sort((a, b) => b.wave - a.wave)
      .slice(0, TOP_N);

    const idx = hash(now.toISOString().slice(0, 10)) % pool.length;
    const pick = pool[idx];

    return {
      runId: pick.runId!,
      callsign: pick.name,
      wave: pick.wave,
      mapName: pick.mapName,
      diffName: pick.diffName,
      freeplay: pick.freeplay,
    };
  } catch {
    return null;
  }
}
