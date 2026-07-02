// Broad tower balance deep dive.
//
// Produces:
//   public/tower-deep-dive-report.json  raw static + simulated data
//   public/tower-deep-dive-sims.csv     flat simulation table for spreadsheets
//   docs/tower-balance-deep-dive.md     readable balance notes
//
// Usage:
//   npm run tower:deep-dive
//   npm run tower:deep-dive -- quick
//   npm run tower:deep-dive -- full

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Game } from '../src/game/engine';
import { Bot, type Profile } from '../src/game/bot';
import { ALL_MAPS, DIFFICULTIES } from '../src/game/maps';
import { getWave } from '../src/game/waves';
import { rbe } from '../src/game/enemies';
import { TOWERS, computeStats } from '../src/game/towers';
import type { DifficultyDef, GameMap, TowerDef } from '../src/game/types';
import { analyzeEfficiency, dpsOf, effectiveVs, totalCost } from './balance/efficiency';

const DT = 1 / 20;
const MAX_TIME = 60 * 90;
const BUILD_WINDOW = 4;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = resolve(__dirname, '../public/tower-deep-dive-report.json');
const OUT_CSV = resolve(__dirname, '../public/tower-deep-dive-sims.csv');
const OUT_MD = resolve(__dirname, '../docs/tower-balance-deep-dive.md');

type Preset = 'quick' | 'broad' | 'full';
const preset: Preset = process.argv.includes('full') ? 'full' : process.argv.includes('quick') ? 'quick' : 'broad';

interface Stage {
  id: string;
  label: string;
  a: number;
  b: number;
}

const ALL_STAGES: Stage[] = [
  { id: 'base', label: 'Base', a: 0, b: 0 },
  { id: 'a2', label: 'A2', a: 2, b: 0 },
  { id: 'b2', label: 'B2', a: 0, b: 2 },
  { id: 'a4', label: 'A4', a: 4, b: 0 },
  { id: 'b4', label: 'B4', a: 0, b: 4 },
  { id: 'split22', label: 'Split 2/2', a: 2, b: 2 },
  { id: 'split44', label: 'Split 4/4', a: 4, b: 4 },
  { id: 'a6', label: 'A6', a: 6, b: 0 },
  { id: 'b6', label: 'B6', a: 0, b: 6 },
  { id: 'a6b4', label: 'A6+B4', a: 6, b: 4 },
  { id: 'a4b6', label: 'A4+B6', a: 4, b: 6 },
];

const QUICK_STAGES = ['base', 'a4', 'b4', 'a6', 'b6'];
const BROAD_STAGES = ['base', 'a2', 'b2', 'a4', 'b4', 'split44', 'a6', 'b6', 'a6b4', 'a4b6'];

function selectedStages(): Stage[] {
  const ids = preset === 'quick' ? QUICK_STAGES : preset === 'full' ? ALL_STAGES.map((s) => s.id) : BROAD_STAGES;
  return ALL_STAGES.filter((s) => ids.includes(s.id));
}

function selectedMaps(): GameMap[] {
  if (preset === 'quick') return byIds(ALL_MAPS, ['orbital', 'reactor']);
  if (preset === 'full') return ALL_MAPS;
  return byIds(ALL_MAPS, ['orbital', 'reactor', 'blackout', 'cinder']);
}

function selectedDiffs(): DifficultyDef[] {
  if (preset === 'quick') return byIds(DIFFICULTIES, ['normal']);
  if (preset === 'full') return byIds(DIFFICULTIES, ['easy', 'normal', 'hard', 'extinction']);
  return byIds(DIFFICULTIES, ['normal', 'hard']);
}

function byIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  return ids.map((id) => {
    const item = items.find((x) => x.id === id);
    if (!item) throw new Error(`Missing id ${id}`);
    return item;
  });
}

function spamProfile(tower: string, a: number, b: number): Profile {
  const step = { tower, a, b };
  return {
    actInterval: 0.5,
    plan: Array.from({ length: 24 }, () => ({ ...step })),
    filler: { ...step },
    upgradeDiligence: 1,
    abilityChance: 1,
    reserve: 1,
  };
}

