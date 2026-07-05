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

test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', 'UX harness checks run against the dev-server app surface');

const progressSeed = {
  archive: [],
  best: {},
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

const metaSeed = {
  xp: 0,
  salvage: 0,
  salvageLifetime: 0,
  seeded: true,
  questProgress: {},
  questClaimed: [],
  creditedRuns: [],
  bestStreak: 0,
  comebackSeenFor: '',
  cosmetics: [],
  cosmeticEquipped: {},
};

async function seedProgress(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(([base, patch]) => {
    window.localStorage.setItem('nvd-progress-v1', JSON.stringify({ ...base, ...patch }));
    // Seed adult consent so the age gate never blocks tests and consent-gated writes
    // behave like a normal adult player. (?demo=1 also bypasses the gate.)
    window.localStorage.setItem('nvd-consent-v1', JSON.stringify({ ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 }));
  }, [progressSeed, overrides]);
}

async function seedMeta(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(([base, patch]) => {
    window.localStorage.setItem('nvd-meta-v2', JSON.stringify({ ...base, ...patch }));
  }, [metaSeed, overrides]);
}

async function openDemoMenu(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.getByTestId('deploy-button')).toBeVisible();
}

/**
 * Player writes require Firebase Anonymous Auth (src/game/anonAuth.ts), so tests
 * that exercise a write path must answer the identitytoolkit sign-in locally —
 * otherwise the client signs in against production (or fails) before ever
 * reaching the mocked callable/Firestore routes.
 */
const E2E_ANON_UID = 'e2e_anon_uid_1';
async function mockAnonAuth(page: Page, uid = E2E_ANON_UID) {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // Static unsigned JWT: the SDK only parses the payload for expiry/uid locally.
  const fakeIdToken = [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({ sub: uid, user_id: uid, iat: 1_750_000_000, exp: 4_102_444_800, firebase: { sign_in_provider: 'anonymous' } }),
    'sig',
  ].join('.');
  const fulfillJson = async (route: Route, body: unknown) => {
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
      body: JSON.stringify(body),
    });
  };
  await page.route('**/accounts:signUp**', (route) => fulfillJson(route, {
    kind: 'identitytoolkit#SignupNewUserResponse',
    idToken: fakeIdToken,
    refreshToken: 'fake-refresh-token',
    expiresIn: '3600',
    localId: uid,
  }));
  await page.route('**/accounts:lookup**', (route) => fulfillJson(route, {
    kind: 'identitytoolkit#GetAccountInfoResponse',
    users: [{ localId: uid, lastLoginAt: '1750000000000', createdAt: '1750000000000' }],
  }));
}

async function openConsentedMenu(page: Page) {
  await seedProgress(page);
  await page.goto('/');
  await expect(page.getByTestId('deploy-button')).toBeVisible();
}

async function openOperationsMenu(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('deploy-button')).toBeVisible();
  await page.getByRole('button', { name: /^OPERATIONS/ }).click();
  await expect(page.getByTestId('ops-tab')).toBeVisible();
}

async function deployFromMenu(page: Page) {
  await page.getByTestId('deploy-button').click();
  await expect(page.getByTestId('game-root')).toBeVisible();
}

async function acknowledgeBriefing(page: Page) {
  const briefing = page.getByTestId('briefing-overlay');
  if (await briefing.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
  }
}

async function validCanvasPoint(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
    const rect = canvas.getBoundingClientRect();
    const game = (window as unknown as { game: { canPlace: (pos: { x: number; y: number }) => boolean } }).game;
    const W = 1280;
    const H = 720;
    const scale = Math.min(rect.width / W, rect.height / H);
    const ox = rect.left + (rect.width - W * scale) / 2;
    const oy = rect.top + (rect.height - H * scale) / 2;
    for (let y = 90; y <= 630; y += 36) {
      for (let x = 90; x <= 1190; x += 36) {
        if (game.canPlace({ x, y })) return { x: ox + x * scale, y: oy + y * scale };
      }
    }
    throw new Error('no valid placement point');
  });
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

async function menuHeaderMetrics(page: Page) {
  return page.evaluate(() => {
    const header = [...document.querySelectorAll<HTMLElement>('.menu-topbar, .menu-tabs')].map((el) => ({
      selector: el.className,
      scrollX: el.scrollWidth - el.clientWidth,
      scrollY: el.scrollHeight - el.clientHeight,
      overflowX: getComputedStyle(el).overflowX,
      overflowY: getComputedStyle(el).overflowY,
    }));
    const icons = [...document.querySelectorAll<HTMLElement>('.menu-tab-help')].map((button) => {
      const icon = button.querySelector<HTMLElement>('.menu-tab-icon');
      const buttonRect = button.getBoundingClientRect();
      const iconStyle = icon ? getComputedStyle(icon) : null;
      return {
        label: button.getAttribute('aria-label') || button.getAttribute('title') || '',
        buttonWidth: Math.round(buttonRect.width),
        buttonHeight: Math.round(buttonRect.height),
        glyphFontSize: iconStyle ? Number.parseFloat(iconStyle.fontSize) : 0,
      };
    });
    return { header, icons };
  });
}

function expectPolishedMenuHeader(metrics: Awaited<ReturnType<typeof menuHeaderMetrics>>) {
  expect(metrics.header.length).toBeGreaterThanOrEqual(2);
  for (const el of metrics.header) {
    expect(el.scrollX, `${el.selector} horizontal overflow`).toBeLessThanOrEqual(0);
    expect(el.scrollY, `${el.selector} vertical overflow`).toBeLessThanOrEqual(0);
    expect(el.overflowX, `${el.selector} overflow-x`).not.toMatch(/auto|scroll/);
    expect(el.overflowY, `${el.selector} overflow-y`).not.toMatch(/auto|scroll/);
  }
  expect(metrics.icons).toHaveLength(3);
  for (const icon of metrics.icons) {
    expect(icon.buttonWidth, `${icon.label} button width`).toBeGreaterThanOrEqual(40);
    expect(icon.buttonWidth, `${icon.label} button width`).toBeLessThanOrEqual(44);
    expect(icon.buttonHeight, `${icon.label} button height`).toBeGreaterThanOrEqual(40);
    expect(icon.buttonHeight, `${icon.label} button height`).toBeLessThanOrEqual(44);
    expect(icon.glyphFontSize, `${icon.label} glyph size`).toBeGreaterThanOrEqual(20);
  }
}

