import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { HISTORICAL_MAP_GEOMETRY, hashReplayMapGeometry, resolveReplayMap } from '../../src/game/mapVersions';
import { decodeReplayActionBundle } from '../../src/game/replayCodec';
import { reconstructAt } from '../../src/game/replayReconstruct';
import { createReplayPlayback, reSimulate } from '../../src/game/reSimulate';
import { TOWER_MAP } from '../../src/game/towers';
import type { PublicRunDoc, RunUploadBundle } from '../../src/game/runTelemetry';

const legacyGeometry = (id: string) => {
  const geom = HISTORICAL_MAP_GEOMETRY.find((entry) => entry.id === id);
  assert.ok(geom, `registry has a legacy ${id} entry`);
  return geom;
};

// A spot that was buildable on pre-2026-07-05 Foundry Floor but is covered by
// the relocated wall (x=1130, y=195, r=36) on the current map.
const FOUNDRY_CONTESTED_SPOT = { x: 1130, y: 195 };

function recordLegacyFoundryRun(): { bundle: RunUploadBundle; legacyHash: string } {
  const legacyHash = hashReplayMapGeometry(legacyGeometry('foundry'));
  const map = resolveReplayMap('foundry', legacyHash);
  assert.ok(map, 'legacy foundry geometry resolves');
  const game = new Game(map, DIFFICULTIES[0], { seed: 20260705, lifetimeKills: 1_000_000 });
  game.paused = false;
  const tower = game.placeTower(TOWER_MAP.pulse, FOUNDRY_CONTESTED_SPOT);
  assert.ok(tower, 'contested spot is buildable on the legacy geometry');
  game.startWave();
  for (let i = 0; i < 40_000 && (game.phase as string) === 'wave'; i++) game.update(0.05);
  return { bundle: game.buildRunUploadBundle('LEGACY', 'test-build'), legacyHash };
}

describe('map version registry', () => {
  test('every current map resolves to itself by its own hash', () => {
    for (const map of ALL_MAPS) {
      const resolved = resolveReplayMap(map.id, hashReplayMapGeometry(map));
      assert.equal(resolved, map, `${map.id} resolves to the live map`);
    }
  });

  test('legacy geometry hashes are frozen (append-only registry)', () => {
    // Hardcoded so an accidental edit to a historical snapshot fails loudly —
    // these hashes exist in recorded run docs and can never change.
    assert.equal(hashReplayMapGeometry(legacyGeometry('splice')), 'ba889b58');
    assert.equal(hashReplayMapGeometry(legacyGeometry('foundry')), '591e4388');
  });

  test('legacy hashes resolve to the historical geometry, cosmetics from the live map', () => {
    for (const geom of HISTORICAL_MAP_GEOMETRY) {
      const current = ALL_MAPS.find((map) => map.id === geom.id);
      assert.ok(current, `live map ${geom.id} still exists`);
      const resolved = resolveReplayMap(geom.id, hashReplayMapGeometry(geom));
      assert.ok(resolved, `legacy ${geom.id} resolves`);
      assert.equal(hashReplayMapGeometry(resolved), hashReplayMapGeometry(geom));
      assert.deepEqual(resolved.blockers, geom.blockers);
      assert.equal(resolved.theme, current.theme);
      assert.notDeepEqual(resolved.blockers, current.blockers, 'registry entry differs from the live map');
    }
  });

  test('unknown hash resolves to null, missing hash falls back to the live map', () => {
    assert.equal(resolveReplayMap('foundry', 'deadbeef'), null);
    assert.equal(resolveReplayMap('nosuchmap', 'deadbeef'), null);
    assert.equal(resolveReplayMap('foundry', undefined), ALL_MAPS.find((map) => map.id === 'foundry'));
  });
});

describe('replays recorded on re-tuned maps', () => {
  test('contested spot is NOT buildable on the current foundry (test premise)', () => {
    const current = ALL_MAPS.find((map) => map.id === 'foundry');
    assert.ok(current);
    const game = new Game(current, DIFFICULTIES[0], { seed: 1, lifetimeKills: 1_000_000 });
    assert.equal(game.canPlace(FOUNDRY_CONTESTED_SPOT), false);
  });

  test('re-simulation verifies a run recorded on the legacy geometry', () => {
    const { bundle, legacyHash } = recordLegacyFoundryRun();
    assert.equal(bundle.run.setup.mapHash, legacyHash);
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', `expected verified, got ${result.verdict}: ${result.reason ?? ''}`);
  });

  test('frame-accurate playback keeps every tower and reports no divergence', () => {
    const { bundle } = recordLegacyFoundryRun();
    const playback = createReplayPlayback({ ...bundle.run, chunks: bundle.chunks });
    assert.ok(playback, 'playback driver builds for the legacy-map run');
    assert.equal(playback.seekTo(playback.endT), true);
    assert.equal(playback.game.towers.length, 1, 'the contested tower is on the board');
    assert.equal(playback.divergedAtT, null);
  });

  test('a run pinned to the WRONG geometry diverges loudly instead of silently dropping towers', () => {
    const { bundle } = recordLegacyFoundryRun();
    const currentFoundry = ALL_MAPS.find((map) => map.id === 'foundry');
    assert.ok(currentFoundry);
    const tampered: PublicRunDoc = JSON.parse(JSON.stringify(bundle.run));
    tampered.setup.mapHash = hashReplayMapGeometry(currentFoundry);

    const result = reSimulate({ run: tampered, chunks: bundle.chunks });
    assert.equal(result.verdict, 'divergent');

    const playback = createReplayPlayback({ ...tampered, chunks: bundle.chunks });
    assert.ok(playback);
    playback.seekTo(playback.endT);
    assert.notEqual(playback.divergedAtT, null, 'playback flags the desync');
  });
});

describe('snapshot-less reconstruction tower roster', () => {
  test('all placed towers survive the fallback reconstruction (final.towers is capped)', () => {
    const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 7, lifetimeKills: 1_000_000 });
    game.paused = false;
    let placed = 0;
    for (let y = 40; y < 680 && placed < 5; y += 24) {
      for (let x = 40; x < 1240 && placed < 5; x += 24) {
        if (game.canPlace({ x, y }) && game.placeTower(TOWER_MAP.pulse, { x, y })) placed++;
      }
    }
    assert.equal(placed, 5, 'placed five towers');
    game.startWave();
    for (let i = 0; i < 40_000 && (game.phase as string) === 'wave'; i++) game.update(0.05);
    const bundle = game.buildRunUploadBundle('ROSTER', 'test-build');
    assert.ok(bundle.run.final.towers.length < placed, 'final.towers really is capped (test premise)');

    const doc = {
      ...bundle.run,
      events: decodeReplayActionBundle(bundle.run.actions, bundle.chunks),
      snapshots: [],
    };
    const frame = reconstructAt(doc, bundle.run.summary.durationS);
    assert.equal(frame.towers.length, placed, 'reconstruction shows every tower');
  });
});
