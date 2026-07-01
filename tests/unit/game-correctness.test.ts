import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Bot } from '../../src/game/bot';
import { setBalanceDoc } from '../../src/game/balanceConfig';
import { Game } from '../../src/game/engine';
import { ENEMIES } from '../../src/game/enemies';
import { dailyFreeplaySeed } from '../../src/game/freeplay';
import { sanitizeFirestoreData } from '../../src/game/firestoreSanitize';
import { buildGhostCurves, ghostAtWave, ghostCurvesForMap, type WaveCurveLite } from '../../src/game/ghostCurve';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { normalizeProgress, progress } from '../../src/game/storage';
import { TOWERS } from '../../src/game/towers';
import type { Enemy, EnemyDef } from '../../src/game/types';
import { partitionRunDeletions, validDeletedRunIds } from '../../functions/src/deleteHelpers';
import { isStaleBuild } from '../../src/buildFreshness';

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

afterEach(() => {
  progress.reset();
  setBalanceDoc(null);
});

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
  test('Firestore sanitizer removes nested undefined from replay upload docs', () => {
    const dirty = {
      runId: 'r_test',
      summary: {
        map: 'mobius',
        daily: undefined,
      },
      events: [
        { type: 'run_start', t: 0, optional: undefined },
        undefined,
        { type: 'custom', payload: { kept: true, missing: undefined } },
      ],
      chunks: [
        {
          chunk: 0,
          events: [{ type: 'wave_start', gap: undefined }],
        },
      ],
    };

    const clean = sanitizeFirestoreData(dirty);
    assert.deepEqual(clean, {
      runId: 'r_test',
      summary: { map: 'mobius' },
      events: [
        { type: 'run_start', t: 0 },
        null,
        { type: 'custom', payload: { kept: true } },
      ],
      chunks: [
        {
          chunk: 0,
          events: [{ type: 'wave_start' }],
        },
      ],
    });
  });

  test('public replay bundles never contain undefined Firestore fields', () => {
    const game = makeGame();
    game.credits = 9999;
    for (let y = 90; y <= 630 && game.towers.length === 0; y += 36) {
      for (let x = 90; x <= 1190 && game.towers.length === 0; x += 36) {
        game.placeTower(TOWERS[0], { x, y });
      }
    }

    assert.equal(game.towers.length, 1);
    const bundle = game.buildRunUploadBundle('TEST', 'test-build');
    const findUndefined = (value: unknown, path = '$'): string | null => {
      if (value === undefined) return path;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const found = findUndefined(value[i], `${path}[${i}]`);
          if (found) return found;
        }
      } else if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
          const found = findUndefined(entry, `${path}.${key}`);
          if (found) return found;
        }
      }
      return null;
    };

    assert.equal(findUndefined(bundle), null);
  });

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

  test('daily freeplay rotates the lead contract across seeded dates', () => {
    const leadContracts = new Set<string>();
    for (let day = 1; day <= 14; day++) {
      leadContracts.add(dailyFreeplaySeed(new Date(Date.UTC(2026, 5, day))).contractIds[0]);
    }
    assert.ok(leadContracts.size > 1);
  });
});

type EngineInternals = {
  grid: { rebuild(enemies: Enemy[]): void };
  applyBurn(e: Enemy, dps: number, duration: number, src?: unknown): void;
  updateProjectiles(dt: number): void;
  updateEnemies(dt: number): void;
};

function internals(game: Game): EngineInternals {
  return game as unknown as EngineInternals;
}

function findPlaceable(game: Game): { x: number; y: number } {
  for (let x = 40; x < 1240; x += 20) {
    for (let y = 40; y < 680; y += 20) {
      if (game.canPlace({ x, y })) return { x, y };
    }
  }
  throw new Error('no placeable cell found');
}

function cheapestUnlockedTower() {
  return [...TOWERS].filter((d) => d.unlockAt === 0).sort((a, b) => a.cost - b.cost)[0];
}

