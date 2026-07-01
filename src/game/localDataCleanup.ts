const REPLAY_TOKEN_KEY = 'nvd-replay-tokens-v1';
const FEEDBACK_RECEIPTS_KEY = 'nvd-feedback-receipts-v2';
const MAX_LOCAL_RECEIPT_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const RUN_ID_RE = /^r_([a-z0-9]+)_[A-Za-z0-9_-]+$/;
const REPLAY_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function pruneStaleLocalData(now = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  pruneReplayTokens(now);
  pruneFeedbackReceipts(now);
}

function pruneReplayTokens(now: number): void {
  try {
    const raw = localStorage.getItem(REPLAY_TOKEN_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const fresh = Object.entries(parsed)
      .filter(([runId, token]) => typeof token === 'string'
        && REPLAY_TOKEN_RE.test(token)
        && !isExpiredRunId(runId, now));
    localStorage.setItem(REPLAY_TOKEN_KEY, JSON.stringify(Object.fromEntries(fresh)));
  } catch {
    // Stale local cleanup is opportunistic and must never block boot.
  }
}

function pruneFeedbackReceipts(now: number): void {
  try {
    const raw = localStorage.getItem(FEEDBACK_RECEIPTS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const fresh = parsed.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const ts = Number((row as { ts?: unknown }).ts ?? 0);
      return !Number.isFinite(ts) || ts <= 0 || now - ts <= MAX_LOCAL_RECEIPT_AGE_MS;
    }).slice(-20);
    localStorage.setItem(FEEDBACK_RECEIPTS_KEY, JSON.stringify(fresh));
  } catch {
    // Stale local cleanup is opportunistic and must never block boot.
  }
}

function isExpiredRunId(runId: string, now: number): boolean {
  const match = RUN_ID_RE.exec(runId);
  if (!match) return false;
  const createdAt = Number.parseInt(match[1], 36);
  return Number.isFinite(createdAt) && createdAt > 0 && now - createdAt > MAX_LOCAL_RECEIPT_AGE_MS;
}
