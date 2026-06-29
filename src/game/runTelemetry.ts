import type {
  AbilityId,
  DifficultyDef,
  Enemy,
  GameMap,
  PickupKind,
  TargetMode,
  Tower,
  TowerDef,
  Vec,
} from './types';
import { appMetrics, METRIC_EVENTS, type AppMetricSnapshot, type InputKind, type MetricEventName } from './metrics';
import { balanceVersion } from './balanceConfig';

export const RUN_TELEMETRY_SCHEMA = 2;
export const RUN_EVENT_CHUNK_SIZE = 650;
const IDLE_AFTER_S = 25;
const QUICK_SELL_S = 30;

export type RunOutcome = 'victory' | 'armistice' | 'gameover' | 'abandoned';
export type RunPanelKind = 'none' | 'shop' | 'upgrade';

export interface RunEvent {
  type: string;
  t: number;
  wave: number;
  cash: number;
  lives: number;
  [key: string]: unknown;
}

export interface RunTowerSnapshot {
  towerUid: number;
  towerId: string;
  x: number;
  y: number;
  placedAtS: number;
  soldAtS?: number;
  tierA: number;
  tierB: number;
  damage: number;
  // heavy fields — present on final.towers, OMITTED from per-wave snapshots to keep the
  // run doc under Firestore's 1MB limit (they were duplicated across ~120 snapshots).
  name?: string;
  committed?: 0 | 1 | null;
  targetMode?: TargetMode;
  invested?: number;
  kills?: number;
  upgrades?: { t: number; track: 0 | 1; tier: number; name: string; cost: number }[];
}

/** Minimal per-snapshot tower — only what the replay flipbook reconstructs from. */
export type RunTowerLean = Pick<RunTowerSnapshot, 'towerUid' | 'towerId' | 'x' | 'y' | 'placedAtS' | 'soldAtS' | 'tierA' | 'tierB' | 'damage'>;

export interface RunWaveSnapshot {
  label: string;
  t: number;
  wave: number;
  cash: number;
  lives: number;
  kills: number;
  leaks: number;
  towerCount: number;
  enemyCount: number;
  damageByTower: Record<string, number>;
  killsByEnemy: Record<string, number>;
  towers: RunTowerSnapshot[];
}

export interface RunTelemetryState {
  time: number;
  wave: number;
  credits: number;
  lives: number;
  totalKills: number;
  freeplay: boolean;
  phase: string;
  towers: Tower[];
  enemyCount: number;
  speed: number;
  paused: boolean;
  runStats: {
    dmg: Record<string, number>;
    dmgByTowerUid: Record<number, number>;
    kills: Record<string, number>;
    leaks: number;
    abilitiesCast: number;
    cashEarned: number;
  };
}

export interface RunRecorderStart {
  map: GameMap;
  diff: DifficultyDef;
  startingCash: number;
  startingLives: number;
  availableTowerIds: string[];
  lifetimeKillsAtStart: number;
  runsBeforeStart: number;
  victoriesBeforeStart: number;
  session: {
    firstSeenAt: number;
    lastSeenAt: number;
    sessions: number;
    sessionsToday: number;
    daysSinceFirstSeen: number;
    daysSinceLastSeen: number;
  };
}

export interface PublicRunDoc {
  schemaVersion: number;
  runId: string;
  replayTokenHash?: string;
  createdAt: number;
  endedAt: number;
  build: string;
  chunkCount: number;
  eventCount: number;
  summary: {
    callsign: string;
    map: string;
    mapName: string;
    diff: string;
    diffName: string;
    freeplay: boolean;
    daily?: string;
    contractId?: string;
    scoreMultiplierEnd?: number;
    outcome: RunOutcome;
    phase: string;
    wave: number;
    kills: number;
    credits: number;
    cashEarned: number;
    leaks: number;
    coresLeft: number;
    durationS: number;
  };
  setup: {
    map: string;
    mapName: string;
    mapHash: string;
    diff: string;
    diffName: string;
    startingCash: number;
    startingLives: number;
    availableTowerIds: string[];
    balanceVersion: string;
  };
  events: RunEvent[];
  snapshots: RunWaveSnapshot[];
  final: {
    towers: RunTowerSnapshot[];
    damageByTower: Record<string, number>;
    killsByEnemy: Record<string, number>;
    abilitiesCast: number;
    cashEarned: number;
    leaks: number;
  };
}

export interface RunEventChunkDoc {
  schemaVersion: number;
  runId: string;
  chunk: number;
  events: RunEvent[];
}

export type RunCheckpointReason = 'interval' | 'wave' | 'terminal' | 'visibility' | 'abort' | 'score' | 'bank';

export interface RunCheckpointDoc {
  schemaVersion: number;
  runId: string;
  uid: string;
  chunk: number;
  reason: RunCheckpointReason;
  createdAt: number;
  build: string;
  summary: PublicRunDoc['summary'];
  performance: {
    fpsMin: number;
    fpsAvg: number;
    fpsSamples: number;
    longFrames: number;
    viewportW: number;
    viewportH: number;
    devicePixelRatio: number;
    qualityDowngrades: number;
    qualityRecoveries: number;
  };
  attention: {
    activeS: number;
    hiddenS: number;
    idleS: number;
    pausedS: number;
  };
  counters: {
    events: number;
    snapshots: number;
    towers: number;
    enemies: number;
    waves: number;
    leaks: number;
    scoreSubmitAttempts: number;
    checkpointSubmits: number;
  };
  recentEvents: RunEvent[];
  latestSnapshot: RunWaveSnapshot | null;
}

export type ControlsAnalytics = AppMetricSnapshot['controls'] & {
  pauseToggles: number;
  firstPauseAt: number;
  speedChanges: number;
  speed1Clicks: number;
  speed2Clicks: number;
  speed4Clicks: number;
  autoToggles: number;
  sidePanelCollapses: number;
  sidePanelExpands: number;
  abortArmed: number;
  abortConfirmed: number;
  placementCancels: number;
  abilityAimCancels: number;
  waveLaunchClicks: number;
  waveLaunchKeys: number;
  cloakTipViews: number;
  tutorialViews: number;
  briefingViews: number;
};

export interface CombatAnalytics {
  firstLeakWave: number;
  biggestLeakWave: number;
  biggestLeakCores: number;
  leaksByEnemy: Record<string, number>;
  cloakedLeakCores: number;
  revealedLeakCores: number;
  armoredLeakCores: number;
  bossLeakCores: number;
  peakEnemies: number;
  waveStarts: number;
  waveEnds: number;
  avgWaveDurationS: number;
  longestWaveDurationS: number;
  enemiesAtEnd: number;
  abilityCasts: Record<string, number>;
  pickupCollects: Record<string, number>;
}

export interface PlacementAnalytics {
  firstTowerId: string | null;
  buildOrder: string[];
  upgradeOrder: string[];
  placedByTower: Record<string, number>;
  soldByTower: Record<string, number>;
  failedByReason: Record<string, number>;
  failedByTower: Record<string, number>;
  failedUpgradeByReason: Record<string, number>;
  placementCells: Record<string, number>;
  failedPlacementCells: Record<string, number>;
  sellCells: Record<string, number>;
  beaconZonePlacements: number;
  darkZonePlacements: number;
  blueprintSaves: number;
  blueprintApplies: number;
  blueprintApplyPlaced: number;
  targetModeChanges: number;
  quickSellbacks: number;
}

export type AssistanceAnalytics = AppMetricSnapshot['assistance'] & {
  widgetPauseS: number;
};