async function arsenalGridMetrics(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[data-testid="shop-grid"]');
    const sidebar = document.querySelector<HTMLElement>('[data-testid="game-sidebar"]');
    if (!grid) throw new Error('shop grid missing');
    const items = [...grid.querySelectorAll<HTMLElement>('[data-testid^="tower-"]')];
    const rects = items
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.testid?.replace('tower-', '') ?? '',
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: { y: number; ids: string[] }[] = [];
    for (const rect of rects) {
      const row = rows.find((candidate) => Math.abs(candidate.y - rect.y) <= 2);
      if (row) row.ids.push(rect.id);
      else rows.push({ y: rect.y, ids: [rect.id] });
    }
    const sidebarRect = sidebar?.getBoundingClientRect();
    return {
      count: rects.length,
      ids: rects.map((rect) => rect.id),
      rowCount: rows.length,
      rowSizes: rows.map((row) => row.ids.length),
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      sidebarBottom: sidebarRect ? Math.round(sidebarRect.bottom) : null,
      viewportHeight: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

function expectCompleteArsenalGrid(layout: Awaited<ReturnType<typeof arsenalGridMetrics>>) {
  expect(layout.count).toBe(21);
  expect(layout.ids).toContain('siphon');
  expect(layout.ids).toContain('lure');
  expect(layout.columns).toBe(3);
  expect(layout.rowCount).toBe(7);
  expect(layout.rowSizes).toEqual([3, 3, 3, 3, 3, 3, 3]);
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
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
      adBreakRequests: 0,
      adBreakCompleted: 0,
      adBreakSkipped: 0,
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
      wavePreviewViews: 0,
      wavePreviewHovers: 0,
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
        schemaVersion: 2,
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

  test('menu header wraps without scrollbars and keeps utility icons readable at desktop widths', async ({ page }) => {
    for (const viewport of [
      { width: 1920, height: 930 },
      { width: 1440, height: 900 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await openDemoMenu(page);
      expectPolishedMenuHeader(await menuHeaderMetrics(page));
      await expect(page.getByTestId('menu-utility-bestiary')).toBeVisible();
      await expect(page.getByTestId('menu-utility-help')).toBeVisible();
      await expect(page.getByTestId('menu-utility-settings')).toBeVisible();
    }
  });

  test('sector atlas keeps reachable nodes, dock, and utility buttons stable', async ({ page }) => {
    await openDemoMenu(page);

    const layout = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-testid^="map-node-"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      });
      const field = document.querySelector<HTMLElement>('[data-testid="atlas-field"]')!;
      const dock = document.querySelector<HTMLElement>('[data-testid="sector-dock"]')!;
      const ai = document.querySelector('.ai-toggle')?.getBoundingClientRect();
      const fb = document.querySelector('.fb-toggle')?.getBoundingClientRect();
      return {
        nodes,
        fieldWidth: Math.round(field.getBoundingClientRect().width),
        dockWidth: Math.round(dock.getBoundingClientRect().width),
        fieldDisplay: getComputedStyle(field).position,
        deployVisible: document.querySelector('[data-testid="deploy-button"]')!.getBoundingClientRect().bottom <= window.innerHeight,
        rightEdgesAligned: ai && fb ? Math.abs(ai.right - fb.right) <= 2 : false,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    expect(layout.nodes).toHaveLength(12);
    expect(Math.min(...layout.nodes.map((node) => node.width))).toBeGreaterThanOrEqual(44);
    expect(Math.min(...layout.nodes.map((node) => node.height))).toBeGreaterThanOrEqual(44);
    expect(layout.fieldWidth).toBeGreaterThan(layout.dockWidth);
    expect(layout.dockWidth).toBeGreaterThanOrEqual(280);
    expect(layout.fieldDisplay).toBe('relative');
    expect(layout.deployVisible).toBe(true);
    expect(layout.rightEdgesAligned).toBe(true);
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('sector atlas selection, keyboard path, weekly beacon, locks, and deploy launch work', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await openDemoMenu(page);

      for (const id of ['carousel', 'splice', 'mirror', 'foundry']) {
        await expect(page.getByTestId(`map-node-${id}`)).toBeVisible();
      }

      await page.getByTestId('map-node-foundry').click();
      await expect(page.getByTestId('sector-dock')).toContainText('Foundry Floor');
      await page.getByTestId('diff-card-normal').click();
      await expect(page.locator('.deploy-bar-sel')).toContainText('Foundry Floor');
      await expect(page.locator('.deploy-bar-sel')).toContainText('Veteran');

      await page.getByTestId('weekly-ops-beacon').click();
      await expect(page.getByTestId('weekly-mutation-card')).toBeFocused();
      await page.getByTestId('map-node-orbital').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('sector-dock')).toContainText('The Carousel');

      await page.getByTestId('map-node-foundry').click();
      await page.getByTestId('diff-card-normal').click();
      await page.getByTestId('deploy-button').click();
      await expect(page.getByTestId('game-root')).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const game = (window as unknown as { game: any }).game;
        return { map: game.map.id, diff: game.diff.id };
      })).toEqual({ map: 'foundry', diff: 'normal' });
      await page.goto('/?demo=1');
    }
  });

  test('locked atlas node shows unlock copy and does not select', async ({ page }) => {
    await seedProgress(page, { runs: 0, victories: 0, kills: 0, best: {}, clearedMaps: [] });
    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible();
    await expect(page.getByTestId('map-node-reactor')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('map-node-reactor')).toHaveAttribute('aria-label', /Clear The Carousel or reach wave 20/);
    await page.getByTestId('map-node-reactor').click({ force: true });
    await expect(page.getByTestId('sector-dock')).toContainText('Orbital Relay');
    await expect(page.locator('.deploy-bar-sel')).toContainText('Orbital Relay');
  });

  test('arsenal panel renders a complete 21-tower grid on desktop', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);
    await expect(page.getByTestId('shop-grid')).toBeVisible();

    const layout = await arsenalGridMetrics(page);

    expectCompleteArsenalGrid(layout);
  });

  test('keyboard can place a tower and reach its upgrade action', async ({ page }) => {
    await seedProgress(page, { runs: 1, tut: true });
    await page.goto('/');
    await deployFromMenu(page);
    await acknowledgeBriefing(page);

    await page.keyboard.press('1');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { game: { towers: unknown[] } }).game.towers.length)).toBe(1);

    await page.evaluate(() => {
      (window as unknown as { game: { credits: number } }).game.credits = 10_000;
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('upgrade-pulse-a')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(() => {
      const tower = (window as unknown as { game: { towers: { tierA: number; tierB: number }[] } }).game.towers[0];
      return tower.tierA + tower.tierB;
    })).toBe(1);
  });

  test('Veteran Deploy toggle is gated by a campaign victory', async ({ page, context }) => {
    await seedProgress(page, { runs: 1, victories: 0 });
    await page.goto('/');
    await deployFromMenu(page);
    await acknowledgeBriefing(page);
    await expect(page.locator('.shop-mode-tabs')).toHaveCount(0);

    const veteranPage = await context.newPage();
    await seedProgress(veteranPage, { runs: 1, victories: 1 });
    await veteranPage.goto('/');
    await deployFromMenu(veteranPage);
    await acknowledgeBriefing(veteranPage);
    await expect(veteranPage.locator('.shop-mode-tabs')).toBeVisible();
    await expect(veteranPage.locator('.shop-mode-tabs').getByRole('tab', { name: 'VETERAN' })).toBeVisible();
    await veteranPage.close();
  });

  test('Veteran Deploy spends exact projected credits and replays the upgrades', async ({ page }) => {
    await seedProgress(page, { runs: 1, victories: 1, kills: 1_000_000, foes: ['scout'] });
    await page.goto('/');
    await deployFromMenu(page);
    await acknowledgeBriefing(page);
    await page.locator('.shop-mode-tabs').getByRole('tab', { name: 'VETERAN' }).click();

    const expected = await page.evaluate(async () => {
      const game = (window as unknown as { game: any }).game;
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { TOWER_MAP, computeStats } = await load('/src/game/towers.ts');
      const def = TOWER_MAP.pulse;
      const startingCredits = 50_000;
      game.credits = startingCredits;
      const baseCost = game.cost(def);
      const fake = {
        uid: -1,
        def,
        pos: { x: 0, y: 0 },
        stats: computeStats(def, 0, 0),
        tierA: 0,
        tierB: 0,
        committed: null,
        cooldown: 0,
        angle: -Math.PI / 2,
        target: 'first',
        targetFilters: [],
        invested: baseCost,
        kills: 0,
        rateBuff: 1,
        rangeBuff: 1,
        flash: 0,
        recoil: 0,
      };
      let remaining = startingCredits - baseCost;
      let upgradeCost = 0;
      let upgrades = 0;
      while ((fake.tierA < 4 || fake.tierB < 4) && upgrades < 8) {
        const track = fake.tierA <= fake.tierB ? 0 : 1;
        if (game.tierOf(fake, track) >= 4) break;
        const cost = game.upgradeCost(fake, track);
        if (cost <= 0 || game.upgradeState(fake, track) !== 'ok' || remaining < cost) break;
        remaining -= cost;
        upgradeCost += cost;
        upgrades++;
        fake.invested += cost;
        if (track === 0) fake.tierA++;
        else fake.tierB++;
        fake.stats = computeStats(def, fake.tierA, fake.tierB);
      }
      return { startingCredits, totalCost: baseCost + upgradeCost, tierA: fake.tierA, tierB: fake.tierB, upgrades };
    });

    await page.getByTestId('tower-pulse').click();
    const point = await validCanvasPoint(page);
    await page.mouse.click(point.x, point.y);

    const placed = await page.evaluate((startingCredits) => {
      const game = (window as unknown as { game: any }).game;
      const tower = game.towers[0];
      return {
        spent: startingCredits - game.credits,
        tierA: tower.tierA,
        tierB: tower.tierB,
        invested: tower.invested,
      };
    }, expected.startingCredits);

    expect(placed.spent).toBe(expected.totalCost);
    expect(placed.invested).toBe(expected.totalCost);
    expect(placed.tierA).toBe(expected.tierA);
    expect(placed.tierB).toBe(expected.tierB);
    expect(placed.tierA).toBe(placed.tierB);
    expect(placed.tierA).toBeLessThanOrEqual(4);
    expect(expected.upgrades).toBe(8);

    const replay = await page.evaluate(async () => {
      const game = (window as unknown as { game: any }).game;
      game.paused = false;
      game.startWave();
      for (let i = 0; i < 5_000 && game.phase === 'wave'; i++) game.update(0.05);
      const bundle = game.buildRunUploadBundle('VETERANDEPLOY', 'test-build');
      const load = (path: string) => import(/* @vite-ignore */ path);
      const codec = await load('/src/game/replayCodec.ts');
      const events = codec.decodeReplayActionBundle(bundle.run.actions, bundle.chunks);
      const upgrades = events.filter((event: { type: string }) => event.type === 'tower_upgrade');
      return {
        finalTierA: bundle.run.final.towers[0]?.tierA ?? -1,
        finalTierB: bundle.run.final.towers[0]?.tierB ?? -1,
        actionUpgrades: upgrades.length,
        kills: bundle.run.summary.kills,
        actionHash: bundle.run.manifest.actionHash ?? '',
        hasLegacyEvents: 'events' in bundle.run,
        hasLegacySnapshots: 'snapshots' in bundle.run,
        hasLegacyDeaths: 'deathRecords' in bundle.run,
      };
    });

    expect(replay.finalTierA).toBe(expected.tierA);
    expect(replay.finalTierB).toBe(expected.tierB);
    expect(replay.actionUpgrades).toBe(expected.upgrades);
    expect(replay.actionHash).toMatch(/^[0-9a-f]{8}$/);
    expect(replay.hasLegacyEvents).toBe(false);
    expect(replay.hasLegacySnapshots).toBe(false);
    expect(replay.hasLegacyDeaths).toBe(false);
    expect(replay.kills).toBeGreaterThan(0);
  });

  test('arsenal panel stays complete in short-landscape layout', async ({ page }) => {
    await page.setViewportSize({ width: 920, height: 430 });
    await openDemoMenu(page);
    await deployFromMenu(page);
    await expect(page.getByTestId('shop-grid')).toBeVisible();

    const layout = await arsenalGridMetrics(page);

    expectCompleteArsenalGrid(layout);
    expect(layout.sidebarBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  });

  test('owned signal palette equip is silent', async ({ page }) => {
    await seedProgress(page);
    await seedMeta(page, {
      salvage: 400,
      salvageLifetime: 400,
      cosmetics: ['palette-void'],
      cosmeticEquipped: { accent: 'standard' },
    });
    await openOperationsMenu(page);

    await page.getByRole('button', { name: 'Equip Void Violet palette' }).click();
    await expect(page.locator('.ops-status')).toBeHidden();
    await expect(page.locator('.ops-status:not(.idle)')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Void Violet palette equipped' })).toBeVisible();
    await expect(page.getByText('Void Violet palette equipped.')).toHaveCount(0);
  });

  test('signal palette purchase still confirms', async ({ page }) => {
    await seedProgress(page);
    await seedMeta(page, {
      salvage: 400,
      salvageLifetime: 400,
      cosmetics: [],
      cosmeticEquipped: { accent: 'standard' },
    });
    await openOperationsMenu(page);

    await page.getByRole('button', { name: 'Buy Void Violet palette for 400 salvage' }).click();
    await expect(page.locator('.ops-status.ok')).toContainText('Void Violet palette purchased and equipped.');
  });

  test('unaffordable signal palette keeps its salvage guidance', async ({ page }) => {
    await seedProgress(page);
    await seedMeta(page, {
      salvage: 0,
      salvageLifetime: 0,
      cosmetics: [],
      cosmeticEquipped: { accent: 'standard' },
    });
    await openOperationsMenu(page);

    const locked = page.getByRole('button', { name: 'Void Violet palette needs 400 more salvage' });
    await expect(locked).toBeDisabled();
    await expect(locked).toContainText('need 400');
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

test.describe('adaptation package UX', () => {
  test('Bestiary shows Mirror Hull intel and counterplay', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await seedProgress(page, {
      foes: [
        'scout', 'raider', 'stinger', 'phantom', 'wraith', 'shade', 'prism', 'aegis', 'chrono',
        'vortex', 'juggernaut', 'seraph', 'titan', 'leviathan', 'mirror',
      ],
    });
    await openDemoMenu(page);
    await page.getByTestId('menu-utility-bestiary').click();
    await expect(page.getByTestId('bestiary')).toBeVisible();
    await expect(page.getByText('MIRROR HULL')).toBeVisible();
    await expect(page.getByText('ADAPTIVE MIRROR')).toBeVisible();
    await expect(page.getByText(/diversify, stack Exposed, or fire Recalibrate/i)).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('ability bar shows Recalibrate locked and unlocked states', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await seedProgress(page, { kills: 1_000_000, victories: 1 });
    await openDemoMenu(page);
    await page.getByTestId('deploy-button').click();
    await acknowledgeBriefing(page);
    await expect(page.getByTestId('game-canvas')).toBeVisible();

    await expect(page.getByRole('button', { name: /Recalibrate locked until wave 28/i })).toBeVisible();
    await page.evaluate(() => {
      const game = (window as unknown as { game: { wave: number } }).game;
      game.wave = 28;
    });
    await expect(page.getByRole('button', { name: /Recalibrate ability, U/i })).toBeEnabled();
    expect(consoleErrors).toEqual([]);
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

    await mockAnonAuth(page);
    await openConsentedMenu(page);
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

    const telemetry = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const codec = await load('/src/game/replayCodec.ts');
      const game = (window as unknown as { game: {
        runId: string;
        startWave: () => void;
        telemetryState: () => unknown;
        recorder: {
          recordCustom: (type: string, state: unknown, payload?: Record<string, unknown>) => void;
        };
        buildRunUploadBundle: (callsign: string, build: string) => {
          run: {
            schemaVersion: number;
            runId: string;
            chunkCount: number;
            eventCount: number;
            actions: unknown;
            summary: Record<string, unknown>;
            manifest?: { chunkEventCounts: number[]; actionHash: string; complete: boolean };
          };
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
      const eventTypes = codec.decodeReplayActionBundle(bundle.run.actions, bundle.chunks).map((event: { type: string }) => event.type);
      return {
        gameRunId: game.runId,
        bundleRunId: bundle.run.runId,
        schemaVersion: bundle.run.schemaVersion,
        eventTypes,
        publicHasEvents: 'events' in bundle.run,
        publicHasSnapshots: 'snapshots' in bundle.run,
        publicHasDeathRecords: 'deathRecords' in bundle.run,
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
        manifestComplete: bundle.run.manifest?.complete ?? false,
        manifestChunks: bundle.run.manifest?.chunkEventCounts.length ?? -1,
        manifestHash: bundle.run.manifest?.actionHash ?? '',
        eventCount: bundle.run.eventCount,
      };
    });

    expect(telemetry.gameRunId).toBe(telemetry.bundleRunId);
    expect(telemetry.schemaVersion).toBe(3);
    expect(telemetry.eventTypes).toContain('wave_start');
    expect(telemetry.eventTypes).toContain('freeplay_relic_select');
    expect(telemetry.publicHasEvents).toBe(false);
    expect(telemetry.publicHasSnapshots).toBe(false);
    expect(telemetry.publicHasDeathRecords).toBe(false);
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
    expect(telemetry.checkpointSchema).toBe(3);
    expect(telemetry.checkpointRunId).toBe(telemetry.gameRunId);
    expect(telemetry.checkpointChunk).toBe(3);
    expect(telemetry.checkpointReason).toBe('interval');
    expect(telemetry.checkpointRecentEventCount).toBeGreaterThan(0);
    expect(telemetry.checkpointRecentEventCount).toBeLessThanOrEqual(24);
    expect(telemetry.checkpointHasPerf).toBe(true);
    expect(telemetry.checkpointHasCounters).toBe(true);
    expect(telemetry.chunkCount).toBe(0);
    expect(telemetry.manifestComplete).toBe(true);
    expect(telemetry.manifestChunks).toBe(telemetry.chunkCount);
    expect(telemetry.manifestHash).toMatch(/^[a-f0-9]{8}$/);
    expect(telemetry.eventCount).toBeGreaterThanOrEqual(telemetry.eventTypes.length);
  });

  test('firestore rules allow schema migration and append-only checkpoints', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');

    for (const key of ['menu', 'controls', 'combat', 'placement', 'assistance', 'freeplay']) {
      expect(rules).toContain(`'${key}'`);
    }
    expect(rules).toContain('isTelemetrySchema(request.resource.data)');
    expect(rules).toContain('match /runCheckpoints/{runId}');
    expect(rules).toContain('match /dailyBoards/{daily}/scores/{id}');
    expect(rules).toContain('allow create: if isPlayer()');
    expect(rules).toContain('isValidRunId(runId)');
    expect(rules).toContain('allow update, delete: if false');
  });

  test('records representative friction, assistance, and leaderboard counters', async ({ page }) => {
    await seedProgress(page, { runs: 0, victories: 0, kills: 0 });
    await page.goto('/');
    await expect(page.getByTestId('diff-card-hard')).toHaveAttribute('aria-disabled', 'true');
    await deployFromMenu(page);

    const metrics = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const codec = await load('/src/game/replayCodec.ts');
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
      const eventTypes = codec.decodeReplayActionBundle(bundle.run.actions, bundle.chunks).map((event: { type: string }) => event.type);
      return {
        lockedProtocolClicks: analytics.menu.lockedProtocolClicks ?? {},
        failedPlacementReasons: analytics.placement.failedByReason ?? {},
        failedPlacementTowers: analytics.placement.failedByTower ?? {},
        assistance: analytics.assistance,
        leaderboard: analytics.leaderboard,
        eventTypes,
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

  test('forced elite renders on canvas and dies through engine damage', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    const result = await page.evaluate(async () => {
      const game = (window as unknown as { game: any }).game;
      game.paused = false;
      game.phase = 'wave';
      game.queue = [];
      game.enemies = [];
      const elite = game.makeEnemy('scout', false, 'shielded');
      elite.pos = { x: 240, y: 170 };
      elite.wp = 1;
      elite.dist = 100;
      elite.hp = 12;
      elite.maxHp = 12;
      elite.elite.shield = 7;
      elite.elite.maxShield = 7;
      game.enemies.push(elite);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(210, 136, 70, 70).data;
      let cyanPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r < 190 && g > 180 && b > 170) cyanPixels++;
      }

      const shieldOnly = game.damageEnemy(elite, 5, 'energy', true);
      const lethal = game.damageEnemy(elite, 40, 'energy', true);
      game.update(0.05);
      return {
        affix: elite.elite.id,
        cyanPixels,
        shieldOnly,
        lethal,
        liveEnemies: game.enemies.filter((enemy: { dead: boolean }) => !enemy.dead).length,
      };
    });

    expect(result.affix).toBe('shielded');
    expect(result.cyanPixels).toBeGreaterThan(8);
    expect(result.shieldOnly).toBe(0);
    expect(result.lethal).toBeGreaterThan(0);
    expect(result.liveEnemies).toBe(0);
  });

  test('records freeplay contracts, relics, risk offers, and checkpoint gates', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    const freeplay = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const codec = await load('/src/game/replayCodec.ts');
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
      const eventTypes = codec.decodeReplayActionBundle(bundle.run.actions, bundle.chunks).map((event: { type: string }) => event.type);
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
        eventTypes,
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
    expect(freeplay.eventTypes).toContain('freeplay_relic_select');
    expect(freeplay.eventTypes).toContain('freeplay_risk_accept');
  });

  test('daily challenge starts as a wave-one daily protocol', async ({ page }) => {
    await openDemoMenu(page);
    await expect(page.locator('[data-testid="daily-challenge-panel"]')).toHaveCount(0);
    await page.getByTestId('dock-tab-challenges').click();
    await page.getByTestId('diff-card-daily').click();
    await expect(page.getByTestId('diff-card-daily')).toHaveClass(/active/);
    await expect(page.getByTestId('diff-card-daily')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.deploy-bar-sel')).toContainText('DAILY CHALLENGE');
    await expect(page.locator('[data-testid="daily-challenge-panel"]')).toHaveCount(0);

    await page.getByRole('button', { name: /^LEADERBOARD/ }).click();
    await expect(page.getByTestId('daily-leaderboard-mode')).toBeVisible();
    await page.getByRole('button', { name: /^DEPLOY$/ }).click();
    await expect(page.getByTestId('diff-card-daily')).toHaveClass(/active/);
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('game-root')).toBeVisible();
    await expect(page.locator('.daily-strip')).toBeVisible();

    const daily = await page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      const setup = game.buildRunUploadBundle('DAILYTEST', 'test-build').run.setup;
      const modifiers = game.dailyMeta().modifiers;
      return {
        freeplay: game.freeplay,
        isDaily: game.isDailyChallenge,
        wave: game.wave,
        credits: game.credits,
        lives: game.lives,
        contractId: game.freeplayState.contract?.id ?? null,
        dailyId: game.dailyChallenge?.id,
        summaryDaily: game.publicRunSummary('DAILYTEST', 'test-build').daily,
        summaryFreeplay: game.publicRunSummary('DAILYTEST', 'test-build').freeplay,
        summaryMultiplier: game.publicRunSummary('DAILYTEST', 'test-build').scoreMultiplierEnd,
        dailyTowerIds: [...game.dailyTowerIds],
        setupTowerIds: setup.availableTowerIds,
        setupCash: setup.startingCash,
        relicOffers: game.freeplayState.nextRelicOffer.length,
        canBank: game.canBankFreeplay(),
        modifiers,
        hudText: document.querySelector('.daily-strip')?.textContent ?? '',
      };
    });

    expect(daily.freeplay).toBe(false);
    expect(daily.isDaily).toBe(true);
    expect(daily.wave).toBe(0);
    expect(daily.credits).toBe(daily.setupCash);
    expect(daily.setupCash).toBe(daily.credits);
    expect(daily.lives).toBeGreaterThan(0);
    expect(daily.contractId).toBeNull();
    expect(daily.dailyId).toContain('daily-');
    expect(daily.summaryDaily).toBe(daily.dailyId);
    expect(daily.summaryFreeplay).toBe(false);
    expect(daily.summaryMultiplier).toBeUndefined();
    expect(daily.dailyTowerIds.length).toBeGreaterThan(0);
    expect(daily.setupTowerIds.sort()).toEqual(daily.dailyTowerIds.sort());
    expect(daily.relicOffers).toBe(0);
    expect(daily.canBank).toBe(false);
    expect(daily.modifiers).toHaveLength(3);
    for (const modifier of daily.modifiers) expect(daily.hudText).toContain(modifier);
  });

  test('weekly ops are discoverable and gauntlet absence is stable', async ({ page }) => {
    await openDemoMenu(page);
    await page.getByTestId('dock-tab-challenges').click();
    await expect(page.getByTestId('weekly-ops-strip')).toBeVisible();
    await expect(page.getByTestId('weekly-mutation-card')).toBeVisible();
    await expect(page.getByTestId('weekly-gauntlet-card')).toContainText('Not crowned yet');
    await page.getByTestId('weekly-mutation-card').click();
    await expect(page.getByTestId('weekly-mutation-card')).toHaveClass(/active/);
    await expect(page.locator('.deploy-bar-sel')).toContainText('WEEKLY MUTATION');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('weekly-ops-strip')).toBeVisible();
    await expect(page.getByTestId('weekly-gauntlet-card')).toContainText('Not crowned yet');
  });

  test('weekly mutation starts as a wave-one weekly protocol', async ({ page }) => {
    await openDemoMenu(page);
    await page.getByTestId('dock-tab-challenges').click();
    await page.getByTestId('weekly-mutation-card').click();
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('game-root')).toBeVisible();
    await expect(page.locator('.daily-strip')).toContainText('WEEKLY');

    const weekly = await page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      const bundle = game.buildRunUploadBundle('WEEKLYTEST', 'test-build');
      return {
        isWeekly: game.isWeeklyChallenge,
        wave: game.wave,
        freeplay: game.freeplay,
        summaryWeekly: bundle.run.summary.weekly,
        setupWeekly: bundle.run.setup.weekly?.id,
        modifiers: game.dailyMeta().modifiers,
      };
    });

    expect(weekly.isWeekly).toBe(true);
    expect(weekly.wave).toBe(0);
    expect(weekly.freeplay).toBe(false);
    expect(weekly.summaryWeekly).toMatch(/^weekly-\d{4}-W\d{2}$/);
    expect(weekly.setupWeekly).toBe(weekly.summaryWeekly);
    expect(weekly.modifiers.length).toBeGreaterThanOrEqual(5);
  });

  test('gauntlet protocol card deploys and advances from leg one draft to leg two at desktop and mobile widths', async ({ page }) => {
    test.setTimeout(45_000);
    await seedProgress(page, { runs: 2, victories: 1, kills: 1_000_000 });

    for (const viewport of [{ width: 1365, height: 768 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate(() => {
        localStorage.setItem('nvd-consent-v1', JSON.stringify({ ageBand: 'under13', sell: 'no', gpc: false, ts: 1 }));
      });
      await page.getByTestId('dock-tab-challenges').click();
      await expect(page.getByTestId('gauntlet-protocol-card')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('gauntlet-protocol-card')).toHaveAttribute('aria-disabled', 'false');
      await page.getByTestId('gauntlet-protocol-card').click();
      await expect(page.locator('.deploy-bar-sel')).toContainText('GAUNTLET PROTOCOL');
      await page.getByTestId('deploy-button').click();
      await expect(page.getByTestId('game-root')).toBeVisible();
      await acknowledgeBriefing(page);

      await page.evaluate(() => {
        const game = (window as unknown as { game: any }).game;
        game.paused = false;
        game.phase = 'wave';
        game.wave = 20;
        game.enemies = [];
        game.queue = [];
        game.totalKills = Math.max(game.totalKills, 25);
        game.runStats.cashEarned = Math.max(game.runStats.cashEarned, 500);
        game.finishRun(true, 'victory');
      });
      await expect(page.getByRole('heading', { name: 'LEG 1 SECURED' })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'DRAFT RELIC' }).click();
      await expect(page.getByText('GAUNTLET RELIC DRAFT')).toBeVisible();
      await page.locator('.freeplay-modal .relic-card').first().click();
      await expect.poll(() => page.evaluate(() => {
        const game = (window as unknown as { game: any }).game;
        return {
          leg: game.gauntletProtocol?.leg,
          wave: game.wave,
          hud: document.querySelector('.tb-stat.wave')?.textContent?.replace(/\s+/g, ' ').trim(),
          phase: game.phase,
        };
      })).toEqual({ leg: 2, wave: 0, hud: 'WAVE 0 / 25', phase: 'build' });
    }
  });

  test('daily challenge does not mutate campaign progress', async ({ page }) => {
    await seedProgress(page, { runs: 2, kills: 12, totalWaves: 4, archive: [], best: {}, history: [] });
    await page.goto('/');
    await page.getByTestId('dock-tab-challenges').click();
    await page.getByTestId('diff-card-daily').click();
    await page.getByTestId('deploy-button').click();
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
      game.paused = false; // mobile portrait auto-pauses behind the rotate overlay
      game.wave = 4;
      game.update(0.05); // >= one full fixed sim step (1/60) — 0.016 banks in the accumulator and may run zero ticks
      game.finishRun(false, 'gameover');
      const after = window.localStorage.getItem('nvd-progress-v1');
      return {
        progressUnchanged: before === after,
        progress: after ? JSON.parse(after) : null,
        lockedText: lockedShop?.querySelector('.shop-cost')?.textContent ?? '',
        hasLockedTower: Boolean(lockedShop),
        dailyIds,
      };
    });

    expect(daily.dailyIds.length).toBeGreaterThan(0);
    if (daily.hasLockedTower) expect(daily.lockedText).toBe('daily pool');
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
      game.paused = false; // mobile portrait auto-pauses behind the rotate overlay
      game.phase = 'wave';
      game.queue = [];
      game.enemies = [];
      game.wave = game.diff.waves;
      game.update(0.05); // >= one full fixed sim step (1/60) — 0.016 banks in the accumulator and may run zero ticks
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

test.describe('replay re-simulation', () => {
  test('replays a recorded action stream to the exact final summary', async ({ page }) => {
    await openDemoMenu(page);

    const replay = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const [{ Game }, { ALL_MAPS, DIFFICULTIES }, { TOWER_MAP }, codec, resim] = await Promise.all([
        load('/src/game/engine.ts'),
        load('/src/game/maps.ts'),
        load('/src/game/towers.ts'),
        load('/src/game/replayCodec.ts'),
        load('/src/game/reSimulate.ts'),
      ]);
      const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 12345, lifetimeKills: 1_000_000 });
      game.paused = false;
      game.credits = 50_000;
      game.recorder.setStartingResources(game.credits, game.lives);
      const spots: { x: number; y: number }[] = [];
      for (let y = 80; y <= 640 && spots.length < 8; y += 48) {
        for (let x = 80; x <= 1200 && spots.length < 8; x += 48) {
          const pos = { x, y };
          if (game.canPlace(pos)) spots.push(pos);
        }
      }
      for (const pos of spots) {
        const tower = game.placeTower(TOWER_MAP.pulse, pos);
        if (tower) {
          for (let i = 0; i < 3; i++) game.upgradeTower(tower, 0);
        }
      }
      game.startWave();
      for (let i = 0; i < 20_000 && game.phase === 'wave'; i++) game.update(0.05);
      const bundle = game.buildRunUploadBundle('E2EREPLAY', 'test-build');
      const events = codec.decodeReplayActionBundle(bundle.run.actions, bundle.chunks);
      const endEvent = [...events].reverse().find((event: { type: string }) => event.type === 'run_end');
      const playback = resim.createReplayPlayback({ ...bundle.run, chunks: bundle.chunks });
      if (!playback || !endEvent) return { ok: false, reason: playback ? 'missing run_end' : 'playback unavailable' };
      playback.seekTo(playback.endT + 0.1);
      const simulated = playback.game.buildRunUploadBundle(bundle.run.summary.callsign, bundle.run.build).run.summary;
      return {
        ok: true,
        expected: bundle.run.summary,
        simulated,
        actionCount: events.length,
      };
    });

    expect(replay.ok).toBe(true);
    expect(replay.actionCount).toBeGreaterThan(0);
    expect(replay.simulated).toMatchObject({
      map: replay.expected.map,
      diff: replay.expected.diff,
      outcome: replay.expected.outcome,
      phase: replay.expected.phase,
      wave: replay.expected.wave,
      kills: replay.expected.kills,
      credits: replay.expected.credits,
      cashEarned: replay.expected.cashEarned,
      leaks: replay.expected.leaks,
      coresLeft: replay.expected.coresLeft,
      durationS: replay.expected.durationS,
    });
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
      expect(['build', 'wave', 'victory', 'gameover']).toContain(sample.phase);
    }

    expect(firestorePosts).toHaveLength(0);
  });
});

