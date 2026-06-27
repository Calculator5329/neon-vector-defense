// NEON VECTOR DEFENSE — balance-regression check.
//
//   tsx scripts/balance-check.ts            — compare working-tree report vs committed baseline
//   tsx scripts/balance-check.ts --selftest — in-memory smoke test (no sim, no git)
//
// In CI, `npm run balance` regenerates public/balance-report.json in the working tree;
// this script then diffs that fresh report against the version committed at HEAD and
// exits 1 if any *fail-level* balance regression slipped in. The comparison core
// (`compareBalance`) is a pure function so it can be unit-tested without the sim.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, '../public/balance-report.json');
const REPORT_GIT_PATH = 'public/balance-report.json';

// ---------- thresholds ----------

/** A grid cell winRate change beyond this (absolute, 0..1) FAILS. */
export const WIN_RATE_FAIL_DELTA = 0.15;
/** A grid cell avgWave change beyond this (waves) is reported as a WARNING. */
export const AVG_WAVE_WARN_DELTA = 3;

/** Flags whose flip between each other is a hard fail. */
const HARD_FLAGS = new Set(['dead', 'op']);

// ---------- types ----------

export interface BalanceDiff {
  flagFlips: { tower: string; step: string; from: string; to: string }[]; // dead<->op only (FAIL)
  winRateSwings: { cell: string; from: number; to: number; delta: number }[]; // |delta| > WIN_RATE_FAIL_DELTA (FAIL)
  avgWaveSwings: { cell: string; from: number; to: number; delta: number }[]; // |delta| > AVG_WAVE_WARN_DELTA (warn)
  softFlags: { tower: string; step: string; from: string; to: string }[]; // any other flag change (warn)
  info: string[]; // added/removed towers, cells, steps — informational only
}

// loose shapes — we are deliberately defensive about partial / evolving reports
interface GridCell { map?: string; diff?: string; skill?: string; avgWave?: number; winRate?: number; avgLives?: number }
interface EffStep { track?: number; tier?: number; name?: string; flag?: string; valuePerCredit?: number }
interface TowerEff { id?: string; name?: string; steps?: EffStep[] }
interface Report { grid?: GridCell[]; efficiency?: TowerEff[] }

// ---------- key helpers ----------

const cellKey = (c: GridCell) => `${c.map}|${c.diff}|${c.skill}`;
const stepKey = (towerId: string, s: EffStep) => `${towerId}|${s.track}|${s.tier}`;

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

// ---------- pure comparison ----------

