import type { PrivateRunAnalyticsDoc, PublicRunDoc } from './runTelemetry';

type PlainRecord = Record<string, unknown>;

export const analyticsMenuDefaults: PrivateRunAnalyticsDoc['menu'] = {
  pageAgeAtDeployS: 0,
  deployAttempts: 0,
  deployBlocked: 0,
  firstDeployAtS: 0,
  tabSwitches: 0,
  deployTabOpens: 0,
  leaderboardTabOpens: 0,
  selectedMap: null,
  selectedDiff: null,
  mapSelections: {},
  protocolSelections: {},
  lockedMapClicks: {},
  lockedProtocolClicks: {},
};

export const analyticsControlsDefaults: PrivateRunAnalyticsDoc['controls'] = {
  keyboardInputs: 0,
  pointerInputs: 0,
  touchInputs: 0,
  soundToggles: 0,
  musicToggles: 0,
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

export const analyticsCombatDefaults: PrivateRunAnalyticsDoc['combat'] = {
  firstLeakWave: 0,
  biggestLeakWave: 0,
  biggestLeakCores: 0,
  leaksByEnemy: {},
  cloakedLeakCores: 0,
  revealedLeakCores: 0,
  armoredLeakCores: 0,
  bossLeakCores: 0,
  peakEnemies: 0,
  waveStarts: 0,
  waveEnds: 0,
  avgWaveDurationS: 0,
  longestWaveDurationS: 0,
  enemiesAtEnd: 0,
  abilityCasts: {},
  pickupCollects: {},
};

export const analyticsPlacementDefaults: PrivateRunAnalyticsDoc['placement'] = {
  firstTowerId: null,
  buildOrder: [],
  upgradeOrder: [],
  placedByTower: {},
  soldByTower: {},
  failedByReason: {},
  failedByTower: {},
  failedUpgradeByReason: {},
  placementCells: {},
  failedPlacementCells: {},
  sellCells: {},
  beaconZonePlacements: 0,
  darkZonePlacements: 0,
  blueprintSaves: 0,
  blueprintApplies: 0,
  blueprintApplyPlaced: 0,
  targetModeChanges: 0,
  quickSellbacks: 0,
};

export const analyticsAssistanceDefaults: PrivateRunAnalyticsDoc['assistance'] = {
  aiMenuOpens: 0,
  aiGameOpens: 0,
  aiQuestions: 0,
  aiSuccesses: 0,
  aiErrors: 0,
  aiQuotaErrors: 0,
  feedbackMenuOpens: 0,
  feedbackGameOpens: 0,
  feedbackSubmits: 0,
  feedbackSuccesses: 0,
  feedbackErrors: 0,
  feedbackRepliesViewed: 0,
  widgetPauseS: 0,
};

export const analyticsFreeplayDefaults: PrivateRunAnalyticsDoc['freeplay'] = {
  entered: false,
  contractId: null,
  dailyId: null,
  scoreMultiplierEnd: 1,
  contractSelections: {},
  relicOffers: 0,
  relicSelections: {},
  riskOffers: {},
  riskAccepted: {},
  riskDeclined: {},
  riskCleared: {},
  checkpointSubmits: 0,
  mutatorWaves: {},
  rivalSpawns: {},
  rivalDefeats: {},
};

export const analyticsTowerInterestDefaults: PrivateRunAnalyticsDoc['towerInterest'] = {
  shopOpens: 0,
  shopSelections: {},
  lockedTowerClicks: {},
  unaffordableTowerClicks: {},
  failedPlacements: 0,
  upgradePanelOpens: 0,
  upgradePanelByTower: {},
  failedUpgrades: 0,
  quickSellbacks: 0,
  targetModeChanges: 0,
  abilityUses: {},
  pickupCollects: {},
};

export const analyticsProgressionDefaults: PrivateRunAnalyticsDoc['progression'] = {
  lifetimeKillsAtStart: 0,
  runsBeforeStart: 0,
  victoriesBeforeStart: 0,
  firstSeenAt: 0,
  lastSeenAt: 0,
  sessions: 0,
  sessionsToday: 0,
  daysSinceFirstSeen: 0,
  daysSinceLastSeen: 0,
  unlocksEarned: [],
  unlocksViewed: [],
  unlockedTowerIdsUsed: [],
};

export const analyticsAttentionDefaults: PrivateRunAnalyticsDoc['attention'] = {
  activeS: 0,
  hiddenS: 0,
  idleS: 0,
  pausedS: 0,
  focusLosses: 0,
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

export const analyticsPerformanceDefaults: PrivateRunAnalyticsDoc['performance'] = {
  viewportW: 0,
  viewportH: 0,
  devicePixelRatio: 1,
  fpsMin: 0,
  fpsAvg: 0,
  fpsSamples: 0,
  longFrames: 0,
  qualityDowngrades: 0,
  qualityRecoveries: 0,
  displayStandalone: false,
  installPromptSeen: 0,
  installed: 0,
  userAgent: '',
};

// Keep these defaults in lockstep with runTelemetry.ts types and the
// firestore.rules runAnalytics block.
export const analyticsDefaults = {
  menu: analyticsMenuDefaults,
  controls: analyticsControlsDefaults,
  combat: analyticsCombatDefaults,
  placement: analyticsPlacementDefaults,
  assistance: analyticsAssistanceDefaults,
  freeplay: analyticsFreeplayDefaults,
  towerInterest: analyticsTowerInterestDefaults,
  progression: analyticsProgressionDefaults,
  attention: analyticsAttentionDefaults,
  performance: analyticsPerformanceDefaults,
};

const summaryDefaults: PublicRunDoc['summary'] = {
  callsign: '',
  map: '',
  mapName: '',
  diff: '',
  diffName: '',
  freeplay: false,
  outcome: 'abandoned',
  phase: '',
  wave: 0,
  kills: 0,
  credits: 0,
  cashEarned: 0,
  leaks: 0,
  coresLeft: 0,
  durationS: 0,
};

export function withDefaults<T>(defaults: T, raw: unknown): T {
  if (typeof defaults === 'number') {
    const value = typeof raw === 'number' ? raw : Number(raw);
    return (Number.isFinite(value) ? value : defaults) as T;
  }
  if (typeof defaults === 'boolean') {
    return (typeof raw === 'boolean' ? raw : defaults) as T;
  }
  if (typeof defaults === 'string') {
    return (typeof raw === 'string' ? raw : defaults) as T;
  }
  if (defaults === null) {
    return (raw === null || typeof raw === 'string' ? raw : defaults) as T;
  }
  if (Array.isArray(defaults)) {
    return (Array.isArray(raw) ? [...raw] : [...defaults]) as T;
  }
  if (isPlainObject(defaults)) {
    if (Object.keys(defaults).length === 0) {
      return (isPlainObject(raw) ? { ...raw } : {}) as T;
    }
    const src = isPlainObject(raw) ? raw : {};
    const out: PlainRecord = {};
    for (const [key, value] of Object.entries(defaults)) {
      out[key] = withDefaults(value, src[key]);
    }
    return out as T;
  }
  return defaults;
}

export interface NormalizedRunAnalytics extends PrivateRunAnalyticsDoc {
  id: string;
}

export function normalizeRunAnalyticsDoc(id: string, data: unknown): NormalizedRunAnalytics {
  const raw = isPlainObject(data) ? data : {};
  const summaryRaw = isPlainObject(raw.summary) ? raw.summary : {};
  const summary: PublicRunDoc['summary'] = {
    ...summaryDefaults,
    ...summaryRaw,
  };
  return {
    id,
    schemaVersion: readNumber(raw.schemaVersion, 2),
    runId: readString(raw.runId, id),
    uid: readString(raw.uid, ''),
    createdAt: readNumber(raw.createdAt, 0),
    endedAt: readNumber(raw.endedAt, readNumber(raw.createdAt, 0)),
    build: readString(raw.build, ''),
    summary,
    onboarding: readRecord<PrivateRunAnalyticsDoc['onboarding']>(raw.onboarding),
    abandonment: readRecord<PrivateRunAnalyticsDoc['abandonment']>(raw.abandonment),
    difficulty: readRecord<PrivateRunAnalyticsDoc['difficulty']>(raw.difficulty),
    economy: readRecord<PrivateRunAnalyticsDoc['economy']>(raw.economy),
    menu: withDefaults(analyticsDefaults.menu, raw.menu),
    controls: withDefaults(analyticsDefaults.controls, raw.controls),
    combat: withDefaults(analyticsDefaults.combat, raw.combat),
    placement: withDefaults(analyticsDefaults.placement, raw.placement),
    assistance: withDefaults(analyticsDefaults.assistance, raw.assistance),
    freeplay: withDefaults({ ...analyticsDefaults.freeplay, entered: summary.freeplay }, raw.freeplay),
    towerInterest: withDefaults(analyticsDefaults.towerInterest, raw.towerInterest),
    progression: withDefaults(analyticsDefaults.progression, raw.progression),
    leaderboard: readRecord<PrivateRunAnalyticsDoc['leaderboard']>(raw.leaderboard),
    attention: withDefaults(analyticsDefaults.attention, raw.attention),
    performance: withDefaults(analyticsDefaults.performance, raw.performance),
  };
}

function isPlainObject(value: unknown): value is PlainRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readRecord<T extends Record<string, unknown>>(value: unknown): T {
  return isPlainObject(value) ? value as T : {} as T;
}