export interface FreeplayAnalytics {
  entered: boolean;
  contractId: string | null;
  dailyId: string | null;
  scoreMultiplierEnd: number;
  contractSelections: Record<string, number>;
  relicOffers: number;
  relicSelections: Record<string, number>;
  riskOffers: Record<string, number>;
  riskAccepted: Record<string, number>;
  riskDeclined: Record<string, number>;
  riskCleared: Record<string, number>;
  checkpointSubmits: number;
  mutatorWaves: Record<string, number>;
  rivalSpawns: Record<string, number>;
  rivalDefeats: Record<string, number>;
}

export interface PrivateRunAnalyticsDoc {
  schemaVersion: number;
  runId: string;
  uid: string;
  createdAt: number;
  endedAt: number;
  build: string;
  summary: PublicRunDoc['summary'];
  onboarding: Record<string, number | boolean | string | null>;
  abandonment: Record<string, number | boolean | string | null>;
  difficulty: Record<string, number | string | null>;
  economy: Record<string, number | string | null>;
  menu: AppMetricSnapshot['menu'];
  controls: ControlsAnalytics;
  combat: CombatAnalytics;
  placement: PlacementAnalytics;
  assistance: AssistanceAnalytics;
  freeplay: FreeplayAnalytics;
  towerInterest: {
    shopOpens: number;
    shopSelections: Record<string, number>;
    lockedTowerClicks: Record<string, number>;
    unaffordableTowerClicks: Record<string, number>;
    failedPlacements: number;
    upgradePanelOpens: number;
    upgradePanelByTower: Record<string, number>;
    failedUpgrades: number;
    quickSellbacks: number;
    targetModeChanges: number;
    abilityUses: Record<string, number>;
    pickupCollects: Record<string, number>;
  };
  progression: {
    lifetimeKillsAtStart: number;
    runsBeforeStart: number;
    victoriesBeforeStart: number;
    firstSeenAt: number;
    lastSeenAt: number;
    sessions: number;
    sessionsToday: number;
    daysSinceFirstSeen: number;
    daysSinceLastSeen: number;
    unlocksEarned: string[];
    unlocksViewed: string[];
    unlockedTowerIdsUsed: string[];
  };
  leaderboard: Record<string, number | boolean | string | null>;
  attention: {
    activeS: number;
    hiddenS: number;
    idleS: number;
    pausedS: number;
    focusLosses: number;
    sessionS: number;
    sidePanelS: number;
    shopPanelS: number;
    upgradePanelS: number;
    overlayS: number;
    widgetOpenS: number;
    speed1S: number;
    speed2S: number;
    speed4S: number;
  };
  performance: {
    viewportW: number;
    viewportH: number;
    devicePixelRatio: number;
    fpsMin: number;
    fpsAvg: number;
    fpsSamples: number;
    longFrames: number;
    qualityDowngrades: number;
    qualityRecoveries: number;
    displayStandalone: boolean;
    installPromptSeen: number;
    installed: number;
    userAgent: string;
  };
}

export interface RunUploadBundle {
  run: PublicRunDoc;
  chunks: RunEventChunkDoc[];
}

interface TowerLedger extends RunTowerSnapshot {
  placedAtWave: number;
  // the in-memory ledger keeps the full record (only the serialized snapshot is lean)
  name: string;
  committed: 0 | 1 | null;
  targetMode: TargetMode;
  invested: number;
  kills: number;
  upgrades: { t: number; track: 0 | 1; tier: number; name: string; cost: number }[];
}

interface AttentionSample {
  hidden: boolean;
  paused: boolean;
  speed: number;
  panel: RunPanelKind;
  overlay: boolean;
  widgetOpen: boolean;
  fps?: number;
  enemyCount?: number;
  viewportW?: number;
  viewportH?: number;
  devicePixelRatio?: number;
  userAgent?: string;
}

const PUBLIC_CUSTOM_EVENTS = new Set<string>([
  METRIC_EVENTS.FREEPLAY_ENTER,
  METRIC_EVENTS.FREEPLAY_CONTRACT_SELECT,
  METRIC_EVENTS.FREEPLAY_DAILY_START,
  METRIC_EVENTS.FREEPLAY_RELIC_OFFER,
  METRIC_EVENTS.FREEPLAY_RELIC_SELECT,
  METRIC_EVENTS.FREEPLAY_RISK_OFFER,
  METRIC_EVENTS.FREEPLAY_RISK_ACCEPT,
  METRIC_EVENTS.FREEPLAY_RISK_DECLINE,
  METRIC_EVENTS.FREEPLAY_RISK_CLEAR,
  METRIC_EVENTS.FREEPLAY_CHECKPOINT_SUBMIT,
  METRIC_EVENTS.FREEPLAY_MUTATOR_WAVE_START,
  METRIC_EVENTS.FREEPLAY_RIVAL_SPAWN,
  METRIC_EVENTS.FREEPLAY_RIVAL_DEFEAT,
]);

export class RunRecorder {
  readonly runId = makeRunId();
  readonly createdAt = Date.now();
  private start: RunRecorderStart;
  private endedAt = 0;
  private outcome: RunOutcome | null = null;
  private events: RunEvent[] = [];
  private snapshots: RunWaveSnapshot[] = [];
  private ledger = new Map<number, TowerLedger>();
  private cashSpent = 0;
  private cashRefunded = 0;
  private failedPlacements = 0;
  private failedUpgrades = 0;
  private leaksByEnemy: Record<string, number> = {};
  private lastPurchaseAtS = 0;
  private lastInputAtMs = nowMs();
  private focusLosses = 0;
  private hidden = false;
  private fpsTotal = 0;
  private fpsSamples = 0;
  private fpsMin = 999;
  private longFrames = 0;
  private perf = { viewportW: 0, viewportH: 0, devicePixelRatio: 1, userAgent: '' };
  private appAtStart: AppMetricSnapshot;

  private funnel: Record<string, number | boolean | string | null> = {
    firstMapSelected: null,
    firstDifficultySelected: null,
    deployClickedAt: 0,
    firstTowerPlacedAt: 0,
    firstUpgradeBoughtAt: 0,
    firstWaveSurvivedAt: 0,
    firstLossAt: 0,
    firstWinAt: 0,
  };

  private towerInterest = {
    shopOpens: 0,
    shopSelections: {} as Record<string, number>,
    lockedTowerClicks: {} as Record<string, number>,
    unaffordableTowerClicks: {} as Record<string, number>,
    upgradePanelOpens: 0,
    upgradePanelByTower: {} as Record<string, number>,
    quickSellbacks: 0,
    targetModeChanges: 0,
    abilityUses: {} as Record<string, number>,
    pickupCollects: {} as Record<string, number>,
  };

  private progression = {
    unlocksEarned: [] as string[],
    unlocksViewed: [] as string[],
    unlockedTowerIdsUsed: [] as string[],
  };

  private leaderboard = {
    opened: false,
    openCount: 0,
    scoreSubmitAttempts: 0,
    scoreSubmitFailures: 0,
    scoreSubmitted: false,
    replaySubmitAttempts: 0,
    replaySubmitFailures: 0,
    replaySubmitted: false,
    lastSubmitAtS: 0,
    rowClicks: 0,
    replayOpens: 0,
    nextRunAfterLeaderboard: false,
  };

  private attention = {
    activeS: 0,
    hiddenS: 0,
    idleS: 0,
    pausedS: 0,
    sessionS: 0,
    sidePanelS: 0,
    shopPanelS: 0,
    upgradePanelS: 0,
    overlayS: 0,
    widgetOpenS: 0,
    speed1S: 0,
    speed2S: 0,
    speed4S: 0,
  };

