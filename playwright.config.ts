import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4293);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
// WebGL on the real GPU through ANGLE on EGL; Playwright's default is SwiftShader on the CPU.
// SOFT_GL=1, or a machine without a render node, keeps that default.
const glArgs = process.env.SOFT_GL === '1' || !existsSync('/dev/dri/renderD128')
  ? []
  : ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: { args: glArgs },
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(channel ? { channel } : {}),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-mobile',
      // Portrait phones auto-pause a run behind the rotate notice (GameScreen.tsx), so this journey's pause click resumes it; it is landscape-only.
      grepInvert: /deploy-and-abort-run:/,
      use: {
        ...devices['Pixel 5'],
        ...(channel ? { channel } : {}),
      },
    },
  ],
});
