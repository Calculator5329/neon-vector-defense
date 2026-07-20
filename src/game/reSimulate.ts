import { balanceDocSnapshot, balanceVersion, setBalanceDoc as applyBalanceDoc } from './balanceConfig';
import { dailyChallengeForId } from './dailyChallenge';
import { protocolDrillForId } from './protocolDrills';
import { Game } from './engine';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { resolveReplayMap } from './mapVersions';
import { weeklyChallengeForId } from './weeklyChallenge';
import { gauntletProtocolRouteForWeek } from './gauntletProtocol';
import {
  REPLAY_ENGINE_VERSION,
  RUN_TELEMETRY_SCHEMA,
  buildRunManifest,
  type PublicRunDoc,
  type RunEvent,
  type RunEventChunkDoc,
  type RunUploadBundle,
} from './runTelemetry';
import { decodeReplayActionBundle } from './replayCodec';
import { TOWERS, TOWER_MAP } from './towers';
import type { AbilityId, TargetFilter, TargetMode, Vec } from './types';
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
}

export interface ReSimBundle {
  run: PublicRunDoc;
  chunks: RunEventChunkDoc[];
}

export const REPLAY_ACTION_TYPES = new Set([
  'wave_start',
  'tower_place',
  'tower_upgrade',
  'tower_sell',
  'target_mode',
  'target_filter',
  'ability_cast',
  'pickup_collect',
  'freeplay_enter',
  'freeplay_relic_select',
  'freeplay_risk_accept',
  'freeplay_risk_decline',
  'speed_change',
  'bonus_opt_in',
  'bonus_skip',
  'bonus_shot',
]);

// Construct + prime a Game from a recorded run's setup. This may apply embedded
// setup.balance/setup.daily snapshots so deterministic playback can reproduce the
// historical run; authenticity of those client-supplied snapshots is the caller's
// responsibility. Functions verifyRunCore enforces authenticity before trusting a verdict.
export function setupReplayGame(run: PublicRunDoc): { game: Game } | { error: string } {
  // Resolve the EXACT geometry the run was recorded on — a re-tuned live map
  // must not silently reject placements that were legal at record time.
  const map = resolveReplayMap(run.setup.map, run.setup.mapHash);
  const diff = DIFFICULTIES.find((candidate) => candidate.id === run.setup.diff);
  if (!diff) return { error: 'unknown map or difficulty' };
  if (!map) {
    return ALL_MAPS.some((candidate) => candidate.id === run.setup.map)
      ? { error: 'map hash matches no known version of this map' }
      : { error: 'unknown map or difficulty' };
  }

  // Availability must mirror the LIVE rule or mid-run unlocks desync: the engine
  // gates placeTower on baseKills + totalKills vs unlockAt, so a tower unlocked
  // mid-run (then placed) is legal live but absent from the start-of-run
  // availableTowerIds snapshot. When the recorded set is exactly what the current
  // unlock ladder derives from lifetimeKillsAtStart, replay in dynamic mode
  // (recorded baseKills, no override) so unlocks re-earn at the same ticks.
  // A recorded set that DIFFERS from the derivation is a constrained pool
  // (daily arsenal, relic drafts) and stays a static override. NOTE: this makes
  // towers.ts unlockAt part of the versioned sim surface — bump
  // REPLAY_ENGINE_VERSION whenever the unlock ladder changes.
  // Rules only key-allow this field (the /runs rule is at the 1000-expression
  // cap), so sanitize defensively: any non-finite/absurd value falls back to 0,
  // which fails the derivation match below and keeps the static override path.
  const rawLifetime = Number(run.setup.lifetimeKillsAtStart ?? 0);
  const lifetimeKillsAtStart = Number.isFinite(rawLifetime) && rawLifetime >= 0 && rawLifetime < 1e9
    ? Math.floor(rawLifetime)
    : 0;
  const derivedIds = TOWERS.filter((t) => t.unlockAt <= lifetimeKillsAtStart).map((t) => t.id);
  const recordedIds = [...(run.setup.availableTowerIds ?? [])].sort();
  const dynamicUnlocks = recordedIds.length === derivedIds.length
    && [...derivedIds].sort().every((id, i) => id === recordedIds[i]);
  const game = new Game(map, diff, {
    seed: run.setup.seed >>> 0,
    lifetimeKills: dynamicUnlocks ? lifetimeKillsAtStart : 0,
    availableTowerIds: dynamicUnlocks ? undefined : run.setup.availableTowerIds,
    replayMode: true,
  });
  game.paused = false;
  game.speed = 1;
  const applyRecordedResources = () => {
    game.credits = Math.max(0, Math.floor(run.setup.startingCash));
    game.lives = Math.max(1, Math.floor(run.setup.startingLives));
    game.startingLives = game.lives;
    game.recorder.setStartingResources(game.credits, game.lives);
  };

  if (run.summary.weekly || run.setup.weekly) {
    const weeklyId = run.summary.weekly ?? run.setup.weekly?.id;
    const challenge = run.setup.weekly ?? (weeklyId ? weeklyChallengeForId(weeklyId) : null);
    if (!challenge) return { error: `unsupported weekly id ${weeklyId}` };
    if (challenge.mapId !== map.id || challenge.diffId !== diff.id) {
      return { error: 'weekly challenge does not match replay setup' };
    }
    game.startWeeklyChallenge(challenge);
  } else if (run.summary.daily || run.setup.daily) {
    const challengeId = run.summary.daily ?? run.setup.daily?.id ?? '';
    const canonicalDrill = protocolDrillForId(challengeId);
    const challenge = canonicalDrill ?? run.setup.daily ?? (run.summary.daily ? dailyChallengeForId(run.summary.daily) : null);
    if (!challenge) return { error: `unsupported daily id ${run.summary.daily}` };
    if (challenge.mapId !== map.id || challenge.diffId !== diff.id) {
      return { error: 'daily challenge does not match replay setup' };
    }
    game.startDailyChallenge(challenge);
  }
  applyRecordedResources();
  if (run.setup.gauntletProtocol) {
    const route = gauntletProtocolRouteForWeek(run.setup.gauntletProtocol.week);
    if (JSON.stringify(route.route) !== JSON.stringify(run.setup.gauntletProtocol.route)) {
      return { error: 'gauntlet protocol route does not match week seed' };
    }
    game.startGauntletProtocolLeg(run.setup.gauntletProtocol);
  } else if (run.summary.gauntlet || run.setup.gauntlet) {
    game.setGauntletChallenge(run.setup.gauntlet ?? null);
  }
  return { game };
}

