import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Bot } from '../../src/game/bot';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { decodeReplayActionBundle } from '../../src/game/replayCodec';
import { reconstructAt, waveWindow } from '../../src/game/replayReconstruct';
import type { PublicRunDoc } from '../../src/game/runTelemetry';

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

/** A schema-v3 run doc shaped the way `fetchRunReplay` hands one to the viewer:
 *  no snapshots, `events` decoded from the recorded action stream. */
function recordViewerRunDoc(maxWave: number): PublicRunDoc {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[1], { seed: 20260919, lifetimeKills: 1_000_000 });
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
  const bundle = game.buildRunUploadBundle('RECON', 'test-build');
  return {
    ...bundle.run,
    events: decodeReplayActionBundle(bundle.run.actions, bundle.chunks),
    snapshots: [],
  } as unknown as PublicRunDoc;
}

describe('cosmetic reconstruction of a snapshot-less (v3) replay', () => {
  const run = recordViewerRunDoc(6);
  const end = run.summary.durationS;

  test('the scrub position drives the frame instead of pinning it to the run end', () => {
    const early = reconstructAt(run, 0);
    const last = reconstructAt(run, end);

    // The old single-synthetic-keyframe fallback returned the run-end frame here,
    // so the viewer opened already finished and never changed as the playhead moved.
    assert.equal(early.terminal, false, 'opening frame must not report the run as over');
    assert.ok(early.idx < last.idx, 'the playhead must advance through more than one keyframe');
    assert.ok(early.snap.wave < run.summary.wave, 'opening frame must not show the final wave');
    assert.equal(last.terminal, true, 'the last keyframe is the run end');
    assert.equal(last.snap.wave, run.summary.wave);
  });

  test('the run-end keyframe is reachable from the end of the recorded stream', () => {
    // The viewer scrubs [0, last recorded event], which lands just short of the rounded
    // summary.durationS. A keyframe pinned past that is unreachable, so the replay could
    // never show its own outcome or its real final totals.
    const events = run.events ?? [];
    const lastT = events[events.length - 1].t;
    assert.equal(reconstructAt(run, lastT).terminal, true);
    assert.equal(reconstructAt(run, lastT).snap.kills, run.summary.kills);
  });

  test('totals the document does not record are flagged unknown, never shown as run-end totals', () => {
    const early = reconstructAt(run, 0);
    assert.deepEqual([...early.unknown].sort(), ['cash', 'kills', 'leaks', 'lives']);
    assert.deepEqual(reconstructAt(run, end).unknown, []);
  });

  test('the tower roster grows with the playhead', () => {
    const opening = reconstructAt(run, 0).towers.length;
    assert.ok(reconstructAt(run, end).towers.length > opening, 'the roster must grow as the run plays');
  });

  test('the wave callout does not announce the final wave before a wave has launched', () => {
    const firstLaunch = (run.events ?? []).find((e) => e.type === 'wave_start');
    assert.ok(firstLaunch, 'the fixture records wave launches');
    // Before the first recorded launch the run has no wave at all. Reporting
    // summary.wave there announced the FINAL wave over the opening seconds.
    assert.equal(waveWindow(run, firstLaunch.t - 0.01).wave, 0);
    const opening = waveWindow(run, firstLaunch.t);
    assert.equal(opening.wave, firstLaunch.wave);
    assert.ok(waveWindow(run, end).wave > opening.wave, 'the callout must track the scrub position');
  });
});
