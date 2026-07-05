/**
 * Global-top aggregation. The client used to build its "global leaderboard"
 * view by fanning out every map/protocol board (now 12 sectors x 4 protocols,
 * plus freeplay variants) for hundreds of reads
 * per menu view — a free-tier read-quota sink. Since submitScore /
 * submitDailyScore are the ONLY board writers, they can maintain one
 * aggregates/globalTop doc instead, and the client reads a single doc.
 */

export interface GlobalTopRow {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid: string;
  runId: string;
  board: string;
  checkpoint?: boolean;
}

export const GLOBAL_TOP_CAP = 20;

/**
 * Merge a newly accepted score row into a top list. Pure so it can be unit
 * tested: sorts by the mode's ranking field (campaign=cash, freeplay=wave),
 * tie-breaking on kills then recency, keeps one row per (uid, board, runId)
 * — a resubmission/checkpoint upgrade replaces its older self — and caps the
 * list length.
 */
export function mergeGlobalTopRows(rows: GlobalTopRow[], entry: GlobalTopRow, cap = GLOBAL_TOP_CAP): GlobalTopRow[] {
  const sortField: 'cash' | 'wave' = entry.freeplay ? 'wave' : 'cash';
  const keyOf = (r: GlobalTopRow) => `${r.uid}|${r.board}|${r.runId}`;
  const kept = rows.filter((r) => keyOf(r) !== keyOf(entry));
  kept.push(entry);
  kept.sort((a, b) => (b[sortField] - a[sortField]) || (b.kills - a.kills) || (b.ts - a.ts));
  return kept.slice(0, cap);
}
