import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  feedbackTokenHash,
  newFeedbackToken,
  rateLimitOk,
  sanitizeFeedbackReceipts,
  type RateLimitStore,
} from '../../functions/src/securityHelpers.ts';

describe('feedback receipt helpers', () => {
  test('hashes tokens deterministically without exposing the token', () => {
    const token = 'abcdefghijklmnop';
    const hash = feedbackTokenHash(token);
    assert.equal(hash, feedbackTokenHash(token));
    assert.notEqual(hash, token);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  test('generates base64url receipt tokens with enough entropy', () => {
    const token = newFeedbackToken();
    assert.match(token, /^[A-Za-z0-9_-]{16,128}$/);
    assert.notEqual(token, newFeedbackToken());
  });

  test('sanitizes private reply receipts and drops malformed entries', () => {
    const rows = sanitizeFeedbackReceipts([
      { id: 'short', token: 'abcdefghijklmnop' },
      { id: 'feedback_123456', token: 'bad token' },
      { id: 'feedback_123456', token: 'abcdefghijklmnop' },
      { id: 'feedback_123456', token: 'duplicateignored' },
      { id: 'feedback_abcdef', token: 'ABCDEFGHIJKLMNOP' },
    ]);
    assert.deepEqual(rows, [
      { id: 'feedback_123456', token: 'abcdefghijklmnop' },
      { id: 'feedback_abcdef', token: 'ABCDEFGHIJKLMNOP' },
    ]);
  });
});

describe('rateLimitOk', () => {
  test('fails closed when the backing transaction is unavailable', async () => {
    const store: RateLimitStore = {
      doc: (path) => ({ path }),
      runTransaction: async () => {
        throw new Error('firestore unavailable');
      },
    };
    await assert.rejects(
      () => rateLimitOk(store, 'feedback_w_test123'),
      (error: unknown) => typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'unavailable'
        && error instanceof Error
        && error.message === 'rate-limit-unavailable',
    );
  });
});
