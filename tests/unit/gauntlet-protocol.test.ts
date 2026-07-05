import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/game/engine';
import {
  GAUNTLET_PROTOCOL_START_CORES,
  gauntletProtocolDifficulty,
  gauntletProtocolDraftOffer,
  gauntletProtocolMap,
  gauntletProtocolRouteForWeek,
  gauntletProtocolWave,
  gauntletProtocolWaveCount,
  nextGauntletCredits,
} from '../../src/game/gauntletProtocol';

describe('gauntlet protocol', () => {
  test('weekly route is deterministic and has three distinct shipped sectors', () => {
    const a = gauntletProtocolRouteForWeek('weekly-2026-W27');
    const b = gauntletProtocolRouteForWeek('weekly-2026-W27');
    assert.deepEqual(a, b);
    assert.equal(new Set(a.route).size, 3);
  });

  test('shortened wave tables have the approved leg counts', () => {
    assert.equal(gauntletProtocolWaveCount(1), 20);
    assert.equal(gauntletProtocolWaveCount(2), 25);
    assert.equal(gauntletProtocolWaveCount(3), 30);
    for (const leg of [1, 2, 3] as const) {
      for (let wave = 1; wave <= gauntletProtocolWaveCount(leg); wave++) {
        const groups = gauntletProtocolWave(leg, wave);
        assert.ok(groups.length > 0);
        assert.ok(groups.every((group) => group.count > 0 && group.gap > 0));
      }
    }
  });

  test('bank math carries all cores and floors sixty percent credits', () => {
    assert.equal(GAUNTLET_PROTOCOL_START_CORES, 150);
    assert.equal(nextGauntletCredits(999), 599);
    assert.equal(nextGauntletCredits(1000), 600);
  });

  test('draft offers are seeded and exclude owned relics', () => {
    const first = gauntletProtocolDraftOffer(12345, 2, ['salvageTax']).map((r) => r.id);
    const second = gauntletProtocolDraftOffer(12345, 2, ['salvageTax']).map((r) => r.id);
    assert.deepEqual(first, second);
    assert.equal(first.includes('salvageTax'), false);
    assert.equal(first.length, 3);
  });

  test('leg metadata is recorded into replay setup and summary', () => {
    const route = gauntletProtocolRouteForWeek('weekly-2026-W27');
    const map = gauntletProtocolMap(route, 1);
    const diff = gauntletProtocolDifficulty(1);
    const game = new Game(map, diff, { seed: 123, lifetimeKills: 0 });
    game.startGauntletProtocolLeg({
      week: route.week,
      gauntletRunId: 'gp_test_12345678',
      leg: 1,
      route: route.route,
      startingCredits: 900,
      startingCores: 150,
      relicIds: [],
    });
    const bundle = game.buildRunUploadBundle('TEST', 'unit');
    assert.equal(bundle.run.summary.gauntlet, route.week);
    assert.equal(bundle.run.summary.gauntletRunId, 'gp_test_12345678');
    assert.equal(bundle.run.summary.gauntletLeg, 1);
    assert.equal(bundle.run.setup.gauntletProtocol?.startingCores, 150);
  });
});