  private controls = {
    pauseToggles: 0,
    firstPauseAt: 0,
    speedChanges: 0,
    speed1Clicks: 0,
    speed2Clicks: 0,
    speed4Clicks: 0,
    autoToggles: 0,
    sidePanelCollapses: 0,
    sidePanelExpands: 0,
    abortArmed: 0,
    abortConfirmed: 0,
    placementCancels: 0,
    abilityAimCancels: 0,
    waveLaunchClicks: 0,
    waveLaunchKeys: 0,
    cloakTipViews: 0,
    tutorialViews: 0,
    briefingViews: 0,
  };

  private combat = {
    firstLeakWave: 0,
    biggestLeakWave: 0,
    biggestLeakCores: 0,
    cloakedLeakCores: 0,
    revealedLeakCores: 0,
    armoredLeakCores: 0,
    bossLeakCores: 0,
    peakEnemies: 0,
    waveStarts: 0,
    waveEnds: 0,
    waveDurations: [] as number[],
    currentWaveStartedAt: 0,
  };

  private placement = {
    firstTowerId: null as string | null,
    buildOrder: [] as string[],
    upgradeOrder: [] as string[],
    placedByTower: {} as Record<string, number>,
    soldByTower: {} as Record<string, number>,
    failedByReason: {} as Record<string, number>,
    failedByTower: {} as Record<string, number>,
    failedUpgradeByReason: {} as Record<string, number>,
    placementCells: {} as Record<string, number>,
    failedPlacementCells: {} as Record<string, number>,
    sellCells: {} as Record<string, number>,
    beaconZonePlacements: 0,
    darkZonePlacements: 0,
    blueprintSaves: 0,
    blueprintApplies: 0,
    blueprintApplyPlaced: 0,
  };

  private freeplay = {
    entered: false,
    contractId: null as string | null,
    dailyId: null as string | null,
    scoreMultiplierEnd: 1,
    contractSelections: {} as Record<string, number>,
    relicOffers: 0,
    relicSelections: {} as Record<string, number>,
    riskOffers: {} as Record<string, number>,
    riskAccepted: {} as Record<string, number>,
    riskDeclined: {} as Record<string, number>,
    riskCleared: {} as Record<string, number>,
    checkpointSubmits: 0,
    mutatorWaves: {} as Record<string, number>,
    rivalSpawns: {} as Record<string, number>,
    rivalDefeats: {} as Record<string, number>,
  };

  constructor(start: RunRecorderStart) {
    this.start = start;
    this.appAtStart = appMetrics.snapshot();
    this.funnel.firstMapSelected = start.map.id;
    this.funnel.firstDifficultySelected = start.diff.id;
    this.funnel.deployClickedAt = this.appAtStart.menu.firstDeployAtS;
  }

  setAvailableTowerIds(ids: string[]): void {
    this.start.availableTowerIds = [...new Set(ids)].slice(0, 40);
  }

  setStartingResources(cash: number, lives: number): void {
    this.start.startingCash = Math.max(0, Math.floor(cash));
    this.start.startingLives = Math.max(0, Math.floor(lives));
  }

  recordRunStart(state: RunTelemetryState): void {
    this.record('run_start', state, {
      map: this.start.map.id,
      diff: this.start.diff.id,
      startingCash: this.start.startingCash,
      startingLives: this.start.startingLives,
      availableTowerIds: this.start.availableTowerIds,
    });
    this.snapshot('run_start', state);
  }

  recordWaveStart(state: RunTelemetryState, groups: { type: string; count: number; cloaked: boolean; gap?: number; delay?: number }[]): void {
    this.combat.waveStarts++;
    this.combat.currentWaveStartedAt = state.time;
    this.record('wave_start', state, { groups, towerCount: state.towers.length });
    this.snapshot('wave_start', state);
  }

  recordWaveEnd(state: RunTelemetryState, waveBonusCredits: number): void {
    this.combat.waveEnds++;
    if (this.combat.currentWaveStartedAt > 0) {
      this.combat.waveDurations.push(roundS(state.time - this.combat.currentWaveStartedAt));
    }
    this.record('wave_end', state, {
      waveBonus: waveBonusCredits,
      kills: state.totalKills,
      leaks: state.runStats.leaks,
      towerCount: state.towers.length,
    });
    if (!this.funnel.firstWaveSurvivedAt) this.funnel.firstWaveSurvivedAt = roundS(state.time);
    this.snapshot('wave_end', state);
  }

  recordCampaignClear(state: RunTelemetryState): void {
    this.record('campaign_clear', state, { kills: state.totalKills, cashEarned: state.runStats.cashEarned });
    if (!this.funnel.firstWinAt) this.funnel.firstWinAt = roundS(state.time);
    this.snapshot('campaign_clear', state);
  }

  recordTowerPlace(state: RunTelemetryState, tower: Tower, cost: number): void {
    this.cashSpent += cost;
    this.lastPurchaseAtS = state.time;
    if (!this.funnel.firstTowerPlacedAt) this.funnel.firstTowerPlacedAt = roundS(state.time);
    if (!this.placement.firstTowerId) this.placement.firstTowerId = tower.def.id;
    this.placement.buildOrder.push(tower.def.id);
    if (this.placement.buildOrder.length > 40) this.placement.buildOrder.shift();
    bump(this.placement.placedByTower, tower.def.id);
    bump(this.placement.placementCells, cellKey(tower.pos));
    if (this.start.map.zones) {
      if (this.start.map.zones.some((z) => Math.hypot(tower.pos.x - z.x, tower.pos.y - z.y) <= z.r)) {
        this.placement.beaconZonePlacements++;
      } else {
        this.placement.darkZonePlacements++;
      }
    }
    if (!this.progression.unlockedTowerIdsUsed.includes(tower.def.id)) {
      this.progression.unlockedTowerIdsUsed.push(tower.def.id);
    }
    this.ledger.set(tower.uid, {
      towerUid: tower.uid,
      towerId: tower.def.id,
      name: tower.def.name,
      x: roundPos(tower.pos.x),
      y: roundPos(tower.pos.y),
      placedAtS: roundS(state.time),
      placedAtWave: state.wave,
      tierA: tower.tierA,
      tierB: tower.tierB,
      committed: tower.committed,
      targetMode: tower.target,
      invested: Math.round(tower.invested),
      kills: tower.kills,
      damage: 0,
      upgrades: [],
    });
    this.record('tower_place', state, {
      towerUid: tower.uid,
      towerId: tower.def.id,
      name: tower.def.name,
      x: roundPos(tower.pos.x),
      y: roundPos(tower.pos.y),
      cost,
      cashAfter: Math.floor(state.credits),
    });
  }

  recordTowerUpgrade(state: RunTelemetryState, tower: Tower, track: 0 | 1, cost: number, upgradeName: string): void {
    this.cashSpent += cost;
    this.lastPurchaseAtS = state.time;
    if (!this.funnel.firstUpgradeBoughtAt) this.funnel.firstUpgradeBoughtAt = roundS(state.time);
    const tier = track === 0 ? tower.tierA : tower.tierB;
    const entry = this.ensureTower(tower, state);
    entry.tierA = tower.tierA;
    entry.tierB = tower.tierB;
    entry.committed = tower.committed;
    entry.invested = Math.round(tower.invested);
    entry.upgrades.push({ t: roundS(state.time), track, tier, name: upgradeName, cost });
    this.placement.upgradeOrder.push(`${tower.def.id}:${track}:${tier}`);
    if (this.placement.upgradeOrder.length > 60) this.placement.upgradeOrder.shift();
    this.record('tower_upgrade', state, {
      towerUid: tower.uid,
      towerId: tower.def.id,
      track,
      tier,
      upgradeName,
      cost,
      cashAfter: Math.floor(state.credits),
      committed: tower.committed,
    });
  }

