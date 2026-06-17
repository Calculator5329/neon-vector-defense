import { expect, test, type Page } from '@playwright/test';

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
        buildRunUploadBundle: (callsign: string, build: string) => {
          run: { runId: string; events: { type: string }[]; summary: Record<string, unknown> };
          chunks: unknown[];
        };
        buildRunAnalyticsDoc: (callsign: string, uid: string, build: string) => Record<string, unknown>;
      } }).game;
      game.startWave();
      const bundle = game.buildRunUploadBundle('PERFTEST', 'test-build');
      const analytics = game.buildRunAnalyticsDoc('PERFTEST', 'w_test123', 'test-build');
      return {
        gameRunId: game.runId,
        bundleRunId: bundle.run.runId,
        eventTypes: bundle.run.events.map((event) => event.type),
        publicHasUid: 'uid' in bundle.run,
        publicHasAttention: 'attention' in bundle.run,
        analyticsHasAttention: 'attention' in analytics,
        analyticsHasUid: 'uid' in analytics,
        chunkCount: bundle.chunks.length,
      };
    });

    expect(telemetry.gameRunId).toBe(telemetry.bundleRunId);
    expect(telemetry.eventTypes).toContain('run_start');
    expect(telemetry.eventTypes).toContain('wave_start');
    expect(telemetry.publicHasUid).toBe(false);
    expect(telemetry.publicHasAttention).toBe(false);
    expect(telemetry.analyticsHasUid).toBe(true);
    expect(telemetry.analyticsHasAttention).toBe(true);
    expect(telemetry.chunkCount).toBe(0);
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
