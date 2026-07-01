#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'neon-vector-defense-7';
const DATABASE = '(default)';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DELETE_PATHS = [
  'boards',
  'dailyBoards',
  'runs',
  'replayOwners',
  'runAnalytics',
  'runCheckpoints',
  'telemetry',
  'feedback',
  'rateLimits',
  'aggregates',
  'config/spotlight',
];

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/admin/wipe-server-data.mjs [--execute]

Without --execute, prints live Firestore counts only.
With --execute, recursively deletes the reset paths for ${PROJECT_ID}, then prints before/after counts.

This script never deletes config/balance. It deletes only config/spotlight under config/.`);
  process.exit(0);
}

const execute = args.has('--execute');

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  assertActiveProject();
  const token = await accessToken();
  const before = await collectCounts(token);
  printCounts(execute ? 'Before wipe' : 'Live Firestore count pass', before);

  if (!execute) {
    console.log('\nCount-only mode: no documents were deleted. Re-run with --execute only after explicit operator confirmation.');
    return;
  }

  console.log('\nDESTRUCTIVE MODE: recursively deleting these paths from project neon-vector-defense-7:');
  for (const path of DELETE_PATHS) console.log(`- ${path}`);
  console.log('- any remaining known child docs under boards/*/scores, dailyBoards/*/scores, runs/*/chunks, replayOwners/*/runs, and runCheckpoints/*/chunks');
  console.log('\nconfig/balance is intentionally kept; only config/spotlight is deleted under config/.');

  for (const path of DELETE_PATHS) {
    runFirebase(['firestore:delete', '-r', path, '--force', '--project', PROJECT_ID]);
  }

  const leafDocs = await collectKnownLeafDeletePaths(token);
  if (leafDocs.length > 0) {
    console.log(`\nDeleting ${leafDocs.length} remaining known child documents with missing/empty parent docs...`);
    for (const path of leafDocs) {
      runFirebase(['firestore:delete', path, '--force', '--project', PROJECT_ID]);
    }
  }

  const after = await collectCounts(token);
  printCounts('After wipe', after, before);
}

function assertActiveProject() {
  const result = runFirebase(['use', '--json'], { allowFailure: true });
  const active = parseActiveProject(result.stdout) ?? parseActiveProject(result.stderr);
  if (active !== PROJECT_ID) {
    throw new Error(`Refusing to continue: firebase use is '${active ?? 'unknown'}', expected '${PROJECT_ID}'. Run 'firebase use ${PROJECT_ID}' first.`);
  }
}

function parseActiveProject(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return (typeof parsed?.result === 'string' ? parsed.result : null)
      ?? parsed?.result?.projectId
      ?? parsed?.result?.activeProject
      ?? parsed?.activeProject
      ?? parsed?.projectId
      ?? null;
  } catch {
    const match = /(?:Active Project|Project):\s*([A-Za-z0-9_-]+)/i.exec(text);
    return match?.[1] ?? null;
  }
}

function runFirebase(firebaseArgs, options = {}) {
  const bin = firebaseBin();
  const result = spawnSync(bin, firebaseArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`firebase ${firebaseArgs.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  if (result.error && !options.allowFailure) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 0 };
}

function firebaseBin() {
  if (process.env.FIREBASE_BIN) return process.env.FIREBASE_BIN;
  const local = resolve(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase');
  return existsSync(local) ? local : 'firebase';
}

async function accessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  try {
    const auth = await import('firebase-tools/lib/auth.js');
    const scopes = await import('firebase-tools/lib/scopes.js');
    const account = auth.getProjectDefaultAccount?.(ROOT) ?? auth.getGlobalDefaultAccount?.();
    const refreshToken = account?.tokens?.refresh_token ?? account?.tokens?.refreshToken;
    const authScopes = account?.tokens?.scopes ?? [
      scopes.EMAIL,
      scopes.OPENID,
      scopes.CLOUD_PROJECTS_READONLY,
      scopes.FIREBASE_PLATFORM,
      scopes.CLOUD_PLATFORM,
    ];
    const token = await auth.getAccessToken(refreshToken, authScopes);
    if (typeof token === 'string') return token;
    if (typeof token?.access_token === 'string') return token.access_token;
    if (typeof token?.accessToken === 'string') return token.accessToken;
  } catch (error) {
    throw new Error(`Unable to get a Firebase CLI access token. Run npm install, confirm 'firebase login:list' shows the owner account, or set GOOGLE_OAUTH_ACCESS_TOKEN. Details: ${error instanceof Error ? error.message : error}`);
  }
  throw new Error('Firebase CLI did not return an access token.');
}

