const { execFileSync } = require('node:child_process');
const path = require('node:path');

// The named replay-pipeline E2E must actually RUN, not be grepped as text (its prior
// "test" only asserted string literals appeared in the source). Spawn the script and
// require a clean exit plus the PASS sentinel, so `test:jest` fails loudly the moment
// any verdict, summary parity, or anti-hang bound regresses.
describe('replay pipeline E2E script', () => {
  test('records combat runs and proves verified + divergent + bounded verdicts', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const tsxBin = path.resolve(repoRoot, 'node_modules', '.bin', 'tsx');
    const stdout = execFileSync(tsxBin, ['scripts/replay-e2e.ts'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120000,
    });
    expect(stdout).toContain('replay-e2e: PASS');
  }, 120000);
});
