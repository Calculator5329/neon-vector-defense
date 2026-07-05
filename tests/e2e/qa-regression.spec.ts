import { expect, test, type Page, type Route } from '@playwright/test';

const E2E_ANON_UID = 'e2e_anon_uid_1';

const adultConsent = { ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 };
const progressSeed = {
  archive: [],
  best: {},
  totalWaves: 0,
  runs: 1,
  victories: 1,
  kills: 1_000_000,
  blueprints: {},
  history: [],
  playerName: 'QA WARDEN',
  clearedMaps: ['orbital'],
  tut: true,
  cloakTip: true,
  apexW: true,
  foes: ['scout'],
  foesAck: 0,
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
  let body: string;
  try {
    body = patch(source);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    await route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: message,
    });
    return;
  }
  await route.fulfill({
    status: response.status(),
    contentType: response.headers()['content-type'] ?? 'text/javascript',
    body,
  });
}

async function installQaNetwork(page: Page) {
  await page.route('**/src/game/balanceConfig.ts', (route) => fulfillPatched(
    route,
    replacementFor('loadRemoteBalance', `{
  return;
}`),
  ));
  await page.route('**/src/game/dailyChallenge.ts', (route) => fulfillPatched(
    route,
    replacementFor('loadRemoteDailyOverride', `{
  return;
}`),
  ));
  await page.route('**/src/game/weeklyChallenge.ts', (route) => fulfillPatched(route, (source) => {
    let patched = source;
    patched = replacementFor('loadRemoteWeeklyOverride', `{
  return;
}`)(patched);
    patched = replacementFor('loadRemoteWeeklyGauntlet', `{
  return {
    week: 'weekly-2026-W27',
    runId: 'r_e2e_gauntlet_0001',
    callsign: 'ETHAN',
    map: 'orbital',
    diff: 'normal',
    seed: 12345,
    wave: 60,
    kills: 6000,
  };
}`)(patched);
    return patched;
  }));
  await page.route('**/src/game/replaySpotlight.ts', (route) => fulfillPatched(
    route,
    replacementFor('fetchReplayOfTheDay', `{
  const raw = sessionStorage.getItem('nvd-e2e-spotlight');
  return raw ? JSON.parse(raw) : null;
}`),
  ));
  await page.route('**/src/game/leaderboard.ts', (route) => fulfillPatched(route, (source) => {
    let patched = source;
    patched = replacementFor('submitRunReplay', `{
  const codec = await import('./replayCodec');
  const doc = {
    ...bundle.run,
    chunks: bundle.chunks,
    events: codec.decodeReplayActionBundle(bundle.run.actions, bundle.chunks),
    snapshots: [],
    integrity: 'complete',
  };
  sessionStorage.setItem('nvd-e2e-public-run', JSON.stringify({ run: bundle.run, chunks: bundle.chunks }));
  sessionStorage.setItem('nvd-e2e-replay-doc', JSON.stringify(doc));
  return { ok: true, runId: bundle.run.runId, replayToken: 'e2e_replay_token_0001' };
}`)(patched);
    patched = replacementFor('fetchRunReplay', `{
  const raw = sessionStorage.getItem('nvd-e2e-replay-doc');
  if (!raw) return null;
  const doc = JSON.parse(raw);
  return doc.runId === runId ? doc : null;
}`)(patched);
    patched = replacementFor('submitScore', `{
  return true;
}`)(patched);
    patched = replacementFor('submitDailyScore', `{
  return true;
}`)(patched);
    patched = replacementFor('submitWeeklyScore', `{
  return true;
}`)(patched);
    patched = replacementFor('submitGauntletScore', `{
  return true;
}`)(patched);
    patched = replacementFor('fetchTop', `{
  const raw = sessionStorage.getItem('nvd-e2e-public-run');
  const summary = raw ? JSON.parse(raw).run.summary : null;
  return [{
    name: summary?.callsign ?? 'QA WARDEN',
    cash: summary?.cashEarned ?? 0,
    kills: summary?.kills ?? 0,
    wave: summary?.wave ?? 0,
    freeplay: !!summary?.freeplay,
    ts: Date.now(),
    uid: 'e2e_anon_uid_1',
    runId: summary ? JSON.parse(raw).run.runId : '',
  }];
}`)(patched);
    patched = replacementFor('fetchDailyTop', `{
  return fetchTop(dailyId, limit);
}`)(patched);
    patched = replacementFor('fetchWeeklyTop', `{
  return fetchTop(weeklyId, limit);
}`)(patched);
    patched = replacementFor('fetchGauntletTop', `{
  return fetchTop(week, limit);
}`)(patched);
    patched = replacementFor('submitRunAnalytics', `{
  return true;
}`)(patched);
    patched = replacementFor('submitRunCheckpoint', `{
  return true;
}`)(patched);
    patched = replacementFor('streamRunReplayChunk', `{
  return true;
}`)(patched);
    patched = replacementFor('logTelemetry', `{
  return;
}`)(patched);
    return patched;
  }));
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

async function seedLocalState(page: Page) {
  const install = (seed: { progress: typeof progressSeed; meta: typeof metaSeed; consent: typeof adultConsent }) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('nvd-')) localStorage.removeItem(key);
    }
    localStorage.setItem('nvd-progress-v1', JSON.stringify(seed.progress));
    localStorage.setItem('nvd-meta-v2', JSON.stringify(seed.meta));
    localStorage.setItem('nvd-consent-v1', JSON.stringify(seed.consent));
  };
  const seed = { progress: progressSeed, meta: metaSeed, consent: adultConsent };
  await page.addInitScript(install, seed);
  await page.evaluate(install, seed).catch(() => {});
}

