import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { Bot } from '../../src/game/bot';
import { Game } from '../../src/game/engine';
import { ELITE_AFFIX_META } from '../../src/game/eliteAffixes';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { decodeReplayActionBundle } from '../../src/game/replayCodec';
import { activeReplayGhosts, buildGeom, buildReplayCombatTimeline, posAtDist } from '../../src/game/replayReconstruct';
import { createReplayPlaybackDiagnostic } from '../../src/game/reSimulate';
import { REPLAY_ENGINE_VERSION, type PublicRunDoc, type RunEventChunkDoc } from '../../src/game/runTelemetry';
import { decodeRunTimeline, RunTimelineWriter, type RunTimelineEntry, type RunTimelinePack } from '../../src/game/runTimeline';

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

type ViewerRun = PublicRunDoc & { chunks: RunEventChunkDoc[] };

/** A real expert-bot Veteran run played to its gameover (~wave 15: kills AND leaks),
 *  shaped the way fetchRunReplay hands a v3 doc to the viewer. The bot reads the live
 *  board every step, so any feedback from recording into the sim changes its choices. */
function recordViewerRun(opts: { recordTimeline?: boolean } = {}): { run: ViewerRun; finalTick: number; credits: number; aliveAtEnd: string[] } {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[1], { seed: 20260925, lifetimeKills: 1_000_000 });
  if (opts.recordTimeline === false) {
    // Silence the recorder's two per-hull hooks so the timeline records nothing.
    game.recorder.recordEnemyKill = () => {};
    game.recorder.recordLeak = () => {};
  }
  game.paused = false;
  game.speed = 1;
  const bot = new Bot(game, 'expert', seededRng(4242));
  let idle = 0;
  for (let i = 0; i < 400_000 && game.phase !== 'gameover' && game.phase !== 'victory'; i++) {
    bot.act(game.time);
    if (game.phase === 'build' && (idle += 0.05) > 4) { idle = 0; game.startWave(); }
    game.update(0.05);
  }
  assert.equal(game.phase, 'gameover', 'fixture must play to a real gameover');
  const bundle = game.buildRunUploadBundle('TIMELINE', 'test-build');
  return {
    run: { ...bundle.run, chunks: bundle.chunks, events: decodeReplayActionBundle(bundle.run.actions, bundle.chunks), snapshots: [] },
    finalTick: Math.round(game.time / Game.SIM_STEP),
    credits: game.credits,
    aliveAtEnd: game.enemies.map((e) => e.def.id),
  };
}

type Kill = Extract<RunTimelineEntry, { kind: 'kill' }>;
type Leak = Extract<RunTimelineEntry, { kind: 'leak' }>;

// Filled once in `before` so importing this file does not play a whole bot game.
let recorded: ReturnType<typeof recordViewerRun>;
let run: ViewerRun;
let mismatched: ViewerRun;
let entries: RunTimelineEntry[];
let kills: Kill[];
let leaks: Leak[];

before(() => {
  recorded = recordViewerRun();
  run = recorded.run;
  mismatched = { ...run, setup: { ...run.setup, replayEngine: REPLAY_ENGINE_VERSION - 1 } };
  entries = decodeRunTimeline(run.final.timeline)?.entries ?? [];
  kills = entries.filter((e): e is Kill => e.kind === 'kill');
  leaks = entries.filter((e): e is Leak => e.kind === 'leak');
});

