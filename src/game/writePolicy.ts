// Write-cost policy for telemetry/analytics at portal scale. Firestore bills per
// operation, and the old per-wave + per-30s checkpoint cadence cost ~60-90 writes
// per run. This module decides, deterministically and cheaply, which runs capture
// full fidelity and which waves are worth a checkpoint — cutting writes ~10x.
//
// - Unsampled runs emit only ONE lightweight `telemetry` doc at run end.
// - Sampled runs additionally emit milestone checkpoints, run analytics, and the
//   verifiable replay. All of it is still consent-gated (see consent.ts).

/** Fraction of runs captured at full fidelity (checkpoints + analytics + replay). */
export const SAMPLE_RATE = 0.1;

/** Raw capture (replays + live checkpoints) is retained this long, then TTL-expired. */
export const RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Deterministic [0,1) hash of a string (FNV-1a → unit float). Stable across a run. */
function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 to unsigned, then scale into [0,1)
  return (h >>> 0) / 4294967296;
}

/** True if this run is selected for full-fidelity capture. Deterministic per (uid,runId). */
export function isSampledRun(uid: string, runId: string): boolean {
  if (SAMPLE_RATE >= 1) return true;
  if (SAMPLE_RATE <= 0) return false;
  return unitHash(`${uid}:${runId}`) < SAMPLE_RATE;
}

/** Waves worth a checkpoint on a sampled run: the opener and every 10th wave.
 *  Terminal/abort/bank checkpoints are handled separately (always, when sampled). */
export function isMilestoneWave(wave: number): boolean {
  return wave === 1 || wave % 10 === 0;
}