async function prepareViewport(page: Page, projectName: string) {
  if (projectName.includes('mobile')) {
    await page.setViewportSize({ width: 844, height: 390 });
  }
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow.x).toBeLessThanOrEqual(2);
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

async function finishAsVictory(page: Page) {
  await page.evaluate(() => {
    const game = (window as unknown as { game: any }).game;
    game.paused = false;
    game.credits = Math.max(game.credits, 10_000);
  });
  await page.getByTestId('tower-pulse').click();
  const point = await validCanvasPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { game: any }).game.towers.length)).toBe(1);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('target-filter-armored')).toBeVisible();
  await page.getByTestId('target-filter-armored').click();
  await expect(page.getByTestId('target-filter-armored')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('launch-wave').click();
  await page.evaluate(() => {
    const game = (window as unknown as { game: any }).game;
    for (let i = 0; i < 90; i++) game.update(0.05);
    game.phase = 'victory';
    game.wave = game.diff.waves;
    game.lives = Math.max(1, game.lives);
    game.totalKills = Math.max(game.totalKills, 42);
    game.runStats.cashEarned = Math.max(game.runStats.cashEarned, 4200);
    game.runStats.dmg = { pulse: 2400 };
    game.runStats.kills = { scout: 42 };
    game.runStats.leaks = 0;
    game.runStats.abilitiesCast = 0;
    game.finishRun(true, 'victory');
  });
  await expect(page.getByRole('heading', { name: 'SECTOR SECURED' })).toBeVisible();
}

async function finishAsDefeat(page: Page) {
  await page.evaluate(() => {
    const game = (window as unknown as { game: any }).game;
    game.paused = false;
    game.phase = 'gameover';
    game.queue = [];
    game.enemies = [];
    game.wave = 7;
    game.lives = 0;
    game.totalKills = Math.max(game.totalKills, 12);
    game.runStats.cashEarned = Math.max(game.runStats.cashEarned, 760);
    game.runStats.dmg = { pulse: 1800 };
    game.runStats.kills = { scout: 12 };
    game.runStats.leaks = 8;
    game.runStats.abilitiesCast = 0;
    game.finishRun(false, 'gameover');
  });
  await expect(page.getByRole('heading', { name: 'GRID OFFLINE' })).toBeVisible();
}

