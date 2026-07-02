import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeRunAnalyticsDoc } from '../../src/game/analyticsSchema';

describe('analytics schema defaults', () => {
  test('normalizes sparse and mistyped private analytics rows to the v2 shape', () => {
    const row = normalizeRunAnalyticsDoc('r_normalized1', {
      schemaVersion: '2',
      uid: 123,
      createdAt: '4',
      endedAt: '9',
      build: 'test',
      summary: { freeplay: true, wave: 7 },
      menu: { deployAttempts: '4', selectedMap: 'orbital', mapSelections: { orbital: 2 }, lockedMapClicks: 'bad' },
      controls: { keyboardInputs: '5', pauseToggles: '3' },
      combat: { peakEnemies: '11', leaksByEnemy: { runner: 2 }, abilityCasts: 'bad' },
      placement: { firstTowerId: 'laser', buildOrder: ['laser'], beaconZonePlacements: '2' },
      assistance: { feedbackSuccesses: '1', widgetPauseS: '6.5' },
      freeplay: { contractId: 'endless', relicOffers: '2' },
      towerInterest: { shopOpens: '1', shopSelections: { laser: 1 } },
      progression: { sessions: '4', unlocksEarned: ['laser'] },
      attention: { activeS: '12', hiddenS: 'bad' },
      performance: { devicePixelRatio: '2', displayStandalone: true, userAgent: 123, qualityDowngrades: '1' },
    });

    assert.equal(row.schemaVersion, 2);
    assert.equal(row.runId, 'r_normalized1');
    assert.equal(row.uid, '');
    assert.equal(row.endedAt, 9);
    assert.equal(row.summary.freeplay, true);
    assert.equal(row.menu.deployAttempts, 4);
    assert.deepEqual(row.menu.lockedMapClicks, {});
    assert.equal(row.controls.pauseToggles, 3);
    assert.deepEqual(row.combat.abilityCasts, {});
    assert.equal(row.placement.beaconZonePlacements, 2);
    assert.equal(row.assistance.widgetPauseS, 6.5);
    assert.equal(row.assistance.adBreakRequests, 0);
    assert.equal(row.assistance.adBreakCompleted, 0);
    assert.equal(row.assistance.adBreakSkipped, 0);
    assert.equal(row.freeplay.entered, true);
    assert.equal(row.freeplay.relicOffers, 2);
    assert.equal(row.progression.sessions, 4);
    assert.equal(row.attention.hiddenS, 0);
    assert.equal(row.performance.devicePixelRatio, 2);
    assert.equal(row.performance.userAgent, '');
  });
});