describe('run kill/leak timeline', () => {
  test('records every kill and leak with its tick, lane position and killer', () => {
    assert.ok(kills.length > 100 && leaks.length > 0, 'fixture must both kill and leak');
    assert.equal(kills.length, run.summary.kills, 'one record per kill');
    assert.equal(leaks.reduce((sum, e) => sum + e.coresLost, 0), run.summary.leaks, 'leak records carry the cores lost');

    const runEnd = (run.events ?? []).find((e) => e.type === 'run_end');
    assert.ok(runEnd, 'fixture records its run_end');
    const pathLen = buildGeom(ALL_MAPS[0].path).len;
    for (let i = 1; i < entries.length; i++) assert.ok(entries[i].tick >= entries[i - 1].tick, 'ticks never go backwards');
    assert.equal(leaks[leaks.length - 1].tick, runEnd.simTick, 'the leak that ended the run is on the run_end tick');
    assert.ok(entries[entries.length - 1].tick <= runEnd.simTick, 'no record after the run ended');
    // Split children spawn a few px off the lane, so their walked distance can run a
    // hair past the path length before they leak.
    assert.ok(entries.every((e) => e.dist >= 0 && e.dist <= pathLen + 24), 'positions lie on the lane');

    const placed = new Set((run.events ?? []).filter((e) => e.type === 'tower_place').map((e) => e.towerUid));
    const attributed = kills.filter((e) => e.towerUid != null);
    assert.ok(attributed.length >= kills.length * 0.9, `most kills name their tower (${attributed.length}/${kills.length})`);
    assert.ok(attributed.every((e) => placed.has(e.towerUid)), 'every named killer is a tower the run placed');
  });

  test('recording it does not change the run', () => {
    const silent = recordViewerRun({ recordTimeline: false });
    assert.equal(silent.run.final.timeline?.count, 0, 'the silenced run records nothing');
    assert.deepEqual(silent.run.summary, run.summary, 'summary changed with recording on');
    // Per-tower damage is the sensitive fingerprint: any tweak to tower or hull state
    // (veterancy, hp, position) shifts it even when every hull still dies.
    const { timeline: _on, ...finalOn } = run.final;
    const { timeline: _off, ...finalOff } = silent.run.final;
    assert.deepEqual(finalOff, finalOn, 'damage/kill ledgers changed with recording on');
    assert.equal(silent.run.manifest.actionHash, run.manifest.actionHash, 'bot actions/ticks changed with recording on');
    assert.equal(silent.finalTick, recorded.finalTick, 'gameover tick changed with recording on');
    assert.equal(silent.credits, recorded.credits, 'credits changed with recording on');
  });
});

describe('cosmetic playback of an engine-mismatched run', () => {
  test('only a version-mismatched run takes the cosmetic path', () => {
    assert.ok(createReplayPlaybackDiagnostic(run).playback, 'a current-engine run stays frame-accurate');
    const diag = createReplayPlaybackDiagnostic(mismatched);
    assert.equal(diag.playback, null);
    assert.match(diag.reason ?? '', /engine version mismatch/);
  });

  test('hulls die at the recorded tick and lane position, shot by the recorded tower', () => {
    const timeline = buildReplayCombatTimeline(mismatched);
    assert.equal(timeline.authoritativeDeaths, true);
    const deaths = new Map<string, number>();
    const key = (kind: string, enemyId: string, tick: number, dist: number, tower: number | null) => `${kind}|${enemyId}|${tick}|${dist}|${tower}`;
    for (const rec of timeline.effects) {
      const k = key(rec.endKind ?? '', rec.def.id, Math.round((rec.endT ?? 0) * 60), rec.endDist ?? -1, rec.sourceTowerUid ?? null);
      deaths.set(k, (deaths.get(k) ?? 0) + 1);
    }
    assert.equal(timeline.effects.length, entries.length, 'every recorded death plays back exactly once');
    for (const e of entries) {
      const k = key(e.kind, e.enemyId, e.tick, e.dist, e.kind === 'kill' ? e.towerUid : null);
      const left = deaths.get(k) ?? 0;
      assert.ok(left > 0, `recorded ${e.kind} of ${e.enemyId} at tick ${e.tick} did not play back`);
      deaths.set(k, left - 1);
    }

    // The hull is on the board right before its recorded death, at that spot, and gone after.
    const geom = buildGeom(ALL_MAPS[0].path);
    const kill = kills[Math.floor(kills.length / 2)];
    const t = kill.tick / 60;
    const rec = timeline.effects.find((r) => r.endKind === 'kill' && Math.round((r.endT ?? 0) * 60) === kill.tick && r.endDist === kill.dist)!;
    const before = activeReplayGhosts(geom, timeline, t - 0.05, false).find((g) => g.uid === rec.uid);
    assert.ok(before, 'the hull is visible just before it dies');
    const spot = posAtDist(geom, kill.dist);
    assert.ok(Math.hypot(before.x - spot.x, before.y - spot.y) <= rec.def.speed * 0.05 + 2, 'it dies where the run recorded');
    assert.equal(activeReplayGhosts(geom, timeline, t, false).some((g) => g.uid === rec.uid), false, 'and is gone at the death tick');
  });

  test('planned hulls are not stranded behind younger ones', () => {
    // A slowed hull is always behind its unslowed prediction. If a death goes to a
    // younger hull instead, the older one is never ended and walks the lane forever.
    // The only hulls allowed to outlive their traversal are ones the real run still
    // had on the board at gameover.
    const timeline = buildReplayCombatTimeline(mismatched);
    const pathLen = buildGeom(ALL_MAPS[0].path).len;
    const runEndT = (run.events ?? []).find((e) => e.type === 'run_end')!.simTick / 60;
    const alive = new Map<string, number>();
    for (const id of recorded.aliveAtEnd) alive.set(id, (alive.get(id) ?? 0) + 1);
    const stranded: string[] = [];
    for (const r of timeline.enemies) {
      if (r.endT != null) continue;
      const speed = r.def.speed * (r.elite ? ELITE_AFFIX_META[r.elite].speedMult : 1);
      if (r.spawnT + (pathLen - r.spawnDist) / speed >= runEndT) continue;
      const left = alive.get(r.def.id) ?? 0;
      if (left > 0) alive.set(r.def.id, left - 1);
      else stranded.push(`${r.def.id} (wave ${r.wave}, spawned ${r.spawnT.toFixed(1)}s)`);
    }
    assert.deepEqual(stranded, [], 'hulls finished their traversal before run end but never died');
  });

  test('a run recorded before the timeline shipped still loads with the old stream', () => {
    const { timeline: _dropped, ...finalWithout } = mismatched.final;
    const legacy: ViewerRun = { ...mismatched, final: finalWithout };
    const timeline = buildReplayCombatTimeline(legacy);
    assert.equal(timeline.authoritativeDeaths, false);
    assert.ok(timeline.enemies.length > 0, 'planned spawns still stream down the lane');
    assert.equal(timeline.effects.length, 0, 'no deaths are invented without a record');

    const garbled: ViewerRun = { ...mismatched, final: { ...finalWithout, timeline: { codec: 't1', count: 9, enemyIds: ['scout'], data: '!!' } } };
    assert.doesNotThrow(() => buildReplayCombatTimeline(garbled));
  });
});

