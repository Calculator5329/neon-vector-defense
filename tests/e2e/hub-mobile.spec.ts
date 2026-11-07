import { expect, test } from '@playwright/test';

// Run against an isolated production export mounted below a directory, without
// a root fallback hiding missing game assets. No live Firebase writes are used.
const hubUrl = process.env.HUB_BASE_URL;
test.describe('private hub mobile export', () => {
  test.skip(!hubUrl, 'set HUB_BASE_URL to the mounted production export');
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== new URL(hubUrl!).origin) {
        await route.abort();
      } else await route.continue();
    });
  });

  test('keeps art, build freshness, manifest and worker inside the game directory', async ({ page }, testInfo) => {
    const escaped: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === new URL(hubUrl!).origin && !url.pathname.startsWith(new URL(hubUrl!).pathname)) escaped.push(url.pathname);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${hubUrl}?demo=1`);
    await expect(page.getByTestId('menu.deploy.launch')).toBeVisible();
    const crest = page.locator('img[src*="rank-"]').first();
    await expect.poll(() => crest.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const manifest = await page.locator('link[rel="manifest"]').evaluate(async (link: HTMLLinkElement) => {
      const response = await fetch(link.href);
      return { url: response.url, data: await response.json() };
    });
    expect(new URL(manifest.data.start_url, manifest.url).href).toBe(hubUrl);
    expect(new URL(manifest.data.scope, manifest.url).href).toBe(hubUrl);
    const registration = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready;
      return { scope: worker.scope, script: worker.active?.scriptURL };
    });
    expect(registration.scope).toBe(hubUrl);
    expect(registration.script).toBe(`${hubUrl}sw.js`);
    expect(escaped).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('portrait-menu.png') });
  });

  test('first visit and privacy remain local to a static game export', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(hubUrl!);
    await expect(page.getByTestId('app.age-gate.dialog')).toBeVisible();
    await page.getByTestId('app.age-gate.privacy-link').tap();
    await expect(page.getByTestId('privacy.page.back')).toBeVisible();
    expect(page.url()).toBe(`${hubUrl}?view=privacy`);
    await page.getByTestId('privacy.page.back').tap();
    await page.getByTestId('app.age-gate.birth-month').selectOption('1');
    await page.getByTestId('app.age-gate.birth-year').selectOption(String(new Date().getFullYear() - 5));
    await page.getByTestId('app.age-gate.confirm').tap();
    await page.getByTestId('app.age-gate.enter').tap();
    await expect(page.getByTestId('menu.deploy.launch')).toBeVisible();
  });

  test('keeps menu controls below the phone safe area', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${hubUrl}?demo=1`);
    await expect(page.getByTestId('menu.deploy.launch')).toBeVisible();
    const help = await page.getByTestId('menu.utility.help').boundingBox();
    expect(help!.y).toBeGreaterThanOrEqual(47);
  });

  test('touch deploy, two-tap tower placement, wave launch and fresh run', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${hubUrl}?demo=1`);
    await page.getByTestId('menu.dock.protocol-easy').tap();
    await page.getByTestId('menu.deploy.launch').tap();
    await expect(page.getByTestId('game.screen.rotate-notice')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('portrait-rotate.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByTestId('game.screen.rotate-notice')).toBeHidden();
    const briefing = page.getByTestId('game.briefing.acknowledge');
    if (await briefing.isVisible()) await briefing.tap();
    const guide = page.getByTestId('game.coach.skip');
    if (await guide.isVisible()) await guide.tap();
    const credits = page.locator('.tb-stat.credits .tb-stat-num');
    const before = Number(await credits.textContent());
    await page.getByTestId('game.shop.tower-pulse').tap();
    // Orbital Relay: clear ground above the opening lane, within turret range.
    const point = await page.getByTestId('game.board.canvas').evaluate((canvas: HTMLCanvasElement) => {
      const r = canvas.getBoundingClientRect();
      const scale = Math.min(r.width / 1280, r.height / 720);
      return { x: r.left + (r.width - 1280 * scale) / 2 + 240 * scale, y: r.top + (r.height - 720 * scale) / 2 + 70 * scale };
    });
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByText('Tap again to place Pulse Turret')).toBeVisible();
    expect(Number(await credits.textContent())).toBe(before);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(async () => Number(await credits.textContent())).toBeLessThan(before);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByTestId('game.upgrade.sell')).toBeVisible();
    await page.getByTestId('game.hud.launch-wave').tap();
    await expect(page.locator('.tb-stat.wave')).toContainText('1');
    await expect.poll(async () => Number(await page.locator('.tb-stat.kills .tb-stat-num').textContent()), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('landscape-gameplay.png') });
    await page.getByTestId('game.hud.abort').tap();
    await page.getByTestId('game.hud.abort').tap();
    await expect(page.getByTestId('menu.deploy.launch')).toBeVisible();
    await page.getByTestId('menu.deploy.launch').tap();
    if (await briefing.isVisible()) await briefing.tap();
    await expect(page.getByTestId('game.hud.launch-wave')).toContainText('LAUNCH WAVE 1');
    expect(Number(await credits.textContent())).toBe(before);
    await page.screenshot({ path: testInfo.outputPath('landscape-reset.png') });
  });
});