test.describe('QA regression real-flow audit', () => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', 'Runs against the dev-server harness with module-level network seams');

  test.beforeEach(async ({ page }, testInfo) => {
    await prepareViewport(page, testInfo.project.name);
    await installQaNetwork(page);
    await mockAnonAuth(page);
    await seedLocalState(page);
  });

  test('submits a real v5 run bundle and opens the frame-accurate replay viewer', async ({ page }) => {
    test.setTimeout(60_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const firestoreRequests: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/firestore.googleapis.com/**', async (route) => {
      firestoreRequests.push(route.request().url());
      await route.abort();
    });

    await page.goto('/');
    await page.waitForTimeout(500);
    expect(pageErrors).toEqual([]);
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await assertNoOverflow(page);
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('briefing-overlay')).toBeVisible();
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await finishAsVictory(page);

    const preview = page.locator('.submit-score-preview');
    await expect(preview).toContainText('Credits');
    await expect(preview).toContainText('Kills');
    await page.getByLabel('Leaderboard callsign').fill('QA REALFLOW');
    await page.getByRole('button', { name: 'SUBMIT' }).click();
    await expect(page.getByText('Score uploaded. Current board snapshot:')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.lb-row.me')).toContainText('QA REALFLOW');

    const payload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nvd-e2e-public-run') ?? 'null'));
    expect(payload?.run?.schemaVersion).toBe(3);
    expect(payload.run.setup.replayEngine).toBe(5);
    expect(payload.run.setup.mapHash).toMatch(/^[0-9a-f]{8}$/);
    expect(payload.run.actions.codec).toBe('r3');
    const actionTypes = payload.chunks
      ? await page.evaluate(async () => {
        const codecPath = '/src/game/replayCodec.ts';
        const codec = await import(/* @vite-ignore */ codecPath);
        const payload = JSON.parse(sessionStorage.getItem('nvd-e2e-public-run') ?? 'null');
        return codec.decodeReplayActionBundle(payload.run.actions, payload.chunks).map((event: { type: string }) => event.type);
      })
      : [];
    expect(actionTypes).toContain('target_filter');
    expect(payload.run.manifest.complete).toBe(true);
    expect(payload.run.manifest.actionHash).toMatch(/^[0-9a-f]{8}$/);
    expect(payload.run).not.toHaveProperty('events');
    expect(payload.run).not.toHaveProperty('snapshots');
    expect(payload.run).not.toHaveProperty('deathRecords');
    expect(JSON.stringify(payload)).not.toContain('undefined');

    const runId = payload.run.runId as string;
    await page.goto(`/?run=${runId}`);
    await expect(page.getByTestId('replay-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Frame-accurate replay of the recorded run.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('1x speed')).toBeVisible();
    await page.getByLabel('2x speed').click();
    await expect(page.getByLabel('2x speed')).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('4x speed').click();
    await expect(page.getByLabel('4x speed')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('replay-play').click();
    await expect(page.getByTestId('replay-play')).toContainText('PLAY');

    const slider = page.getByRole('slider', { name: /Replay timeline/ });
    // Regression: the scrub domain must span the WHOLE run. v3 docs carry no
    // snapshots, and deriving the domain from the legacy synthetic keyframe
    // collapsed every replay to a ~1s window pinned at the end ("replays are
    // 2 seconds and show just the last 2 seconds").
    const durationS = payload.run.summary.durationS as number;
    expect(durationS).toBeGreaterThan(3); // keep this guard non-vacuous
    const valueMax = Number(await slider.getAttribute('aria-valuemax'));
    expect(valueMax).toBeGreaterThanOrEqual(Math.floor(durationS) - 2);
    expect(valueMax).toBeLessThanOrEqual(Math.ceil(durationS) + 2);
    await slider.focus();
    await page.keyboard.press('Home');
    await page.waitForTimeout(150);
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(1);
    await page.keyboard.press('End');
    await page.waitForTimeout(250);
    const endHudA = await page.locator('.replay-hud').textContent();
    const endValueA = await slider.getAttribute('aria-valuenow');
    await page.keyboard.press('Home');
    await page.waitForTimeout(250);
    await page.keyboard.press('End');
    await page.waitForTimeout(250);
    const endHudB = await page.locator('.replay-hud').textContent();
    const endValueB = await slider.getAttribute('aria-valuenow');
    expect(endHudB).toBe(endHudA);
    expect(endValueB).toBe(endValueA);

    expect(firestoreRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('debrief retry and menu actions recover from terminal runs', async ({ page }) => {
    test.setTimeout(45_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('briefing-overlay')).toBeVisible();
    await page.getByRole('button', { name: /ACKNOWLEDGE/ }).click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await finishAsDefeat(page);
    await assertNoOverflow(page);

    await page.getByRole('button', { name: /RETRY SECTOR/ }).click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'GRID OFFLINE' })).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const game = (window as unknown as { game: any }).game;
      return { phase: game.phase, wave: game.wave, lives: game.lives };
    })).toMatchObject({ phase: 'build', wave: 0 });

    await finishAsDefeat(page);
    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await assertNoOverflow(page);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('Replay-of-the-Day handles a dead pinned replay without blanking the menu', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('nvd-e2e-spotlight', JSON.stringify({
        runId: 'r_deadv2replay0001',
        callsign: 'LEGACY',
        wave: 50,
        mapName: 'Retired Sector',
        diffName: 'Retired Protocol',
        freeplay: false,
      }));
    });
    await page.reload();
    await page.waitForTimeout(500);
    expect(pageErrors).toEqual([]);
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.replay-of-day-card')).toBeVisible();
    await expect(page.locator('.replay-of-day-card')).toContainText('LEGACY');
    await page.locator('.replay-of-day-watch').click();
    await expect(page.getByTestId('replay-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('REPLAY UNAVAILABLE')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'RETURN TO THE GRID' }).click();
    await expect(page.getByTestId('deploy-button')).toBeVisible({ timeout: 15_000 });
    await assertNoOverflow(page);
  });

  test('submits a weekly mutation run through mocked callables', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await expect(page.getByTestId('weekly-mutation-card')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('weekly-mutation-card').click();
    await page.getByTestId('deploy-button').click();
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await finishAsDefeat(page);
    await page.getByLabel('Leaderboard callsign').fill('QA WEEKLY');
    await page.getByRole('button', { name: 'SUBMIT' }).click();
    await expect(page.getByText('Score uploaded. Current board snapshot:')).toBeVisible({ timeout: 15_000 });

    const payload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nvd-e2e-public-run') ?? 'null'));
    expect(payload.run.summary.weekly).toMatch(/^weekly-\d{4}-W\d{2}$/);
    expect(payload.run.setup.weekly.id).toBe(payload.run.summary.weekly);
    expect(payload.run.summary.daily).toBeUndefined();
  });
});
