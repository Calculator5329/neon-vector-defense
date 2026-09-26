import { createServer } from 'vite';
import { chromium } from 'playwright';
import net from 'node:net';
import { existsSync } from 'node:fs';

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

// Real GPU unless SOFT_GL=1 or there is no render node; see playwright.config.ts.
const glArgs = process.env.SOFT_GL === '1' || !existsSync('/dev/dri/renderD128')
  ? []
  : ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];

const port = Number(process.env.BROWSER_PERF_PORT) || await getFreePort();
const baseURL = `http://127.0.0.1:${port}`;
const vite = await createServer({
  root: process.cwd(),
  logLevel: 'warn',
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});

const viewports = [
  { label: 'desktop', width: 1365, height: 768 },
  { label: 'mobile', width: 390, height: 844 },
];

try {
  await vite.listen();
  const browser = await chromium.launch({ args: glArgs });
  const rows = [];
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(`${baseURL}/?perf=throat&diff=hard`);
    await page.waitForTimeout(2500);
    rows.push(await page.evaluate((label) => {
      const game = window.game;
      const analytics = game.buildRunAnalyticsDoc('PERFTEST', 'w_test123', 'browser-perf');
      return {
        label,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        dpr: window.devicePixelRatio,
        fpsAvg: analytics.performance.fpsAvg,
        longFrames: analytics.performance.longFrames,
        qualityDowngrades: analytics.performance.qualityDowngrades,
        qualityRecoveries: analytics.performance.qualityRecoveries,
        wave: game.wave,
        phase: game.phase,
        hulls: game.enemies.length,
        fx: game.particles.length + game.projectiles.length + game.beams.length,
      };
    }, viewport.label));
    await page.close();
  }
  await browser.close();
  console.table(rows);
} finally {
  await vite.close();
}