  recordTowerSell(state: RunTelemetryState, tower: Tower, refund: number): void {
    this.cashRefunded += refund;
    const entry = this.ensureTower(tower, state);
    entry.soldAtS = roundS(state.time);
    entry.tierA = tower.tierA;
    entry.tierB = tower.tierB;
    entry.committed = tower.committed;
    entry.targetMode = tower.target;
    entry.invested = Math.round(tower.invested);
    entry.kills = tower.kills;
    entry.damage = Math.round(state.runStats.dmgByTowerUid[tower.uid] ?? entry.damage ?? 0);
    if (state.time - entry.placedAtS <= QUICK_SELL_S) this.towerInterest.quickSellbacks++;
    bump(this.placement.soldByTower, tower.def.id);
    bump(this.placement.sellCells, cellKey(tower.pos));
    this.record('tower_sell', state, {
      towerUid: tower.uid,
      towerId: tower.def.id,
      x: roundPos(tower.pos.x),
      y: roundPos(tower.pos.y),
      refund,
      invested: Math.round(tower.invested),
      cashAfter: Math.floor(state.credits),
    });
  }

  recordTargetMode(state: RunTelemetryState, tower: Tower, mode: TargetMode): void {
    const entry = this.ensureTower(tower, state);
    entry.targetMode = mode;
    this.towerInterest.targetModeChanges++;
    this.record('target_mode', state, { towerUid: tower.uid, towerId: tower.def.id, mode });
  }

  recordAbilityCast(state: RunTelemetryState, id: AbilityId, pos?: Vec): void {
    bump(this.towerInterest.abilityUses, id);
    this.record('ability_cast', state, {
      abilityId: id,
      x: pos ? roundPos(pos.x) : null,
      y: pos ? roundPos(pos.y) : null,
      cashAfter: Math.floor(state.credits),
    });
  }

  recordEnemySpawn(state: RunTelemetryState, enemy: Enemy, parentUid?: number): void {
    this.record('enemy_spawn', state, {
      enemyUid: enemy.uid,
      enemyId: enemy.def.id,
      x: roundPos(enemy.pos.x),
      y: roundPos(enemy.pos.y),
      dist: Math.round(enemy.dist),
      wp: enemy.wp,
      hp: Math.round(enemy.maxHp),
      cloaked: enemy.cloaked,
      boss: !!enemy.def.boss,
      parentUid: parentUid ?? null,
    });
  }

  recordEnemyKill(state: RunTelemetryState, enemy: Enemy, src: Tower | undefined, reward: number): void {
    this.record('enemy_kill', state, {
      enemyUid: enemy.uid,
      enemyId: enemy.def.id,
      x: roundPos(enemy.pos.x),
      y: roundPos(enemy.pos.y),
      dist: Math.round(enemy.dist),
      wp: enemy.wp,
      reward: Math.max(0, Math.round(reward)),
      boss: !!enemy.def.boss,
      children: enemy.def.children.slice(0, 12),
      towerUid: src?.uid ?? null,
      towerId: src?.def.id ?? null,
    });
  }

  recordPickupCollect(state: RunTelemetryState, kind: PickupKind, pos: Vec, value: number): void {
    bump(this.towerInterest.pickupCollects, kind);
    this.record('pickup_collect', state, {
      kind,
      x: roundPos(pos.x),
      y: roundPos(pos.y),
      value,
      cashAfter: Math.floor(state.credits),
    });
  }

  recordReceiverBuild(state: RunTelemetryState, cost: number): void {
    this.cashSpent += cost;
    this.lastPurchaseAtS = state.time;
    this.record('receiver_build', state, { cost, cashAfter: Math.floor(state.credits) });
  }

  recordBlueprint(state: RunTelemetryState, action: 'save' | 'apply', count: number): void {
    if (action === 'save') this.placement.blueprintSaves++;
    else {
      this.placement.blueprintApplies++;
      this.placement.blueprintApplyPlaced += Math.max(0, Math.round(count));
    }
    this.record(`blueprint_${action}`, state, { count });
  }

  recordCustom(type: MetricEventName | string, state: RunTelemetryState, payload: Record<string, unknown> = {}): void {
    const cleanType = sanitizeEventType(type);
    const cleanPayload = sanitizePayload(payload);
    this.applyCustomSummary(cleanType, cleanPayload);
    if (PUBLIC_CUSTOM_EVENTS.has(cleanType)) this.record(cleanType, state, cleanPayload);
  }

  recordLeak(
    state: RunTelemetryState,
    enemyId: string,
    coresLost: number,
    traits: { cloaked?: boolean; revealed?: boolean; armored?: boolean; boss?: boolean } = {},
    enemy?: Enemy,
  ): void {
    this.leaksByEnemy[enemyId] = (this.leaksByEnemy[enemyId] ?? 0) + coresLost;
    if (!this.combat.firstLeakWave) this.combat.firstLeakWave = state.wave;
    if (coresLost > this.combat.biggestLeakCores) {
      this.combat.biggestLeakCores = coresLost;
      this.combat.biggestLeakWave = state.wave;
    }
    if (traits.cloaked) this.combat.cloakedLeakCores += coresLost;
    if (traits.revealed) this.combat.revealedLeakCores += coresLost;
    if (traits.armored) this.combat.armoredLeakCores += coresLost;
    if (traits.boss) this.combat.bossLeakCores += coresLost;
    this.record('leak', state, {
      enemyId,
      coresLost,
      coresLeft: state.lives,
      enemyUid: enemy?.uid ?? null,
      x: enemy ? roundPos(enemy.pos.x) : null,
      y: enemy ? roundPos(enemy.pos.y) : null,
      dist: enemy ? Math.round(enemy.dist) : null,
      wp: enemy?.wp ?? null,
      boss: !!enemy?.def.boss,
    });
  }

  recordRunEnd(state: RunTelemetryState, outcome: RunOutcome, reason?: string): void {
    this.outcome = outcome;
    this.endedAt = Date.now();
    if (outcome === 'gameover' && !this.funnel.firstLossAt) this.funnel.firstLossAt = roundS(state.time);
    if ((outcome === 'victory' || outcome === 'armistice') && !this.funnel.firstWinAt) this.funnel.firstWinAt = roundS(state.time);
    this.record('run_end', state, {
      outcome,
      reason: reason ?? null,
      kills: state.totalKills,
      cashEarned: Math.round(state.runStats.cashEarned),
      leaks: state.runStats.leaks,
    });
    this.snapshot('run_end', state);
  }

  recordAbandoned(state: RunTelemetryState, reason: string): void {
    if (this.outcome) return;
    this.recordRunEnd(state, 'abandoned', reason);
  }

  recordFailedPlacement(state: RunTelemetryState, towerId: string, reason: string, cost: number, pos?: Vec): void {
    this.failedPlacements++;
    if (reason === 'credits') bump(this.towerInterest.unaffordableTowerClicks, towerId);
    bump(this.placement.failedByReason, reason);
    bump(this.placement.failedByTower, towerId);
    if (pos) bump(this.placement.failedPlacementCells, cellKey(pos));
    this.privateEvent('tower_place_failed', state, {
      towerId,
      reason,
      cost,
      x: pos ? roundPos(pos.x) : null,
      y: pos ? roundPos(pos.y) : null,
    });
  }

  recordFailedUpgrade(state: RunTelemetryState, tower: Tower, track: 0 | 1, reason: string, cost: number): void {
    this.failedUpgrades++;
    bump(this.placement.failedUpgradeByReason, reason);
    this.privateEvent('tower_upgrade_failed', state, { towerUid: tower.uid, towerId: tower.def.id, track, reason, cost });
  }