export function compareBalance(baseline: any, current: any): BalanceDiff {
  const base: Report = baseline ?? {};
  const cur: Report = current ?? {};
  const diff: BalanceDiff = { flagFlips: [], winRateSwings: [], avgWaveSwings: [], softFlags: [], info: [] };

  // ----- grid cells (winRate FAIL, avgWave WARN) -----
  const baseCells = new Map<string, GridCell>();
  for (const c of base.grid ?? []) baseCells.set(cellKey(c), c);
  const curCells = new Map<string, GridCell>();
  for (const c of cur.grid ?? []) curCells.set(cellKey(c), c);

  for (const [key, b] of baseCells) {
    const c = curCells.get(key);
    if (!c) { diff.info.push(`grid cell removed: ${key}`); continue; }
    if (isNum(b.winRate) && isNum(c.winRate)) {
      const delta = round(c.winRate - b.winRate, 4);
      if (Math.abs(delta) > WIN_RATE_FAIL_DELTA) {
        diff.winRateSwings.push({ cell: key, from: b.winRate, to: c.winRate, delta });
      }
    }
    if (isNum(b.avgWave) && isNum(c.avgWave)) {
      const delta = round(c.avgWave - b.avgWave, 2);
      if (Math.abs(delta) > AVG_WAVE_WARN_DELTA) {
        diff.avgWaveSwings.push({ cell: key, from: b.avgWave, to: c.avgWave, delta });
      }
    }
  }
  for (const key of curCells.keys()) {
    if (!baseCells.has(key)) diff.info.push(`grid cell added: ${key}`);
  }

  // ----- efficiency steps (dead<->op FAIL, other flag changes WARN) -----
  const baseTowers = new Map<string, TowerEff>();
  for (const t of base.efficiency ?? []) if (t.id) baseTowers.set(t.id, t);
  const curTowers = new Map<string, TowerEff>();
  for (const t of cur.efficiency ?? []) if (t.id) curTowers.set(t.id, t);

  for (const [id, bt] of baseTowers) {
    const ct = curTowers.get(id);
    const label = bt.name ?? id;
    if (!ct) { diff.info.push(`tower removed: ${label} (${id})`); continue; }

    const baseSteps = new Map<string, EffStep>();
    for (const s of bt.steps ?? []) baseSteps.set(stepKey(id, s), s);
    const curSteps = new Map<string, EffStep>();
    for (const s of ct.steps ?? []) curSteps.set(stepKey(id, s), s);

    for (const [sk, bs] of baseSteps) {
      const cs = curSteps.get(sk);
      if (!cs) { diff.info.push(`step removed: ${label} · ${sk}`); continue; }
      const from = bs.flag;
      const to = cs.flag;
      if (!from || !to || from === to) continue;
      const stepLabel = `${bs.name ?? cs.name ?? sk} (${sk})`;
      if (HARD_FLAGS.has(from) && HARD_FLAGS.has(to)) {
        // dead<->op in either direction
        diff.flagFlips.push({ tower: label, step: stepLabel, from, to });
      } else {
        diff.softFlags.push({ tower: label, step: stepLabel, from, to });
      }
    }
    for (const sk of curSteps.keys()) {
      if (!baseSteps.has(sk)) diff.info.push(`step added: ${label} · ${sk}`);
    }
  }
  for (const [id, t] of curTowers) {
    if (!baseTowers.has(id)) diff.info.push(`tower added: ${t.name ?? id} (${id})`);
  }

  return diff;
}

function round(n: number, d = 2): number { const f = 10 ** d; return Math.round(n * f) / f; }

/** True when the diff contains any fail-level regression. */
export function hasFailures(diff: BalanceDiff): boolean {
  return diff.flagFlips.length > 0 || diff.winRateSwings.length > 0;
}

// ---------- reporting ----------

