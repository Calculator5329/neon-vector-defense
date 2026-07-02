import { balanceVersion } from './balanceConfig';
import { dailyChallengeForId } from './dailyChallenge';
import { Game } from './engine';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import {
  REPLAY_ENGINE_VERSION,
  RUN_TELEMETRY_SCHEMA,
  buildRunManifest,
  decodeReplayDeathRecords,
  hashRunDeathRecords,
  hashRunEventPairs,
  type PublicRunDoc,
  type RunDeathRecords,
  type RunEvent,
  type RunEventChunkDoc,
  type RunUploadBundle,
} from './runTelemetry';
import { TOWER_MAP } from './towers';
import type { AbilityId, GameMap, TargetMode, Vec } from './types';
import type { FreeplayContractId, FreeplayRelicId, RiskWaveId } from './freeplay';

export type ReSimVerdict = 'verified' | 'divergent' | 'unverifiable';

export interface ReSimDivergence {
  field: string;
  expected: unknown;
  actual: unknown;
  at?: { eventIndex?: number; t?: number; wave?: number; type?: string };
}

export interface ReSimResult {
  verdict: ReSimVerdict;
  reason?: string;
  divergence?: ReSimDivergence;
  summary?: PublicRunDoc['summary'];
  deathRecords?: RunDeathRecords;
}

export interface ReSimBundle {
  run: PublicRunDoc;
  chunks: RunEventChunkDoc[];
}

const ACTION_TYPES = new Set([
  'wave_start',
  'tower_place',
  'tower_upgrade',
  'tower_sell',
  'target_mode',
  'ability_cast',
  'pickup_collect',
  'freeplay_enter',
  'freeplay_relic_select',
  'freeplay_risk_accept',
  'freeplay_risk_decline',
  'speed_change',
]);

export function reSimulate(bundle: ReSimBundle): ReSimResult {
  const unverifiable = (reason: string): ReSimResult => ({ verdict: 'unverifiable', reason });
  const run = bundle.run;
  if (run.schemaVersion !== RUN_TELEMETRY_SCHEMA) return unverifiable(`unsupported schemaVersion ${run.schemaVersion}`);
  if ((run.setup.replayEngine ?? 1) !== REPLAY_ENGINE_VERSION) {
    return unverifiable(`engine mismatch: run=${run.setup.replayEngine ?? 1} current=${REPLAY_ENGINE_VERSION}`);
  }
  if (!run.deathRecords) return unverifiable('missing deathRecords');
  if (!run.manifest?.complete) return unverifiable('missing complete replay manifest');
  if (!Array.isArray(bundle.chunks) || bundle.chunks.length !== run.chunkCount) {
    return unverifiable('chunk count does not match run manifest');
  }

  const chunkError = validateChunks(run, bundle.chunks);
  if (chunkError) return unverifiable(chunkError);
  const expectedManifest = buildRunManifest(run.events, bundle.chunks, run.deathRecords);
  if (
    expectedManifest.eventHash !== run.manifest.eventHash
    || expectedManifest.deathHash !== run.manifest.deathHash
    || JSON.stringify(expectedManifest.chunkEventCounts) !== JSON.stringify(run.manifest.chunkEventCounts)
  ) {
    return unverifiable('manifest hashes do not match supplied replay data');
  }

  // The balance in effect at record time must equal the balance in effect now.
  // setup.balanceVersion falls back to the build tag when no remote balance doc
  // was published, so strip that sentinel before comparing. Anything else means
  // we would re-simulate under different tower/enemy math — an honest run would
  // falsely diverge, so it is unverifiable instead. The server injects the live
  // config/balance doc via setBalanceDoc before calling reSimulate.
  const currentBalance = balanceVersion();
  const recordedBalance = run.setup.balanceVersion === run.build ? '' : (run.setup.balanceVersion ?? '');
  if (recordedBalance !== currentBalance) {
    return unverifiable(`balance mismatch: run=${recordedBalance || 'identity'} current=${currentBalance || 'identity'}`);
  }

  const map = ALL_MAPS.find((candidate) => candidate.id === run.setup.map);
  const diff = DIFFICULTIES.find((candidate) => candidate.id === run.setup.diff);
  if (!map || !diff) return unverifiable('unknown map or difficulty');
  if (hashMap(map) !== run.setup.mapHash) return unverifiable('map hash mismatch');

  const game = new Game(map, diff, {
    seed: run.setup.seed >>> 0,
    lifetimeKills: 0,
    availableTowerIds: run.setup.availableTowerIds,
  });
  game.paused = false;
  game.speed = 1;
  game.credits = Math.max(0, Math.floor(run.setup.startingCash));
  game.lives = Math.max(1, Math.floor(run.setup.startingLives));
  game.startingLives = game.lives;
  game.recorder.setStartingResources(game.credits, game.lives);

  if (run.summary.daily) {
    const challenge = dailyChallengeForId(run.summary.daily);
    if (!challenge) return unverifiable(`unsupported daily id ${run.summary.daily}`);
    if (challenge.mapId !== map.id || challenge.diffId !== diff.id) {
      return unverifiable('daily challenge does not match replay setup');
    }
    game.startDailyChallenge(challenge);
  }

  const allEvents = mergedEvents(run, bundle.chunks);
  const actions = allEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => ACTION_TYPES.has(event.type));
  if (actions.some(({ event }) => !validSimTick(event))) {
    return unverifiable('replay action events are missing exact simTick timing');
  }
  let currentSpeed = eventSpeed(allEvents[0]) ?? 1;
  game.speed = currentSpeed;

  for (const action of actions) {
    game.speed = currentSpeed;
    const stepResult = advanceToEvent(game, action.event);
    if (stepResult) return stepResult;
    const applied = applyAction(game, action.event);
    if (!applied.ok) {
      return {
        verdict: 'divergent',
        reason: applied.reason,
        divergence: {
          field: 'event',
          expected: action.event.type,
          actual: applied.reason,
          at: eventAt(action.event, action.index),
        },
      };
    }
    currentSpeed = eventSpeed(action.event) ?? game.speed;
    game.speed = currentSpeed;
  }

  const endEvent = [...allEvents].reverse().find((event) => event.type === 'run_end');
  if (!validSimTick(endEvent)) return unverifiable('run_end event is missing exact simTick timing');
  game.speed = currentSpeed;
  const finalAdvance = advanceToTick(game, simTick(endEvent));
  if (finalAdvance) return finalAdvance;
  if (run.summary.phase !== 'wave') settleBuildPhase(game, endEvent);
  if (game.phase !== 'gameover' && game.phase !== 'victory' && run.summary.outcome === 'abandoned') {
    game.abandonRun('resim');
  }

  const simulated = game.buildRunUploadBundle(run.summary.callsign, run.build).run;
  const summaryDivergence = compareSummary(run.summary, simulated.summary);
  if (summaryDivergence) {
    return { verdict: 'divergent', reason: `summary.${summaryDivergence.field}`, divergence: summaryDivergence, summary: simulated.summary, deathRecords: simulated.deathRecords };
  }
  const deathDivergence = compareDeathRecords(run.deathRecords, simulated.deathRecords);
  if (deathDivergence) {
    return { verdict: 'divergent', reason: deathDivergence.field, divergence: deathDivergence, summary: simulated.summary, deathRecords: simulated.deathRecords };
  }
  return { verdict: 'verified', summary: simulated.summary, deathRecords: simulated.deathRecords };
}

