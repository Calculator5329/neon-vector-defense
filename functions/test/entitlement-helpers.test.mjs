import assert from 'node:assert/strict';
import test from 'node:test';
import { applySalvagePurchase, readEntitlementState } from '../lib/entitlementHelpers.js';

test('uses the server catalog price and deducts atomically-shaped state', () => {
  const result = applySalvagePurchase({ cosmeticIds: [], salvageBalance: 500, salvageSpent: 20 }, 'palette-ember');
  assert.deepEqual(result, {
    ok: true,
    alreadyOwned: false,
    cost: 300,
    state: { cosmeticIds: ['palette-ember'], salvageBalance: 200, salvageSpent: 320 },
  });
});

test('rejects unknown, underfunded, and malformed wallet values', () => {
  assert.deepEqual(applySalvagePurchase({ salvageBalance: 99999 }, 'gameplay-damage'), { ok: false, reason: 'unknown-cosmetic' });
  assert.deepEqual(applySalvagePurchase({ salvageBalance: 299 }, 'palette-ember'), { ok: false, reason: 'insufficient-salvage', cost: 300 });
  assert.equal(readEntitlementState({ salvageBalance: '99999' }).salvageBalance, 0);
});

test('an already-owned grant is idempotent and does not spend twice', () => {
  const state = { cosmeticIds: ['palette-ember'], salvageBalance: 12, salvageSpent: 300 };
  const result = applySalvagePurchase(state, 'palette-ember');
  assert.deepEqual(result, { ok: true, alreadyOwned: true, cost: 300, state });
});