describe('decoding an untrusted timeline', () => {
  const twoKills = (): RunTimelinePack => {
    const w = new RunTimelineWriter();
    w.kill(60, 'scout', 400, 3);
    w.kill(90, 'scout', 480, null);
    return w.pack();
  };

  test("an enemy id that only exists on Object.prototype never reaches playback", () => {
    // ENEMIES is a plain object, so ENEMIES['constructor'] is truthy. A crafted doc
    // naming it used to hand the renderer a def with no glow and crash playback.
    const crafted = { ...twoKills(), enemyIds: ['constructor'] };
    assert.deepEqual(decodeRunTimeline(crafted)?.entries, []);
    const doc: ViewerRun = { ...mismatched, final: { ...mismatched.final, timeline: crafted } };
    assert.equal(buildReplayCombatTimeline(doc).effects.length, 0);
  });

  test('a count larger than the data yields only the records present', () => {
    const entries = decodeRunTimeline({ ...twoKills(), count: 99 })?.entries ?? [];
    assert.deepEqual(entries.map((e) => [e.tick, e.dist]), [[60, 400], [90, 480]]);
  });

  test('a timeline cut at the size cap says where it stops', () => {
    const w = new RunTimelineWriter();
    for (let i = 0; i < 200_000; i++) w.kill(Math.floor(i / 200), 'scout', 400, 1);
    const pack = w.pack();
    assert.equal(pack.truncated, true);
    const decoded = decodeRunTimeline(pack);
    assert.equal(decoded?.truncated, true);
    assert.equal(decoded?.entries.length, pack.count);
    const doc: ViewerRun = { ...mismatched, final: { ...mismatched.final, timeline: pack } };
    assert.equal(typeof buildReplayCombatTimeline(doc).timelineCutWave, 'number');
    assert.equal(buildReplayCombatTimeline(mismatched).timelineCutWave, undefined, 'a complete record names no cut');
  });
});
