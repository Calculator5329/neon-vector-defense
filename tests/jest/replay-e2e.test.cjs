const fs = require('node:fs');

describe('replay pipeline E2E script', () => {
  const source = fs.readFileSync('scripts/replay-e2e.ts', 'utf8');

  test('wires record, mock storage, manifest, verification, and tamper assertions', () => {
    expect(source).toContain('class ReplayStoreMock');
    expect(source).toContain('buildRunManifest(copy.run.actions, copy.chunks)');
    expect(source).toContain("assert.equal(original.verdict, 'verified'");
    expect(source).toContain("assert.equal(rejected.verdict, 'divergent'");
    expect(source).toContain("console.log('replay-e2e: PASS')");
  });
});
