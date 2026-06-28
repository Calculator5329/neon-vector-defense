import { createHash, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

const UID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const FEEDBACK_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const FEEDBACK_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IN_WINDOW = 8;

export interface FeedbackReceiptInput {
  id: string;
  token: string;
}

export interface RateLimitSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface RateLimitTransaction {
  get(ref: unknown): Promise<RateLimitSnapshot>;
  set(ref: unknown, data: Record<string, unknown>): unknown;
  update(ref: unknown, data: Record<string, unknown>): unknown;
}

export interface RateLimitStore {
  doc(path: string): unknown;
  runTransaction<T>(fn: (tx: RateLimitTransaction) => Promise<T>): Promise<T>;
}

function n(v: unknown, fallback = 0): number {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export function validUid(uid: string): boolean {
  return UID_RE.test(uid);
}

export function newFeedbackToken(): string {
  return randomBytes(16).toString('base64url');
}

export function feedbackTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function replayTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sanitizeFeedbackReceipts(raw: unknown, max = 20): FeedbackReceiptInput[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: FeedbackReceiptInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Record<string, unknown>;
    const id = String(data.id ?? '');
    const token = String(data.token ?? '');
    if (!FEEDBACK_ID_RE.test(id) || !FEEDBACK_TOKEN_RE.test(token) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, token });
  }
  return out.slice(-max);
}

export async function rateLimitOk(store: RateLimitStore, key: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_:-]{6,80}$/.test(key)) return false;
  const ref = store.doc(`rateLimits/${key}`);
  try {
    return await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const data = snap.exists ? snap.data() : null;
      const windowStart = n(data?.windowStart, 0);
      const count = n(data?.count, 0);
      // expiresAt drives a Firestore TTL policy so these counters don't accumulate forever.
      const expiresAt = new Date(now + 24 * 60 * 60 * 1000);
      if (!data || now - windowStart >= RATE_WINDOW_MS) {
        tx.set(ref, { windowStart: now, count: 1, updatedAt: now, expiresAt });
        return true;
      }
      if (count >= RATE_MAX_IN_WINDOW) return false;
      tx.update(ref, { count: count + 1, updatedAt: now, expiresAt });
      return true;
    });
  } catch {
    throw new HttpsError('unavailable', 'rate-limit-unavailable');
  }
}
