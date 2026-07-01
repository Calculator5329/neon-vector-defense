import { expect, test } from '@playwright/test';

// Production-bundle checks. These run ONLY under `npm run test:e2e:prod`
// (run-playwright.mjs --preview), which serves the built dist/ — the dev
// server neither registers the service worker nor exercises the real chunk
// graph, which is where past regressions (sw navigation, ?run= links) lived.
const preview = process.env.PLAYWRIGHT_PREVIEW === '1';

test.describe('production bundle', () => {
  test.skip(!preview, 'requires the --preview production server');

  test.beforeEach(async ({ page }) => {
    // adult consent so the age gate never blocks the menu (mirrors ux-ui.spec)
    await page.addInitScript(() => {
      window.localStorage.setItem('nvd-consent-v1', JSON.stringify({ ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 }));
    });
  });

  test('emits a build tag and shows no stale toast on a fresh bundle', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    const tagInfo = await page.evaluate(async () => {
      const res = await fetch('/build-tag.json', { cache: 'no-store' });
      return res.ok ? await res.json() as { tag?: string } : null;
    });
    expect(typeof tagInfo?.tag).toBe('string');
    await expect(page.getByTestId('update-toast')).toBeHidden();
  });

  test('boots the built app and registers the service worker', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.state ?? 'no-active-worker';
    });
    expect(swState === 'activated' || swState === 'activating').toBe(true);
  });

  test('?run= deep links navigate through the service worker without network errors', async ({ page }) => {
    // Prime the SW on a first load so the deep link is SW-mediated.
    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => navigator.serviceWorker?.ready);

    const response = await page.goto('/?run=r_doesnotexist12345');
    expect(response?.ok()).toBe(true);
    // The lazy replay viewer chunk must load and render its surface (the run
    // itself does not exist — an error state is fine, a network error is not).
    await expect(page.locator('body')).not.toContainText('ERR_', { timeout: 10_000 });
    await expect(
      page.getByText(/BATTLE PLAN|REPLAY|not found|unavailable|could not/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
