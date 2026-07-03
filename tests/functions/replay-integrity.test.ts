import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { replayActionHash, validateReplayManifest } from '../../functions/src/replayIntegrity';

const rootActions = {
  codec: 'r3',
  count: 2,
  towerIds: ['pulse'],
  data: '012345',
};
const chunkActions = {
  codec: 'r3',
  count: 1,
  towerIds: ['pulse'],
  data: '6789',
};

function manifestRun(patch: Record<string, unknown> = {}) {
  return {
    chunkCount: 1,
    eventCount: 3,
    actions: rootActions,
    manifest: {
      chunkEventCounts: [1],
      actionHash: replayActionHash(rootActions, [chunkActions]),
      complete: true,
    },
    ...patch,
  };
}

describe('replay manifest integrity', () => {
  test('accepts complete r3 action manifests and rejects manifest-less uploads', () => {
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: true, actions: chunkActions }]),
      'complete',
    );
    assert.equal(validateReplayManifest({ eventCount: 1, actions: rootActions }, []), 'manifest-missing');
  });

  test('returns manifest-mismatch for missing, truncated, or tampered chunks', () => {
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: false, actions: chunkActions }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: true, actions: { ...chunkActions, count: 0 } }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: true, actions: { ...chunkActions, data: 'tampered' } }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun({
        manifest: { chunkEventCounts: [1], actionHash: '00000000', complete: true },
      }), [{ exists: true, actions: chunkActions }]),
      'manifest-mismatch',
    );
  });

  test('rejects v2 replay manifest and public root fields', () => {
    assert.equal(
      validateReplayManifest(manifestRun({
        manifest: { chunkEventCounts: [1], actionHash: replayActionHash(rootActions, [chunkActions]), eventHash: '1234abcd', complete: true },
      }), [{ exists: true, actions: chunkActions }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun({ deathRecords: { codec: 'd1', count: 0, waves: [] } }), [{ exists: true, actions: chunkActions }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun({ events: [{ type: 'run_start', t: 0 }] }), [{ exists: true, actions: chunkActions }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun({ snapshots: [] }), [{ exists: true, actions: chunkActions }]),
      'manifest-mismatch',
    );
  });
});
