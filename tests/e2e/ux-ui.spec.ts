import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ANALYTICS_FILTERS,
  METRIC_DEFINITIONS,
  aggregateMetric,
  buildAnalyticsDataset,
  filterAnalyticsRows,
  metricById,
  metricCsv,
  topRecord,
} from '../../src/adminAnalytics';
import type { RunAnalyticsRow } from '../../src/game/leaderboard';

const progressSeed = {
  archive: [],
  best: {},
  armistice: false,
  totalWaves: 0,
  runs: 1,
  victories: 0,
  kills: 0,
  blueprints: {},
  history: [],
  playerName: '',
  clearedMaps: [],
  tut: true,
  cloakTip: true,
};

async function seedProgress(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(([base, patch]) => {
    window.localStorage.setItem('nvd-progress-v1', JSON.stringify({ ...base, ...patch }));
    // Seed adult consent so the age gate never blocks tests and consent-gated writes
    // behave like a normal adult player. (?demo=1 also bypasses the gate.)
    window.localStorage.setItem('nvd-consent-v1', JSON.stringify({ ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 }));
  }, [progressSeed, overrides]);
}

async function openDemoMenu(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.getByTestId('deploy-button')).toBeVisible();
}

async function deployFromMenu(page: Page) {
  await page.getByTestId('deploy-button').click();
  await expect(page.getByTestId('game-root')).toBeVisible();
}

