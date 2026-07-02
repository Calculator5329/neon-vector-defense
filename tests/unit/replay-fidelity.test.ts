import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Bot } from '../../src/game/bot';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { buildReplayCombatTimeline } from '../../src/game/replayReconstruct';
import type { PublicRunDoc, RunEvent, RunTelemetryState, RunUploadBundle } from '../../src/game/runTelemetry';
import type { Enemy } from '../../src/game/types';

interface TerminalRecord {
  uid: number;
  enemyId: string;
  wave: number;
  t: number;
}

interface SimResult {
  bundle: RunUploadBundle;
  deaths: TerminalRecord[];
  leaks: TerminalRecord[];
  deathBytes: number;
}

function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type GameWithInternals = {
  killEnemy(enemy: Enemy): void;
};

function roundS(n: number): number {
  return Math.max(0, Math.round(n * 10) / 10);
}

function roundReplayT(n: number): number {
  return Math.max(0, Math.round(n * 10) / 10);
}

function runSeededReplay(maxWave: number, options: { diffIndex?: number; freeplay?: boolean } = {}): SimResult {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[options.diffIndex ?? 1], { seed: 424242, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.autoNext = true;
  game.credits = Math.max(game.credits, 2000);
  const bot = new Bot(game, 'expert', seededRng(9901));
  const deaths: TerminalRecord[] = [];
  const leaks: TerminalRecord[] = [];

  const internals = game as unknown as GameWithInternals;
  const originalKill = internals.killEnemy.bind(game);
  internals.killEnemy = (enemy: Enemy) => {
    if (!enemy.dead) deaths.push({ uid: enemy.uid, enemyId: enemy.def.id, wave: game.wave, t: roundS(game.time) });
    originalKill(enemy);
  };

  const originalLeak = game.recorder.recordLeak.bind(game.recorder);
  game.recorder.recordLeak = (
    state: RunTelemetryState,
    enemyId: string,
    coresLost: number,
    traits,
    enemy?: Enemy,
  ) => {
    if (enemy) leaks.push({ uid: enemy.uid, enemyId, wave: state.wave, t: roundS(state.time) });
    originalLeak(state, enemyId, coresLost, traits, enemy);
  };

  game.startWave();
  for (let i = 0; i < 180_000 && game.wave <= maxWave && game.phase !== 'gameover'; i++) {
    bot.act(game.time);
    if (options.freeplay && game.phase === 'victory') {
      game.enterFreeplay('standard');
      game.credits = Math.max(game.credits, 200_000);
      game.startWave();
    } else if (game.phase === 'build') {
      game.startWave();
    }
    game.update(0.05);
  }

  const bundle = game.buildRunUploadBundle('FIDELITY', 'test-build');
  return {
    bundle,
    deaths,
    leaks,
    deathBytes: JSON.stringify(bundle.run.deathRecords).length,
  };
}

function assertTimelineMatchesTruth(result: SimResult): { maxError: number; avgError: number } {
  const timeline = buildReplayCombatTimeline(result.bundle.run);
  assert.equal(timeline.authoritativeDeaths, true);
  const reconstructedKills = new Map(
    timeline.enemies
      .filter((enemy) => enemy.endKind === 'kill' && enemy.endT != null)
      .map((enemy) => [enemy.uid, enemy]),
  );
  const reconstructedLeaks = new Map(
    timeline.enemies
      .filter((enemy) => enemy.endKind === 'leak' && enemy.endT != null)
      .map((enemy) => [enemy.uid, enemy]),
  );

  assert.equal(reconstructedKills.size, result.deaths.length);
  let totalError = 0;
  let maxError = 0;
  for (const death of result.deaths) {
    const rec = reconstructedKills.get(death.uid);
    assert.ok(rec, `missing reconstructed death for uid ${death.uid}`);
    assert.equal(rec.def.id, death.enemyId);
    assert.equal(rec.wave, death.wave);
    const err = Math.abs((rec.endT ?? 0) - death.t);
    totalError += err;
    maxError = Math.max(maxError, err);
    assert.ok(err <= 0.5, `death ${death.uid} timing error ${err}s`);
  }

  assert.equal(reconstructedLeaks.size, result.leaks.length);
  for (const leak of result.leaks) {
    const rec = reconstructedLeaks.get(leak.uid);
    assert.ok(rec, `missing reconstructed leak for uid ${leak.uid}`);
    assert.equal(rec.def.id, leak.enemyId);
    assert.equal(rec.wave, leak.wave);
    assert.ok(Math.abs((rec.endT ?? 0) - leak.t) <= 0.5);
  }

  assert.ok(JSON.stringify(result.bundle.run).length < 900_000);
  assert.ok(result.bundle.chunks.length <= 100);
  assert.ok(result.bundle.chunks.every((chunk) => chunk.events.length <= 650));
  assert.equal(result.bundle.run.deathRecords?.count, result.deaths.length);
  return {
    maxError,
    avgError: result.deaths.length ? totalError / result.deaths.length : 0,
  };
}

function expectedEliteSpawns(run: PublicRunDoc): { wave: number; type: string; spawnT: number; affix: string }[] {
  const expected: { wave: number; type: string; spawnT: number; affix: string }[] = [];
  for (const event of run.events) {
    if (event.type !== 'wave_start' || !Array.isArray(event.groups)) continue;
    let cursor = event.t;
    for (const rawGroup of event.groups) {
      if (!rawGroup || typeof rawGroup !== 'object') continue;
      const group = rawGroup as Record<string, unknown>;
      const type = typeof group.type === 'string' ? group.type : '';
      const count = typeof group.count === 'number' && Number.isFinite(group.count) ? Math.max(0, Math.floor(group.count)) : 0;
      const gap = typeof group.gap === 'number' && Number.isFinite(group.gap) ? Math.max(0.03, group.gap) : 0.55;
      const delay = typeof group.delay === 'number' && Number.isFinite(group.delay) ? Math.max(0, group.delay) : 0;
      const firstSpawnT = cursor + delay;
      if (type && count > 0 && Array.isArray(group.elites)) {
        for (const rawElite of group.elites) {
          if (!rawElite || typeof rawElite !== 'object') continue;
          const elite = rawElite as Record<string, unknown>;
          const i = typeof elite.i === 'number' && Number.isFinite(elite.i) ? Math.floor(elite.i) : -1;
          const affix = typeof elite.a === 'string' ? elite.a : '';
          if (i >= 0 && i < count && affix) expected.push({ wave: event.wave, type, spawnT: roundReplayT(firstSpawnT + i * gap), affix });
        }
      }
      cursor = firstSpawnT + Math.max(0, count - 1) * gap;
    }
  }
  return expected;
}

function assertEliteReplayMetadata(run: PublicRunDoc): void {
  const expected = expectedEliteSpawns(run);
  assert.ok(expected.length > 0, 'seed should record at least one elite spawn');
  const timeline = buildReplayCombatTimeline(run);
  const reconstructedExpected = expected.filter((elite) => timeline.enemies.some((enemy) => (
    enemy.wave === elite.wave
    && enemy.def.id === elite.type
    && roundReplayT(enemy.spawnT) === elite.spawnT
  )));
  assert.ok(reconstructedExpected.length > 0, 'seed should reconstruct at least one recorded elite terminal');
  const expectedKeys = new Set(reconstructedExpected.map((elite) => `${elite.wave}:${elite.type}:${elite.spawnT}:${elite.affix}`));

  for (const elite of reconstructedExpected) {
    const rec = timeline.enemies.find((enemy) => (
      enemy.wave === elite.wave
      && enemy.def.id === elite.type
      && roundReplayT(enemy.spawnT) === elite.spawnT
      && enemy.elite === elite.affix
    ));
    assert.ok(rec, `missing elite ${elite.affix} on ${elite.type} wave ${elite.wave} spawn ${elite.spawnT}`);
  }

  const actualEliteKeys = timeline.enemies
    .filter((enemy) => enemy.elite)
    .map((enemy) => `${enemy.wave}:${enemy.def.id}:${roundReplayT(enemy.spawnT)}:${enemy.elite}`);
  assert.deepEqual(actualEliteKeys.sort(), [...expectedKeys].sort());
}

function runUmbraPhaseReplay(): PublicRunDoc {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 8080, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.wave = 79;
  game.startWave();

  let umbra: Enemy | undefined;
  for (let i = 0; i < 20 && !umbra; i++) {
    game.update(0.05);
    umbra = game.enemies.find((enemy) => enemy.def.id === 'umbra');
  }
  assert.ok(umbra, 'wave 80 should spawn THE UMBRA');

  umbra.maxHp = 1000;
  umbra.hp = 670;
  umbra.umbraPhase = 1;
  umbra.umbraTickDamage = 0;
  game.damageEnemy(umbra, 20, 'energy', true);
  game.update(0.05);

  umbra.hp = 331;
  game.damageEnemy(umbra, 2, 'energy', true);
  game.update(0.05);

  umbra.hp = 1;
  game.damageEnemy(umbra, 9999, 'energy', true);

  return game.buildRunUploadBundle('UMBRA', 'test-build').run;
}

function umbraPhaseEvents(events: RunEvent[]): { t: number; phase: number; enemyUid?: number }[] {
  return events
    .filter((event) => event.type === 'umbra_phase')
    .map((event) => ({
      t: event.t,
      phase: event.p as number,
      enemyUid: typeof event.enemyUid === 'number' ? Math.floor(event.enemyUid) : undefined,
    }));
}

describe('replay death fidelity', () => {
  test('seeded expert campaign replay reconstructs exact death and leak terminals', () => {
    const result = runSeededReplay(20);
    assert.ok(result.deaths.length > 500, 'seed should produce a meaningful death sample');
    const fidelity = assertTimelineMatchesTruth(result);
    assert.equal(fidelity.maxError, 0);
    assert.equal(fidelity.avgError, 0);
    assertEliteReplayMetadata(result.bundle.run);

    const rerun = runSeededReplay(20);
    assert.equal(JSON.stringify(rerun.bundle.run.deathRecords), JSON.stringify(result.bundle.run.deathRecords));
  });

  test('deep freeplay segment keeps packed death records inside the run-doc budget', () => {
    const result = runSeededReplay(55, { diffIndex: 0, freeplay: true });
    assert.ok(result.bundle.run.summary.freeplay, 'run should enter freeplay');
    assert.ok(result.bundle.run.summary.wave >= 55, `expected a deep segment, got wave ${result.bundle.run.summary.wave}`);
    assert.ok(result.deaths.length > 2_000, 'freeplay seed should produce volume');
    const fidelity = assertTimelineMatchesTruth(result);
    assert.equal(fidelity.maxError, 0);
    assert.ok(result.deathBytes / Math.max(1, result.deaths.length) < 10, 'death codec should stay compact');
  });

  test('umbra phase replay timeline matches recorded events', () => {
    const run = runUmbraPhaseReplay();
    const recorded = umbraPhaseEvents(run.events);
    assert.deepEqual(recorded.map((event) => event.phase), [1, 2, 3]);

    const timeline = buildReplayCombatTimeline(run);
    const umbra = timeline.enemies.find((enemy) => enemy.def.id === 'umbra');
    assert.ok(umbra, 'replay timeline should include THE UMBRA');
    assert.deepEqual(
      timeline.umbraPhases.map((event) => ({ t: event.t, phase: event.phase, enemyUid: event.enemyUid })),
      recorded,
    );
    assert.deepEqual(
      umbra.umbraPhases?.map((event) => ({ t: event.t, phase: event.phase, enemyUid: event.enemyUid })),
      recorded,
    );
  });
});
