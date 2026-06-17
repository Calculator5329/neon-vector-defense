import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    expect(rules).toContain('allow update, delete: if false');
  });

  test('records representative friction, assistance, and leaderboard counters', async ({ page }) => {
    await seedProgress(page, { runs: 0, victories: 0, kills: 0, armistice: false });
    await page.goto('/');
    await page.getByTestId('diff-card-hard').click();
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
});

test.describe('browser perf harness', () => {
  test('keeps stress counters readable on desktop and mobile perf routes', async ({ page }) => {
    const firestorePosts: string[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.url().includes('firestore.googleapis.com')) {
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
