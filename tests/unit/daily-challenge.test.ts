import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dailyArsenalCatalog,
  dailyBoonCatalog,
  dailyChallengeForDate,
  dailyChallengeSignature,
  dailyTwistCatalog,
  sanitizeDailyOverrideDoc,
} from '../../src/game/dailyChallenge';

describe('daily challenge overrides', () => {
  test('applies an override to the same deterministic daily shell', () => {
    const base = dailyChallengeForDate('2026-07-04');
    const overridden = dailyChallengeForDate('2026-07-04', {
      date: '2026-07-04',
      arsenalId: 'noSupport',
      twistId: 'rushHour',
      boonId: 'doublePickups',
      note: 'launch weekend',
    });

    assert.equal(overridden.id, 'daily-2026-07-04');
    assert.equal(overridden.mapId, base.mapId);
    assert.equal(overridden.diffId, base.diffId);
    assert.equal(overridden.arsenal.id, 'noSupport');
    assert.equal(overridden.twist.id, 'rushHour');
    assert.equal(overridden.boon.id, 'doublePickups');
    assert.notEqual(dailyChallengeSignature(base), dailyChallengeSignature(overridden));
  });

  test('ignores overrides for a different date', () => {
    const base = dailyChallengeForDate('2026-07-04');
    const ignored = dailyChallengeForDate('2026-07-04', {
      date: '2026-07-05',
      arsenalId: 'noSupport',
      twistId: 'rushHour',
      boonId: 'doublePickups',
    });
    assert.equal(dailyChallengeSignature(ignored), dailyChallengeSignature(base));
  });

  test('sanitizes override documents and rejects malformed IDs', () => {
    const doc = sanitizeDailyOverrideDoc({
      date: '2026-07-04',
      arsenalId: 'budgetBuild',
      twistId: 'retired',
      boonId: 'abilityRecharge',
      note: 'x'.repeat(300),
      extra: true,
    });
    assert.deepEqual(doc, {
      date: '2026-07-04',
      arsenalId: 'budgetBuild',
      boonId: 'abilityRecharge',
      note: 'x'.repeat(240),
    });
    assert.equal(sanitizeDailyOverrideDoc({ date: '07-04-2026', arsenalId: 'noSupport' }), null);
  });

  test('exports concrete modifier catalogs for admin selectors', () => {
    assert.ok(dailyArsenalCatalog('2026-07-04').some((item) => item.id === 'fixedPool' && item.towerIds?.length));
    assert.deepEqual(dailyTwistCatalog().map((item) => item.id), ['fogProtocol', 'rushHour', 'glassCannon', 'thrifty', 'veteranHulls']);
    assert.deepEqual(dailyBoonCatalog().map((item) => item.id), ['salvageCache', 'abilityRecharge', 'doublePickups']);
  });
});
