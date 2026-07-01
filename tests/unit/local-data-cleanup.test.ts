import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { pruneStaleLocalData } from '../../src/game/localDataCleanup';

function installLocalStorage(seed: Record<string, string>): void {
  const store = new Map(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('local data cleanup', () => {
  test('prunes stale replay tokens and feedback receipts without blocking fresh local data', () => {
    const now = Date.UTC(2026, 6, 1);
    const old = now - 61 * 24 * 60 * 60 * 1000;
    const freshRunId = `r_${now.toString(36)}_freshrun`;
    const staleRunId = `r_${old.toString(36)}_stalerun`;
    installLocalStorage({
      'nvd-replay-tokens-v1': JSON.stringify({
        [freshRunId]: 'a'.repeat(16),
        [staleRunId]: 'b'.repeat(16),
      }),
      'nvd-feedback-receipts-v2': JSON.stringify([
        { id: 'fresh', token: 'c'.repeat(16), ts: now - 1000 },
        { id: 'stale', token: 'd'.repeat(16), ts: old },
      ]),
    });

    pruneStaleLocalData(now);

    assert.deepEqual(JSON.parse(localStorage.getItem('nvd-replay-tokens-v1') ?? '{}'), {
      [freshRunId]: 'a'.repeat(16),
    });
    assert.deepEqual(JSON.parse(localStorage.getItem('nvd-feedback-receipts-v2') ?? '[]'), [
      { id: 'fresh', token: 'c'.repeat(16), ts: now - 1000 },
    ]);
  });
});
