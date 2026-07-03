import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
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
  writeBatch,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const runId = 'r_rulesTest123';
const adminToken = { email: '5329548871.eg@gmail.com', email_verified: true };
const validSummary = {
  callsign: 'RULES',
  map: 'orbital',
  mapName: 'Orbital Relay',
  diff: 'easy',
  diffName: 'Recruit',
  freeplay: false,
  outcome: 'abandoned',
  phase: 'gameover',
  wave: 1,
  kills: 1,
  credits: 1,
  cashEarned: 1,
  leaks: 0,
  coresLeft: 99,
  durationS: 10,
};
const validActions = { codec: 'r3', count: 1, towerIds: ['pulse'], data: '1234' };
const validSetup = {
  map: 'orbital',
  mapName: 'Orbital Relay',
  mapHash: '1234abcd',
  diff: 'easy',
  diffName: 'Recruit',
  seed: 1234,
  startingCash: 500,
  startingLives: 20,
  availableTowerIds: ['pulse'],
  balanceVersion: 'test',
  replayEngine: 2,
};

const validRun = {
  schemaVersion: 3,
  runId,
  replayTokenHash: 'a'.repeat(64),
  createdAt: 1,
  endedAt: 2,
  build: 'test',
  chunkCount: 0,
  eventCount: 1,
  manifest: {
    chunkEventCounts: [],
    actionHash: '1234abcd',
    complete: true,
  },
  summary: validSummary,
  setup: validSetup,
  actions: validActions,
  final: {},
};

function validAnalytics(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    runId,
    uid: playerUid,
    createdAt: 1,
    endedAt: 2,
    build: 'test',
    summary: validSummary,
    onboarding: {},
    abandonment: {},
    difficulty: {},
    economy: {},
    menu: {},
    controls: {},
    combat: {},
    placement: {},
    assistance: {},
    freeplay: {},
    towerInterest: {},
    progression: {},
    leaderboard: {},
    attention: {},
    performance: {},
    ...overrides,
  };
}

function validReplayStreamParent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    uid: playerUid,
    runId,
    build: 'test',
    updatedAt: 1,
    expiresAt: new Date(4102444800000), // TTL Timestamp field
    ...overrides,
  };
}

