import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';

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

const vite = await createServer({
  root,
  logLevel: 'warn',
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});

let exitCode = 1;

try {
  await vite.listen();
  exitCode = await runPlaywright(baseURL);
} finally {
  await vite.close();
}

process.exit(exitCode);
