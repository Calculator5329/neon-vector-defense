import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const QA_ROOT = join(process.cwd(), 'test-results', 'qa');
const E2E_ANON_UID = 'e2e_anon_uid_1';

test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', 'QA screenshots run against the dev-server harness');

const adultConsent = { ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 };
const today = new Date().toISOString().slice(0, 10);

const progressSeed = {
  archive: [0, 1, 2, 3],
  best: {
    'orbital:easy': 50,
    'reactor:normal': 44,
    'hyperlane:hard': 31,
    'mobius:normal': 37,
    'blackout:hard': 28,
    'throat:hard': 33,
    'umbral:hard': 24,
    'cinder:hard': 26,
  },
  totalWaves: 420,
  runs: 18,
  victories: 5,
  kills: 165000,
  blueprints: {},
  history: [
    { map: 'orbital', diff: 'easy', wave: 50, kills: 1180, cash: 9200, won: true, freeplay: false, date: Date.now() - 86400000 },
    { map: 'reactor', diff: 'normal', wave: 44, kills: 920, cash: 6800, won: false, freeplay: false, date: Date.now() - 172800000 },
  ],
  playerName: 'QA WARDEN',
  clearedMaps: ['orbital', 'reactor', 'hyperlane', 'mobius', 'blackout', 'throat', 'umbral', 'cinder'],
  firstSeenAt: Date.now() - 7 * 86400000,
  lastSeenAt: Date.now() - 60000,
  sessions: 9,
  sessionDays: { [today]: 1 },
  uid: 'w_qa_audit',
  tut: true,
  cloakTip: true,
  apexW: true,
  foes: [
    'scout', 'raider', 'stinger', 'phantom', 'wraith', 'shade', 'prism', 'aegis', 'chrono',
    'vortex', 'juggernaut', 'seraph', 'titan', 'leviathan', 'wisp', 'gorge', 'lampblack', 'umbra',
  ],
  foesAck: 0,
  fpRuns: 3,
  fpBest: 76,
  fpKills: 12000,
};

const metaSeed = {
  xp: 8400,
  salvage: 900,
  salvageLifetime: 1450,
  seeded: true,
  questProgress: {},
  questClaimed: [],
  creditedRuns: [],
  bestStreak: 4,
  comebackSeenFor: '',
  cosmetics: ['palette-void'],
  cosmeticEquipped: { accent: 'void' },
};

async function seedLocalState(
  page: Page,
  options: {
    progress?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    consent?: Record<string, unknown>;
  } = {},
) {
  const state = {
    progress: { ...progressSeed, ...options.progress },
    meta: { ...metaSeed, ...options.meta },
    consent: options.consent ?? adultConsent,
  };
  const install = (seed: typeof state) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('nvd-')) localStorage.removeItem(key);
    }
    localStorage.setItem('nvd-progress-v1', JSON.stringify(seed.progress));
    localStorage.setItem('nvd-meta-v2', JSON.stringify(seed.meta));
    localStorage.setItem('nvd-consent-v1', JSON.stringify(seed.consent));
  };
  await page.addInitScript(install, state);
  await page.evaluate(install, state).catch(() => {});
}

async function mockRemoteDataFailures(page: Page) {
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
}

async function mockCallable(route: Route, result: unknown) {
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
    body: JSON.stringify({ data: result, result }),
  });
}

async function mockFeedbackCallables(page: Page) {
  await page.route('**/*submitFeedback*', (route) => mockCallable(route, {
    accepted: true,
    id: 'feedback_qa_0001',
    token: '0123456789abcdef',
  }));
  await page.route('**/*fetchFeedbackReplies*', (route) => mockCallable(route, { replies: [] }));
}

