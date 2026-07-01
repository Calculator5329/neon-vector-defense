const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;

export function validDeletedRunIds(values: unknown[]): string[] {
  return [...new Set(values.map((v) => String(v ?? '')).filter((v) => RUN_ID_RE.test(v)))];
}

/**
 * Split candidate runIds into publicly-deletable vs skipped.
 *
 * Public runs/{runId} docs are deleted ONLY when a corroborating signal ties
 * the run to the uid being deleted: a server-written board row or a
 * uid-matching runAnalytics/runCheckpoints doc. replayOwners entries created
 * since the auth migration are uid-bound by rules, but LEGACY rows were
 * client-claimed and forgeable — an owner-index row alone must not be enough
 * to destroy another player's public replay.
 */
export function partitionRunDeletions(
  ownerIndexRunIds: Iterable<string>,
  corroboratedRunIds: Iterable<string>,
): { deletable: string[]; skipped: string[] } {
  const corroborated = new Set(validDeletedRunIds([...corroboratedRunIds]));
  const skipped = validDeletedRunIds([...ownerIndexRunIds]).filter((id) => !corroborated.has(id));
  return { deletable: [...corroborated], skipped };
}
