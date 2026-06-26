import type { RunAnalyticsRow } from './game/leaderboard';

export type MetricDomain =
  | 'run'
  | 'menu'
  | 'controls'
  | 'combat'
  | 'placement'
  | 'assistance'
  | 'freeplay'
  | 'towers'
  | 'progression'
  | 'leaderboard'
  | 'attention'
  | 'performance';

export type MetricKind = 'number' | 'boolean' | 'string' | 'record' | 'array';
export type MetricAggregation = 'avg' | 'sum' | 'rate' | 'top-record' | 'distribution' | 'latest';

export interface MetricDefinition {
  id: string;
  label: string;
  domain: MetricDomain;
  path: string[];
  kind: MetricKind;
  aggregation: MetricAggregation;
  description: string;
  unit?: string;
}

export interface AnalyticsFilters {
  range: 'all' | '24h' | '7d' | '30d';
  build: string;
  map: string;
  diff: string;
  mode: 'all' | 'campaign' | 'freeplay';
  outcome: string;
  waveBucket: string;
  uid: string;
  schema: string;
  cohort: 'all' | 'first' | 'returning';
}

export interface MetricAggregate {
  count: number;
  populated: number;
  sum: number;
  avg: number;
  median: number;
  p95: number;
  min: number;
  max: number;
  trueCount: number;
  topValues: Array<{ label: string; value: number }>;
}

export interface DerivedInsight {
  severity: 'info' | 'watch' | 'alert';
  domain: MetricDomain;
  signal: string;
  meaning: string;
  followup: string;
  value: string;
}

export interface AnalyticsDataset {
  rows: RunAnalyticsRow[];
  filters: AnalyticsFilters;
  filtered: RunAnalyticsRow[];
  metrics: MetricDefinition[];
  insights: DerivedInsight[];
}

const DAY = 86_400_000;
const RANGE_MS: Record<AnalyticsFilters['range'], number> = {
  '24h': DAY,
  '7d': DAY * 7,
  '30d': DAY * 30,
  all: Infinity,
};

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilters = {
  range: 'all',
  build: 'all',
  map: 'all',
  diff: 'all',
  mode: 'all',
  outcome: 'all',
  waveBucket: 'all',
  uid: '',
  schema: 'all',
  cohort: 'all',
};