describe('engine correctness fixes', () => {
  test('spire-revealed cloaked hulls are hit by non-detector projectiles', () => {
    const game = makeGame();
    const t = game.placeTower(cheapestUnlockedTower(), findPlaceable(game));
    assert.ok(t);
    const shoot = (revealed: boolean) => {
      const e = makeEnemy(ENEMIES.aegis);
      e.uid = revealed ? 901 : 902;
      e.cloaked = true;
      e.revealed = revealed;
      e.pos = { x: 400, y: 300 };
      game.enemies.push(e);
      internals(game).grid.rebuild(game.enemies);
      game.projectiles.push({
        uid: 9000 + e.uid, src: t!, kind: 'bolt',
        pos: { x: 360, y: 300 }, vel: { x: 400, y: 0 },
        damage: 50, damageType: 'energy', pierce: 1, splash: 0, speed: 400,
        targetUid: e.uid, life: 1, color: '#fff', hit: new Set(),
        burnDps: 0, burnDuration: 0, burnZoneRadius: 0, burnZoneDps: 0, burnZoneDuration: 0,
        shred: false, detection: false,
      });
      internals(game).updateProjectiles(0.15);
      const hp = e.hp;
      game.enemies.length = 0;
      game.projectiles.length = 0;
      return hp;
    };
    // revealed → the bolt connects; unrevealed → it still passes through
    assert.ok(shoot(true) < 1000, 'revealed cloaked hull should take projectile damage');
    assert.equal(shoot(false), 1000, 'unrevealed cloaked hull stays untouchable without detection');
  });

  test('burn damage credits the applying tower and weaker burns never override stronger ones', () => {
    const game = makeGame();
    const t = game.placeTower(cheapestUnlockedTower(), findPlaceable(game));
    assert.ok(t);
    const e = makeEnemy(ENEMIES.aegis);
    e.pos = { x: 400, y: 300 };
    game.enemies.push(e);

    internals(game).applyBurn(e, 100, 2, t);
    assert.equal(e.burnDps, 100);
    assert.equal(e.burnSrc, t);
    // weaker-but-longer burn must not merge into strong-long or steal credit
    internals(game).applyBurn(e, 10, 50, undefined);
    assert.equal(e.burnDps, 100);
    assert.equal(e.burnTimer, 2);
    assert.equal(e.burnSrc, t);

    internals(game).updateEnemies(0.5);
    assert.ok((game.runStats.dmg[t!.def.id] ?? 0) > 0, 'burn ticks should attribute damage to the source tower');

    // once the burn expires its strength resets, so a fresh weaker burn can land
    e.burnTimer = 0.01;
    internals(game).updateEnemies(0.05);
    internals(game).applyBurn(e, 10, 1, undefined);
    assert.equal(e.burnDps, 10);
  });

  test('multiple same-tick leaks at zero cores end the run exactly once', () => {
    const game = makeGame();
    const path = ALL_MAPS[0].path;
    game.lives = 1;
    game.phase = 'wave';
    for (let i = 0; i < 3; i++) {
      const e = makeEnemy(ENEMIES.aegis);
      e.uid = 700 + i;
      e.wp = path.length; // already past the final waypoint → leaks this tick
      e.pos = { ...path[path.length - 1] };
      game.enemies.push(e);
    }
    internals(game).updateEnemies(0.016);
    assert.equal(game.phase, 'gameover');
    const events = game.buildRunUploadBundle('TEST', 'test-build').run.events as { type: string }[];
    assert.equal(events.filter((ev) => ev.type === 'run_end').length, 1);
  });

  test('placeTower rejects locked towers even when the shop UI is bypassed', () => {
    const game = makeGame();
    const locked = TOWERS.find((d) => d.unlockAt > 0);
    assert.ok(locked);
    game.credits = 1_000_000; // rule out a credits rejection masking the unlock gate
    assert.equal(game.placeTower(locked!, findPlaceable(game)), null);
    const analytics = game.buildRunAnalyticsDoc('TEST', 'w_test123', 'test-build');
    assert.equal(analytics.placement.failedByReason.locked, 1);
  });
});

describe('deterministic simulation hooks', () => {
  test('same seed reproduces gameplay randomness and per-instance entity uids', () => {
    const a = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 1234, lifetimeKills: 0 });
    const b = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 1234, lifetimeKills: 0 });
    type WithMakeEnemy = { makeEnemy(typeId: string, cloaked: boolean): Enemy };
    const ea = (a as unknown as WithMakeEnemy).makeEnemy('aegis', false);
    const eb = (b as unknown as WithMakeEnemy).makeEnemy('aegis', false);
    assert.equal(ea.uid, 1, 'entity uids restart per Game instance');
    assert.equal(eb.uid, 1);
    assert.equal(ea.phase, eb.phase, 'seeded rng streams must match');
    assert.equal(a.buildRunUploadBundle('TEST', 'test-build').run.setup.seed, 1234);
  });

  test('unlock gating honors the lifetimeKills snapshot, not the live save', () => {
    const locked = TOWERS.find((d) => d.unlockAt > 0);
    assert.ok(locked);
    const gated = new Game(ALL_MAPS[0], DIFFICULTIES[0], { lifetimeKills: 0 });
    const veteran = new Game(ALL_MAPS[0], DIFFICULTIES[0], { lifetimeKills: locked!.unlockAt });
    assert.equal(gated.towerAvailable(locked!), false);
    assert.equal(veteran.towerAvailable(locked!), true);
  });

  test('simulation advances in exact fixed steps with a carried remainder', () => {
    const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 1, lifetimeKills: 0 });
    game.update(0.01);
    assert.equal(game.time, 0, 'sub-step remainder is banked, not stepped');
    game.update(0.01);
    assert.ok(Math.abs(game.time - Game.SIM_STEP) < 1e-9, 'exactly one fixed step after 20ms');
  });
});