function validReplayStreamChunk(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    uid: playerUid,
    runId,
    chunk: 0,
    actions: validActions,
    createdAt: 1,
    build: 'test',
    expiresAt: new Date(4102444800000), // TTL Timestamp field
    ...overrides,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'neon-vector-defense-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const playerUid = 'w_rules1';

function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

/** Signed-in anonymous player — the normal client write identity. */
function playerDb(uid = playerUid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function adminDb() {
  return testEnv.authenticatedContext('admin', adminToken).firestore();
}

describe('public replay rules', () => {
  test('allow signed-in create and public get, but deny updates', async () => {
    const db = playerDb();
    const ref = doc(db, 'runs', runId);
    await assertSucceeds(setDoc(ref, validRun));
    await assertSucceeds(getDoc(doc(anonDb(), 'runs', runId)));
    await assertFails(updateDoc(ref, { eventCount: 2 }));
  });

  test('deny unauthenticated replay and chunk creates', async () => {
    const db = anonDb();
    await assertFails(setDoc(doc(db, 'runs', runId), validRun));
    await assertFails(setDoc(doc(db, 'runs', runId, 'chunks', 'c0'), { schemaVersion: 3, runId, chunk: 0, actions: validActions }));
  });

  test('deny malformed public replay docs', async () => {
    const db = playerDb();
    const malformed = { ...validRun };
    delete (malformed as Partial<typeof validRun>).final;
    await assertFails(setDoc(doc(db, 'runs', runId), malformed));
  });

  test('deny public replay docs with malformed nested summaries', async () => {
    const db = playerDb();
    await assertFails(setDoc(doc(db, 'runs', runId), {
      ...validRun,
      summary: { ...validSummary, wave: '1' },
    }));
  });

  test('require replay manifests and reject malformed manifests', async () => {
    const db = playerDb();
    const missingManifest = { ...validRun, runId: `${runId}a` };
    delete (missingManifest as Partial<typeof validRun>).manifest;
    await assertFails(setDoc(doc(db, 'runs', `${runId}a`), missingManifest));
    await assertFails(setDoc(doc(db, 'runs', `${runId}b`), {
      ...validRun,
      runId: `${runId}b`,
      manifest: { chunkEventCounts: [], actionHash: 'bad', complete: true },
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}c`), {
      ...validRun,
      runId: `${runId}c`,
      chunkCount: 1,
      manifest: { chunkEventCounts: [], actionHash: '1234abcd', complete: true },
    }));
  });

  test('reject v2 public replay fields and hashes', async () => {
    const db = playerDb();
    await assertFails(setDoc(doc(db, 'runs', `${runId}legacy`), {
      ...validRun,
      runId: `${runId}legacy`,
      events: [{ type: 'run_start', t: 0 }],
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}snapshot`), {
      ...validRun,
      runId: `${runId}snapshot`,
      snapshots: [],
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}death`), {
      ...validRun,
      runId: `${runId}death`,
      deathRecords: { codec: 'd1', count: 0, waves: [] },
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}hash`), {
      ...validRun,
      runId: `${runId}hash`,
      manifest: { ...validRun.manifest, deathHash: 'abcd1234' },
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}eventhash`), {
      ...validRun,
      runId: `${runId}eventhash`,
      manifest: { ...validRun.manifest, eventHash: '1234abcd' },
    }));
  });

  test('deny retired protocol and outcome values in replay summaries', async () => {
    const db = playerDb();
    const retiredDiff = 'ng' + 'plus';
    const retiredOutcome = 'armi' + 'stice';
    await assertFails(setDoc(doc(db, 'runs', `${runId}d`), {
      ...validRun,
      runId: `${runId}d`,
      summary: { ...validSummary, diff: retiredDiff },
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}e`), {
      ...validRun,
      runId: `${runId}e`,
      summary: { ...validSummary, outcome: retiredOutcome },
    }));
  });

  test('allow deep-freeplay runs whose compounded score multiplier exceeds 100', async () => {
    // regression: scoreMultiplierEnd compounds across waves/risks/relics and used to be
    // capped at 100, which rejected the whole replay and blocked the score submission.
    const db = playerDb();
    await assertSucceeds(setDoc(doc(db, 'runs', runId), {
      ...validRun,
      summary: { ...validSummary, freeplay: true, scoreMultiplierEnd: 873.45 },
    }));
  });

  test('still reject an absurd (garbage) score multiplier', async () => {
    const db = playerDb();
    await assertFails(setDoc(doc(db, 'runs', runId), {
      ...validRun,
      summary: { ...validSummary, freeplay: true, scoreMultiplierEnd: 5000000000 },
    }));
  });

  test('allow daily challenge replay summaries without freeplay or multiplier', async () => {
    const db = playerDb();
    await assertSucceeds(setDoc(doc(db, 'runs', runId), {
      ...validRun,
      summary: { ...validSummary, freeplay: false, daily: 'daily-2026-07-01' },
    }));
    await assertFails(setDoc(doc(db, 'runs', `${runId}dailybad`), {
      ...validRun,
      runId: `${runId}dailybad`,
      summary: { ...validSummary, freeplay: false, daily: 'daily-2026-07-01', scoreMultiplierEnd: 2 },
    }));
  });

  test('allow replay chunk create and deny chunk updates', async () => {
    const db = playerDb();
    const ref = doc(db, 'runs', runId, 'chunks', 'c0');
    await assertSucceeds(setDoc(ref, { schemaVersion: 3, runId, chunk: 0, actions: validActions }));
    await assertFails(updateDoc(ref, { chunk: 1 }));
    await assertFails(setDoc(doc(db, 'runs', runId, 'chunks', 'c1'), { schemaVersion: 3, runId, chunk: 1, events: [] }));
  });

  test('allow replay action packs up to the client and function validation cap', async () => {
    const db = playerDb();
    const largeActions = { ...validActions, data: '1'.repeat(50_000) };
    await assertSucceeds(setDoc(doc(db, 'runs', runId), {
      ...validRun,
      actions: largeActions,
    }));
    await assertSucceeds(setDoc(doc(db, 'runs', runId, 'chunks', 'c0'), {
      schemaVersion: 3,
      runId,
      chunk: 0,
      actions: largeActions,
    }));
  });

  test('reject replay action packs above the upload cap', async () => {
    const db = playerDb();
    await assertFails(setDoc(doc(db, 'runs', `${runId}huge`), {
      ...validRun,
      runId: `${runId}huge`,
      actions: { ...validActions, data: '1'.repeat(200_001) },
    }));
  });

  test('allow private replay owner index creates and deny public reads or updates', async () => {
    const db = playerDb();
    const ref = doc(db, 'replayOwners', playerUid, 'runs', runId);
    await assertSucceeds(setDoc(ref, {
      schemaVersion: 1,
      uid: playerUid,
      runId,
      createdAt: 1,
      build: 'test',
    }));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDoc(doc(adminDb(), 'replayOwners', playerUid, 'runs', runId)));
    await assertFails(updateDoc(ref, { build: 'changed' }));
  });

  test('deny replay owner entries planted under another uid', async () => {
    // the grief-deletion vector: player A must not be able to register
    // ownership rows under player B's uid to poison operator-run deletion.
    const victimUid = 'w_victim9';
    await assertFails(setDoc(doc(playerDb(), 'replayOwners', victimUid, 'runs', runId), {
      schemaVersion: 1,
      uid: victimUid,
      runId,
      createdAt: 1,
      build: 'test',
    }));
    await assertFails(setDoc(doc(anonDb(), 'replayOwners', victimUid, 'runs', runId), {
      schemaVersion: 1,
      uid: victimUid,
      runId,
      createdAt: 1,
      build: 'test',
    }));
  });

  test('deny malformed replay owner index docs', async () => {
    const db = playerDb();
    await assertFails(setDoc(doc(db, 'replayOwners', playerUid, 'runs', runId), {
      schemaVersion: 1,
      uid: 'other_uid',
      runId,
      createdAt: 1,
      build: 'test',
    }));
  });

  test('allow uid-bound live replay stream parent upserts and keep reads admin-only', async () => {
    const db = playerDb();
    const ref = doc(db, 'replayStreams', playerUid, 'runs', runId);
    await assertSucceeds(setDoc(ref, validReplayStreamParent()));
    await assertSucceeds(updateDoc(ref, { updatedAt: 2 }));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDoc(doc(adminDb(), 'replayStreams', playerUid, 'runs', runId)));
    await assertFails(setDoc(doc(db, 'replayStreams', 'w_victim9', 'runs', runId), validReplayStreamParent({
      uid: 'w_victim9',
    })));
  });

  test('allow live replay stream chunk creates and deny mutation or malformed actions', async () => {
    const db = playerDb();
    const ref = doc(db, 'replayStreams', playerUid, 'runs', runId, 'chunks', 'c0');
    await assertSucceeds(setDoc(ref, validReplayStreamChunk()));
    await assertFails(updateDoc(ref, { chunk: 1 }));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDoc(doc(adminDb(), 'replayStreams', playerUid, 'runs', runId, 'chunks', 'c0')));
    await assertFails(setDoc(doc(db, 'replayStreams', playerUid, 'runs', runId, 'chunks', 'c1'), validReplayStreamChunk({
      chunk: 1,
      actions: { ...validActions, codec: 'r2' },
    })));
    await assertFails(setDoc(doc(db, 'replayStreams', 'w_victim9', 'runs', runId, 'chunks', 'c0'), validReplayStreamChunk({
      uid: 'w_victim9',
    })));
  });

  test('allow final replay submit batch shape', async () => {
    const db = playerDb();
    const finalRunId = `${runId}batch`;
    const finalRun = {
      ...validRun,
      runId: finalRunId,
      summary: { ...validSummary },
    };
    const batch = writeBatch(db);
    batch.set(doc(db, 'replayOwners', playerUid, 'runs', finalRunId), {
      schemaVersion: 1,
      uid: playerUid,
      runId: finalRunId,
      createdAt: finalRun.createdAt,
      build: finalRun.build,
    });
    batch.set(doc(db, 'replayStreams', playerUid, 'runs', finalRunId), {
      schemaVersion: 1,
      uid: playerUid,
      runId: finalRunId,
      build: finalRun.build,
      updatedAt: 2,
      submitted: true,
      sealedAt: 2,
      chunkCount: finalRun.chunkCount,
      eventCount: finalRun.eventCount,
      manifest: finalRun.manifest,
      summary: finalRun.summary,
    }, { merge: true });
    batch.set(doc(db, 'runs', finalRunId), finalRun);
    await assertSucceeds(batch.commit());
  });
});