export const METRIC_DOMAINS: Array<{ id: 'all' | MetricDomain; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'run', label: 'Run' },
  { id: 'menu', label: 'Menu' },
  { id: 'controls', label: 'Controls' },
  { id: 'combat', label: 'Combat' },
  { id: 'placement', label: 'Placement' },
  { id: 'assistance', label: 'Assistance' },
  { id: 'freeplay', label: 'Freeplay' },
  { id: 'towers', label: 'Towers' },
  { id: 'progression', label: 'Progression' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'attention', label: 'Attention' },
  { id: 'performance', label: 'Performance' },
];

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  m('run.wave', 'Wave reached', 'run', ['summary', 'wave'], 'number', 'distribution', 'Ending wave for the run.'),
  m('run.kills', 'Kills', 'run', ['summary', 'kills'], 'number', 'avg', 'Total hulls destroyed in the run.'),
  m('run.cashEarned', 'Cash earned', 'run', ['summary', 'cashEarned'], 'number', 'avg', 'Total run income.'),
  m('run.credits', 'Ending credits', 'run', ['summary', 'credits'], 'number', 'avg', 'Credits left at the end.'),
  m('run.leaks', 'Leaks', 'run', ['summary', 'leaks'], 'number', 'avg', 'Cores lost across the run.'),
  m('run.coresLeft', 'Cores left', 'run', ['summary', 'coresLeft'], 'number', 'avg', 'Remaining lives at end.'),
  m('run.durationS', 'Duration', 'run', ['summary', 'durationS'], 'number', 'avg', 'Run duration in seconds.', 's'),
  m('run.outcome', 'Outcome', 'run', ['summary', 'outcome'], 'string', 'distribution', 'Victory, armistice, gameover, or abandon.'),
  m('run.freeplay', 'Freeplay run', 'run', ['summary', 'freeplay'], 'boolean', 'rate', 'Whether the run was endless/freeplay.'),
  m('menu.pageAgeAtDeployS', 'Page age at deploy', 'menu', ['menu', 'pageAgeAtDeployS'], 'number', 'avg', 'Seconds from page load to deploy.', 's'),
  m('menu.deployAttempts', 'Deploy attempts', 'menu', ['menu', 'deployAttempts'], 'number', 'sum', 'Deploy button attempts.'),
  m('menu.deployBlocked', 'Blocked deploys', 'menu', ['menu', 'deployBlocked'], 'number', 'sum', 'Deploy attempts blocked by locks.'),
  m('menu.tabSwitches', 'Menu tab switches', 'menu', ['menu', 'tabSwitches'], 'number', 'sum', 'Deploy/leaderboard tab switching.'),
  m('menu.leaderboardTabOpens', 'Leaderboard tab opens', 'menu', ['menu', 'leaderboardTabOpens'], 'number', 'sum', 'Leaderboard opens before a run.'),
  m('menu.mapSelections', 'Map selections', 'menu', ['menu', 'mapSelections'], 'record', 'top-record', 'Selected sectors.'),
  m('menu.protocolSelections', 'Protocol selections', 'menu', ['menu', 'protocolSelections'], 'record', 'top-record', 'Selected difficulty protocols.'),
  m('menu.lockedMapClicks', 'Locked map clicks', 'menu', ['menu', 'lockedMapClicks'], 'record', 'top-record', 'Locked sector curiosity.'),
  m('menu.lockedProtocolClicks', 'Locked protocol clicks', 'menu', ['menu', 'lockedProtocolClicks'], 'record', 'top-record', 'Locked protocol curiosity.'),
  m('controls.keyboardInputs', 'Keyboard inputs', 'controls', ['controls', 'keyboardInputs'], 'number', 'sum', 'Keyboard interaction count.'),
  m('controls.pointerInputs', 'Pointer inputs', 'controls', ['controls', 'pointerInputs'], 'number', 'sum', 'Mouse/pointer interaction count.'),
  m('controls.touchInputs', 'Touch inputs', 'controls', ['controls', 'touchInputs'], 'number', 'sum', 'Touch interaction count.'),
  m('controls.pauseToggles', 'Pause toggles', 'controls', ['controls', 'pauseToggles'], 'number', 'sum', 'Pause/resume toggles.'),
  m('controls.firstPauseAt', 'First pause time', 'controls', ['controls', 'firstPauseAt'], 'number', 'avg', 'Time to first pause.', 's'),
  m('controls.speedChanges', 'Speed changes', 'controls', ['controls', 'speedChanges'], 'number', 'sum', 'Speed button usage.'),
  m('controls.autoToggles', 'Auto toggles', 'controls', ['controls', 'autoToggles'], 'number', 'sum', 'Auto-start toggles.'),
  m('controls.sidePanelCollapses', 'Panel collapses', 'controls', ['controls', 'sidePanelCollapses'], 'number', 'sum', 'Arsenal collapsed.'),
  m('controls.abortArmed', 'Abort armed', 'controls', ['controls', 'abortArmed'], 'number', 'sum', 'Abort confirmation armed.'),
  m('controls.abortConfirmed', 'Abort confirmed', 'controls', ['controls', 'abortConfirmed'], 'number', 'sum', 'Abort confirmation completed.'),
  m('controls.placementCancels', 'Placement cancels', 'controls', ['controls', 'placementCancels'], 'number', 'sum', 'Placement intent canceled.'),
  m('controls.abilityAimCancels', 'Ability aim cancels', 'controls', ['controls', 'abilityAimCancels'], 'number', 'sum', 'Targeted ability aim canceled.'),
  m('controls.waveLaunchClicks', 'Wave launch clicks', 'controls', ['controls', 'waveLaunchClicks'], 'number', 'sum', 'Wave launched by button.'),
  m('controls.waveLaunchKeys', 'Wave launch keys', 'controls', ['controls', 'waveLaunchKeys'], 'number', 'sum', 'Wave launched by keyboard.'),
  m('combat.firstLeakWave', 'First leak wave', 'combat', ['combat', 'firstLeakWave'], 'number', 'avg', 'First wave where cores were lost.'),
  m('combat.biggestLeakWave', 'Biggest leak wave', 'combat', ['combat', 'biggestLeakWave'], 'number', 'avg', 'Wave with the largest single leak.'),
  m('combat.biggestLeakCores', 'Biggest leak cores', 'combat', ['combat', 'biggestLeakCores'], 'number', 'avg', 'Largest single leak amount.'),
  m('combat.leaksByEnemy', 'Leaks by enemy', 'combat', ['combat', 'leaksByEnemy'], 'record', 'top-record', 'Enemy ids responsible for core loss.'),
  m('combat.cloakedLeakCores', 'Cloaked leak cores', 'combat', ['combat', 'cloakedLeakCores'], 'number', 'sum', 'Cores lost to cloaked threats.'),
  m('combat.armoredLeakCores', 'Armored leak cores', 'combat', ['combat', 'armoredLeakCores'], 'number', 'sum', 'Cores lost to armored threats.'),
  m('combat.bossLeakCores', 'Boss leak cores', 'combat', ['combat', 'bossLeakCores'], 'number', 'sum', 'Cores lost to bosses/rivals.'),
  m('combat.peakEnemies', 'Peak enemies', 'combat', ['combat', 'peakEnemies'], 'number', 'avg', 'Highest live enemy count seen.'),
  m('combat.avgWaveDurationS', 'Avg wave duration', 'combat', ['combat', 'avgWaveDurationS'], 'number', 'avg', 'Average combat wave duration.', 's'),
  m('combat.longestWaveDurationS', 'Longest wave duration', 'combat', ['combat', 'longestWaveDurationS'], 'number', 'avg', 'Longest combat wave duration.', 's'),
  m('combat.abilityCasts', 'Ability casts', 'combat', ['combat', 'abilityCasts'], 'record', 'top-record', 'Ability usage by id.'),
  m('combat.pickupCollects', 'Pickup collects', 'combat', ['combat', 'pickupCollects'], 'record', 'top-record', 'Pickup collection by type.'),
  m('placement.firstTowerId', 'First tower', 'placement', ['placement', 'firstTowerId'], 'string', 'distribution', 'Opening tower choice.'),
  m('placement.buildOrder', 'Build order', 'placement', ['placement', 'buildOrder'], 'array', 'distribution', 'Tower ids in order built.'),
  m('placement.upgradeOrder', 'Upgrade order', 'placement', ['placement', 'upgradeOrder'], 'array', 'distribution', 'Upgrade choices in order bought.'),
  m('placement.placedByTower', 'Placed by tower', 'placement', ['placement', 'placedByTower'], 'record', 'top-record', 'Tower placement counts.'),
  m('placement.soldByTower', 'Sold by tower', 'placement', ['placement', 'soldByTower'], 'record', 'top-record', 'Tower sell counts.'),
  m('placement.failedByReason', 'Failed placement reasons', 'placement', ['placement', 'failedByReason'], 'record', 'top-record', 'Why placement failed.'),
  m('placement.failedByTower', 'Failed placement towers', 'placement', ['placement', 'failedByTower'], 'record', 'top-record', 'Tower ids attempted unsuccessfully.'),
  m('placement.failedUpgradeByReason', 'Failed upgrade reasons', 'placement', ['placement', 'failedUpgradeByReason'], 'record', 'top-record', 'Why upgrades failed.'),
  m('placement.placementCells', 'Placement cells', 'placement', ['placement', 'placementCells'], 'record', 'top-record', 'Binned build positions.'),
  m('placement.failedPlacementCells', 'Failed placement cells', 'placement', ['placement', 'failedPlacementCells'], 'record', 'top-record', 'Binned failed build positions.'),
  m('placement.sellCells', 'Sell cells', 'placement', ['placement', 'sellCells'], 'record', 'top-record', 'Binned sell positions.'),
  m('placement.blueprintSaves', 'Blueprint saves', 'placement', ['placement', 'blueprintSaves'], 'number', 'sum', 'Blueprint saves.'),
  m('placement.blueprintApplies', 'Blueprint applies', 'placement', ['placement', 'blueprintApplies'], 'number', 'sum', 'Blueprint apply attempts.'),
  m('placement.quickSellbacks', 'Quick sellbacks', 'placement', ['placement', 'quickSellbacks'], 'number', 'sum', 'Towers sold within the quick-sell window.'),
  m('placement.targetModeChanges', 'Target mode changes', 'placement', ['placement', 'targetModeChanges'], 'number', 'sum', 'Targeting mode changes.'),
  m('assistance.aiMenuOpens', 'AI menu opens', 'assistance', ['assistance', 'aiMenuOpens'], 'number', 'sum', 'AI widget opened from menu.'),
  m('assistance.aiGameOpens', 'AI game opens', 'assistance', ['assistance', 'aiGameOpens'], 'number', 'sum', 'AI widget opened during a run.'),
  m('assistance.aiQuestions', 'AI questions', 'assistance', ['assistance', 'aiQuestions'], 'number', 'sum', 'AI question submits.'),
  m('assistance.aiSuccesses', 'AI successes', 'assistance', ['assistance', 'aiSuccesses'], 'number', 'sum', 'AI help succeeded.'),
  m('assistance.aiErrors', 'AI errors', 'assistance', ['assistance', 'aiErrors'], 'number', 'sum', 'AI help failures.'),
  m('assistance.aiQuotaErrors', 'AI quota errors', 'assistance', ['assistance', 'aiQuotaErrors'], 'number', 'sum', 'AI quota/rate-limit failures.'),
  m('assistance.feedbackSubmits', 'Feedback submits', 'assistance', ['assistance', 'feedbackSubmits'], 'number', 'sum', 'Feedback submit attempts.'),
  m('assistance.feedbackRepliesViewed', 'Feedback replies viewed', 'assistance', ['assistance', 'feedbackRepliesViewed'], 'number', 'sum', 'Admin replies seen by players.'),
  m('assistance.widgetPauseS', 'Widget pause time', 'assistance', ['assistance', 'widgetPauseS'], 'number', 'avg', 'Run time paused with a utility widget open.', 's'),
  m('freeplay.entered', 'Entered freeplay', 'freeplay', ['freeplay', 'entered'], 'boolean', 'rate', 'Run entered endless mode.'),
  m('freeplay.contractSelections', 'Contract selections', 'freeplay', ['freeplay', 'contractSelections'], 'record', 'top-record', 'Selected freeplay contracts.'),
  m('freeplay.relicOffers', 'Relic offers', 'freeplay', ['freeplay', 'relicOffers'], 'number', 'sum', 'Relic offer screens shown.'),
  m('freeplay.relicSelections', 'Relic selections', 'freeplay', ['freeplay', 'relicSelections'], 'record', 'top-record', 'Selected relic ids.'),
  m('freeplay.riskOffers', 'Risk offers', 'freeplay', ['freeplay', 'riskOffers'], 'record', 'top-record', 'Risk offers shown.'),
  m('freeplay.riskAccepted', 'Risks accepted', 'freeplay', ['freeplay', 'riskAccepted'], 'record', 'top-record', 'Risk choices accepted.'),
  m('freeplay.riskDeclined', 'Risks declined', 'freeplay', ['freeplay', 'riskDeclined'], 'record', 'top-record', 'Risk choices declined.'),
  m('freeplay.riskCleared', 'Risks cleared', 'freeplay', ['freeplay', 'riskCleared'], 'record', 'top-record', 'Risk waves cleared.'),
  m('freeplay.checkpointSubmits', 'Checkpoint submissions', 'freeplay', ['freeplay', 'checkpointSubmits'], 'number', 'sum', 'Freeplay checkpoint banks.'),
  m('freeplay.mutatorWaves', 'Mutator waves', 'freeplay', ['freeplay', 'mutatorWaves'], 'record', 'top-record', 'Waves played with mutators.'),
  m('freeplay.rivalDefeats', 'Rival defeats', 'freeplay', ['freeplay', 'rivalDefeats'], 'record', 'top-record', 'Named rivals defeated.'),
  m('freeplay.scoreMultiplierEnd', 'Ending multiplier', 'freeplay', ['freeplay', 'scoreMultiplierEnd'], 'number', 'avg', 'Freeplay score multiplier at end.'),
  m('towers.shopSelections', 'Shop selections', 'towers', ['towerInterest', 'shopSelections'], 'record', 'top-record', 'Tower shop interest.'),
  m('towers.lockedTowerClicks', 'Locked tower clicks', 'towers', ['towerInterest', 'lockedTowerClicks'], 'record', 'top-record', 'Locked tower curiosity.'),
  m('towers.unaffordableTowerClicks', 'Unaffordable tower clicks', 'towers', ['towerInterest', 'unaffordableTowerClicks'], 'record', 'top-record', 'Tower clicks while short on credits.'),
  m('towers.upgradePanelByTower', 'Upgrade panels by tower', 'towers', ['towerInterest', 'upgradePanelByTower'], 'record', 'top-record', 'Upgrade panel interest.'),
  m('towers.failedPlacements', 'Failed placements', 'towers', ['towerInterest', 'failedPlacements'], 'number', 'sum', 'Total failed placement attempts.'),
  m('towers.failedUpgrades', 'Failed upgrades', 'towers', ['towerInterest', 'failedUpgrades'], 'number', 'sum', 'Total failed upgrade attempts.'),
  m('towers.abilityUses', 'Ability uses', 'towers', ['towerInterest', 'abilityUses'], 'record', 'top-record', 'Ability use counts.'),
  m('progression.runsBeforeStart', 'Runs before start', 'progression', ['progression', 'runsBeforeStart'], 'number', 'distribution', 'Player run count before this run.'),
  m('progression.victoriesBeforeStart', 'Victories before start', 'progression', ['progression', 'victoriesBeforeStart'], 'number', 'distribution', 'Player victories before this run.'),
  m('progression.sessions', 'Session count', 'progression', ['progression', 'sessions'], 'number', 'distribution', 'Anonymous device session count.'),
  m('progression.sessionsToday', 'Sessions today', 'progression', ['progression', 'sessionsToday'], 'number', 'distribution', 'Anonymous device sessions today.'),
  m('progression.unlocksEarned', 'Unlocks earned', 'progression', ['progression', 'unlocksEarned'], 'array', 'distribution', 'Tower unlocks earned during run.'),
  m('progression.unlocksViewed', 'Unlocks viewed', 'progression', ['progression', 'unlocksViewed'], 'array', 'distribution', 'Unlock modals seen.'),
  m('progression.unlockedTowerIdsUsed', 'Unlocked towers used', 'progression', ['progression', 'unlockedTowerIdsUsed'], 'array', 'distribution', 'Newly unlocked tower ids used.'),
  m('leaderboard.openCount', 'Leaderboard opens', 'leaderboard', ['leaderboard', 'openCount'], 'number', 'sum', 'Leaderboard opens after run.'),
  m('leaderboard.scoreSubmitAttempts', 'Score submit attempts', 'leaderboard', ['leaderboard', 'scoreSubmitAttempts'], 'number', 'sum', 'Score submit attempts.'),
  m('leaderboard.scoreSubmitFailures', 'Score submit failures', 'leaderboard', ['leaderboard', 'scoreSubmitFailures'], 'number', 'sum', 'Score submit failures.'),
  m('leaderboard.replaySubmitAttempts', 'Replay submit attempts', 'leaderboard', ['leaderboard', 'replaySubmitAttempts'], 'number', 'sum', 'Replay upload attempts.'),
  m('leaderboard.replaySubmitFailures', 'Replay submit failures', 'leaderboard', ['leaderboard', 'replaySubmitFailures'], 'number', 'sum', 'Replay upload failures.'),
  m('leaderboard.rowClicks', 'Leaderboard row clicks', 'leaderboard', ['leaderboard', 'rowClicks'], 'number', 'sum', 'Leaderboard row clicks.'),
  m('leaderboard.replayOpens', 'Replay opens', 'leaderboard', ['leaderboard', 'replayOpens'], 'number', 'sum', 'Replay detail opens.'),
  m('leaderboard.nextRunAfterLeaderboard', 'Next run after leaderboard', 'leaderboard', ['leaderboard', 'nextRunAfterLeaderboard'], 'boolean', 'rate', 'A next run started after leaderboard interaction.'),
  m('attention.activeS', 'Active time', 'attention', ['attention', 'activeS'], 'number', 'avg', 'Foreground active time.', 's'),
  m('attention.hiddenS', 'Hidden time', 'attention', ['attention', 'hiddenS'], 'number', 'avg', 'Background tab time.', 's'),
  m('attention.idleS', 'Idle time', 'attention', ['attention', 'idleS'], 'number', 'avg', 'No-input idle time.', 's'),
  m('attention.pausedS', 'Paused time', 'attention', ['attention', 'pausedS'], 'number', 'avg', 'Paused run time.', 's'),
  m('attention.focusLosses', 'Focus losses', 'attention', ['attention', 'focusLosses'], 'number', 'avg', 'Tab visibility losses.'),
  m('attention.shopPanelS', 'Shop panel time', 'attention', ['attention', 'shopPanelS'], 'number', 'avg', 'Time with shop panel visible.', 's'),
  m('attention.upgradePanelS', 'Upgrade panel time', 'attention', ['attention', 'upgradePanelS'], 'number', 'avg', 'Time with upgrade panel visible.', 's'),
  m('attention.widgetOpenS', 'Widget open time', 'attention', ['attention', 'widgetOpenS'], 'number', 'avg', 'Time with AI/feedback widget open.', 's'),
  m('attention.speed4S', '4x speed time', 'attention', ['attention', 'speed4S'], 'number', 'avg', 'Time played at 4x speed.', 's'),
  m('performance.viewportW', 'Viewport width', 'performance', ['performance', 'viewportW'], 'number', 'distribution', 'Viewport width.'),
  m('performance.viewportH', 'Viewport height', 'performance', ['performance', 'viewportH'], 'number', 'distribution', 'Viewport height.'),
  m('performance.fpsMin', 'Minimum FPS', 'performance', ['performance', 'fpsMin'], 'number', 'avg', 'Minimum sampled FPS.'),
  m('performance.fpsAvg', 'Average FPS', 'performance', ['performance', 'fpsAvg'], 'number', 'avg', 'Average sampled FPS.'),
  m('performance.longFrames', 'Long frames', 'performance', ['performance', 'longFrames'], 'number', 'avg', 'Frames at or above 100ms.'),
  m('performance.qualityDowngrades', 'Quality downgrades', 'performance', ['performance', 'qualityDowngrades'], 'number', 'sum', 'Adaptive render downgrades.'),
  m('performance.qualityRecoveries', 'Quality recoveries', 'performance', ['performance', 'qualityRecoveries'], 'number', 'sum', 'Adaptive render recoveries.'),
  m('performance.displayStandalone', 'Standalone display', 'performance', ['performance', 'displayStandalone'], 'boolean', 'rate', 'PWA standalone display mode.'),
  m('performance.installPromptSeen', 'Install prompts seen', 'performance', ['performance', 'installPromptSeen'], 'number', 'sum', 'Install prompt availability events.'),
  m('performance.installed', 'Installs', 'performance', ['performance', 'installed'], 'number', 'sum', 'PWA install events.'),
];