test.describe('first-run coach', () => {
  test('action-gated funnel: place, launch, upgrade, done', async ({ page }) => {
    await seedProgress(page, { tut: false, runs: 0 });
    await page.goto('/');
    await deployFromMenu(page);

    // briefing first, then the non-blocking coach chip at stage 1
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
    const chip = page.getByTestId('coach-chip');
    await expect(chip).toContainText('1/3');

    // stage 1 → 2: place a tower (canvas click path)
    await page.getByTestId('tower-pulse').click();
    const point = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
      const rect = canvas.getBoundingClientRect();
      const game = (window as unknown as { game: { canPlace: (pos: { x: number; y: number }) => boolean } }).game;
      const scale = Math.min(rect.width / 1280, rect.height / 720);
      const ox = rect.left + (rect.width - 1280 * scale) / 2;
      const oy = rect.top + (rect.height - 720 * scale) / 2;
      for (let y = 90; y <= 630; y += 36) {
        for (let x = 90; x <= 1190; x += 36) {
          if (game.canPlace({ x, y })) return { x: ox + x * scale, y: oy + y * scale };
        }
      }
      throw new Error('no valid placement point');
    });
    await page.mouse.click(point.x, point.y);
    await expect(chip).toContainText('2/3');

    // stage 2 → 3: launch the wave
    await page.getByTestId('launch-wave').click();
    await expect(chip).toContainText('3/3');

    // stage 3 → done: buy an upgrade; chip clears and completion persists
    await page.evaluate(() => {
      const game = (window as unknown as { game: { credits: number; towers: { uid: number }[]; upgradeTower: (t: unknown, track: 0 | 1) => boolean } }).game;
      game.credits = 10_000;
      game.upgradeTower(game.towers[0], 0);
    });
    await expect(chip).toBeHidden();
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('nvd-progress-v1') ?? '{}').tut)).toBe(true);
  });

  test('skip guide dismisses the coach and persists', async ({ page }) => {
    await seedProgress(page, { tut: false, runs: 0 });
    await page.goto('/');
    await deployFromMenu(page);
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
    await page.getByRole('button', { name: 'SKIP GUIDE' }).click();
    await expect(page.getByTestId('coach-chip')).toBeHidden();
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('nvd-progress-v1') ?? '{}').tut)).toBe(true);
  });
});

