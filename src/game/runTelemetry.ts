import type {
  AbilityId,
  DifficultyDef,
  GameMap,
  PickupKind,
  TargetMode,
  Tower,
  TowerDef,
  Vec,
} from './types';

export const RUN_TELEMETRY_SCHEMA = 1;
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
  name: string;
  x: number;
  y: number;
  placedAtS: number;
  soldAtS?: number;
  tierA: number;
  tierB: number;
  committed: 0 | 1 | null;
  targetMode: TargetMode;
  invested: number;
  kills: number;
  damage: number;
  upgrades: { t: number; track: 0 | 1; tier: number; name: string; cost: number }[];
}

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
    userAgent: string;
  };
}

export interface RunUploadBundle {
  run: PublicRunDoc;
  chunks: RunEventChunkDoc[];
}

interface TowerLedger extends RunTowerSnapshot {
  placedAtWave: number;
}

interface AttentionSample {
  hidden: boolean;
  paused: boolean;
  speed: number;
  panel: RunPanelKind;
  overlay: boolean;
  widgetOpen: boolean;
  fps?: number;
  viewportW?: number;
  viewportH?: number;
  devicePixelRatio?: number;
  userAgent?: string;
}

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
  private perf = { viewportW: 0, viewportH: 0, devicePixelRatio: 1, userAgent: '' };

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

  constructor(start: RunRecorderStart) {
    this.start = start;
    this.funnel.firstMapSelected = start.map.id;
    this.funnel.firstDifficultySelected = start.diff.id;
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

  recordWaveStart(state: RunTelemetryState, groups: { type: string; count: number; cloaked: boolean }[]): void {
    this.record('wave_start', state, { groups, towerCount: state.towers.length });
    this.snapshot('wave_start', state);
  }

  recordWaveEnd(state: RunTelemetryState, waveBonusCredits: number): void {
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
    this.record(`blueprint_${action}`, state, { count });
  }

  recordLeak(state: RunTelemetryState, enemyId: string, coresLost: number): void {
    this.leaksByEnemy[enemyId] = (this.leaksByEnemy[enemyId] ?? 0) + coresLost;
    this.record('leak', state, { enemyId, coresLost, coresLeft: state.lives });
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

  noteInput(): void {
    this.lastInputAtMs = nowMs();
  }

  noteVisibility(hidden: boolean): void {
    if (hidden && !this.hidden) this.focusLosses++;
    this.hidden = hidden;
  }

  observeAttention(dt: number, sample: AttentionSample): void {
    if (dt <= 0 || dt > 2) return;
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

  makePublicRun(state: RunTelemetryState, callsign: string, build: string): RunUploadBundle {
    const allEvents = this.withSyntheticEnd(state);
    const runEvents = allEvents.slice(0, RUN_EVENT_CHUNK_SIZE);
    const chunks: RunEventChunkDoc[] = [];
    for (let i = RUN_EVENT_CHUNK_SIZE; i < allEvents.length; i += RUN_EVENT_CHUNK_SIZE) {
      chunks.push({
        schemaVersion: RUN_TELEMETRY_SCHEMA,
        runId: this.runId,
        chunk: chunks.length,
        events: allEvents.slice(i, i + RUN_EVENT_CHUNK_SIZE),
      });
    }
    const run: PublicRunDoc = {
      schemaVersion: RUN_TELEMETRY_SCHEMA,
      runId: this.runId,
      createdAt: this.createdAt,
      endedAt: this.endedAt || Date.now(),
      build,
      chunkCount: chunks.length,
      eventCount: allEvents.length,
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
        balanceVersion: build,
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
    };
    return { run, chunks };
  }

  makePrivateAnalytics(state: RunTelemetryState, uid: string, callsign: string, build: string): PrivateRunAnalyticsDoc {
    const summary = this.summary(state, callsign);
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
        userAgent: this.perf.userAgent,
      },
    };
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
      towers: this.finalTowers(state),
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
    return {
      callsign: sanitizeCallsign(callsign),
      map: this.start.map.id,
      mapName: this.start.map.name,
      diff: this.start.diff.id,
      diffName: this.start.diff.name,
      freeplay: state.freeplay,
      outcome,
      phase: state.phase,
      wave: state.wave,
      kills: Math.round(state.totalKills),
      credits: Math.max(0, Math.floor(state.credits)),
      cashEarned: Math.max(0, Math.round(state.runStats.cashEarned)),
      leaks: Math.max(0, Math.round(state.runStats.leaks)),
      coresLeft: Math.max(0, Math.round(state.lives)),
      durationS: Math.max(0, Math.round(state.time)),
    };
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