function printDiff(diff: BalanceDiff): void {
  const fails = hasFailures(diff);

  if (diff.flagFlips.length) {
    console.log('\n✖ HARD flag flips (dead ↔ op):');
    for (const f of diff.flagFlips) console.log(`    ${f.tower.padEnd(18)} ${f.from.padEnd(5)} → ${f.to.padEnd(5)} · ${f.step}`);
  }
  if (diff.winRateSwings.length) {
    console.log(`\n✖ Win-rate swings (|Δ| > ${WIN_RATE_FAIL_DELTA}):`);
    console.log('    cell                              from →   to    Δ');
    for (const w of diff.winRateSwings) {
      console.log(`    ${w.cell.padEnd(32)} ${pct(w.from)} → ${pct(w.to)}  ${signed(w.delta * 100)}%`);
    }
  }
  if (diff.avgWaveSwings.length) {
    console.log(`\n⚠ Avg-wave swings (|Δ| > ${AVG_WAVE_WARN_DELTA}, warn only):`);
    for (const w of diff.avgWaveSwings) {
      console.log(`    ${w.cell.padEnd(32)} ${String(w.from).padStart(5)} → ${String(w.to).padStart(5)}  ${signed(w.delta)}`);
    }
  }
  if (diff.softFlags.length) {
    console.log('\n⚠ Soft flag changes (warn only):');
    for (const f of diff.softFlags) console.log(`    ${f.tower.padEnd(18)} ${f.from.padEnd(5)} → ${f.to.padEnd(5)} · ${f.step}`);
  }
  if (diff.info.length) {
    console.log('\nℹ Content changes (added/removed, informational):');
    for (const i of diff.info) console.log(`    · ${i}`);
  }

  if (!fails && !diff.avgWaveSwings.length && !diff.softFlags.length) {
    console.log('✓ no balance regressions');
  } else if (!fails) {
    console.log('\n✓ no fail-level balance regressions (warnings above)');
  } else {
    console.log('\n✖ balance regressions detected');
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
const signed = (n: number) => (n >= 0 ? '+' : '') + round(n, 2);

// ---------- self-test (no sim, no git) ----------

function selfTest(): void {
  const baseline = {
    grid: [
      { map: 'orbital', diff: 'easy', skill: 'rookie', avgWave: 50, winRate: 1, avgLives: 49 },
      { map: 'reactor', diff: 'hard', skill: 'expert', avgWave: 32, winRate: 0.5, avgLives: 10 },
    ],
    efficiency: [
      { id: 'pulse', name: 'Pulse Turret', steps: [
        { track: 0, tier: 1, name: 'Long-Range Optics', flag: 'ok', valuePerCredit: 0 },
        { track: 1, tier: 2, name: 'Overcharge', flag: 'dead', valuePerCredit: 0 },
      ] },
    ],
  };

  // identical copy must be clean
  const identical = JSON.parse(JSON.stringify(baseline));
  const clean = compareBalance(baseline, identical);
  assert(!hasFailures(clean), 'identical baseline should be clean');
  assert(clean.flagFlips.length === 0 && clean.winRateSwings.length === 0, 'identical baseline: no diffs');

  // mutate: flip a dead→op flag, and bump a winRate by 0.3
  const mutated = JSON.parse(JSON.stringify(baseline));
  mutated.efficiency[0].steps[1].flag = 'op'; // dead → op (hard flip)
  mutated.grid[1].winRate = 0.8;              // 0.5 → 0.8 (Δ 0.30 > 0.15)
  const dirty = compareBalance(baseline, mutated);
  assert(dirty.flagFlips.length === 1, `expected 1 flagFlip, got ${dirty.flagFlips.length}`);
  assert(dirty.flagFlips[0].from === 'dead' && dirty.flagFlips[0].to === 'op', 'flag flip dead→op');
  assert(dirty.winRateSwings.length === 1, `expected 1 winRateSwing, got ${dirty.winRateSwings.length}`);
  assert(Math.abs(dirty.winRateSwings[0].delta - 0.3) < 1e-9, 'winRate delta 0.30');
  assert(hasFailures(dirty), 'mutated baseline should fail');

  // defensiveness: added/removed content must not crash and lands in info
  const removed = JSON.parse(JSON.stringify(baseline));
  removed.grid.pop();
  removed.efficiency = [];
  const partial = compareBalance(baseline, removed);
  assert(!hasFailures(partial), 'pure removal is not a failure');
  assert(partial.info.length >= 2, 'removed content reported as info');

  // null / undefined inputs must not throw
  compareBalance(undefined, undefined);
  compareBalance(null, baseline);
  compareBalance(baseline, {});

  console.log('✓ selftest passed');
  console.log(`  · identical → clean (${clean.flagFlips.length} flips, ${clean.winRateSwings.length} swings)`);
  console.log(`  · mutated   → detected (${dirty.flagFlips.length} flip dead→op, ${dirty.winRateSwings.length} swing Δ${dirty.winRateSwings[0].delta})`);
  console.log(`  · partial   → ${partial.info.length} info entries, 0 failures`);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`✖ selftest assertion failed: ${msg}`); process.exit(1); }
}

// ---------- loaders ----------

function loadCurrent(): any {
  return JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
}

/** Read the committed baseline from HEAD. Returns null (with a warning) if unavailable. */
function loadBaseline(): any | null {
  try {
    const raw = execSync(`git show HEAD:${REPORT_GIT_PATH}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------- CLI ----------

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes('--selftest')) {
    selfTest();
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (baseline == null) {
    console.warn('⚠ no committed baseline at HEAD:public/balance-report.json — skipping balance check (exit 0).');
    process.exit(0);
  }

  let current: any;
  try {
    current = loadCurrent();
  } catch (err) {
    console.warn(`⚠ could not read ${REPORT_PATH}: ${(err as Error).message} — skipping (exit 0).`);
    process.exit(0);
  }

  console.log('NEON VECTOR DEFENSE — balance-regression check');
  console.log('  comparing working-tree report against committed baseline (HEAD)\n');

  const diff = compareBalance(baseline, current);
  printDiff(diff);

  process.exit(hasFailures(diff) ? 1 : 0);
}