async function mockAnonAuth(page: Page, uid = E2E_ANON_UID) {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
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

function viewportSlug(testInfo: TestInfo): string {
  return testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(175);
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await captureInDir(page, viewportSlug(testInfo), name);
}

async function captureInDir(page: Page, slug: string, name: string) {
  await settle(page);
  await expectNoPageOverflow(page);
  const dir = join(QA_ROOT, slug);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

async function openMenu(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
}

test.describe('QA audit screen screenshots', () => {
  test('captures the automated screen inventory into test-results/qa', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await mockRemoteDataFailures(page);

    await test.step('age gate entry', async () => {
      await page.goto('/');
      await expect(page.getByRole('dialog', { name: 'BEFORE YOU DEPLOY' })).toBeVisible();
      await capture(page, testInfo, '01-age-gate-entry');
    });

    await test.step('deploy menu, leaderboard, and operations', async () => {
      await seedLocalState(page);
      await openMenu(page, '/?demo=1');
      await capture(page, testInfo, '02-deploy-menu');

      await page.getByRole('button', { name: /^LEADERBOARD/ }).click();
      await expect(page.locator('.board-tab')).toBeVisible();
      await expect(page.locator('.board-title')).toContainText('GLOBAL LEADERBOARD');
      await capture(page, testInfo, '03-leaderboard-tab-shell');

      await page.getByRole('button', { name: /^OPERATIONS/ }).click();
      await expect(page.getByTestId('ops-tab')).toBeVisible();
      await capture(page, testInfo, '04-operations-board');
    });

    await test.step('menu modal surfaces', async () => {
      await seedLocalState(page);
      await openMenu(page, '/?demo=1');
      await page.getByTitle('How to play').click();
      await expect(page.getByTestId('tutorial-overlay')).toBeVisible();
      await capture(page, testInfo, '05-how-to-play-modal');

      await seedLocalState(page);
      await openMenu(page, '/?demo=1');
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('dialog', { name: 'SETTINGS' })).toBeVisible();
      await capture(page, testInfo, '06-settings-modal');

      await seedLocalState(page);
      await openMenu(page, '/?demo=1');
      await page.getByLabel(/Combine Bestiary/).first().click();
      await expect(page.getByTestId('bestiary')).toBeVisible();
      await capture(page, testInfo, '07-bestiary-modal');
    });

    await test.step('menu utility widgets and feedback write path', async () => {
      await mockAnonAuth(page);
      await mockFeedbackCallables(page);
      await seedLocalState(page);
      await openMenu(page);
      await page.getByRole('button', { name: 'Ask Warden AI' }).click();
      await expect(page.getByLabel('Ask Warden AI about the game')).toBeVisible();
      await capture(page, testInfo, '08-ai-help-widget');
      await page.getByRole('button', { name: 'Close Warden AI' }).click();
      await expect(page.getByLabel('Ask Warden AI about the game')).toBeHidden();

      await page.getByRole('button', { name: 'Messages' }).click();
      await expect(page.getByLabel('Message to the developer')).toBeVisible();
      await page.getByLabel('Message to the developer').fill('QA audit feedback smoke.');
      await capture(page, testInfo, '09-feedback-compose');
      await page.getByRole('button', { name: 'Send message to developer' }).click();
      await expect(page.locator('.fb-replies')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.fb-section-title')).toHaveText('ADMIN REPLIES');
      await capture(page, testInfo, '10-feedback-submitted');
    });

    await test.step('static and gated routes', async () => {
      await seedLocalState(page);
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'PRIVACY POLICY' })).toBeVisible();
      await capture(page, testInfo, '11-privacy-route');

      await page.goto('/admin');
      await expect(page.locator('.adm-login-card')).toBeVisible({ timeout: 15_000 });
      await capture(page, testInfo, '12-admin-login-shell');
    });

    await test.step('game briefing, board, mobile rotate, and after-action shell', async () => {
      await seedLocalState(page, { progress: { ...progressSeed, runs: 1, victories: 1, kills: 1200 } });
      await openMenu(page);
      await page.getByTestId('deploy-button').click();
      await expect(page.getByTestId('briefing-overlay')).toBeVisible();
      await capture(page, testInfo, '13-game-briefing-overlay');

      await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
      await expect(page.getByTestId('briefing-overlay')).toBeHidden();
      await expect(page.getByTestId('game-canvas')).toBeVisible();
      await page.waitForTimeout(350);
      await capture(page, testInfo, '14-game-board-hud');
      if (testInfo.project.name.includes('mobile')) {
        await expect(page.getByTestId('rotate-device')).toBeVisible();
        await capture(page, testInfo, '15-game-portrait-rotate');
      }

      await seedLocalState(page);
      await openMenu(page, '/?demo=1');
      await page.getByTestId('deploy-button').click();
      await expect(page.getByTestId('game-root')).toBeVisible();
      await page.evaluate(() => {
        const game = (window as unknown as { game?: any }).game;
        if (!game) throw new Error('game dev handle missing');
        game.phase = 'gameover';
        game.wave = 7;
        game.lives = 0;
        game.totalKills = 42;
        game.runStats.dmg = { pulse: 2200, tesla: 900 };
        game.runStats.kills = { scout: 28, raider: 14 };
        game.runStats.leaks = 18;
        game.runStats.abilitiesCast = 1;
      });
      await expect(page.getByRole('heading', { name: 'GRID OFFLINE' })).toBeVisible();
      await capture(page, testInfo, '16-after-action-report');
    });

    await test.step('replay unavailable shell', async () => {
      await page.goto('/?run=r_qaunavailable01');
      await expect(page.getByTestId('replay-root')).toBeVisible();
      await expect(page.getByText('REPLAY UNAVAILABLE')).toBeVisible({ timeout: 15_000 });
      await capture(page, testInfo, '17-replay-unavailable-route');
    });
  });

  test('captures the required short-landscape game layout into test-results/qa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'short-landscape override runs once');
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await mockRemoteDataFailures(page);
    await seedLocalState(page, { progress: { ...progressSeed, runs: 1, victories: 1, kills: 1200 } });
    await openMenu(page);
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('briefing-overlay')).toBeVisible();
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
    await expect(page.getByTestId('game-root')).toBeVisible();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await expect(page.getByTestId('rotate-device')).toBeHidden();
    const verticalOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(verticalOverflow).toBeLessThanOrEqual(2);
    await captureInDir(page, 'short-landscape', '15b-short-landscape-game');
  });

  test('captures menu polish viewports into test-results/qa', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await mockRemoteDataFailures(page);

    const captures: { slug: string; name: string; viewport?: { width: number; height: number } }[] = testInfo.project.name.includes('mobile')
      ? [{ slug: 'menu-polish', name: 'pixel-5-portrait' }]
      : [
          { slug: 'menu-polish', name: '1920x930', viewport: { width: 1920, height: 930 } },
          { slug: 'menu-polish', name: '1440x900', viewport: { width: 1440, height: 900 } },
          { slug: 'menu-polish', name: '844x390', viewport: { width: 844, height: 390 } },
        ];

    for (const item of captures) {
      if (item.viewport) await page.setViewportSize(item.viewport);
      await seedLocalState(page);
      await openMenu(page, '/?demo=1');
      await captureInDir(page, item.slug, `${item.name}-deploy-menu`);
      await page.getByTestId('diff-card-daily').click();
      await expect(page.getByTestId('diff-card-daily')).toHaveClass(/active/);
      await captureInDir(page, item.slug, `${item.name}-daily-selected`);
    }
  });
});