export interface ReSimOptions {
  /**
   * Wall-clock budget (ms) for the WHOLE re-simulation. The tick-count guard in
   * `advanceToTick` bounds how many ticks a single advance runs, but a dense
   * marathon (thousands of live enemies/tick) can burn minutes of real CPU while
   * staying UNDER the tick cap — which presents to the caller (a Cloud Function
   * with a hard timeout) as "verification stuck in a simulating loop." This is a
   * wall-clock belt over that tick-count suspenders: on deadline the verdict is
   * `unverifiable` ("wall-clock budget exceeded"), never `divergent` — a slow run
   * is not a dishonest one. Default is generous so an honest run never trips it;
   * the server callable overrides it to stay under the Function timeout. Pass
   * `Infinity` to disable (tests / one-shot local consumers).
   */
  wallClockMs?: number;
}

// Generous default: an honest 80-wave/deep-freeplay re-sim finishes in well under a
// second on normal hardware, so 30s only ever fires on a pathological/dense run.
export const DEFAULT_RESIM_WALL_CLOCK_MS = 30_000;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function reSimulate(bundle: ReSimBundle, options?: ReSimOptions): ReSimResult {
  const wallClockMs = options?.wallClockMs ?? DEFAULT_RESIM_WALL_CLOCK_MS;
  const deadline = Number.isFinite(wallClockMs)
    ? nowMs() + Math.max(0, wallClockMs)
    : Number.POSITIVE_INFINITY;
  const balanceSnapshot = bundle.run?.setup?.balance;
  if (balanceSnapshot) {
    const previous = balanceDocSnapshot();
    applyBalanceDoc(balanceSnapshot);
    try {
      return reSimulateCore(bundle, true, deadline);
    } finally {
      applyBalanceDoc(previous);
    }
  }
  return reSimulateCore(bundle, false, deadline);
}