  recordShopOpen(): void {
    this.towerInterest.shopOpens++;
  }

  recordTowerShopSelect(tower: TowerDef, status: 'selected' | 'locked' | 'unaffordable'): void {
    bump(this.towerInterest.shopSelections, tower.id);
    if (status === 'locked') bump(this.towerInterest.lockedTowerClicks, tower.id);
    if (status === 'unaffordable') bump(this.towerInterest.unaffordableTowerClicks, tower.id);
  }

  recordUpgradePanelOpen(tower: Tower): void {
    this.towerInterest.upgradePanelOpens++;
    bump(this.towerInterest.upgradePanelByTower, tower.def.id);
  }

  recordUnlockEarned(towerId: string): void {
    if (!this.progression.unlocksEarned.includes(towerId)) this.progression.unlocksEarned.push(towerId);
  }

  recordUnlockViewed(towerId: string): void {
    if (!this.progression.unlocksViewed.includes(towerId)) this.progression.unlocksViewed.push(towerId);
  }

  recordLeaderboardOpen(): void {
    this.leaderboard.opened = true;
    this.leaderboard.openCount++;
  }

  recordLeaderboardRowClick(): void {
    this.leaderboard.rowClicks++;
  }

  recordReplayOpen(): void {
    this.leaderboard.replayOpens++;
  }

  recordScoreSubmitAttempt(state: RunTelemetryState): void {
    this.leaderboard.scoreSubmitAttempts++;
    this.leaderboard.lastSubmitAtS = roundS(state.time);
  }

  recordScoreSubmitResult(ok: boolean): void {
    this.leaderboard.scoreSubmitted = this.leaderboard.scoreSubmitted || ok;
    if (!ok) this.leaderboard.scoreSubmitFailures++;
  }

  recordReplaySubmitResult(ok: boolean): void {
    this.leaderboard.replaySubmitAttempts++;
    this.leaderboard.replaySubmitted = this.leaderboard.replaySubmitted || ok;
    if (!ok) this.leaderboard.replaySubmitFailures++;
  }

  noteInput(kind?: InputKind): void {
    this.lastInputAtMs = nowMs();
    if (kind) appMetrics.recordInput(kind);
  }

  noteVisibility(hidden: boolean): void {
    if (hidden && !this.hidden) this.focusLosses++;
    this.hidden = hidden;
  }

  observeAttention(dt: number, sample: AttentionSample): void {
    if (dt <= 0 || dt > 2) return;
    if (dt >= 0.1) this.longFrames++;
    if (sample.enemyCount !== undefined) this.combat.peakEnemies = Math.max(this.combat.peakEnemies, Math.round(sample.enemyCount));
    this.noteVisibility(sample.hidden);
    this.attention.sessionS += dt;
    if (sample.hidden) this.attention.hiddenS += dt;
    else this.attention.activeS += dt;
    if (sample.paused) this.attention.pausedS += dt;
    if (sample.overlay) this.attention.overlayS += dt;
    if (sample.widgetOpen) this.attention.widgetOpenS += dt;
    if (sample.panel !== 'none') this.attention.sidePanelS += dt;
    if (sample.panel === 'shop') this.attention.shopPanelS += dt;
    if (sample.panel === 'upgrade') this.attention.upgradePanelS += dt;
    if (sample.speed <= 1) this.attention.speed1S += dt;
    else if (sample.speed <= 2) this.attention.speed2S += dt;
    else this.attention.speed4S += dt;
    if (nowMs() - this.lastInputAtMs > IDLE_AFTER_S * 1000) this.attention.idleS += dt;
    if (sample.fps && Number.isFinite(sample.fps) && sample.fps > 0) {
      this.fpsTotal += sample.fps;
      this.fpsSamples++;
      this.fpsMin = Math.min(this.fpsMin, sample.fps);
    }
    if (sample.viewportW) this.perf.viewportW = sample.viewportW;
    if (sample.viewportH) this.perf.viewportH = sample.viewportH;
    if (sample.devicePixelRatio) this.perf.devicePixelRatio = sample.devicePixelRatio;
    if (sample.userAgent) this.perf.userAgent = sample.userAgent.slice(0, 220);
  }

  recordControl(event: MetricEventName | string, value?: string | number | boolean): void {
    switch (event) {
      case METRIC_EVENTS.FIRST_PAUSE:
        this.controls.pauseToggles++;
        if (!this.controls.firstPauseAt && typeof value === 'number') this.controls.firstPauseAt = roundS(value);
        break;
      case METRIC_EVENTS.SPEED_CHANGE:
        this.controls.speedChanges++;
        if (value === 1) this.controls.speed1Clicks++;
        else if (value === 2) this.controls.speed2Clicks++;
        else if (value === 4) this.controls.speed4Clicks++;
        break;
      case METRIC_EVENTS.AUTO_TOGGLE:
        this.controls.autoToggles++;
        break;
      case METRIC_EVENTS.SIDE_PANEL_COLLAPSE:
        this.controls.sidePanelCollapses++;
        break;
      case METRIC_EVENTS.SIDE_PANEL_EXPAND:
        this.controls.sidePanelExpands++;
        break;
      case METRIC_EVENTS.ABORT_ARMED:
        this.controls.abortArmed++;
        break;
      case METRIC_EVENTS.ABORT_CONFIRMED:
        this.controls.abortConfirmed++;
        break;
      case METRIC_EVENTS.PLACEMENT_CANCEL:
        this.controls.placementCancels++;
        break;
      case METRIC_EVENTS.ABILITY_AIM_CANCEL:
        this.controls.abilityAimCancels++;
        break;
      case METRIC_EVENTS.WAVE_LAUNCH_CLICK:
        this.controls.waveLaunchClicks++;
        break;
      case METRIC_EVENTS.WAVE_LAUNCH_KEY:
        this.controls.waveLaunchKeys++;
        break;
      case METRIC_EVENTS.CLOAK_TIP_VIEW:
        this.controls.cloakTipViews++;
        break;
      case METRIC_EVENTS.TUTORIAL_VIEW:
        this.controls.tutorialViews++;
        break;
      case METRIC_EVENTS.BRIEFING_VIEW:
        this.controls.briefingViews++;
        break;
      default:
        void value;
        break;
    }
  }