export function buildAnalyticsDataset(rows: RunAnalyticsRow[], filters: AnalyticsFilters = DEFAULT_ANALYTICS_FILTERS, now = Date.now()): AnalyticsDataset {
  const filtered = filterAnalyticsRows(rows, filters, now);
  return { rows, filters, filtered, metrics: METRIC_DEFINITIONS, insights: deriveInsights(filtered) };
}

export function filterAnalyticsRows(rows: RunAnalyticsRow[], filters: AnalyticsFilters, now = Date.now()): RunAnalyticsRow[] {
  const rangeMs = RANGE_MS[filters.range] ?? Infinity;
  const uidNeedle = filters.uid.trim().toLowerCase();
  return rows.filter((row) => {
    const ended = row.endedAt || row.createdAt || 0;
    if (filters.range !== 'all' && now - ended > rangeMs) return false;
    if (filters.build !== 'all' && row.build !== filters.build) return false;
    if (filters.map !== 'all' && row.summary.map !== filters.map) return false;
    if (filters.diff !== 'all' && row.summary.diff !== filters.diff) return false;
    if (filters.mode !== 'all' && (filters.mode === 'freeplay') !== row.summary.freeplay) return false;
    if (filters.outcome !== 'all' && row.summary.outcome !== filters.outcome) return false;
    if (filters.waveBucket !== 'all' && bucketWave(row.summary.wave) !== filters.waveBucket) return false;
    if (filters.schema !== 'all' && String(row.schemaVersion) !== filters.schema) return false;
    if (filters.cohort === 'first' && num(row.progression.runsBeforeStart) > 0) return false;
    if (filters.cohort === 'returning' && num(row.progression.runsBeforeStart) <= 0) return false;
    if (uidNeedle && !row.uid.toLowerCase().includes(uidNeedle) && !row.runId.toLowerCase().includes(uidNeedle)) return false;
    return true;
  });
}