describe('leaderboard and telemetry write rules', () => {
  test('deny direct board and daily-board writes', async () => {
    const db = anonDb();
    const score = { name: 'TEST', cash: 1, kills: 1, wave: 1, freeplay: false, ts: 1, uid: 'w_rules1', runId };
    await assertFails(setDoc(doc(db, 'boards', 'orbital_easy', 'scores', 's1'), score));
    await assertFails(setDoc(doc(db, 'dailyBoards', 'daily-2026-06-27', 'scores', 's1'), { ...score, freeplay: true }));
  });

  test('allow bounded telemetry creates and deny updates', async () => {
    const db = playerDb();
    const ref = doc(db, 'telemetry', 't1');
    await assertSucceeds(setDoc(ref, {
      uid: playerUid,
      ts: 1,
      kind: 'final',
      map: 'orbital',
      diff: 'easy',
      wave: 1,
      kills: 1,
      cash: 1,
      won: false,
      freeplay: false,
      durationS: 10,
      expiresAt: new Date(4102444800000), // TTL Timestamp field
    }));
    await assertFails(updateDoc(ref, { wave: 2 }));
  });

  test('deny telemetry writes that are unauthenticated or spoof another uid', async () => {
    const row = {
      uid: playerUid,
      ts: 1,
      kind: 'final',
      map: 'orbital',
      diff: 'easy',
      wave: 1,
      kills: 1,
      cash: 1,
      won: false,
      freeplay: false,
      durationS: 10,
    };
    await assertFails(setDoc(doc(anonDb(), 'telemetry', 't1'), row));
    await assertFails(setDoc(doc(playerDb(), 'telemetry', 't2'), { ...row, uid: 'w_victim9' }));
  });

  test('deny telemetry writes for retired protocol ids', async () => {
    const retiredDiff = 'ng' + 'plus';
    await assertFails(setDoc(doc(playerDb(), 'telemetry', 't_retired'), {
      uid: playerUid,
      ts: 1,
      kind: 'final',
      map: 'orbital',
      diff: retiredDiff,
      wave: 1,
      kills: 1,
      cash: 1,
      won: false,
      freeplay: false,
      durationS: 10,
    }));
  });

  test('allow private run analytics create and deny public updates', async () => {
    const db = playerDb();
    const ref = doc(db, 'runAnalytics', runId);
    await assertSucceeds(setDoc(ref, validAnalytics()));
    await assertFails(updateDoc(ref, { endedAt: 3 }));
  });

  test('deny legacy v1 private run analytics creates', async () => {
    const db = playerDb();
    const {
      menu,
      controls,
      combat,
      placement,
      assistance,
      freeplay,
      ...legacyAnalytics
    } = validAnalytics({ schemaVersion: 1 });
    void menu; void controls; void combat; void placement; void assistance; void freeplay;
    await assertFails(setDoc(doc(db, 'runAnalytics', runId), legacyAnalytics));
  });

  test('allow checkpoint chunk creates and keep reads admin-only', async () => {
    const db = playerDb();
    const ref = doc(db, 'runCheckpoints', runId, 'chunks', 'c0');
    await assertSucceeds(setDoc(ref, {
      schemaVersion: 3,
      runId,
      uid: playerUid,
      chunk: 0,
      reason: 'interval',
      createdAt: 1,
      build: 'test',
      summary: validSummary,
      performance: {},
      attention: {},
      counters: {},
      recentEvents: [],
      latestSnapshot: null,
      expiresAt: new Date(4102444800000), // TTL Timestamp field
    }));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDoc(doc(adminDb(), 'runCheckpoints', runId, 'chunks', 'c0')));
  });

  test('deny analytics and checkpoint writes that spoof another uid', async () => {
    const db = playerDb();
    await assertFails(setDoc(doc(db, 'runAnalytics', runId), validAnalytics({ uid: 'w_victim9' })));
    await assertFails(setDoc(doc(db, 'runCheckpoints', runId, 'chunks', 'c0'), {
      schemaVersion: 3,
      runId,
      uid: 'w_victim9',
      chunk: 0,
      reason: 'interval',
      createdAt: 1,
      build: 'test',
      summary: validSummary,
      performance: {},
      attention: {},
      counters: {},
      recentEvents: [],
      latestSnapshot: null,
    }));
  });
});

