import { spawn } from 'node:child_process';
import path from 'node:path';

const portal = process.argv[2];
if (portal !== 'crazygames' && portal !== 'poki') {
  console.error('Usage: node ./scripts/build-portal.mjs <crazygames|poki>');
  process.exit(1);
}

const env = {
  ...process.env,
  VITE_PORTAL: portal,
};

const tsc = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
const vite = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const tscCode = await run(process.execPath, [tsc], env);
if (tscCode !== 0) process.exit(tscCode);
process.exit(await run(process.execPath, [vite, 'build'], env));

function run(command, args, commandEnv) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: commandEnv,
      windowsHide: true,
    });
    child.on('error', (error) => {
      console.error(error);
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}
