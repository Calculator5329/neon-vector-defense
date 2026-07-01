const fs = require('node:fs');

describe('CI/CD guardrails', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const ciWorkflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const deepWorkflow = fs.readFileSync('.github/workflows/deep-checks.yml', 'utf8');
  const codeqlWorkflow = fs.readFileSync('.github/workflows/codeql.yml', 'utf8');
  const deployWorkflow = fs.readFileSync('.github/workflows/firebase-deploy.yml', 'utf8');
  const functionsDeployWorkflow = fs.readFileSync('.github/workflows/firebase-functions-deploy.yml', 'utf8');
  const playwrightConfig = fs.readFileSync('playwright.config.ts', 'utf8');
  const workerPackageJson = JSON.parse(fs.readFileSync('worker/package.json', 'utf8'));
  const leaderboardTab = fs.readFileSync('src/menu/LeaderboardTab.tsx', 'utf8');
  const functionsIndex = fs.readFileSync('functions/src/index.ts', 'utf8');
  const clientAdminAuth = fs.readFileSync('src/game/adminAuth.ts', 'utf8');
  const clientLeaderboard = fs.readFileSync('src/game/leaderboard.ts', 'utf8');
  const privacyView = fs.readFileSync('src/PrivacyView.tsx', 'utf8');
  const balanceScript = fs.readFileSync('scripts/balance.ts', 'utf8');
  const balanceCheckScript = fs.readFileSync('scripts/balance-check.ts', 'utf8');
  const ghostGenerator = fs.readFileSync('scripts/genGhostCurves.mjs', 'utf8');
  const adminEmailsSource = fs.readFileSync('functions/src/adminEmails.ts', 'utf8');
  const firestoreRules = fs.readFileSync('firestore.rules', 'utf8');
  const quotedEmails = (text) => [...text.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]).sort();

  test('CI runs quick perf and Jest smoke checks', () => {
    expect(packageJson.scripts['test:jest']).toBe('jest --runInBand');
    expect(packageJson.scripts['test:functions']).toContain('npm --prefix functions run build');
    expect(packageJson.scripts['sim:quick']).toBe('npm run sim -- quick');
    expect(packageJson.scripts['perf:quick']).toBe('npm run perf -- quick');
    expect(packageJson.scripts['balance:gate']).toBe('tsx scripts/balance.ts quick --gate --out test-results/balance-gate-report.json && tsx scripts/balance-check.ts --baseline public/balance-report.json --current test-results/balance-gate-report.json');
    expect(packageJson.scripts.ci).toContain('npm run test:jest');
    expect(packageJson.scripts.ci).not.toContain('npm run sim:quick');
    expect(packageJson.scripts.ci).toContain('npm run perf:quick');
    expect(packageJson.scripts.ci).toContain('npm run balance:gate');
    expect(packageJson.scripts.ci.indexOf('npm run balance:gate')).toBeGreaterThan(packageJson.scripts.ci.indexOf('npm run perf:quick'));
    expect(ciWorkflow).toContain('npm run test:jest');
    expect(ciWorkflow).not.toContain('npm run sim:quick');
    expect(ciWorkflow).not.toContain('Quick Simulation');
    expect(ciWorkflow).toContain('npm run perf:quick');
    expect(ciWorkflow).toContain('npm run balance:gate');
    expect(ciWorkflow).toContain('[balance-intended]');
    expect(playwrightConfig).toContain('retries: process.env.CI ? 1 : 0');
    expect(playwrightConfig).toContain("['html', { open: 'never' }]");
    expect(ciWorkflow).toContain('pull-requests: read');
    expect(deepWorkflow).toContain('schedule:');
    expect(deepWorkflow).toContain("DEEP_SUITE: ${{ github.event_name == 'schedule' && 'quick-balance' || inputs.suite }}");
    expect(deepWorkflow).toContain('npm run sim -- quick');
    expect(deepWorkflow).toContain('npm run sim');
  });

  test('CI balance gate stays wired after perf smoke', () => {
    const perfStep = ciWorkflow.indexOf('- name: Performance Smoke');
    const gateStep = ciWorkflow.indexOf('- name: Balance Gate');
    const gateBlock = /- name: Balance Gate[\s\S]*?(?=\n      - name:|\n  secrets:)/.exec(ciWorkflow)?.[0] ?? '';

    expect(perfStep).toBeGreaterThan(-1);
    expect(gateStep).toBeGreaterThan(perfStep);
    expect(gateBlock).toContain('[balance-intended]');
    expect(gateBlock).toContain('npm run balance:gate');
    expect(ciWorkflow).toContain('regenerate the full baseline with `npm run balance`');
    expect(ciWorkflow).toContain('public/balance-report.json');
  });

  test('cost-sensitive workflows keep explicit gates', () => {
    expect(codeqlWorkflow).toContain("github.event.repository.visibility == 'public'");
    expect(deployWorkflow).toContain('workflow_dispatch');
    expect(deployWorkflow).toContain('environment: production');
    expect(deployWorkflow).toContain('npm run build');
    expect(deployWorkflow).toContain('npx playwright install --with-deps chromium');
    expect(deployWorkflow).toContain('npm test');
    expect(deployWorkflow).toContain('npm run test:security');
    expect(deployWorkflow).toContain('npm run audit:high');
    expect(deployWorkflow).toContain('test "$FIREBASE_PROJECT_ID" = "neon-vector-defense-7"');
    expect(deployWorkflow).toContain('firebase-tools deploy --only hosting,firestore:rules,firestore:indexes');
    expect(functionsDeployWorkflow).toContain('workflow_dispatch');
    expect(functionsDeployWorkflow).toContain('environment: production');
    expect(functionsDeployWorkflow).toContain('npm --prefix functions run build');
    expect(functionsDeployWorkflow).toContain('npx playwright install --with-deps chromium');
    expect(functionsDeployWorkflow).toContain('npm test');
    expect(functionsDeployWorkflow).toContain('npm run test:security');
    expect(functionsDeployWorkflow).toContain('test "$FIREBASE_PROJECT_ID" = "neon-vector-defense-7"');
    expect(functionsDeployWorkflow).toContain('firebase-tools deploy --only functions');
    expect(deployWorkflow).not.toMatch(/\npull_request:|\nschedule:/);
    expect(functionsDeployWorkflow).not.toMatch(/\npull_request:|\nschedule:/);
    expect(workerPackageJson.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('admin allowlist is shared by backend and admin UI', () => {
    expect(functionsIndex).toContain("from './adminEmails.js'");
    expect(clientAdminAuth).toContain("from '../../functions/src/adminEmails'");
    expect(functionsIndex).not.toContain('new Set([\'5329548871');
    expect(clientAdminAuth).not.toContain('5329548871,eg@gmail.com');
    const ruleAdminBlock = /function isAdmin\(\) \{[\s\S]*?\n    \}/.exec(firestoreRules)?.[0] ?? '';
    expect(quotedEmails(ruleAdminBlock)).toEqual(quotedEmails(adminEmailsSource));
  });

  test('client analytics writes stay append-only', () => {
    const submitRunAnalytics = /export async function submitRunAnalytics[\s\S]*?\n}/.exec(clientLeaderboard)?.[0] ?? '';
    expect(submitRunAnalytics).toContain("fs.doc(db, 'runAnalytics', doc.runId)");
    expect(submitRunAnalytics).not.toContain('merge: true');
  });

  test('player writes require the authenticated anonymous identity', () => {
    expect(firestoreRules).toContain('function isPlayer()');
    expect(firestoreRules).toContain('request.auth.uid == uid');
    expect(firestoreRules).toContain('request.resource.data.uid == request.auth.uid');
    expect(functionsIndex).toContain('function requireAuthUid');
    expect(functionsIndex).toContain("HttpsError('unauthenticated', 'auth-required')");
    expect(clientLeaderboard).toContain('await ensureServerUid()');
    expect(clientLeaderboard).not.toContain('uid: progress.uid');
  });

  test('public replay deletion has a private ownership index', () => {
    expect(clientLeaderboard).toContain("fs.doc(db, 'replayOwners', serverUid, 'runs', run.runId)");
    expect(functionsIndex).toContain("db.collection(`replayOwners/${uid}/runs`).get()");
    expect(functionsIndex).toContain("db.doc(`replayOwners/${uid}/runs/${runId}`)");
    expect(firestoreRules).toContain('match /replayOwners/{uid}/runs/{runId}');
    expect(firestoreRules).toContain('request.resource.data.uid == uid');
    expect(firestoreRules).toContain('request.resource.data.runId == runId');
  });

  test('leaderboard score timestamps are server-controlled', () => {
    const processSubmit = /async function processSubmit[\s\S]*?\n}/.exec(functionsIndex)?.[0] ?? '';
    expect(processSubmit).toContain('const acceptedAt = Date.now()');
    expect(processSubmit).toContain('ts: acceptedAt');
    expect(processSubmit).toContain('clientTs: claim.ts');
    expect(processSubmit).not.toContain('ts: claim.ts');
  });

  test('quick balance reports cannot overwrite shipped ghost curves', () => {
    expect(balanceScript).toContain('if (!QUICK)');
    expect(balanceScript).toContain("process.argv.includes('--gate')");
    expect(balanceScript).toContain("argValue('--out')");
    expect(packageJson.scripts['balance:gate']).toContain('test-results/balance-gate-report.json');
    expect(balanceCheckScript).toContain("argValue('--baseline')");
    expect(balanceCheckScript).toContain("argValue('--current')");
    expect(balanceCheckScript).toContain('EFFICIENCY_RATIO_FAIL_DELTA');
    expect(balanceCheckScript).toContain('soloViability');
    expect(balanceScript).toContain('genGhostCurves.mjs');
    expect(balanceScript).toContain('skipped bundled ghost-curve regeneration for quick balance report');
    expect(ghostGenerator).toContain('Refusing to bundle quick/anecdotal ghost curves');
    expect(ghostGenerator).toContain('NVD_MIN_GHOST_SEEDS');
  });

  test('privacy copy discloses AI helper provider flow', () => {
    expect(privacyView).toContain('AI help');
    expect(privacyView).toContain('Cloudflare Worker');
    expect(privacyView).toContain('OpenRouter');
    expect(privacyView).toContain('gameplay context');
  });

  test('privacy controls include replay score tokens in local export and delete', () => {
    expect(privacyView).toContain("'nvd-replay-tokens-v1'");
    expect(privacyView).toContain('private score-retry tokens');
  });

  test('leaderboard rows can highlight the current player', () => {
    expect(leaderboardTab).toContain('const myUid = cachedServerUid() ?? progress.uid');
    expect(leaderboardTab).toContain("r.uid === myUid ? 'me' : ''");
  });
});