async function widgetMetrics(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const styles = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        display: styles.display,
        placeItems: styles.placeItems,
      };
    };
    const ai = document.querySelector('.ai-toggle')?.getBoundingClientRect();
    const fb = document.querySelector('.fb-toggle')?.getBoundingClientRect();
    const sidebar = document.querySelector('[data-testid="game-sidebar"]')?.getBoundingClientRect();
    return {
      bodyClasses: document.body.className,
      aiWidget: document.querySelector('[data-testid="ai-widget"]')?.className ?? '',
      messageWidget: document.querySelector('[data-testid="message-widget"]')?.className ?? '',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ai: rect('.ai-toggle'),
      message: rect('.fb-toggle'),
      sidebar: rect('[data-testid="game-sidebar"]'),
      rightEdgesAligned: ai && fb ? Math.abs(ai.right - fb.right) <= 2 : false,
      clearOfSidebar: ai && fb && sidebar ? ai.right <= sidebar.left - 8 && fb.right <= sidebar.left - 8 : true,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

type AnalyticsRowPatch = Partial<Omit<RunAnalyticsRow, 'summary'>> & { summary?: Partial<RunAnalyticsRow['summary']> };

function analyticsRow(patch: AnalyticsRowPatch = {}): RunAnalyticsRow {
  const base: RunAnalyticsRow = {
    id: 'r_test',
    schemaVersion: 2,
    runId: 'r_test',
    uid: 'w_test',
    createdAt: Date.now() - 1000,
    endedAt: Date.now(),
    build: 'test-build',
    summary: {
      callsign: 'TEST',
      map: 'orbital',
      mapName: 'Orbital Debris Ring',
      diff: 'easy',
      diffName: 'Easy',
      freeplay: false,
      outcome: 'gameover',
      phase: 'gameover',
      wave: 3,
      kills: 40,
      credits: 1500,
      cashEarned: 2400,
      leaks: 8,
      coresLeft: 0,
      durationS: 210,
    },
    onboarding: { deployClickedAt: 1, firstTowerPlacedAt: 12, firstUpgradeBoughtAt: 0, firstWaveSurvivedAt: 0, firstWinAt: 0 },
    abandonment: {},
    difficulty: { cashAtDeath: 1500, topLeakEnemy: 'stinger' },
    economy: { cashFloatedEnd: 1500, idleWithCashS: 95, failedPurchaseAttempts: 2, failedUpgradeAttempts: 1 },
    menu: {
      pageAgeAtDeployS: 4,
      deployAttempts: 1,
      deployBlocked: 0,
      firstDeployAtS: 4,
      tabSwitches: 1,
      deployTabOpens: 1,
      leaderboardTabOpens: 0,
      selectedMap: 'orbital',
      selectedDiff: 'easy',
      mapSelections: { orbital: 1 },
      protocolSelections: { easy: 1 },
      lockedMapClicks: {},
      lockedProtocolClicks: { hard: 1 },
    },
    controls: {
      keyboardInputs: 4,
      pointerInputs: 8,
      touchInputs: 0,
      soundToggles: 0,
      musicToggles: 0,
      pauseToggles: 1,
      firstPauseAt: 80,
      speedChanges: 2,
      speed1Clicks: 1,
      speed2Clicks: 1,
      speed4Clicks: 0,
      autoToggles: 0,
      sidePanelCollapses: 1,
      sidePanelExpands: 1,
      abortArmed: 1,
      abortConfirmed: 0,
      placementCancels: 1,
      abilityAimCancels: 0,
      waveLaunchClicks: 2,
      waveLaunchKeys: 1,
      cloakTipViews: 0,
      tutorialViews: 1,
      briefingViews: 1,
    },
    combat: {
      firstLeakWave: 2,
      biggestLeakWave: 3,
      biggestLeakCores: 5,
      leaksByEnemy: { stinger: 8 },
      cloakedLeakCores: 4,
      revealedLeakCores: 0,
      armoredLeakCores: 2,
      bossLeakCores: 0,
      peakEnemies: 22,
      waveStarts: 3,
      waveEnds: 2,
      avgWaveDurationS: 44,
      longestWaveDurationS: 65,
      enemiesAtEnd: 4,
      abilityCasts: { strike: 2 },
      pickupCollects: { credits: 1 },
    },
    placement: {
      firstTowerId: 'pulse',
      buildOrder: ['pulse', 'tesla'],
      upgradeOrder: ['pulse:a1'],
      placedByTower: { pulse: 2, tesla: 1 },
      soldByTower: {},
      failedByReason: { credits: 2 },
      failedByTower: { laser: 2 },
      failedUpgradeByReason: { credits: 1 },
      placementCells: { '1,1': 2 },
      failedPlacementCells: { '2,2': 1 },
      sellCells: {},
      beaconZonePlacements: 0,
      darkZonePlacements: 0,
      blueprintSaves: 1,
      blueprintApplies: 1,
      blueprintApplyPlaced: 2,
      targetModeChanges: 1,
      quickSellbacks: 0,
    },
    assistance: {
      aiMenuOpens: 0,
      aiGameOpens: 1,
      aiQuestions: 2,
      aiSuccesses: 1,
      aiErrors: 1,
      aiQuotaErrors: 0,
      feedbackMenuOpens: 0,
      feedbackGameOpens: 1,
      feedbackSubmits: 1,
      feedbackSuccesses: 1,
      feedbackErrors: 0,
      feedbackRepliesViewed: 0,
      widgetPauseS: 12,
    },
    freeplay: {
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
    },
    towerInterest: {
      shopOpens: 2,
      shopSelections: { pulse: 2 },
      lockedTowerClicks: { tesla: 1 },
      unaffordableTowerClicks: { laser: 2 },
      failedPlacements: 2,
      upgradePanelOpens: 1,
      upgradePanelByTower: { pulse: 1 },
      failedUpgrades: 1,
      quickSellbacks: 0,
      targetModeChanges: 1,
      abilityUses: { strike: 2 },
      pickupCollects: { credits: 1 },
    },
    progression: {
      lifetimeKillsAtStart: 0,
      runsBeforeStart: 0,
      victoriesBeforeStart: 0,
      firstSeenAt: 1,
      lastSeenAt: 1,
      sessions: 1,
      sessionsToday: 1,
      daysSinceFirstSeen: 0,
      daysSinceLastSeen: 0,
      unlocksEarned: ['tesla'],
      unlocksViewed: ['tesla'],
      unlockedTowerIdsUsed: [],
    },
    leaderboard: {
      opened: true,
      openCount: 1,
      scoreSubmitAttempts: 1,
      scoreSubmitFailures: 0,
      replaySubmitAttempts: 1,
      replaySubmitFailures: 0,
      rowClicks: 0,
      replayOpens: 0,
      nextRunAfterLeaderboard: false,
    },
    attention: {
      activeS: 200,
      hiddenS: 10,
      idleS: 45,
      pausedS: 15,
      focusLosses: 1,
      sessionS: 220,
      sidePanelS: 100,
      shopPanelS: 70,
      upgradePanelS: 35,
      overlayS: 12,
      widgetOpenS: 12,
      speed1S: 120,
      speed2S: 60,
      speed4S: 20,
    },
    performance: {
      viewportW: 390,
      viewportH: 844,
      devicePixelRatio: 2,
      fpsMin: 24,
      fpsAvg: 40,
      fpsSamples: 20,
      longFrames: 3,
      qualityDowngrades: 2,
      qualityRecoveries: 1,
      displayStandalone: false,
      installPromptSeen: 1,
      installed: 0,
      userAgent: 'test',
    },
  };
  return { ...base, ...patch, summary: { ...base.summary, ...patch.summary } };
}

test.describe('admin analytics model', () => {
  test('catalog covers every private analytics domain', () => {
    const domains = new Set(METRIC_DEFINITIONS.map((metric) => metric.domain));
    for (const domain of ['run', 'menu', 'controls', 'combat', 'placement', 'assistance', 'freeplay', 'towers', 'progression', 'leaderboard', 'attention', 'performance']) {
      expect([...domains]).toContain(domain);
    }
  });

  test('filters, aggregates, records, insights, and csv exports are stable', () => {
    const rows = [
      analyticsRow(),
      analyticsRow({
        id: 'r_win',
        runId: 'r_win',
        uid: 'w_return',
        summary: { outcome: 'victory', phase: 'victory', wave: 50, coresLeft: 120, credits: 400, leaks: 1 },
        progression: { ...analyticsRow().progression, runsBeforeStart: 4, victoriesBeforeStart: 1 },
        economy: { cashFloatedEnd: 400, idleWithCashS: 10, failedPurchaseAttempts: 0, failedUpgradeAttempts: 0 },
        towerInterest: { ...analyticsRow().towerInterest, failedPlacements: 0, failedUpgrades: 0 },
      }),
      analyticsRow({
        id: 'r_fp',
        runId: 'r_fp',
        uid: 'w_return_fp',
        schemaVersion: 1,
        build: 'older-build',
        summary: { map: 'reactor', diff: 'hard', freeplay: true, outcome: 'abandoned', phase: 'build', wave: 76, durationS: 900 },
        freeplay: { ...analyticsRow().freeplay, entered: true, contractSelections: { leanGrid: 1 }, relicSelections: { beaconChoir: 1 }, riskAccepted: { cloakSurge: 1 }, checkpointSubmits: 1 },
        placement: { ...analyticsRow().placement, placementCells: { '5,4': 3 }, failedPlacementCells: {} },
      }),
    ];

    const filtered = filterAnalyticsRows(rows, { ...DEFAULT_ANALYTICS_FILTERS, mode: 'freeplay', waveBucket: 'w76-80', uid: 'return' });
    expect(filtered.map((row) => row.runId)).toEqual(['r_fp']);

    const failedPlacementAgg = aggregateMetric(rows, metricById('towers.failedPlacements'));
    expect(failedPlacementAgg.sum).toBe(4);

    const cells = topRecord(rows, metricById('placement.placementCells'));
    expect(cells[0]).toEqual({ label: '1,1', value: 4 });

    const dataset = buildAnalyticsDataset(rows);
    expect(dataset.insights.map((insight) => insight.signal)).toContain('Lost while rich');
    expect(dataset.insights.map((insight) => insight.signal)).toContain('AI help reliability');

    const csv = metricCsv(rows, [metricById('assistance.aiQuestions'), metricById('placement.placementCells')]);
    expect(csv).toContain('assistance.aiQuestions');
    expect(csv).toContain('placement.placementCells');
    expect(csv).not.toMatch(/prompt|transcript|email/i);
  });
});

test.describe('desktop UX layout', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-only layout expectations');

  test('sector select keeps an 8-card, 4-by-2 grid with docked utility buttons', async ({ page }) => {
    await openDemoMenu(page);

    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.map-card')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      });
      const ai = document.querySelector('.ai-toggle')?.getBoundingClientRect();
      const fb = document.querySelector('.fb-toggle')?.getBoundingClientRect();
      return {
        cards,
        rowCount: new Set(cards.map((card) => card.y)).size,
        firstRowCount: cards.filter((card) => card.y === cards[0]?.y).length,
        mapGrid: getComputedStyle(document.querySelector('[data-testid="map-grid"]')!).display,
        deployVisible: document.querySelector('[data-testid="deploy-button"]')!.getBoundingClientRect().bottom <= window.innerHeight,
        rightEdgesAligned: ai && fb ? Math.abs(ai.right - fb.right) <= 2 : false,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    expect(layout.cards).toHaveLength(8);
    expect(layout.rowCount).toBe(2);
    expect(layout.firstRowCount).toBe(4);
    expect(layout.mapGrid).toBe('grid');
    expect(layout.deployVisible).toBe(true);
    expect(layout.rightEdgesAligned).toBe(true);
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('briefing overlays hide in-game utility widgets, then restore a clean sidebar dock', async ({ page }) => {
    await seedProgress(page);
    await page.goto('/');
    await deployFromMenu(page);

    await expect(page.getByTestId('briefing-overlay')).toBeVisible();
    await expect(page.getByTestId('ai-widget')).toBeHidden();
    await expect(page.getByTestId('message-widget')).toBeHidden();

    const blocked = await widgetMetrics(page);
    expect(blocked.aiWidget).toContain('widget-blocked');
    expect(blocked.messageWidget).toContain('widget-blocked');

    await page.getByRole('button', { name: 'ACKNOWLEDGE' }).click();
    await expect(page.getByTestId('briefing-overlay')).toBeHidden();
    await expect(page.getByTestId('ai-widget')).toBeVisible();
    await expect(page.getByTestId('message-widget')).toBeVisible();

    const openSidebarDock = await widgetMetrics(page);
    expect(openSidebarDock.rightEdgesAligned).toBe(true);
    expect(openSidebarDock.clearOfSidebar).toBe(true);
    expect(openSidebarDock.ai?.placeItems).toBe('center');
    expect(openSidebarDock.message?.placeItems).toBe('center');

    await page.getByLabel('Collapse arsenal panel').click();
    const collapsedDock = await widgetMetrics(page);
    expect(collapsedDock.bodyClasses).toContain('game-sidebar-collapsed');
    expect(collapsedDock.rightEdgesAligned).toBe(true);
    expect(collapsedDock.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('space inside Warden AI input types text instead of toggling game shortcuts', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    const aiToggle = page.getByRole('button', { name: 'Ask Warden AI' });
    await aiToggle.click();
    const input = page.getByLabel('Ask Warden AI about the game');
    await expect(input).toBeVisible();
    await input.press('Space');

    await expect(input).toHaveValue(' ');
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Resume game')).toBeVisible();
    await expect(page.getByTestId('launch-wave')).toBeVisible();
  });
});

test.describe('feedback privacy flow', () => {
  test('stores private receipts and renders callable replies without public feedback reads', async ({ page }) => {
    const receipt = { id: 'feedback_123456', token: 'ABCDEFGHIJKLMNOP' };
    const callableNames: string[] = [];
    const fulfillCallable = async (route: Route, result: unknown) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
          },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ result }),
      });
    };

    await page.route('**/submitFeedback', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillCallable(route, {});
        return;
      }
      callableNames.push('submitFeedback');
      const body = route.request().postDataJSON() as { data?: { text?: string; ctx?: string } };
      expect(body.data?.text).toBe('hello privately');
      expect(body.data?.ctx).toBe('menu');
      await fulfillCallable(route, { accepted: true, ...receipt });
    });
    await page.route('**/fetchFeedbackReplies', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillCallable(route, {});
        return;
      }
      callableNames.push('fetchFeedbackReplies');
      const body = route.request().postDataJSON() as { data?: { receipts?: { id: string; token: string }[] } };
      const match = body.data?.receipts?.some((row) => row.id === receipt.id && row.token === receipt.token);
      await fulfillCallable(route, {
        replies: match ? [{
          id: receipt.id,
          ctx: 'menu',
          ts: 1,
          reply: 'Private reply received.',
          replyTs: 2,
          status: 'replied',
        }] : [],
      });
    });

    await openDemoMenu(page);
    await page.getByRole('button', { name: 'Messages' }).click();
    await page.getByLabel('Message to the developer').fill('hello privately');
    await page.getByRole('button', { name: 'Send message to developer' }).click();

    await expect(page.getByText('Private reply received.')).toBeVisible();
    await expect(page.getByText('You: hello privately')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('nvd-feedback-receipts-v2') ?? '[]') as unknown[];
      return rows.length;
    })).toBe(1);
    expect(callableNames).toContain('submitFeedback');
    expect(callableNames).toContain('fetchFeedbackReplies');
  });
});