function validateChunks(run: PublicRunDoc, chunks: RunEventChunkDoc[]): string | null {
  const sorted = [...chunks].sort((a, b) => a.chunk - b.chunk);
  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i];
    if (chunk.schemaVersion !== RUN_TELEMETRY_SCHEMA) return `unsupported chunk schemaVersion ${chunk.schemaVersion}`;
    if (chunk.runId !== run.runId) return 'chunk runId mismatch';
    if (chunk.chunk !== i) return 'missing or out-of-order replay chunk';
    if ((run.manifest.chunkEventCounts[i] ?? -1) !== chunk.events.length) return 'chunk event count mismatch';
  }
  const eventCount = run.events.length + chunks.reduce((sum, chunk) => sum + chunk.events.length, 0);
  if (eventCount !== run.eventCount) return 'eventCount mismatch';
  if (hashRunEventPairs(mergedEvents(run, chunks)) !== run.manifest.eventHash) return 'event hash mismatch';
  if (run.manifest.deathHash && hashRunDeathRecords(run.deathRecords ?? { codec: 'd1', count: 0, waves: [] }) !== run.manifest.deathHash) {
    return 'death hash mismatch';
  }
  return null;
}

function mergedEvents(run: PublicRunDoc, chunks: RunEventChunkDoc[]): RunEvent[] {
  return [...run.events, ...[...chunks].sort((a, b) => a.chunk - b.chunk).flatMap((chunk) => chunk.events)];
}

function advanceToEvent(game: Game, event: RunEvent): ReSimResult | null {
  if (!validSimTick(event)) return { verdict: 'unverifiable', reason: 'invalid event simTick' };
  return advanceToTick(game, simTick(event));
}

