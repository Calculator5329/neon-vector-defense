import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Bot } from '../../src/game/bot';
import { dailyChallengeForDate } from '../../src/game/dailyChallenge';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import { reSimulate, setBalanceDoc } from '../../src/game/reSimulate';
import { buildRunManifest, type RunUploadBundle } from '../../src/game/runTelemetry';
import { weeklyChallengeForId } from '../../src/game/weeklyChallenge';
import { decodeReplayActionBundle, encodeReplayActions } from '../../src/game/replayCodec';
import { progress } from '../../src/game/storage';
import { TOWER_MAP, TOWERS } from '../../src/game/towers';

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

function cloneBundle(bundle: RunUploadBundle): RunUploadBundle {
  return JSON.parse(JSON.stringify(bundle)) as RunUploadBundle;
}

function runSeededBotCampaign(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 123, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.autoNext = true;
  const bot = new Bot(game, 'standard', seededRng(5));
  game.startWave();
  for (let i = 0; i < 20_000 && game.wave <= 5 && game.phase !== 'gameover'; i++) {
    bot.act(game.time);
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  return game.buildRunUploadBundle('RESIM', 'test-build');
}

function runSeededRecalibrateCampaign(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 223, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.autoNext = true;
  const bot = new Bot(game, 'standard', seededRng(10));
  game.startWave();
  let cast = false;
  for (let i = 0; i < 120_000 && game.wave <= 28 && game.phase !== 'gameover' && game.phase !== 'victory'; i++) {
    bot.act(game.time);
    if (!cast && game.wave >= 28 && game.phase === 'build' && game.abilityReady('recalibrate')) {
      game.castAbility('recalibrate');
      cast = true;
    }
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  if (!cast && game.abilityReady('recalibrate')) game.castAbility('recalibrate');
  return game.buildRunUploadBundle('RESIM', 'test-build');
}

function runSeededBotDaily(): RunUploadBundle {
  const challenge = dailyChallengeForDate('2026-06-01');
  const map = ALL_MAPS.find((candidate) => candidate.id === challenge.mapId) ?? ALL_MAPS[0];
  const diff = DIFFICULTIES.find((candidate) => candidate.id === challenge.diffId) ?? DIFFICULTIES[1];
  const game = new Game(map, diff, { seed: 987, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.startDailyChallenge(challenge);
  const bot = new Bot(game, 'standard', seededRng(6));
  game.startWave();
  for (let i = 0; i < 20_000 && game.wave <= 3 && game.phase !== 'gameover'; i++) {
    bot.act(game.time);
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  return game.buildRunUploadBundle('DAILY', 'test-build');
}

function runSeededBotWeekly(): RunUploadBundle {
  const challenge = weeklyChallengeForId('weekly-2026-W27')!;
  const map = ALL_MAPS.find((candidate) => candidate.id === challenge.mapId) ?? ALL_MAPS[0];
  const diff = DIFFICULTIES.find((candidate) => candidate.id === challenge.diffId) ?? DIFFICULTIES[1];
  const game = new Game(map, diff, { seed: 654, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.startWeeklyChallenge(challenge);
  const bot = new Bot(game, 'standard', seededRng(7));
  game.startWave();
  for (let i = 0; i < 20_000 && game.wave <= 3 && game.phase !== 'gameover'; i++) {
    bot.act(game.time);
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  return game.buildRunUploadBundle('WEEKLY', 'test-build');
}

function runVeteranDeployStyleActions(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 77, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.credits = 20_000;
  game.recorder.setStartingResources(game.credits, game.lives);
  for (const [id, upgrades] of [['pulse', 4], ['tesla', 3]] as const) {
    const def = TOWER_MAP[id];
    let placed = false;
    for (let y = 40; y < 680 && !placed; y += 28) {
      for (let x = 40; x < 1240 && !placed; x += 28) {
        if (!game.canPlace({ x, y })) continue;
        const tower = game.placeTower(def, { x, y });
        if (!tower) continue;
        for (let i = 0; i < upgrades; i++) game.upgradeTower(tower, (i % 2) as 0 | 1);
        placed = true;
      }
    }
    assert.equal(placed, true);
  }
  game.startWave();
  for (let i = 0; i < 20_000 && game.wave <= 4 && game.phase !== 'gameover'; i++) {
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  return game.buildRunUploadBundle('VET', 'test-build');
}

function firstPlaceable(game: Game): { x: number; y: number } {
  for (let y = 40; y < 680; y += 28) {
    for (let x = 40; x < 1240; x += 28) {
      if (game.canPlace({ x, y })) return { x, y };
    }
  }
  throw new Error('no placeable cell found');
}

function runTargetFilterShredActions(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 404, lifetimeKills: 1_000_000 });
  game.paused = false;
  game.speed = 4;
  game.credits = 15_000;
  game.recorder.setStartingResources(game.credits, game.lives);
  const rail = game.placeTower(TOWER_MAP.rail, firstPlaceable(game));
  assert.ok(rail);
  assert.equal(game.upgradeTower(rail, 0), true, 'AP Slugs should apply shred/Exposed');
  game.setTargetFilter(rail, 'armored', true);
  game.startWave();
  for (let i = 0; i < 30_000 && game.wave <= 4 && game.phase !== 'gameover'; i++) {
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  const bundle = game.buildRunUploadBundle('FILTER', 'test-build');
  const events = allEvents(bundle);
  assert.ok(events.some((event) => event.type === 'target_filter'));
  assert.ok(events.some((event) => event.type === 'tower_upgrade'));
  assert.ok(bundle.run.final.damageByTower.rail > 0);
  return bundle;
}

function buildHighEndDefense(game: Game, limit: number): void {
  const ids = ['prismarr', 'gauss', 'sunspear', 'tesla', 'rail', 'missile', 'cryo', 'emp', 'watchfire', 'abyss', 'siphon', 'lure'] as const;
  let idx = 0;
  for (let y = 40; y < 680 && idx < limit; y += 56) {
    for (let x = 40; x < 1240 && idx < limit; x += 56) {
      if (!game.canPlace({ x, y })) continue;
      const tower = game.placeTower(TOWER_MAP[ids[idx % ids.length]], { x, y });
      if (!tower) continue;
      for (let i = 0; i < 6; i++) game.upgradeTower(tower, 0);
      for (let i = 0; i < 4; i++) game.upgradeTower(tower, 1);
      idx++;
    }
  }
}

function runDeepFreeplayChoices(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], {
    seed: 13579,
    lifetimeKills: 0,
    availableTowerIds: TOWERS.map((tower) => tower.id),
  });
  game.paused = false;
  game.speed = 4;
  game.credits = 500_000;
  game.recorder.setStartingResources(game.credits, game.lives);
  buildHighEndDefense(game, 36);
  let acceptedRisk = false;
  game.startWave();
  for (let i = 0; i < 500_000 && game.phase !== 'gameover'; i++) {
    if (game.phase === 'victory' && !game.freeplay) {
      game.enterFreeplay('leanGrid');
      game.startWave();
    } else if (game.phase === 'build') {
      if (game.freeplayState.nextRelicOffer.length > 0) game.chooseRelic(game.freeplayState.nextRelicOffer[0].id);
      if (game.freeplayState.riskOffer && game.acceptRisk(game.freeplayState.riskOffer.id)) {
        acceptedRisk = true;
        break;
      }
      game.startWave();
    }
    game.update(0.05);
  }
  assert.equal(acceptedRisk, true, 'fixture should accept a freeplay risk packet');
  return game.buildRunUploadBundle('FREEPLAY', 'test-build');
}

function runEliteUmbraLeakThrough(): RunUploadBundle {
  const game = new Game(ALL_MAPS[0], DIFFICULTIES[3], {
    seed: 24680,
    lifetimeKills: 0,
    availableTowerIds: TOWERS.map((tower) => tower.id),
  });
  game.paused = false;
  game.speed = 4;
  game.lives = 1_000_000;
  game.startingLives = game.lives;
  game.recorder.setStartingResources(game.credits, game.lives);
  game.startWave();
  for (let i = 0; i < 800_000 && game.phase !== 'gameover' && game.phase !== 'victory'; i++) {
    if (game.phase === 'build') game.startWave();
    game.update(0.05);
  }
  return game.buildRunUploadBundle('UMBRA', 'test-build');
}

function allEvents(bundle: RunUploadBundle) {
  return decodeReplayActionBundle(bundle.run.actions, bundle.chunks);
}

function replaceRootActions(bundle: RunUploadBundle, events: ReturnType<typeof allEvents>): void {
  const rootCount = bundle.run.actions.count;
  bundle.run.actions = encodeReplayActions(events.slice(0, rootCount), { towerIds: bundle.run.actions.towerIds });
  bundle.chunks = bundle.chunks.map((chunk, i) => ({
    ...chunk,
    actions: encodeReplayActions(events.slice(rootCount + i * 650, rootCount + (i + 1) * 650), { towerIds: bundle.run.actions.towerIds }),
  }));
  bundle.run.manifest = buildRunManifest(bundle.run.actions, bundle.chunks);
}

afterEach(() => {
  progress.reset();
});

describe('reSimulate', () => {
  test('verifies a seeded public campaign run', () => {
    const bundle = runSeededBotCampaign();
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
  });

  test('verifies a seeded daily challenge run', () => {
    const bundle = runSeededBotDaily();
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
    assert.equal(result.summary?.daily, 'daily-2026-06-01');
  });

  test('verifies a seeded weekly mutation run', () => {
    const bundle = runSeededBotWeekly();
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
    assert.equal(result.summary?.weekly, 'weekly-2026-W27');
    assert.ok(bundle.run.setup.weekly);
  });

  test('verifies replayed veteran-deploy-style place and upgrade actions', () => {
    const bundle = runVeteranDeployStyleActions();
    assert.ok(allEvents(bundle).some((event) => event.type === 'tower_upgrade'));
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
  });

  test('verifies a seeded run with target_filter actions and shred usage', () => {
    const bundle = runTargetFilterShredActions();
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
  });

  test('verifies a deep freeplay run with relic and risk choices', () => {
    const bundle = runDeepFreeplayChoices();
    const events = allEvents(bundle);
    assert.equal(bundle.run.summary.freeplay, true);
    assert.ok(bundle.run.summary.wave >= 61);
    assert.ok(events.some((event) => event.type === 'freeplay_relic_select'));
    assert.ok(events.some((event) => event.type === 'freeplay_risk_accept'));
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
  });

  test('verifies a run containing elite wave metadata and the Umbra boss', () => {
    const bundle = runEliteUmbraLeakThrough();
    assert.equal(bundle.run.summary.wave, 80);
    assert.ok(allEvents(bundle).some((event) => event.type === 'wave_start'));
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
  });

  test('flags a tampered summary as divergent', () => {
    const bundle = cloneBundle(runSeededBotCampaign());
    bundle.run.summary.kills += 1;
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'divergent');
    assert.equal(result.divergence?.field, 'kills');
  });

  test('flags a tampered player action as divergent', () => {
    const bundle = cloneBundle(runSeededBotCampaign());
    const events = allEvents(bundle);
    const event = events.find((candidate) => candidate.type === 'tower_place');
    assert.ok(event);
    event.x = 640;
    event.y = 360;
    replaceRootActions(bundle, events);
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'divergent');
    assert.match(result.reason ?? '', /placement|summary/);
  });

  test('flags a tampered target_filter action as divergent', () => {
    const bundle = cloneBundle(runTargetFilterShredActions());
    const events = allEvents(bundle);
    const event = events.find((candidate) => candidate.type === 'target_filter');
    assert.ok(event);
    event.towerUid = 999_999;
    replaceRootActions(bundle, events);
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'divergent');
    assert.match(result.reason ?? '', /target filter/);
  });

  test('flags tampered encoded actions with a stale manifest as unverifiable', () => {
    const bundle = cloneBundle(runSeededBotCampaign());
    bundle.run.actions.data = `${bundle.run.actions.data}0`;
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'unverifiable');
    assert.match(result.reason ?? '', /hash|decode|count/);
  });

  test('re-verifies from its embedded balance snapshot after live balance changes', () => {
    setBalanceDoc({ version: 'live-test-1', towers: { pulse: { damageMult: 1.15 } } });
    try {
      const bundle = runSeededBotCampaign();
      assert.equal(bundle.run.setup.balanceVersion, 'live-test-1');
      assert.ok(bundle.run.setup.balance);
      // Same balance injected at verify time → fully verifiable.
      assert.equal(reSimulate(bundle).verdict, 'verified');
      // Balance doc gone (or a different version published) → the engine math
      // no longer matches the recording; must be unverifiable, never divergent.
      setBalanceDoc(null);
      assert.equal(reSimulate(bundle).verdict, 'verified');
      setBalanceDoc({ version: 'live-test-2' });
      assert.equal(reSimulate(bundle).verdict, 'verified');
    } finally {
      setBalanceDoc(null);
    }
  });

  test('marks runs recorded under a different engine behavior as unverifiable', () => {
    const bundle = cloneBundle(runSeededBotCampaign());
    bundle.run.setup.replayEngine = (bundle.run.setup.replayEngine ?? 1) - 1;
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'unverifiable');
    assert.match(result.reason ?? '', /engine mismatch/);
  });

  test('verifies r3 ability_cast actions for Recalibrate', () => {
    const bundle = runSeededRecalibrateCampaign();
    const events = allEvents(bundle);
    assert.ok(events.some((event) => event.type === 'ability_cast' && event.abilityId === 'recalibrate'));
    const result = reSimulate(bundle);
    assert.equal(result.verdict, 'verified');
  });

  test('treats identity-balance runs as verifiable only under identity balance', () => {
    const bundle = runSeededBotCampaign();
    assert.equal(bundle.run.setup.balanceVersion, 'test-build');
    assert.equal(reSimulate(bundle).verdict, 'verified');
    setBalanceDoc({ version: 'published-later' });
    try {
      const result = reSimulate(bundle);
      assert.equal(result.verdict, 'unverifiable');
      assert.match(result.reason ?? '', /balance/);
    } finally {
      setBalanceDoc(null);
    }
  });
});
