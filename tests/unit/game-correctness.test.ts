import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Game } from '../../src/game/engine';
import { ENEMIES } from '../../src/game/enemies';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { normalizeProgress } from '../../src/game/storage';
import type { Enemy, EnemyDef } from '../../src/game/types';
import { validDeletedRunIds } from '../../functions/src/deleteHelpers';

function makeGame(): Game {
  return new Game(ALL_MAPS[0], DIFFICULTIES[0]);
}

function makeEnemy(def: EnemyDef): Enemy {
  return {
    uid: 1,
    def,
    hp: 1000,
    maxHp: 1000,
    pos: { x: 100, y: 100 },
    wp: 1,
    dist: 0,
    slow: 1,
    slowTimer: 0,
    burnDps: 0,
    burnTimer: 0,
    cloaked: false,
    resonance: 0,
    resonanceTimer: 0,
    phase: 0,
    dead: false,
    finished: false,
  };
}

describe('damage immunity rules', () => {
  test('cryo immunity blocks cryo damage unless shred is active', () => {
    const game = makeGame();
    const prism = makeEnemy(ENEMIES.prism);
    assert.equal(game.damageEnemy(prism, 10, 'cryo', false), 0);
    assert.equal(prism.hp, 1000);
    assert.equal(game.damageEnemy(prism, 10, 'cryo', true), 10);
    assert.equal(prism.hp, 990);
  });

  test('explosive immunity and armor both respect shred', () => {
    const game = makeGame();
    const shade = makeEnemy(ENEMIES.shade);
    const aegis = makeEnemy(ENEMIES.aegis);
    assert.equal(game.damageEnemy(shade, 10, 'explosive', false), 0);
    assert.equal(game.damageEnemy(shade, 10, 'explosive', true), 10);
    assert.equal(game.damageEnemy(aegis, 10, 'kinetic', false), 0);
    assert.equal(game.damageEnemy(aegis, 10, 'kinetic', true), 10);
  });
});

describe('storage normalization', () => {
  test('repairs malformed persisted shapes without dropping extension fields', () => {
    const normalized = normalizeProgress({
      archive: null,
      best: { orbital: 4, bad: 'x' },
      blueprints: { orbital: [{ id: 'pulse', x: 1, y: 2, a: 0, b: 0 }, null] },
      history: [{ map: 'orbital', diff: 'easy', wave: 5, kills: 10, cash: 20, won: true, freeplay: false, date: 1 }],
      sessionDays: { '2026-06-27': 2, bad: 'x' },
      clearedMaps: [1, 'orbital'],
      fpRuns: 3,
    });

    assert.deepEqual(normalized.archive, []);
    assert.deepEqual(normalized.best, { orbital: 4 });
    assert.equal(normalized.blueprints.orbital.length, 1);
    assert.equal(normalized.history.length, 1);
    assert.deepEqual(normalized.sessionDays, { '2026-06-27': 2 });
    assert.deepEqual(normalized.clearedMaps, ['orbital']);
    assert.equal((normalized as unknown as { fpRuns?: number }).fpRuns, 3);
  });
});

describe('server deletion helpers', () => {
  test('keeps unique valid run ids from leaderboard score rows', () => {
    assert.deepEqual(validDeletedRunIds(['r_abcdefgh', 'bad', 'r_abcdefgh', null, 'r_ijklmnop']), ['r_abcdefgh', 'r_ijklmnop']);
  });
});
