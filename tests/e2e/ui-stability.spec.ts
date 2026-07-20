import { expect, test, type Page, type Route } from '@playwright/test';
import { operationsBoard } from '../../src/game/meta';
import {
  captureRects,
  expectNoLayoutShifts,
  expectStableRects,
  installLayoutShiftObserver,
  resetLayoutShiftObserver,
  settleLayout,
} from './ui-stability';

test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', 'UI stability tour runs against the dev-server app surface');

const today = new Date().toISOString().slice(0, 10);

const progressSeed = {
  archive: [0, 1, 2, 3],
  best: {
    'orbital:easy': 50,
    'carousel:easy': 50,
    'reactor:normal': 44,
    'splice:normal': 38,
    'mobius:normal': 37,
    'mirror:normal': 40,
    'hyperlane:hard': 31,
    'blackout:hard': 28,
    'throat:hard': 33,
    'foundry:hard': 29,
    'umbral:hard': 24,
    'cinder:hard': 26,
  },
  totalWaves: 420,
  runs: 18,
  victories: 5,
  kills: 165000,
  blueprints: {},
  history: [],
  playerName: 'QA WARDEN',
  clearedMaps: ['orbital', 'carousel', 'reactor', 'splice', 'mobius', 'mirror', 'hyperlane', 'blackout', 'throat', 'foundry', 'umbral', 'cinder'],
  firstSeenAt: Date.now() - 7 * 86400000,
  lastSeenAt: Date.now() - 60000,
  sessions: 9,
  sessionDays: { [today]: 1 },
  uid: 'w_ui_stability',
  tut: true,
  cloakTip: true,
  veteranIntroSeen: true,
  apexW: true,
  foes: ['scout', 'raider', 'stinger', 'phantom', 'wraith', 'shade', 'prism', 'aegis', 'chrono'],
  foesAck: 0,
  fpRuns: 3,
  fpBest: 76,
  fpKills: 12000,
};

function completedQuestProgress() {
  return Object.fromEntries(operationsBoard(new Date()).map((q) => [q.id, q.target]));
}

const metaSeed = {
  xp: 8400,
  salvage: 1400,
  salvageLifetime: 2200,
  seeded: true,
  questProgress: completedQuestProgress(),
  questClaimed: [],
  creditedRuns: [],
  creditedDailies: [],
  bestDailyWave: 22,
  bestStreak: 4,
  comebackSeenFor: '',
  cosmetics: ['palette-void', 'palette-frost'],
  cosmeticEquipped: { accent: 'standard' },
};

