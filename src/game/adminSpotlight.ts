// Admin-only writes for the pinned "Replay of the Day" (config/spotlight). Imported ONLY by the
// lazy-loaded AdminDashboard so no admin-write code lands on the player path. Public reads live in
// replaySpotlight.ts. Rules gate WHO can write (isAdmin) + the doc shape.
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebaseClient';
import { fetchRunReplay } from './leaderboard';
import type { ReplaySpotlight } from './replaySpotlight';

export interface PinnedSpotlight extends ReplaySpotlight {
  pinnedAt?: number;
  pinnedBy?: string;
}

const ref = () => doc(db, 'config', 'spotlight');

export async function fetchPinnedSpotlightAdmin(): Promise<PinnedSpotlight | null> {
  const snap = await getDoc(ref());
  return snap.exists() ? (snap.data() as PinnedSpotlight) : null;
}

export async function pinReplayOfTheDay(s: ReplaySpotlight, email: string | null, now = Date.now()): Promise<void> {
  await setDoc(ref(), {
    runId: s.runId,
    callsign: (s.callsign || 'WARDEN').slice(0, 40),
    wave: Math.max(0, Math.floor(s.wave) || 0),
    mapName: (s.mapName || '').slice(0, 80),
    diffName: (s.diffName || '').slice(0, 80),
    freeplay: !!s.freeplay,
    pinnedAt: now,
    pinnedBy: (email || '').slice(0, 120),
  });
}

export async function unpinReplayOfTheDay(): Promise<void> {
  await deleteDoc(ref());
}

/** Resolve a pasted runId into a full spotlight by reading its public run doc. */
export async function spotlightFromRunId(runId: string): Promise<ReplaySpotlight | null> {
  const run = await fetchRunReplay(runId);
  if (!run) return null;
  const s = run.summary;
  return {
    runId: run.runId,
    callsign: s.callsign || 'WARDEN',
    wave: s.wave,
    mapName: s.mapName,
    diffName: s.diffName,
    freeplay: s.freeplay,
  };
}
