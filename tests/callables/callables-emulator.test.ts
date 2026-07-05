/**
 * Emulator-backed callable integration tests.
 *
 * Run with `npm run test:callables`. This script boots the Firestore and
 * Functions emulators; Firebase emulators require Java 21 locally per the
 * release validation notes. Auth context is supplied with Functions emulator
 * debug JWTs so this suite does not require firebase.json auth-emulator config.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { setBalanceDoc } from '../../src/game/balanceConfig';
import { dailyChallengeForDate } from '../../src/game/dailyChallenge';
import { Game } from '../../src/game/engine';
import { ALL_MAPS, DIFFICULTIES } from '../../src/game/maps';
import type { RunUploadBundle } from '../../src/game/runTelemetry';
import { replayActionHash } from '../../functions/src/replayIntegrity.ts';
import { replayTokenHash } from '../../functions/src/securityHelpers.ts';

const PROJECT_ID = 'neon-vector-defense-7';
const REGION = 'us-central1';
const ADMIN_EMAIL = '5329548871.eg@gmail.com';
const LIVE_BALANCE_DOC = { version: 'callables-live-1', towers: { pulse: { damageMult: 1 } } };

interface SubmitResult {
  accepted: boolean;
  reason?: string;
  claimed: { cash: number; kills: number; wave: number };
  accepted_values?: { cash: number; kills: number; wave: number };
}

interface FeedbackSubmitResult {
  accepted: boolean;
  reason?: string;
  id?: string;
  token?: string;
}

interface FeedbackRepliesResult {
  replies: Array<{
    id: string;
    ctx: string;
    ts: number;
    reply: string;
    replyTs: number;
    status: string;
  }>;
}

interface DeleteResult {
  ok: boolean;
  uid: string;
  deleted: {
    telemetry: number;
    runAnalytics: number;
    runCheckpoints: number;
    replayOwners: number;
    boardScores: number;
    feedback: number;
    runs: number;
    rateLimits: number;
    skippedRuns: number;
  };
  errors?: string[];
}

interface VerifyRunResult {
  runId: string;
  verdict: 'verified' | 'divergent' | 'unverifiable';
  reason?: string;
  rowsUpdated: number;
}

let testEnv: RulesTestEnvironment;
let sequence = 0;

function emulatorHost(envName: string, fallbackPort: number): { host: string; port: number } {
  const raw = (process.env[envName] ?? `127.0.0.1:${fallbackPort}`).replace(/^https?:\/\//, '');
  const [host, port] = raw.split(':');
  return { host: host || '127.0.0.1', port: Number(port || fallbackPort) };
}

function unique(suffix: string): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence.toString(36)}${suffix}`;
}

function runId(suffix: string): string {
  return `r_${unique(suffix)}`;
}

interface TestAuth {
  uid: string;
  idToken: string;
}

class CallableHttpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function callableUrl(name: string): string {
  const { host, port } = emulatorHost('FIREBASE_FUNCTIONS_EMULATOR_HOST', 5001);
  return `http://${host}:${port}/${PROJECT_ID}/${REGION}/${name}`;
}

function b64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fakeIdToken(uid: string, claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: 'anonymous' },
    ...claims,
  };
  return `${b64urlJson({ alg: 'none', typ: 'JWT' })}.${b64urlJson(payload)}.debug`;
}

function signedInUser(label: string, claims: Record<string, unknown> = {}): TestAuth {
  const uid = `w_${unique(label)}`.slice(0, 40);
  return { uid, idToken: fakeIdToken(uid, claims) };
}

function adminUser(): TestAuth {
  const uid = `admin${unique('u')}`.slice(0, 40);
  return {
    uid,
    idToken: fakeIdToken(uid, {
      email: ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    }),
  };
}

async function callCallable<T>(name: string, data: unknown, auth?: TestAuth): Promise<T> {
  const response = await fetch(callableUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth.idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await response.json() as { result?: T; error?: { status?: string; message?: string } };
  if (!response.ok || body.error) {
    throw new CallableHttpError(
      String(body.error?.status ?? response.status).toLowerCase().replace(/_/g, '-'),
      String(body.error?.message ?? response.statusText),
    );
  }
  return body.result as T;
}

async function withAdminDb<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    result = await fn(ctx.firestore() as unknown as Firestore);
  });
  return result as T;
}

async function adminDocData(path: string): Promise<Record<string, unknown> | null> {
  return withAdminDb(async (db) => {
    const snap = await getDoc(doc(db, path));
    return snap.exists() ? snap.data() : null;
  });
}

async function adminCollectionCount(path: string): Promise<number> {
  return withAdminDb(async (db) => (await getDocs(collection(db, path))).size);
}

const baseActions = { codec: 'r3', count: 1, towerIds: [], data: '0123' };

async function seedReplayRun(options: {
  runId: string;
  replayToken: string;
  map?: string;
  diff?: string;
  freeplay?: boolean;
  daily?: string;
  weekly?: string;
  gauntlet?: string;
  cashEarned?: number;
  kills?: number;
  wave?: number;
  actionMismatch?: boolean;
}): Promise<void> {
  const map = options.map ?? 'orbital';
  const diff = options.diff ?? 'easy';
  const cashEarned = options.cashEarned ?? 1200;
  const kills = options.kills ?? 40;
  const wave = options.wave ?? 5;
  const actionHash = options.actionMismatch ? '00000000' : replayActionHash(baseActions);
  await withAdminDb(async (db) => {
    await setDoc(doc(db, 'runs', options.runId), {
      schemaVersion: 3,
      runId: options.runId,
      replayTokenHash: replayTokenHash(options.replayToken),
      createdAt: 1_000,
      endedAt: 61_000,
      build: 'callables-emulator-test',
      chunkCount: 0,
      eventCount: baseActions.count,
      manifest: {
        chunkEventCounts: [],
        actionHash,
        complete: true,
      },
      summary: {
        callsign: 'CALL',
        wave,
        kills,
        credits: cashEarned,
        cashEarned,
        coresLeft: 20,
        durationS: 60,
        freeplay: options.freeplay ?? false,
        map,
        diff,
        outcome: 'victory',
        ...(options.daily ? { daily: options.daily } : {}),
        ...(options.weekly ? { weekly: options.weekly } : {}),
        ...(options.gauntlet ? { gauntlet: options.gauntlet } : {}),
      },
      setup: {
        map,
        mapName: 'Orbital Relay',
        mapHash: '1234abcd',
        diff,
        diffName: 'Recruit',
        seed: 1234,
        startingCash: 500,
        startingLives: 20,
        availableTowerIds: ['pulse'],
        balanceVersion: 'callables-emulator-test',
        replayEngine: 3,
      },
      actions: baseActions,
      final: {},
    });
  });
}

function scoreEntry(user: TestAuth, seeded: { runId: string; replayToken: string }, patch: Record<string, unknown> = {}) {
  return {
    name: 'CALL',
    cash: 1000,
    kills: 40,
    wave: 5,
    freeplay: false,
    ts: Date.now(),
    uid: user.uid,
    runId: seeded.runId,
    replayToken: seeded.replayToken,
    ...patch,
  };
}

function cloneBundle(bundle: RunUploadBundle): RunUploadBundle {
  return JSON.parse(JSON.stringify(bundle)) as RunUploadBundle;
}

function makeRealRunBundle(): RunUploadBundle {
  setBalanceDoc(LIVE_BALANCE_DOC);
  try {
    const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 4242, lifetimeKills: 1_000_000 });
    game.paused = false;
    game.speed = 4;
    game.startWave();
    for (let i = 0; i < 8_000 && game.phase !== 'gameover' && game.phase !== 'victory'; i += 1) {
      if (game.phase === 'build') game.startWave();
      game.update(0.05);
    }
    return game.buildRunUploadBundle('VERIFY', 'callables-emulator-test');
  } finally {
    setBalanceDoc(null);
  }
}

function makeRealDailyRunBundle(dateKey = '2026-06-01'): RunUploadBundle {
  const challenge = dailyChallengeForDate(dateKey);
  const map = ALL_MAPS.find((candidate) => candidate.id === challenge.mapId) ?? ALL_MAPS[0];
  const diff = DIFFICULTIES.find((candidate) => candidate.id === challenge.diffId) ?? DIFFICULTIES[1];
  setBalanceDoc(LIVE_BALANCE_DOC);
  try {
    const game = new Game(map, diff, { seed: 5252, lifetimeKills: 1_000_000 });
    game.paused = false;
    game.speed = 4;
    game.startDailyChallenge(challenge);
    game.startWave();
    for (let i = 0; i < 8_000 && game.phase !== 'gameover' && game.phase !== 'victory'; i += 1) {
      if (game.phase === 'build') game.startWave();
      game.update(0.05);
    }
    return game.buildRunUploadBundle('DAILYVERIFY', 'callables-emulator-test');
  } finally {
    setBalanceDoc(null);
  }
}

async function seedRunBundle(bundle: RunUploadBundle, rowId: string, options: { replayToken?: string; seedBoardRow?: boolean } = {}): Promise<void> {
  await withAdminDb(async (db) => {
    await setDoc(doc(db, 'config/balance'), LIVE_BALANCE_DOC);
    const runDoc = options.replayToken
      ? { ...bundle.run, replayTokenHash: replayTokenHash(options.replayToken) }
      : bundle.run;
    await setDoc(doc(db, 'runs', bundle.run.runId), runDoc);
    for (const chunk of bundle.chunks) {
      await setDoc(doc(db, 'runs', bundle.run.runId, 'chunks', `c${chunk.chunk}`), chunk);
    }
    if (options.seedBoardRow ?? true) {
      await setDoc(doc(db, 'boards/orbital_easy/scores', rowId), {
        name: 'VERIFY',
        cash: bundle.run.summary.cashEarned,
        kills: bundle.run.summary.kills,
        wave: bundle.run.summary.wave,
        freeplay: false,
        ts: Date.now(),
        uid: `w_${unique('verifyrow')}`.slice(0, 40),
        runId: bundle.run.runId,
      });
    }
  });
}

async function assertCallableError(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  await assert.rejects(
    fn,
    (error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
      return code === expectedCode || code === `functions/${expectedCode}`;
    },
  );
}

async function waitForRowVerify(path: string, verdict: VerifyRunResult['verdict'], attempts = 30): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < attempts; i += 1) {
    const row = await adminDocData(path);
    if (row?.verify === verdict) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return adminDocData(path);
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

describe('callable score submission', () => {
  test('submitScore accepts a manifest-backed replay and stores canonical score values', async () => {
    const user = signedInUser('scorehappy');
    const replayToken = `tok_${unique('score')}`;
    const seeded = { runId: runId('score'), replayToken };
    await seedReplayRun(seeded);

    const result = await callCallable<SubmitResult>('submitScore', {
      board: 'orbital_easy',
      entry: scoreEntry(user, seeded),
    }, user);

    assert.equal(result.accepted, true);
    assert.deepEqual(result.accepted_values, { cash: 1200, kills: 40, wave: 5 });

    const row = await adminDocData(`boards/orbital_easy/scores/${user.uid}_${seeded.runId}`);
    assert.equal(row?.uid, user.uid);
    assert.equal(row?.cash, 1200);
    assert.equal(row?.runId, seeded.runId);
  });

  test('submitDailyScore accepts a daily challenge replay and writes the daily board', async () => {
    const user = signedInUser('dailyhappy');
    const dailyId = `daily-${new Date().toISOString().slice(0, 10)}`;
    const replayToken = `tok_${unique('daily')}`;
    const seeded = { runId: runId('daily'), replayToken };
    await seedReplayRun({
      ...seeded,
      freeplay: false,
      daily: dailyId,
    });

    const result = await callCallable<SubmitResult>('submitDailyScore', {
      dailyId,
      entry: scoreEntry(user, seeded, { cash: 1200, freeplay: false, daily: dailyId }),
    }, user);

    assert.equal(result.accepted, true);
    assert.deepEqual(result.accepted_values, { cash: 1200, kills: 40, wave: 5 });

    const row = await adminDocData(`dailyBoards/${dailyId}/scores/${user.uid}_${seeded.runId}`);
    assert.equal(row?.daily, dailyId);
    assert.equal(row?.freeplay, false);
    assert.equal(row?.cash, 1200);
  });

  test('submitWeeklyScore accepts a weekly mutation replay and writes the weekly board', async () => {
    const user = signedInUser('weeklyhappy');
    const weeklyId = (() => {
      const d = new Date();
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `weekly-${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    })();
    const replayToken = `tok_${unique('weekly')}`;
    const seeded = { runId: runId('weekly'), replayToken };
    await seedReplayRun({
      ...seeded,
      freeplay: false,
      weekly: weeklyId,
    });

    const result = await callCallable<SubmitResult>('submitWeeklyScore', {
      weeklyId,
      entry: scoreEntry(user, seeded, { cash: 1200, freeplay: false, weekly: weeklyId }),
    }, user);

    assert.equal(result.accepted, true);
    assert.deepEqual(result.accepted_values, { cash: 1200, kills: 40, wave: 5 });

    const row = await adminDocData(`weeklyBoards/${weeklyId}/scores/${user.uid}_${seeded.runId}`);
    assert.equal(row?.weekly, weeklyId);
    assert.equal(row?.freeplay, false);
    assert.equal(row?.cash, 1200);
  });

  test('submitGauntletScore accepts a crowned gauntlet replay and writes the gauntlet board', async () => {
    const user = signedInUser('gauntlethappy');
    const week = (() => {
      const d = new Date();
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const isoWeek = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `weekly-${d.getUTCFullYear()}-W${String(isoWeek).padStart(2, '0')}`;
    })();
    const replayToken = `tok_${unique('gauntlet')}`;
    const seeded = { runId: runId('gauntlet'), replayToken };
    await seedReplayRun({
      ...seeded,
      freeplay: false,
      gauntlet: week,
    });
    await withAdminDb(async (db) => {
      await setDoc(doc(db, 'config/weeklyGauntlet'), {
        week,
        runId: 'r_championseed0001',
        callsign: 'ETHAN',
        map: 'orbital',
        diff: 'easy',
        seed: 1234,
        wave: 60,
        kills: 6000,
      });
    });

    const result = await callCallable<SubmitResult>('submitGauntletScore', {
      week,
      entry: scoreEntry(user, seeded, { cash: 1200, freeplay: false, gauntlet: week }),
    }, user);

    assert.equal(result.accepted, true);
    const row = await adminDocData(`gauntletBoards/${week}/scores/${user.uid}_${seeded.runId}`);
    assert.equal(row?.gauntlet, week);
    assert.equal(row?.freeplay, false);
  });

  test('submitScore rejects tampered replay manifests without writing a board row', async () => {
    const user = signedInUser('manifestmismatch');
    const replayToken = `tok_${unique('badmanifest')}`;
    const seeded = { runId: runId('badmanifest'), replayToken };
    await seedReplayRun({ ...seeded, actionMismatch: true });

    const result = await callCallable<SubmitResult>('submitScore', {
      board: 'orbital_easy',
      entry: scoreEntry(user, seeded),
    }, user);

    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'manifest-mismatch');
    assert.equal(await adminDocData(`boards/orbital_easy/scores/${user.uid}_${seeded.runId}`), null);
  });

  test('submitScore requires Firebase Auth', async () => {
    const replayToken = `tok_${unique('unauth')}`;
    const seeded = { runId: runId('unauth'), replayToken };

    await assertCallableError(
      () => callCallable('submitScore', {
        board: 'orbital_easy',
        entry: {
          ...scoreEntry({ uid: 'w_unauthenticated', idToken: '' }, seeded),
        },
      }),
      'unauthenticated',
    );
  });
});

describe('feedback callables', () => {
  test('submitFeedback returns a receipt token and fetchFeedbackReplies returns only matching replies', async () => {
    const user = signedInUser('feedbackroundtrip');
    const receipt = await callCallable<FeedbackSubmitResult>('submitFeedback', {
      uid: user.uid,
      text: 'The pause menu needs a contrast pass.',
      ctx: 'settings',
    }, user);

    assert.equal(receipt.accepted, true);
    assert.match(receipt.id ?? '', /^[A-Za-z0-9_-]{8,80}$/);
    assert.match(receipt.token ?? '', /^[A-Za-z0-9_-]{16,128}$/);

    await withAdminDb(async (db) => {
      await updateDoc(doc(db, `feedback/${receipt.id}`), {
        status: 'replied',
        reply: 'Acknowledged.',
        replyTs: 1234,
        repliedBy: 'admin',
      });
    });

    const wrongToken = await callCallable<FeedbackRepliesResult>('fetchFeedbackReplies', {
      receipts: [{ id: receipt.id, token: 'abcdefghijklmnop' }],
    });
    assert.deepEqual(wrongToken.replies, []);

    const replies = await callCallable<FeedbackRepliesResult>('fetchFeedbackReplies', {
      receipts: [{ id: receipt.id, token: receipt.token }],
    });

    assert.equal(replies.replies.length, 1);
    assert.equal(replies.replies[0].id, receipt.id);
    assert.equal(replies.replies[0].ctx, 'settings');
    assert.equal(replies.replies[0].reply, 'Acknowledged.');
    assert.equal(replies.replies[0].status, 'replied');
  });

  test('submitFeedback returns rate-limited after the per-user window is exhausted', async () => {
    const user = signedInUser('feedbackratelimit');
    const results: FeedbackSubmitResult[] = [];

    for (let i = 0; i < 9; i += 1) {
      results.push(await callCallable<FeedbackSubmitResult>('submitFeedback', {
        uid: user.uid,
        text: `rate limit sample ${i}`,
        ctx: 'rate-limit-test',
      }, user));
    }

    assert.equal(results.slice(0, 8).every((result) => result.accepted), true);
    assert.deepEqual(results[8], { accepted: false, reason: 'rate-limited' });
    assert.equal(await adminCollectionCount('feedback'), 8);
  });
});

describe('verifyRun callable', () => {
  test('admin can verify a real Game-generated replay and annotate board rows', async () => {
    const bundle = makeRealRunBundle();
    const rowId = `verify-${unique('ok')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.runId, bundle.run.runId);
    assert.equal(result.verdict, 'verified', result.reason ?? '');
    assert.equal(result.rowsUpdated, 1);

    const row = await adminDocData(`boards/orbital_easy/scores/${rowId}`);
    assert.equal(row?.verify, 'verified');
    assert.ok(row?.verifyTs);
    assert.equal(await adminDocData(`runVerificationReasons/${bundle.run.runId}`), null);
  });

  test('admin verifyRun records unverifiable reason docs for tampered action data', async () => {
    const bundle = cloneBundle(makeRealRunBundle());
    bundle.run.actions.data = `${bundle.run.actions.data}0`;
    const rowId = `verify-${unique('badaction')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.verdict, 'unverifiable');
    assert.match(result.reason ?? '', /action hash|manifest/i);
    assert.equal(result.rowsUpdated, 1);

    const row = await adminDocData(`boards/orbital_easy/scores/${rowId}`);
    assert.equal(row?.verify, 'unverifiable');

    const reason = await adminDocData(`runVerificationReasons/${bundle.run.runId}`);
    assert.equal(reason?.verdict, 'unverifiable');
    assert.match(String(reason?.reason ?? ''), /action hash|manifest/i);
  });

  test('admin verifyRun records divergent reason docs for tampered summaries', async () => {
    const bundle = cloneBundle(makeRealRunBundle());
    bundle.run.summary.kills += 1;
    const rowId = `verify-${unique('bad')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.verdict, 'divergent');
    assert.equal(result.rowsUpdated, 1);

    const row = await adminDocData(`boards/orbital_easy/scores/${rowId}`);
    assert.equal(row?.verify, 'divergent');

    const reason = await adminDocData(`runVerificationReasons/${bundle.run.runId}`);
    assert.equal(reason?.verdict, 'divergent');
    assert.equal(reason?.reason, 'summary.kills');
  });

  test('verifyRun rejects forged balance snapshots before re-simulation', async () => {
    const bundle = cloneBundle(makeRealRunBundle());
    bundle.run.setup.balance = { ...LIVE_BALANCE_DOC, towers: { pulse: { damageMult: 1.25 } } };
    const rowId = `verify-${unique('forgedbalance')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.verdict, 'unverifiable');
    assert.equal(result.reason, 'snapshot not authentic');
    const reason = await adminDocData(`runVerificationReasons/${bundle.run.runId}`);
    assert.equal(reason?.reason, 'snapshot not authentic');
  });

  test('verifyRun rejects forged daily snapshots before re-simulation', async () => {
    const bundle = cloneBundle(makeRealDailyRunBundle('2026-06-01'));
    assert.ok(bundle.run.setup.daily);
    bundle.run.setup.daily = { ...bundle.run.setup.daily, title: 'Forged Daily' };
    const rowId = `verify-${unique('forgeddaily')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.verdict, 'unverifiable');
    assert.equal(result.reason, 'snapshot not authentic');
    const reason = await adminDocData(`runVerificationReasons/${bundle.run.runId}`);
    assert.equal(reason?.reason, 'snapshot not authentic');
  });

  test('verifyRun rejects a daily snapshot smuggled onto a non-daily run', async () => {
    const bundle = cloneBundle(makeRealRunBundle());
    assert.equal(bundle.run.summary.daily ?? '', '');
    const donor = makeRealDailyRunBundle('2026-06-01');
    // setupReplayGame applies setup.daily whenever present; a campaign run must
    // never be allowed to re-simulate under smuggled daily rules/boons.
    bundle.run.setup.daily = donor.run.setup.daily;
    const rowId = `verify-${unique('smuggleddaily')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.verdict, 'unverifiable');
    assert.equal(result.reason, 'snapshot not authentic');
  });

  test('verifyRun requires snapshot presence to mirror the live balance doc', async () => {
    // Snapshot present while no live doc would exist is covered by symmetry:
    // here the run drops its snapshot while config/balance IS published.
    const bundle = cloneBundle(makeRealRunBundle());
    assert.ok(bundle.run.setup.balance);
    delete bundle.run.setup.balance;
    const rowId = `verify-${unique('droppedbalance')}`;
    await seedRunBundle(bundle, rowId);

    const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());

    assert.equal(result.verdict, 'unverifiable');
    assert.equal(result.reason, 'snapshot not authentic');
  });

  test('verifyRun verifies identity-balance runs when no live balance doc exists', async () => {
    // Prod runs with an unpublished config/balance record NO snapshot; the
    // authenticity gate must treat matching absence as authentic, not reject
    // every honest run (symmetry check, not unconditional presence).
    const game = new Game(ALL_MAPS[0], DIFFICULTIES[0], { seed: 777, lifetimeKills: 1_000_000 });
    game.paused = false;
    game.speed = 4;
    game.startWave();
    for (let i = 0; i < 8_000 && game.phase !== 'gameover' && game.phase !== 'victory'; i += 1) {
      if (game.phase === 'build') game.startWave();
      game.update(0.05);
    }
    const bundle = game.buildRunUploadBundle('IDENTITY', 'callables-emulator-test');
    assert.equal('balance' in bundle.run.setup, false);
    const rowId = `verify-${unique('identitybal')}`;
    await seedRunBundle(bundle, rowId);
    try {
      await withAdminDb(async (db) => { await deleteDoc(doc(db, 'config/balance')); });
      const result = await callCallable<VerifyRunResult>('verifyRun', { runId: bundle.run.runId }, adminUser());
      assert.equal(result.verdict, 'verified', result.reason ?? '');
    } finally {
      await withAdminDb(async (db) => { await setDoc(doc(db, 'config/balance'), LIVE_BALANCE_DOC); });
    }
  });

  test('post-accept verification marks an honest authenticated score as verified', async () => {
    const user = signedInUser('postacceptverify');
    const replayToken = `tok_${unique('postaccept')}`;
    const bundle = makeRealRunBundle();
    await seedRunBundle(bundle, `unused-${unique('postaccept')}`, { replayToken, seedBoardRow: false });

    const result = await callCallable<SubmitResult>('submitScore', {
      board: 'orbital_easy',
      entry: scoreEntry(user, { runId: bundle.run.runId, replayToken }, {
        cash: bundle.run.summary.cashEarned,
        kills: bundle.run.summary.kills,
        wave: bundle.run.summary.wave,
      }),
    }, user);

    assert.equal(result.accepted, true, result.reason ?? '');
    const rowPath = `boards/orbital_easy/scores/${user.uid}_${bundle.run.runId}`;
    const row = await waitForRowVerify(rowPath, 'verified');
    assert.equal(row?.verify, 'verified');
  });

  test('verifyRun is admin-only', async () => {
    await assertCallableError(
      () => callCallable('verifyRun', { runId: runId('verifydenied') }, signedInUser('verifydenied')),
      'permission-denied',
    );
  });
});

describe('deleteMyData callable', () => {
  test('deletes corroborated user data and reports uncorroborated owner rows as skippedRuns', async () => {
    const targetUid = `w_${unique('delete')}`.slice(0, 40);
    const goodRunId = runId('deletegood');
    const skippedRunId = runId('deleteskip');

    await seedReplayRun({ runId: goodRunId, replayToken: `tok_${unique('good')}` });
    await seedReplayRun({ runId: skippedRunId, replayToken: `tok_${unique('skip')}` });
    await withAdminDb(async (db) => {
      await setDoc(doc(db, 'boards/orbital_easy/scores/delete-row'), {
        name: 'DEL',
        cash: 100,
        kills: 2,
        wave: 3,
        freeplay: false,
        ts: 1,
        uid: targetUid,
        runId: goodRunId,
      });
      await setDoc(doc(db, `replayOwners/${targetUid}/runs/${goodRunId}`), {
        schemaVersion: 1,
        uid: targetUid,
        runId: goodRunId,
        createdAt: 1,
        build: 'callables-emulator-test',
      });
      await setDoc(doc(db, `replayOwners/${targetUid}/runs/${skippedRunId}`), {
        schemaVersion: 1,
        uid: targetUid,
        runId: skippedRunId,
        createdAt: 1,
        build: 'callables-emulator-test',
      });
      await setDoc(doc(db, 'telemetry/delete-row'), { uid: targetUid, ts: 1, kind: 'final' });
      await setDoc(doc(db, 'feedback/delete-row'), {
        uid: targetUid,
        text: 'delete me',
        ts: 1,
        ctx: 'privacy',
        status: 'open',
        replyTokenHash: 'a'.repeat(64),
      });
      await setDoc(doc(db, `runAnalytics/${goodRunId}`), { uid: targetUid });
      await setDoc(doc(db, `rateLimits/${targetUid}`), { windowStart: 1, count: 1 });
      await setDoc(doc(db, `rateLimits/feedback_${targetUid}`), { windowStart: 1, count: 1 });
    });

    const result = await callCallable<DeleteResult>('deleteMyData', { uid: targetUid }, adminUser());

    assert.equal(result.ok, true);
    assert.equal(result.uid, targetUid);
    assert.equal(result.errors, undefined);
    assert.equal(result.deleted.telemetry, 1);
    assert.equal(result.deleted.runAnalytics, 1);
    assert.equal(result.deleted.replayOwners, 2);
    assert.equal(result.deleted.boardScores, 1);
    assert.equal(result.deleted.feedback, 1);
    assert.equal(result.deleted.runs, 1);
    assert.equal(result.deleted.rateLimits, 2);
    assert.equal(result.deleted.skippedRuns, 1);

    assert.equal(await adminDocData(`runs/${goodRunId}`), null);
    assert.notEqual(await adminDocData(`runs/${skippedRunId}`), null);
    assert.equal(await adminDocData(`replayOwners/${targetUid}/runs/${goodRunId}`), null);
    assert.equal(await adminDocData(`replayOwners/${targetUid}/runs/${skippedRunId}`), null);
    assert.equal(await adminDocData('boards/orbital_easy/scores/delete-row'), null);
  });
});
