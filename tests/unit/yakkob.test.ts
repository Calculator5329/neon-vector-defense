import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dailyAllowsTower, dailyTowerIds } from '../../src/game/dailyChallenge';
import { THE_YAKKOB, YAKKOB_TOWER_IDS, isYakkob, isYakkobSquishedTower } from '../../src/game/yakkob';
import { TOWER_MAP, TOWERS } from '../../src/game/towers';

describe('THE YAKKOB special edition', () => {
  test('is flagged special and locked to exactly Prism Array + Watchfire Beacon', () => {
    assert.equal(THE_YAKKOB.special, 'yakkob');
    assert.deepEqual([...YAKKOB_TOWER_IDS], ['prismarr', 'watchfire']);
    assert.deepEqual(THE_YAKKOB.arsenal.towerIds, ['prismarr', 'watchfire']);
    // both referenced towers actually exist in the roster
    assert.ok(TOWER_MAP.prismarr && TOWER_MAP.watchfire);
  });

  test('the buildable pool is ONLY those two towers — no pulse, no anything else', () => {
    const pool = dailyTowerIds(THE_YAKKOB);
    assert.ok(pool);
    assert.deepEqual([...pool!].sort(), ['prismarr', 'watchfire']);
    // guard the "pulse gets auto-injected" path: pulse must be disallowed so the engine
    // tower set can't sneak it in
    assert.equal(dailyAllowsTower(THE_YAKKOB, TOWER_MAP.pulse), false);
    for (const def of TOWERS) {
      const allowed = dailyAllowsTower(THE_YAKKOB, def);
      assert.equal(allowed, def.id === 'prismarr' || def.id === 'watchfire',
        `${def.id} allowance should match yakkob pool`);
    }
  });

  test('costs are discounted so the opening is playable', () => {
    // both premium beams at 40% requisition; without this the whole arsenal is unaffordable
    assert.equal(THE_YAKKOB.arsenal.costMultiplier, 0.4);
    assert.ok(TOWER_MAP.prismarr.cost * THE_YAKKOB.arsenal.costMultiplier! < 700, 'a prism is affordable at normal starting cash');
  });

  test('helpers identify the challenge and its squished towers', () => {
    assert.equal(isYakkob(THE_YAKKOB), true);
    assert.equal(isYakkob({ special: undefined }), false);
    assert.equal(isYakkob(null), false);
    assert.equal(isYakkobSquishedTower('prismarr'), true);
    assert.equal(isYakkobSquishedTower('watchfire'), true);
    assert.equal(isYakkobSquishedTower('pulse'), false);
  });

  test('the id is not a date-keyed board, so it never reaches the online daily leaderboards', () => {
    // client + server both accept only /^daily-YYYY-MM-DD$/ — a fixed word keeps it local-ranked
    assert.equal(/^daily-\d{4}-\d{2}-\d{2}$/.test(THE_YAKKOB.id), false);
    assert.equal(THE_YAKKOB.id, 'yakkob');
  });
});