function waveMaxLeak(waveNumber: number): number {
  return getWave(waveNumber).reduce((sum, grp) => sum + grp.count * rbe(grp.type), 0);
}

interface WaveRecord {
  wave: number;
  livesStart: number;
  livesEnd: number;
  livesLost: number;
  creditsStart: number;
  towersStart: number;
  maxLeak: number;
  leakPct: number;
  pressure: number;
  coreFraction: number;
  durationS: number;
}

interface SimResult {
  towerId: string;
  towerName: string;
  stageId: string;
  stageLabel: string;
  tierA: number;
  tierB: number;
  map: string;
  mapName: string;
  difficulty: string;
  difficultyName: string;
  won: boolean;
  finalWave: number;
  targetWaves: number;
  progressPct: number;
  livesLeft: number;
  startingLives: number;
  corePct: number;
  leaks: number;
  cashEarned: number;
  towersBuilt: number;
  totalDamage: number;
  damageByTower: Record<string, number>;
  killsByEnemy: Record<string, number>;
  waves: WaveRecord[];
  firstLeakWave: number | null;
  worstWave: WaveRecord | null;
}

function runSim(map: GameMap, diff: DifficultyDef, def: TowerDef, stage: Stage): SimResult {
  const game = new Game(map, diff);
  const bot = new Bot(game, spamProfile(def.id, stage.a, stage.b));
  const startingLives = game.lives;
  const waves: WaveRecord[] = [];
  let time = 0;
  let idle = 0;
  let open: { wave: number; livesStart: number; creditsStart: number; towersStart: number; t0: number } | null = null;

  const close = (livesEnd: number) => {
    if (!open) return;
    const maxLeak = Math.max(1, waveMaxLeak(open.wave));
    const livesLost = Math.max(0, open.livesStart - livesEnd);
    waves.push({
      wave: open.wave,
      livesStart: open.livesStart,
      livesEnd,
      livesLost,
      creditsStart: Math.round(open.creditsStart),
      towersStart: open.towersStart,
      maxLeak,
      leakPct: livesLost / maxLeak,
      pressure: open.livesStart > 0 ? livesLost / open.livesStart : 0,
      coreFraction: startingLives > 0 ? livesEnd / startingLives : 0,
      durationS: round(time - open.t0, 2),
    });
    open = null;
  };

  while (time < MAX_TIME) {
    if (game.phase === 'gameover') { close(game.lives); break; }
    if (game.phase === 'victory') { close(game.lives); break; }

    if (game.phase === 'build') {
      idle += DT;
      bot.act(time);
      if (idle > BUILD_WINDOW) {
        idle = 0;
        game.startWave();
        open = {
          wave: game.wave,
          livesStart: game.lives,
          creditsStart: game.credits,
          towersStart: game.towers.length,
          t0: time,
        };
      }
    } else {
      bot.act(time);
    }

    game.update(DT);
    time += DT;
    if (open && game.phase !== 'wave') close(game.lives);
  }
  if (open) close(game.lives);

  const totalDamage = Object.values(game.runStats.dmg).reduce((sum, n) => sum + n, 0);
  const worstWave = waves.length > 0 ? [...waves].sort((a, b) => b.pressure - a.pressure)[0] : null;
  const firstLeak = waves.find((w) => w.livesLost > 0)?.wave ?? null;
  return {
    towerId: def.id,
    towerName: def.name,
    stageId: stage.id,
    stageLabel: stage.label,
    tierA: stage.a,
    tierB: stage.b,
    map: map.id,
    mapName: map.name,
    difficulty: diff.id,
    difficultyName: diff.name,
    won: game.phase === 'victory',
    finalWave: game.wave,
    targetWaves: diff.waves,
    progressPct: round(Math.min(1, game.wave / diff.waves), 4),
    livesLeft: game.lives,
    startingLives,
    corePct: round(startingLives > 0 ? game.lives / startingLives : 0, 4),
    leaks: Math.round(game.runStats.leaks),
    cashEarned: Math.round(game.runStats.cashEarned),
    towersBuilt: game.towers.length,
    totalDamage: Math.round(totalDamage),
    damageByTower: intRecord(game.runStats.dmg),
    killsByEnemy: intRecord(game.runStats.kills),
    waves,
    firstLeakWave: firstLeak,
    worstWave,
  };
}

