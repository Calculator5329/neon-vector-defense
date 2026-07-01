// NEON VECTOR DEFENSE — full balance harness.
//   npm run balance          — full pass (writes public/balance-report.json)
//   npm run balance -- quick  — fewer seeds / smaller matrix for a fast look
//
// Produces:
//   1. per-wave balance curves (where difficulty spikes/dips) per map × difficulty
//   2. a win grid (rookie/standard/expert × map × difficulty)
//   3. static tower & upgrade cost-efficiency tables (raw/effective DPS, DPS-per-credit)
//   4. strategy-matrix sims (dominant strategies, never-build towers)
//   5. solo-viability (which towers can carry a lane alone)
// …and a JSON report the in-app admin dashboard reads, plus a console summary.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { ALL_MAPS, DIFFICULTIES } from '../src/game/maps';
import { setMuted, setMusic } from '../src/game/sound';
import { runInstrumented, type WaveRecord } from './balance/run';
import { analyzeEfficiency, type TowerEfficiency } from './balance/efficiency';
import { runStrategies, runSoloViability, type StrategyResult, type SoloResult } from './balance/strategy';
import type { BotSkill } from '../src/game/bot';

setMuted(true);
setMusic(false);

const QUICK = process.argv.includes('quick');
const GATE = process.argv.includes('--gate');
const CURVE_SEEDS = QUICK ? 1 : 3;
const GRID_SEEDS = QUICK ? 1 : 2;
const STRAT_SEEDS = QUICK ? 1 : 2;
const SOLO_SEEDS = QUICK ? 1 : 2;

const CURVE_SKILLS: BotSkill[] = ['rookie', 'standard', 'expert'];