test.describe('run telemetry model', () => {
  test('serializes a public replay bundle separately from private analytics', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    const telemetry = await page.evaluate(() => {
      const game = (window as unknown as { game: {
        runId: string;
        startWave: () => void;
        telemetryState: () => unknown;
        recorder: {
          recordCustom: (type: string, state: unknown, payload?: Record<string, unknown>) => void;
        };
        buildRunUploadBundle: (callsign: string, build: string) => {
          run: { schemaVersion: number; runId: string; events: { type: string }[]; summary: Record<string, unknown> };
          chunks: unknown[];
        };
        buildRunAnalyticsDoc: (callsign: string, uid: string, build: string) => Record<string, unknown>;
        buildRunCheckpointDoc: (callsign: string, uid: string, build: string, chunk: number, reason: string) => Record<string, unknown>;
      } }).game;
      game.startWave();
      game.recorder.recordCustom('freeplay_relic_select', game.telemetryState(), {
        relicId: 'beaconChoir',
        extra: 'bounded',
      });
      const bundle = game.buildRunUploadBundle('PERFTEST', 'test-build');
      const analytics = game.buildRunAnalyticsDoc('PERFTEST', 'w_test123', 'test-build');
      const checkpoint = game.buildRunCheckpointDoc('PERFTEST', 'w_test123', 'test-build', 3, 'interval');
      const freeplay = analytics.freeplay as { relicSelections?: Record<string, number> } | undefined;
      return {
        gameRunId: game.runId,
        bundleRunId: bundle.run.runId,
        schemaVersion: bundle.run.schemaVersion,
        eventTypes: bundle.run.events.map((event) => event.type),
        publicHasUid: 'uid' in bundle.run,
        publicHasAttention: 'attention' in bundle.run,
        publicHasAssistance: 'assistance' in bundle.run,
        analyticsHasAttention: 'attention' in analytics,
        analyticsHasUid: 'uid' in analytics,
        analyticsHasMenu: 'menu' in analytics,
        analyticsHasControls: 'controls' in analytics,
        analyticsHasCombat: 'combat' in analytics,
        analyticsHasPlacement: 'placement' in analytics,
        analyticsHasAssistance: 'assistance' in analytics,
        analyticsHasFreeplay: 'freeplay' in analytics,
        freeplayRelicSelections: freeplay?.relicSelections ?? {},
        checkpointSchema: checkpoint.schemaVersion,
        checkpointRunId: checkpoint.runId,
        checkpointChunk: checkpoint.chunk,
        checkpointReason: checkpoint.reason,
        checkpointRecentEventCount: Array.isArray(checkpoint.recentEvents) ? checkpoint.recentEvents.length : -1,
        checkpointHasPerf: typeof checkpoint.performance === 'object',
        checkpointHasCounters: typeof checkpoint.counters === 'object',
        chunkCount: bundle.chunks.length,
      };
    });

    expect(telemetry.gameRunId).toBe(telemetry.bundleRunId);
    expect(telemetry.schemaVersion).toBe(2);
    expect(telemetry.eventTypes).toContain('run_start');
    expect(telemetry.eventTypes).toContain('wave_start');
    expect(telemetry.eventTypes).toContain('freeplay_relic_select');
    expect(telemetry.publicHasUid).toBe(false);
    expect(telemetry.publicHasAttention).toBe(false);
    expect(telemetry.publicHasAssistance).toBe(false);
    expect(telemetry.analyticsHasUid).toBe(true);
    expect(telemetry.analyticsHasAttention).toBe(true);
    expect(telemetry.analyticsHasMenu).toBe(true);
    expect(telemetry.analyticsHasControls).toBe(true);
    expect(telemetry.analyticsHasCombat).toBe(true);
    expect(telemetry.analyticsHasPlacement).toBe(true);
    expect(telemetry.analyticsHasAssistance).toBe(true);
    expect(telemetry.analyticsHasFreeplay).toBe(true);
    expect(telemetry.freeplayRelicSelections.beaconChoir).toBe(1);
    expect(telemetry.checkpointSchema).toBe(2);
    expect(telemetry.checkpointRunId).toBe(telemetry.gameRunId);
    expect(telemetry.checkpointChunk).toBe(3);
    expect(telemetry.checkpointReason).toBe('interval');
    expect(telemetry.checkpointRecentEventCount).toBeGreaterThan(0);
    expect(telemetry.checkpointRecentEventCount).toBeLessThanOrEqual(24);
    expect(telemetry.checkpointHasPerf).toBe(true);
    expect(telemetry.checkpointHasCounters).toBe(true);
    expect(telemetry.chunkCount).toBe(0);
  });

  test('firestore rules allow schema migration and append-only checkpoints', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');

    for (const key of ['menu', 'controls', 'combat', 'placement', 'assistance', 'freeplay']) {
      expect(rules).toContain(`'${key}'`);
    }
    expect(rules).toContain('isTelemetrySchema(request.resource.data)');
    expect(rules).toContain('match /runCheckpoints/{runId}');
    expect(rules).toContain('match /dailyBoards/{daily}/scores/{id}');
    expect(rules).toContain('allow create: if isValidRunId(runId)');
    expect(rules).toContain('allow update, delete: if false');
  });

  test('records representative friction, assistance, and leaderboard counters', async ({ page }) => {
    await seedProgress(page, { runs: 0, victories: 0, kills: 0, armistice: false });
    await page.goto('/');
    await expect(page.getByTestId('diff-card-hard')).toHaveAttribute('aria-disabled', 'true');
    await deployFromMenu(page);

    const metrics = await page.evaluate(() => {
      const { game, appMetrics } = window as unknown as {
        game: any;
        appMetrics: {
          recordLockedProtocolClick: (diffId: string) => void;
          recordAIQuestion: (result: 'submit' | 'success' | 'error' | 'quota') => void;
          recordFeedbackSubmit: (ok: boolean) => void;
        };
      };
      appMetrics.recordLockedProtocolClick('hard');
      appMetrics.recordAIQuestion('submit');
      appMetrics.recordAIQuestion('success');
      appMetrics.recordAIQuestion('error');
      appMetrics.recordFeedbackSubmit(true);
      appMetrics.recordFeedbackSubmit(false);
      game.recorder.recordFailedPlacement(game.telemetryState(), 'laser', 'credits', 999, { x: 24, y: 32 });
      game.recorder.recordLeaderboardOpen();
      game.recorder.recordScoreSubmitAttempt(game.telemetryState());
      game.recorder.recordScoreSubmitResult(false);
      game.recorder.recordReplaySubmitResult(false);
      const analytics = game.buildRunAnalyticsDoc('FRICTION', 'w_test123', 'test-build');
      const bundle = game.buildRunUploadBundle('FRICTION', 'test-build');
      return {
        lockedProtocolClicks: analytics.menu.lockedProtocolClicks ?? {},
        failedPlacementReasons: analytics.placement.failedByReason ?? {},
        failedPlacementTowers: analytics.placement.failedByTower ?? {},
        assistance: analytics.assistance,
        leaderboard: analytics.leaderboard,
        eventTypes: bundle.run.events.map((event: { type: string }) => event.type),
      };
    });

    expect(metrics.lockedProtocolClicks.hard).toBeGreaterThanOrEqual(1);
    expect(metrics.failedPlacementReasons.credits).toBe(1);
    expect(metrics.failedPlacementTowers.laser).toBe(1);
    expect(metrics.assistance.aiQuestions).toBe(1);
    expect(metrics.assistance.aiSuccesses).toBe(1);
    expect(metrics.assistance.aiErrors).toBe(1);
    expect(metrics.assistance.feedbackSubmits).toBe(2);
    expect(metrics.assistance.feedbackSuccesses).toBe(1);
    expect(metrics.assistance.feedbackErrors).toBe(1);
    expect(metrics.leaderboard.openCount).toBe(1);
    expect(metrics.leaderboard.scoreSubmitAttempts).toBe(1);
    expect(metrics.leaderboard.scoreSubmitFailures).toBe(1);
    expect(metrics.leaderboard.replaySubmitAttempts).toBe(1);
    expect(metrics.leaderboard.replaySubmitFailures).toBe(1);
    expect(metrics.eventTypes).not.toContain('tower_place_failed');
  });

  test('records freeplay contracts, relics, risk offers, and checkpoint gates', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    const freeplay = await page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      game.phase = 'victory';
      game.enterFreeplay('leanGrid');

      game.wave = 5;
      game.prepareFreeplayBuild();
      const offeredRelics = game.freeplayState.nextRelicOffer.map((r: { id: string }) => r.id);
      const pickedRelic = offeredRelics[0];
      game.chooseRelic(pickedRelic);
      const reofferedSameWave = game.freeplayState.nextRelicOffer.length;

      game.wave = 61;
      game.prepareFreeplayBuild();
      const riskId = game.freeplayState.riskOffer?.id ?? null;
      const riskAccepted = riskId ? game.acceptRisk(riskId) : false;
      const nextMutators = game.freeplayState.nextMutators.map((m: { id: string }) => m.id);

      game.wave = 65;
      const canBankBefore = game.canBankFreeplay();
      game.markFreeplayCheckpoint();
      const canBankAgain = game.canBankFreeplay();
      const meta = game.freeplayMeta();
      const bundle = game.buildRunUploadBundle('FREEPLAYTEST', 'test-build');
      return {
        contract: game.freeplayState.contract?.id,
        freeplay: game.freeplay,
        offeredRelics,
        pickedRelic,
        ownedRelics: game.freeplayState.relics.map((r: { id: string }) => r.id),
        reofferedSameWave,
        riskId,
        riskAccepted,
        nextMutators,
        canBankBefore,
        canBankAgain,
        lastCheckpointWave: game.freeplayState.lastCheckpointWave,
        meta,
        eventTypes: bundle.run.events.map((event: { type: string }) => event.type),
      };
    });

    expect(freeplay.freeplay).toBe(true);
    expect(freeplay.contract).toBe('leanGrid');
    expect(freeplay.offeredRelics.length).toBeGreaterThan(0);
    expect(freeplay.ownedRelics).toContain(freeplay.pickedRelic);
    expect(freeplay.reofferedSameWave).toBe(0);
    expect(freeplay.riskId).toBeTruthy();
    expect(freeplay.riskAccepted).toBe(true);
    expect(freeplay.nextMutators.length).toBeGreaterThan(0);
    expect(freeplay.canBankBefore).toBe(true);
    expect(freeplay.canBankAgain).toBe(false);
    expect(freeplay.lastCheckpointWave).toBe(65);
    expect(freeplay.meta.contractId).toBe('leanGrid');
    expect(freeplay.meta.relicIds).toContain(freeplay.pickedRelic);
    expect(freeplay.eventTypes).toContain('freeplay_enter');
    expect(freeplay.eventTypes).toContain('freeplay_contract_select');
    expect(freeplay.eventTypes).toContain('freeplay_relic_select');
    expect(freeplay.eventTypes).toContain('freeplay_risk_accept');
    expect(freeplay.eventTypes).toContain('freeplay_checkpoint_submit');
  });

  test('daily freeplay starts with a post-campaign bankroll', async ({ page }) => {
    await openDemoMenu(page);
    await page.getByRole('button', { name: 'DAILY FREEPLAY' }).click();
    await expect(page.getByTestId('game-root')).toBeVisible();

    const daily = await page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      const setup = game.buildRunUploadBundle('DAILYTEST', 'test-build').run.setup;
      return {
        freeplay: game.freeplay,
        isDaily: game.isDailyFreeplay,
        wave: game.wave,
        credits: game.credits,
        lives: game.lives,
        contractId: game.freeplayState.contract?.id,
        dailyId: game.freeplayState.daily?.id,
        dailyTowerIds: [...game.dailyTowerIds],
        setupTowerIds: setup.availableTowerIds,
        setupCash: setup.startingCash,
        relicOffers: game.freeplayState.nextRelicOffer.length,
        canBank: game.canBankFreeplay(),
      };
    });

    expect(daily.freeplay).toBe(true);
    expect(daily.isDaily).toBe(true);
    expect(daily.wave).toBeGreaterThanOrEqual(50);
    expect(daily.credits).toBeGreaterThanOrEqual(18000);
    expect(daily.setupCash).toBe(daily.credits);
    expect(daily.lives).toBeGreaterThan(0);
    expect(daily.contractId).toBeTruthy();
    expect(daily.dailyId).toContain('daily-');
    expect(daily.dailyTowerIds.length).toBeGreaterThanOrEqual(10);
    expect(daily.setupTowerIds.sort()).toEqual(daily.dailyTowerIds.sort());
    expect(daily.relicOffers).toBeGreaterThan(0);
    expect(daily.canBank).toBe(false);
  });

  test('daily freeplay does not mutate campaign progress', async ({ page }) => {
    await seedProgress(page, { runs: 2, kills: 12, totalWaves: 4, archive: [], best: {}, history: [] });
    await page.goto('/');
    await page.getByRole('button', { name: 'DAILY FREEPLAY' }).click();
    await expect(page.getByTestId('game-root')).toBeVisible();

    const daily = await page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      const before = window.localStorage.getItem('nvd-progress-v1');
      const dailyIds = [...game.dailyTowerIds];
      const lockedShop = [...document.querySelectorAll<HTMLElement>('[data-testid^="tower-"]')]
        .find((el) => !dailyIds.includes(el.dataset.testid?.replace('tower-', '') ?? ''));
      game.phase = 'wave';
      game.queue = [];
      game.enemies = [];
      game.wave = 50;
      game.update(0.016);
      game.finishRun(false, 'gameover');
      const after = window.localStorage.getItem('nvd-progress-v1');
      return {
        progressUnchanged: before === after,
        progress: after ? JSON.parse(after) : null,
        lockedText: lockedShop?.querySelector('.shop-cost')?.textContent ?? '',
        dailyIds,
      };
    });

    expect(daily.dailyIds.length).toBeGreaterThanOrEqual(10);
    expect(daily.lockedText).toBe('daily pool');
    expect(daily.progressUnchanged).toBe(true);
    expect(daily.progress.runs).toBe(2);
    expect(daily.progress.kills).toBe(12);
    expect(daily.progress.totalWaves).toBe(4);
    expect(daily.progress.archive).toEqual([]);
    expect(daily.progress.best).toEqual({});
  });

  test('campaign victory records final wave and continued freeplay stats separately', async ({ page }) => {
    await seedProgress(page, { runs: 0, victories: 0, kills: 0, totalWaves: 49, history: [], best: {}, clearedMaps: [] });
    await page.goto('/');
    await deployFromMenu(page);

    const progressAfter = await page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      game.phase = 'wave';
      game.queue = [];
      game.enemies = [];
      game.wave = game.diff.waves;
      game.update(0.016);
      game.enterFreeplay('standard');
      game.wave = 65;
      game.totalKills = 123;
      game.finishRun(false, 'gameover');
      return JSON.parse(window.localStorage.getItem('nvd-progress-v1') ?? '{}');
    });

    expect(progressAfter.totalWaves).toBe(50);
    expect(progressAfter.runs).toBe(1);
    expect(progressAfter.victories).toBe(1);
    expect(progressAfter.kills).toBe(0);
    expect(progressAfter.fpRuns).toBe(1);
    expect(progressAfter.fpBest).toBe(65);
  });
});

