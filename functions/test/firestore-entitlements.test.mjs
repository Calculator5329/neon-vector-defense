import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const block = /match \/entitlements\/\{uid\} \{[\s\S]*?\n    \}/.exec(rules)?.[0] ?? '';

test('entitlements are owner-readable and deny every client write', () => {
  assert.match(block, /request\.auth\.uid == uid/);
  assert.match(block, /allow list: if false/);
  assert.match(block, /allow write: if false/);
  assert.match(block, /match \/grants\/\{grantId\}/);
});
