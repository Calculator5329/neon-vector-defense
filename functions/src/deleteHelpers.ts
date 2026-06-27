const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;

export function validDeletedRunIds(values: unknown[]): string[] {
  return [...new Set(values.map((v) => String(v ?? '')).filter((v) => RUN_ID_RE.test(v)))];
}
