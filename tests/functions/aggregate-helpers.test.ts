import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GLOBAL_TOP_CAP, mergeGlobalTopRows, type GlobalTopRow } from '../../functions/src/aggregateHelpers';

function row(patch: Partial<GlobalTopRow> = {}): GlobalTopRow {
  return {
    name: 'WARDEN',
    cash: 100,
    kills: 10,
    wave: 5,
    freeplay: false,
    ts: 1,
    uid: 'anonUid001',
    runId: 'r_abcdefgh',
    board: 'orbital_easy',
    ...patch,
  };
}

describe('global-top aggregate merge', () => {
  test('ranks campaign rows by cash with kills/recency tiebreaks', () => {
    const merged = mergeGlobalTopRows(
      [row({ cash: 300, uid: 'a', runId: 'r_run11111' }), row({ cash: 100, uid: 'b', runId: 'r_run22222' })],
      row({ cash: 200, uid: 'c', runId: 'r_run33333' }),
    );
    assert.deepEqual(merged.map((r) => r.cash), [300, 200, 100]);
  });

  test('ranks freeplay rows by wave', () => {
    const merged = mergeGlobalTopRows(
      [row({ freeplay: true, wave: 40, uid: 'a', runId: 'r_run11111', board: 'orbital_easy_fp' })],
      row({ freeplay: true, wave: 90, uid: 'b', runId: 'r_run22222', board: 'orbital_easy_fp' }),
    );
    assert.deepEqual(merged.map((r) => r.wave), [90, 40]);
  });

  test('a resubmission replaces its older self instead of duplicating', () => {
    const first = row({ cash: 100 });
    const upgraded = row({ cash: 500 });
    const merged = mergeGlobalTopRows([first], upgraded);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].cash, 500);
  });

  test('caps the list length', () => {
    const rows = Array.from({ length: GLOBAL_TOP_CAP }, (_, i) => row({ cash: 1000 - i, uid: `u${i}`, runId: `r_run${String(i).padStart(5, '0')}` }));
    const merged = mergeGlobalTopRows(rows, row({ cash: 1, uid: 'new', runId: 'r_runnewest' }));
    assert.equal(merged.length, GLOBAL_TOP_CAP);
    assert.ok(!merged.some((r) => r.uid === 'new'), 'a below-cutoff row does not displace the top list');
  });
});
