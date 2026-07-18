// Replay pipeline E2E — the named, repeatable, on-demand proof the owner directive
// asks for (docs/plans/unblock-replay-pipeline-e2e-verification-ethan-d-20260718).
//
// Unlike the old smoke gate (which advanced a couple of combat-FREE sim-seconds and
// was only "tested" by grepping this file's source), this drives real seeded runs
// THROUGH WAVES WITH ENEMY DEATHS, under jittered variable frame pacing, across
// several seeds, and asserts on every one:
//   • reSimulate(...) → `verified` with exact summary parity (server verify path);
//   • the client createReplayPlayback driver reproduces identical kill frames;
//   • a tampered player action → `divergent` (dishonest replay rejected);
//   • a zero-budget re-sim returns a bounded `unverifiable` and never hangs.
// Run it with `npm run test:replay-e2e`; it is wired into `npm run ci` and re-run by
// tests/jest/replay-e2e.test.cjs as a subprocess. Exits non-zero on any regression.

import assert from 'node:assert/strict';
import { Bot } from '../src/game/bot';
import { Game } from '../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../src/game/maps';
import { createReplayPlayback, reSimulate, type ReSimBundle, type ReSimResult } from '../src/game/reSimulate';
import { buildRunManifest, type PublicRunDoc, type RunEventChunkDoc, type RunUploadBundle } from '../src/game/runTelemetry';
import { decodeReplayActionBundle, encodeReplayActions } from '../src/game/replayCodec';

const BUILD_TAG = 'replay-e2e';
// Combat seeds proven verifiable in tests/unit/reSimulate.test.ts, so the fixtures
// are known-good and any failure here is a real regression, not a flaky fixture.
const SEEDS = [123, 223, 987];
// Cap waves so the whole multi-seed script stays well under a minute in CI while
// still recording real enemy deaths on every seed.
const MAX_WAVE = 4;

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

// Deterministic non-uniform dt in [0.012, 0.045]s — never the uniform Game.SIM_STEP
// every existing test feeds. Kept under 0.05 so speed-4 stepping (dt×4 ≤ 0.18) stays
// inside the engine's per-frame accumulator budget: this exercises the fixed-timestep
// invariant the owner doubted ("enemies don't die accurately in replay") without
// losing sim ticks. No Math.random() — pacing is seeded so the run is reproducible.
function jitteredDt(rng: () => number): number {
  return 0.012 + rng() * 0.033;
}

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

/** Record a seeded bot campaign through real waves under jittered variable pacing. */
function recordCombatRun(seed: number): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.autoNext = true;
  const bot = new Bot(game, 'standard', seededRng((seed ^ 0x9e3779b9) >>> 0));
  const pacing = seededRng((seed ^ 0x85ebca6b) >>> 0);
  game.startWave();
  for (let i = 0; i < 200_000 && game.wave <= MAX_WAVE && game.phase !== 'gameover' && game.phase !== 'victory'; i++) {
    bot.act(game.time);
    if (game.phase === 'build') game.startWave();
    game.update(jitteredDt(pacing));
  }
  assert.ok(game.totalKills > 0, `seed ${seed} recorded no enemy deaths — fixture is combat-free`);
  return game.buildRunUploadBundle('REPLAY-E2E', BUILD_TAG);
}

/** Re-sign a coherent-but-dishonest replay: move a real placement onto Orbital
 *  Relay's blocked center so verifyRun reaches re-simulation and rejects it as
 *  divergent, instead of stopping at hash validation. */
function tamperPlayerAction(bundle: ReSimBundle): ReSimBundle {
  const copy = JSON.parse(JSON.stringify(bundle)) as ReSimBundle;
  const events = decodeReplayActionBundle(copy.run.actions, copy.chunks);
  const placement = events.find((event) => event.type === 'tower_place');
  assert.ok(placement, 'combat replay must contain a tower_place action');
  placement.x = 640;
  placement.y = 360;

  const rootCount = copy.run.actions.count;
  const towerIds = copy.run.actions.towerIds;
  copy.run.actions = encodeReplayActions(events.slice(0, rootCount), { towerIds });
  copy.chunks = copy.chunks.map((chunk, index) => ({
    ...chunk,
    actions: encodeReplayActions(events.slice(rootCount + index * 650, rootCount + (index + 1) * 650), { towerIds }),
  }));
  copy.run.manifest = buildRunManifest(copy.run.actions, copy.chunks);
  return copy;
}

