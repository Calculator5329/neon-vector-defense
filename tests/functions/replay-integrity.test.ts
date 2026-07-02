import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { replayEventHash, validateReplayManifest } from '../../functions/src/replayIntegrity';

const docEvents = [
  { type: 'run_start', t: 0 },
  { type: 'wave_start', t: 1.2 },
];
const chunkEvents = [
  { type: 'run_end', t: 9.9 },
];

function manifestRun(patch: Record<string, unknown> = {}) {
  return {
    chunkCount: 1,
    eventCount: 3,
    events: docEvents,
    manifest: {
      chunkEventCounts: [1],
      eventHash: replayEventHash([...docEvents, ...chunkEvents]),
      complete: true,
    },
    ...patch,
  };
}

describe('replay manifest integrity', () => {
  test('accepts complete manifests and rejects manifest-less uploads', () => {
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: true, events: chunkEvents }]),
      'complete',
    );
    assert.equal(validateReplayManifest({ eventCount: 1, events: docEvents }, []), 'manifest-missing');
  });

  test('returns manifest-mismatch for missing, truncated, or tampered chunks', () => {
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: false, events: [] }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun(), [{ exists: true, events: [] }]),
      'manifest-mismatch',
    );
    assert.equal(
      validateReplayManifest(manifestRun({
        manifest: { chunkEventCounts: [1], eventHash: '00000000', complete: true },
      }), [{ exists: true, events: chunkEvents }]),
      'manifest-mismatch',
    );
  });
});
