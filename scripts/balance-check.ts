// LANTERN 7 — balance-regression check.
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
/** A tower/upgrade efficiency ratio movement beyond this relative delta FAILS. */
export const EFFICIENCY_RATIO_FAIL_DELTA = 0.35;
const MIN_RATIO_BASELINE = 0.0005;

/** Flags whose flip between each other is a hard fail. */
const HARD_FLAGS = new Set(['dead', 'op']);

// ---------- types ----------

export interface BalanceDiff {
  flagFlips: { tower: string; step: string; from: string; to: string }[]; // dead<->op only (FAIL)
  winRateSwings: { cell: string; from: number; to: number; delta: number }[]; // |delta| > WIN_RATE_FAIL_DELTA plus avgWave drift (FAIL)
  efficiencySwings: { tower: string; step: string; from: number; to: number; delta: number }[]; // relative |delta| > threshold (FAIL)
  soloViability: { tower: string; from: string; to: string }[]; // viable tower became non-viable, or one tower becomes sole viable (FAIL)
  avgWaveSwings: { cell: string; from: number; to: number; delta: number }[]; // |delta| > AVG_WAVE_WARN_DELTA (warn)
  softFlags: { tower: string; step: string; from: string; to: string }[]; // any other flag change (warn)
  info: string[]; // added/removed towers, cells, steps — informational only
}

// loose shapes — we are deliberately defensive about partial / evolving reports
interface GridCell { map?: string; diff?: string; skill?: string; avgWave?: number; winRate?: number; avgLives?: number }
interface EffStep { track?: number; tier?: number; name?: string; flag?: string; valuePerCredit?: number }
interface TowerEff { id?: string; name?: string; dpsPerCreditT4?: number; steps?: EffStep[] }
interface SoloCell { id?: string; name?: string; winRate?: number; avgWave?: number }
interface Report { grid?: GridCell[]; efficiency?: TowerEff[]; solo?: SoloCell[] }

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
  const diff: BalanceDiff = { flagFlips: [], winRateSwings: [], efficiencySwings: [], soloViability: [], avgWaveSwings: [], softFlags: [], info: [] };

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
      const waveDelta = isNum(b.avgWave) && isNum(c.avgWave) ? Math.abs(c.avgWave - b.avgWave) : 0;
      if (Math.abs(delta) > WIN_RATE_FAIL_DELTA && waveDelta > AVG_WAVE_WARN_DELTA) {
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
    recordEfficiencySwing(diff, label, 'A·t4 tower efficiency', bt.dpsPerCreditT4, ct.dpsPerCreditT4);

    const baseSteps = new Map<string, EffStep>();
    for (const s of bt.steps ?? []) baseSteps.set(stepKey(id, s), s);
    const curSteps = new Map<string, EffStep>();
    for (const s of ct.steps ?? []) curSteps.set(stepKey(id, s), s);

    for (const [sk, bs] of baseSteps) {
      const cs = curSteps.get(sk);
      if (!cs) { diff.info.push(`step removed: ${label} · ${sk}`); continue; }
      const stepLabel = `${bs.name ?? cs.name ?? sk} (${sk})`;
      recordEfficiencySwing(diff, label, stepLabel, bs.valuePerCredit, cs.valuePerCredit);
      const from = bs.flag;
      const to = cs.flag;
      if (!from || !to || from === to) continue;
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

  const baseSolo = new Map<string, SoloCell>();
  for (const t of base.solo ?? []) if (t.id) baseSolo.set(t.id, t);
  const curSolo = new Map<string, SoloCell>();
  for (const t of cur.solo ?? []) if (t.id) curSolo.set(t.id, t);
  for (const [id, before] of baseSolo) {
    const after = curSolo.get(id);
    if (!after) continue;
    if (isSoloViable(before) && !isSoloViable(after)) {
      diff.soloViability.push({ tower: before.name ?? after.name ?? id, from: 'viable', to: 'non-viable' });
    }
  }
  const baseViable = [...baseSolo.values()].filter(isSoloViable);
  const curViable = [...curSolo.values()].filter(isSoloViable);
  if (curViable.length === 1 && baseViable.length !== 1) {
    const only = curViable[0];
    diff.soloViability.push({ tower: only.name ?? only.id ?? 'unknown', from: `${baseViable.length} viable`, to: 'sole viable' });
  }

  return diff;
}

function round(n: number, d = 2): number { const f = 10 ** d; return Math.round(n * f) / f; }

function recordEfficiencySwing(diff: BalanceDiff, tower: string, step: string, from: unknown, to: unknown): void {
  if (!isNum(from) || !isNum(to) || Math.abs(from) < MIN_RATIO_BASELINE) return;
  const delta = round((to - from) / from, 4);
  if (Math.abs(delta) > EFFICIENCY_RATIO_FAIL_DELTA) {
    diff.efficiencySwings.push({ tower, step, from, to, delta });
  }
}

function isSoloViable(row: SoloCell): boolean {
  return isNum(row.winRate) && row.winRate > 0;
}

/** True when the diff contains any fail-level regression. */
export function hasFailures(diff: BalanceDiff): boolean {
  return diff.flagFlips.length > 0
    || diff.winRateSwings.length > 0
    || diff.efficiencySwings.length > 0
    || diff.soloViability.length > 0;
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
  if (diff.efficiencySwings.length) {
    console.log(`\n✖ Efficiency ratio swings (relative |Δ| > ${EFFICIENCY_RATIO_FAIL_DELTA}):`);
    for (const e of diff.efficiencySwings) {
      console.log(`    ${e.tower.padEnd(18)} ${e.from.toFixed(4)} → ${e.to.toFixed(4)}  ${signed(e.delta * 100)}% · ${e.step}`);
    }
  }
  if (diff.soloViability.length) {
    console.log('\n✖ Solo viability regressions:');
    for (const s of diff.soloViability) console.log(`    ${s.tower.padEnd(18)} ${s.from} → ${s.to}`);
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
        { track: 0, tier: 1, name: 'Long-Range Optics', flag: 'ok', valuePerCredit: 0.01 },
        { track: 1, tier: 2, name: 'Overcharge', flag: 'dead', valuePerCredit: 0 },
      ], dpsPerCreditT4: 0.01 },
    ],
    solo: [
      { id: 'pulse', name: 'Pulse Turret', winRate: 1, avgWave: 50 },
      { id: 'tesla', name: 'Tesla Coil', winRate: 1, avgWave: 50 },
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
  mutated.efficiency[0].steps[0].valuePerCredit = 0.02; // +100% efficiency swing
  mutated.solo[1].winRate = 0;                 // Pulse becomes the only viable solo tower
  mutated.grid[1].winRate = 0.8;              // 0.5 → 0.8 (Δ 0.30 > 0.15)
  mutated.grid[1].avgWave = 39;               // avg-wave support for the win-rate swing
  const dirty = compareBalance(baseline, mutated);
  assert(dirty.flagFlips.length === 1, `expected 1 flagFlip, got ${dirty.flagFlips.length}`);
  assert(dirty.flagFlips[0].from === 'dead' && dirty.flagFlips[0].to === 'op', 'flag flip dead→op');
  assert(dirty.winRateSwings.length === 1, `expected 1 winRateSwing, got ${dirty.winRateSwings.length}`);
  assert(Math.abs(dirty.winRateSwings[0].delta - 0.3) < 1e-9, 'winRate delta 0.30');
  assert(dirty.efficiencySwings.length === 1, `expected 1 efficiencySwing, got ${dirty.efficiencySwings.length}`);
  assert(dirty.soloViability.length === 2, `expected 2 solo viability entries, got ${dirty.soloViability.length}`);
  assert(hasFailures(dirty), 'mutated baseline should fail');

  // defensiveness: added/removed content must not crash and lands in info
  const removed = JSON.parse(JSON.stringify(baseline));
  removed.grid.pop();
  removed.efficiency = [];
  removed.solo = [];
  const partial = compareBalance(baseline, removed);
  assert(!hasFailures(partial), 'pure removal is not a failure');
  assert(partial.info.length >= 2, 'removed content reported as info');

  // null / undefined inputs must not throw
  compareBalance(undefined, undefined);
  compareBalance(null, baseline);
  compareBalance(baseline, {});

  console.log('✓ selftest passed');
  console.log(`  · identical → clean (${clean.flagFlips.length} flips, ${clean.winRateSwings.length} swings)`);
  console.log(`  · mutated   → detected (${dirty.flagFlips.length} flip dead→op, ${dirty.winRateSwings.length} swing Δ${dirty.winRateSwings[0].delta}, ${dirty.efficiencySwings.length} efficiency, ${dirty.soloViability.length} solo)`);
  console.log(`  · partial   → ${partial.info.length} info entries, 0 failures`);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`✖ selftest assertion failed: ${msg}`); process.exit(1); }
}

