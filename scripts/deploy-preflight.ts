import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
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

const checks = [checkNode(), checkJava(), checkFirebaseProject()];

for (const check of checks) {
  const icon = check.ok ? 'OK' : 'FAIL';
  console.log(`${icon} ${check.name}: ${check.detail}`);
  if (!check.ok && check.fix) console.log(`  Fix: ${check.fix}`);
}

if (checks.some((check) => !check.ok)) process.exit(1);
