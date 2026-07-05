import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  currentWeeklyId,
  sanitizeWeeklyGauntletDoc,
  sanitizeWeeklyOverrideDoc,
  weeklyChallengeForId,
  weeklyChallengeSignature,
} from '../../src/game/weeklyChallenge';

describe('weekly challenge', () => {
  test('uses UTC ISO week ids and stacks three twists', () => {
    assert.equal(currentWeeklyId(new Date('2026-01-01T12:00:00Z')), 'weekly-2026-W01');
    const challenge = weeklyChallengeForId('weekly-2026-W27');
    assert.ok(challenge);
    assert.equal(challenge.id, 'weekly-2026-W27');
    assert.equal(challenge.twists.length, 3);
    assert.equal(new Set(challenge.twistIds).size, 3);
    assert.equal(challenge.rules.length >= 6, true);
  });

  test('applies a weekly override without changing the deterministic shell', () => {
    const base = weeklyChallengeForId('weekly-2026-W27')!;
    const overridden = weeklyChallengeForId('weekly-2026-W27', {
      week: 'weekly-2026-W27',
      arsenalId: 'noSupport',
      twistIds: ['fogProtocol', 'rushHour', 'glassCannon'],
      boonId: 'doublePickups',
    })!;
    assert.equal(overridden.mapId, base.mapId);
    assert.equal(overridden.diffId, base.diffId);
    assert.equal(overridden.arsenal.id, 'noSupport');
    assert.deepEqual(overridden.twistIds, ['fogProtocol', 'rushHour', 'glassCannon']);
    assert.equal(overridden.boon.id, 'doublePickups');
    assert.notEqual(weeklyChallengeSignature(base), weeklyChallengeSignature(overridden));
  });

  test('sanitizes weekly override and gauntlet docs', () => {
    assert.deepEqual(sanitizeWeeklyOverrideDoc({
      week: 'weekly-2026-W27',
      arsenalId: 'budgetBuild',
      twistIds: ['fogProtocol', 'fogProtocol', 'rushHour'],
      boonId: 'abilityRecharge',
      note: 'x'.repeat(300),
    }), {
      week: 'weekly-2026-W27',
      arsenalId: 'budgetBuild',
      boonId: 'abilityRecharge',
      note: 'x'.repeat(240),
    });
    assert.equal(sanitizeWeeklyOverrideDoc({ week: '2026-W27' }), null);
    assert.deepEqual(sanitizeWeeklyGauntletDoc({
      week: 'weekly-2026-W27',
      runId: 'r_weeklychampion0001',
      callsign: 'ETHAN',
      map: 'orbital',
      diff: 'normal',
      seed: 42,
      wave: 60,
      kills: 6000,
    })?.seed, 42);
  });
});
