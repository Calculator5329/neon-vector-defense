import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  level?: 'OK' | 'WARN' | 'FAIL';
}

function major(version: string): number {
  const match = /(\d+)(?:\.\d+)?(?:\.\d+)?/.exec(version);
  return match ? Number(match[1]) : 0;
}

function run(command: string, args: string[]): { status: number | null; output: string } {
  const res = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: res.status,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
  };
}

function envFileValue(name: string): string | undefined {
  for (const file of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
      if (match?.[1] !== name) continue;
      return match[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return undefined;
}

function envValue(name: string): string | undefined {
  return process.env[name] ?? envFileValue(name);
}

function isProductionTarget(): boolean {
  const args = new Set(process.argv.slice(2));
  if (args.has('--production') || args.has('--prod')) return true;
  const values = [
    process.env.NODE_ENV,
    process.env.MODE,
    process.env.VITE_MODE,
    process.env.DEPLOY_ENV,
    process.env.DEPLOY_TARGET,
    process.env.FIREBASE_DEPLOY_TARGET,
  ].filter((value): value is string => !!value).map((value) => value.toLowerCase());
  return values.some((value) => value === 'production' || value === 'prod');
}

function checkNode(): CheckResult {
  const found = process.versions.node;
  const ok = major(found) >= 20;
  return {
    name: 'Node.js',
    ok,
    detail: `found ${found}; required >=20`,
    fix: 'Install Node.js 20+ or run via the project CI image.',
  };
}

function checkJava(): CheckResult {
  const res = run('java', ['-version']);
  if (res.status !== 0 || !res.output) {
    return {
      name: 'Java',
      ok: false,
      detail: 'java was not found on PATH; required >=21 for firebase-tools emulators',
      fix: 'Install Temurin/OpenJDK 21+ and put its bin directory first on PATH.',
    };
  }
  const firstLine = res.output.split(/\r?\n/)[0] ?? res.output;
  const ok = major(firstLine) >= 21;
  return {
    name: 'Java',
    ok,
    detail: `${firstLine}; required >=21 for firebase-tools emulators`,
    fix: 'Install Temurin/OpenJDK 21+ and ensure java -version reports 21 or newer.',
  };
}

function checkFirebaseProject(): CheckResult {
  try {
    const config = JSON.parse(readFileSync('.firebaserc', 'utf8')) as { projects?: Record<string, string> };
    const projects = Object.values(config.projects ?? {});
    const ok = projects.includes('neon-vector-defense-7');
    return {
      name: 'Firebase project',
      ok,
      detail: ok ? '.firebaserc includes neon-vector-defense-7' : '.firebaserc does not include neon-vector-defense-7',
      fix: 'Run firebase use --add neon-vector-defense-7 before deploying.',
    };
  } catch {
    return {
      name: 'Firebase project',
      ok: false,
      detail: '.firebaserc could not be read',
      fix: 'Restore .firebaserc or run firebase use --add neon-vector-defense-7.',
    };
  }
}

function checkAppCheck(): CheckResult {
  const hasSiteKey = !!envValue('VITE_FIREBASE_APPCHECK_SITE_KEY');
  const enforceFunctions = process.env.ENFORCE_APP_CHECK === 'true';
  const productionTarget = isProductionTarget();
  const appCheckState = hasSiteKey ? 'client token key configured' : 'client token key missing';
  const functionsState = enforceFunctions ? 'Functions enforcement expected ON' : 'Functions enforcement expected OFF until rollout flip';
  const firestoreState = 'Firestore enforcement is a Firebase Console switch after token metrics are clean';
  return {
    name: 'App Check',
    ok: true,
    level: !hasSiteKey && productionTarget ? 'WARN' : 'OK',
    detail: `${appCheckState}; ${functionsState}; ${firestoreState}`,
    fix: !hasSiteKey && productionTarget
      ? 'Set VITE_FIREBASE_APPCHECK_SITE_KEY before the production Hosting build; keep ENFORCE_APP_CHECK=false until production token issuance is verified.'
      : undefined,
  };
}

const checks = [checkNode(), checkJava(), checkFirebaseProject()];
const advisoryChecks = [checkAppCheck()];

for (const check of checks) {
  const icon = check.ok ? 'OK' : 'FAIL';
  console.log(`${icon} ${check.name}: ${check.detail}`);
  if (!check.ok && check.fix) console.log(`  Fix: ${check.fix}`);
}

for (const check of advisoryChecks) {
  const icon = check.level ?? (check.ok ? 'OK' : 'FAIL');
  console.log(`${icon} ${check.name}: ${check.detail}`);
  if (check.fix) console.log(`  Fix: ${check.fix}`);
}

if (checks.some((check) => !check.ok)) process.exit(1);