export function metricById(id: string): MetricDefinition {
  return METRIC_DEFINITIONS.find((metric) => metric.id === id) ?? METRIC_DEFINITIONS[0];
}

export function metricsForDomain(domain: 'all' | MetricDomain): MetricDefinition[] {
  return domain === 'all' ? METRIC_DEFINITIONS : METRIC_DEFINITIONS.filter((metric) => metric.domain === domain);
}

export function readMetric(row: RunAnalyticsRow, metric: MetricDefinition): unknown {
  return readPath(row as unknown as Record<string, unknown>, metric.path);
}

export function aggregateMetric(rows: RunAnalyticsRow[], metric: MetricDefinition): MetricAggregate {
  const values = rows.map((row) => readMetric(row, metric));
  const numbers = values.map(numericMetricValue).filter((value) => Number.isFinite(value));
  const topValues = topMetricValues(values);
  return {
    count: rows.length,
    populated: values.filter((value) => hasValue(value)).length,
    sum: sum(numbers),
    avg: numbers.length ? sum(numbers) / numbers.length : 0,
    median: percentile(numbers, 0.5),
    p95: percentile(numbers, 0.95),
    min: numbers.length ? Math.min(...numbers) : 0,
    max: numbers.length ? Math.max(...numbers) : 0,
    trueCount: values.filter((value) => value === true).length,
    topValues,
  };
}