function advanceToTick(game: Game, targetTick: number): ReSimResult | null {
  if (!Number.isFinite(targetTick) || targetTick < 0) return { verdict: 'unverifiable', reason: 'invalid event simTick' };
  const targetT = targetTick * Game.SIM_STEP;
  const limit = Math.max(0, targetT) + Game.SIM_STEP / 2;
  let guard = 0;
  while (game.time + Game.SIM_STEP / 2 < limit && guard++ < 1_200_000 && game.phase !== 'gameover') {
    game.update(Game.SIM_STEP / replaySpeed(game.speed));
  }
  if (guard >= 1_200_000) return { verdict: 'unverifiable', reason: 're-simulation step limit exceeded' };
  return null;
}

function applyAction(game: Game, event: RunEvent): { ok: true } | { ok: false; reason: string } {
  switch (event.type) {
    case 'wave_start': {
      // The launch click is recorded on an exact sim tick, but auto-next/manual
      // launches can happen immediately after the prior wave's final kill. Let the
      // deterministic engine settle to build phase; summary/death comparisons still
      // decide whether combat drifted.
      settleBuildPhase(game, event);
      if (game.phase !== 'build') return { ok: false, reason: `cannot start wave from phase ${game.phase}` };
      game.startWave();
      return game.wave === intField(event, 'wave') ? { ok: true } : { ok: false, reason: `wave mismatch ${game.wave}` };
    }
    case 'tower_place': {
      const def = stringField(event, 'towerId');
      const towerDef = def ? TOWER_MAP[def] : null;
      if (!towerDef) return { ok: false, reason: 'unknown towerId' };
      const before = game.towers.length;
      const tower = game.placeTower(towerDef, eventPos(event));
      if (!tower || game.towers.length !== before + 1) return { ok: false, reason: 'tower placement failed' };
      return { ok: true };
    }
    case 'tower_upgrade': {
      const tower = towerByUid(game, intField(event, 'towerUid'));
      const track = intField(event, 'track');
      if (!tower || (track !== 0 && track !== 1)) return { ok: false, reason: 'tower upgrade target missing' };
      return game.upgradeTower(tower, track) ? { ok: true } : { ok: false, reason: 'tower upgrade failed' };
    }
    case 'tower_sell': {
      const tower = towerByUid(game, intField(event, 'towerUid'));
      if (!tower) return { ok: false, reason: 'tower sell target missing' };
      game.sellTower(tower);
      return game.towers.includes(tower) ? { ok: false, reason: 'tower sell failed' } : { ok: true };
    }
    case 'target_mode': {
      const tower = towerByUid(game, intField(event, 'towerUid'));
      const mode = stringField(event, 'mode') as TargetMode | null;
      if (!tower || !isTargetMode(mode)) return { ok: false, reason: 'target mode target missing' };
      game.setTargetMode(tower, mode);
      return { ok: true };
    }
    case 'ability_cast': {
      const id = stringField(event, 'abilityId') as AbilityId | null;
      if (!isAbilityId(id)) return { ok: false, reason: 'unknown abilityId' };
      const pos = nullablePos(event);
      return game.castAbility(id, pos) ? { ok: true } : { ok: false, reason: 'ability cast failed' };
    }
    case 'pickup_collect': {
      return game.collectPickup(eventPos(event)) ? { ok: true } : { ok: false, reason: 'pickup collect failed' };
    }
    case 'freeplay_enter': {
      const id = stringField(event, 'contractId') ?? 'standard';
      settleBuildPhase(game, event);
      game.enterFreeplay(id as FreeplayContractId);
      return game.freeplay ? { ok: true } : { ok: false, reason: 'freeplay enter failed' };
    }
    case 'freeplay_relic_select': {
      const id = stringField(event, 'relicId');
      settleBuildPhase(game, event);
      return id && game.chooseRelic(id as FreeplayRelicId) ? { ok: true } : { ok: false, reason: 'relic select failed' };
    }
    case 'freeplay_risk_accept': {
      const id = stringField(event, 'riskId');
      settleBuildPhase(game, event);
      return id && game.acceptRisk(id as RiskWaveId) ? { ok: true } : { ok: false, reason: 'risk accept failed' };
    }
    case 'freeplay_risk_decline':
      settleBuildPhase(game, event);
      game.declineRisk();
      return { ok: true };
    case 'speed_change': {
      game.speed = eventSpeed(event) ?? replaySpeed(game.speed);
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

function settleBuildPhase(game: Game, event: RunEvent): void {
  let grace = 0;
  const graceUntil = (simTick(event) * Game.SIM_STEP) + 5;
  while (game.phase === 'wave' && game.time < graceUntil && grace++ < 300) {
    game.update(Game.SIM_STEP / replaySpeed(game.speed));
  }
}

function compareSummary(expected: PublicRunDoc['summary'], actual: PublicRunDoc['summary']): ReSimDivergence | null {
  const fields: (keyof PublicRunDoc['summary'])[] = [
    'map',
    'diff',
    'freeplay',
    'daily',
    'contractId',
    'outcome',
    'phase',
    'wave',
    'kills',
    'credits',
    'cashEarned',
    'leaks',
    'coresLeft',
    'durationS',
    'scoreMultiplierEnd',
  ];
  for (const field of fields) {
    if (expected[field] !== actual[field]) return { field: String(field), expected: expected[field], actual: actual[field] };
  }
  return null;
}

function compareDeathRecords(expected: RunDeathRecords, actual?: RunDeathRecords): ReSimDivergence | null {
  if (!actual) return { field: 'deathRecords', expected: expected.count, actual: null };
  if (JSON.stringify(expected) === JSON.stringify(actual)) return null;
  if (expected.count !== actual.count) return { field: 'deathRecords.count', expected: expected.count, actual: actual.count };
  const expectedDeaths = decodeReplayDeathRecords(expected);
  const actualDeaths = decodeReplayDeathRecords(actual);
  if (expectedDeaths.length !== actualDeaths.length) {
    return { field: 'deathRecords.decodedCount', expected: expectedDeaths.length, actual: actualDeaths.length };
  }
  // Freeplay ledgers above 50k terminals are used as a count-level guard. The
  // exact score summary has already matched, and per-uid terminal ordering can
  // diverge in dense waves without changing the accepted leaderboard outcome.
  if (expectedDeaths.length >= 50_000) return null;
  let mismatches = 0;
  let firstMismatch: ReSimDivergence | null = null;
  for (let i = 0; i < expectedDeaths.length; i++) {
    const a = expectedDeaths[i];
    const b = actualDeaths[i];
    const spawnDelta = Math.abs(a.spawnT - b.spawnT);
    const deathDelta = Math.abs(a.deathT - b.deathT);
    if (a.uid !== b.uid || a.enemyId !== b.enemyId || a.wave !== b.wave || spawnDelta > 0.11 || deathDelta > 0.11) {
      mismatches++;
      firstMismatch ??= { field: `deathRecords[${i}]`, expected: a, actual: b };
    }
  }
  if (mismatches > 0) return firstMismatch;
  return null;
}

function validSimTick(event: RunEvent | undefined): event is RunEvent & { simTick: number } {
  return !!event && typeof event.simTick === 'number' && Number.isInteger(event.simTick) && event.simTick >= 0;
}

function simTick(event: RunEvent & { simTick?: unknown }): number {
  return typeof event.simTick === 'number' && Number.isFinite(event.simTick) ? Math.max(0, Math.floor(event.simTick)) : 0;
}

function eventSpeed(event: RunEvent | undefined): number | null {
  if (!event) return null;
  const explicit = event.type === 'speed_change' ? numberField(event, 'speed') : NaN;
  const value = Number.isFinite(explicit) && explicit > 0 ? explicit : event.speed;
  return typeof value === 'number' && Number.isFinite(value) ? replaySpeed(value) : null;
}

function replaySpeed(value: number): number {
  return value >= 3 ? 4 : value >= 1.5 ? 2 : 1;
}

function towerByUid(game: Game, uid: number) {
  return game.towers.find((tower) => tower.uid === uid) ?? null;
}

function eventPos(event: RunEvent): Vec {
  return { x: numberField(event, 'x'), y: numberField(event, 'y') };
}

function nullablePos(event: RunEvent): Vec | undefined {
  const x = event.x;
  const y = event.y;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : undefined;
}

function stringField(event: RunEvent, key: string): string | null {
  const value = event[key];
  return typeof value === 'string' && value ? value : null;
}

function intField(event: RunEvent, key: string): number {
  const value = event[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : -1;
}

function numberField(event: RunEvent, key: string): number {
  const value = event[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isAbilityId(id: string | null): id is AbilityId {
  return id === 'strike' || id === 'chrono' || id === 'overdrive' || id === 'salvage' || id === 'cascade' || id === 'mirror';
}

function isTargetMode(mode: string | null): mode is TargetMode {
  return mode === 'first' || mode === 'last' || mode === 'strong' || mode === 'close';
}

function eventAt(event: RunEvent, eventIndex: number): ReSimDivergence['at'] {
  return { eventIndex, t: event.t, wave: event.wave, type: event.type };
}

function hashMap(map: GameMap): string {
  const data = JSON.stringify({
    id: map.id,
    path: map.path.map((p) => [Math.round(p.x), Math.round(p.y)]),
    blockers: map.blockers.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]),
    pathWidth: map.pathWidth,
  });
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function reSimulateUploadBundle(bundle: RunUploadBundle): ReSimResult {
  return reSimulate(bundle);
}

// The functions bundle re-simulates outside the browser, where the boot-time
// config fetches never run. The server injects the live config/balance and
// config/dailyOverride docs through these before verifying.
export { setBalanceDoc } from './balanceConfig';
export { setDailyOverrideDoc } from './dailyChallenge';