test.describe('browser perf harness', () => {
  test('keeps stress counters readable on desktop and mobile perf routes', async ({ page }) => {
    const firestorePosts: string[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.url().includes('firestore.googleapis.com') && !request.url().includes('/Listen/channel')) {
        firestorePosts.push(request.url());
        await route.abort();
        return;
      }
      await route.continue();
    });

    for (const viewport of [{ width: 1365, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/?perf=throat&diff=hard');
      await page.waitForTimeout(1800);
      const sample = await page.evaluate(() => {
        const game = (window as unknown as { game: any }).game;
        const analytics = game.buildRunAnalyticsDoc('PERFTEST', 'w_test123', 'test-build');
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          dpr: window.devicePixelRatio,
          wave: game.wave,
          phase: game.phase,
          hullCount: game.enemies.length,
          fxCount: game.particles.length + game.projectiles.length + game.beams.length,
          fpsAvg: analytics.performance.fpsAvg,
          longFrames: analytics.performance.longFrames,
          qualityDowngrades: analytics.performance.qualityDowngrades,
          qualityRecoveries: analytics.performance.qualityRecoveries,
        };
      });
      expect(sample.viewport).toEqual(viewport);
      expect(sample.dpr).toBeGreaterThan(0);
      expect(sample.wave).toBeGreaterThanOrEqual(0);
      expect(sample.fpsAvg).toBeGreaterThanOrEqual(0);
      expect(sample.longFrames).toBeGreaterThanOrEqual(0);
      expect(sample.qualityDowngrades).toBeGreaterThanOrEqual(0);
      expect(sample.qualityRecoveries).toBeGreaterThanOrEqual(0);
      expect(sample.hullCount).toBeGreaterThanOrEqual(0);
      expect(sample.fxCount).toBeGreaterThanOrEqual(0);
      expect(['build', 'wave', 'victory', 'gameover', 'armistice']).toContain(sample.phase);
    }

    expect(firestorePosts).toHaveLength(0);
  });
});