export function formatMetricValue(value: unknown, metric: MetricDefinition): string {
  if (metric.kind === 'boolean') return value ? 'yes' : 'no';
  if (metric.kind === 'number') return `${round1(num(value))}${metric.unit ?? ''}`;
  if (metric.kind === 'record') {
    const entries = Object.entries(recordOf(value)).sort((a, b) => num(b[1]) - num(a[1])).slice(0, 3);
    return entries.length ? entries.map(([key, n]) => `${key}:${n}`).join(', ') : '-';
  }
  if (Array.isArray(value)) return value.slice(0, 4).join(', ') || '-';
  return typeof value === 'string' && value ? value : '-';
}

export function topRecord(rows: RunAnalyticsRow[], metric: MetricDefinition, limit = 10): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const value = readMetric(row, metric);
    if (metric.kind === 'record') {
      for (const [key, n] of Object.entries(recordOf(value))) totals.set(key, (totals.get(key) ?? 0) + num(n));
    } else if (metric.kind === 'array' && Array.isArray(value)) {
      for (const key of value) totals.set(String(key), (totals.get(String(key)) ?? 0) + 1);
    } else if (metric.kind === 'string' && typeof value === 'string' && value) {
      totals.set(value, (totals.get(value) ?? 0) + 1);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, value]) => ({ label, value }));
}

