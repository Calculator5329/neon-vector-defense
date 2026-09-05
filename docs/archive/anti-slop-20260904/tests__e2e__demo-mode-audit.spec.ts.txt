import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';

test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', 'Demo audit runs against the dev-server harness');

type AuditGuards = {
  consoleErrors: string[];
  pageErrors: string[];
  blockedWriteUrls: string[];
};

const DESKTOP = { width: 1440, height: 900 };
const LANDSCAPE = { width: 844, height: 390 };
const KNOWN_BENIGN_CONSOLE = [
  /firestore.*offline/i,
  /could not reach cloud firestore backend/i,
  /firestore.*unavailable/i,
  /failed to load resource.*firestore\.googleapis\.com/i,
  /net::ERR_FAILED.*firestore\.googleapis\.com/i,
];

async function prepareViewport(page: Page, testInfo: TestInfo) {
  await page.setViewportSize(testInfo.project.name.includes('mobile') ? LANDSCAPE : DESKTOP);
}

async function clearNvdState(page: Page) {
  const clear = () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('nvd-')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  };
  await page.addInitScript(clear);
  await page.evaluate(clear).catch(() => {});
}

async function installAuditGuards(page: Page): Promise<AuditGuards> {
  const guards: AuditGuards = { consoleErrors: [], pageErrors: [], blockedWriteUrls: [] };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!KNOWN_BENIGN_CONSOLE.some((pattern) => pattern.test(text))) guards.consoleErrors.push(text);
  });
  page.on('pageerror', (error) => guards.pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = request.url();
    if (/identitytoolkit|submit(?:RunReplay|Score|DailyScore|WeeklyScore|GauntletScore|GauntletProtocolScore|RunAnalytics|RunCheckpoint)|logTelemetry/i.test(url)) {
      guards.blockedWriteUrls.push(url);
    }
  });
  await page.route('**/src/game/replaySpotlight.ts', (route) => fulfillPatched(
    route,
    replacementFor('fetchReplayOfTheDay', `{
  return null;
}`),
  ));
  await page.route('**/src/game/leaderboard.ts', (route) => fulfillPatched(
    route,
    replacementFor('fetchRunReplay', `{
  return null;
}`),
  ));
  return guards;
}

function replacementFor(name: string, body: string) {
  return (source: string) => {
    const start = [
      `export async function ${name}(`,
      `async function ${name}(`,
      `export function ${name}(`,
      `function ${name}(`,
    ].map((needle) => source.indexOf(needle)).find((index) => index >= 0) ?? -1;
    if (start < 0) throw new Error(`Cannot patch ${name}: export not found`);
    const bodyStart = source.indexOf('{', start);
    if (bodyStart < 0) throw new Error(`Cannot patch ${name}: body not found`);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return `${source.slice(0, bodyStart)}${body}${source.slice(i + 1)}`;
      }
    }
    throw new Error(`Cannot patch ${name}: body end not found`);
  };
}

async function fulfillPatched(route: Route, patch: (source: string) => string) {
  const response = await route.fetch();
  const source = await response.text();
  const body = patch(source);
  await route.fulfill({
    status: response.status(),
    contentType: response.headers()['content-type'] ?? 'text/javascript',
    body,
  });
}

