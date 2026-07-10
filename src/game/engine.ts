import type {
  AbilityId, AbilityState, Beam, BurnZone, DamageType, DifficultyDef, EliteAffixId, Enemy, EnemyDef, GameMap,
  Particle, Pickup, PickupKind, Projectile, TargetFilter, TargetMode, Tower, TowerDef, TowerStats, Vec, Wave, WaveGroup,
} from './types';
import { ENEMIES, rbe } from './enemies';
import {
  BULWARK_DAMAGE_MULT,
  BULWARK_RADIUS,
  ELITE_AFFIX_META,
  ELITE_VARIANT_DEF,
  eliteAffixForSpawn,
  eliteSplitChildren,
  makeEliteState,
  planEliteWave,
} from './eliteAffixes';
import { ABILITIES } from './abilities';
import { ARCHIVE } from './lore';
import { getBalance } from './balanceConfig';
import { progress } from './storage';
import { computeStats, sellValue, TOWER_MAP, TOWERS } from './towers';
import { getWave, waveBonus, incomeMult } from './waves';
import { sfx, vox, playStinger, setBossMusic } from './sound';
import {
  RunRecorder,
  type PrivateRunAnalyticsDoc,
  type PublicRunDoc,
  type RunCheckpointDoc,
  type RunCheckpointReason,
  type RunTelemetryState,
  type RunUploadBundle,
} from './runTelemetry';
import { appMetrics, METRIC_EVENTS } from './metrics';
import {
  applyMutatorsToWave,
  contractById,
  createFreeplayState,
  freeplayIncomeMult,
  freeplayScoreMultiplier,
  freeplaySummary,
  freeplayWaveBonusMult,
  mutatorById,
  nextMutators,
  relicOffer,
  rivalForWave,
  riskOfferForWave,
  type DailyFreeplaySeed,
  type FreeplayContractId,
  type FreeplayMutator,
  type FreeplayRelic,
  type FreeplayRelicId,
  type FreeplayRival,
  type FreeplayState,
  type RiskWaveId,
} from './freeplay';
import {
  applyDailyWaveTwist,
  dailyAllowsTower,
  dailyChallenge,
  dailyModifierNames,
  dailyTowerIds as challengeTowerIds,
  type DailyChallenge,
} from './dailyChallenge';
import { protocolDrillForId } from './protocolDrills';
import { weeklyChallenge, weeklyModifierNames, type WeeklyChallenge, type WeeklyGauntletDoc } from './weeklyChallenge';
import {
  gauntletProtocolRelics,
  gauntletProtocolWave,
  gauntletProtocolWaveCount,
  type GauntletProtocolLeg,
} from './gauntletProtocol';

export const W = 1280;
export const H = 720;
const TOWER_R = 16;

/** Deterministic PRNG (mulberry32). Gameplay randomness routes through a
 *  per-Game instance seeded stream so a recorded seed can reproduce the run;
 *  purely cosmetic FX keep Math.random. */
function mulberry(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place array compaction — drops elements failing `keep` without allocating a
 *  new array. The per-tick lists (enemies, projectiles, particles) can hold
 *  thousands of items; `.filter()` would allocate a fresh big array every substep,
 *  and that churn is what produces occasional GC-pause frame spikes at 4x. */
function compact<T>(arr: T[], keep: (v: T) => boolean): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (keep(arr[i])) { if (w !== i) arr[w] = arr[i]; w++; }
  }
  arr.length = w;
}

interface SpawnEntry {
  group: WaveGroup;
  spawned: number;
  timer: number;
  started: boolean;
}

interface PreparedWave {
  groups: Wave;
  mutators: FreeplayMutator[];
  rival: FreeplayRival | null;
}

// ---------- spatial grid ----------
// Every radius query (targeting, projectile hits, AoE, nearest) used to scan all
// enemies — O(n) each, O(n²) per tick. At 4x with thousands of piled hulls in
// freeplay that spikes frame time badly. The grid buckets enemies into cells once
// per tick so queries only visit local candidates. Callers keep their exact hypot
// checks; the grid only narrows the candidate set.
const CELL = 80;
const GW = Math.ceil(W / CELL) + 1;
const GH = Math.ceil(H / CELL) + 1;

class EnemyGrid {
  private cells: Enemy[][] = Array.from({ length: GW * GH }, () => []);
  readonly byId = new Map<number, Enemy>();

  rebuild(enemies: Enemy[]) {
    for (const c of this.cells) c.length = 0;
    this.byId.clear();
    for (const e of enemies) {
      if (e.dead || e.finished) continue;
      this.byId.set(e.uid, e);
      const cx = Math.min(GW - 1, Math.max(0, (e.pos.x / CELL) | 0));
      const cy = Math.min(GH - 1, Math.max(0, (e.pos.y / CELL) | 0));
      this.cells[cy * GW + cx].push(e);
    }
  }

  forEachInRadius(x: number, y: number, radius: number, fn: (e: Enemy) => void) {
    const minx = Math.max(0, ((x - radius) / CELL) | 0);
    const maxx = Math.min(GW - 1, ((x + radius) / CELL) | 0);
    const miny = Math.max(0, ((y - radius) / CELL) | 0);
    const maxy = Math.min(GH - 1, ((y + radius) / CELL) | 0);
    for (let cy = miny; cy <= maxy; cy++) {
      const row = cy * GW;
      for (let cx = minx; cx <= maxx; cx++) {
        const cell = this.cells[row + cx];
        for (let i = 0; i < cell.length; i++) fn(cell[i]);
      }
    }
  }
}

export type Phase = 'build' | 'wave' | 'gameover' | 'victory';

export interface GameOptions {
  /** deterministic gameplay seed; random when omitted. Recorded in replay setup. */
  seed?: number;
  /** lifetime-kills snapshot for unlock gating; defaults to the live save. Sims
   *  and tests pass an explicit value so results never depend on the host's
   *  localStorage progress. */
  lifetimeKills?: number;
  /** Explicit replay-time arsenal. Live play leaves this unset and uses normal
   *  lifetime-kill unlock progression. */
  availableTowerIds?: string[];
  /** Engine-driven replay/re-simulation: keep recorder local, but do not mutate
   *  player progression while the historical run is being replayed. */
  replayMode?: boolean;
}

/** a forward (repel) gravity push can never shove a hull closer than this to the exit */
const SAFE_EXIT_MARGIN = 80;
// Soft damage-type resistance for the legacy binary-immunity flags.
// These hulls used to take 0 damage from the matching type; now they take a
// reduced fraction instead. Shred hits now apply Exposed, which weakens these
// resistances and increases all follow-up damage for every tower.
const RESIST_ARMORED = 0.35; // armored hulls take 35% kinetic (was 0%)
const RESIST_BLAST = 0.25;   // explosive-immune hulls take 25% explosive (was 0%)
const RESIST_CRYO = 0.25;    // cryo-immune hulls take 25% cryo (was 0%)
export const EXPOSED_MAX_STACKS = 5;
export const EXPOSED_DURATION = 4;
export const EXPOSED_RESIST_STRIP_PER_STACK = 0.13;
export const EXPOSED_DAMAGE_TAKEN_PER_STACK = 0.04;
export const MIRROR_HULL_BASE_RESIST = 0.85;
export const MIRROR_HULL_RECALIBRATED_RESIST = 0.40;
export const RECALIBRATE_MIRROR_WEAKEN_S = 12;
export const TARGET_FILTERS: readonly TargetFilter[] = ['boss', 'armored', 'cloaked', 'healer', 'spawner'];

export class Game {
  map: GameMap;
  diff: DifficultyDef;
  credits: number;
  lives: number;
  wave = 0; // last completed/current wave number
  phase: Phase = 'build';
  speed = 1;
  paused = false;
  autoNext = false;

  enemies: Enemy[] = [];
  towers: Tower[] = [];
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  beams: Beam[] = [];
  /** Mute cosmetic FX creation (particles/beams). Replay playback sets this while
   *  fast-forwarding thousands of catch-up ticks the player never sees — FX are
   *  render-only by invariant (meta:sim), so muting cannot change sim outcomes,
   *  it only cuts allocation/GC churn during seeks. */
  fxMuted = false;
  burnZones: BurnZone[] = [];
  pickups: Pickup[] = [];
  novas: { pos: Vec; r: number; maxR: number; damage: number; slowPower: number; slowDuration: number; color: string; hit: Set<number>; src: Tower }[] = [];
  abilities: AbilityState[] = ABILITIES.map((def) => ({ def, cd: 0 }));
  /** Mirror Protocol: while >0, leaked hulls are thrown back to the entrance */
  mirrorTimer = 0;

  /** global effect timers */
  chronoTimer = 0;
  overdriveTimer = 0;
  frenzyTimer = 0;
  /** camera shake intensity 0..1, decays */
  shake = 0;
  /** red vignette flash on core loss, decays */
  hurtFlash = 0;
  /** transient HUD announcement */
  notice = '';
  noticeTimer = 0;
  /** indices into ARCHIVE recovered so far (seeded from persistent progress) */
  archive: number[] = [...progress.archive];
  /** set when a new fragment unlocks, cleared by the UI */
  newArchive = false;
  /** set once when the first cloaked hull spawns and the player has never seen the tip */
  cloakTipPending = false;
  private cloakTipShown = false;

  /** queue of enemy types appearing for the first time ever — drained by the UI for the
   *  Combine Bestiary "NEW HOSTILE IDENTIFIED" reveal */
  newHostiles: EnemyDef[] = [];
  private flaggedHostiles = new Set<string>();

  private lowCoreWarned = false;

  /** per-run telemetry for the after-action report */
  runStats = {
    dmg: {} as Record<string, number>,
    dmgByTowerUid: {} as Record<number, number>,
    kills: {} as Record<string, number>,
    leaks: 0,
    abilitiesCast: 0,
    cashEarned: 0,
  };

  readonly recorder: RunRecorder;

  /** all credit income flows through here so the run's earnings are scored */
  private earn(n: number) {
    this.credits += n;
    this.runStats.cashEarned += n;
  }

  private finishRun(won: boolean, outcome: 'victory' | 'gameover') {
    setBossMusic(false); // never leave the boss theme looping past a run's end
    // A win→freeplay→death session calls finishRun twice on the SAME Game instance.
    // Persist the lifetime record only once, or runs/kills/history double-count and
    // tower unlocks (gated on lifetime kills) advance faster than designed.
    if (this.campaignProgressEnabled()) {
      const rec = {
        map: this.map.id,
        diff: this.diff.id,
        wave: this.wave,
        kills: this.totalKills,
        cash: Math.round(this.runStats.cashEarned),
        won,
        freeplay: this.freeplay,
        date: Date.now(),
        leaks: this.runStats.leaks,
        durationS: Math.round(this.time),
        towers: [...new Set([...this.towers.map((t) => t.def.id), ...Object.keys(this.runStats.dmg)])].join(','),
      };
      if (!this.finishedPersisted) {
        this.finishedPersisted = true;
        progress.addRun(rec);
      } else if (this.freeplay && !this.freeplayPersisted) {
        this.freeplayPersisted = true;
        progress.addFreeplayRun({ ...rec, freeplay: true, won: false });
      }
    }
    if (outcome === 'victory' && !this.freeplay) this.recorder.recordCampaignClear(this.telemetryState());
    else this.recorder.recordRunEnd(this.telemetryState(), outcome);
  }

  /** Apex only: the Combine studies your fire and armors against your favorite damage type */
  adaptation: { type: DamageType | null; resist: number } = { type: null, resist: 0 };
  private dmgWindow: Record<string, number> = {};
  private dmgByTypeTotal: Record<string, number> = {};

  /** deterministic gameplay seed + stream (see GameOptions.seed) */
  readonly seed: number;
  private rng: () => number;
  /** lifetime-kills snapshot taken at construction (see GameOptions.lifetimeKills) */
  private readonly baseKills: number;
  private readonly availableTowerIdsOverride: Set<string> | null;
  private readonly replayMode: boolean;
  /** per-instance entity uid sequence — module-global counters made uids
   *  irreproducible across runs, which blocks deterministic re-simulation */
  private uidSeq = 1;

  private grid = new EnemyGrid();
  /** recycled Particle objects — FX churn was the main GC-pause source at 4x */
  private particlePool: Particle[] = [];
  /** any detector spire on the field this tick (for cloak reveal precompute) */
  private queue: SpawnEntry[] = [];
  private segLengths: number[] = [];
  totalKills = 0;
  startingLives: number;
  private waveStartTotalKills = 0;
  /** guard so a win→freeplay→death session persists its lifetime record only once */
  private finishedPersisted = false;
  private freeplayPersisted = false;
  time = 0;
  /** set when player chooses to continue past victory */
  freeplay = false;
  freeplayState: FreeplayState = createFreeplayState();
  dailyChallenge: DailyChallenge | null = null;
  private challengeMode: 'daily' | 'weekly' | 'drill' | null = null;
  gauntletChallenge: WeeklyGauntletDoc | null = null;
  gauntletProtocol: GauntletProtocolLeg | null = null;
  dailyTowerIds: Set<string> | null = null;
  private dailyCreditCacheGranted = false;
  private dailyAbilityRechargeUsed = false;