export function bucketWave(wave: number): string {
  if (wave <= 0) return 'w0';
  const lo = Math.floor((wave - 1) / 5) * 5 + 1;
  return `w${lo}-${lo + 4}`;
}

export function availableWaveBuckets(rows: RunAnalyticsRow[]): string[] {
  return [...new Set(rows.map((row) => bucketWave(row.summary.wave)))].sort((a, b) => bucketStart(a) - bucketStart(b));
}

export function viewportBucket(row: RunAnalyticsRow): string {
  const w = row.performance.viewportW;
  if (w <= 0) return 'unknown';
  if (w < 560) return 'phone';
  if (w < 900) return 'tablet';
  if (w < 1280) return 'small desktop';
  return 'large desktop';
}

export function survivalBuckets(rows: RunAnalyticsRow[]): Array<{ label: string; runs: number; losses: number; wins: number }> {
  const map = new Map<string, { runs: number; losses: number; wins: number }>();
  for (const row of rows) {
    const label = bucketWave(row.summary.wave);
    const entry = map.get(label) ?? { runs: 0, losses: 0, wins: 0 };
    entry.runs++;
    if (row.summary.outcome === 'gameover' || row.summary.outcome === 'abandoned') entry.losses++;
    if (row.summary.outcome === 'victory' || row.summary.outcome === 'armistice') entry.wins++;
    map.set(label, entry);
  }
  return [...map.entries()].sort((a, b) => bucketStart(a[0]) - bucketStart(b[0])).map(([label, value]) => ({ label, ...value }));
}