interface StaticBuild {
  towerId: string;
  towerName: string;
  style: string;
  tierA: number;
  tierB: number;
  cost: number;
  singleDps: number;
  aoeDps: number;
  burnDps: number;
  dpsPerCredit: number;
  aoePerCredit: number;
  vsArmored: number;
  vsExplosiveImmune: number;
  vsCryoImmune: number;
  vsCloaked: number;
  vsBoss: number;
  utility: string[];
  opScore: number;
}

function legalBuilds(def: TowerDef): StaticBuild[] {
  const out: StaticBuild[] = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 6; b++) {
      if (a > 4 && b > 4) continue;
      const stats = computeStats(def, a, b);
      const d = dpsOf(def, stats);
      const cost = totalCost(def, a, b);
      const single = d.single + d.burn;
      const aoe = d.aoe + d.burn * 5;
      out.push({
        towerId: def.id,
        towerName: def.name,
        style: def.style,
        tierA: a,
        tierB: b,
        cost,
        singleDps: round(single, 2),
        aoeDps: round(aoe, 2),
        burnDps: round(d.burn, 2),
        dpsPerCredit: round(single / Math.max(1, cost), 6),
        aoePerCredit: round(aoe / Math.max(1, cost), 6),
        vsArmored: round(effectiveVs(def, stats, 'armored'), 2),
        vsExplosiveImmune: round(effectiveVs(def, stats, 'explosiveImmune'), 2),
        vsCryoImmune: round(effectiveVs(def, stats, 'cryoImmune'), 2),
        vsCloaked: round(effectiveVs(def, stats, 'cloaked'), 2),
        vsBoss: round(effectiveVs(def, stats, 'boss'), 2),
        utility: d.utility,
        opScore: 0,
      });
    }
  }
  return out;
}

type TowerVerdict = 'OP' | 'strong' | 'fair' | 'weak' | 'utility/needs-support';

interface TowerSummary {
  id: string;
  name: string;
  style: string;
  unlockAt: number;
  cost: number;
  bestStaticBuild: string;
  bestStaticAoePerCredit: number;
  bestStaticDpsPerCredit: number;
  avgProgressPct: number;
  winRate: number;
  avgCorePctOnWins: number;
  veteranWinRate: number;
  veteranAvgCorePctOnWins: number;
  apexWinRate: number;
  flawlessWins: number;
  bestSim: string;
  bestSimProgressPct: number;
  bestSimCorePct: number;
  opScore: number;
  verdict: TowerVerdict;
  strengths: string[];
  weaknesses: string[];
  notableStages: string[];
}