test.describe('mobile UX layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile-only layout expectations');

  test('menu header wraps without scrollbars and keeps utility icons readable on Pixel portrait', async ({ page }) => {
    await openDemoMenu(page);
    expectPolishedMenuHeader(await menuHeaderMetrics(page));
    for (const id of ['menu-utility-bestiary', 'menu-utility-help', 'menu-utility-settings']) {
      const control = page.getByTestId(id);
      await expect(control).toBeVisible();
      await control.focus();
      await expect(control).toBeFocused();
    }
  });

  test('sector atlas pans internally on portrait mobile without page overflow', async ({ page }) => {
    await openDemoMenu(page);

    const layout = await page.evaluate(() => {
      const atlas = document.querySelector<HTMLElement>('[data-testid="sector-atlas"]')!;
      const field = document.querySelector<HTMLElement>('[data-testid="atlas-field"]')!;
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-testid^="map-node-"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { width: Math.round(r.width), height: Math.round(r.height) };
      });
      const deployRect = document.querySelector('[data-testid="deploy-button"]')!.getBoundingClientRect();
      const ai = document.querySelector('.ai-toggle')?.getBoundingClientRect();
      const fb = document.querySelector('.fb-toggle')?.getBoundingClientRect();
      return {
        atlasDisplay: getComputedStyle(atlas).display,
        overflowX: getComputedStyle(atlas).overflowX,
        scrollWidth: atlas.scrollWidth,
        clientWidth: atlas.clientWidth,
        fieldHeight: Math.round(field.getBoundingClientRect().height),
        minNodeWidth: Math.min(...nodes.map((node) => node.width)),
        minNodeHeight: Math.min(...nodes.map((node) => node.height)),
        deployVisible: deployRect.bottom <= window.innerHeight + 1,
        rightEdgesAligned: ai && fb ? Math.abs(ai.right - fb.right) <= 2 : false,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    expect(layout.atlasDisplay).toBe('block');
    expect(layout.overflowX).toBe('auto');
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(layout.fieldHeight).toBeGreaterThan(360);
    expect(layout.minNodeWidth).toBeGreaterThanOrEqual(44);
    expect(layout.minNodeHeight).toBeGreaterThanOrEqual(44);
    expect(layout.deployVisible).toBe(true);
    expect(layout.rightEdgesAligned).toBe(true);
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('arsenal panel renders a complete 21-tower grid on mobile', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);
    await expect(page.getByTestId('shop-grid')).toBeVisible();

    const layout = await arsenalGridMetrics(page);

    expectCompleteArsenalGrid(layout);
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

  test('portrait game view shows rotate guidance without blocking touch placement preview', async ({ page }) => {
    await openDemoMenu(page);
    await deployFromMenu(page);

    await expect(page.getByTestId('rotate-device')).toBeVisible();
    // waves must not run unseen behind the rotate overlay
    await expect.poll(() => page.evaluate(() => (window as unknown as { game: { paused: boolean } }).game.paused)).toBe(true);
    await page.getByTestId('tower-pulse').click();
    const point = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
      const rect = canvas.getBoundingClientRect();
      const game = (window as unknown as { game: { canPlace: (pos: { x: number; y: number }) => boolean } }).game;
      const W = 1280;
      const H = 720;
      const scale = Math.min(rect.width / W, rect.height / H);
      const ox = rect.left + (rect.width - W * scale) / 2;
      const oy = rect.top + (rect.height - H * scale) / 2;
      for (let y = 90; y <= 630; y += 36) {
        for (let x = 90; x <= 1190; x += 36) {
          if (game.canPlace({ x, y })) return { x: ox + x * scale, y: oy + y * scale };
        }
      }
      throw new Error('no valid placement point');
    });

    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByText(/Tap again to place/i)).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { game: { towers: unknown[] } }).game.towers.length)).toBe(0);

    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => page.evaluate(() => (window as unknown as { game: { towers: unknown[] } }).game.towers.length)).toBe(1);
    await expect(page.getByText(/Tap again to place/i)).toBeHidden();
  });
});