async function expectNoAuditFailures(page: Page, guards: AuditGuards) {
  await expectNoHorizontalOverflow(page);
  expect(guards.pageErrors).toEqual([]);
  expect(guards.consoleErrors).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function assertDeployBarOnlyOnDeployTab(page: Page) {
  await expect(page.getByTestId('deploy-button')).toBeVisible();
  await expect(page.locator('.deploy-bar')).toBeVisible();
  await page.getByRole('button', { name: /^OPERATIONS/ }).click();
  await expect(page.getByTestId('ops-tab')).toBeVisible();
  await expect(page.locator('.deploy-bar')).toBeHidden();
  await page.getByRole('button', { name: /^DEPLOY/ }).click();
  await expect(page.getByTestId('sector-atlas')).toBeVisible();
  await expect(page.locator('.deploy-bar')).toBeVisible();
}

async function assertUnlockedAtlas(page: Page) {
  await expect(page.getByTestId('sector-atlas')).toBeVisible();
  await expect(page.getByText('CORE RELAY')).toBeVisible();
  await expect(page.getByText('THE FORGE BELT')).toBeVisible();
  await expect(page.getByText('THE DARK REACHES')).toBeVisible();

  const nodes = page.locator('[data-atlas-node="true"][data-testid^="map-node-"]');
  await expect(nodes).toHaveCount(ALL_MAPS.length);
  for (const map of ALL_MAPS) {
    const node = page.getByTestId(`map-node-${map.id}`);
    await expect(node).toBeVisible();
    await expect(node).not.toHaveAttribute('aria-disabled', 'true');
    await node.scrollIntoViewIfNeeded();
    await node.click();
    await expect(page.getByTestId('sector-dock')).toContainText(map.name);
    await expect(page.locator('.deploy-bar-sel')).toContainText(map.name);
  }

  await page.getByTestId(`map-node-${ALL_MAPS[0].id}`).focus();
  await expect(page.getByTestId(`map-node-${ALL_MAPS[0].id}`)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId(`map-node-${ALL_MAPS[1].id}`)).toBeFocused();
  await page.getByTestId(`map-node-${ALL_MAPS[1].id}`).click();
  expect(await page.locator('.atlas-mastery').count()).toBeGreaterThanOrEqual(ALL_MAPS.length + 1);
}

async function assertUnlockedProtocolsAndChallenges(page: Page) {
  await page.getByTestId('dock-tab-protocols').click();
  for (const diff of DIFFICULTIES) {
    const card = page.getByTestId(`diff-card-${diff.id}`);
    await expect(card).toBeVisible();
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    await card.click();
    await expect(card).toHaveClass(/active/);
    await expect(page.locator('.deploy-bar-sel')).toContainText(diff.name);
  }

  await page.getByTestId('dock-tab-challenges').click();
  await expect(page.getByTestId('diff-card-daily')).toBeVisible();
  await page.getByTestId('diff-card-daily').click();
  await expect(page.locator('.deploy-bar-sel')).toContainText('DAILY CHALLENGE');

  await expect(page.getByTestId('weekly-mutation-card')).toBeVisible();
  await page.getByTestId('weekly-mutation-card').click();
  await expect(page.locator('.deploy-bar-sel')).toContainText('WEEKLY MUTATION');

  const champion = page.getByTestId('weekly-gauntlet-card');
  await expect(champion).toBeVisible();
  const championDisabled = await champion.getAttribute('aria-disabled');
  if (championDisabled === 'true') await expect(champion).toContainText('Not crowned yet');
  else {
    await champion.click();
    await expect(page.locator('.deploy-bar-sel')).toContainText('CHAMPION GAUNTLET');
  }

  const protocol = page.getByTestId('gauntlet-protocol-card');
  await expect(protocol).toBeVisible();
  await expect(protocol).toHaveAttribute('aria-disabled', 'false');
  await protocol.click();
  await expect(page.locator('.deploy-bar-sel')).toContainText('GAUNTLET PROTOCOL');
}

async function canvasPoint(page: Page, offset = 0) {
  return page.evaluate((n) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    if (!canvas) throw new Error('game canvas missing');
    const rect = canvas.getBoundingClientRect();
    const game = (window as unknown as { game: { canPlace: (pos: { x: number; y: number }) => boolean } }).game;
    const W = 1280;
    const H = 720;
    const scale = Math.min(rect.width / W, rect.height / H);
    const ox = rect.left + (rect.width - W * scale) / 2;
    const oy = rect.top + (rect.height - H * scale) / 2;
    const points: { x: number; y: number }[] = [];
    for (let y = 80; y <= 640; y += 44) {
      for (let x = 80; x <= 1200; x += 44) {
        if (game.canPlace({ x, y })) points.push({ x, y });
      }
    }
    const p = points[n % points.length];
    if (!p) throw new Error('no valid placement point');
    return { x: ox + p.x * scale, y: oy + p.y * scale };
  }, offset);
}

async function placeTower(page: Page, towerId: string, offset: number) {
  const before = await page.evaluate(() => (window as unknown as { game: { towers: unknown[] } }).game.towers.length);
  const tower = page.getByTestId(`tower-${towerId}`);
  await tower.scrollIntoViewIfNeeded();
  await tower.click();
  await expect(tower).toHaveClass(/active/);
  const p = await canvasPoint(page, offset);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { game: { towers: unknown[] } }).game.towers.length)).toBe(before + 1);
  return p;
}

