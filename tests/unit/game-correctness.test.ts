import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Game } from '../../src/game/engine';
import { ENEMIES } from '../../src/game/enemies';
import { buildGhostCurves, ghostCurvesForMap, type WaveCurveLite } from '../../src/game/ghostCurve';
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

// Mirrors the soft-resistance constants in engine.ts. Resistances reduce
// damage instead of zeroing it; `shred` strips them entirely.
const RESIST_ARMORED = 0.35;
const RESIST_BLAST = 0.25;
const RESIST_CRYO = 0.25;
const RESIST_ENERGY = 0.5; // prism / umbra resist energy

describe('damage resistance rules', () => {
  test('cryo-resistant hull takes reduced cryo damage unless shred is active', () => {
    const game = makeGame();
    const prism = makeEnemy(ENEMIES.prism);
    assert.equal(game.damageEnemy(prism, 10, 'cryo', false), 10 * RESIST_CRYO);
    assert.equal(prism.hp, 1000 - 10 * RESIST_CRYO);
    assert.equal(game.damageEnemy(prism, 10, 'cryo', true), 10);
    assert.equal(prism.hp, 1000 - 10 * RESIST_CRYO - 10);
  });

  test('explosive-resistant and armored hulls take reduced damage, full under shred', () => {
    const game = makeGame();
    const shade = makeEnemy(ENEMIES.shade);
    const aegis = makeEnemy(ENEMIES.aegis);
    assert.equal(game.damageEnemy(shade, 10, 'explosive', false), 10 * RESIST_BLAST);
    assert.equal(game.damageEnemy(shade, 10, 'explosive', true), 10);
    assert.equal(game.damageEnemy(aegis, 10, 'kinetic', false), 10 * RESIST_ARMORED);
    assert.equal(game.damageEnemy(aegis, 10, 'kinetic', true), 10);
  });

  test('energy resistance from resist map reduces energy damage and is stripped by shred', () => {
    const game = makeGame();
    const prism = makeEnemy(ENEMIES.prism);
    assert.equal(prism.def.resist?.energy, RESIST_ENERGY);
    assert.equal(game.damageEnemy(prism, 10, 'energy', false), 10 * RESIST_ENERGY);
    assert.equal(prism.hp, 1000 - 10 * RESIST_ENERGY);
    assert.equal(game.damageEnemy(prism, 10, 'energy', true), 10);
    // non-resisted type on the same hull takes full damage
    const prism2 = makeEnemy(ENEMIES.prism);
    assert.equal(game.damageEnemy(prism2, 10, 'kinetic', false), 10);
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

describe('freeplay correctness guards', () => {
  test('risk packets cannot be accepted unless they were actually offered', () => {
    const game = makeGame();
    game.phase = 'victory';
    game.wave = game.diff.waves;
    game.enterFreeplay('standard');

    assert.equal(game.freeplay, true);
    assert.equal(game.freeplayState.riskOffer, null);
    assert.equal(game.acceptRisk('bounty'), false);
    assert.equal(game.freeplayState.riskAccepted, null);
    assert.deepEqual(game.freeplayState.nextMutators, []);
  });

  test('checkpoint banking only succeeds once per new freeplay build wave', () => {
    const game = makeGame();
    game.phase = 'victory';
    game.wave = game.diff.waves;
    game.enterFreeplay('standard');

    assert.equal(game.canBankFreeplay(), false);
    assert.equal(game.markFreeplayCheckpoint(), false);
    assert.equal(game.freeplayState.lastCheckpointWave, game.diff.waves);

    game.wave = game.diff.waves + 5;
    assert.equal(game.canBankFreeplay(), true);
    assert.equal(game.markFreeplayCheckpoint(), true);
    assert.equal(game.freeplayState.lastCheckpointWave, game.diff.waves + 5);
    assert.equal(game.canBankFreeplay(), false);
    assert.equal(game.markFreeplayCheckpoint(), false);
  });
});

describe('server deletion helpers', () => {
  test('keeps unique valid run ids from leaderboard score rows', () => {
    assert.deepEqual(validDeletedRunIds(['r_abcdefgh', 'bad', 'r_abcdefgh', null, 'r_ijklmnop']), ['r_abcdefgh', 'r_ijklmnop']);
  });
});

describe('bot rival profile helpers', () => {
  test('returns current-sector bot profiles in difficulty order', () => {
    const raw: WaveCurveLite[] = [
      { map: 'relay', diff: 'hard', skill: 'expert', winRate: 0.2, avgFinalWave: 42, points: [{ wave: 1, coreFraction: 1 }] },
      { map: 'other', diff: 'easy', skill: 'rookie', winRate: 1, avgFinalWave: 50, points: [{ wave: 1, coreFraction: 1 }] },
      { map: 'relay', diff: 'easy', skill: 'rookie', winRate: 0.8, avgFinalWave: 50, points: [{ wave: 1, coreFraction: 1 }] },
      { map: 'relay', diff: 'normal', skill: 'standard', winRate: 0.5, avgFinalWave: 47, points: [{ wave: 1, coreFraction: 0.5 }] },
    ];
    const profiles = ghostCurvesForMap(buildGhostCurves(raw), 'relay');
    assert.deepEqual(profiles.map((curve) => `${curve.diff}:${curve.skill}`), ['easy:rookie', 'normal:standard', 'hard:expert']);
    assert.equal(profiles[1].startingLives, DIFFICULTIES.find((diff) => diff.id === 'normal')?.lives);
  });
});