test.describe('mobile UX layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile-only layout expectations');

  test('sector select uses a horizontal card strip without page overflow', async ({ page }) => {
    await openDemoMenu(page);

    const layout = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="map-grid"]')!;
      const gridRect = grid.getBoundingClientRect();
      const deployRect = document.querySelector('[data-testid="deploy-button"]')!.getBoundingClientRect();
      const ai = document.querySelector('.ai-toggle')?.getBoundingClientRect();
      const fb = document.querySelector('.fb-toggle')?.getBoundingClientRect();
      return {
        gridDisplay: getComputedStyle(grid).display,
        overflowX: getComputedStyle(grid).overflowX,
        scrollWidth: grid.scrollWidth,
        clientWidth: grid.clientWidth,
        gridHeight: Math.round(gridRect.height),
        deployVisible: deployRect.bottom <= window.innerHeight + 1,
        rightEdgesAligned: ai && fb ? Math.abs(ai.right - fb.right) <= 2 : false,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    expect(layout.gridDisplay).toBe('flex');
    expect(layout.overflowX).toBe('auto');
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(layout.gridHeight).toBeLessThan(240);
    expect(layout.deployVisible).toBe(true);
    expect(layout.rightEdgesAligned).toBe(true);
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('game utility dock remains aligned on small screens', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    const dock = await widgetMetrics(page);
    expect(dock.rightEdgesAligned).toBe(true);
    expect(dock.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(dock.ai?.right).toBeLessThanOrEqual(dock.viewport.width);
    expect(dock.message?.right).toBeLessThanOrEqual(dock.viewport.width);
  });
});
