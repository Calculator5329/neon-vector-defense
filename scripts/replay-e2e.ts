import assert from 'node:assert/strict';
import { Game } from '../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../src/game/maps';
import { reSimulate, type ReSimBundle, type ReSimResult } from '../src/game/reSimulate';
import { buildRunManifest, type PublicRunDoc, type RunEventChunkDoc, type RunUploadBundle } from '../src/game/runTelemetry';
import { decodeReplayActionBundle, encodeReplayActions } from '../src/game/replayCodec';
import { TOWER_MAP } from '../src/game/towers';

const BUILD_TAG = 'replay-e2e';
const SEED = 0x5eed2026;

/** JSON-backed stand-in for the Firestore run document + chunk collection. */
class ReplayStoreMock {
  private readonly documents = new Map<string, string>();

  upload(bundle: RunUploadBundle): void {
    this.documents.set(`runs/${bundle.run.runId}`, JSON.stringify(bundle.run));
    for (const chunk of bundle.chunks) {
      this.documents.set(`runs/${bundle.run.runId}/events/${chunk.chunk}`, JSON.stringify(chunk));
    }
  }

  load(runId: string): ReSimBundle {
    const runJson = this.documents.get(`runs/${runId}`);
    assert.ok(runJson, `mock storage is missing run ${runId}`);
    const run = JSON.parse(runJson) as PublicRunDoc;
    const chunks: RunEventChunkDoc[] = [];
    for (let chunk = 0; chunk < run.chunkCount; chunk++) {
      const chunkJson = this.documents.get(`runs/${runId}/events/${chunk}`);
      assert.ok(chunkJson, `mock storage is missing chunk ${chunk}`);
      chunks.push(JSON.parse(chunkJson) as RunEventChunkDoc);
    }
    return { run, chunks };
  }
}

function firstPlaceablePosition(game: Game): { x: number; y: number } {
  for (let y = 40; y < 680; y += 28) {
    for (let x = 40; x < 1240; x += 28) {
      if (game.canPlace({ x, y })) return { x, y };
    }
  }
  throw new Error('fixture could not find a legal tower position');
}

function recordSeededRun(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], {
    seed: SEED,
    lifetimeKills: 1_000_000,
  });
  game.paused = false;
  game.speed = 4;
  game.credits = 20_000;
  game.recorder.setStartingResources(game.credits, game.lives);

  const tower = game.placeTower(TOWER_MAP.pulse, firstPlaceablePosition(game));
  assert.ok(tower, 'fixture tower placement must succeed');
  assert.equal(game.upgradeTower(tower, 0), true, 'fixture tower upgrade must succeed');

  // Cross the production 650-action boundary through real engine inputs. This
  // makes the mock persist and reload both the run document and an event chunk.
  for (let input = 0; input < 660; input++) game.setSpeed(input % 2 === 0 ? 1 : 2);

  // Advance a couple of deterministic sim-seconds without starting combat. The
  // replay still contains meaningful place/upgrade inputs, while this smoke gate
  // remains quick enough to run on every build instead of simulating whole waves.
  for (let tick = 0; tick < 120; tick++) game.update(Game.SIM_STEP / game.speed);
  game.abandonRun('replay-e2e');
  return game.buildRunUploadBundle('REPLAY-E2E', BUILD_TAG);
}

function tamperPlayerAction(bundle: ReSimBundle): ReSimBundle {
  const copy = JSON.parse(JSON.stringify(bundle)) as ReSimBundle;
  const events = decodeReplayActionBundle(copy.run.actions, copy.chunks);
  const placement = events.find((event) => event.type === 'tower_place');
  assert.ok(placement, 'fixture replay must contain a tower_place action');

  // Orbital Relay's center is on a blocker/path. Re-signing the manifest models
  // a coherent but dishonest uploaded replay, so verifyRun reaches re-simulation
  // and rejects the impossible action as divergent instead of stopping at hash validation.
  placement.x = 640;
  placement.y = 360;

  const rootCount = copy.run.actions.count;
  const towerIds = copy.run.actions.towerIds;
  copy.run.actions = encodeReplayActions(events.slice(0, rootCount), { towerIds });
  copy.chunks = copy.chunks.map((chunk, index) => ({
    ...chunk,
    actions: encodeReplayActions(
      events.slice(rootCount + index * 650, rootCount + (index + 1) * 650),
      { towerIds },
    ),
  }));
  copy.run.manifest = buildRunManifest(copy.run.actions, copy.chunks);
  return copy;
}

function verifyRun(store: ReplayStoreMock, runId: string): ReSimResult {
  return reSimulate(store.load(runId));
}

const recorded = recordSeededRun();
assert.equal(recorded.run.manifest.complete, true);
assert.ok(recorded.run.chunkCount > 0, 'fixture must exercise replay chunk storage');
assert.equal(recorded.run.manifest.chunkEventCounts.length, recorded.run.chunkCount);

const storage = new ReplayStoreMock();
storage.upload(recorded);
const original = verifyRun(storage, recorded.run.runId);
assert.equal(original.verdict, 'verified', original.reason ?? 'original replay did not verify');

const tampered = tamperPlayerAction(storage.load(recorded.run.runId));
assert.notEqual(tampered.run.manifest.actionHash, recorded.run.manifest.actionHash);
const tamperedStorage = new ReplayStoreMock();
tamperedStorage.upload(tampered);
const rejected = verifyRun(tamperedStorage, recorded.run.runId);
assert.equal(rejected.verdict, 'divergent', rejected.reason ?? 'tampered replay did not diverge');

console.log(`recorded run=${recorded.run.runId} seed=${SEED} events=${recorded.run.eventCount} chunks=${recorded.run.chunkCount}`);
console.log(`manifest actionHash=${recorded.run.manifest.actionHash}`);
console.log(`verifyRun original=${original.verdict}`);
console.log(`verifyRun tampered=${rejected.verdict} reason=${rejected.reason ?? 'simulation mismatch'}`);
console.log('replay-e2e: PASS');
