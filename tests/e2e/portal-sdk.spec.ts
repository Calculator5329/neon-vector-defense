import { expect, test, type Page } from '@playwright/test';

const portalId = process.env.VITE_PORTAL;
const isCrazy = portalId === 'crazygames';
const isPoki = portalId === 'poki';

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
  veteranIntroSeen: true,
  audioMuted: false,
  musicOff: false,
};

async function seedPortalHarness(page: Page) {
  await page.addInitScript((seed) => {
    window.localStorage.setItem('nvd-progress-v1', JSON.stringify(seed));
    window.localStorage.setItem('nvd-consent-v1', JSON.stringify({ ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 }));
    (window as unknown as { __portalSdkCalls: string[] }).__portalSdkCalls = [];
    (window as unknown as { __portalAdStates: unknown[] }).__portalAdStates = [];
    (window as unknown as { __portalTrace: unknown[] }).__portalTrace = [];
    window.__NVD_PORTAL_TRACE__ = (event, payload) => {
      (window as unknown as { __portalTrace: unknown[] }).__portalTrace.push({ event, payload });
    };
    window.__NVD_PORTAL_AD_START__ = (type, portal) => {
      const progress = JSON.parse(window.localStorage.getItem('nvd-progress-v1') || '{}') as Record<string, unknown>;
      (window as unknown as { __portalAdStates: unknown[] }).__portalAdStates.push({
        phase: 'start',
        type,
        portal,
        audioMuted: progress.mutedPref === true,
        musicOff: progress.musicOff === true,
      });
    };
  }, progressSeed);
}

async function routePortalSdk(page: Page) {
  if (isCrazy) {
    await page.route('https://sdk.crazygames.com/crazygames-sdk-v3.js', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.__portalSdkCalls = window.__portalSdkCalls || [];
        const call = (name) => window.__portalSdkCalls.push(name);
        window.CrazyGames = { SDK: {
          init: async () => call('init'),
          game: {
            loadingStart: () => call('loadingStart'),
            loadingStop: () => call('loadingStop'),
            gameplayStart: () => call('gameplayStart'),
            gameplayStop: () => call('gameplayStop'),
            happytime: () => call('happytime')
          },
          ad: {
            requestAd: (type, callbacks) => {
              call('requestAd:' + type);
              setTimeout(() => {
                callbacks && callbacks.adStarted && callbacks.adStarted();
                setTimeout(() => callbacks && callbacks.adFinished && callbacks.adFinished(), 50);
              }, 25);
            }
          }
        } };
      `,
    }));
    return;
  }
  await page.route('https://game-cdn.poki.com/scripts/v2/poki-sdk.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      window.__portalSdkCalls = window.__portalSdkCalls || [];
      const call = (name) => window.__portalSdkCalls.push(name);
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.PokiSDK = {
        init: async () => call('init'),
        gameLoadingFinished: () => call('gameLoadingFinished'),
        gameplayStart: () => call('gameplayStart'),
        gameplayStop: () => call('gameplayStop'),
        commercialBreak: async (onStart) => {
          call('commercialBreak');
          await delay(25);
          if (onStart) onStart();
          await delay(50);
        },
        rewardedBreak: async (options) => {
          call('rewardedBreak');
          await delay(25);
          if (options && options.onStart) options.onStart();
          await delay(50);
          return true;
        }
      };
    `,
  }));
}

async function sdkCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __portalSdkCalls?: string[] }).__portalSdkCalls ?? []);
}

test('portal SDK lifecycle and ad break restore @portal', async ({ page }) => {
  test.skip(!isCrazy && !isPoki, 'requires VITE_PORTAL=crazygames or VITE_PORTAL=poki');
  test.skip(test.info().project.name.includes('mobile'), 'desktop controls cover portal SDK lifecycle');
  await routePortalSdk(page);
  await seedPortalHarness(page);

  await page.goto('/');
  await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
  const loadingDoneCall = isCrazy ? 'loadingStop' : 'gameLoadingFinished';
  await expect.poll(async () => (await sdkCalls(page)).join('|')).toContain(loadingDoneCall);

  await page.getByTestId('deploy-button').click();
  await expect(page.getByTestId('game-root')).toBeVisible();
  const briefing = page.getByTestId('briefing-overlay');
  if (await briefing.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
  }
  await expect.poll(async () => (await sdkCalls(page)).join('|')).toContain('gameplayStart');

  await page.getByRole('button', { name: 'Pause game' }).click();
  await expect.poll(async () => (await sdkCalls(page)).join('|')).toContain('gameplayStop');

  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect.poll(async () => (await sdkCalls(page)).toString()).toContain('gameplayStart');

  await page.getByRole('button', { name: 'Abort run' }).click();
  const adCall = isCrazy ? 'requestAd:midgame' : 'commercialBreak';
  await expect.poll(async () => (await sdkCalls(page)).join('|')).toContain(adCall);
  await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });

  const snapshot = await page.evaluate(() => {
    const progress = JSON.parse(window.localStorage.getItem('nvd-progress-v1') || '{}') as Record<string, unknown>;
    return {
      calls: (window as unknown as { __portalSdkCalls?: string[] }).__portalSdkCalls ?? [],
      adStates: (window as unknown as { __portalAdStates?: Array<Record<string, unknown>> }).__portalAdStates ?? [],
      trace: (window as unknown as { __portalTrace?: Array<{ event: string; payload: Record<string, unknown> }> }).__portalTrace ?? [],
      audioMuted: progress.mutedPref === true,
      musicOff: progress.musicOff === true,
    };
  });
  const guardStart = snapshot.trace.find((entry) => entry.event === 'adBreakGuardStart')?.payload;
  const guardEnd = snapshot.trace.find((entry) => entry.event === 'adBreakGuardEnd')?.payload;
  const loadingStartAt = snapshot.calls.indexOf(isCrazy ? 'loadingStart' : 'init');
  const loadingDoneAt = snapshot.calls.indexOf(loadingDoneCall);
  const gameplayStartAt = snapshot.calls.indexOf('gameplayStart');
  const gameplayStopAt = snapshot.calls.indexOf('gameplayStop');
  expect(loadingStartAt).toBeGreaterThanOrEqual(0);
  expect(loadingDoneAt).toBeGreaterThan(loadingStartAt);
  expect(gameplayStartAt).toBeGreaterThan(loadingDoneAt);
  expect(gameplayStopAt).toBeGreaterThan(gameplayStartAt);
  expect(guardStart).toMatchObject({ paused: true, muted: true, musicOff: true });
  expect(snapshot.adStates[0]).toMatchObject({ phase: 'start', audioMuted: true, musicOff: true });
  expect(guardEnd).toMatchObject({ paused: false, muted: false, musicOff: false });
  expect(snapshot.audioMuted).toBe(false);
  expect(snapshot.musicOff).toBe(false);
});