  makePublicRun(state: RunTelemetryState, callsign: string, build: string): RunUploadBundle {
    // Firestore rules cap chunkCount <= 100 and eventCount <= 100000; stop emitting overflow
    // chunks at the ceiling so a marathon run's replay (and its score) never gets rejected.
    const MAX_CHUNKS = 100;
    const allEvents = this.withSyntheticEnd(state);
    const runEvents = allEvents.slice(0, RUN_EVENT_CHUNK_SIZE);
    const chunks: RunEventChunkDoc[] = [];
    for (let i = RUN_EVENT_CHUNK_SIZE; i < allEvents.length && chunks.length < MAX_CHUNKS; i += RUN_EVENT_CHUNK_SIZE) {
      chunks.push(stripUndefined({
        schemaVersion: RUN_TELEMETRY_SCHEMA,
        runId: this.runId,
        chunk: chunks.length,
        events: allEvents.slice(i, i + RUN_EVENT_CHUNK_SIZE),
      }));
    }
    const retainedEvents = runEvents.length + chunks.reduce((n, c) => n + c.events.length, 0);
    const run: PublicRunDoc = stripUndefined({
      schemaVersion: RUN_TELEMETRY_SCHEMA,
      runId: this.runId,
      createdAt: this.createdAt,
      endedAt: this.endedAt || Date.now(),
      build,
      chunkCount: chunks.length,
      eventCount: retainedEvents,
      summary: this.summary(state, callsign),
      setup: {
        map: this.start.map.id,
        mapName: this.start.map.name,
        mapHash: hashMap(this.start.map),
        diff: this.start.diff.id,
        diffName: this.start.diff.name,
        startingCash: this.start.startingCash,
        startingLives: this.start.startingLives,
        availableTowerIds: [...this.start.availableTowerIds],
        balanceVersion: balanceVersion() || build,
      },
      events: runEvents,
      snapshots: this.snapshots.slice(-80),
      final: {
        towers: this.finalTowers(state),
        damageByTower: intRecord(state.runStats.dmg),
        killsByEnemy: intRecord(state.runStats.kills),
        abilitiesCast: Math.round(state.runStats.abilitiesCast),
        cashEarned: Math.round(state.runStats.cashEarned),
        leaks: Math.round(state.runStats.leaks),
      },
    });
    // Hard safety net: Firestore caps a single doc at 1 MB. Even with lean snapshots a very
    // long run could approach it — drop the OLDEST snapshots first (the viewer clamps to the
    // captured window anyway), then trim head events, so score submission never fails on size.
    const DOC_LIMIT = 900_000;
    const size = () => JSON.stringify(run).length;
    while (size() > DOC_LIMIT && run.snapshots.length > 12) {
      run.snapshots = run.snapshots.slice(Math.ceil(run.snapshots.length * 0.2));
    }
    while (size() > DOC_LIMIT && run.events.length > 40) {
      run.events = run.events.slice(0, Math.floor(run.events.length * 0.6));
    }
    return { run, chunks };
  }

  makePrivateAnalytics(state: RunTelemetryState, uid: string, callsign: string, build: string): PrivateRunAnalyticsDoc {
    const summary = this.summary(state, callsign);
    const app = appMetrics.snapshot();
    const waveDurations = this.combat.waveDurations;
    const avgWaveDurationS = waveDurations.length
      ? Math.round((waveDurations.reduce((sum, value) => sum + value, 0) / waveDurations.length) * 10) / 10
      : 0;
    return {
      schemaVersion: RUN_TELEMETRY_SCHEMA,
      runId: this.runId,
      uid: uid.slice(0, 40),
      createdAt: this.createdAt,
      endedAt: this.endedAt || Date.now(),
      build,
      summary,
      onboarding: { ...this.funnel },
      abandonment: {
        abandoned: summary.outcome === 'abandoned',
        outcome: summary.outcome,
        wave: summary.wave,
        quitWithCash: summary.outcome === 'abandoned' ? summary.credits : 0,
        quitAfterLeak: summary.outcome === 'abandoned' && summary.leaks > 0,
        earlyExit: summary.outcome === 'abandoned' && summary.wave <= 3,
        restartWithin30S: summary.durationS <= 30 && summary.outcome === 'abandoned',
      },
      difficulty: {
        waveAtEnd: summary.wave,
        coresLeft: summary.coresLeft,
        leaks: summary.leaks,
        cashAtEnd: summary.credits,
        cashAtDeath: summary.outcome === 'gameover' ? summary.credits : 0,
        towersAtEnd: state.towers.length,
        topLeakEnemy: topKey(this.leaksByEnemy),
        secondsSinceLastPurchase: Math.max(0, Math.round(state.time - this.lastPurchaseAtS)),
      },
      economy: {
        cashEarned: summary.cashEarned,
        cashSpent: Math.round(this.cashSpent),
        cashRefunded: Math.round(this.cashRefunded),
        cashFloatedEnd: summary.credits,
        cashFloatedMaxSnapshot: Math.max(0, ...this.snapshots.map((s) => s.cash)),
        failedPurchaseAttempts: this.failedPlacements,
        failedUpgradeAttempts: this.failedUpgrades,
        sellCount: [...this.ledger.values()].filter((t) => t.soldAtS !== undefined).length,
        idleWithCashS: Math.max(0, Math.round(state.time - this.lastPurchaseAtS)),
      },
      menu: { ...this.appAtStart.menu, ...app.menu },
      controls: {
        ...app.controls,
        ...this.controls,
      },
      combat: {
        firstLeakWave: this.combat.firstLeakWave,
        biggestLeakWave: this.combat.biggestLeakWave,
        biggestLeakCores: this.combat.biggestLeakCores,
        leaksByEnemy: intRecord(this.leaksByEnemy),
        cloakedLeakCores: Math.round(this.combat.cloakedLeakCores),
        revealedLeakCores: Math.round(this.combat.revealedLeakCores),
        armoredLeakCores: Math.round(this.combat.armoredLeakCores),
        bossLeakCores: Math.round(this.combat.bossLeakCores),
        peakEnemies: Math.round(this.combat.peakEnemies),
        waveStarts: this.combat.waveStarts,
        waveEnds: this.combat.waveEnds,
        avgWaveDurationS,
        longestWaveDurationS: Math.max(0, ...waveDurations),
        enemiesAtEnd: state.enemyCount,
        abilityCasts: intRecord(this.towerInterest.abilityUses),
        pickupCollects: intRecord(this.towerInterest.pickupCollects),
      },
      placement: {
        firstTowerId: this.placement.firstTowerId,
        buildOrder: [...this.placement.buildOrder],
        upgradeOrder: [...this.placement.upgradeOrder],
        placedByTower: intRecord(this.placement.placedByTower),
        soldByTower: intRecord(this.placement.soldByTower),
        failedByReason: intRecord(this.placement.failedByReason),
        failedByTower: intRecord(this.placement.failedByTower),
        failedUpgradeByReason: intRecord(this.placement.failedUpgradeByReason),
        placementCells: intRecord(this.placement.placementCells),
        failedPlacementCells: intRecord(this.placement.failedPlacementCells),
        sellCells: intRecord(this.placement.sellCells),
        beaconZonePlacements: this.placement.beaconZonePlacements,
        darkZonePlacements: this.placement.darkZonePlacements,
        blueprintSaves: this.placement.blueprintSaves,
        blueprintApplies: this.placement.blueprintApplies,
        blueprintApplyPlaced: this.placement.blueprintApplyPlaced,
        targetModeChanges: this.towerInterest.targetModeChanges,
        quickSellbacks: this.towerInterest.quickSellbacks,
      },
      assistance: {
        ...app.assistance,
        widgetPauseS: roundS(this.attention.widgetOpenS),
      },
      freeplay: {
        entered: this.freeplay.entered || state.freeplay,
        contractId: this.freeplay.contractId,
        dailyId: this.freeplay.dailyId,
        scoreMultiplierEnd: this.freeplay.scoreMultiplierEnd,
        contractSelections: intRecord(this.freeplay.contractSelections),
        relicOffers: this.freeplay.relicOffers,
        relicSelections: intRecord(this.freeplay.relicSelections),
        riskOffers: intRecord(this.freeplay.riskOffers),
        riskAccepted: intRecord(this.freeplay.riskAccepted),
        riskDeclined: intRecord(this.freeplay.riskDeclined),
        riskCleared: intRecord(this.freeplay.riskCleared),
        checkpointSubmits: this.freeplay.checkpointSubmits,
        mutatorWaves: intRecord(this.freeplay.mutatorWaves),
        rivalSpawns: intRecord(this.freeplay.rivalSpawns),
        rivalDefeats: intRecord(this.freeplay.rivalDefeats),
      },
      towerInterest: {
        ...this.towerInterest,
        failedPlacements: this.failedPlacements,
        failedUpgrades: this.failedUpgrades,
      },
      progression: {
        lifetimeKillsAtStart: this.start.lifetimeKillsAtStart,
        runsBeforeStart: this.start.runsBeforeStart,
        victoriesBeforeStart: this.start.victoriesBeforeStart,
        firstSeenAt: this.start.session.firstSeenAt,
        lastSeenAt: this.start.session.lastSeenAt,
        sessions: this.start.session.sessions,
        sessionsToday: this.start.session.sessionsToday,
        daysSinceFirstSeen: this.start.session.daysSinceFirstSeen,
        daysSinceLastSeen: this.start.session.daysSinceLastSeen,
        unlocksEarned: [...this.progression.unlocksEarned],
        unlocksViewed: [...this.progression.unlocksViewed],
        unlockedTowerIdsUsed: [...this.progression.unlockedTowerIdsUsed],
      },
      leaderboard: { ...this.leaderboard },
      attention: {
        activeS: roundS(this.attention.activeS),
        hiddenS: roundS(this.attention.hiddenS),
        idleS: roundS(this.attention.idleS),
        pausedS: roundS(this.attention.pausedS),
        focusLosses: this.focusLosses,
        sessionS: roundS(this.attention.sessionS),
        sidePanelS: roundS(this.attention.sidePanelS),
        shopPanelS: roundS(this.attention.shopPanelS),
        upgradePanelS: roundS(this.attention.upgradePanelS),
        overlayS: roundS(this.attention.overlayS),
        widgetOpenS: roundS(this.attention.widgetOpenS),
        speed1S: roundS(this.attention.speed1S),
        speed2S: roundS(this.attention.speed2S),
        speed4S: roundS(this.attention.speed4S),
      },
      performance: {
        viewportW: Math.round(this.perf.viewportW),
        viewportH: Math.round(this.perf.viewportH),
        devicePixelRatio: Math.round(this.perf.devicePixelRatio * 100) / 100,
        fpsMin: this.fpsSamples ? Math.round(this.fpsMin) : 0,
        fpsAvg: this.fpsSamples ? Math.round(this.fpsTotal / this.fpsSamples) : 0,
        fpsSamples: this.fpsSamples,
        longFrames: this.longFrames,
        qualityDowngrades: app.performance.qualityDowngrades,
        qualityRecoveries: app.performance.qualityRecoveries,
        displayStandalone: app.performance.displayStandalone,
        installPromptSeen: app.performance.installPromptSeen,
        installed: app.performance.installed,
        userAgent: this.perf.userAgent,
      },
    };
  }