export function metricCsv(rows: RunAnalyticsRow[], metrics: MetricDefinition[]): string {
  const cols = ['runId', 'uid', 'createdAt', 'map', 'diff', 'mode', 'outcome', 'wave', 'durationS', 'build', ...metrics.map((metric) => metric.id)];
  const line = (row: RunAnalyticsRow) => [
    row.runId,
    row.uid,
    row.createdAt,
    row.summary.map,
    row.summary.diff,
    row.summary.freeplay ? 'freeplay' : 'campaign',
    row.summary.outcome,
    row.summary.wave,
    row.summary.durationS,
    row.build,
    ...metrics.map((metric) => formatMetricValue(readMetric(row, metric), metric)),
  ];
  return [cols.join(','), ...rows.map((row) => line(row).map(csvEscape).join(','))].join('\n');
}

export function deriveInsights(rows: RunAnalyticsRow[]): DerivedInsight[] {
  const n = rows.length;
  if (n === 0) return [];
  const losses = rows.filter((row) => row.summary.outcome === 'gameover' || row.summary.outcome === 'abandoned');
  const earlyAbandons = rows.filter((row) => row.summary.outcome === 'abandoned' && row.summary.wave <= 3).length / Math.max(1, n);
  const richLosses = losses.filter((row) => num(row.economy.cashFloatedEnd) >= 1200).length / Math.max(1, losses.length);
  const failedPlacements = avg(rows, (row) => num(row.towerInterest.failedPlacements));
  const failedUpgrades = avg(rows, (row) => num(row.towerInterest.failedUpgrades));
  const aiQuestions = sum(rows.map((row) => row.assistance.aiQuestions));
  const aiErrors = sum(rows.map((row) => row.assistance.aiErrors));
  const fpsAvg = avg(rows.filter((row) => row.performance.fpsAvg > 0), (row) => row.performance.fpsAvg);
  const qualityDrops = avg(rows, (row) => row.performance.qualityDowngrades);
  const totalLeakTraits = sum(rows.map((row) => row.combat.cloakedLeakCores + row.combat.armoredLeakCores + row.combat.bossLeakCores));
  const totalLeaks = sum(rows.map((row) => row.summary.leaks));
  const sampleSmall = n < 10;
  const insights: DerivedInsight[] = [];

  pushInsight(insights, sampleSmall ? 'info' : earlyAbandons >= 0.2 ? 'alert' : 'info', 'run',
    'Early abandon pressure', 'Players leaving before wave 4 usually means the start flow or first threat is unclear.',
    'Review briefing, first-wave pacing, and map/protocol lock messaging.', percent(earlyAbandons), sampleSmall);
  pushInsight(insights, sampleSmall ? 'info' : richLosses >= 0.15 ? 'alert' : 'watch', 'towers',
    'Lost while rich', 'Losses with large cash float suggest players did not recognize a useful purchase or upgrade.',
    'Inspect failed buys, idle-with-cash, and tower recommendation timing.', percent(richLosses), sampleSmall);
  pushInsight(insights, sampleSmall ? 'info' : failedPlacements >= 0.75 ? 'alert' : 'info', 'placement',
    'Placement friction', 'Repeated failed placement often points to unclear valid cells or affordability feedback.',
    'Open Explorer on failed placement cells and reasons.', failedPlacements.toFixed(2), sampleSmall);
  pushInsight(insights, sampleSmall ? 'info' : failedUpgrades >= 0.5 ? 'watch' : 'info', 'towers',
    'Upgrade friction', 'Upgrade attempts are being blocked often enough to merit UI or economy review.',
    'Compare failed upgrade reasons against cash float and upgrade panel dwell.', failedUpgrades.toFixed(2), sampleSmall);
  pushInsight(insights, sampleSmall ? 'info' : aiQuestions > 0 && aiErrors / aiQuestions >= 0.2 ? 'alert' : 'info', 'assistance',
    'AI help reliability', 'High AI error or quota rate can make the help widget feel broken.',
    'Check endpoint health, quota, and fallback messaging.', aiQuestions ? percent(aiErrors / aiQuestions) : 'no usage', sampleSmall);
  pushInsight(insights, sampleSmall ? 'info' : fpsAvg > 0 && fpsAvg < 45 || qualityDrops >= 1 ? 'watch' : 'info', 'performance',
    'Performance risk', 'Low FPS or frequent quality drops correlate with control mistakes and abandonment.',
    'Slice by viewport bucket and inspect long-frame counts.', fpsAvg ? `${Math.round(fpsAvg)} fps / ${qualityDrops.toFixed(1)} drops` : 'no fps', sampleSmall);
  pushInsight(insights, sampleSmall ? 'info' : totalLeaks > 0 && totalLeakTraits / totalLeaks >= 0.25 ? 'watch' : 'info', 'combat',
    'Special threat leaks', 'Cloak, armor, and boss leaks are a sign that counterplay may be under-taught.',
    'Compare leak trait mix with first leak wave and tower detection/shred usage.', totalLeaks ? percent(totalLeakTraits / totalLeaks) : 'no leaks', sampleSmall);
  return insights;
}