function summarizeTowers(staticBuilds: StaticBuild[], sims: SimResult[], medianAoePerCredit: number): TowerSummary[] {
  return TOWERS.map((def) => {
    const builds = staticBuilds.filter((b) => b.towerId === def.id);
    const towerSims = sims.filter((s) => s.towerId === def.id);
    const bestStatic = [...builds].sort((a, b) => b.aoePerCredit - a.aoePerCredit)[0];
    const bestSim = [...towerSims].sort((a, b) => {
      const scoreA = simPower(a);
      const scoreB = simPower(b);
      return scoreB - scoreA;
    })[0];
    const wins = towerSims.filter((s) => s.won);
    const veteranSims = towerSims.filter((s) => s.difficulty === 'normal');
    const veteranWins = veteranSims.filter((s) => s.won);
    const apexSims = towerSims.filter((s) => s.difficulty === 'hard');
    const apexWins = apexSims.filter((s) => s.won);
    const flawlessWins = wins.filter((s) => s.corePct >= 0.98).length;
    const avgProgressPct = avg(towerSims.map((s) => s.progressPct));
    const winRate = towerSims.length ? wins.length / towerSims.length : 0;
    const avgCorePctOnWins = wins.length ? avg(wins.map((s) => s.corePct)) : 0;
    const veteranWinRate = veteranSims.length ? veteranWins.length / veteranSims.length : 0;
    const veteranAvgCorePctOnWins = veteranWins.length ? avg(veteranWins.map((s) => s.corePct)) : 0;
    const apexWinRate = apexSims.length ? apexWins.length / apexSims.length : 0;
    const stageWins = groupBy(towerSims, (s) => s.stageId);
    const notableStages = [...stageWins.entries()]
      .map(([stage, rows]) => ({
        stage,
        winRate: rows.filter((r) => r.won).length / rows.length,
        progress: avg(rows.map((r) => r.progressPct)),
        core: avg(rows.filter((r) => r.won).map((r) => r.corePct)),
      }))
      .sort((a, b) => (b.winRate - a.winRate) || (b.progress - a.progress))
      .slice(0, 4)
      .map((s) => `${s.stage}: ${pct(s.winRate)} wins, ${pct(s.progress)} avg progress${s.core ? `, ${pct(s.core)} win cores` : ''}`);
    const staticRatio = medianAoePerCredit > 0 ? bestStatic.aoePerCredit / medianAoePerCredit : 0;
    // Static whole-lane capstones can produce enormous AoE-per-credit ratios.
    // Cap the static contribution so verdicts are led by simulation outcomes.
    const opScore = round(Math.min(staticRatio, 3) * 0.6 + veteranWinRate * 3.5 + apexWinRate * 3 + avgCorePctOnWins * 1.6 + avgProgressPct * 0.7, 3);
    const verdict: TowerVerdict =
      (veteranWinRate >= 0.45 && veteranAvgCorePctOnWins >= 0.85) || (winRate >= 0.35 && avgCorePctOnWins >= 0.75) ? 'OP' :
        winRate >= 0.18 || veteranWinRate >= 0.25 || staticRatio >= 2.4 ? 'strong' :
          def.base.damage === 0 && bestStatic.singleDps <= 0 ? 'utility/needs-support' :
            avgProgressPct < 0.45 && staticRatio < 0.9 ? 'weak' : 'fair';
    return {
      id: def.id,
      name: def.name,
      style: def.style,
      unlockAt: def.unlockAt,
      cost: def.cost,
      bestStaticBuild: `${bestStatic.tierA}/${bestStatic.tierB}`,
      bestStaticAoePerCredit: bestStatic.aoePerCredit,
      bestStaticDpsPerCredit: bestStatic.dpsPerCredit,
      avgProgressPct: round(avgProgressPct, 4),
      winRate: round(winRate, 4),
      avgCorePctOnWins: round(avgCorePctOnWins, 4),
      veteranWinRate: round(veteranWinRate, 4),
      veteranAvgCorePctOnWins: round(veteranAvgCorePctOnWins, 4),
      apexWinRate: round(apexWinRate, 4),
      flawlessWins,
      bestSim: bestSim ? `${bestSim.stageLabel} on ${bestSim.mapName}/${bestSim.difficultyName}` : 'n/a',
      bestSimProgressPct: bestSim ? bestSim.progressPct : 0,
      bestSimCorePct: bestSim ? bestSim.corePct : 0,
      opScore,
      verdict,
      strengths: strengthsFor(def, builds),
      weaknesses: weaknessesFor(def, builds),
      notableStages,
    };
  }).sort((a, b) => b.opScore - a.opScore);
}

function strengthsFor(def: TowerDef, builds: StaticBuild[]): string[] {
  const s = new Set<string>();
  const best = [...builds].sort((a, b) => b.aoeDps - a.aoeDps)[0];
  if (best.aoeDps >= best.singleDps * 2.5) s.add('crowd/AoE scaling');
  if (builds.some((b) => b.utility.some((u) => u.includes('detect')))) s.add('cloak detection option');
  if (builds.some((b) => b.utility.some((u) => u.includes('slow')))) s.add('lane control');
  if (builds.some((b) => b.utility.some((u) => u.includes('armor shred')))) s.add('armor counterplay');
  if (builds.some((b) => b.utility.some((u) => u.includes('execute')))) s.add('finisher pressure');
  if (builds.some((b) => b.utility.some((u) => u.includes('burn')))) s.add('damage over time');
  if (def.base.range >= 9000) s.add('global range');
  if (def.style === 'support') s.add('buff/support aura');
  if (def.style === 'sweep') s.add('continuous no-cooldown damage');
  return [...s];
}

