// Generate src/game/ghostCurveData.ts from public/balance-report.json.
// Run standalone (`node scripts/genGhostCurves.mjs`) or automatically at the end of
// `npm run balance`. Keeps the player-bundled ghost asset tiny: one lite curve per
// {map,diff}, points downsampled to wave 1 + every other wave + the final point, and
// only {wave, coreFraction} (cores are reconstructed at runtime via DIFFICULTIES).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT = resolve(__dirname, '../public/balance-report.json');
const OUT = resolve(__dirname, '../src/game/ghostCurveData.ts');

function downsample(points) {
  if (!points?.length) return [];
  const last = points[points.length - 1];
  const out = [];
  for (const p of points) {
    if (p.wave === 1 || p.wave % 2 === 0 || p === last) out.push(p);
  }
  return out;
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
const build = report.meta?.build ?? report.meta?.telemetryBuild ?? 'hollow-1';
const minSeeds = Number(process.env.NVD_MIN_GHOST_SEEDS ?? 3);
if (report.meta?.quick || Number(report.meta?.curveSeeds ?? 0) < minSeeds) {
  throw new Error(`Refusing to bundle quick/anecdotal ghost curves. Run npm run balance without "quick" and use at least ${minSeeds} curve seeds.`);
}

const lite = (report.curves ?? []).map((c) => ({
  map: c.map,
  diff: c.diff,
  skill: c.skill,
  winRate: +Number(c.winRate ?? 0).toFixed(4),
  avgFinalWave: +Number(c.avgFinalWave ?? 0).toFixed(2),
  points: downsample(c.points).map((p) => ({
    wave: p.wave,
    coreFraction: +Number(p.coreFraction ?? 0).toFixed(4),
    leakPct: +Number(p.leakPct ?? 0).toFixed(4),
    pressure: +Number(p.pressure ?? 0).toFixed(4),
    creditsStart: Math.round(Number(p.creditsStart ?? 0)),
    towersStart: +Number(p.towersStart ?? 0).toFixed(1),
  })),
}));

const src = `// AUTO-GENERATED from public/balance-report.json by scripts/genGhostCurves.mjs.
// Do not edit by hand — re-run \`npm run balance\` or \`node scripts/genGhostCurves.mjs\`.
import type { WaveCurveLite } from './ghostCurve';

export const GHOST_BUILD = ${JSON.stringify(build)};
export const GHOST_CURVES_RAW: WaveCurveLite[] = ${JSON.stringify(lite)};
`;

writeFileSync(OUT, src);
const kb = (Buffer.byteLength(src) / 1024).toFixed(1);
console.log(`✔ wrote ${OUT} · ${lite.length} curves · ${kb} KB`);