function verifyFromStore(store: ReplayStoreMock, runId: string, options?: { wallClockMs?: number }): ReSimResult {
  return reSimulate(store.load(runId), options);
}

let seedsProven = 0;
for (const seed of SEEDS) {
  const recorded = recordCombatRun(seed);
  assert.equal(recorded.run.manifest.complete, true, `seed ${seed}: manifest incomplete`);

  const store = new ReplayStoreMock();
  store.upload(recorded);

  // 1) Server re-sim → verified with exact summary parity.
  const verified = verifyFromStore(store, recorded.run.runId);
  assert.equal(verified.verdict, 'verified', `seed ${seed}: ${verified.reason ?? 'did not verify'}`);
  for (const field of ['kills', 'credits', 'cashEarned', 'leaks', 'coresLeft'] as const) {
    assert.equal(
      verified.summary?.[field],
      recorded.run.summary[field],
      `seed ${seed}: re-sim summary.${field} drifted`,
    );
  }

  // 2) Client playback driver reproduces identical kill frames (binds the aggregate
  //    re-sim to the frame-accurate driver so they can never be separately regressed).
  const driver = createReplayPlayback({ ...recorded.run, chunks: recorded.chunks });
  assert.ok(driver, `seed ${seed}: combat run should be drivable frame-accurately`);
  driver.seekTo(driver.endT + 1);
  const driven = driver.game.buildRunUploadBundle('REPLAY-E2E', BUILD_TAG).run.summary;
  assert.equal(driven.kills, recorded.run.summary.kills, `seed ${seed}: driver kills drifted`);
  assert.equal(driven.leaks, recorded.run.summary.leaks, `seed ${seed}: driver leaks drifted`);
  assert.equal(driven.wave, recorded.run.summary.wave, `seed ${seed}: driver wave drifted`);

  // 3) Tampered player action → divergent on the combat bundle.
  const tampered = tamperPlayerAction(store.load(recorded.run.runId));
  assert.notEqual(tampered.run.manifest.actionHash, recorded.run.manifest.actionHash);
  const tamperedStore = new ReplayStoreMock();
  tamperedStore.upload(tampered);
  const rejected = verifyFromStore(tamperedStore, recorded.run.runId);
  assert.equal(rejected.verdict, 'divergent', `seed ${seed}: tampered replay did not diverge (${rejected.reason ?? '?'})`);

  // 4) Zero wall-clock budget → bounded `unverifiable`, never a hang (owner bug #2
  //    root cause: dense marathons burning past the Cloud Function timeout).
  const bounded = verifyFromStore(store, recorded.run.runId, { wallClockMs: 0 });
  assert.equal(bounded.verdict, 'unverifiable', `seed ${seed}: exhausted budget must be unverifiable`);
  assert.match(bounded.reason ?? '', /wall-clock|step limit/, `seed ${seed}: unexpected bound reason ${bounded.reason ?? '?'}`);

  seedsProven++;
  console.log(
    `seed=${seed} run=${recorded.run.runId} kills=${recorded.run.summary.kills} wave=${recorded.run.summary.wave} `
    + `chunks=${recorded.run.chunkCount} verified=${verified.verdict} tampered=${rejected.verdict} bounded=${bounded.verdict}`,
  );
}

assert.equal(seedsProven, SEEDS.length, 'every seed must prove all four verdicts');
console.log(`replay-e2e: ${seedsProven}/${SEEDS.length} seeds proved verified+divergent+bounded under jittered pacing`);
console.log('replay-e2e: PASS');
