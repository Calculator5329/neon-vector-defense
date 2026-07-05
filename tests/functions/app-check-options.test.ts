import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Unit drift guard only: no emulator or Java required. Emulator-backed callable
// suites still require Java 21 as documented in the release-hardening notes.

const source = readFileSync('functions/src/index.ts', 'utf8');
const callableExports = [
  'submitFeedback',
  'fetchFeedbackReplies',
  'submitScore',
  'submitDailyScore',
  'submitWeeklyScore',
  'submitGauntletScore',
  'submitGauntletProtocolScore',
  'verifyRun',
  'crownWeeklyGauntlet',
  'deleteMyData',
];

describe('callable App Check options', () => {
  test('callableOptions binds enforcement to the runtime rollout flag', () => {
    assert.match(source, /const APP_CHECK_ENFORCED = process\.env\.ENFORCE_APP_CHECK === 'true';/);
    const helper = /function callableOptions[\s\S]*?\n}/.exec(source)?.[0] ?? '';
    assert.ok(helper, 'callableOptions helper must exist');
    assert.match(helper, /enforceAppCheck:\s*APP_CHECK_ENFORCED/);
  });

  test('every exported callable goes through callableOptions', () => {
    const exported = [...source.matchAll(/export const (\w+) = onCall\(/g)].map((match) => match[1]).sort();
    assert.deepEqual(exported, [...callableExports].sort());
    for (const name of callableExports) {
      assert.match(source, new RegExp(`export const ${name} = onCall\\(\\s*callableOptions\\(`));
    }
  });
});