function weaknessesFor(def: TowerDef, builds: StaticBuild[]): string[] {
  const s = new Set<string>();
  const best = [...builds].sort((a, b) => b.singleDps - a.singleDps)[0];
  if (best.vsCloaked <= 0) s.add('needs external detection for cloaks');
  if (best.vsArmored <= best.singleDps * 0.35 && def.base.damageType === 'kinetic') s.add('kinetic armor weakness without shred');
  if (def.base.damageType === 'explosive') s.add('blast-resistant hulls blunt direct hits');
  if (def.base.damageType === 'cryo') s.add('cryo-immune hulls ignore damage/slow value');
  if (best.singleDps <= 0 && def.style !== 'support') s.add('low/no direct damage');
  if (def.cost >= 1500) s.add('late or expensive opening');
  if (def.style === 'support') s.add('cannot solo without damage dealers');
  return [...s];
}

function simPower(s: SimResult): number {
  return s.progressPct * 100 + (s.won ? 100 : 0) + s.corePct * 45;
}

function intRecord(input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, Math.round(v)]));
}

function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(sims: SimResult[]) {
  const header = [
    'towerId', 'towerName', 'stageId', 'stageLabel', 'tierA', 'tierB',
    'map', 'difficulty', 'won', 'finalWave', 'targetWaves', 'progressPct',
    'livesLeft', 'startingLives', 'corePct', 'leaks', 'cashEarned',
    'towersBuilt', 'totalDamage', 'firstLeakWave', 'worstWave', 'worstPressure',
  ];
  const rows = sims.map((s) => [
    s.towerId, s.towerName, s.stageId, s.stageLabel, s.tierA, s.tierB,
    s.map, s.difficulty, s.won, s.finalWave, s.targetWaves, s.progressPct,
    s.livesLeft, s.startingLives, s.corePct, s.leaks, s.cashEarned,
    s.towersBuilt, s.totalDamage, s.firstLeakWave ?? '',
    s.worstWave?.wave ?? '', s.worstWave?.pressure ? round(s.worstWave.pressure, 4) : '',
  ]);
  writeFileSync(OUT_CSV, [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'));
}

function writeMarkdown(summaries: TowerSummary[], sims: SimResult[], medianAoePerCredit: number) {
  const op = summaries.filter((s) => s.verdict === 'OP');
  const strong = summaries.filter((s) => s.verdict === 'strong');
  const weak = summaries.filter((s) => s.verdict === 'weak' || s.verdict === 'utility/needs-support');
  const topStageRows = [...sims]
    .sort((a, b) => simPower(b) - simPower(a))
    .slice(0, 30);

  const lines = [
    '# Tower Balance Deep Dive',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Preset: ${preset}`,
    `Maps: ${selectedMaps().map((m) => m.id).join(', ')}`,
    `Difficulties: ${selectedDiffs().map((d) => d.id).join(', ')}`,
    `Stages: ${selectedStages().map((s) => s.id).join(', ')}`,
    `Simulation rows: ${sims.length}`,
    `Median static AoE per credit: ${medianAoePerCredit}`,
    '',
    '## Headline',
    '',
    op.length
      ? `Likely OP: ${op.map((s) => `${s.name} (${s.verdict}, score ${s.opScore})`).join(', ')}.`
      : 'No tower crossed the OP threshold in this preset.',
    strong.length ? `Strong/watchlist: ${strong.map((s) => s.name).join(', ')}.` : 'No additional strong/watchlist towers.',
    weak.length ? `Weak or support-dependent: ${weak.map((s) => s.name).join(', ')}.` : 'No weak towers flagged.',
    '',
    '## Tower Rankings',
    '',
    '| Rank | Tower | Verdict | OP score | All win rate | Veteran win rate | Apex win rate | Avg progress | Win cores | Best sim | Best static build | Static AoE/credit | Strengths | Weaknesses |',
    '| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | --- |',
    ...summaries.map((s, i) => [
      i + 1,
      s.name,
      s.verdict,
      s.opScore,
      pct(s.winRate),
      pct(s.veteranWinRate),
      pct(s.apexWinRate),
      pct(s.avgProgressPct),
      pct(s.avgCorePctOnWins),
      s.bestSim,
      s.bestStaticBuild,
      s.bestStaticAoePerCredit,
      s.strengths.join('; ') || 'none modeled',
      s.weaknesses.join('; ') || 'none obvious',
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## Best Performing Tower/Stage Sims',
    '',
    '| Tower | Stage | Map | Difficulty | Result | Cores | Wave | Leaks | First leak | Worst wave |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...topStageRows.map((s) => `| ${s.towerName} | ${s.stageLabel} | ${s.mapName} | ${s.difficultyName} | ${s.won ? 'WIN' : 'LOSS'} | ${pct(s.corePct)} | ${s.finalWave}/${s.targetWaves} | ${s.leaks} | ${s.firstLeakWave ?? ''} | ${s.worstWave ? `w${s.worstWave.wave} (${pct(s.worstWave.pressure)})` : ''} |`),
    '',
    '## Per-Tower Notes',
    '',
    ...summaries.flatMap((s) => [
      `### ${s.name}`,
      '',
      `Verdict: ${s.verdict}. OP score ${s.opScore}. Best static build ${s.bestStaticBuild}; best sim ${s.bestSim}.`,
      '',
      `Strengths: ${s.strengths.join(', ') || 'none modeled'}.`,
      '',
      `Weaknesses: ${s.weaknesses.join(', ') || 'none obvious'}.`,
      '',
      `Notable stages: ${s.notableStages.join(' | ') || 'none'}.`,
      '',
    ]),
  ];
  writeFileSync(OUT_MD, `${lines.join('\n')}\n`);
}