  makeCheckpoint(
    state: RunTelemetryState,
    uid: string,
    callsign: string,
    build: string,
    chunk: number,
    reason: RunCheckpointReason,
  ): RunCheckpointDoc {
    const analytics = this.makePrivateAnalytics(state, uid, callsign, build);
    return {
      schemaVersion: RUN_TELEMETRY_SCHEMA,
      runId: this.runId,
      uid: uid.slice(0, 40),
      chunk: Math.max(0, Math.floor(chunk)),
      reason,
      createdAt: Date.now(),
      build,
      summary: analytics.summary,
      performance: {
        fpsMin: analytics.performance.fpsMin,
        fpsAvg: analytics.performance.fpsAvg,
        fpsSamples: analytics.performance.fpsSamples,
        longFrames: analytics.performance.longFrames,
        viewportW: analytics.performance.viewportW,
        viewportH: analytics.performance.viewportH,
        devicePixelRatio: analytics.performance.devicePixelRatio,
        qualityDowngrades: analytics.performance.qualityDowngrades,
        qualityRecoveries: analytics.performance.qualityRecoveries,
      },
      attention: {
        activeS: analytics.attention.activeS,
        hiddenS: analytics.attention.hiddenS,
        idleS: analytics.attention.idleS,
        pausedS: analytics.attention.pausedS,
      },
      counters: {
        events: this.events.length,
        snapshots: this.snapshots.length,
        towers: state.towers.length,
        enemies: state.enemyCount,
        waves: state.wave,
        leaks: Math.round(state.runStats.leaks),
        scoreSubmitAttempts: Math.round(Number(analytics.leaderboard.scoreSubmitAttempts ?? 0)),
        checkpointSubmits: this.freeplay.checkpointSubmits,
      },
      recentEvents: this.events.slice(-24),
      latestSnapshot: this.snapshots.at(-1) ?? null,
    };
  }

  private applyCustomSummary(type: string, payload: Record<string, unknown>): void {
    switch (type) {
      case METRIC_EVENTS.FREEPLAY_ENTER:
        this.freeplay.entered = true;
        this.freeplay.contractId = getString(payload, 'contractId') ?? this.freeplay.contractId;
        this.freeplay.dailyId = getString(payload, 'dailyId') ?? this.freeplay.dailyId;
        break;
      case METRIC_EVENTS.FREEPLAY_CONTRACT_SELECT: {
        const id = getString(payload, 'contractId');
        if (id) {
          this.freeplay.contractId = id;
          bump(this.freeplay.contractSelections, id);
        }
        break;
      }
      case METRIC_EVENTS.FREEPLAY_DAILY_START:
        this.freeplay.entered = true;
        this.freeplay.dailyId = getString(payload, 'dailyId') ?? this.freeplay.dailyId;
        break;
      case METRIC_EVENTS.FREEPLAY_RELIC_OFFER:
        this.freeplay.relicOffers++;
        break;
      case METRIC_EVENTS.FREEPLAY_RELIC_SELECT: {
        const id = getString(payload, 'relicId');
        if (id) bump(this.freeplay.relicSelections, id);
        break;
      }
      case METRIC_EVENTS.FREEPLAY_RISK_OFFER: {
        const id = getString(payload, 'riskId');
        if (id) bump(this.freeplay.riskOffers, id);
        break;
      }
      case METRIC_EVENTS.FREEPLAY_RISK_ACCEPT: {
        const id = getString(payload, 'riskId');
        if (id) bump(this.freeplay.riskAccepted, id);
        break;
      }
      case METRIC_EVENTS.FREEPLAY_RISK_DECLINE: {
        const id = getString(payload, 'riskId');
        if (id) bump(this.freeplay.riskDeclined, id);
        break;
      }
      case METRIC_EVENTS.FREEPLAY_RISK_CLEAR: {
        const id = getString(payload, 'riskId');
        if (id) bump(this.freeplay.riskCleared, id);
        this.freeplay.scoreMultiplierEnd = getNumber(payload, 'scoreMult') ?? this.freeplay.scoreMultiplierEnd;
        break;
      }
      case METRIC_EVENTS.FREEPLAY_CHECKPOINT_SUBMIT:
        this.freeplay.checkpointSubmits++;
        this.freeplay.scoreMultiplierEnd = getNumber(payload, 'multiplier') ?? this.freeplay.scoreMultiplierEnd;
        break;
      case METRIC_EVENTS.FREEPLAY_MUTATOR_WAVE_START:
        for (const id of getStringArray(payload, 'mutators')) bump(this.freeplay.mutatorWaves, id);
        break;
      case METRIC_EVENTS.FREEPLAY_RIVAL_SPAWN: {
        const id = getString(payload, 'rivalId');
        if (id) bump(this.freeplay.rivalSpawns, id);
        break;
      }
      case METRIC_EVENTS.FREEPLAY_RIVAL_DEFEAT: {
        const id = getString(payload, 'rivalId');
        if (id) bump(this.freeplay.rivalDefeats, id);
        this.freeplay.scoreMultiplierEnd = getNumber(payload, 'scoreMult') ?? this.freeplay.scoreMultiplierEnd;
        break;
      }
      default:
        break;
    }
  }