  constructor(map: GameMap, diff: DifficultyDef, opts: GameOptions = {}) {
    this.map = map;
    this.diff = diff;
    this.seed = (opts.seed ?? ((Math.random() * 0x7fffffff) | 0)) >>> 0;
    this.rng = mulberry(this.seed);
    // Snapshot once: mid-run unlock gating must not silently depend on the host
    // machine's live save (a landmine for balance sims and server re-simulation).
    this.baseKills = opts.lifetimeKills ?? progress.record.kills;
    this.availableTowerIdsOverride = opts.availableTowerIds
      ? new Set(opts.availableTowerIds.filter((id) => TOWER_MAP[id]))
      : null;
    this.replayMode = opts.replayMode === true;
    const bdiff = getBalance().diff(diff.id);
    this.credits = Math.round(diff.cash * bdiff.cashMult);
    this.lives = Math.max(1, Math.round(diff.lives * bdiff.livesMult));
    this.startingLives = this.lives;
    appMetrics.beginRun(map.id, diff.id);
    this.recorder = new RunRecorder({
      map,
      diff,
      seed: this.seed,
      startingCash: this.credits,
      startingLives: this.lives,
      availableTowerIds: this.availableTowerIdsOverride
        ? [...this.availableTowerIdsOverride]
        : TOWERS.filter((t) => t.unlockAt <= this.baseKills).map((t) => t.id),
      lifetimeKillsAtStart: this.baseKills,
      runsBeforeStart: progress.record.runs,
      victoriesBeforeStart: progress.record.victories,
      session: progress.engagement,
    });
    for (let i = 1; i < map.path.length; i++) {
      const a = map.path[i - 1], b = map.path[i];
      this.segLengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.recorder.recordRunStart(this.telemetryState());
  }

  get runId(): string {
    return this.recorder.runId;
  }

  get isDailyFreeplay(): boolean {
    return this.isDailyChallenge;
  }

  get isDailyChallenge(): boolean {
    return this.dailyChallenge !== null;
  }

  get isWeeklyChallenge(): boolean {
    return this.challengeMode === 'weekly';
  }

  get isProtocolDrill(): boolean {
    return this.challengeMode === 'drill';
  }

  get isGauntletChallenge(): boolean {
    return this.gauntletChallenge !== null || this.gauntletProtocol !== null;
  }

  get isGauntletProtocol(): boolean {
    return this.gauntletProtocol !== null;
  }

  private campaignProgressEnabled(): boolean {
    return !this.replayMode && !this.isDailyChallenge && !this.isGauntletProtocol;
  }

  towerAvailable(def: TowerDef): boolean {
    if (this.dailyChallenge) return dailyAllowsTower(this.dailyChallenge, def);
    if (this.availableTowerIdsOverride) return this.availableTowerIdsOverride.has(def.id);
    return this.dailyTowerIds ? this.dailyTowerIds.has(def.id) : def.unlockAt <= this.baseKills + this.totalKills;
  }

  telemetryState(): RunTelemetryState {
    return {
      time: this.time,
      wave: this.wave,
      credits: this.credits,
      lives: this.lives,
      totalKills: this.totalKills,
      freeplay: this.freeplay,
      phase: this.phase,
      towers: this.towers,
      enemyCount: this.enemies.length,
      speed: this.speed,
      paused: this.paused,
      runStats: this.runStats,
    };
  }

  buildRunUploadBundle(callsign: string, build: string): RunUploadBundle {
    return this.recorder.makePublicRun(this.telemetryState(), callsign, build);
  }

  buildRunAnalyticsDoc(callsign: string, uid: string, build: string): PrivateRunAnalyticsDoc {
    return this.recorder.makePrivateAnalytics(this.telemetryState(), uid, callsign, build);
  }

  buildRunCheckpointDoc(callsign: string, uid: string, build: string, chunk: number, reason: RunCheckpointReason): RunCheckpointDoc {
    return this.recorder.makeCheckpoint(this.telemetryState(), uid, callsign, build, chunk, reason);
  }

  publicRunSummary(callsign: string, build: string): PublicRunDoc['summary'] {
    return this.buildRunUploadBundle(callsign, build).run.summary;
  }

  abandonRun(reason: string) {
    this.recorder.recordAbandoned(this.telemetryState(), reason);
  }

  setSpeed(speed: number) {
    const next = speed === 4 ? 4 : speed === 2 ? 2 : 1;
    if (this.speed === next) return;
    this.speed = next;
    this.recorder.recordCustom(METRIC_EVENTS.SPEED_CHANGE, this.telemetryState(), { speed: next });
  }

  enterFreeplay(contractId: FreeplayContractId = 'standard', daily?: DailyFreeplaySeed | null) {
    if (this.phase !== 'victory' && !this.freeplay) return;
    this.freeplay = true;
    this.phase = 'build';
    this.freeplayState.daily = daily ?? this.freeplayState.daily;
    this.dailyTowerIds = this.freeplayState.daily ? freeplayDailyTowerSet(this.freeplayState.daily) : null;
    if (this.dailyTowerIds) this.recorder.setAvailableTowerIds([...this.dailyTowerIds]);
    this.freeplayState.contract = contractById(contractId);
    this.freeplayState.lastCheckpointWave = Math.max(this.freeplayState.lastCheckpointWave, this.wave);
    if (this.freeplayState.contract.livesMult && !this.freeplayState.daily) {
      this.lives = Math.max(1, Math.floor(this.lives * this.freeplayState.contract.livesMult));
    }
    this.prepareFreeplayBuild();
    this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_ENTER, {
      contractId,
      dailyId: this.freeplayState.daily?.id ?? null,
      wave: this.wave,
    });
    this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_CONTRACT_SELECT, {
      contractId,
      multiplier: this.freeplayState.contract.multiplier,
    });
    this.announce(`${this.freeplayState.contract.name} accepted - endless siege authorized`);
  }

  startDailyChallenge(challenge = dailyChallenge()) {
    this.freeplay = false;
    this.phase = 'build';
    this.wave = 0;
    this.dailyChallenge = challenge;
    this.challengeMode = protocolDrillForId(challenge.id) ? 'drill' : 'daily';
    this.recorder.setDailyChallenge(challenge);
    this.dailyTowerIds = dailyChallengeTowerSet(challenge);
    this.recorder.setAvailableTowerIds([...this.dailyTowerIds]);
    if (challenge.twist.startingLivesMultiplier) {
      this.lives = Math.max(1, Math.round(this.lives * challenge.twist.startingLivesMultiplier));
      this.startingLives = this.lives;
    }
    this.recorder.setStartingResources(this.credits, this.lives);
    this.recorder.recordCustom(METRIC_EVENTS.DAILY_CHALLENGE_START, this.telemetryState(), {
      dailyId: challenge.id,
      map: challenge.mapId,
      diff: challenge.diffId,
      towerIds: [...this.dailyTowerIds],
      startingCash: this.credits,
      startingLives: this.lives,
      arsenal: challenge.arsenal.id,
      twist: challenge.twist.id,
      boon: challenge.boon.id,
    });
    this.announce(`Daily Challenge: ${dailyModifierNames(challenge).join(' / ')}`);
  }

  startWeeklyChallenge(challenge: WeeklyChallenge = weeklyChallenge()) {
    this.freeplay = false;
    this.phase = 'build';
    this.wave = 0;
    this.dailyChallenge = challenge;
    this.challengeMode = 'weekly';
    this.recorder.setWeeklyChallenge(challenge);
    this.dailyTowerIds = dailyChallengeTowerSet(challenge);
    this.recorder.setAvailableTowerIds([...this.dailyTowerIds]);
    if (challenge.twist.startingLivesMultiplier) {
      this.lives = Math.max(1, Math.round(this.lives * challenge.twist.startingLivesMultiplier));
      this.startingLives = this.lives;
    }
    this.recorder.setStartingResources(this.credits, this.lives);
    this.recorder.recordCustom('weekly_challenge_start', this.telemetryState(), {
      weeklyId: challenge.id,
      map: challenge.mapId,
      diff: challenge.diffId,
      towerIds: [...this.dailyTowerIds],
      startingCash: this.credits,
      startingLives: this.lives,
      arsenal: challenge.arsenal.id,
      twists: challenge.twistIds,
      boon: challenge.boon.id,
    });
    this.announce(`Weekly Mutation: ${weeklyModifierNames(challenge).join(' / ')}`);
  }

  setGauntletChallenge(challenge: WeeklyGauntletDoc | null) {
    this.gauntletChallenge = challenge;
    this.recorder.setGauntletChallenge(challenge);
  }

  startGauntletProtocolLeg(meta: GauntletProtocolLeg) {
    this.freeplay = false;
    this.phase = 'build';
    this.wave = 0;
    this.dailyChallenge = null;
    this.challengeMode = null;
    this.gauntletChallenge = null;
    this.gauntletProtocol = { ...meta, route: [...meta.route] as [string, string, string], relicIds: [...meta.relicIds] };
    this.recorder.setGauntletProtocol(this.gauntletProtocol);
    this.credits = Math.max(0, Math.floor(meta.startingCredits));
    this.lives = Math.max(1, Math.floor(meta.startingCores));
    this.startingLives = this.lives;
    this.abilities = ABILITIES.map((def) => ({ def, cd: 0 }));
    this.freeplayState.relics = gauntletProtocolRelics(meta.relicIds);
    this.freeplayState.nextRelicOffer = [];
    this.freeplayState.lastRelicOfferWave = 0;
    this.freeplayState.currentMutators = [];
    this.freeplayState.nextMutators = [];
    this.freeplayState.riskOffer = null;
    this.freeplayState.riskAccepted = null;
    this.recorder.setStartingResources(this.credits, this.lives);
    this.recorder.recordCustom('gauntlet_protocol_leg_start', this.telemetryState(), {
      week: meta.week,
      gauntletRunId: meta.gauntletRunId,
      leg: meta.leg,
      route: meta.route,
      relicIds: meta.relicIds,
      startingCash: this.credits,
      startingLives: this.lives,
    });
    this.announce(`Gauntlet Protocol leg ${meta.leg}: ${this.map.name}`);
  }

  /** Compatibility alias for older tests/dev handles. Daily is no longer freeplay. */
  startDailyFreeplay(challenge = dailyChallenge()) {
    this.startDailyChallenge(challenge);
  }

  chooseRelic(id: FreeplayRelicId): FreeplayRelic | null {
    const relic = this.freeplayState.nextRelicOffer.find((r) => r.id === id);
    if (!relic) return null;
    this.freeplayState.relics.push(relic);
    this.freeplayState.nextRelicOffer = [];
    this.freeplayState.lastRelicOfferWave = this.wave;
    this.prepareFreeplayBuild();
    this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RELIC_SELECT, { relicId: relic.id, relicName: relic.name, relicCount: this.freeplayState.relics.length });
    this.announce(`Relic bound: ${relic.name}`);
    return relic;
  }

  acceptRisk(id: RiskWaveId): boolean {
    const offer = this.freeplayState.riskOffer?.id === id ? this.freeplayState.riskOffer : null;
    if (!offer || this.phase !== 'build' || !this.freeplay) return false;
    this.freeplayState.riskAccepted = offer;
    this.freeplayState.riskOffer = null;
    this.freeplayState.nextMutators = nextMutators(this.wave + 1, this.freeplayState.relics, this.freeplayState.daily, offer);
    this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RISK_ACCEPT, { riskId: offer.id, mutators: offer.mutatorIds, scoreMult: offer.scoreMult });
    this.announce(`Red-alert accepted: ${offer.name}`);
    return true;
  }

  declineRisk() {
    if (!this.freeplayState.riskOffer) return;
    this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RISK_DECLINE, { riskId: this.freeplayState.riskOffer.id });
    this.freeplayState.riskOffer = null;
  }

  canBankFreeplay(): boolean {
    return this.freeplay && this.phase === 'build' && this.wave > this.freeplayState.lastCheckpointWave;
  }

  markFreeplayCheckpoint(): boolean {
    if (!this.canBankFreeplay()) return false;
    this.freeplayState.lastCheckpointWave = Math.max(this.freeplayState.lastCheckpointWave, this.wave);
    this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_CHECKPOINT_SUBMIT, {
      wave: this.wave,
      multiplier: freeplayScoreMultiplier(this.freeplayState),
      summary: freeplaySummary(this.freeplayState),
    });
    return true;
  }

  freeplayMeta() {
    return {
      contract: this.freeplayState.contract?.name ?? '',
      contractId: this.freeplayState.contract?.id ?? '',
      relics: this.freeplayState.relics.map((r) => r.name).join(', '),
      relicIds: this.freeplayState.relics.map((r) => r.id).join(','),
      mutators: this.freeplayState.currentMutators.map((m) => m.name).join(', '),
      rival: this.freeplayState.rival?.name ?? '',
      daily: this.freeplayState.daily?.id ?? '',
      riskCleared: this.freeplayState.riskCleared,
      scoreMult: freeplayScoreMultiplier(this.freeplayState),
      summary: freeplaySummary(this.freeplayState),
    };
  }

  dailyMeta() {
    const challenge = this.dailyChallenge;
    const weekly = this.challengeMode === 'weekly';
    const drill = this.challengeMode === 'drill';
    return {
      daily: !weekly ? challenge?.id ?? '' : '',
      weekly: weekly ? challenge?.id ?? '' : '',
      label: weekly ? 'Weekly Mutation' : drill ? 'Protocol Drill' : 'Daily Challenge',
      modifiers: challenge ? (weekly ? weeklyModifierNames(challenge as WeeklyChallenge) : dailyModifierNames(challenge)) : [],
      summary: challenge ? (weekly ? weeklyModifierNames(challenge as WeeklyChallenge) : dailyModifierNames(challenge)).join(' / ') : '',
      arsenal: challenge?.arsenal.name ?? '',
      twist: challenge?.twist.name ?? '',
      boon: challenge?.boon.name ?? '',
    };
  }

  private recordFreeplayEvent(type: string, payload: Record<string, unknown>) {
    this.recorder.recordCustom(type, this.telemetryState(), payload);
  }

  private prepareFreeplayBuild() {
    if (!this.freeplay) return;
    if (this.wave > 0 && this.wave % 5 === 0 && this.freeplayState.nextRelicOffer.length === 0 && this.freeplayState.lastRelicOfferWave !== this.wave) {
      const offer = relicOffer(this.wave, this.freeplayState.relics, this.freeplayState.daily);
      this.freeplayState.nextRelicOffer = offer;
      this.freeplayState.lastRelicOfferWave = this.wave;
      if (offer.length > 0) this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RELIC_OFFER, { relicIds: offer.map((r) => r.id), wave: this.wave });
    }
    this.freeplayState.riskOffer = this.freeplayState.riskAccepted ? null : riskOfferForWave(this.wave + 1, this.freeplayState.daily);
    if (this.freeplayState.riskOffer) {
      this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RISK_OFFER, { riskId: this.freeplayState.riskOffer.id, wave: this.wave + 1 });
    }
    this.freeplayState.nextMutators = nextMutators(this.wave + 1, this.freeplayState.relics, this.freeplayState.daily, this.freeplayState.riskAccepted);
  }

  private maybeGrantDailyCreditCache(nextWave: number) {
    const boon = this.dailyChallenge?.boon;
    if (!boon?.creditCacheWave || !boon.creditCacheAmount || this.dailyCreditCacheGranted) return;
    if (nextWave !== boon.creditCacheWave) return;
    this.dailyCreditCacheGranted = true;
    this.earn(boon.creditCacheAmount);
    this.recorder.recordCustom('daily_credit_cache', this.telemetryState(), {
      dailyId: this.dailyChallenge?.id ?? '',
      credits: boon.creditCacheAmount,
      nextWave,
    });
    this.announce(`Daily cache opened: +${boon.creditCacheAmount} credits`);
  }

  cost(def: TowerDef): number {
    const b = getBalance();
    const dailyCost = this.dailyChallenge?.arsenal.costMultiplier ?? 1;
    return Math.round((def.cost * b.tower(def.id).costMult * this.diff.costMult * b.diff(this.diff.id).costMult * dailyCost) / 5) * 5;
  }

  /** Blackout Reach: towers outside every beacon zone lose 35% range */
  rangeFactor(pos: Vec): number {
    if (!this.map.zones) return 1;
    return this.map.zones.some((z) => Math.hypot(pos.x - z.x, pos.y - z.y) <= z.r) ? 1 : 0.65;
  }

  tierOf(t: Tower, track: 0 | 1): number {
    return track === 0 ? t.tierA : t.tierB;
  }

  /** null = maxed; otherwise why-locked reason or 'ok' */
  upgradeState(t: Tower, track: 0 | 1): 'ok' | 'maxed' | 'locked' {
    const tier = this.tierOf(t, track);
    const cap = this.dailyChallenge?.arsenal.upgradeTierCap;
    if (cap != null && tier >= cap) return 'maxed';
    if (tier >= 6) return 'maxed';
    if (tier >= 4 && t.committed !== null && t.committed !== track) return 'locked';
    return 'ok';
  }

  upgradeCost(t: Tower, track: 0 | 1): number {
    const tier = this.tierOf(t, track);
    const cap = this.dailyChallenge?.arsenal.upgradeTierCap;
    if (cap != null && tier >= cap) return 0;
    if (tier >= 6) return 0;
    // the two committed bonus tiers cost dramatically more — a real late-game sink
    const freeplaySink = this.freeplay && tier >= 4 ? (tier === 4 ? 1.35 : 1.55) : 1;
    const bonusMult = (tier === 4 ? 3.2 : tier === 5 ? 6.5 : 1) * freeplaySink;
    const b = getBalance();
    const dailyCost = this.dailyChallenge?.arsenal.costMultiplier ?? 1;
    return Math.round((t.def.tracks[track].upgrades[tier].cost * b.tower(t.def.id).costMult * this.diff.costMult * b.diff(this.diff.id).costMult * bonusMult * dailyCost) / 5) * 5;
  }

  /** Committed bonus tiers make a tower genuinely overpowered — the payoff for the
   *  steep price/commitment. Stacks atop each upgrade's own effect. */
  static bonusPower(t: Tower): number {
    const top = Math.max(t.tierA, t.tierB);
    return top >= 6 ? 2.0 : top >= 5 ? 1.45 : 1;
  }

  freeplayTowerPower(t: Tower): number {
    let mult = this.dailyChallenge?.twist.towerDamageMultiplier ?? 1;
    if (!this.freeplay) return mult;
    const top = Math.max(t.tierA, t.tierB);
    mult *= top >= 6 ? 1.22 : top >= 5 ? 1.1 : 1;
    const type = t.stats.damageType;
    if (this.freeplayState.contract?.bonusType === type) mult *= 1.15;
    if (this.freeplayState.contract?.penaltyType === type) mult *= 0.88;
    if (this.freeplayState.relics.some((r) => r.id === 'siegeDoctrine') && (t.def.style === 'missile' || t.def.style === 'rail' || t.def.style === 'beam')) mult *= 1.18;
    if (this.freeplayState.relics.some((r) => r.id === 'stormCapacitors') && (type === 'energy' || t.def.style === 'arc')) mult *= 1.12;
    return mult;
  }

  // ---------- placement ----------

  placementBlockReason(pos: Vec): string | null {
    if (pos.x < TOWER_R || pos.y < TOWER_R || pos.x > W - TOWER_R || pos.y > H - TOWER_R) return 'inside the build boundary';
    const clearance = this.map.pathWidth / 2 + TOWER_R - 4;
    for (let i = 1; i < this.map.path.length; i++) {
      if (distToSeg(pos, this.map.path[i - 1], this.map.path[i]) < clearance) return 'too close to the hostile lane';
    }
    for (const b of this.map.blockers) {
      if (b.r > 0 && Math.hypot(pos.x - b.x, pos.y - b.y) < b.r + TOWER_R - 4) return 'blocked by terrain';
    }
    for (const t of this.towers) {
      if (Math.hypot(pos.x - t.pos.x, pos.y - t.pos.y) < TOWER_R * 2 - 2) return 'too close to another tower';
    }
    return null;
  }

  canPlace(pos: Vec): boolean {
    return this.placementBlockReason(pos) === null;
  }

  private terminalControlsLocked(): boolean {
    return this.phase === 'gameover' || this.phase === 'victory';
  }

  placeTower(def: TowerDef, pos: Vec): Tower | null {
    const cost = this.cost(def);
    if (this.terminalControlsLocked()) {
      sfx.error();
      return null;
    }
    if (this.dailyTowerIds && !this.dailyTowerIds.has(def.id)) {
      this.recorder.recordFailedPlacement(this.telemetryState(), def.id, 'daily_pool', cost, pos);
      this.announce(`${def.name} is not in today's Daily Challenge arsenal`);
      sfx.error();
      return null;
    }
    // enforce campaign unlocks in the ENGINE, not only the shop UI — replay and
    // leaderboard integrity cannot trust placements that only the UI gates
    if (!this.towerAvailable(def)) {
      this.recorder.recordFailedPlacement(this.telemetryState(), def.id, 'locked', cost, pos);
      this.announce(`${def.name} pattern is not decrypted yet`);
      sfx.error();
      return null;
    }
    const maxTowers = this.freeplayState.contract?.maxTowers;
    if (maxTowers && this.towers.length >= maxTowers) {
      this.recorder.recordFailedPlacement(this.telemetryState(), def.id, 'contract', cost, pos);
      this.announce(`${this.freeplayState.contract?.short} contract: tower cap reached`);
      sfx.error();
      return null;
    }
    const blockReason = this.placementBlockReason(pos);
    if (this.credits < cost || blockReason) {
      this.recorder.recordFailedPlacement(this.telemetryState(), def.id, this.credits < cost ? 'credits' : 'space', cost, pos);
      this.announce(this.credits < cost
        ? `${def.name} needs ${cost - this.credits} more credits`
        : `Cannot build here: ${blockReason}`);
      sfx.error();
      return null;
    }
    this.credits -= cost;
    const t: Tower = {
      uid: this.uidSeq++,
      def,
      pos: { ...pos },
      stats: computeStats(def, 0, 0),
      tierA: 0,
      tierB: 0,
      committed: null,
      cooldown: 0,
      angle: -Math.PI / 2,
      target: 'first',
      targetFilters: [],
      invested: cost,
      kills: 0,
      rateBuff: 1,
      rangeBuff: 1,
      flash: 0,
      recoil: 0,
    };
    this.towers.push(t);
    this.recorder.recordTowerPlace(this.telemetryState(), t, cost);
    sfx.build();
    this.ring(pos, def.glow, 30);
    return t;
  }

  upgradeTower(t: Tower, track: 0 | 1): boolean {
    if (this.terminalControlsLocked()) {
      sfx.error();
      return false;
    }
    const cost = this.upgradeCost(t, track);
    const state = this.upgradeState(t, track);
    if (cost === 0 || this.credits < cost || state !== 'ok') {
      this.recorder.recordFailedUpgrade(this.telemetryState(), t, track, cost === 0 ? 'maxed' : this.credits < cost ? 'credits' : state, cost);
      this.announce(cost === 0 || state === 'maxed'
        ? `${t.def.name} track is already maxed`
        : this.credits < cost
          ? `${t.def.name} upgrade needs ${cost - this.credits} more credits`
          : `${t.def.name} is committed to the other upgrade track`);
      sfx.error();
      return false;
    }
    const upgradeName = t.def.tracks[track].upgrades[this.tierOf(t, track)].name;
    this.credits -= cost;
    t.invested += cost;
    if (track === 0) t.tierA++; else t.tierB++;
    // buying a bonus tier (5+) commits the tower to that track
    if (this.tierOf(t, track) >= 5) t.committed = track;
    t.stats = computeStats(t.def, t.tierA, t.tierB);
    this.recorder.recordTowerUpgrade(this.telemetryState(), t, track, cost, upgradeName);
    sfx.upgrade();
    this.ring(t.pos, '#ffffff', 26);
    return true;
  }

  /** Save the current defense layout (positions + tiers) as this map's blueprint. */
  saveBlueprint(): number {
    if (this.isDailyChallenge) {
      this.announce('Daily simulations do not overwrite campaign blueprints');
      sfx.error();
      return 0;
    }
    if (this.freeplay && this.freeplayState.contract?.noBlueprint) {
      this.announce(`${this.freeplayState.contract.short} contract forbids blueprint saving`);
      sfx.error();
      return 0;
    }
    const bp = this.towers.map((t) => ({
      id: t.def.id,
      x: Math.round(t.pos.x),
      y: Math.round(t.pos.y),
      a: t.tierA,
      b: t.tierB,
    }));
    progress.saveBlueprint(this.map.id, bp);
    this.recorder.recordBlueprint(this.telemetryState(), 'save', bp.length);
    this.announce(`⬇ Defense layout saved — ${bp.length} instruments`);
    sfx.archive();
    return bp.length;
  }

  /** Rebuild the saved blueprint, placing and upgrading as far as credits allow. */
  applyBlueprint(): number {
    if (this.freeplay && this.freeplayState.contract?.noBlueprint) {
      this.announce(`${this.freeplayState.contract.short} contract forbids blueprint redeploy`);
      sfx.error();
      return 0;
    }
    const bp = progress.blueprint(this.map.id);
    let placed = 0;
    for (const e of bp) {
      const def = TOWER_MAP[e.id];
      if (!def || !this.towerAvailable(def)) continue;
      const pos = { x: e.x, y: e.y };
      if (this.credits < this.cost(def) || !this.canPlace(pos)) continue;
      const t = this.placeTower(def, pos);
      if (!t) continue;
      placed++;
      // re-buy upgrades in saved order: track A first, then B (commit rules apply naturally)
      while (t.tierA < e.a && this.upgradeState(t, 0) === 'ok' && this.credits >= this.upgradeCost(t, 0)) {
        if (!this.upgradeTower(t, 0)) break;
      }
      while (t.tierB < e.b && this.upgradeState(t, 1) === 'ok' && this.credits >= this.upgradeCost(t, 1)) {
        if (!this.upgradeTower(t, 1)) break;
      }
    }
    this.announce(placed > 0
      ? `⬆ Blueprint deployed — ${placed} of ${bp.length} instruments rebuilt`
      : '⬆ Blueprint deployment failed — no credits, space, or unlocks');
    this.recorder.recordBlueprint(this.telemetryState(), 'apply', placed);
    return placed;
  }

  sellTower(t: Tower) {
    if (this.terminalControlsLocked()) {
      sfx.error();
      return;
    }
    if (this.freeplay && this.freeplayState.contract?.noSell) {
      this.announce(`${this.freeplayState.contract.short} contract forbids selling`);
      sfx.error();
      return;
    }
    const refund = sellValue(t.invested);
    this.credits += refund;
    this.recorder.recordTowerSell(this.telemetryState(), t, refund);
    this.towers = this.towers.filter((x) => x !== t);
    sfx.sell();
    this.ring(t.pos, '#ffd32a', 24);
  }

  // ---------- waves ----------

  private prepareWave(wave: number): PreparedWave {
    let groups: Wave = this.gauntletProtocol
      ? gauntletProtocolWave(this.gauntletProtocol.leg, wave)
      : getWave(wave).map((group) => ({ ...group }));
    if (this.dailyChallenge) {
      groups = applyDailyWaveTwist(this.dailyChallenge, groups);
      if (this.dailyChallenge.twist.sensorBlackout) {
        groups = applyMutatorsToWave(wave, groups, [mutatorById('sensorBlackout')], null, null);
      }
    }
    let mutators: FreeplayMutator[] = [];
    let rival: FreeplayRival | null = null;
    if (this.freeplay) {
      mutators = this.freeplayState.nextMutators.length > 0
        ? this.freeplayState.nextMutators
        : nextMutators(wave, this.freeplayState.relics, this.freeplayState.daily, this.freeplayState.riskAccepted);
      rival = rivalForWave(wave, this.freeplayState.daily);
      groups = applyMutatorsToWave(wave, groups, mutators, rival, this.freeplayState.riskAccepted);
    }
    // Recruit protocol: the Combine never deploys phase-cloaks against a green Warden.
    if (this.diff.id === 'easy') groups = groups.map((group) => ({ ...group, cloaked: false }));
    return { groups, mutators, rival };
  }

  previewWave(wave = this.wave + 1): Wave {
    return this.prepareWave(Math.max(1, Math.floor(wave))).groups.map((group) => ({ ...group }));
  }

  startWave() {
    if (this.phase !== 'build') return;
    this.waveStartTotalKills = this.baseKills + this.totalKills;
    this.wave++;
    this.phase = 'wave';
    const prepared = this.prepareWave(this.wave);
    let def = prepared.groups;
    if (this.freeplay) {
      this.freeplayState.currentMutators = prepared.mutators;
      this.freeplayState.rival = prepared.rival;
      this.freeplayState.rivalLevel = prepared.rival ? this.freeplayState.rivalLevel + 1 : this.freeplayState.rivalLevel;
      this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_MUTATOR_WAVE_START, {
        wave: this.wave,
        mutators: prepared.mutators.map((m) => m.id),
        riskId: this.freeplayState.riskAccepted?.id ?? null,
      });
      if (prepared.rival) this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RIVAL_SPAWN, { rivalId: prepared.rival.id, rivalName: prepared.rival.name, level: this.freeplayState.rivalLevel });
    }
    def = planEliteWave(this.wave, def, this.rng);
    this.queue = def.map((group) => ({
      group,
      spawned: 0,
      timer: group.delay ?? 0,
      started: false,
    }));
    this.recorder.recordWaveStart(this.telemetryState(), this.queue.map((entry) => {
      const group: { type: string; count: number; cloaked: boolean; gap: number; delay: number; elites?: { i: number; a: EliteAffixId }[] } = {
        type: entry.group.type,
        count: entry.group.count,
        cloaked: !!entry.group.cloaked,
        gap: entry.group.gap,
        delay: entry.group.delay ?? 0,
      };
      if (entry.group.elites?.length) group.elites = entry.group.elites.map((elite) => ({ i: elite.i, a: elite.a }));
      return group;
    }));
    sfx.waveStart();
    if (this.freeplay && this.freeplayState.currentMutators.length > 0) {
      this.announce(`FREEPLAY MUTATORS: ${this.freeplayState.currentMutators.map((m) => m.name).join(' + ')}`);
    }
    // threat advisories
    if (!(this.freeplay && this.freeplayState.currentMutators.length > 0) && def.some((g) => g.type === 'mirror')) { this.announce('MIRROR HULL signature detected - adaptation scan imminent'); vox('wave-boss'); }
    else if (!(this.freeplay && this.freeplayState.currentMutators.length > 0) && def.some((g) => g.type === 'leviathan')) { this.announce('⚠ LEVIATHAN-CLASS SIGNATURE DETECTED'); vox('wave-leviathan'); }
    else if (!(this.freeplay && this.freeplayState.currentMutators.length > 0) && def.some((g) => g.type === 'titan')) { this.announce('⚠ TITAN-class carrier inbound'); vox('wave-boss'); }
    else if (!(this.freeplay && this.freeplayState.currentMutators.length > 0) && def.some((g) => g.cloaked)) { this.announce('⚠ Phase-cloaked signatures — sensor coverage advised'); vox('wave-cloaked'); }
    else { vox('wave-incoming'); }
    // capital-hull waves swap to the boss theme; normal waves resume the sector score
    setBossMusic(def.some((g) => ENEMIES[g.type]?.boss));
    for (const a of this.abilities) {
      if (a.def.unlockWave === this.wave) this.announce(`✦ Commander ability online: ${a.def.name}`);
    }
  }

  announce(text: string) {
    this.notice = text;
    this.noticeTimer = 4;
  }

  private makeEnemy(typeId: string, cloaked: boolean, eliteAffix?: EliteAffixId): Enemy {
    const def = ENEMIES[typeId];
    // first-ever sighting of this hull → queue a Bestiary reveal (UI drains + records it)
    if (!this.flaggedHostiles.has(typeId) && !progress.enemiesSeen.includes(typeId)) {
      this.flaggedHostiles.add(typeId);
      this.newHostiles.push(def);
    }
    // difficulty hp scaling ramps in over the first 25 waves so the early game
    // stays fair while the late game bites
    // remote balance overrides (identity 1× by default) multiply the static diff values
    const bo = getBalance();
    const bd = bo.diff(this.diff.id);
    const ramp = Math.min(1, this.wave / 25);
    const diffMult = 1 + (this.diff.hpMult * bd.hpMult - 1) * ramp;
    // post-25 climb that kills the mid-game "escape velocity" — steeper on the
    // harder protocols so Apex/Extinction keep demanding new strategy late.
    const late = 1 + Math.max(0, this.wave - 25) * this.diff.lateScale * bd.lateScale;
    // beyond the designed campaign (freeplay) the siege steepens hard.
    const fp = 1 + Math.max(0, this.wave - this.diff.waves) * 0.18;
    const mutatorHp =
      this.freeplay && def.boss && this.freeplayState.currentMutators.some((m) => m.id === 'shieldedBoss') ? 1.35 :
        this.freeplay && (def.armored || typeId === 'juggernaut' || typeId === 'aegis') && this.freeplayState.currentMutators.some((m) => m.id === 'armoredSwarm') ? 1.22 : 1;
    const rivalHp = this.freeplay && def.boss && this.freeplayState.rival ? 1 + this.freeplayState.rivalLevel * 0.12 : 1;
    const dailyHp = this.dailyChallenge?.twist.enemyHpMultiplier ?? 1;
    const eliteShieldBaseHp = Math.ceil(def.hp * bo.enemy(typeId).hpMult * diffMult * late * fp * mutatorHp * rivalHp);
    const hp = Math.ceil(eliteShieldBaseHp * dailyHp);
    const e: Enemy = {
      uid: this.uidSeq++,
      def,
      hp,
      maxHp: hp,
      pos: { ...this.map.path[0] },
      wp: 1,
      dist: 0,
      slow: 1,
      slowTimer: 0,
      burnDps: 0,
      burnTimer: 0,
      resonance: 0,
      resonanceTimer: 0,
      exposed: 0,
      exposedTimer: 0,
      cloaked,
      phase: this.rng() * Math.PI * 2,
      dead: false,
      finished: false,
    };
    if (eliteAffix && !def.boss) {
      e.elite = makeEliteState(eliteAffix, eliteShieldBaseHp, this.wave);
      if (!this.flaggedHostiles.has(ELITE_VARIANT_DEF.id) && !progress.enemiesSeen.includes(ELITE_VARIANT_DEF.id)) {
        this.flaggedHostiles.add(ELITE_VARIANT_DEF.id);
        this.newHostiles.push(ELITE_VARIANT_DEF);
      }
    }
    if (def.id === 'umbra') {
      e.umbraPhase = 1;
      e.umbraSummonCd = 4.5;
      e.umbraTickDamage = 0;
    }
    if (def.id === 'mirror') {
      const type = this.topDamageTypeSoFar() ?? this.adaptation.type ?? 'kinetic';
      e.mirrorResist = { type, resist: MIRROR_HULL_BASE_RESIST, weakenedTimer: 0 };
      this.announce(`MIRROR HULL calibrated against ${type.toUpperCase()}`);
    }
    return e;
  }

  private topDamageTypeSoFar(): DamageType | null {
    const entries = Object.entries(this.dmgByTypeTotal).sort((a, b) => b[1] - a[1]);
    return entries.length > 0 && entries[0][1] > 0 ? entries[0][0] as DamageType : null;
  }

  private spawnEnemy(typeId: string, cloaked: boolean, eliteAffix?: EliteAffixId) {
    const e = this.makeEnemy(typeId, cloaked, eliteAffix);
    e.replayWave = this.wave;
    e.replaySpawnT = this.time;
    if (cloaked && !this.cloakTipShown && !progress.cloakTipSeen) {
      this.cloakTipShown = true;
      this.cloakTipPending = true;
    }
    this.enemies.push(e);
    if (e.def.id === 'umbra') this.recorder.recordUmbraPhase(this.telemetryState(), e.uid, 1);
  }

  private spawnChildren(parent: Enemy) {
    for (let i = 0; i < parent.def.children.length; i++) {
      const e = this.makeEnemy(parent.def.children[i], parent.cloaked);
      e.pos = { x: parent.pos.x + (this.rng() - 0.5) * 14, y: parent.pos.y + (this.rng() - 0.5) * 14 };
      e.wp = parent.wp;
      e.dist = Math.max(0, parent.dist - i * 12);
      e.replayWave = parent.replayWave ?? this.wave;
      e.replaySpawnT = this.time;
      this.enemies.push(e);
    }
  }

  private spawnEliteSplitChildren(parent: Enemy) {
    const children = eliteSplitChildren(parent.def.id);
    for (let i = 0; i < children.length; i++) {
      const e = this.makeEnemy(children[i], parent.cloaked);
      e.pos = { x: parent.pos.x + (this.rng() - 0.5) * 24, y: parent.pos.y + (this.rng() - 0.5) * 24 };
      e.wp = parent.wp;
      e.dist = Math.max(0, parent.dist - 18 - i * 14);
      // replay provenance: the death ledger needs spawn context for EVERY enemy
      e.replayWave = parent.replayWave ?? this.wave;
      e.replaySpawnT = this.time;
      this.enemies.push(e);
    }
    this.ring(parent.pos, ELITE_AFFIX_META.splitting.glow, parent.def.radius + 16);
  }

  /** position and waypoint index for a given distance along the path */
  private posAtDist(dist: number): { pos: Vec; wp: number } {
    const path = this.map.path;
    let remaining = Math.max(0, dist);
    for (let i = 0; i < this.segLengths.length; i++) {
      if (remaining <= this.segLengths[i]) {
        const a = path[i], b = path[i + 1];
        const t = this.segLengths[i] === 0 ? 0 : remaining / this.segLengths[i];
        return { pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, wp: i + 1 };
      }
      remaining -= this.segLengths[i];
    }
    return { pos: { ...path[path.length - 1] }, wp: path.length };
  }

  private pathLength(): number {
    return this.segLengths.reduce((a, b) => a + b, 0);
  }

  // ---------- damage ----------

  /** Veterancy: towers earn ranks from kills; each rank adds 6% damage. */
  static rankOf(t: Tower): number {
    return t.kills >= 150 ? 3 : t.kills >= 60 ? 2 : t.kills >= 20 ? 1 : 0;
  }

  private eliteBulwarkProtects(e: Enemy): boolean {
    if (e.def.boss) return false;
    let protectedByBulwark = false;
    this.grid.forEachInRadius(e.pos.x, e.pos.y, BULWARK_RADIUS, (o) => {
      if (protectedByBulwark || o === e || o.dead || o.finished || o.def.boss || o.elite?.id !== 'bulwark') return;
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) <= BULWARK_RADIUS) protectedByBulwark = true;
    });
    return protectedByBulwark;
  }

  private capUmbraDamage(e: Enemy, dmg: number): number {
    if (e.def.id !== 'umbra' || e.umbraPhase !== 1) return dmg;
    const cap = Math.max(16, Math.min(36, e.maxHp * 0.0075));
    const used = e.umbraTickDamage ?? 0;
    const allowed = Math.max(0, cap - used);
    const applied = Math.min(dmg, allowed);
    e.umbraTickDamage = used + applied;
    return applied;
  }

  private umbraSpeedMult(e: Enemy): number {
    if (e.def.id !== 'umbra') return 1;
    if (e.umbraPhase === 3) return 1.22;
    if (e.umbraPhase === 2 && (e.umbraCloakTimer ?? 0) > 0) return 0.72;
    return 1;
  }

  private bossPulseInterval(e: Enemy): number {
    if (e.def.id === 'umbra') {
      if (e.umbraPhase === 3) return 2.7;
      if (e.umbraPhase === 2) return 3.6;
      return 4.6;
    }
    return e.def.id === 'leviathan' ? 4 : 5.5;
  }

  private bossPulseRadius(e: Enemy): number {
    if (e.def.id === 'umbra') {
      if (e.umbraPhase === 3) return 170;
      if (e.umbraPhase === 2) return 145;
      return 130;
    }
    return e.def.id === 'leviathan' ? 160 : 120;
  }

  private updateUmbra(e: Enemy, dt: number) {
    if (e.def.id !== 'umbra') return;
    if (!e.umbraPhase) e.umbraPhase = 1;
    if (e.umbraPhase === 1) {
      e.umbraSummonCd = (e.umbraSummonCd ?? 4.5) - dt;
      if (e.umbraSummonCd <= 0) {
        e.umbraSummonCd += 6.2;
        this.summonUmbraWisps(e);
      }
    }
    if ((e.umbraCloakTimer ?? 0) > 0) {
      e.umbraCloakTimer = Math.max(0, (e.umbraCloakTimer ?? 0) - dt);
      if (e.umbraCloakTimer <= 0 && e.umbraPhase === 2) {
        e.cloaked = false;
        e.revealed = false;
        this.ring(e.pos, e.def.glow, e.def.radius + 18);
      }
    }
  }

  private summonUmbraWisps(e: Enemy) {
    let activeWisps = 0;
    for (const other of this.enemies) {
      if (!other.dead && !other.finished && other.def.id === 'wisp') activeWisps++;
    }
    if (activeWisps >= 16) return;
    const count = Math.min(2, 16 - activeWisps);
    for (let i = 0; i < count; i++) {
      const dist = Math.max(0, e.dist - 62 - i * 28);
      const spot = this.posAtDist(dist);
      const wisp = this.makeEnemy('wisp', false);
      wisp.pos = { x: spot.pos.x + (this.rng() - 0.5) * 22, y: spot.pos.y + (this.rng() - 0.5) * 22 };
      wisp.wp = spot.wp;
      wisp.dist = dist;
      this.enemies.push(wisp);
    }
    this.ring(e.pos, '#b388ff', e.def.radius + 34);
  }

  private maybeAdvanceUmbraPhase(e: Enemy) {
    if (e.def.id !== 'umbra' || e.dead || e.finished) return;
    const pct = e.hp / e.maxHp;
    if ((e.umbraPhase ?? 1) < 2 && pct <= 0.66) this.transitionUmbra(e, 2);
    if ((e.umbraPhase ?? 1) < 3 && pct <= 0.33) this.transitionUmbra(e, 3);
  }

  private transitionUmbra(e: Enemy, phase: 2 | 3) {
    if (phase <= (e.umbraPhase ?? 1)) return;
    e.umbraPhase = phase;
    this.clearExposed(e);
    if (phase === 2) {
      const maxDist = Math.max(0, this.pathLength() - SAFE_EXIT_MARGIN);
      const nextDist = Math.min(maxDist, e.dist + 260);
      const spot = this.posAtDist(nextDist);
      e.dist = nextDist;
      e.wp = spot.wp;
      e.pos = spot.pos;
      e.cloaked = true;
      e.revealed = false;
      e.umbraCloakTimer = 3.4;
      e.pulseCd = Math.min(e.pulseCd ?? 2.2, 2.2);
      this.announce('THE UMBRA phase-shifts - detector coverage advised');
      vox('wave-cloaked');
      this.ring(e.pos, '#7d5fff', e.def.radius + 30);
    } else {
      e.cloaked = false;
      e.revealed = false;
      e.umbraCloakTimer = 0;
      e.pulseCd = Math.min(e.pulseCd ?? 1.2, 1.2);
      this.announce('THE UMBRA enrages - disruption cadence rising');
      vox('wave-boss');
      this.ring(e.pos, '#ff5a6e', e.def.radius + 40);
      this.shake = Math.min(1, this.shake + 0.45);
    }
    this.recorder.recordUmbraPhase(this.telemetryState(), e.uid, phase);
  }

  /** Returns actual damage dealt (0 if immune). */
  damageEnemy(e: Enemy, dmg: number, type: Projectile['damageType'], shred: boolean, src?: Tower): number {
    if (e.dead || e.finished) return 0;
    if (shred) this.applyExposed(e);
    dmg *= this.resistanceMultiplier(e, type);
    if (this.dailyChallenge?.twist.enemyDamageTakenMultiplier) dmg *= this.dailyChallenge.twist.enemyDamageTakenMultiplier;
    if (dmg <= 0) return 0;
    if (src) dmg *= (1 + 0.06 * Game.rankOf(src)) * Game.bonusPower(src) * this.freeplayTowerPower(src);
    if (this.freeplay && type === 'explosive' && this.freeplayState.relics.some((r) => r.id === 'emberDoctrine')) dmg *= 1.12;
    if (this.freeplay && e.def.boss && this.freeplayState.currentMutators.some((m) => m.id === 'shieldedBoss')) dmg *= 0.82;
    if (e.resonance > 0) dmg *= 1 + 0.10 * e.resonance;
    dmg *= this.exposedDamageTakenMultiplier(e);
    if (this.adaptation.type === type) dmg *= 1 - this.adaptation.resist;
    if (e.mirrorResist?.type === type) {
      dmg *= 1 - Math.max(0, Math.min(MIRROR_HULL_BASE_RESIST, e.mirrorResist.resist));
    }
    if (this.eliteBulwarkProtects(e)) dmg *= BULWARK_DAMAGE_MULT;
    dmg = this.capUmbraDamage(e, dmg);
    if (dmg <= 0) return 0;

    let shieldAbsorbed = 0;
    if (e.elite?.id === 'shielded' && (e.elite.shield ?? 0) > 0) {
      shieldAbsorbed = Math.min(dmg, e.elite.shield ?? 0);
      e.elite.shield = Math.max(0, (e.elite.shield ?? 0) - shieldAbsorbed);
      dmg -= shieldAbsorbed;
      if (shieldAbsorbed > 0 && e.elite.shield <= 0) {
        this.ring(e.pos, ELITE_AFFIX_META.shielded.glow, e.def.radius + 18);
        this.burstFx(e.pos, ELITE_AFFIX_META.shielded.glow, 8);
        sfx.zap();
      }
    }

    const credited = shieldAbsorbed + dmg;
    this.dmgWindow[type] = (this.dmgWindow[type] ?? 0) + credited;
    this.dmgByTypeTotal[type] = (this.dmgByTypeTotal[type] ?? 0) + credited;
    if (src) {
      this.runStats.dmg[src.def.id] = (this.runStats.dmg[src.def.id] ?? 0) + credited;
      this.runStats.dmgByTowerUid[src.uid] = (this.runStats.dmgByTowerUid[src.uid] ?? 0) + credited;
    }
    if (dmg <= 0) return 0;
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.killEnemy(e);
      if (src) src.kills++;
    } else {
      this.maybeAdvanceUmbraPhase(e);
    }
    return dmg;
  }

  private applyExposed(e: Enemy): void {
    e.exposed = Math.min(EXPOSED_MAX_STACKS, (e.exposed ?? 0) + 1);
    e.exposedTimer = EXPOSED_DURATION;
  }

  private clearExposed(e: Enemy): void {
    e.exposed = 0;
    e.exposedTimer = 0;
  }

  private resistanceMultiplier(e: Enemy, type: Projectile['damageType']): number {
    let mult = 1;
    if (e.def.armored && type === 'kinetic') mult *= this.exposedAdjustedResist(RESIST_ARMORED, e);
    if (e.def.immuneExplosive && type === 'explosive') mult *= this.exposedAdjustedResist(RESIST_BLAST, e);
    if (e.def.immuneCryo && type === 'cryo') mult *= this.exposedAdjustedResist(RESIST_CRYO, e);
    const r = e.def.resist?.[type];
    if (r != null) mult *= this.exposedAdjustedResist(r, e);
    return mult;
  }

  private exposedAdjustedResist(baseDamageTaken: number, e: Enemy): number {
    const stacks = Math.max(0, Math.min(EXPOSED_MAX_STACKS, e.exposed ?? 0));
    if (stacks <= 0) return baseDamageTaken;
    const resistance = Math.max(0, 1 - baseDamageTaken - stacks * EXPOSED_RESIST_STRIP_PER_STACK);
    return Math.min(1, 1 - resistance);
  }

  private exposedDamageTakenMultiplier(e: Enemy): number {
    const stacks = Math.max(0, Math.min(EXPOSED_MAX_STACKS, e.exposed ?? 0));
    return stacks > 0 ? 1 + stacks * EXPOSED_DAMAGE_TAKEN_PER_STACK : 1;
  }

  /** Single-slot burn. A stronger burn replaces dps, remaining time, AND credit;
   *  an equal burn refreshes the timer; a weaker burn never dilutes or extends a
   *  stronger one. The old Math.max merge turned a weak-long + strong-short pair
   *  into strong-long (over-buff), and burn kills credited no tower. */
  private applyBurn(e: Enemy, dps: number, duration: number, src?: Tower) {
    if (dps <= 0 || duration <= 0) return;
    if (dps > e.burnDps) {
      e.burnDps = dps;
      e.burnTimer = duration;
      e.burnSrc = src;
    } else if (dps === e.burnDps) {
      e.burnTimer = Math.max(e.burnTimer, duration);
      e.burnSrc = e.burnSrc ?? src;
    }
  }

  /** Ability damage — bypasses all immunities. */
  trueDamage(e: Enemy, dmg: number) {
    if (e.dead || e.finished) return;
    dmg *= this.exposedDamageTakenMultiplier(e);
    dmg = this.capUmbraDamage(e, dmg);
    if (dmg <= 0) return;
    if (e.elite?.id === 'shielded' && (e.elite.shield ?? 0) > 0) {
      const absorbed = Math.min(dmg, e.elite.shield ?? 0);
      e.elite.shield = Math.max(0, (e.elite.shield ?? 0) - absorbed);
      dmg -= absorbed;
      if (absorbed > 0 && e.elite.shield <= 0) {
        this.ring(e.pos, ELITE_AFFIX_META.shielded.glow, e.def.radius + 18);
        this.burstFx(e.pos, ELITE_AFFIX_META.shielded.glow, 8);
      }
    }
    if (dmg <= 0) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.killEnemy(e);
    else this.maybeAdvanceUmbraPhase(e);
  }

  applySlow(e: Enemy, power: number, duration: number) {
    if (e.def.immuneCryo || e.def.boss) return;
    const slow = 1 - power;
    if (slow < e.slow || e.slowTimer <= 0) {
      e.slow = Math.min(e.slow, slow);
      e.slowTimer = Math.max(e.slowTimer, duration);
    }
  }

  private killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    const dailyIncome = this.dailyChallenge?.twist.killRewardMultiplier ?? 1;
    const reward = Math.max(1, Math.round(e.def.reward * (e.elite?.rewardMult ?? 1) * getBalance().enemy(e.def.id).rewardMult * getBalance().killMult * incomeMult(this.wave) *
      (this.freeplay ? freeplayIncomeMult(this.wave, this.freeplayState.relics, this.freeplayState.currentMutators) : 1) * dailyIncome));
    this.earn(reward);
    this.totalKills++;
    this.runStats.kills[e.def.id] = (this.runStats.kills[e.def.id] ?? 0) + 1;
    this.recorder.recordEnemyKill(this.telemetryState(), e);
    this.spawnChildren(e);
    if (e.elite?.id === 'splitting') this.spawnEliteSplitChildren(e);
    if (e.def.boss) {
      sfx.bossDown();
      vox(e.def.id === 'leviathan' ? 'leviathan-down' : 'titan-down');
      this.explosionFx(e.pos, e.def.glow, e.def.radius * 2.2);
      this.shake = Math.min(1, this.shake + 0.7);
      this.dropPickup(e.pos, true);
    } else {
      if (e.def.hp >= 3 || e.def.armored) {
        sfx.crunch(); // heavy hulls die like machines, not balloons
        this.explosionFx(e.pos, e.def.glow, e.def.radius * 1.6);
      } else {
        sfx.pop();
        this.burstFx(e.pos, e.def.glow, 7);
        this.ring(e.pos, e.def.glow, e.def.radius + 6);
      }
      // credit popup
      this.emit('text', e.pos.x, e.pos.y - e.def.radius - 4, 0, -26, 0.7, 10, '#ffd32a', `+${reward}`);
      // drop chance shrinks as kill volume grows in later waves
      const pickupMult = this.dailyChallenge?.boon.pickupDropMultiplier ?? 1;
      if (this.rng() < (0.022 * pickupMult) / (1 + this.wave * 0.04)) this.dropPickup(e.pos, false);
    }
  }

  private dropPickup(pos: Vec, boss: boolean) {
    if (this.pickups.length >= 3) return; // no carpet of beacons in dense waves
    const roll = this.rng();
    const kind: PickupKind = boss
      ? (roll < 0.5 ? 'credits' : roll < 0.8 ? 'core' : 'frenzy')
      : (roll < 0.55 ? 'credits' : roll < 0.75 ? 'frenzy' : roll < 0.92 ? 'cryoburst' : 'core');
    this.pickups.push({
      uid: this.uidSeq++,
      kind,
      pos: { x: Math.max(20, Math.min(W - 20, pos.x)), y: Math.max(20, Math.min(H - 20, pos.y)) },
      life: 7,
      maxLife: 7,
    });
  }

  /** Try to collect a pickup near a click. Returns true if one was collected. */
  collectPickup(pos: Vec): boolean {
    const p = this.pickups.find((pk) => Math.hypot(pk.pos.x - pos.x, pk.pos.y - pos.y) <= 20);
    if (!p) return false;
    this.pickups = this.pickups.filter((x) => x !== p);
    let value = 0;
    switch (p.kind) {
      case 'credits': {
        const amount = 40 + this.wave * 4;
        value = amount;
        this.earn(amount);
        this.announce(`⌬ Salvage cache recovered: +${amount}`);
        break;
      }
      case 'frenzy':
        this.frenzyTimer = 5;
        this.announce('⚡ Combat stims: towers +50% fire rate');
        break;
      case 'cryoburst':
        for (const e of this.enemies) {
          if (!e.def.boss) { e.slow = 0.15; e.slowTimer = Math.max(e.slowTimer, 2.5); }
        }
        this.ring(p.pos, '#7efff5', 200);
        this.announce('❄ Cryo burst: hostiles flash-frozen');
        break;
      case 'core':
        value = 1;
        this.lives += 1;
        this.announce('⬢ Reactor core recovered: +1 core');
        break;
    }
    this.recorder.recordPickupCollect(this.telemetryState(), p.kind, p.pos, value);
    sfx.pickup();
    this.ring(p.pos, '#ffd32a', 26);
    return true;
  }

  // ---------- commander abilities ----------

  abilityReady(id: AbilityId): boolean {
    if (this.dailyChallenge && protocolDrillForId(this.dailyChallenge.id)?.noAbilities) return false;
    const a = this.abilities.find((x) => x.def.id === id)!;
    const dailyRecharge = this.dailyChallenge?.boon.freeAbilityRecharge && !this.dailyAbilityRechargeUsed;
    return this.wave >= a.def.unlockWave && (a.cd <= 0 || !!dailyRecharge);
  }

  castAbility(id: AbilityId, pos?: Vec): boolean {
    const a = this.abilities.find((x) => x.def.id === id)!;
    if (this.terminalControlsLocked()) { sfx.error(); return false; }
    if (!this.abilityReady(id)) { sfx.error(); return false; }
    if (a.def.targeted && !pos) { sfx.error(); return false; }
    if (a.cd > 0 && this.dailyChallenge?.boon.freeAbilityRecharge && !this.dailyAbilityRechargeUsed) {
      this.dailyAbilityRechargeUsed = true;
      a.cd = 0;
      this.recorder.recordCustom('daily_ability_recharge', this.telemetryState(), {
        dailyId: this.dailyChallenge.id,
        abilityId: id,
      });
      this.announce(`Daily recharge spent: ${a.def.name}`);
    }
    switch (id) {
      case 'strike': {
        const target = pos;
        if (!target) return false;
        const radius = 95;
        for (const e of [...this.enemies]) {
          if (Math.hypot(e.pos.x - target.x, e.pos.y - target.y) <= radius + e.def.radius) {
            this.trueDamage(e, 500);
          }
        }
        // visual: vertical lance + double shockwave
        if (!this.fxMuted) {
          this.beams.push({ from: { x: target.x, y: -20 }, to: { ...target }, color: '#ffffff', width: 9, life: 0.35, maxLife: 0.35 });
          this.beams.push({ from: { x: target.x, y: -20 }, to: { ...target }, color: '#ffd32a', width: 18, life: 0.25, maxLife: 0.25 });
        }
        this.explosionFx(target, '#ffd32a', radius);
        this.explosionFx(target, '#ffffff', radius * 0.6);
        this.shake = 1;
        sfx.strike();
        this.announce('☄ Orbital lance discharged');
        break;
      }
      case 'chrono':
        this.chronoTimer = 6;
        this.announce('⌛ Chrono field active — a million minds lean on the clock');
        sfx.chrono();
        break;
      case 'overdrive':
        this.overdriveTimer = 8;
        this.announce('⚡ OVERDRIVE — burning beacon fuel in the gun reactors');
        sfx.overdrive();
        break;
      case 'salvage': {
        const amount = 150 + this.wave * 12;
        this.earn(amount);
        this.announce(`⌬ Salvage Protocol: +${amount} credits`);
        sfx.upgrade();
        break;
      }
      case 'cascade': {
        // detonate every resonance mark on the field
        let popped = 0;
        for (const e of [...this.enemies]) {
          if (e.resonance > 0) {
            this.explosionFx(e.pos, '#fff8c4', 30 + e.resonance * 8);
            this.trueDamage(e, e.resonance * 15);
            e.resonance = 0;
            e.resonanceTimer = 0;
            popped++;
          }
        }
        this.shake = Math.min(1, 0.3 + popped * 0.05);
        this.announce(popped > 0 ? `♫ Null Cascade — ${popped} marks detonated` : '♫ Null Cascade — no marks to detonate');
        sfx.bossDown();
        break;
      }
      case 'mirror':
        this.mirrorTimer = 10;
        this.announce('◇ Mirror Protocol — the exit is a door that opens backward');
        sfx.chrono();
        break;
      case 'recalibrate': {
        const previous = this.adaptation.type;
        this.adaptation = { type: null, resist: 0 };
        this.dmgWindow = {};
        let mirrored = 0;
        for (const e of this.enemies) {
          if (e.def.id !== 'mirror' || !e.mirrorResist || e.dead || e.finished) continue;
          e.mirrorResist.resist = MIRROR_HULL_RECALIBRATED_RESIST;
          e.mirrorResist.weakenedTimer = RECALIBRATE_MIRROR_WEAKEN_S;
          mirrored++;
          this.ring(e.pos, '#80ffd8', e.def.radius + 24);
        }
        this.announce(mirrored > 0
          ? `Recalibrate - adaptation flushed, ${mirrored} Mirror Hull${mirrored === 1 ? '' : 's'} destabilized`
          : `Recalibrate - ${previous ? `${previous} adaptation flushed` : 'adaptation ledger cleared'}`);
        sfx.chrono();
        break;
      }
    }
    a.cd = a.def.cooldown * getBalance().abilityCooldownMult;
    this.runStats.abilitiesCast++;
    this.recorder.recordAbilityCast(this.telemetryState(), id, pos);
    vox(`cast-${id}`);
    return true;
  }

  // ---------- main update ----------

  update(rawDt: number) {
    if (this.paused || this.phase === 'gameover') return;
    this.noticeTimer = Math.max(0, this.noticeTimer - rawDt); // real-time, not game speed
    // pickups expire in real time too — clicking them is a human reflex, and the
    // window shouldn't shrink at 2x/4x game speed
    // TRUE fixed timestep: every physics step is exactly SIM_STEP; the remainder
    // carries in an accumulator instead of being stepped as a variable-size tail.
    // Variable steps made the simulation depend on frame timing, which breaks
    // deterministic re-simulation even with a seeded RNG. The budget caps steps
    // per frame so a render stutter can't death-spiral, and leftover sim debt is
    // clamped so it stays bounded.
    this.accumulator += Math.min(rawDt, 0.05) * this.speed;
    let budget = 12; // 12 × 1/60 = 0.2s capacity — covers 4x speed at 20fps
    while (this.accumulator >= Game.SIM_STEP - 1e-9 && budget-- > 0 &&
      (this.phase as Phase) !== 'gameover') {
      this.accumulator -= Game.SIM_STEP;
      this.tick(Game.SIM_STEP);
    }
    this.accumulator = Math.min(this.accumulator, Game.SIM_STEP * 2);
  }

  static readonly SIM_STEP = 1 / 60;
  private accumulator = 0;

  private tick(dt: number) {
    this.time += dt;

    // Pickups expire in real time relative to the selected speed, but the work
    // happens inside the fixed tick so replay results never depend on frame
    // batching at 2x/4x.
    const pickupDt = dt / Math.max(1, this.speed);
    for (const p of this.pickups) p.life -= pickupDt;
    compact(this.pickups, (p) => p.life > 0);

    // global timers
    this.chronoTimer = Math.max(0, this.chronoTimer - dt);
    this.mirrorTimer = Math.max(0, this.mirrorTimer - dt);
    this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    this.frenzyTimer = Math.max(0, this.frenzyTimer - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    const abilityHaste = this.freeplay && this.freeplayState.relics.some((r) => r.id === 'chronoMarket') ? 1.35 : 1;
    for (const a of this.abilities) a.cd = Math.max(0, a.cd - dt * abilityHaste);
    for (const e of this.enemies) {
      if (e.def.id === 'umbra' && e.umbraPhase === 1) e.umbraTickDamage = 0;
    }

    this.updateSpawns(dt);
    this.updateEnemies(dt);
    // terminal state reached mid-tick: no towers fire, no projectiles fly, and no
    // wave-completion runs after the run has already ended
    if ((this.phase as Phase) === 'gameover') return;
    // index enemies for this tick's radius queries, then precompute cloak reveal
    this.grid.rebuild(this.enemies);
    this.precomputeReveal();
    this.updateBurnZones(dt);
    this.updateHealers(dt);
    this.updateAuras();
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateNovas(dt);
    this.updateFx(dt);

    // wave completion
    if (this.phase === 'wave' && this.queue.length === 0 && this.enemies.length === 0) {
      const dailyWaveBonus = this.dailyChallenge?.twist.waveBonusMultiplier ?? 1;
      const bonus = Math.round(waveBonus(this.wave) * getBalance().waveBonusMult * (this.freeplay ? freeplayWaveBonusMult(this.wave) : 1) * dailyWaveBonus);
      this.earn(bonus);
      this.recorder.recordWaveEnd(this.telemetryState(), bonus);
      this.maybeGrantDailyCreditCache(this.wave + 1);
      if (this.freeplay) {
        if (this.freeplayState.rival) {
          const bounty = Math.round((this.freeplayState.rival.id === 'redSaint' ? 900 : 500) * (1 + this.freeplayState.rivalLevel * 0.12));
          this.earn(bounty);
          this.freeplayState.scoreMult *= this.freeplayState.rival.scoreMult;
          this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RIVAL_DEFEAT, {
            rivalId: this.freeplayState.rival.id,
            bounty,
            scoreMult: freeplayScoreMultiplier(this.freeplayState),
          });
        }
        if (this.freeplayState.riskAccepted) {
          const reward = Math.round(this.freeplayState.riskAccepted.bonusCredits * (this.freeplayState.daily ? 1.25 : 1));
          this.earn(reward);
          this.freeplayState.scoreMult *= this.freeplayState.riskAccepted.scoreMult * (this.freeplayState.daily ? 1.25 : 1);
          this.freeplayState.riskCleared++;
          this.recordFreeplayEvent(METRIC_EVENTS.FREEPLAY_RISK_CLEAR, {
            riskId: this.freeplayState.riskAccepted.id,
            reward,
            scoreMult: freeplayScoreMultiplier(this.freeplayState),
          });
          this.freeplayState.riskAccepted = null;
        }
      }
      // archive fragments unlock by wave. +1 makes each fragment available during the
      // next build phase instead of the instant its wave clears.
      ARCHIVE.forEach((f, i) => {
        if (f.wave <= this.wave + 1 && !this.archive.includes(i)) {
          this.archive.push(i);
          if (this.campaignProgressEnabled()) progress.addArchive(i);
          this.newArchive = true;
          this.announce('✦ Archive fragment recovered.');
          sfx.archive();
          vox('archive');
        }
      });
      const drillWaves = this.dailyChallenge ? protocolDrillForId(this.dailyChallenge.id)?.maxWaves : undefined;
      const finalWave = this.gauntletProtocol ? gauntletProtocolWaveCount(this.gauntletProtocol.leg) : drillWaves ?? this.diff.waves;
      if (this.wave >= finalWave && !this.freeplay) {
        this.phase = 'victory';
        if (this.campaignProgressEnabled()) progress.recordWave(this.map.id, this.diff.id, this.wave);
        if (this.campaignProgressEnabled()) progress.addWaves(1);
        this.finishRun(true, 'victory');
        sfx.victory();
        playStinger('victory');
        vox('victory');
      } else {
        if (this.campaignProgressEnabled()) progress.recordWave(this.map.id, this.diff.id, this.wave);
        if (this.campaignProgressEnabled()) {
          const beforeKills = this.waveStartTotalKills;
          progress.addWaves(1);
          const currentKills = this.baseKills + this.totalKills;
          const unlocked = TOWERS.filter((t) => t.unlockAt > beforeKills && t.unlockAt <= currentKills);
          if (unlocked.length > 0) {
            for (const tower of unlocked) this.recorder.recordUnlockEarned(tower.id);
            this.announce('✦ New instrument pattern decrypted — check the Arsenal');
            vox('unlock');
          } else if (this.wave % 5 === 0) {
            vox('wave-clear');
          }
        } else if (this.wave % 5 === 0) {
          vox('wave-clear');
        }
        // Veteran+: every 10 waves the armada field-patches armor against your top damage type
        if (this.diff.id !== 'easy' && this.wave % 10 === 0 && this.wave >= 10) {
          const entries = Object.entries(this.dmgWindow).sort((a, b) => b[1] - a[1]);
          if (entries.length > 0 && entries[0][1] > 0) {
            const resist = this.diff.id === 'extinction' ? 0.4 : this.diff.id === 'hard' ? 0.35 : 0.25;
            this.adaptation = { type: entries[0][0] as DamageType, resist };
            this.announce(`⛨ The Combine has adapted: ${entries[0][0]} damage −${Math.round(resist * 100)}% for the next 10 waves`);
          }
          this.dmgWindow = {};
        }
        this.phase = 'build';
        this.prepareFreeplayBuild();
        sfx.waveClear();
        if (this.autoNext) this.startWave();
      }
    }
  }

  private updateSpawns(dt: number) {
    let blocked = false; // groups run sequentially: a group's delay starts when prior groups finish
    for (const entry of this.queue) {
      if (blocked) break;
      entry.timer -= dt;
      while (entry.timer <= 0 && entry.spawned < entry.group.count) {
        this.spawnEnemy(entry.group.type, !!entry.group.cloaked, eliteAffixForSpawn(entry.group, entry.spawned));
        entry.spawned++;
        entry.timer += entry.group.gap;
      }
      if (entry.spawned < entry.group.count) blocked = true;
    }
    compact(this.queue, (e) => e.spawned < e.group.count);
  }

  private updateEnemies(dt: number) {
    const path = this.map.path;
    for (const e of this.enemies) {
      if (e.dead || e.finished) continue;
      // burn — always energy-typed (it's fire), credited to the applying tower
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        this.damageEnemy(e, e.burnDps * dt, 'energy', false, e.burnSrc);
        if (e.burnTimer <= 0) { e.burnDps = 0; e.burnSrc = undefined; } // expired burns must not out-rank fresh ones
        if (e.dead) continue;
      }
      // slow decay
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) e.slow = 1;
      }
      // resonance decay
      if (e.resonanceTimer > 0) {
        e.resonanceTimer -= dt;
        if (e.resonanceTimer <= 0) e.resonance = 0;
      }
      if (e.exposedTimer > 0) {
        e.exposedTimer -= dt;
        if (e.exposedTimer <= 0) this.clearExposed(e);
      }
      if (e.mirrorResist && e.mirrorResist.weakenedTimer > 0) {
        e.mirrorResist.weakenedTimer = Math.max(0, e.mirrorResist.weakenedTimer - dt);
        if (e.mirrorResist.weakenedTimer <= 0) e.mirrorResist.resist = MIRROR_HULL_BASE_RESIST;
      }
      this.updateUmbra(e, dt);
      // boss disruption pulse: stuns towers near the hull — don't stack your whole
      // defense on the one chokepoint a carrier will walk through
      if (e.def.boss) {
        e.pulseCd = (e.pulseCd ?? 2.5) - dt;
        if (e.pulseCd <= 0) {
          e.pulseCd = this.bossPulseInterval(e);
          const radius = this.bossPulseRadius(e);
          let hit = 0;
          for (const t of this.towers) {
            if (t.def.style === 'support') continue;
            if (Math.hypot(t.pos.x - e.pos.x, t.pos.y - e.pos.y) <= radius) {
              t.cooldown = Math.max(t.cooldown, 1.6);
              hit++;
            }
          }
          if (hit > 0) {
            this.ring(e.pos, '#ff7f50', radius);
            this.burstFx(e.pos, '#ff7f50', 8);
            sfx.zap();
          }
        }
      }
      // focus marks are target-priority only; when the timer expires the hull returns
      // to normal targeting rules.
      if ((e.focusMarkTimer ?? 0) > 0) {
        e.focusMarkTimer = Math.max(0, (e.focusMarkTimer ?? 0) - dt);
        if (e.focusMarkTimer <= 0) e.focusMark = 0;
      }
      const globalSlow = this.chronoTimer > 0 ? 0.35 : 1;
      let move = e.def.speed * getBalance().enemy(e.def.id).speedMult * (e.elite?.speedMult ?? 1) * this.umbraSpeedMult(e) * e.slow * globalSlow * dt;
      while (move > 0 && e.wp < path.length) {
        const target = path[e.wp];
        const dx = target.x - e.pos.x, dy = target.y - e.pos.y;
        const d = Math.hypot(dx, dy);
        if (d <= move) {
          e.pos = { ...target };
          e.dist += d;
          move -= d;
          e.wp++;
        } else {
          e.pos.x += (dx / d) * move;
          e.pos.y += (dy / d) * move;
          e.dist += move;
          move = 0;
        }
      }
      if (e.wp >= path.length) {
        e.finished = true;
        if (this.mirrorTimer > 0) {
          // Mirror Protocol: thrown back to the entrance instead of breaching
          e.finished = false;
          e.dist = 0;
          e.wp = 1;
          e.pos = { ...path[0] };
          this.ring(e.pos, '#54a0ff', 30);
          continue;
        }
        const coresLost = rbe(e.def.id);
        this.lives -= coresLost;
        this.runStats.leaks += coresLost;
        this.recorder.recordLeak(this.telemetryState(), e.def.id, coresLost, {
          cloaked: e.cloaked,
          revealed: e.revealed,
          armored: e.def.armored,
          boss: e.def.boss,
        }, e);
        this.hurtFlash = Math.min(1, this.hurtFlash + 0.55);
        this.shake = Math.min(1, this.shake + (e.def.boss ? 0.8 : 0.25));
        sfx.leak();
        if (this.lives <= 0) {
          this.lives = 0;
          this.phase = 'gameover';
          if (this.campaignProgressEnabled()) progress.recordWave(this.map.id, this.diff.id, this.wave);
          this.finishRun(false, 'gameover');
          sfx.gameOver();
          playStinger('defeat');
          vox('gameover');
        } else if (this.lives <= this.diff.lives * 0.25 && !this.lowCoreWarned) {
          this.lowCoreWarned = true;
          vox('low-cores');
        }
        // terminal: stop processing further leaks this tick — each extra leaking
        // hull used to re-trigger the whole gameover branch (finishRun,
        // recordRunEnd, defeat stinger) once per enemy
        if ((this.phase as Phase) === 'gameover') break;
      }
    }
    compact(this.enemies, (e) => !e.dead && !e.finished);
  }

  private updateAuras() {
    for (const t of this.towers) {
      t.rateBuff = 1;
      t.rangeBuff = 1;
    }
    for (const s of this.towers) {
      if (s.def.style !== 'support') continue;
      const st = s.stats;
      const supportAmp = this.freeplay && this.freeplayState.relics.some((r) => r.id === 'beaconChoir') ? 1.25 : 1;
      for (const t of this.towers) {
        if (t === s || t.def.style === 'support') continue;
        if (Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y) <= st.range) {
          t.rateBuff = Math.max(t.rateBuff, 1 + st.buffRate * supportAmp);
          t.rangeBuff = Math.max(t.rangeBuff, 1 + st.buffRange * supportAmp);
        }
      }
      // aura effects on enemies: slow (Ion Storm) and sear (Razor Static)
      if (st.slowPower > 0 || st.burnDps > 0) {
        this.grid.forEachInRadius(s.pos.x, s.pos.y, st.range, (e) => {
          if (e.dead || e.finished) return;
          if (Math.hypot(e.pos.x - s.pos.x, e.pos.y - s.pos.y) <= st.range) {
            if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
            if (st.burnDps > 0) this.applyBurn(e, st.burnDps, 0.5, s);
          }
        });
      }
    }
  }

  /** Does any tower or support give detection coverage at this enemy's position? */
  private visibleTo(t: Tower, e: Enemy): boolean {
    if (!e.cloaked) return true;
    if (e.revealed) return true;
    if (!t.stats.detection) return false;
    if (((this.freeplay && this.freeplayState.currentMutators.some((m) => m.id === 'sensorBlackout')) || this.dailyChallenge?.twist.sensorBlackout) &&
        !this.freeplayState.relics.some((r) => r.id === 'sensorCrown')) {
      return Game.rankOf(t) >= 3;
    }
    return true;
  }

  /** Once per tick: flag each cloaked hull covered by a detector spire's aura.
   *  Replaces a per-(tower,enemy) tower scan with O(detectors x localHulls). */
  private precomputeReveal() {
    let anyCloaked = false;
    for (const e of this.enemies) {
      if (e.cloaked) { e.revealed = false; anyCloaked = true; }
    }
    if (!anyCloaked) return;
    const blackout = (this.freeplay && this.freeplayState.currentMutators.some((m) => m.id === 'sensorBlackout')) || !!this.dailyChallenge?.twist.sensorBlackout;
    const blackoutCountered = this.freeplayState.relics.some((r) => r.id === 'sensorCrown' || r.id === 'beaconChoir');
    for (const s of this.towers) {
      if (s.def.style === 'support' && s.stats.detection) {
        const range = s.stats.range * (blackout && !blackoutCountered ? 0.62 : 1);
        this.grid.forEachInRadius(s.pos.x, s.pos.y, range, (e) => {
          if (e.cloaked && Math.hypot(e.pos.x - s.pos.x, e.pos.y - s.pos.y) <= range) e.revealed = true;
        });
      }
    }
  }

  private pickTarget(t: Tower, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestVal = -Infinity;
    const hasFilters = t.targetFilters.length > 0;
    let filteredBest: Enemy | null = null;
    let filteredBestVal = -Infinity;
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (e.dead || e.finished) return;
      const d = Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y);
      if (d > range + e.def.radius) return;
      if (!this.visibleTo(t, e)) return;
      let val = this.targetSortValue(t, e, d);
      if ((e.focusMarkTimer ?? 0) > 0) val += 1_000_000 + (e.focusMark ?? 1) * 10_000;
      if (val > bestVal) { bestVal = val; best = e; }
      if (hasFilters && this.matchesTargetFilters(t, e) && val > filteredBestVal) {
        filteredBestVal = val;
        filteredBest = e;
      }
    });
    return filteredBest ?? best;
  }

  private targetSortValue(t: Tower, e: Enemy, d: number): number {
    switch (t.target) {
      case 'first': return e.dist;
      case 'last': return -e.dist;
      case 'strong': return e.hp * 1000 + e.dist;
      case 'close': return -d;
    }
  }

  private matchesTargetFilters(t: Tower, e: Enemy): boolean {
    if (t.targetFilters.length === 0) return false;
    return t.targetFilters.some((filter) => targetFilterMatches(filter, e));
  }

  private updateTowers(dt: number) {
    const globalRate = (this.overdriveTimer > 0 ? 2 : 1) * (this.frenzyTimer > 0 ? 1.5 : 1);
    for (const t of this.towers) {
      t.flash = Math.max(0, t.flash - dt);
      t.recoil = Math.max(0, t.recoil - dt * 5);
      if (t.def.style === 'support') continue;

      if (t.def.style === 'sweep') {
        this.updateSweepTower(t, dt, globalRate);
        continue;
      }

      t.cooldown -= dt * t.rateBuff * globalRate;
      if (t.cooldown > 0) continue;
      const st = t.stats;
      const range = st.range * t.rangeBuff * this.rangeFactor(t.pos);

      if (t.def.style === 'pulse') {
        this.updatePulseTower(t, st, range);
        continue;
      }

      if (t.def.style === 'nova') {
        this.updateNovaTower(t, st, range);
        continue;
      }

      if (t.def.style === 'gravity') {
        this.updateGravityTower(t, st, range);
        continue;
      }

      if (t.def.style === 'resonance') {
        this.updateResonanceTower(t, st, range);
        continue;
      }

      if (t.def.style === 'siphon') {
        this.updateSiphonTower(t, st, range);
        continue;
      }

      if (t.def.style === 'lure') {
        this.updateLureTower(t, st, range);
        continue;
      }

      if (t.def.style === 'rift') {
        this.updateRiftTower(t, st, range);
        continue;
      }

      if (t.def.style === 'arc') {
        this.updateArcTower(t, st, range);
        continue;
      }

      const target = this.pickTarget(t, range);
      if (!target) continue;
      t.angle = Math.atan2(target.pos.y - t.pos.y, target.pos.x - t.pos.x);
      t.cooldown = 1 / st.fireRate;
      t.flash = 0.12;
      t.recoil = 1;

      if (t.def.style === 'rail') {
        this.updateRailTower(t, target, st, range);
        continue;
      }

      if (t.def.style === 'beam') {
        this.updateBeamTower(t, target, st, range);
        continue;
      }

      this.updateBoltTower(t, target, st, range);
    }
  }

  // Watchfire Beacon: a continuously rotating sweep — runs every tick, no cooldown
  private updateSweepTower(t: Tower, dt: number, globalRate: number): void {
    const st = t.stats;
    const range = st.range * t.rangeBuff * this.rangeFactor(t.pos);
    t.angle += st.fireRate * globalRate * t.rateBuff * dt;
    t.flash = 0.12;
    const beams = Math.max(1, st.count);
    let any = false;
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (e.dead || e.finished) return;
      const dx = e.pos.x - t.pos.x, dy = e.pos.y - t.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > range + e.def.radius || !this.visibleTo(t, e)) return;
      const bearing = Math.atan2(dy, dx);
      // wider angular tolerance up close so the beam root isn't a dead zone
      const tol = 0.16 + Math.min(0.55, (e.def.radius + 14) / Math.max(20, d));
      for (let k = 0; k < beams; k++) {
        let delta = bearing - (t.angle + (k * Math.PI * 2) / beams);
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        if (Math.abs(delta) <= tol) {
          any = true;
          this.damageEnemy(e, st.damage * dt, st.damageType, false, t);
          if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
          if (st.burnDps > 0) this.applyBurn(e, st.burnDps, st.burnDuration, t);
          break;
        }
      }
    });
    if (any) sfx.beamHum();
  }

  private updatePulseTower(t: Tower, st: TowerStats, range: number): void {
    // cryo / locust cloud: hit everything in range
    let any = false;
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (e.dead || e.finished) return;
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
      if (!this.visibleTo(t, e)) return;
      any = true;
      if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
      if (st.burnDps > 0) this.applyBurn(e, st.burnDps, st.burnDuration, t);
      if (st.damage > 0) this.damageEnemy(e, st.damage, st.damageType, false, t);
    });
    if (any) {
      t.cooldown = 1 / st.fireRate;
      t.flash = 0.2;
      sfx.cryo();
      this.ring(t.pos, t.def.glow, range);
    }
  }

  private updateNovaTower(t: Tower, st: TowerStats, range: number): void {
    // drowned star: exhale an expanding requiem wave
    let inRange = false;
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 40, (e) => {
      if (!e.dead && !e.finished &&
        Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) <= range + 40) inRange = true;
    });
    if (inRange) {
      this.novas.push({
        pos: { ...t.pos }, r: 12, maxR: range, damage: st.damage,
        slowPower: st.slowPower, slowDuration: st.slowDuration,
        color: t.def.glow, hit: new Set(), src: t,
      });
      t.cooldown = 1 / st.fireRate;
      t.flash = 0.4;
      sfx.gravity();
    }
  }

  private updateGravityTower(t: Tower, st: TowerStats, range: number): void {
    // drag every hostile in range backward along the path, crush hulls
    let any = false;
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (e.dead || e.finished) return;
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
      if (!this.visibleTo(t, e)) return;
      any = true;
      // drag > 0 = pull backward (hold); drag < 0 = push forward (repel). The leak
      // check lives only in the movement block, so clamp forward pushes to a safe
      // margin before the exit — a hull must never be shoved into the core here.
      const drag = st.drag * (e.def.boss ? 0.22 : 1);
      let nd = Math.max(0, e.dist - drag);
      if (drag < 0) nd = Math.min(nd, Math.max(0, this.pathLength() - SAFE_EXIT_MARGIN));
      e.dist = nd;
      const at = this.posAtDist(e.dist);
      e.pos = at.pos;
      e.wp = at.wp;
      if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
      this.damageEnemy(e, st.damage, 'energy', true, t);
    });
    if (any) {
      t.cooldown = 1 / st.fireRate;
      t.flash = 0.25;
      sfx.gravity();
      this.ring(t.pos, t.def.glow, range);
      this.burstFx(t.pos, t.def.glow, 5);
    }
  }

  private updateResonanceTower(t: Tower, st: TowerStats, range: number): void {
    // mark up to `count` hulls with resonance stacks
    const marked: Enemy[] = [];
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (marked.length >= st.count) return;
      if (e.dead || e.finished || marked.includes(e)) return;
      if (!this.visibleTo(t, e)) return;
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
      marked.push(e);
      const dur = st.burnDuration > 0 ? 9999 : 4;
      e.resonance = Math.min(5, e.resonance + 1);
      e.resonanceTimer = Math.max(e.resonanceTimer, dur);
      this.damageEnemy(e, st.damage, st.damageType, false, t);
      this.addBeam(t.pos, e.pos, t.def.glow, 2.5, 0.22);
    });
    if (marked.length > 0) {
      t.angle = Math.atan2(marked[0].pos.y - t.pos.y, marked[0].pos.x - t.pos.x);
      t.cooldown = 1 / st.fireRate;
      t.flash = 0.2;
      sfx.resonance();
    }
  }

  private updateSiphonTower(t: Tower, st: TowerStats, range: number): void {
    // Harmonic Siphon: useful alone, but spikes only when another tower has built
    // resonance. It consumes stacks, then echoes one stack onto nearby hulls.
    const candidates: Enemy[] = [];
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (e.dead || e.finished) return;
      if (!this.visibleTo(t, e)) return;
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
      candidates.push(e);
    });
    if (candidates.length === 0) return;
    candidates.sort((a, b) => (b.resonance - a.resonance) || (b.dist - a.dist));
    const targets = candidates.slice(0, Math.max(1, st.count));
    const spreadRadius = Math.max(0, st.splash);
    for (const e of targets) {
      const consumed = Math.min(e.resonance, Math.max(1, st.pierce));
      if (consumed > 0) {
        e.resonance = Math.max(0, e.resonance - consumed);
        if (e.resonance <= 0) e.resonanceTimer = 0;
      }
      const burst = st.damage * (1 + consumed * 0.85);
      const dealt = this.damageEnemy(e, burst, st.damageType, false, t);
      if (dealt > 0 && st.burnDps > 0) this.applyBurn(e, st.burnDps, st.burnDuration, t);
      this.addBeam(t.pos, e.pos, t.def.glow, consumed > 0 ? 3.2 : 1.8, 0.18);
      if (consumed <= 0 || st.chain <= 0 || spreadRadius <= 0) continue;
      let spread = 0;
      this.grid.forEachInRadius(e.pos.x, e.pos.y, spreadRadius + 16, (o) => {
        if (spread >= st.chain || o === e || o.dead || o.finished) return;
        if (!this.visibleTo(t, o)) return;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) > spreadRadius + o.def.radius) return;
        o.resonance = Math.min(5, o.resonance + 1);
        o.resonanceTimer = Math.max(o.resonanceTimer, 4);
        this.addBeam(e.pos, o.pos, t.def.color, 1.4, 0.16);
        spread++;
      });
    }
    t.angle = Math.atan2(targets[0].pos.y - t.pos.y, targets[0].pos.x - t.pos.x);
    t.cooldown = 1 / st.fireRate;
    t.flash = 0.22;
    t.recoil = 0.7;
    sfx.resonance();
  }

  private updateLureTower(t: Tower, st: TowerStats, range: number): void {
    // Vector Lure: creates a temporary focus target. The target picker above does
    // the actual battlefield manipulation by making marked hulls win target choice.
    const candidates: Enemy[] = [];
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (e.dead || e.finished) return;
      if (!this.visibleTo(t, e)) return;
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
      candidates.push(e);
    });
    if (candidates.length === 0) return;
    candidates.sort((a, b) =>
      Number((a.focusMarkTimer ?? 0) > 0) - Number((b.focusMarkTimer ?? 0) > 0) ||
      (b.hp - a.hp) ||
      (b.dist - a.dist));
    const targets = candidates.slice(0, Math.max(1, st.count));
    const markDuration = Math.max(1, st.burnDuration || 3);
    const markStrength = Math.max(1, st.pierce);
    for (const e of targets) {
      e.focusMark = Math.max(e.focusMark ?? 0, markStrength);
      e.focusMarkTimer = Math.max(e.focusMarkTimer ?? 0, markDuration);
      if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
      if (st.damage > 0) this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
      this.addBeam(t.pos, e.pos, t.def.glow, 2.2, 0.22);
      if (st.splash <= 0) continue;
      this.grid.forEachInRadius(e.pos.x, e.pos.y, st.splash + 16, (o) => {
        if (o === e || o.dead || o.finished) return;
        if (!this.visibleTo(t, o)) return;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) > st.splash + o.def.radius) return;
        if (st.slowPower > 0) this.applySlow(o, st.slowPower, st.slowDuration);
        const drag = st.drag * (o.def.boss ? 0.18 : 1);
        if (drag > 0) {
          o.dist = Math.max(0, o.dist - drag);
          const at = this.posAtDist(o.dist);
          o.pos = at.pos;
          o.wp = at.wp;
        }
      });
      this.ring(e.pos, t.def.glow, Math.max(24, st.splash));
    }
    t.angle = Math.atan2(targets[0].pos.y - t.pos.y, targets[0].pos.x - t.pos.x);
    t.cooldown = 1 / st.fireRate;
    t.flash = 0.25;
    t.recoil = 0.5;
    sfx.zap();
  }

  private updateRiftTower(t: Tower, st: TowerStats, range: number): void {
    // Abyss Gate: open one or more breaches on target clusters.
    const first = this.pickTarget(t, range);
    if (!first) return;
    const centers: Enemy[] = [first];
    const gates = Math.max(1, st.count);
    for (let i = 1; i < gates; i++) {
      let next: Enemy | null = null;
      this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 24, (e) => {
        if (next || e.dead || e.finished || centers.includes(e)) return;
        if (!this.visibleTo(t, e)) return;
        if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
        if (!centers.every((c) => Math.hypot(e.pos.x - c.pos.x, e.pos.y - c.pos.y) > st.splash * 1.2)) return;
        next = e;
      });
      if (next) centers.push(next);
    }
    const hit = new Set<number>();
    for (const center of centers) {
      const cpos = { ...center.pos };
      this.addBeam(t.pos, cpos, t.def.glow, 5.5, 0.2);
      this.addBeam({ x: cpos.x, y: cpos.y - st.splash * 0.65 }, { x: cpos.x, y: cpos.y + st.splash * 0.65 }, '#ffffff', 2, 0.18);
      this.grid.forEachInRadius(cpos.x, cpos.y, st.splash + 20, (e) => {
        if (e.dead || e.finished || hit.has(e.uid)) return;
        if (!this.visibleTo(t, e)) return;
        if (Math.hypot(e.pos.x - cpos.x, e.pos.y - cpos.y) > st.splash + e.def.radius) return;
        hit.add(e.uid);
        const drag = st.drag * (e.def.boss ? 0.18 : 1);
        if (drag > 0) {
          e.dist = Math.max(0, e.dist - drag);
          const at = this.posAtDist(e.dist);
          e.pos = at.pos;
          e.wp = at.wp;
        }
        if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
        if (st.burnDps > 0) this.applyBurn(e, st.burnDps, st.burnDuration, t);
        this.damageEnemy(e, st.damage, st.damageType, true, t);
      });
      this.ring(cpos, t.def.glow, st.splash);
      this.burstFx(cpos, t.def.glow, 9);
    }
    t.angle = Math.atan2(first.pos.y - t.pos.y, first.pos.x - t.pos.x);
    t.cooldown = 1 / st.fireRate;
    t.flash = 0.45;
    t.recoil = 1;
    sfx.gravity();
  }

  private updateArcTower(t: Tower, st: TowerStats, range: number): void {
    // tesla: zap up to `count` enemies in range, chain jumps extra
    const targets: Enemy[] = [];
    this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
      if (targets.length >= st.count) return;
      if (e.dead || e.finished) return;
      if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
      if (!this.visibleTo(t, e)) return;
      targets.push(e);
    });
    if (targets.length === 0) return;
    const chainExcludes: Enemy[] = [...targets];
    for (const e of targets) {
      this.addBeam(t.pos, e.pos, t.def.glow, 2, 0.12);
      if (st.drag > 0 && !e.def.boss) { // Magnetar Cage
        e.dist = Math.max(0, e.dist - st.drag);
        const at = this.posAtDist(e.dist);
        e.pos = at.pos; e.wp = at.wp;
      }
      if (st.slowPower > 0) this.applySlow(e, st.slowPower, st.slowDuration);
      this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
      let from = e;
      for (let j = 0; j < st.chain; j++) {
        const next = this.nearestEnemy(from.pos, 90, chainExcludes, st.detection);
        if (!next) break;
        chainExcludes.push(next);
        this.addBeam(from.pos, next.pos, t.def.glow, 1.5, 0.1);
        this.damageEnemy(next, st.damage, st.damageType, st.shred, t);
        from = next;
      }
    }
    const first = targets[0];
    t.angle = Math.atan2(first.pos.y - t.pos.y, first.pos.x - t.pos.x);
    t.cooldown = 1 / st.fireRate;
    t.flash = 0.15;
    sfx.zap();
  }

  private updateRailTower(t: Tower, target: Enemy, st: TowerStats, range: number): void {
    // hitscan along the line through the target; oracle variants also execute
    const shots: Enemy[] = [target];
    for (let i = 1; i < st.count; i++) {
      let next: Enemy | null = null;
      this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 24, (e) => {
        if (next || e.dead || e.finished || shots.includes(e)) return;
        if (!this.visibleTo(t, e)) return;
        if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) > range + e.def.radius) return;
        next = e;
      });
      if (next) shots.push(next);
    }
    for (const tgt of shots) {
      const dir = norm({ x: tgt.pos.x - t.pos.x, y: tgt.pos.y - t.pos.y });
      // beam is drawn to the HIT envelope (range), not an arbitrary 1600px —
      // the old full-screen visual implied hits far beyond where they landed
      const end = { x: t.pos.x + dir.x * (range + 24), y: t.pos.y + dir.y * (range + 24) };
      this.addBeam(t.pos, end, t.def.glow, 3, 0.15);
      let hits = 0;
      // collect only enemies near the firing line, then sort that short list
      const onLine: { enemy: Enemy; d2: number }[] = [];
      this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 32, (e) => {
        if (e.dead || e.finished || !this.visibleTo(t, e)) return;
        if (distToSeg(e.pos, t.pos, end) <= e.def.radius + 4) onLine.push({ enemy: e, d2: sqDist(t.pos, e.pos) });
      });
      onLine.sort((a, b) => a.d2 - b.d2);
      for (const { enemy: e } of onLine) {
        if (st.execute > 0 && !e.def.boss && e.hp / e.maxHp <= st.execute) {
          this.burstFx(e.pos, '#ffffff', 10);
          this.trueDamage(e, e.hp);
          t.kills++;
        } else {
          this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
        }
        this.burstFx(e.pos, t.def.glow, 3);
        if (++hits >= st.pierce) break;
      }
    }
    sfx.rail();
  }

  private updateBeamTower(t: Tower, target: Enemy, st: TowerStats, range: number): void {
    const dir = norm({ x: target.pos.x - t.pos.x, y: target.pos.y - t.pos.y });
    const end = { x: t.pos.x + dir.x * range, y: t.pos.y + dir.y * range };
    this.addBeam(t.pos, end, t.def.glow, 4, 0.1);
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead || e.finished || !this.visibleTo(t, e)) continue;
      if (distToSeg(e.pos, t.pos, end) <= e.def.radius + 6) {
        this.damageEnemy(e, st.damage, st.damageType, st.shred, t);
        if (++hits >= st.pierce) break;
      }
    }
    sfx.laser();
  }

  private updateBoltTower(t: Tower, target: Enemy, st: TowerStats, range: number): void {
    // bolt & missile: spawn projectiles. Drone Carrier uses many weaker
    // interceptors that split across targets instead of one pulse-like burst.
    const isDrone = t.def.id === 'drone';
    const launchCount = Math.max(1, st.count) * (isDrone ? Math.max(1, st.droneSwarm) : 1);
    const droneTargets: Enemy[] = isDrone ? [] : [target];
    if (isDrone) {
      this.grid.forEachInRadius(t.pos.x, t.pos.y, range + 16, (e) => {
        if (droneTargets.length >= launchCount) return;
        if (e.dead || e.finished || droneTargets.includes(e)) return;
        if (!this.visibleTo(t, e)) return;
        if (Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y) <= range + e.def.radius) droneTargets.push(e);
      });
      if (droneTargets.length === 0) droneTargets.push(target);
    }
    for (let i = 0; i < launchCount; i++) {
      const shotTarget = isDrone ? droneTargets[i % droneTargets.length] : target;
      const spread = launchCount > 1 ? (i - (launchCount - 1) / 2) * (isDrone ? 0.075 : 0.12) : 0;
      const lead = t.def.style === 'missile'
        ? shotTarget.pos
        : predict(shotTarget, this.map.path, t.pos, st.projectileSpeed, getBalance().enemy(shotTarget.def.id).speedMult);
      const ang = Math.atan2(lead.y - t.pos.y, lead.x - t.pos.x) + spread;
      const muzzle = isDrone ? 11 + (i % Math.max(1, st.droneSwarm)) * 2 : 14;
      this.projectiles.push({
        uid: this.uidSeq++,
        src: t,
        kind: t.def.style === 'missile' ? 'missile' : isDrone ? 'drone' : 'bolt',
        pos: { x: t.pos.x + Math.cos(ang) * muzzle, y: t.pos.y + Math.sin(ang) * muzzle },
        vel: { x: Math.cos(ang) * st.projectileSpeed, y: Math.sin(ang) * st.projectileSpeed },
        damage: isDrone ? st.damage * 0.72 : st.damage,
        damageType: st.damageType,
        pierce: st.pierce,
        splash: st.splash,
        speed: st.projectileSpeed,
        targetUid: shotTarget.uid,
        life: isDrone ? 2.8 : 2.2,
        color: t.def.glow,
        hit: new Set(),
        burnDps: st.burnDps,
        burnDuration: st.burnDuration,
        burnZoneRadius: st.burnZoneRadius,
        burnZoneDps: st.burnZoneDps,
        burnZoneDuration: st.burnZoneDuration,
        shred: st.shred,
        detection: st.detection || !shotTarget.cloaked ? true : false,
      });
    }
    if (t.def.style === 'missile') sfx.missile();
    else if (st.damageType === 'energy') sfx.laser();
    else sfx.shoot();
  }

  private nearestEnemy(pos: Vec, maxDist: number, exclude: Enemy[], detection = false): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxDist;
    // cap the search radius so a 9999 "anywhere" query still uses the grid
    const r = Math.min(maxDist, W + H);
    this.grid.forEachInRadius(pos.x, pos.y, r, (e) => {
      if (e.dead || e.finished || exclude.includes(e)) return;
      if (e.cloaked && !e.revealed && !detection) return;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.life <= 0) continue;

      if (p.kind === 'missile') {
        const cand = p.targetUid !== null ? this.grid.byId.get(p.targetUid) : undefined;
        const target = cand && !cand.dead && !cand.finished && (!cand.cloaked || cand.revealed || p.detection) ? cand : undefined;
        if (target) {
          const dir = norm({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
          // steer toward target
          p.vel.x += dir.x * p.speed * 5 * dt;
          p.vel.y += dir.y * p.speed * 5 * dt;
          const v = norm(p.vel);
          p.vel = { x: v.x * p.speed, y: v.y * p.speed };
        } else if (this.enemies.length > 0) {
          const next = this.nearestEnemy(p.pos, 9999, [], p.detection);
          if (next) p.targetUid = next.uid;
        }
        // exhaust trail
        if (Math.random() < 0.5) {
          this.emit('smoke', p.pos.x, p.pos.y, -p.vel.x * 0.1, -p.vel.y * 0.1, 0.35, 3, '#ffb86c');
        }
      }

      const prevPos = { ...p.pos };
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      if (p.pos.x < -30 || p.pos.x > W + 30 || p.pos.y < -30 || p.pos.y > H + 30) {
        p.life = 0;
        continue;
      }

      // projectiles are small; only nearby cells can contain a hit (48 > max hitR)
      let consumed = false;
      this.grid.forEachInRadius(p.pos.x, p.pos.y, 48, (e) => {
        if (consumed || p.life <= 0) return;
        if (e.dead || e.finished || p.hit.has(e.uid)) return;
        // same visibility rule as targeting (visibleTo): a spire-revealed hull is
        // hittable by ANY tower's bolts — non-detector shots used to pass through it
        if (e.cloaked && !e.revealed && !p.detection) return;
        const hitR = e.def.radius + (p.kind === 'missile' ? 6 : 4);
        if (distToSeg(e.pos, prevPos, p.pos) <= hitR) {
          if (p.kind === 'missile') {
            this.explode(p);
            p.life = 0;
            consumed = true;
            return;
          }
          p.hit.add(e.uid);
          const dealt = this.damageEnemy(e, p.damage, p.damageType, p.shred, p.src);
          if (dealt > 0 && p.burnDps > 0) this.applyBurn(e, p.burnDps, p.burnDuration, p.src);
          this.burstFx(p.pos, p.color, 2);
          if (p.hit.size >= p.pierce) { p.life = 0; consumed = true; }
        }
      });
    }
    compact(this.projectiles, (p) => p.life > 0);
  }

  /** Lingering fire fields left by Cinder Mortar impacts. */
  private updateBurnZones(dt: number) {
    // Fire doesn't stack: an enemy burns under the single strongest zone
    // covering it. Summing every overlapping zone let multi-shell mortars
    // carpet one choke into hundreds of dps — zone COUNT dominated every
    // per-zone stat and made Cinder unbalanceable by numbers alone.
    const strongest = new Map<Enemy, { dps: number; src?: Tower }>();
    for (const z of this.burnZones) {
      z.life -= dt;
      if (z.life <= 0) continue;
      this.grid.forEachInRadius(z.pos.x, z.pos.y, z.radius + 16, (e) => {
        if (e.dead || e.finished) return;
        if (e.cloaked && !z.detection && !e.revealed) return;
        if (Math.hypot(e.pos.x - z.pos.x, e.pos.y - z.pos.y) > z.radius + e.def.radius) return;
        const cur = strongest.get(e);
        if (!cur || z.dps > cur.dps) strongest.set(e, { dps: z.dps, src: z.src });
      });
    }
    for (const [e, hit] of strongest) {
      if (e.dead || e.finished) continue;
      this.damageEnemy(e, hit.dps * dt, 'energy', false, hit.src);
    }
    compact(this.burnZones, (z) => z.life > 0);
  }

  /** Seraph tenders repair nearby damaged hulls — grid-scoped to their aura. */
  private updateHealers(dt: number) {
    for (const e of this.enemies) {
      if (!e.def.heal || e.dead || e.finished) continue;
      const heal = e.def.heal;
      this.grid.forEachInRadius(e.pos.x, e.pos.y, heal.radius, (o) => {
        if (o === e || o.dead || o.finished || o.hp >= o.maxHp) return;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) <= heal.radius) {
          o.hp = Math.min(o.maxHp, o.hp + heal.hps * dt);
        }
      });
    }
  }

  private updateNovas(dt: number) {
    for (const n of this.novas) {
      n.r += 230 * dt;
      // only the ring band can be hit; query the disc out to the current radius
      this.grid.forEachInRadius(n.pos.x, n.pos.y, n.r + 16, (e) => {
        if (e.dead || e.finished || n.hit.has(e.uid)) return;
        if (Math.abs(Math.hypot(e.pos.x - n.pos.x, e.pos.y - n.pos.y) - n.r) <= e.def.radius + 10) {
          n.hit.add(e.uid);
          if (n.slowPower > 0) this.applySlow(e, n.slowPower, n.slowDuration);
          this.damageEnemy(e, n.damage, 'energy', true, n.src);
        }
      });
    }
    compact(this.novas, (n) => n.r < n.maxR);
  }

  private explode(p: Projectile) {
    this.explosionFx(p.pos, '#ff9f43', p.splash);
    sfx.explosion();
    if (p.burnZoneDps > 0 && p.burnZoneRadius > 0 && p.burnZoneDuration > 0) {
      if (this.burnZones.length >= 28) this.burnZones.shift();
      this.burnZones.push({
        uid: this.uidSeq++,
        pos: { ...p.pos },
        radius: p.burnZoneRadius,
        dps: p.burnZoneDps,
        life: p.burnZoneDuration,
        maxLife: p.burnZoneDuration,
        color: p.color,
        src: p.src,
        detection: p.detection,
      });
      this.ring(p.pos, p.color, p.burnZoneRadius);
    }
    this.grid.forEachInRadius(p.pos.x, p.pos.y, p.splash + 16, (e) => {
      if (e.dead || e.finished) return;
      if (e.cloaked && !e.revealed && !p.detection) return;
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y) <= p.splash + e.def.radius) {
        const dealt = this.damageEnemy(e, p.damage, p.damageType, p.shred, p.src);
        if (dealt > 0 && p.burnDps > 0) this.applyBurn(e, p.burnDps, p.burnDuration, p.src);
      }
    });
  }

  // ---------- fx ----------

  private updateFx(dt: number) {
    if (this.particles.length > 280) this.particles.splice(0, this.particles.length - 280);
    // in-place compaction that recycles dead particles into the pool (no GC churn)
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        if (this.particlePool.length < 400) this.particlePool.push(pt);
        continue;
      }
      pt.pos.x += pt.vel.x * dt;
      pt.pos.y += pt.vel.y * dt;
      pt.vel.x *= 0.94;
      pt.vel.y *= 0.94;
      if (w !== i) this.particles[w] = pt;
      w++;
    }
    this.particles.length = w;
    for (const b of this.beams) b.life -= dt;
    compact(this.beams, (b) => b.life > 0);
  }

  private addBeam(from: Vec, to: Vec, color: string, width: number, life: number) {
    if (this.fxMuted) return;
    if (this.beams.length >= 70) this.beams.shift(); // pool cap: late waves stay smooth
    this.beams.push({ from: { ...from }, to: { ...to }, color, width, life, maxLife: life });
  }

  /** spawn a particle, reusing a pooled object when available (no allocation) */
  emit(kind: Particle['kind'], x: number, y: number, vx: number, vy: number,
       life: number, size: number, color: string, text?: string) {
    if (this.fxMuted) return;
    if (this.particles.length > 280) return;
    let p = this.particlePool.pop();
    if (p) {
      p.pos.x = x; p.pos.y = y; p.vel.x = vx; p.vel.y = vy;
      p.life = life; p.maxLife = life; p.size = size; p.color = color; p.kind = kind; p.text = text;
    } else {
      p = { pos: { x, y }, vel: { x: vx, y: vy }, life, maxLife: life, size, color, kind, text };
    }
    this.particles.push(p);
  }

  burstFx(pos: Vec, color: string, n: number) {
    if (this.particles.length > 240) return; // pool cap
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.emit('spark', pos.x, pos.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.25, 1.5 + Math.random() * 2, color);
    }
  }

  explosionFx(pos: Vec, color: string, radius: number) {
    this.emit('ring', pos.x, pos.y, 0, 0, 0.35, radius, color);
    this.burstFx(pos, color, 14);
  }

  ring(pos: Vec, color: string, size: number) {
    this.emit('ring', pos.x, pos.y, 0, 0, 0.4, size, color);
  }

  setTargetMode(t: Tower, mode: TargetMode) {
    t.target = mode;
    this.recorder.recordTargetMode(this.telemetryState(), t, mode);
  }

  setTargetFilter(t: Tower, filter: TargetFilter, enabled: boolean) {
    const next = new Set(t.targetFilters);
    if (enabled) next.add(filter);
    else next.delete(filter);
    t.targetFilters = canonicalTargetFilters([...next]);
    this.recorder.recordTargetFilter(this.telemetryState(), t);
  }

  setTargetFilters(t: Tower, filters: TargetFilter[]) {
    t.targetFilters = canonicalTargetFilters(filters);
    this.recorder.recordTargetFilter(this.telemetryState(), t);
  }
}

