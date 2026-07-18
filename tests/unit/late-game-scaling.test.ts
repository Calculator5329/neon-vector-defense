import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DIFFICULTIES } from '../../src/game/maps';
import { LATE_SCALE_START_WAVE, lateScaleMultiplier } from '../../src/game/difficulty';

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
      { id: 'easy', expected: 1.70 },
      { id: 'normal', expected: 1.75 },
      { id: 'hard', expected: 1.925 },
      { id: 'extinction', expected: 2.025 },
    ];
    for (const { id, expected } of pinned) {
      const diff = DIFFICULTIES.find((candidate) => candidate.id === id);
      if (!diff) throw new Error(`missing difficulty ${id}`);
      assertClose(lateScaleMultiplier(diff, 40), expected);
    }
  });

  test('late-game multipliers remain pinned across tiers in wave 50', () => {
    const pinned = [
      { id: 'easy', expected: 3.1 },
      { id: 'normal', expected: 3.25 },
      { id: 'hard', expected: 3.85 },
      { id: 'extinction', expected: 4.075 },
    ];
    for (const { id, expected } of pinned) {
      const diff = DIFFICULTIES.find((candidate) => candidate.id === id);
      if (!diff) throw new Error(`missing difficulty ${id}`);
      assertClose(lateScaleMultiplier(diff, 50), expected);
    }
  });
});