describe('build freshness', () => {
  test('stale only when a real differing tag arrives, never in dev', () => {
    assert.equal(isStaleBuild('abc', { tag: 'xyz' }), true);
    assert.equal(isStaleBuild('abc', { tag: 'abc' }), false);
    assert.equal(isStaleBuild('abc', {}), false);
    assert.equal(isStaleBuild('abc', null), false);
    assert.equal(isStaleBuild('dev', { tag: 'xyz' }), false);
  });
});

describe('server deletion helpers', () => {
  test('keeps unique valid run ids from leaderboard score rows', () => {
    assert.deepEqual(validDeletedRunIds(['r_abcdefgh', 'bad', 'r_abcdefgh', null, 'r_ijklmnop']), ['r_abcdefgh', 'r_ijklmnop']);
  });

  test('public run deletion requires corroboration beyond the owner index', () => {
    // r_plantedxx simulates a forged legacy replayOwners row pointing at another
    // player's replay: it must be skipped, not deleted.
    const { deletable, skipped } = partitionRunDeletions(
      ['r_ownedrun1', 'r_plantedxx'],
      ['r_ownedrun1', 'r_boardonly'],
    );
    assert.deepEqual([...deletable].sort(), ['r_boardonly', 'r_ownedrun1']);
    assert.deepEqual(skipped, ['r_plantedxx']);
  });

  test('corroborated-only run ids are deletable even without an owner row', () => {
    const { deletable, skipped } = partitionRunDeletions([], ['r_boardonly', 'bad-id']);
    assert.deepEqual(deletable, ['r_boardonly']);
    assert.deepEqual(skipped, []);
  });
});

describe('bot rival profile helpers', () => {
  test('returns current-sector bot profiles in difficulty order', () => {
    const raw: WaveCurveLite[] = [
      { map: 'relay', diff: 'hard', skill: 'expert', winRate: 0.2, avgFinalWave: 42, points: [{ wave: 1, coreFraction: 1 }] },
      { map: 'other', diff: 'easy', skill: 'rookie', winRate: 1, avgFinalWave: 50, points: [{ wave: 1, coreFraction: 1 }] },
      { map: 'relay', diff: 'normal', skill: 'expert', winRate: 0.6, avgFinalWave: 49, points: [{ wave: 1, coreFraction: 0.8 }] },
      { map: 'relay', diff: 'easy', skill: 'rookie', winRate: 0.8, avgFinalWave: 50, points: [{ wave: 1, coreFraction: 1 }] },
      { map: 'relay', diff: 'normal', skill: 'standard', winRate: 0.5, avgFinalWave: 47, points: [{ wave: 1, coreFraction: 0.5 }] },
      { map: 'relay', diff: 'normal', skill: 'rookie', winRate: 0.3, avgFinalWave: 39, points: [{ wave: 1, coreFraction: 0.6 }] },
    ];
    const profiles = ghostCurvesForMap(buildGhostCurves(raw), 'relay');
    assert.deepEqual(profiles.map((curve) => `${curve.diff}:${curve.skill}`), ['easy:rookie', 'normal:rookie', 'normal:standard', 'normal:expert', 'hard:expert']);
    assert.equal(profiles[1].startingLives, DIFFICULTIES.find((diff) => diff.id === 'normal')?.lives);
  });

  test('wave zero uses a true pre-wave starting point', () => {
    const [curve] = buildGhostCurves([
      { map: 'relay', diff: 'normal', skill: 'standard', winRate: 0.5, avgFinalWave: 47, points: [{ wave: 1, coreFraction: 0.5, pressure: 0.25, creditsStart: 120, towersStart: 2 }] },
    ]);
    const g = ghostAtWave(curve, 0);
    assert.deepEqual(g, { wave: 0, cores: curve.startingLives, coreFraction: 1, leakPct: 0 });
    assert.equal(ghostAtWave(curve, 1)?.pressure, 0.25);
  });
});

describe('bot fairness and live run context', () => {
  test('effective starting lives reflect remote balance overrides', () => {
    setBalanceDoc({ diffs: { easy: { livesMult: 0.5 } } });
    const game = new Game(ALL_MAPS[0], DIFFICULTIES[0]);
    assert.equal(game.startingLives, Math.round(DIFFICULTIES[0].lives * 0.5));
    assert.equal(game.lives, game.startingLives);
  });

  test('bot falls back instead of building locked planned towers', () => {
    progress.reset();
    const game = makeGame();
    game.credits = 10000;
    const bot = new Bot(game, {
      actInterval: 0,
      plan: [{ tower: 'prismarr', a: 0, b: 0 }],
      filler: { tower: 'prismarr', a: 0, b: 0 },
      upgradeDiligence: 0,
      abilityChance: 0,
      reserve: 0,
    });
    bot.act(1);
    assert.ok(game.towers.length > 0);
    assert.equal(game.towers.some((tower) => tower.def.id === 'prismarr'), false);
    assert.equal(game.towers.every((tower) => game.towerAvailable(tower.def)), true);
  });
});
