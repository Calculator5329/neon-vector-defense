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

  test('budgeted seeks converge to the identical state as synchronous seeks', () => {
    const bundle = recordSeededRun(10);
    const sync = createReplayPlayback({ ...bundle.run, chunks: bundle.chunks });
    const budgeted = createReplayPlayback({ ...bundle.run, chunks: bundle.chunks });
    assert.ok(sync && budgeted);

    const midT = sync.endT * 0.6;
    sync.seekTo(midT);

    // Converge in small slices, as the viewer does one slice per animation frame.
    assert.equal(budgeted.seekTo(midT, 25), false, 'tiny budget must report unfinished');
    assert.ok((budgeted.seekProgress ?? 0) > 0 && (budgeted.seekProgress ?? 1) < 1);
    let slices = 1;
    while (!budgeted.seekTo(midT, 200) && slices < 10_000) slices++;
    assert.ok(slices < 10_000, 'budgeted seek must converge');
    assert.equal(budgeted.seekProgress, null, 'settled seek clears progress');

    assert.equal(budgeted.game.totalKills, sync.game.totalKills);
    assert.equal(budgeted.game.enemies.length, sync.game.enemies.length);
    assert.equal(budgeted.game.credits, sync.game.credits);
    assert.equal(budgeted.game.lives, sync.game.lives);
    assert.equal(budgeted.game.fxMuted, false, 'fx muting must never leak out of a seek');

    // Backward budgeted seek (rebuilds from t=0 in slices) matches a fresh sync seek too.
    const backT = sync.endT * 0.25;
    sync.seekTo(backT);
    while (!budgeted.seekTo(backT, 200)) { /* converge */ }
    assert.equal(budgeted.game.totalKills, sync.game.totalKills);
    assert.equal(budgeted.game.enemies.length, sync.game.enemies.length);
  });

  test('playback gate keeps campaign-scale runs frame-accurate, drops marathons on duration', () => {
    const bundle = recordSeededRun(8);
    // Regression: a 60-wave Veteran victory is ~65k kills. The old 30k KILL cap
    // silently dropped every real campaign win to the hollow cosmetic fallback;
    // the gate is now sim DURATION (re-sim cost is ticks), with a far higher
    // kill bound kept only as a density backstop.
    const campaignScale = { ...bundle.run, summary: { ...bundle.run.summary, kills: 65_000 }, chunks: bundle.chunks };
    assert.ok(createReplayPlayback(campaignScale), 'campaign-scale kill counts must stay drivable');

    const marathon = { ...bundle.run, summary: { ...bundle.run.summary, durationS: 3_601 }, chunks: bundle.chunks };
    assert.equal(createReplayPlayback(marathon), null, 'multi-hour marathons fall back');

    const pathological = { ...bundle.run, summary: { ...bundle.run.summary, kills: 250_001 }, chunks: bundle.chunks };
    assert.equal(createReplayPlayback(pathological), null, 'density backstop still applies');
  });
});