async function collectCounts(token) {
  const [scores, chunks, runsGroup] = await Promise.all([
    collectionGroupNames(token, 'scores'),
    collectionGroupNames(token, 'chunks'),
    collectionGroupNames(token, 'runs'),
  ]);

  const boardScores = scores.filter((path) => path.startsWith('boards/')).length;
  const dailyScores = scores.filter((path) => path.startsWith('dailyBoards/')).length;
  const runChunks = chunks.filter((path) => path.startsWith('runs/')).length;
  const checkpointChunks = chunks.filter((path) => path.startsWith('runCheckpoints/')).length;
  const replayOwnerRuns = runsGroup.filter((path) => path.startsWith('replayOwners/')).length;

  const [
    boards,
    dailyBoards,
    runs,
    runAnalytics,
    runCheckpoints,
    telemetry,
    feedback,
    rateLimits,
    aggregates,
    spotlight,
    balance,
  ] = await Promise.all([
    countCollection(token, 'boards'),
    countCollection(token, 'dailyBoards'),
    countCollection(token, 'runs'),
    countCollection(token, 'runAnalytics'),
    countCollection(token, 'runCheckpoints'),
    countCollection(token, 'telemetry'),
    countCollection(token, 'feedback'),
    countCollection(token, 'rateLimits'),
    countCollection(token, 'aggregates'),
    documentExists(token, 'config/spotlight'),
    documentExists(token, 'config/balance'),
  ]);

  return [
    { label: 'boards', count: boards },
    { label: 'boards/*/scores', count: boardScores },
    { label: 'dailyBoards', count: dailyBoards },
    { label: 'dailyBoards/*/scores', count: dailyScores },
    { label: 'runs', count: runs },
    { label: 'runs/*/chunks', count: runChunks },
    { label: 'replayOwners/*/runs', count: replayOwnerRuns },
    { label: 'runAnalytics', count: runAnalytics },
    { label: 'runCheckpoints', count: runCheckpoints },
    { label: 'runCheckpoints/*/chunks', count: checkpointChunks },
    { label: 'telemetry', count: telemetry },
    { label: 'feedback', count: feedback },
    { label: 'rateLimits', count: rateLimits },
    { label: 'aggregates', count: aggregates },
    { label: 'config/spotlight', count: spotlight ? 1 : 0 },
    { label: 'config/balance (kept)', count: balance ? 1 : 0 },
  ];
}

async function collectKnownLeafDeletePaths(token) {
  const [scores, chunks, runsGroup] = await Promise.all([
    collectionGroupNames(token, 'scores'),
    collectionGroupNames(token, 'chunks'),
    collectionGroupNames(token, 'runs'),
  ]);
  return [
    ...scores.filter((path) => path.startsWith('boards/') || path.startsWith('dailyBoards/')),
    ...chunks.filter((path) => path.startsWith('runs/') || path.startsWith('runCheckpoints/')),
    ...runsGroup.filter((path) => path.startsWith('replayOwners/')),
  ].sort();
}

async function countCollection(token, collectionPath) {
  let count = 0;
  let pageToken = '';
  do {
    const url = new URL(`${FIRESTORE_BASE}/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await firestoreFetch(token, url, { notFound: { documents: [] } });
    count += Array.isArray(data.documents) ? data.documents.length : 0;
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return count;
}

async function collectionGroupNames(token, collectionId) {
  const data = await firestoreFetch(token, `${FIRESTORE_BASE}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
      },
    }),
  });
  return (Array.isArray(data) ? data : [])
    .map((row) => row?.document?.name)
    .filter((name) => typeof name === 'string')
    .map((name) => name.split('/documents/')[1] ?? '')
    .filter(Boolean);
}

async function documentExists(token, documentPath) {
  const result = await firestoreFetch(token, `${FIRESTORE_BASE}/${documentPath}`, {
    notFound: null,
  });
  return result !== null;
}

async function firestoreFetch(token, input, options = {}) {
  const response = await fetch(input, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body,
  });
  if (response.status === 404 && 'notFound' in options) return options.notFound;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Firestore REST request failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function printCounts(title, rows, before = null) {
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 10);
  console.log(`\n${title}`);
  console.log(`${'Path'.padEnd(labelWidth)}  ${before ? 'Before'.padStart(8) + '  ' : ''}${'Count'.padStart(8)}${before ? '  Delta'.padStart(8) : ''}`);
  console.log(`${'-'.repeat(labelWidth)}  ${before ? '--------  ' : ''}--------${before ? '  --------' : ''}`);
  for (const row of rows) {
    const prior = before?.find((entry) => entry.label === row.label)?.count ?? 0;
    const delta = row.count - prior;
    const deltaText = delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta}`;
    console.log(`${row.label.padEnd(labelWidth)}  ${before ? String(prior).padStart(8) + '  ' : ''}${String(row.count).padStart(8)}${before ? deltaText.padStart(10) : ''}`);
  }
}