function reSimulateCore(bundle: ReSimBundle, hasBalanceSnapshot: boolean, deadline: number): ReSimResult {
  const unverifiable = (reason: string): ReSimResult => ({ verdict: 'unverifiable', reason });
  const run = bundle.run;
  if (run.schemaVersion !== RUN_TELEMETRY_SCHEMA) return unverifiable(`unsupported schemaVersion ${run.schemaVersion}`);
  if ((run.setup.replayEngine ?? 1) !== REPLAY_ENGINE_VERSION) {
    return unverifiable(`engine mismatch: run=${run.setup.replayEngine ?? 1} current=${REPLAY_ENGINE_VERSION}`);
  }
  if (!run.manifest?.complete) return unverifiable('missing complete replay manifest');
  if (!Array.isArray(bundle.chunks) || bundle.chunks.length !== run.chunkCount) {
    return unverifiable('chunk count does not match run manifest');
  }

  const chunkError = validateChunks(run, bundle.chunks);
  if (chunkError) return unverifiable(chunkError);
  const expectedManifest = buildRunManifest(run.actions, bundle.chunks);
  if (
    expectedManifest.actionHash !== run.manifest.actionHash
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
  if (!hasBalanceSnapshot) {
    const currentBalance = balanceVersion();
    const recordedBalance = run.setup.balanceVersion === run.build ? '' : (run.setup.balanceVersion ?? '');
    if (recordedBalance !== currentBalance) {
      return unverifiable(`balance mismatch: run=${recordedBalance || 'identity'} current=${currentBalance || 'identity'}`);
    }
  }

  if (!ALL_MAPS.some((candidate) => candidate.id === run.setup.map)) return unverifiable('unknown map or difficulty');
  // Historical geometry (mapVersions registry) keeps runs recorded before a map
  // re-tune verifiable; only a hash matching NO known version is unverifiable.
  if (!resolveReplayMap(run.setup.map, run.setup.mapHash)) return unverifiable('map hash mismatch');

  const built = setupReplayGame(run);
  if ('error' in built) return unverifiable(built.error);
  const game = built.game;

  const allEvents = decodeReplayActionBundle(run.actions, bundle.chunks);
  if (allEvents.length !== run.eventCount) return unverifiable('action decode count mismatch');
  const actions = allEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => REPLAY_ACTION_TYPES.has(event.type));
  if (actions.some(({ event }) => !validSimTick(event))) {
    return unverifiable('replay action events are missing exact simTick timing');
  }
  let currentSpeed = eventSpeed(allEvents[0]) ?? 1;
  game.speed = currentSpeed;

  for (const action of actions) {
    game.speed = currentSpeed;
    const stepResult = advanceToEvent(game, action.event, deadline);
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
  const finalAdvance = advanceToTick(game, simTick(endEvent), deadline);
  if (finalAdvance) return finalAdvance;
  if (run.summary.phase !== 'wave') settleBuildPhase(game, endEvent);
  if (game.phase !== 'gameover' && game.phase !== 'victory' && run.summary.outcome === 'abandoned') {
    game.abandonRun('resim');
  }

  const simulated = game.buildRunUploadBundle(run.summary.callsign, run.build).run;
  const summaryDivergence = compareSummary(run.summary, simulated.summary);
  if (summaryDivergence) {
    return { verdict: 'divergent', reason: `summary.${summaryDivergence.field}`, divergence: summaryDivergence, summary: simulated.summary };
  }
  return { verdict: 'verified', summary: simulated.summary };
}

function validateChunks(run: PublicRunDoc, chunks: RunEventChunkDoc[]): string | null {
  const sorted = [...chunks].sort((a, b) => a.chunk - b.chunk);
  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i];
    if (chunk.schemaVersion !== RUN_TELEMETRY_SCHEMA) return `unsupported chunk schemaVersion ${chunk.schemaVersion}`;
    if (chunk.runId !== run.runId) return 'chunk runId mismatch';
    if (chunk.chunk !== i) return 'missing or out-of-order replay chunk';
    if ((run.manifest.chunkEventCounts[i] ?? -1) !== chunk.actions.count) return 'chunk event count mismatch';
  }
  const eventCount = run.actions.count + chunks.reduce((sum, chunk) => sum + chunk.actions.count, 0);
  if (eventCount !== run.eventCount) return 'eventCount mismatch';
  if (buildRunManifest(run.actions, chunks).actionHash !== run.manifest.actionHash) return 'action hash mismatch';
  return null;
}

