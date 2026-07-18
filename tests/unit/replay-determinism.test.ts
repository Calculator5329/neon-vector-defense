import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { TOWER_MAP } from '../../src/game/towers';
import type { RunUploadBundle } from '../../src/game/runTelemetry';

// Regression lock for the owner's suspected drift: "replay playback is inaccurate —
// enemies don't die accurately," which they attributed to real browser frame jitter
// vs. re-sim's uniform cadence. The engine's TRUE fixed-timestep accumulator
// (engine.ts:1662-1681) makes the tick SEQUENCE frame-pacing-independent — every
// physics step is exactly SIM_STEP regardless of how dt is chunked. This test locks
// that invariant so a future accumulator/clamp edit that reintroduces variable-size
// tail stepping fails the build: record the SAME run twice — once with uniform
// update(SIM_STEP), once with a seeded jittered dt stream — and require byte-identical
// kill frames, action/tick timeline, and summary.

function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Non-uniform dt in [0.010, 0.045]s, always < 0.05 so speed-1 stepping never trips the
// accumulator's per-frame clamp/budget — the tick sequence stays identical to uniform
// pacing, only the CHUNKING (ticks per update call) differs.
function jitteredStream(seed: number): () => number {
  const rng = seededRng(seed);
  return () => 0.010 + rng() * 0.035;
}

function firstPlaceable(game: Game): { x: number; y: number } {
  for (let y = 40; y < 680; y += 28) {
    for (let x = 40; x < 1240; x += 28) {
      if (game.canPlace({ x, y })) return { x, y };
    }
  }
  throw new Error('determinism fixture found no placeable cell');
}

interface Outcome {
  summary: RunUploadBundle['run']['summary'];
  actionHash: string;
  eventCount: number;
  totalKills: number;
  lives: number;
  credits: number;
  finalTick: number;
}

// A deliberately-thin two-tower defense on a normal Recruit run: it kills real enemies
// for several waves (locking kill-frame determinism) then leaks enough to reach a
// DETERMINISTIC gameover tick. autoNext advances waves INTERNALLY at fixed ticks, so
// there are zero pacing-dependent external calls during combat — the only variable
// across the two runs is the dt chunking. update() halts ticking exactly at the
// gameover tick, so both pacings land on the identical final tick.
function runToGameOver(dt: () => number): Outcome {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 20260718, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 1;
  game.autoNext = true;
  game.lives = 8;
  game.startingLives = game.lives;
  game.credits = 5_000;
  game.recorder.setStartingResources(game.credits, game.lives);
  for (let i = 0; i < 2; i++) {
    const tower = game.placeTower(TOWER_MAP.pulse, firstPlaceable(game));
    assert.ok(tower, 'determinism fixture tower placement must succeed');
    game.upgradeTower(tower, 0);
  }
  game.startWave();
  let iter = 0;
  while (game.phase !== 'gameover' && iter++ < 500_000) game.update(dt());
  assert.equal(game.phase, 'gameover', 'fixture must reach a deterministic gameover');
  const bundle = game.buildRunUploadBundle('DET', 'test-build');
  return {
    summary: bundle.run.summary,
    actionHash: bundle.run.manifest.actionHash,
    eventCount: bundle.run.eventCount,
    totalKills: game.totalKills,
    lives: game.lives,
    credits: game.credits,
    finalTick: Math.round(game.time / Game.SIM_STEP),
  };
}

describe('replay determinism under variable frame pacing', () => {
  test('jittered dt yields byte-identical kill frames and summary as uniform dt', () => {
    const uniform = runToGameOver(() => Game.SIM_STEP);
    const jittered = runToGameOver(jitteredStream(0xc0ffee));

    // The lock is only meaningful if the fixture actually fought and lost.
    assert.ok(uniform.totalKills > 0, 'fixture must record real enemy deaths');
    assert.ok(uniform.summary.leaks > 0, 'fixture must record real leaks');

    assert.deepEqual(jittered.summary, uniform.summary, 'summary drifted under jittered pacing');
    assert.equal(jittered.actionHash, uniform.actionHash, 'action/tick timeline drifted under jittered pacing');
    assert.equal(jittered.eventCount, uniform.eventCount, 'event count drifted under jittered pacing');
    assert.equal(jittered.totalKills, uniform.totalKills, 'kill count drifted under jittered pacing');
    assert.equal(jittered.finalTick, uniform.finalTick, 'gameover tick drifted under jittered pacing');
    assert.equal(jittered.lives, uniform.lives, 'lives drifted under jittered pacing');
    assert.equal(jittered.credits, uniform.credits, 'credits drifted under jittered pacing');
  });

  test('a second independent jitter seed converges to the same run', () => {
    const uniform = runToGameOver(() => Game.SIM_STEP);
    const jittered = runToGameOver(jitteredStream(0x1234abcd));
    assert.equal(jittered.actionHash, uniform.actionHash);
    assert.equal(jittered.totalKills, uniform.totalKills);
    assert.equal(jittered.finalTick, uniform.finalTick);
  });
});