// ---------- geometry helpers ----------

function canonicalTargetFilters(filters: readonly TargetFilter[]): TargetFilter[] {
  const input = new Set(filters);
  return TARGET_FILTERS.filter((filter) => input.has(filter));
}

function targetFilterMatches(filter: TargetFilter, e: Enemy): boolean {
  switch (filter) {
    case 'boss': return !!e.def.boss;
    case 'armored': return !!e.def.armored;
    case 'cloaked': return e.cloaked || !!e.revealed;
    case 'healer': return !!e.def.heal;
    case 'spawner': return e.def.children.length > 0;
  }
}

function norm(v: Vec): Vec {
  const d = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / d, y: v.y / d };
}

function sqDist(a: Vec, b: Vec): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function freeplayDailyTowerSet(seed: DailyFreeplaySeed): Set<string> {
  const ids = seed.towerIds.filter((id) => TOWER_MAP[id]);
  if (!ids.includes('pulse')) ids.unshift('pulse');
  return new Set(ids);
}

function dailyChallengeTowerSet(challenge: DailyChallenge): Set<string> {
  const ids = (challengeTowerIds(challenge) ?? []).filter((id) => TOWER_MAP[id]);
  if (!ids.includes('pulse') && dailyAllowsTower(challenge, TOWER_MAP.pulse)) ids.unshift('pulse');
  return new Set(ids);
}

export function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Rough intercept prediction: where will the enemy be when the bolt arrives? */
function predict(e: Enemy, path: Vec[], from: Vec, projSpeed: number, speedMult = 1): Vec {
  const eta = Math.hypot(e.pos.x - from.x, e.pos.y - from.y) / projSpeed;
  let move = e.def.speed * speedMult * e.slow * eta;
  let pos = { ...e.pos };
  let wp = e.wp;
  while (move > 0 && wp < path.length) {
    const target = path[wp];
    const dx = target.x - pos.x, dy = target.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= move) {
      pos = { ...target };
      move -= d;
      wp++;
    } else {
      pos = { x: pos.x + (dx / d) * move, y: pos.y + (dy / d) * move };
      move = 0;
    }
  }
  return pos;
}

export interface EnemyDefLookup {
  [id: string]: EnemyDef;
}