function advanceToEvent(game: Game, event: RunEvent, deadline: number): ReSimResult | null {
  if (!validSimTick(event)) return { verdict: 'unverifiable', reason: 'invalid event simTick' };
  return advanceToTick(game, simTick(event), deadline);
}

function advanceToTick(game: Game, targetTick: number, deadline: number): ReSimResult | null {
  if (!Number.isFinite(targetTick) || targetTick < 0) return { verdict: 'unverifiable', reason: 'invalid event simTick' };
  const targetT = targetTick * Game.SIM_STEP;
  const limit = Math.max(0, targetT) + Game.SIM_STEP / 2;
  let guard = 0;
  let stepped = 0;
  while (game.time + Game.SIM_STEP / 2 < limit && guard++ < 1_200_000 && game.phase !== 'gameover') {
    game.update(Game.SIM_STEP / replaySpeed(game.speed));
    // Wall-clock deadline check on the first tick of each advance and every 64 after
    // (cheap, and the only reliable bound given ~40x per-tick cost variance across
    // enemy density). `deadline` is absolute, so checking per-advance correctly bounds
    // the WHOLE re-sim even when a run is a long sequence of short advances. A slow
    // dense run returns unverifiable rather than hanging the caller — never divergent.
    if ((stepped++ & 63) === 0 && nowMs() > deadline) {
      return { verdict: 'unverifiable', reason: 're-simulation wall-clock budget exceeded' };
    }
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
    case 'target_filter': {
      const tower = towerByUid(game, intField(event, 'towerUid'));
      const filters = targetFiltersFromEvent(event);
      if (!tower || !filters) return { ok: false, reason: 'target filter target missing' };
      game.setTargetFilters(tower, filters);
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
    case 'bonus_opt_in':
      settleBuildPhase(game, event);
      return game.startBonusRound() ? { ok: true } : { ok: false, reason: 'bonus round opt-in failed' };
    case 'bonus_skip':
      settleBuildPhase(game, event);
      return game.skipBonusRound() ? { ok: true } : { ok: false, reason: 'bonus round skip failed' };
    case 'bonus_shot': {
      const actual = game.shootBonusTarget(eventPos(event));
      const expected = intField(event, 'targetId');
      return actual === expected ? { ok: true } : { ok: false, reason: `bonus shot mismatch ${actual}` };
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
    'weekly',
    'gauntlet',
    'gauntletRunId',
    'gauntletLeg',
    'gauntletNextRunId',
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
  return id === 'strike' || id === 'chrono' || id === 'overdrive' || id === 'salvage' || id === 'cascade' || id === 'mirror' || id === 'recalibrate';
}

function isTargetMode(mode: string | null): mode is TargetMode {
  return mode === 'first' || mode === 'last' || mode === 'strong' || mode === 'close';
}

function isTargetFilter(filter: string): filter is TargetFilter {
  return filter === 'boss' || filter === 'armored' || filter === 'cloaked' || filter === 'healer' || filter === 'spawner';
}

function targetFiltersFromEvent(event: RunEvent): TargetFilter[] | null {
  const raw = stringField(event, 'filters') ?? '';
  if (!raw) return [];
  const filters = raw.split(',').filter(Boolean);
  if (filters.some((filter) => !isTargetFilter(filter))) return null;
  const canonical: TargetFilter[] = ['boss', 'armored', 'cloaked', 'healer', 'spawner'];
  const selected = new Set(filters);
  return canonical.filter((filter) => selected.has(filter));
}

function eventAt(event: RunEvent, eventIndex: number): ReSimDivergence['at'] {
  return { eventIndex, t: event.t, wave: event.wave, type: event.type };
}

export function reSimulateUploadBundle(bundle: RunUploadBundle, options?: ReSimOptions): ReSimResult {
  return reSimulate(bundle, options);
}

// ── Deterministic playback driver ────────────────────────────────────────────
// The replay viewer used to *cosmetically re-enact* a run (enemies streamed down
// the path off scrub time, towers fired on a fake cadence) because the engine was
// assumed non-deterministic. It isn't: gameplay routes through a seeded PRNG, and
// the server already re-simulates runs bit-for-bit to verify them. This driver
// exposes that same stepping incrementally so the viewer can render the REAL engine
// state at any scrub position — a frame-accurate replay, not a reconstruction.
export interface ReplayPlayback {
  /** live engine — render it with the normal render() each frame */
  readonly game: Game;
  /** seconds of the final recorded tick (scrub domain upper bound) */
  readonly endT: number;
  /** 0..1 fraction of a still-pending seek, or null when settled */
  readonly seekProgress: number | null;
  /** sim-seconds of the first recorded action the engine could NOT re-apply,
   *  or null while playback is faithful. Non-null means the rendered battle has
   *  drifted from the recorded run — callers should surface it, not hide it. */
  readonly divergedAtT: number | null;
  /** Advance/rewind the sim toward scrub time `tSeconds`, stepping at most
   *  `budgetTicks` engine ticks AND at most `budgetMs` wall-clock this call.
   *  Returns true when the game reflects the target; false means "keep calling
   *  next frame" — this is what keeps a long backward scrub from freezing the
   *  render thread (a 25-minute run is ~90k ticks re-simulated from t=0).
   *  Tick cost varies ~40x with enemy density, so the ms deadline is what
   *  actually bounds a frame; budgets only bound WHERE a slice pauses, never
   *  the final state (ticks are ticks). Omit both for the old synchronous
   *  behavior (tests, one-shot consumers). */
  seekTo(tSeconds: number, budgetTicks?: number, budgetMs?: number): boolean;
}

// Deep-freeplay marathons would stutter: a backward scrub re-steps the whole run
// from t=0, and re-sim cost is ticks (durationS × 60), so the honest gate is sim
// DURATION — one sim-hour re-seeks in ~1-2s (sim runs >1500× realtime). The old
// 30k KILL cap excluded ordinary campaign victories (a 60-wave Veteran clear is
// ~65k kills) and silently dropped them to the hollow cosmetic path; kills stay
// only as a generous entity-density backstop for pathological runs.
// Must exceed the LONGEST legitimate run, or ordinary victories drop to the hollow
// cosmetic path (enemies never die). The longest campaign is Extinction — 80 waves,
// ~3,840s of sim-time at a brisk pace and more with human between-wave pacing — so a
// 3,600s cap silently made every Extinction clear (and any deep freeplay/marathon)
// un-replayable. durationS is SIM time (engine.ts `Math.round(this.time)`), so idle
// build phases barely cost re-sim ticks; kills are the real density gate below, and
// seekTo() is wall-clock-budgeted so a big run can never hang. Re-seek is cheap
// (sim runs >1500× realtime → ~1-2s per sim-hour), so headroom is nearly free.
const PLAYBACK_MAX_DURATION_S = 10_800;
const PLAYBACK_KILL_CAP = 250_000;
export const REPLAY_PLAYBACK_MAX_DURATION_S = PLAYBACK_MAX_DURATION_S;

/** Why a run could not be driven frame-accurately — a *fidelity* reason, NOT a
 *  `verifyRun` verdict. Surfaced to the viewer so it can label a cosmetic preview
 *  instead of silently rendering a fake battle. Never expose this as verification. */
export interface ReplayPlaybackDiagnostic {
  playback: ReplayPlayback | null;
  reason: string | null;
}

/**
 * Build a frame-accurate playback driver for a run, or return the reason it cannot be
 * faithfully re-simulated on this client (schema/engine/balance drift, unresolved
 * daily, missing tick timing, or a marathon past the duration/kill caps). Callers
 * fall back to the cosmetic reconstruction when `playback` is null and should surface
 * `reason` (log/label) rather than hiding it. Expects `run.events` already merged with
 * its chunk events (fetchRunReplay does this).
 */
export function createReplayPlaybackDiagnostic(
  run: PublicRunDoc & { chunks?: RunEventChunkDoc[] },
): ReplayPlaybackDiagnostic {
  const drop = (reason: string): ReplayPlaybackDiagnostic => ({ playback: null, reason });
  if (run.schemaVersion !== RUN_TELEMETRY_SCHEMA) return drop(`schema version ${run.schemaVersion} unsupported`);
  if ((run.setup.replayEngine ?? 1) !== REPLAY_ENGINE_VERSION) {
    return drop(`engine version mismatch: run=${run.setup.replayEngine ?? 1} current=${REPLAY_ENGINE_VERSION}`);
  }
  if ((run.summary.durationS ?? 0) > PLAYBACK_MAX_DURATION_S) {
    return drop(`run duration ${Math.round(run.summary.durationS ?? 0)}s exceeds the ${PLAYBACK_MAX_DURATION_S}s playback cap`);
  }
  if ((run.summary.kills ?? 0) > PLAYBACK_KILL_CAP) {
    return drop(`run kills ${run.summary.kills} exceed the ${PLAYBACK_KILL_CAP} density cap`);
  }

  // Balance must match: re-running under different tower/enemy math would render a
  // battle that never happened. Mirrors reSimulate's balance guard (the sentinel
  // fallback to the build tag means "no remote balance doc" → identity config).
  const balanceSnapshot = run.setup.balance;
  if (!balanceSnapshot) {
    const currentBalance = balanceVersion();
    const recordedBalance = run.setup.balanceVersion === run.build ? '' : (run.setup.balanceVersion ?? '');
    if (recordedBalance !== currentBalance) {
      return drop(`balance version mismatch: run=${recordedBalance || 'identity'} current=${currentBalance || 'identity'}`);
    }
  }
  const withPlaybackBalance = <T,>(fn: () => T): T => {
    if (!balanceSnapshot) return fn();
    const previous = balanceDocSnapshot();
    applyBalanceDoc(balanceSnapshot);
    try {
      return fn();
    } finally {
      applyBalanceDoc(previous);
    }
  };

  if (!run.actions) return drop('run has no recorded action stream');
  const events = decodeReplayActionBundle(run.actions, run.chunks ?? []);
  const actions = events
    .filter((event) => REPLAY_ACTION_TYPES.has(event.type) && validSimTick(event))
    .map((event) => ({ event, tick: simTick(event) }))
    .sort((a, b) => a.tick - b.tick);
  // Every action must carry exact tick timing, or the re-sim can't place it — same
  // rule reSimulate enforces. A run with actions but no valid ticks is not drivable.
  if (events.some((event) => REPLAY_ACTION_TYPES.has(event.type)) && actions.length === 0) {
    return drop('recorded actions lack sim-tick timing');
  }

  const endEvent = [...events].reverse().find((event) => event.type === 'run_end');
  const endTick = validSimTick(endEvent)
    ? simTick(endEvent)
    : actions.length ? actions[actions.length - 1].tick : 0;
  const initialSpeed = eventSpeed(events[0]) ?? 1;

  const first = withPlaybackBalance(() => setupReplayGame(run));
  if ('error' in first) return drop(first.error);

  let game = first.game;
  let cursor = 0;
  let currentSpeed = initialSpeed;
  game.speed = initialSpeed;
  // Sticky across reset(): a rewind replays the same action stream, so a real
  // divergence would only recur — losing the flag would just flicker the warning.
  let divergedAtT: number | null = null;

  const reset = () => {
    // Backward seeks rebuild from the recorded seed and replay forward — the engine
    // is forward-only, and snapshots hold no restorable full state.
    const rebuilt = withPlaybackBalance(() => setupReplayGame(run));
    if ('error' in rebuilt) return;
    game = rebuilt.game;
    game.speed = initialSpeed;
    cursor = 0;
    currentSpeed = initialSpeed;
  };

  const currentTick = () => Math.round(game.time / Game.SIM_STEP);

  let pendingTick: number | null = null;

  // Step toward `tick`, spending at most budget.left engine ticks. Cosmetic FX
  // are muted for all but the final second of catch-up so a long seek doesn't
  // churn thousands of never-rendered particles/beams through the GC; muting is
  // sim-safe because FX are render-only (the meta:sim invariant).
  const stepToward = (tick: number, finalTick: number, budget: { left: number; deadline: number }): boolean => {
    const limit = Math.max(0, tick * Game.SIM_STEP) + Game.SIM_STEP / 2;
    const unmuteTick = finalTick - 60;
    let stepped = 0;
    while (game.time + Game.SIM_STEP / 2 < limit && game.phase !== 'gameover' && budget.left > 0) {
      game.fxMuted = currentTick() < unmuteTick;
      game.update(Game.SIM_STEP / replaySpeed(game.speed));
      budget.left--;
      // wall-clock deadline check every 64 ticks: cheap, and the only reliable
      // per-frame bound given ~40x tick-cost variance across enemy density
      if ((++stepped & 63) === 0 && performance.now() > budget.deadline) budget.left = 0;
    }
    game.fxMuted = false;
    return game.time + Game.SIM_STEP / 2 >= limit || game.phase === 'gameover';
  };

  const seekTo = (
    tSeconds: number,
    budgetTicks = Number.POSITIVE_INFINITY,
    budgetMs = Number.POSITIVE_INFINITY,
  ): boolean => withPlaybackBalance(() => {
    const targetTick = Math.max(0, Math.round(tSeconds / Game.SIM_STEP));
    // One tick of grace: at 0.5x-4x the playhead advances less than a tick per
    // frame while game.time carries float drift, so the engine reads a tick
    // "ahead" of the target. Treating that as a rewind re-simulated the whole
    // run from t=0 every few frames (the owner-reported SIMULATING loop).
    // Only a real rewind (2+ ticks behind) rebuilds from the seed.
    if (targetTick + 1 < currentTick()) reset();
    const budget = {
      left: budgetTicks,
      deadline: Number.isFinite(budgetMs) ? performance.now() + budgetMs : Number.POSITIVE_INFINITY,
    };
    while (cursor < actions.length && actions[cursor].tick <= targetTick) {
      const { event, tick } = actions[cursor];
      game.speed = currentSpeed;
      if (!stepToward(tick, targetTick, budget)) { pendingTick = targetTick; return false; }
      const applied = applyAction(game, event);
      // A recorded action the engine rejects means the playback has desynced
      // from the real run (it should be impossible now that replays resolve
      // their recorded map geometry) — record it so the viewer can say so
      // instead of silently rendering a battle with towers missing.
      if (!applied.ok && divergedAtT == null) divergedAtT = tick * Game.SIM_STEP;
      currentSpeed = eventSpeed(event) ?? currentSpeed;
      cursor++;
    }
    game.speed = currentSpeed;
    if (!stepToward(targetTick, targetTick, budget)) { pendingTick = targetTick; return false; }
    pendingTick = null;
    return true;
  });

  return {
    playback: {
      get game() { return game; },
      endT: endTick * Game.SIM_STEP,
      get seekProgress() {
        return pendingTick == null ? null : Math.min(1, currentTick() / Math.max(1, pendingTick));
      },
      get divergedAtT() { return divergedAtT; },
      seekTo,
    },
    reason: null,
  };
}

/**
 * Build a frame-accurate playback driver for a run, or null when it cannot be
 * faithfully re-simulated on this client. Thin wrapper over
 * `createReplayPlaybackDiagnostic` preserving the historical `ReplayPlayback | null`
 * contract for callers that don't need the fidelity reason.
 */
export function createReplayPlayback(run: PublicRunDoc & { chunks?: RunEventChunkDoc[] }): ReplayPlayback | null {
  return createReplayPlaybackDiagnostic(run).playback;
}

// The functions bundle re-simulates outside the browser, where the boot-time
// config fetches never run. The server injects the live config/balance and
// config/dailyOverride and config/weeklyOverride docs through these before verifying.
export { setBalanceDoc } from './balanceConfig';
export { dailyChallengeForId, setDailyOverrideDoc } from './dailyChallenge';
export { weeklyChallengeForId, setWeeklyOverrideDoc } from './weeklyChallenge';
