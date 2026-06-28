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
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const runId = 'r_rulesTest123';
const adminToken = { email: '5329548871.eg@gmail.com', email_verified: true };

const validRun = {
  schemaVersion: 2,
  runId,
  replayTokenHash: 'a'.repeat(64),
  createdAt: 1,
  endedAt: 2,
  build: 'test',
  chunkCount: 0,
  eventCount: 1,
  summary: {},
  setup: {},
  events: [],
  snapshots: [],
  final: {},
};

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

function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function adminDb() {
  return testEnv.authenticatedContext('admin', adminToken).firestore();
}

describe('public replay rules', () => {
  test('allow create and public get, but deny updates', async () => {
    const db = anonDb();
    const ref = doc(db, 'runs', runId);
    await assertSucceeds(setDoc(ref, validRun));
    await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(ref, { eventCount: 2 }));
  });

  test('deny malformed public replay docs', async () => {
    const db = anonDb();
    const malformed = { ...validRun };
    delete (malformed as Partial<typeof validRun>).final;
    await assertFails(setDoc(doc(db, 'runs', runId), malformed));
  });

  test('allow replay chunk create and deny chunk updates', async () => {
    const db = anonDb();
    const ref = doc(db, 'runs', runId, 'chunks', 'c0');
    await assertSucceeds(setDoc(ref, { schemaVersion: 2, runId, chunk: 0, events: [] }));
    await assertFails(updateDoc(ref, { chunk: 1 }));
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
    const db = anonDb();
    const ref = doc(db, 'telemetry', 't1');
    await assertSucceeds(setDoc(ref, {
      uid: 'w_rules1',
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
    }));
    await assertFails(updateDoc(ref, { wave: 2 }));
  });

  test('allow private run analytics create and deny public updates', async () => {
    const db = anonDb();
    const ref = doc(db, 'runAnalytics', runId);
    await assertSucceeds(setDoc(ref, {
      schemaVersion: 1,
      runId,
      uid: 'w_rules1',
      createdAt: 1,
      endedAt: 2,
      build: 'test',
      summary: {},
      onboarding: {},
      abandonment: {},
      difficulty: {},
      economy: {},
      towerInterest: {},
      progression: {},
      leaderboard: {},
      attention: {},
      performance: {},
    }));
    await assertFails(updateDoc(ref, { endedAt: 3 }));
  });

  test('allow checkpoint chunk creates and keep reads admin-only', async () => {
    const db = anonDb();
    const ref = doc(db, 'runCheckpoints', runId, 'chunks', 'c0');
    await assertSucceeds(setDoc(ref, {
      schemaVersion: 2,
      runId,
      uid: 'w_rules1',
      chunk: 0,
      reason: 'interval',
      createdAt: 1,
      build: 'test',
      summary: {},
      performance: {},
      attention: {},
      counters: {},
      recentEvents: [],
      latestSnapshot: null,
    }));
    await assertFails(getDoc(ref));
    await assertSucceeds(getDoc(doc(adminDb(), 'runCheckpoints', runId, 'chunks', 'c0')));
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
    await assertSucceeds(setDoc(doc(adminDb(), 'config', 'balance'), { version: 'test' }));
  });
});
