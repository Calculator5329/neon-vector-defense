const fs = require('node:fs');

describe('CI/CD guardrails', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const ciWorkflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const codeqlWorkflow = fs.readFileSync('.github/workflows/codeql.yml', 'utf8');
  const deployWorkflow = fs.readFileSync('.github/workflows/firebase-deploy.yml', 'utf8');

  test('CI runs quick perf and Jest smoke checks', () => {
    expect(packageJson.scripts['test:jest']).toBe('jest --runInBand');
    expect(packageJson.scripts['perf:quick']).toBe('npm run perf -- quick');
    expect(packageJson.scripts.ci).toContain('npm run test:jest');
    expect(packageJson.scripts.ci).toContain('npm run perf:quick');
    expect(ciWorkflow).toContain('npm run test:jest');
    expect(ciWorkflow).toContain('npm run perf:quick');
  });

  test('cost-sensitive workflows keep explicit gates', () => {
    expect(codeqlWorkflow).toContain("github.event.repository.visibility == 'public'");
    expect(deployWorkflow).toContain('workflow_dispatch');
    expect(deployWorkflow).toContain('Manual deploy steps are intentionally disabled');
    expect(deployWorkflow).not.toMatch(/\npull_request:|\nschedule:/);
  });
});
