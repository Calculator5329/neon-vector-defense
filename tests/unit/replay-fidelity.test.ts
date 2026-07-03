import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Bot } from '../../src/game/bot';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { decodeReplayActionBundle, encodedReplayActionBytes } from '../../src/game/replayCodec';
import { createReplayPlayback, reSimulate } from '../../src/game/reSimulate';
import type { RunUploadBundle } from '../../src/game/runTelemetry';

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

function recordSeededRun(maxWave: number): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[1], { seed: 20260702, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.autoNext = true;
  const bot = new Bot(game, 'expert', seededRng(4242));
  game.startWave();
  for (let i = 0; i < 120_000 && game.wave <= maxWave && game.phase !== 'gameover'; i++) {
    bot.act(game.time);
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  return game.buildRunUploadBundle('FIDELITY', 'test-build');
}

describe('replay v3 fidelity', () => {
  test('public replay payload is compact schema v3 action data', () => {
    const bundle = recordSeededRun(12);
    const runJson = JSON.stringify(bundle.run);
    const actionBytes = encodedReplayActionBytes(bundle.run.actions, bundle.chunks);

    assert.equal(bundle.run.schemaVersion, 3);
    assert.equal('events' in bundle.run, false);
    assert.equal('snapshots' in bundle.run, false);
    assert.equal('deathRecords' in bundle.run, false);
    assert.ok(bundle.run.actions.count > 0);
    assert.ok(actionBytes < 12_000, `action payload too large: ${actionBytes}`);
    assert.ok(runJson.length < 900_000, `run doc too large: ${runJson.length}`);
    assert.ok(bundle.chunks.every((chunk) => chunk.actions.count <= 650));
  });

  test('server re-simulation verifies the decoded v3 action stream', () => {
    const bundle = recordSeededRun(8);
    const actions = decodeReplayActionBundle(bundle.run.actions, bundle.chunks);

    assert.ok(actions.some((event) => event.type === 'wave_start'));
    assert.ok(actions.some((event) => event.type === 'tower_place'));
    assert.ok(actions.some((event) => event.type === 'run_end'));
    assert.equal(actions.length, bundle.run.eventCount);

    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
  });

  test('client playback driver reproduces final run state and deterministic seeks', () => {
    const bundle = recordSeededRun(12);
    assert.equal(reSimulate(bundle).verdict, 'verified');

    const driver = createReplayPlayback({ ...bundle.run, chunks: bundle.chunks });
    assert.ok(driver, 'current-engine v3 run should be drivable');

    driver.seekTo(driver.endT + 1);
    const final = driver.game.buildRunUploadBundle('FIDELITY', 'test-build').run.summary;
    assert.equal(final.kills, bundle.run.summary.kills);
    assert.equal(final.leaks, bundle.run.summary.leaks);
    assert.equal(final.wave, bundle.run.summary.wave);

    const midT = driver.endT * 0.5;
    driver.seekTo(midT);
    const forwardKills = driver.game.totalKills;
    const forwardEnemies = driver.game.enemies.length;
    driver.seekTo(0);
    driver.seekTo(midT);
    assert.equal(driver.game.totalKills, forwardKills);
    assert.equal(driver.game.enemies.length, forwardEnemies);
  });
});