function main() {
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  mkdirSync(dirname(OUT_MD), { recursive: true });

  const startedAt = new Date().toISOString();
  const maps = selectedMaps();
  const diffs = selectedDiffs();
  const stages = selectedStages();
  const total = TOWERS.length * stages.length * maps.length * diffs.length;
  const t0 = Date.now();
  console.log(`Tower deep dive (${preset})`);
  console.log(`${TOWERS.length} towers x ${stages.length} stages x ${maps.length} maps x ${diffs.length} diffs = ${total} sims`);

  const staticBuilds = TOWERS.flatMap(legalBuilds);
  const { towers: efficiency, medianDpsPerCredit } = analyzeEfficiency();
  const staticAoeVals = staticBuilds
    .filter((b) => b.aoePerCredit > 0)
    .map((b) => b.aoePerCredit)
    .sort((a, b) => a - b);
  const medianAoePerCredit = staticAoeVals[Math.floor(staticAoeVals.length / 2)] ?? 0;
  for (const b of staticBuilds) b.opScore = medianAoePerCredit > 0 ? round(b.aoePerCredit / medianAoePerCredit, 3) : 0;

  const sims: SimResult[] = [];
  let done = 0;
  for (const diff of diffs) {
    for (const map of maps) {
      for (const def of TOWERS) {
        for (const stage of stages) {
          sims.push(runSim(map, diff, def, stage));
          done++;
          if (done % 25 === 0 || done === total) {
            const elapsed = (Date.now() - t0) / 1000;
            const rate = done / Math.max(1, elapsed);
            const remaining = (total - done) / Math.max(0.001, rate);
            console.log(`  ${done}/${total} sims (${Math.round(remaining)}s remaining)`);
          }
        }
      }
    }
  }

  const summaries = summarizeTowers(staticBuilds, sims, medianAoePerCredit);
  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    preset,
    meta: {
      maps: maps.map((m) => ({ id: m.id, name: m.name, difficulty: m.difficulty })),
      difficulties: diffs.map((d) => ({ id: d.id, name: d.name, waves: d.waves, hpMult: d.hpMult, lateScale: d.lateScale })),
      stages,
      simCount: sims.length,
      medianDpsPerCredit,
      medianAoePerCredit,
      elapsedSeconds: round((Date.now() - t0) / 1000, 1),
    },
    summaries,
    staticBuilds,
    efficiency,
    sims,
  };

  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeCsv(sims);
  writeMarkdown(summaries, sims, medianAoePerCredit);

  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_CSV}`);
  console.log(`wrote ${OUT_MD}`);
}

main();