describe('feedback and config rules', () => {
  test('deny public feedback create/list/read and keep admin moderation working', async () => {
    const db = anonDb();
    const ref = doc(db, 'feedback', 'f1');
    await assertFails(setDoc(ref, { uid: 'w_rules1', text: 'hello', ts: 1, ctx: 'menu', status: 'open', replyTokenHash: 'abc' }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'feedback', 'f1'), {
        uid: 'w_rules1',
        text: 'hello',
        ts: 1,
        ctx: 'menu',
        status: 'open',
        replyTokenHash: 'abc',
        serverTs: 1,
      });
    });
    await assertFails(getDocs(collection(db, 'feedback')));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDocs(collection(adminDb(), 'feedback')));

    await assertSucceeds(updateDoc(doc(adminDb(), 'feedback', 'f1'), {
      status: 'replied',
      reply: 'thanks',
      replyTs: 2,
      repliedBy: 'admin',
    }));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDoc(doc(adminDb(), 'feedback', 'f1')));
  });

  test('allow public balance reads and admin-only writes', async () => {
    const db = anonDb();
    await assertSucceeds(getDoc(doc(db, 'config', 'balance')));
    await assertFails(setDoc(doc(db, 'config', 'balance'), { version: 'test' }));
    await assertSucceeds(setDoc(doc(adminDb(), 'config', 'balance'), {
      version: 'test',
      income: { killMult: 1.1, waveBonusMult: 0.95 },
      global: { abilityCooldownMult: 0.8 },
      diffs: { normal: { hpMult: 1.05, lateScale: 1.1, costMult: 1, cashMult: 1, livesMult: 1 } },
      enemies: { scout: { hpMult: 1.2, rewardMult: 1, speedMult: 0.9 } },
      towers: { siphon: { damageMult: 1.15, projectileSpeedMult: 1.2, splashMult: 1.1, slowMult: 1, burnMult: 1 } },
    }));
    await assertFails(setDoc(doc(adminDb(), 'config', 'balance'), {
      towers: { siphon: { damageMult: 9 } },
    }));
    await assertFails(setDoc(doc(adminDb(), 'config', 'balance'), {
      towers: { siphon: { damageMult: 1, secret: 1 } },
    }));
    await assertFails(setDoc(doc(adminDb(), 'config', 'balance'), {
      enemies: { retiredHull: { hpMult: 1 } },
    }));
    await assertSucceeds(deleteDoc(doc(adminDb(), 'config', 'balance')));
  });

  test('allow public daily override reads and admin-only validated writes', async () => {
    await assertSucceeds(getDoc(doc(anonDb(), 'config', 'dailyOverride')));
    await assertFails(setDoc(doc(anonDb(), 'config', 'dailyOverride'), { date: '2026-07-04', twistId: 'rushHour' }));
    await assertFails(setDoc(doc(playerDb(), 'config', 'dailyOverride'), { date: '2026-07-04', twistId: 'rushHour' }));
    await assertSucceeds(setDoc(doc(adminDb(), 'config', 'dailyOverride'), {
      date: '2026-07-04',
      arsenalId: 'noSupport',
      twistId: 'rushHour',
      boonId: 'doublePickups',
      note: 'launch weekend',
    }));
    await assertFails(setDoc(doc(adminDb(), 'config', 'dailyOverride'), {
      date: '2026-07-04',
      twistId: 'retiredProtocol',
    }));
    await assertFails(setDoc(doc(adminDb(), 'config', 'dailyOverride'), {
      date: '2026-07-04',
      boonId: 'doublePickups',
      secret: true,
    }));
    await assertFails(setDoc(doc(adminDb(), 'config', 'dailyOverride'), {
      date: '07-04-2026',
      twistId: 'rushHour',
    }));
    await assertSucceeds(deleteDoc(doc(adminDb(), 'config', 'dailyOverride')));
  });

  test('global-top aggregate is public read, server-only write', async () => {
    await assertSucceeds(getDoc(doc(anonDb(), 'aggregates', 'globalTop')));
    await assertFails(setDoc(doc(playerDb(), 'aggregates', 'globalTop'), { campaign: [], freeplay: [] }));
    await assertFails(setDoc(doc(adminDb(), 'aggregates', 'globalTop'), { campaign: [], freeplay: [] }));
  });

  test('re-simulation reason docs are admin-read and server-only write', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'runVerificationReasons', runId), {
        schemaVersion: 1,
        runId,
        verdict: 'divergent',
        reason: 'summary.kills',
        rowCount: 1,
      });
    });
    await assertFails(getDoc(doc(anonDb(), 'runVerificationReasons', runId)));
    await assertFails(getDoc(doc(playerDb(), 'runVerificationReasons', runId)));
    await assertSucceeds(getDoc(doc(adminDb(), 'runVerificationReasons', runId)));
    await assertFails(setDoc(doc(adminDb(), 'runVerificationReasons', `${runId}2`), {
      schemaVersion: 1,
      runId: `${runId}2`,
      verdict: 'unverifiable',
      reason: 'manual',
    }));
  });
});