function m(
  id: string,
  label: string,
  domain: MetricDomain,
  path: string[],
  kind: MetricKind,
  aggregation: MetricAggregation,
  description: string,
  unit?: string,
): MetricDefinition {
  return { id, label, domain, path, kind, aggregation, description, unit };
}

function readPath(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const part of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function numericMetricValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return sum(Object.values(value as Record<string, unknown>).map(num));
  return 0;
}

function topMetricValues(values: unknown[]): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, n] of Object.entries(value as Record<string, unknown>)) totals.set(key, (totals.get(key) ?? 0) + num(n));
    } else if (Array.isArray(value)) {
      for (const item of value) totals.set(String(item), (totals.get(String(item)) ?? 0) + 1);
    } else if (typeof value === 'string' && value) {
      totals.set(value, (totals.get(value) ?? 0) + 1);
    } else if (typeof value === 'boolean') {
      totals.set(value ? 'yes' : 'no', (totals.get(value ? 'yes' : 'no') ?? 0) + 1);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function recordOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(value)) out[key] = num(n);
  return out;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function bucketStart(label: string): number {
  const match = /^w(\d+)/.exec(label);
  return match ? Number(match[1]) : 0;
}

function pushInsight(
  list: DerivedInsight[],
  severity: DerivedInsight['severity'],
  domain: MetricDomain,
  signal: string,
  meaning: string,
  followup: string,
  value: string,
  sampleSmall: boolean,
): void {
  list.push({
    severity,
    domain,
    signal,
    meaning: sampleSmall ? `Small sample: ${meaning}` : meaning,
    followup,
    value,
  });
}

function avg<T>(rows: T[], read: (row: T) => number): number {
  return rows.length ? sum(rows.map(read)) / rows.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '').replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}