async function exerciseCombatRun(page: Page, options: { mapId: string; outcome: 'victory' | 'gameover'; terminalWave: number }) {
  await page.getByTestId(`map-node-${options.mapId}`).scrollIntoViewIfNeeded();
  await page.getByTestId(`map-node-${options.mapId}`).click();
  await page.getByTestId('dock-tab-protocols').click();
  await page.getByTestId('diff-card-easy').click();
  await page.getByTestId('deploy-button').click();
  await expect(page.getByTestId('game-root')).toBeVisible();
  await expect(page.locator('.deploy-bar')).toBeHidden();
  await expect(page.getByTestId('shop-grid')).toBeVisible();
  await expect(page.locator('[data-testid^="tower-"]')).toHaveCount(21);
  await expect(page.getByTestId('tower-abyss')).toBeVisible();

  await page.evaluate(() => {
    const game = (window as unknown as { game: { credits: number; paused: boolean } }).game;
    game.credits = 100_000;
    game.paused = false;
  });

  const pulsePoint = await placeTower(page, 'pulse', 0);
  await placeTower(page, 'abyss', 4);
  await page.mouse.click(pulsePoint.x, pulsePoint.y);
  await expect(page.getByTestId('upgrade-pulse-a')).toBeVisible();
  await page.getByTestId('upgrade-pulse-a').click();
  await page.getByTestId('upgrade-pulse-b').click();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as unknown as { game: { towers: { def: { id: string }; tierA: number; tierB: number }[] } }).game;
    const pulse = game.towers.find((tower) => tower.def.id === 'pulse');
    return pulse ? { a: pulse.tierA, b: pulse.tierB } : null;
  })).toEqual({ a: 1, b: 1 });

  await page.getByRole('button', { name: /Orbital Strike ability/ }).click();
  const strikePoint = await canvasPoint(page, 9);
  await page.mouse.click(strikePoint.x, strikePoint.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { game: { runStats: { abilitiesCast: number } } }).game.runStats.abilitiesCast)).toBeGreaterThanOrEqual(1);

  await page.getByTestId('launch-wave').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { game: { wave: number } }).game.wave)).toBeGreaterThanOrEqual(1);
  await page.evaluate(({ outcome, terminalWave }) => {
    const game = (window as unknown as { game: any }).game;
    game.paused = false;
    game.queue = [];
    game.enemies = [];
    game.wave = terminalWave;
    game.totalKills = Math.max(game.totalKills, 42);
    game.runStats.cashEarned = Math.max(game.runStats.cashEarned, 4200);
    game.runStats.dmg = { pulse: 1600, abyss: 9000 };
    game.runStats.kills = { scout: 42 };
    game.runStats.leaks = outcome === 'victory' ? 0 : 10;
    game.lives = outcome === 'victory' ? Math.max(1, game.lives) : 0;
    game.phase = outcome;
    game.finishRun(outcome === 'victory', outcome);
  }, options);
  await expect(page.getByRole('heading', { name: options.outcome === 'victory' ? 'SECTOR SECURED' : 'GRID OFFLINE' })).toBeVisible();
  if (options.outcome === 'victory') {
    await expect(page.getByText('Leaderboard submission is disabled in demo mode')).toBeVisible();
  }
  await expect(page.getByLabel('Leaderboard callsign')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^SUBMIT$/ })).toHaveCount(0);
}

async function openAndCloseMenuSurfaces(page: Page) {
  await page.getByRole('button', { name: /^OPERATIONS/ }).click();
  await expect(page.getByTestId('ops-tab')).toBeVisible();
  await expect(page.locator('.deploy-bar')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: /^DEPLOY/ }).click();
  await page.getByTestId('menu-utility-bestiary').click();
  await expect(page.getByTestId('bestiary')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('bestiary')).toBeHidden();

  await page.getByTestId('menu-utility-help').click();
  await expect(page.getByTestId('tutorial-overlay')).toBeVisible();
  await page.getByRole('button', { name: /GOT IT/ }).click();
  await expect(page.getByTestId('tutorial-overlay')).toBeHidden();

  await page.getByTestId('menu-utility-settings').click();
  await expect(page.getByRole('dialog', { name: 'SETTINGS' })).toBeVisible();
  await page.getByRole('button', { name: /DONE/ }).click();
  await expect(page.getByRole('dialog', { name: 'SETTINGS' })).toBeHidden();
}

async function exerciseReplayPath(page: Page) {
  const replayOfDay = page.locator('.replay-of-day-card');
  if (await replayOfDay.isVisible().catch(() => false)) {
    await replayOfDay.locator('.replay-of-day-watch').click();
    await expect(page.getByTestId('replay-root')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'RETURN TO THE GRID' }).click();
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
  } else {
    await page.goto('/?run=r_demoaudit0001');
    await expect(page.getByTestId('replay-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('REPLAY UNAVAILABLE')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'RETURN TO THE GRID' }).click();
    await page.goto('/?demo=1');
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
  }
}

test.describe('recruiter demo-mode audit', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await prepareViewport(page, testInfo);
    await clearNvdState(page);
  });

  test('walks the full recruiter journey with no demo gates or broken UI', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const guards = await installAuditGuards(page);

    await page.goto('/?demo=1');
    await expect(page.getByRole('dialog', { name: 'BEFORE YOU DEPLOY' })).toHaveCount(0);
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('RECRUITER DEMO')).toBeVisible();
    await expectNoAuditFailures(page, guards);

    await assertDeployBarOnlyOnDeployTab(page);
    await assertUnlockedAtlas(page);
    await assertUnlockedProtocolsAndChallenges(page);
    await expectNoAuditFailures(page, guards);

    await exerciseCombatRun(page, { mapId: 'orbital', outcome: 'victory', terminalWave: 50 });
    await expectNoAuditFailures(page, guards);
    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });

    await openAndCloseMenuSurfaces(page);
    await exerciseReplayPath(page);
    await expectNoAuditFailures(page, guards);

    await page.setViewportSize(testInfo.project.name.includes('mobile') ? DESKTOP : LANDSCAPE);
    await expect(page.getByTestId('deploy-button')).toBeVisible();
    await assertDeployBarOnlyOnDeployTab(page);
    await expectNoAuditFailures(page, guards);

    await exerciseCombatRun(page, { mapId: 'foundry', outcome: 'gameover', terminalWave: 7 });
    await page.setViewportSize(testInfo.project.name.includes('mobile') ? LANDSCAPE : DESKTOP);
    await expect(page.getByRole('heading', { name: 'GRID OFFLINE' })).toBeVisible();
    await expectNoAuditFailures(page, guards);
    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await expectNoAuditFailures(page, guards);

    expect(guards.blockedWriteUrls).toEqual([]);
  });
});
