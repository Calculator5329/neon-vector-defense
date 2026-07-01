import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { build, createServer, preview } from 'vite';

const root = process.cwd();
const aiHelpUrl = process.env.VITE_AI_HELP_URL ?? 'http://127.0.0.1:9/ai-help-test';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function runPlaywright(baseURL) {
  const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  const args = [cli, 'test', ...process.argv.slice(2)];
  const env = {
    ...process.env,
    PLAYWRIGHT_BASE_URL: baseURL,
    VITE_AI_HELP_URL: aiHelpUrl,
  };

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: 'inherit',
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

const port = Number(process.env.PLAYWRIGHT_PORT) || await getFreePort();
const baseURL = `http://127.0.0.1:${port}`;
process.env.VITE_AI_HELP_URL = aiHelpUrl;

// --preview: build and serve the PRODUCTION bundle instead of the dev server.
// The dev server never exercises the real chunk graph or the service worker —
// exactly where past regressions (sw navigation, ?run= links) lived.
const previewMode = process.argv.includes('--preview');
process.argv = process.argv.filter((a) => a !== '--preview');

const explicitTestSelection = process.argv.slice(2).some((arg, index, all) => {
  const prev = all[index - 1];
  return arg.includes('tests/')
    || arg.includes('tests\\')
    || arg.endsWith('.spec.ts')
    || prev === '-g'
    || prev === '--grep';
});
if (previewMode && !explicitTestSelection) {
  process.argv.push('tests/e2e/production-build.spec.ts');
}

let exitCode = 1;

if (previewMode) {
  process.env.PLAYWRIGHT_PREVIEW = '1';
  await build({ root, logLevel: 'warn' });
  const server = await preview({
    root,
    logLevel: 'warn',
    preview: {
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  });
  try {
    exitCode = await runPlaywright(baseURL);
  } finally {
    await server.close();
  }
} else {
  const vite = await createServer({
    root,
    logLevel: 'warn',
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  });
  try {
    await vite.listen();
    exitCode = await runPlaywright(baseURL);
  } finally {
    await vite.close();
  }
}

process.exit(exitCode);