// the skill each protocol is BALANCED around — used by the admin dashboard as context
const MATCH: Record<string, BotSkill> = {
  easy: 'rookie', normal: 'standard', hard: 'expert', extinction: 'expert', ngplus: 'expert',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(__dirname, '../public/balance-report.json');
const OUT = resolveOutputPath(argValue('--out'));

function fmt(n: number, w: number): string { return String(n).padStart(w); }

function argValue(name: string): string | null {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;

  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

function resolveOutputPath(rawPath: string | null): string {
  return rawPath ? resolve(process.cwd(), rawPath) : DEFAULT_OUT;
}

// ---------- 1. per-wave balance curves ----------

interface CurvePoint {
  wave: number;
  reached: number;     // how many seeded runs reached this wave
  leakPct: number;     // avg fraction of the wave that leaked
  pressure: number;    // avg cores lost this wave / cores at wave start
  livesLost: number;   // avg cores lost this wave
  coreFraction: number;// avg cores remaining (fraction)
  creditsStart: number;// avg credits banked at wave launch
  towersStart: number; // avg towers standing
}

interface WaveCurve {
  map: string;
  diff: string;
  skill: BotSkill;
  winRate: number;
  avgFinalWave: number;
  points: CurvePoint[];
}

function aggregate(runs: WaveRecord[][]): CurvePoint[] {
  const byWave = new Map<number, WaveRecord[]>();
  for (const run of runs) for (const w of run) {
    (byWave.get(w.wave) ?? byWave.set(w.wave, []).get(w.wave)!).push(w);
  }
  const points: CurvePoint[] = [];
  for (const [wave, recs] of [...byWave.entries()].sort((a, b) => a[0] - b[0])) {
    const n = recs.length;
    const avg = (f: (r: WaveRecord) => number) => recs.reduce((s, r) => s + f(r), 0) / n;
    points.push({
      wave, reached: n,
      leakPct: round(avg((r) => r.leakPct), 3),
      pressure: round(avg((r) => r.pressure), 3),
      livesLost: round(avg((r) => r.livesLost), 1),
      coreFraction: round(avg((r) => r.coreFraction), 3),
      creditsStart: Math.round(avg((r) => r.creditsStart)),
      towersStart: round(avg((r) => r.towersStart), 1),
    });
  }
  return points;
}

function buildCurves(): WaveCurve[] {
  const curves: WaveCurve[] = [];
  for (const skill of CURVE_SKILLS) {
    for (const map of ALL_MAPS) {
      for (const diff of DIFFICULTIES) {
        const runs: WaveRecord[][] = [];
        let wins = 0, waveSum = 0;
        for (let s = 0; s < CURVE_SEEDS; s++) {
          const r = runInstrumented(map, diff, skill);
          runs.push(r.waves);
          if (r.won) wins++;
          waveSum += r.finalWave;
        }
        curves.push({
          map: map.id, diff: diff.id, skill,
          winRate: round(wins / CURVE_SEEDS, 2),
          avgFinalWave: round(waveSum / CURVE_SEEDS, 1),
          points: aggregate(runs),
        });
      }
    }
  }
  return curves;
}

// ---------- 2. win grid ----------

interface GridCell { map: string; diff: string; skill: BotSkill; avgWave: number; winRate: number; avgLives: number }

function buildGrid(): GridCell[] {
  const skills: BotSkill[] = ['rookie', 'standard', 'expert'];
  const cells: GridCell[] = [];
  for (const skill of skills) {
    for (const map of ALL_MAPS) {
      for (const diff of DIFFICULTIES) {
        let waveSum = 0, wins = 0, lives = 0;
        for (let s = 0; s < GRID_SEEDS; s++) {
          const r = runInstrumented(map, diff, skill);
          waveSum += r.finalWave;
          if (r.won) wins++;
          lives += r.livesLeft;
        }
        cells.push({
          map: map.id, diff: diff.id, skill,
          avgWave: round(waveSum / GRID_SEEDS, 1),
          winRate: round(wins / GRID_SEEDS, 2),
          avgLives: Math.round(lives / GRID_SEEDS),
        });
      }
    }
  }
  return cells;
}

function round(n: number, d = 1): number { const f = 10 ** d; return Math.round(n * f) / f; }

// ---------- run everything ----------

console.log(`NEON VECTOR DEFENSE — balance harness${QUICK ? ' (quick)' : ''}${GATE ? ' gate' : ''}`);
console.log(`curve seeds ${CURVE_SEEDS} · grid seeds ${GRID_SEEDS} · strat seeds ${STRAT_SEEDS}\n`);
const t0 = Date.now();

console.log('▸ per-wave curves…');
if (GATE) console.log('  skipped for balance gate');
const curves = GATE ? [] : buildCurves();

console.log('▸ win grid…');
const grid = buildGrid();

console.log('▸ tower & upgrade efficiency…');
const { towers: efficiency, medianDpsPerCredit } = analyzeEfficiency();

// representative slices for the (expensive) strategy + solo sims
const stratMap = ALL_MAPS.find((m) => m.id === 'reactor')!;
const stratDiff = DIFFICULTIES.find((d) => d.id === 'normal')!;
const soloMap = ALL_MAPS.find((m) => m.id === 'orbital')!;
const soloDiff = DIFFICULTIES.find((d) => d.id === 'normal')!;

console.log('▸ strategy matrix…');
if (GATE) console.log('  skipped for balance gate');
const strategyResults: StrategyResult[] = GATE ? [] : runStrategies(stratMap, stratDiff, STRAT_SEEDS);

console.log('▸ solo viability…');
const soloResults: SoloResult[] = runSoloViability(soloMap, soloDiff, SOLO_SEEDS);

const report = {
  generatedAt: new Date().toISOString(),
  meta: {
    quick: QUICK, gate: GATE,
    curveSeeds: CURVE_SEEDS, gridSeeds: GRID_SEEDS, stratSeeds: STRAT_SEEDS, soloSeeds: SOLO_SEEDS,
    matchSkill: MATCH,
    strategyArena: { map: stratMap.id, diff: stratDiff.id },
    soloArena: { map: soloMap.id, diff: soloDiff.id },
    medianDpsPerCredit,
  },
  curves,
  grid,
  efficiency,
  strategies: strategyResults,
  solo: soloResults,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

// Regenerate the bundled bot-ghost asset only from the full report. Quick reports
// are useful diagnostics, but their one-seed curves are too noisy for player-facing
// AI Rival comparisons.
if (!QUICK) {
  try {
    execFileSync(process.execPath, [resolve(__dirname, 'genGhostCurves.mjs')], { stdio: 'inherit' });
  } catch (err) {
    console.warn('ghost-curve asset regeneration failed (non-fatal):', err);
  }
} else {
  console.log('skipped bundled ghost-curve regeneration for quick balance report');
}

// ---------- console summary ----------

printGrid(grid);
printCurveHighlights(curves);
printEfficiency(efficiency, medianDpsPerCredit);
printStrategies(strategyResults, stratMap.id, stratDiff.id);
printSolo(soloResults, soloMap.id, soloDiff.id);

console.log(`\n✔ wrote ${OUT}`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s · ${curves.length} curves · ${efficiency.length} towers · ${strategyResults.length} strategies`);

// ---------- printers ----------

function name(id: string, list: { id: string; name: string }[]): string {
  return list.find((x) => x.id === id)?.name ?? id;
}

function printGrid(grid: GridCell[]) {
  console.log('\n=== WIN GRID (avg final wave · win%) ===');
  const skills: BotSkill[] = ['rookie', 'standard', 'expert'];
  for (const skill of skills) {
    console.log(`\n  ${skill.toUpperCase()}`);
    console.log('  map               | ' + DIFFICULTIES.map((d) => d.name.slice(0, 9).padEnd(10)).join('| '));
    for (const map of ALL_MAPS) {
      const cells = DIFFICULTIES.map((d) => {
        const c = grid.find((g) => g.map === map.id && g.diff === d.id && g.skill === skill)!;
        return `${fmt(Math.round(c.avgWave), 3)}·${Math.round(c.winRate * 100)}%`.padEnd(10);
      });
      console.log(`  ${map.name.padEnd(17)} | ${cells.join('| ')}`);
    }
  }
}

function printCurveHighlights(curves: WaveCurve[]) {
  console.log('\n=== PER-WAVE BALANCE CURVE — spike/dip detection ===');
  console.log('(flagging the waves with the worst average pressure per matched-skill run)');
  for (const c of curves) {
    if (c.points.length === 0) continue;
    const sorted = [...c.points].sort((a, b) => b.pressure - a.pressure);
    const worst = sorted.slice(0, 3).filter((p) => p.pressure > 0.02);
    const mn = name(c.map, ALL_MAPS as { id: string; name: string }[]);
    const dn = name(c.diff, DIFFICULTIES);
    const tag = c.winRate >= 1 ? 'WIN ' : c.winRate > 0 ? 'PART' : 'LOSS';
    const spikes = worst.length
      ? worst.map((p) => `w${p.wave}(${Math.round(p.pressure * 100)}%${p.leakPct > 0 ? `/leak${Math.round(p.leakPct * 100)}%` : ''})`).join(' ')
      : 'no notable pressure';
    console.log(`  ${tag} ${mn.padEnd(17)} ${dn.padEnd(11)} [${c.skill}] reach w${Math.round(c.avgFinalWave)} · spikes: ${spikes}`);
  }
}

function printEfficiency(towers: TowerEfficiency[], median: number) {
  console.log('\n=== TOWER COST-EFFICIENCY (at A·t4 build, costMult 1) ===');
  console.log('  tower             | style     | rawDPS | DPS/⌬  | vsArmor | vsCloak | vsBoss | value');
  const sorted = [...towers].sort((a, b) => b.dpsPerCreditT4 - a.dpsPerCreditT4);
  for (const t of sorted) {
    const b = t.builds[1];
    let val = 'util';
    if (t.style !== 'support' && t.rawDpsT4 > 0) {
      val = t.dpsPerCreditT4 >= median * 1.4 ? 'OVER+' : t.dpsPerCreditT4 <= median * 0.6 ? 'under-' : 'fair';
    }
    console.log(
      `  ${t.name.padEnd(17)} | ${t.style.padEnd(9)} | ${fmt(t.rawDpsT4, 6)} | ${b.dpsPerCredit.toFixed(3).padStart(6)} | ${fmt(b.vsArmored, 7)} | ${fmt(b.vsCloaked, 7)} | ${fmt(b.vsBoss, 6)} | ${val}`,
    );
  }
  // dead / OP upgrade steps
  const dead: string[] = [];
  const op: string[] = [];
  for (const t of towers) for (const s of t.steps) {
    if (s.flag === 'dead') dead.push(`${t.name} · ${s.trackName} t${s.tier} "${s.name}"`);
    if (s.flag === 'op') op.push(`${t.name} · ${s.trackName} t${s.tier} "${s.name}" (${s.valuePerCredit.toFixed(3)} dps/⌬)`);
  }
  if (dead.length) { console.log('\n  ⚠ DEAD upgrade steps (no dps, no utility):'); for (const d of dead) console.log(`    · ${d}`); }
  if (op.length) {
    console.log('\n  ★ Standout-value upgrade steps (top dps-per-credit):');
    for (const o of op.sort().slice(0, 12)) console.log(`    · ${o}`);
  }
}

function printStrategies(res: StrategyResult[], mapId: string, diffId: string) {
  console.log(`\n=== STRATEGY MATRIX (${name(mapId, ALL_MAPS as { id: string; name: string }[])} · ${name(diffId, DIFFICULTIES)}) ===`);
  console.log('  strategy         | avg wave | best | win%  | avg lives');
  for (const r of res) {
    console.log(`  ${r.name.padEnd(16)} | ${fmt(Math.round(r.avgWave), 8)} | ${fmt(r.bestWave, 4)} | ${fmt(Math.round(r.winRate * 100), 4)}% | ${fmt(r.avgLives, 9)}`);
  }
}

function printSolo(res: SoloResult[], mapId: string, diffId: string) {
  console.log(`\n=== SOLO VIABILITY — one tower kind, maxed (${name(mapId, ALL_MAPS as { id: string; name: string }[])} · ${name(diffId, DIFFICULTIES)}) ===`);
  console.log('  tower             | avg wave | best | win%');
  for (const r of res) {
    console.log(`  ${r.name.padEnd(17)} | ${fmt(Math.round(r.avgWave), 8)} | ${fmt(r.bestWave, 4)} | ${fmt(Math.round(r.winRate * 100), 4)}%`);
  }
}