async function seedLocalState(page: Page) {
  const state = {
    progress: progressSeed,
    meta: metaSeed,
    consent: { ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 },
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
}

async function mockRemoteDataFailures(page: Page) {
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
}

const E2E_ANON_UID = 'e2e_anon_uid_1';

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

async function mockFeedback(page: Page) {
  await page.route('**/*submitFeedback*', (route) => mockCallable(route, {
    accepted: true,
    id: 'feedback_ui_stability',
    token: '0123456789abcdef',
  }));
  await page.route('**/*fetchFeedbackReplies*', (route) => mockCallable(route, { replies: [] }));
}

test.beforeEach(async ({ page }) => {
  await installLayoutShiftObserver(page);
  await mockRemoteDataFailures(page);
  await seedLocalState(page);
});

test.describe('UI stability guardrails', () => {
  test('keeps menu, claim, equip, feedback, and leaderboard transitions stable', async ({ page }) => {
    test.setTimeout(45_000);
    await mockAnonAuth(page);
    await mockFeedback(page);
    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible();
    await settleLayout(page);

    await resetLayoutShiftObserver(page);
    await page.waitForTimeout(5_000);
    await expectNoLayoutShifts(page, 'menu idle');

    await page.getByRole('button', { name: /^LEADERBOARD/ }).click();
    await expect(page.locator('.board-empty').first()).toBeVisible();
    await settleLayout(page);
    const leaderboardBefore = await captureRects(page, {
      topbar: '.menu-topbar',
      globalBoard: '.board-global',
      localBoard: '.board-local',
    });
    await resetLayoutShiftObserver(page);
    await expect(page.getByText(/Leaderboard uplink failed|No global records|Establishing uplink/)).toBeVisible({ timeout: 10_000 });
    await settleLayout(page, 250);
    const leaderboardAfter = await captureRects(page, {
      topbar: '.menu-topbar',
      globalBoard: '.board-global',
      localBoard: '.board-local',
    });
    expectStableRects(leaderboardBefore, leaderboardAfter, 'leaderboard async settle', 1);
    await expectNoLayoutShifts(page, 'leaderboard async settle');

    await page.getByRole('button', { name: /^OPERATIONS/ }).click();
    await expect(page.getByTestId('ops-board')).toBeVisible();
    await settleLayout(page, 250);
    const opsBefore = await captureRects(page, {
      shop: '.ops-shop',
      boardHead: '.ops-board-head',
      board: '[data-testid="ops-board"]',
    });
    await resetLayoutShiftObserver(page);
    await page.getByRole('button', { name: /^CLAIM ALL/ }).click();
    await expect(page.locator('.ops-status')).toContainText('Claimed');
    await settleLayout(page, 250);
    const opsAfterClaim = await captureRects(page, {
      shop: '.ops-shop',
      boardHead: '.ops-board-head',
      board: '[data-testid="ops-board"]',
    });
    expectStableRects(opsBefore, opsAfterClaim, 'operations claim all', 1);
    await expectNoLayoutShifts(page, 'operations claim all');

    const paletteBefore = await captureRects(page, {
      shop: '.ops-shop',
      paletteRow: '.palette-row',
      board: '[data-testid="ops-board"]',
    });
    await resetLayoutShiftObserver(page);
    await page.getByRole('button', { name: /Equip Void Violet palette/ }).click();
    await expect(page.getByRole('button', { name: /Void Violet palette equipped/ })).toBeVisible();
    await settleLayout(page, 250);
    const paletteAfter = await captureRects(page, {
      shop: '.ops-shop',
      paletteRow: '.palette-row',
      board: '[data-testid="ops-board"]',
    });
    expectStableRects(paletteBefore, paletteAfter, 'palette equip', 1);
    await expectNoLayoutShifts(page, 'palette equip');

    await page.getByRole('button', { name: 'Messages' }).click();
    await expect(page.getByLabel('Message to the developer')).toBeVisible();
    await page.getByLabel('Message to the developer').fill('UI stability smoke.');
    // Park the pointer off the widget: .fb-toggle scales on :hover, and a rect
    // captured while the click-position hover is still applied reads ~45px
    // instead of the settled 42px, tripping the guard on CI.
    await page.mouse.move(0, 0);
    await settleLayout(page);
    const feedbackBefore = await captureRects(page, {
      panel: '.fb-panel',
      toggle: '.fb-toggle',
    });
    await resetLayoutShiftObserver(page);
    await page.getByRole('button', { name: 'Send message to developer' }).click();
    await expect(page.locator('.fb-replies')).toBeVisible({ timeout: 10_000 });
    await page.mouse.move(0, 0);
    await settleLayout(page, 250);
    const feedbackAfter = await captureRects(page, {
      panel: '.fb-panel',
      toggle: '.fb-toggle',
    });
    expectStableRects(feedbackBefore, feedbackAfter, 'feedback send state', 1);
    await expectNoLayoutShifts(page, 'feedback send state');
  });

  test('keeps in-run advisory and build overlays from moving the command layout', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('game-root')).toBeVisible();
    const briefing = page.getByTestId('briefing-overlay');
    if (await briefing.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
    }
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await settleLayout(page);

    const beforeNotice = await captureRects(page, {
      topbar: '.topbar',
      canvas: '[data-testid="game-canvas"]',
      sidebar: '[data-testid="game-sidebar"]',
      launch: '[data-testid="launch-wave"]',
    });
    await resetLayoutShiftObserver(page);
    await page.evaluate(() => {
      const game = (window as unknown as { game?: any }).game;
      if (!game) throw new Error('game dev handle missing');
      game.notice = 'BUILD ADVISORY: test signal is intentionally long enough to wrap on narrow screens.';
      game.noticeTimer = 2.5;
    });
    await expect(page.locator('.notice')).toBeVisible();
    await settleLayout(page, 250);
    const afterNotice = await captureRects(page, {
      topbar: '.topbar',
      canvas: '[data-testid="game-canvas"]',
      sidebar: '[data-testid="game-sidebar"]',
      launch: '[data-testid="launch-wave"]',
    });
    expectStableRects(beforeNotice, afterNotice, 'in-run notice overlay', 1);
    await expectNoLayoutShifts(page, 'in-run notice overlay');

    const beforeCounters = await captureRects(page, {
      topbar: '.topbar',
      canvas: '[data-testid="game-canvas"]',
      sidebar: '[data-testid="game-sidebar"]',
    });
    await resetLayoutShiftObserver(page);
    await page.evaluate(() => {
      const game = (window as unknown as { game?: any }).game;
      game.credits = 999999;
      game.totalKills = 888888;
      game.wave = 49;
      game.lives = 120;
      game.adaptation = { type: 'energy', resist: 0.35 };
    });
    await expect(page.locator('.tb-adapt-slot')).toBeVisible();
    await settleLayout(page, 250);
    const afterCounters = await captureRects(page, {
      topbar: '.topbar',
      canvas: '[data-testid="game-canvas"]',
      sidebar: '[data-testid="game-sidebar"]',
    });
    expectStableRects(beforeCounters, afterCounters, 'topbar counters and adaptation slot', 1);
    await expectNoLayoutShifts(page, 'topbar counters and adaptation slot');
  });
});