// ---------- loaders ----------

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

function loadJsonFile(rawPath: string): any {
  return JSON.parse(readFileSync(resolve(process.cwd(), rawPath), 'utf8'));
}

function loadCurrent(): any {
  return loadJsonFile(REPORT_PATH);
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

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = entryPath === modulePath || /[\\/]balance-check\.(ts|js)$/.test(entryPath);

if (isMain) {
  if (process.argv.includes('--selftest')) {
    selfTest();
    process.exit(0);
  }

  const baselineArg = argValue('--baseline');
  const currentArg = argValue('--current');
  const baselineLabel = baselineArg ?? `HEAD:${REPORT_GIT_PATH}`;
  const currentLabel = currentArg ?? REPORT_PATH;

  let baseline: any | null;
  if (baselineArg) {
    try {
      baseline = loadJsonFile(baselineArg);
    } catch (err) {
      console.error(`✖ could not read baseline ${baselineArg}: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    baseline = loadBaseline();
  }
  if (baseline == null) {
    console.warn('⚠ no committed baseline at HEAD:public/balance-report.json — skipping balance check (exit 0).');
    process.exit(0);
  }

  let current: any;
  try {
    current = currentArg ? loadJsonFile(currentArg) : loadCurrent();
  } catch (err) {
    if (currentArg) {
      console.error(`✖ could not read current report ${currentArg}: ${(err as Error).message}`);
      process.exit(1);
    }
    console.warn(`⚠ could not read ${REPORT_PATH}: ${(err as Error).message} — skipping (exit 0).`);
    process.exit(0);
  }

  console.log('LANTERN 7 — balance-regression check');
  console.log(`  comparing ${currentLabel} against ${baselineLabel}\n`);

  const diff = compareBalance(baseline, current);
  printDiff(diff);

  process.exit(hasFailures(diff) ? 1 : 0);
}
