import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DIFFICULTIES } from '../../src/game/maps';
import {
  LATE_SCALE_CURVE,
  LATE_SCALE_START_WAVE,
  lateScaleMultiplier,
} from '../../src/game/difficulty';

function assertClose(a: number, b: number) {
  assert.ok(Math.abs(a - b) <= 1e-9, `expected ${a} to equal ${b}`);
}

describe('late-game scaling curve', () => {
  test('late growth starts at wave 35 across all difficulty tiers', () => {
    for (const diff of DIFFICULTIES) {
      assertClose(lateScaleMultiplier(diff, 34), 1);
      assertClose(lateScaleMultiplier(diff, LATE_SCALE_START_WAVE), 1);
    }
  });

  test('late-game multipliers are pinned per tier at wave 40', () => {
    const pinned = [
      { id: 'easy', expected: 2.05 },
      { id: 'normal', expected: 2.20 },
      { id: 'hard', expected: 2.425 },
      { id: 'extinction', expected: 2.625 },
    ];
    for (const { id, expected } of pinned) {
      const diff = DIFFICULTIES.find((candidate) => candidate.id === id);
      if (!diff) throw new Error(`missing difficulty ${id}`);
      assertClose(lateScaleMultiplier(diff, 40), expected);
    }
  });

  test('late-game multipliers remain pinned across tiers in wave 50', () => {
    const pinned = [
      { id: 'easy', expected: 4.15 },
      { id: 'normal', expected: 4.6 },
      { id: 'hard', expected: 5.275 },
      { id: 'extinction', expected: 5.875 },
    ];
    for (const { id, expected } of pinned) {
      const diff = DIFFICULTIES.find((candidate) => candidate.id === id);
      if (!diff) throw new Error(`missing difficulty ${id}`);
      assertClose(lateScaleMultiplier(diff, 50), expected);
    }
  });

  test('late-game multiplier curve is data-driven via difficulty curve config', () => {
    for (const diff of DIFFICULTIES) {
      const curve = LATE_SCALE_CURVE[diff.id];
      if (!curve) {
        throw new Error(`missing late scale curve for ${diff.id}`);
      }
      assert.ok(curve.startWave === LATE_SCALE_START_WAVE);
      assertClose(curve.perWave, diff.lateScale);
    }
  });
});