  private record(type: string, state: RunTelemetryState, payload: Record<string, unknown> = {}): void {
    this.events.push({
      type,
      t: roundS(state.time),
      wave: state.wave,
      cash: Math.floor(state.credits),
      lives: state.lives,
      ...payload,
    });
  }

  private privateEvent(type: string, state: RunTelemetryState, payload: Record<string, unknown>): void {
    // Private-only friction events are summarized into analytics counters; keeping
    // a compact breadcrumb here makes local debugging possible without publishing it.
    void type;
    void state;
    void payload;
  }

  private snapshot(label: string, state: RunTelemetryState): void {
    this.snapshots.push({
      label,
      t: roundS(state.time),
      wave: state.wave,
      cash: Math.floor(state.credits),
      lives: state.lives,
      kills: state.totalKills,
      leaks: state.runStats.leaks,
      towerCount: state.towers.length,
      enemyCount: state.enemyCount,
      damageByTower: intRecord(state.runStats.dmg),
      killsByEnemy: intRecord(state.runStats.kills),
      towers: this.snapshotTowers(state),
    });
    if (this.snapshots.length > 120) this.snapshots.splice(0, this.snapshots.length - 120);
  }

  private ensureTower(tower: Tower, state: RunTelemetryState): TowerLedger {
    const existing = this.ledger.get(tower.uid);
    if (existing) return existing;
    const fallback: TowerLedger = {
      towerUid: tower.uid,
      towerId: tower.def.id,
      name: tower.def.name,
      x: roundPos(tower.pos.x),
      y: roundPos(tower.pos.y),
      placedAtS: roundS(state.time),
      placedAtWave: state.wave,
      tierA: tower.tierA,
      tierB: tower.tierB,
      committed: tower.committed,
      targetMode: tower.target,
      invested: Math.round(tower.invested),
      kills: tower.kills,
      damage: Math.round(state.runStats.dmgByTowerUid[tower.uid] ?? 0),
      upgrades: [],
    };
    this.ledger.set(tower.uid, fallback);
    return fallback;
  }

  private finalTowers(state: RunTelemetryState): RunTowerSnapshot[] {
    for (const tower of state.towers) {
      const entry = this.ensureTower(tower, state);
      entry.tierA = tower.tierA;
      entry.tierB = tower.tierB;
      entry.committed = tower.committed;
      entry.targetMode = tower.target;
      entry.invested = Math.round(tower.invested);
      entry.kills = tower.kills;
      entry.damage = Math.round(state.runStats.dmgByTowerUid[tower.uid] ?? entry.damage ?? 0);
    }
    return [...this.ledger.values()]
      .sort((a, b) => a.placedAtS - b.placedAtS || a.towerUid - b.towerUid)
      .map(({ placedAtWave, ...tower }) => ({ ...tower, damage: Math.round(tower.damage) }));
  }

  /** Lean per-snapshot tower roster — only the fields the replay flipbook needs. The full
   *  roster (with upgrades) is stored once in final.towers; duplicating it across ~120
   *  snapshots blew the run doc past Firestore's 1MB limit. */
  private snapshotTowers(state: RunTelemetryState): RunTowerLean[] {
    return this.finalTowers(state).map((t) => {
      const tower: RunTowerLean = {
        towerUid: t.towerUid, towerId: t.towerId, x: t.x, y: t.y,
        placedAtS: t.placedAtS, tierA: t.tierA, tierB: t.tierB, damage: t.damage,
      };
      if (t.soldAtS !== undefined) tower.soldAtS = t.soldAtS;
      return tower;
    });
  }

  private withSyntheticEnd(state: RunTelemetryState): RunEvent[] {
    if (this.events.some((e) => e.type === 'run_end')) return [...this.events];
    return [
      ...this.events,
      {
        type: 'run_end',
        t: roundS(state.time),
        wave: state.wave,
        cash: Math.floor(state.credits),
        lives: state.lives,
        outcome: this.inferOutcome(state),
        synthetic: true,
      },
    ];
  }

  private summary(state: RunTelemetryState, callsign: string): PublicRunDoc['summary'] {
    const outcome = this.outcome ?? this.inferOutcome(state);
    // Clamp every numeric to the Firestore-rules ceiling. The rules reject the whole replay
    // doc (and thus block score submission) if any value overruns its bound — a marathon
    // freeplay run can realistically exceed these — so a display stat must never cost a score.
    const clampInt = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n) || 0));
    const summary: PublicRunDoc['summary'] = {
      callsign: sanitizeCallsign(callsign),
      map: this.start.map.id,
      mapName: this.start.map.name,
      diff: this.start.diff.id,
      diffName: this.start.diff.name,
      freeplay: state.freeplay,
      outcome,
      phase: state.phase,
      wave: clampInt(state.wave, 10000),
      kills: clampInt(state.totalKills, 9999999),
      credits: clampInt(state.credits, 99999999),
      cashEarned: clampInt(state.runStats.cashEarned, 99999999),
      leaks: clampInt(state.runStats.leaks, 999999),
      coresLeft: clampInt(state.lives, 999999),
      durationS: clampInt(state.time, 99999),
    };
    if (this.freeplay.dailyId && /^daily-\d{4}-\d{2}-\d{2}$/.test(this.freeplay.dailyId)) summary.daily = this.freeplay.dailyId;
    if (this.freeplay.contractId) summary.contractId = this.freeplay.contractId.slice(0, 30);
    if (Number.isFinite(this.freeplay.scoreMultiplierEnd)) {
      summary.scoreMultiplierEnd = Math.max(0, Math.min(1000000000, Math.round(this.freeplay.scoreMultiplierEnd * 100) / 100));
    }
    return summary;
  }

  private inferOutcome(state: RunTelemetryState): RunOutcome {
    if (state.phase === 'gameover') return 'gameover';
    if (state.phase === 'armistice') return 'armistice';
    if (state.phase === 'victory') return 'victory';
    return 'abandoned';
  }
}

function makeRunId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 18)
    : Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 8);
  return `r_${Date.now().toString(36)}_${random}`;
}

function roundS(n: number): number {
  return Math.max(0, Math.round(n * 10) / 10);
}

function roundPos(n: number): number {
  return Math.round(n * 10) / 10;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function intRecord(input: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) out[k] = Math.max(0, Math.round(v));
  return out;
}

function topKey(input: Record<string, number>): string | null {
  let best: string | null = null;
  let bestValue = -Infinity;
  for (const [key, value] of Object.entries(input)) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

function cellKey(pos: Vec): string {
  const cx = Math.max(0, Math.min(15, Math.floor(pos.x / 80)));
  const cy = Math.max(0, Math.min(8, Math.floor(pos.y / 80)));
  return `${cx},${cy}`;
}

function sanitizeEventType(type: string): string {
  return type.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 12)) {
    const cleanKey = sanitizeEventType(key);
    if (!cleanKey) continue;
    if (typeof value === 'string') out[cleanKey] = value.slice(0, 80);
    else if (typeof value === 'number' && Number.isFinite(value)) out[cleanKey] = Math.round(value * 100) / 100;
    else if (typeof value === 'boolean' || value === null) out[cleanKey] = value;
    else if (Array.isArray(value)) {
      out[cleanKey] = value.slice(0, 12).map((entry) => {
        if (typeof entry === 'number' && Number.isFinite(entry)) return Math.round(entry * 100) / 100;
        if (typeof entry === 'boolean') return entry;
        return String(entry).slice(0, 60);
      });
    }
  }
  return out;
}

function getString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value ? value.slice(0, 80) : null;
}

function getNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 12) : [];
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

function sanitizeCallsign(name: string): string {
  return (name.trim() || 'WARDEN').slice(0, 20);
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) out[key] = stripUndefined(entry);
    }
    return out as T;
  }
  return value;
}
