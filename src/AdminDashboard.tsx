// Authenticated owner operations console. The unlinked /admin route is still
// protected by Firebase Google Auth plus the admin allowlist in Firestore rules.
// BALANCE reads public/balance-report.json; FEEDBACK and TELEMETRY read admin-only Firestore data.

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
// App.css is already global (loaded by App.tsx); this file carries the
// admin-only styles so they ride the lazy admin chunk, not the player bundle.
import './AdminDashboard.css';
import { ALL_MAPS, DIFFICULTIES } from './game/maps';
import { TOWERS, TOWER_MAP } from './game/towers';
import { clearAdmin } from './game/admin';
import { fetchRunAnalytics, fetchTelemetry, fetchRunSnapshots, fetchGlobalTop, TELEMETRY_BUILD, type RunAnalyticsRow, type TelemetryRow, type RunSnapshotRow, type RankedScoreEntry } from './game/leaderboard';
import { fetchPinnedSpotlightAdmin, pinReplayOfTheDay, unpinReplayOfTheDay, spotlightFromRunId, type PinnedSpotlight } from './game/adminSpotlight';
import type { ReplaySpotlight } from './game/replaySpotlight';
import { buildGhostCurves, ghostCurveFor } from './game/ghostCurve';
import { computeCanary, type CanarySeries } from './game/adminCanary';
import { analyzeDifficulty, DIFFICULTY_TARGETS, type WaveDifficulty } from './game/difficulty';
import {
  DEFAULT_ANALYTICS_FILTERS,
  METRIC_DOMAINS,
  aggregateMetric,
  availableWaveBuckets,
  buildAnalyticsDataset,
  formatMetricValue,
  metricById,
  metricCsv,
  metricsForDomain,
  readMetric,
  survivalBuckets,
  topRecord,
  viewportBucket,
  type AnalyticsFilters,
  type DerivedInsight,
  type MetricDefinition,
  type MetricDomain,
} from './adminAnalytics';
import {
  replyToFeedback,
  setFeedbackStatus,
  signInAdmin,
  signOutAdmin,
  watchAdminAuth,
  watchFeedback,
  type FeedbackMessage,
} from './game/adminAuth';

// ---- report shape (mirrors scripts/balance.ts) ----

interface CurvePoint {
  wave: number; reached: number; leakPct: number; pressure: number;
  livesLost: number; coreFraction: number; creditsStart: number; towersStart: number;
}
interface WaveCurve { map: string; diff: string; skill: string; winRate: number; avgFinalWave: number; points: CurvePoint[] }
interface GridCell { map: string; diff: string; skill: string; avgWave: number; winRate: number; avgLives: number }
interface BuildPoint {
  label: string; tierA: number; tierB: number; cost: number; single: number; aoe: number; burn: number;
  dpsPerCredit: number; aoePerCredit: number; vsArmored: number; vsExplosiveImmune: number;
  vsCryoImmune: number; vsCloaked: number; vsBoss: number; utility: string[];
}
interface UpgradeStep {
  track: number; trackName: string; tier: number; name: string; desc: string; cost: number;
  deltaSingle: number; deltaAoe: number; valuePerCredit: number; flag: 'dead' | 'weak' | 'ok' | 'strong' | 'op';
}
interface TowerEfficiency {
  id: string; name: string; style: string; damageType: string; cost: number; unlockAt: number;
  builds: BuildPoint[]; steps: UpgradeStep[]; rawDpsT4: number; dpsPerCreditT4: number;
}
interface StrategyResult { name: string; desc: string; map: string; diff: string; avgWave: number; bestWave: number; winRate: number; avgLives: number }
interface SoloResult { id: string; name: string; cost: number; avgWave: number; bestWave: number; winRate: number }
interface Report {
  generatedAt: string;
  meta: { quick: boolean; curveSeeds: number; gridSeeds: number; stratSeeds: number; soloSeeds: number;
    strategyArena: { map: string; diff: string }; soloArena: { map: string; diff: string }; medianDpsPerCredit: number };
  curves: WaveCurve[]; grid: GridCell[]; efficiency: TowerEfficiency[]; strategies: StrategyResult[]; solo: SoloResult[];
}

interface DeepDiveSummary {
  id: string; name: string; style: string; unlockAt: number; cost: number;
  bestStaticBuild: string; bestStaticAoePerCredit: number; bestStaticDpsPerCredit: number;
  avgProgressPct: number; winRate: number; avgCorePctOnWins: number;
  veteranWinRate: number; veteranAvgCorePctOnWins: number; apexWinRate: number; flawlessWins: number;
  bestSim: string; bestSimProgressPct: number; bestSimCorePct: number;
  opScore: number; verdict: 'OP' | 'strong' | 'fair' | 'weak' | 'utility/needs-support';
  strengths: string[]; weaknesses: string[]; notableStages: string[];
}
interface DeepDiveStaticBuild {
  towerId: string; towerName: string; style: string; tierA: number; tierB: number; cost: number;
  singleDps: number; aoeDps: number; burnDps: number; dpsPerCredit: number; aoePerCredit: number;
  vsArmored: number; vsExplosiveImmune: number; vsCryoImmune: number; vsCloaked: number; vsBoss: number;
  utility: string[]; opScore: number;
}
interface DeepDiveSim {
  towerId: string; towerName: string; stageId: string; stageLabel: string; tierA: number; tierB: number;
  map: string; mapName: string; difficulty: string; difficultyName: string; won: boolean;
  finalWave: number; targetWaves: number; progressPct: number; livesLeft: number; startingLives: number;
  corePct: number; leaks: number; firstLeakWave: number | null;
  worstWave: { wave: number; pressure: number } | null;
}
interface TowerDeepDiveReport {
  generatedAt: string; preset: string;
  meta: {
    simCount: number; medianDpsPerCredit: number; medianAoePerCredit: number; elapsedSeconds: number;
    maps: { id: string; name: string; difficulty: string }[];
    difficulties: { id: string; name: string; waves: number }[];
    stages: { id: string; label: string; a: number; b: number }[];
  };
  summaries: DeepDiveSummary[];
  staticBuilds: DeepDiveStaticBuild[];
  sims: DeepDiveSim[];
}

const mapName = (id: string) => ALL_MAPS.find((m) => m.id === id)?.name ?? id;
const diffName = (id: string) => DIFFICULTIES.find((d) => d.id === id)?.name ?? id;
const towerGlow = (id: string) => TOWER_MAP[id]?.glow ?? '#4bcffa';

function winColor(w: number): string {
  if (w >= 1) return '#2ed573';
  if (w >= 0.5) return '#feca57';
  if (w > 0) return '#ff9f43';
  return '#ff4757';
}

// ---------------- tiny SVG charts ----------------

function HBars({ data, max, fmt, unit }: {
  data: { label: string; value: number; color: string; sub?: string }[]; max?: number; fmt?: (v: number) => string; unit?: string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="adm-bars">
      {data.map((d, i) => (
        <div key={i} className="adm-bar-row">
          <span className="adm-bar-label" title={d.label}>{d.label}</span>
          <div className="adm-bar-track">
            <div className="adm-bar-fill" style={{ width: `${(d.value / top) * 100}%`, background: d.color }} />
            <span className="adm-bar-val">{(fmt ? fmt(d.value) : d.value)}{unit ?? ''}{d.sub ? <span className="adm-bar-sub"> {d.sub}</span> : null}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Multi-series line chart over wave number (x). Series values are 0..1 fractions. */
function LineChart({ points, series, height = 200 }: {
  points: CurvePoint[];
  series: { key: keyof CurvePoint; label: string; color: string }[];
  height?: number;
}) {
  const W = 640, H = height, padL = 36, padB = 22, padT = 12, padR = 12;
  if (points.length === 0) return <div className="adm-empty">no waves recorded</div>;
  const xs = points.map((p) => p.wave);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const sx = (w: number) => padL + ((w - minX) / Math.max(1, maxX - minX)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - Math.max(0, Math.min(1, v))) * (H - padT - padB);
  return (
    <svg className="adm-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={padL} y1={sy(g)} x2={W - padR} y2={sy(g)} className="adm-grid" />
          <text x={padL - 5} y={sy(g) + 3} className="adm-axis" textAnchor="end">{Math.round(g * 100)}</text>
        </g>
      ))}
      {[minX, Math.round((minX + maxX) / 2), maxX].map((w) => (
        <text key={w} x={sx(w)} y={H - 6} className="adm-axis" textAnchor="middle">w{w}</text>
      ))}
      {series.map((s) => {
        const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.wave).toFixed(1)},${sy(p[s.key] as number).toFixed(1)}`).join(' ');
        return <path key={String(s.key)} d={d} fill="none" stroke={s.color} strokeWidth={2} />;
      })}
    </svg>
  );
}

/** Economy view: credits banked at each wave launch + towers standing, on their
 *  own absolute scales. This is where the snowball shows up — when the gold line
 *  goes vertical, the lane has become trivially affordable. */
function EconPanel({ points }: { points: CurvePoint[] }) {
  const W = 640, H = 170, padL = 52, padB = 22, padT = 12, padR = 44;
  if (points.length < 2) return null;
  const xs = points.map((p) => p.wave);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const maxC = Math.max(1, ...points.map((p) => p.creditsStart));
  const maxT = Math.max(1, ...points.map((p) => p.towersStart));
  const sx = (w: number) => padL + ((w - minX) / Math.max(1, maxX - minX)) * (W - padL - padR);
  const syC = (v: number) => padT + (1 - v / maxC) * (H - padT - padB);
  const syT = (v: number) => padT + (1 - v / maxT) * (H - padT - padB);
  const credPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.wave).toFixed(1)},${syC(p.creditsStart).toFixed(1)}`).join(' ');
  const towPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.wave).toFixed(1)},${syT(p.towersStart).toFixed(1)}`).join(' ');
  // snowball point: first wave where banked credits pass half their eventual peak
  const snowball = points.find((p) => p.creditsStart >= maxC * 0.5);
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  return (
    <div className="adm-econ">
      <div className="adm-card-head" style={{ marginTop: 8 }}>
        <h3>Economy</h3><span className="adm-hint">credits banked at each wave launch · towers standing</span>
      </div>
      <svg className="adm-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={padL} y1={syC(maxC * g)} x2={W - padR} y2={syC(maxC * g)} className="adm-grid" />
            <text x={padL - 6} y={syC(maxC * g) + 3} className="adm-axis" textAnchor="end" fill="#ffd32a">⌬{fmtK(maxC * g)}</text>
            <text x={W - padR + 6} y={syT(maxT * g) + 3} className="adm-axis" textAnchor="start" fill="#4bcffa">{Math.round(maxT * g)}</text>
          </g>
        ))}
        {snowball && <line x1={sx(snowball.wave)} y1={padT} x2={sx(snowball.wave)} y2={H - padB} className="adm-marker" />}
        <path d={credPath} fill="none" stroke="#ffd32a" strokeWidth={2} />
        <path d={towPath} fill="none" stroke="#4bcffa" strokeWidth={1.6} strokeDasharray="4 3" />
        {[minX, Math.round((minX + maxX) / 2), maxX].map((w) => (
          <text key={w} x={sx(w)} y={H - 6} className="adm-axis" textAnchor="middle">w{w}</text>
        ))}
      </svg>
      <div className="adm-legend">
        <span><i style={{ background: '#ffd32a' }} /> credits banked (left axis)</span>
        <span><i style={{ background: '#4bcffa' }} /> towers standing (right axis)</span>
        {snowball && <span style={{ color: '#ffd32a' }}>snowball point ≈ wave {snowball.wave} (banked credits pass half their peak of ⌬{fmtK(maxC)})</span>}
      </div>
    </div>
  );
}

// ---------------- BALANCE tab ----------------

function GridBlock({ grid, skill }: { grid: GridCell[]; skill: string }) {
  return (
    <div className="adm-grid-block">
      <div className="adm-grid-skill">{skill}</div>
      <table className="adm-table adm-wingrid">
        <thead>
          <tr><th>sector</th>{DIFFICULTIES.map((d) => <th key={d.id}>{d.name}</th>)}</tr>
        </thead>
        <tbody>
          {ALL_MAPS.map((m) => (
            <tr key={m.id}>
              <td className="adm-rowhead">{m.name}</td>
              {DIFFICULTIES.map((d) => {
                const c = grid.find((g) => g.map === m.id && g.diff === d.id && g.skill === skill);
                if (!c) return <td key={d.id}>—</td>;
                return (
                  <td key={d.id} style={{ color: winColor(c.winRate) }} title={`${Math.round(c.winRate * 100)}% win · avg ${c.avgLives} cores left`}>
                    w{Math.round(c.avgWave)} · {Math.round(c.winRate * 100)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CurveViewer({ curves }: { curves: WaveCurve[] }) {
  const [mapId, setMapId] = useState(curves[0]?.map ?? 'orbital');
  const [diffId, setDiffId] = useState(curves[0]?.diff ?? 'easy');
  const curve = curves.find((c) => c.map === mapId && c.diff === diffId);
  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Per-wave balance curve</h3>
        <div className="adm-selects">
          <select aria-label="Balance curve sector" value={mapId} onChange={(e) => setMapId(e.target.value)}>
            {ALL_MAPS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select aria-label="Balance curve protocol" value={diffId} onChange={(e) => setDiffId(e.target.value)}>
            {DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      {curve ? (
        <>
          <div className="adm-curve-meta">
            bot: <b>{curve.skill}</b> · reaches wave <b>{Math.round(curve.avgFinalWave)}</b> ·{' '}
            <span style={{ color: winColor(curve.winRate) }}>{Math.round(curve.winRate * 100)}% win</span>
          </div>
          <p className="adm-note">⚠ These curves are <b>bot</b> play. A skilled human reaches much further — the bot tends to plateau exactly where the economy snowballs (see below) and it can't pilot premium late-game towers well. Read the curves as a floor, not a ceiling.</p>
          <LineChart
            points={curve.points}
            series={[
              { key: 'pressure', label: 'pressure', color: '#ff6b6b' },
              { key: 'leakPct', label: 'leak %', color: '#feca57' },
              { key: 'coreFraction', label: 'cores left', color: '#2ed573' },
            ]}
          />
          <div className="adm-legend">
            <span><i style={{ background: '#ff6b6b' }} /> pressure (cores lost this wave / cores at wave start)</span>
            <span><i style={{ background: '#feca57' }} /> leak % (fraction of the wave that broke through)</span>
            <span><i style={{ background: '#2ed573' }} /> cores remaining (fraction of starting pool)</span>
          </div>
          <p className="adm-hint">Spikes in the red line are difficulty walls; a falling green line that never recovers is a death spiral.</p>
          <EconPanel points={curve.points} />
        </>
      ) : <div className="adm-empty">No curve for this combination.</div>}
    </div>
  );
}

const FLAG_COLOR: Record<UpgradeStep['flag'], string> = {
  dead: '#ff4757', weak: '#ff9f43', ok: '#a4b0be', strong: '#54a0ff', op: '#2ed573',
};

// blended efficiency: best of single-target and (half-weighted) crowd dps per credit
const blendEff = (b: BuildPoint) => Math.max(b.dpsPerCredit, b.aoePerCredit * 0.5);
const pct = (n: number) => `${Math.round(n * 100)}%`;

function buildValue(t: TowerEfficiency): BuildPoint {
  return t.builds.slice(1).reduce((best, b) => blendEff(b) > blendEff(best) ? b : best, t.builds[1] ?? t.builds[0]);
}

function medianDamageEfficiency(efficiency: TowerEfficiency[]): number {
  const vals = efficiency
    .filter((t) => t.style !== 'support' && t.builds.some((b) => b.single > 0 || b.aoe > 0))
    .map((t) => blendEff(buildValue(t)))
    .sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : 0.001;
}

function matchupHoles(b: BuildPoint): string[] {
  const holes: string[] = [];
  if (b.vsArmored <= 0) holes.push('armor');
  if (b.vsCloaked <= 0) holes.push('cloak');
  if (b.vsBoss <= 0) holes.push('boss');
  if (b.vsExplosiveImmune <= 0) holes.push('explosive immune');
  if (b.vsCryoImmune <= 0) holes.push('cryo immune');
  return holes;
}

function BalanceFindings({ report }: { report: Report }) {
  const median = medianDamageEfficiency(report.efficiency);
  const towerSignals = report.efficiency
    .map((t) => ({ t, b: buildValue(t), ratio: blendEff(buildValue(t)) / median }))
    .filter((x) => x.t.style !== 'support')
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
  const deadSteps = report.efficiency.flatMap((t) => t.steps.filter((s) => s.flag === 'dead' || s.flag === 'weak').map((s) => ({ tower: t.name, step: s })));
  const opSteps = report.efficiency.flatMap((t) => t.steps.filter((s) => s.flag === 'op').map((s) => ({ tower: t.name, step: s })));
  const roughCells = [...report.grid]
    .filter((g) => g.skill !== 'rookie')
    .sort((a, b) => a.winRate - b.winRate || a.avgWave - b.avgWave)
    .slice(0, 4);
  const freeCells = [...report.grid]
    .filter((g) => g.skill === 'expert')
    .sort((a, b) => b.winRate - a.winRate || b.avgLives - a.avgLives)
    .slice(0, 3);
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Balance questions answered</h3><span className="adm-hint">quick read before opening the raw tables</span></div>
      <div className="adm-insight-grid">
        <div className="adm-insight">
          <b>Where are bots failing?</b>
          {roughCells.map((g) => (
            <span key={`${g.map}-${g.diff}-${g.skill}`}>{mapName(g.map)} / {diffName(g.diff)} / {g.skill}: w{Math.round(g.avgWave)}, {pct(g.winRate)} win</span>
          ))}
        </div>
        <div className="adm-insight">
          <b>Where might the game be too soft?</b>
          {freeCells.map((g) => (
            <span key={`${g.map}-${g.diff}-${g.skill}`}>{mapName(g.map)} / {diffName(g.diff)}: {pct(g.winRate)} win, {g.avgLives.toFixed(1)} cores left</span>
          ))}
        </div>
        <div className="adm-insight">
          <b>Tower price outliers</b>
          {towerSignals.slice(0, 4).map(({ t, ratio }) => (
            <span key={t.id} style={{ color: ratio > 1.35 ? '#2ed573' : ratio < 0.7 ? '#ff9f43' : undefined }}>
              {t.name}: {ratio.toFixed(2)}x median blended value
            </span>
          ))}
        </div>
        <div className="adm-insight">
          <b>Upgrade audit</b>
          <span>{deadSteps.length} weak/dead steps to inspect</span>
          <span>{opSteps.length} OP steps to sanity-check</span>
          {deadSteps.slice(0, 2).map(({ tower, step }) => <span key={`${tower}-${step.track}-${step.tier}`}>{tower} t{step.tier}: {step.name}</span>)}
        </div>
      </div>
    </div>
  );
}

function TowerBalanceLab({ efficiency }: { efficiency: TowerEfficiency[] }) {
  const median = medianDamageEfficiency(efficiency);
  const ranked = [...efficiency]
    .map((t) => ({ t, b: buildValue(t), ratio: blendEff(buildValue(t)) / median }))
    .sort((a, b) => b.ratio - a.ratio);
  const [selected, setSelected] = useState(ranked[0]?.t.id ?? '');
  const cur = ranked.find((x) => x.t.id === selected) ?? ranked[0];
  if (!cur) return null;
  const holes = matchupHoles(cur.b);
  const weak = cur.t.steps.filter((s) => s.flag === 'dead' || s.flag === 'weak');
  const strong = cur.t.steps.filter((s) => s.flag === 'strong' || s.flag === 'op');
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Tower balance lab</h3><span className="adm-hint">per-tower value, matchups, and upgrade health</span></div>
      <p className="adm-hint adm-eff-legend">
        These are simulator estimates for finding outliers, not literal combat readouts. Huge crowd DPS means the packed-lane estimate thinks pierce, splash, chain, or aura value is exploding and deserves a sanity pass.
      </p>
      <div className="adm-tower-lab">
        <div className="adm-tower-list">
          {ranked.map(({ t, b, ratio }) => {
            const h = matchupHoles(b);
            return (
              <button key={t.id} className={selected === t.id ? 'on' : ''} onClick={() => setSelected(t.id)}>
                <span><i style={{ background: towerGlow(t.id) }} />{t.name}</span>
                <em>{ratio.toFixed(2)}x</em>
                {h.length > 0 && <small>{h.join(', ')}</small>}
              </button>
            );
          })}
        </div>
        <div className="adm-tower-detail">
          <div className="adm-tower-title">
            <span><i style={{ background: towerGlow(cur.t.id) }} />{cur.t.name}</span>
            <strong style={{ color: cur.ratio > 1.35 ? '#2ed573' : cur.ratio < 0.7 ? '#ff9f43' : '#a4b0be' }}>{cur.ratio.toFixed(2)}x median value</strong>
          </div>
          <div className="adm-mini-kpis">
            <Stat label="best build" value={cur.b.label.replace(/\u00b7/g, ' ')} />
            <Stat label="single DPS" value={String(cur.b.single)} />
            <Stat label="sim crowd DPS" value={String(cur.b.aoe)} />
            <Stat label="single DPS / credit" value={cur.b.dpsPerCredit.toFixed(3)} />
          </div>
          <div className="adm-matchups">
            {['armor', 'cloak', 'boss', 'explosive immune', 'cryo immune'].map((h) => (
              <span key={h} className={holes.includes(h) ? 'bad' : 'good'}>{h}</span>
            ))}
          </div>
          <div className="adm-build-grid">
            {cur.t.builds.map((b) => (
              <div key={b.label} className="adm-build-card">
                <b>{b.label.replace(/\u00b7/g, ' ')}</b>
                <span>cost {b.cost} / single {b.single} / crowd {b.aoe}</span>
                <span>armor {b.vsArmored} / cloak {b.vsCloaked} / boss {b.vsBoss}</span>
                {b.utility.length > 0 && <span>{b.utility.join(', ')}</span>}
              </div>
            ))}
          </div>
          <div className="adm-two">
            <div>
              <div className="adm-subhead">Weak steps</div>
              {weak.length === 0 ? <p className="adm-hint">No weak/dead flags.</p> : weak.map((s) => <StepChip key={`${s.track}-${s.tier}`} s={s} />)}
            </div>
            <div>
              <div className="adm-subhead">Strong steps</div>
              {strong.length === 0 ? <p className="adm-hint">No strong/op flags.</p> : strong.map((s) => <StepChip key={`${s.track}-${s.tier}`} s={s} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepChip({ s }: { s: UpgradeStep }) {
  return (
    <div className="adm-step-chip" title={s.desc}>
      <span style={{ background: FLAG_COLOR[s.flag] }}>{s.flag}</span>
      <b>{s.trackName} t{s.tier}: {s.name}</b>
      <em>cost {s.cost} / value {s.valuePerCredit.toFixed(3)}</em>
    </div>
  );
}

interface TowerTweak {
  damageMult: number;
  fireRateMult: number;
  rangeMult: number;
  costMult: number;
}

const IDENTITY_TWEAK: TowerTweak = { damageMult: 1, fireRateMult: 1, rangeMult: 1, costMult: 1 };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const multFmt = (n: number) => `${n.toFixed(2)}x`;

function projectedPower(t: TowerTweak): number {
  return (t.damageMult * t.fireRateMult * (0.72 + 0.28 * t.rangeMult)) / Math.max(0.25, t.costMult);
}

function tweakSnippet(id: string, tweak: TowerTweak): string {
  return JSON.stringify({
    version: `tower-lab-${new Date().toISOString().slice(0, 10)}`,
    towers: {
      [id]: {
        costMult: Number(tweak.costMult.toFixed(2)),
        damageMult: Number(tweak.damageMult.toFixed(2)),
        rangeMult: Number(tweak.rangeMult.toFixed(2)),
        fireRateMult: Number(tweak.fireRateMult.toFixed(2)),
      },
    },
  }, null, 2);
}

function TweakControl({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <label className="adm-tweak-control">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={0.01} value={value.toFixed(2)} onChange={(e) => onChange(Number(e.target.value) || 1)} />
    </label>
  );
}

function TowerDeepDiveTab({ report }: { report: TowerDeepDiveReport }) {
  const sorted = useMemo(() => [...report.summaries].sort((a, b) => b.opScore - a.opScore), [report]);
  const [selected, setSelected] = useState(sorted[0]?.id ?? '');
  const [tweaks, setTweaks] = useState<Record<string, TowerTweak>>({});
  const summary = sorted.find((s) => s.id === selected) ?? sorted[0];
  const tweak = tweaks[summary?.id ?? ''] ?? IDENTITY_TWEAK;
  const builds = useMemo(() => report.staticBuilds.filter((b) => b.towerId === summary?.id), [report, summary]);
  const baseBuild = builds.length > 0 ? builds.reduce((best, b) => (b.aoePerCredit > best.aoePerCredit ? b : best), builds[0]) : null;
  const power = projectedPower(tweak);
  const projectedBuilds = builds.map((b) => ({
    ...b,
    projectedSingle: b.singleDps * tweak.damageMult * tweak.fireRateMult,
    projectedAoe: b.aoeDps * tweak.damageMult * tweak.fireRateMult,
    projectedCost: b.cost * tweak.costMult,
    projectedAoePerCredit: (b.aoePerCredit * tweak.damageMult * tweak.fireRateMult) / Math.max(0.25, tweak.costMult),
    projectedDpsPerCredit: (b.dpsPerCredit * tweak.damageMult * tweak.fireRateMult) / Math.max(0.25, tweak.costMult),
  }));
  const projectedBest = projectedBuilds.length > 0 ? projectedBuilds.reduce((best, b) => (b.projectedAoePerCredit > best.projectedAoePerCredit ? b : best), projectedBuilds[0]) : null;
  const projectedVeteran = summary ? clamp01(summary.veteranWinRate + Math.log(power) * 0.35) : 0;
  const projectedApex = summary ? clamp01(summary.apexWinRate + Math.log(power) * 0.25) : 0;
  const selectedSims = report.sims
    .filter((s) => s.towerId === summary?.id)
    .sort((a, b) => Number(b.won) - Number(a.won) || b.corePct - a.corePct || b.progressPct - a.progressPct)
    .slice(0, 16);
  const op = sorted.filter((s) => s.verdict === 'OP');
  const setTweak = (patch: Partial<TowerTweak>) => {
    if (!summary) return;
    setTweaks((cur) => ({ ...cur, [summary.id]: { ...(cur[summary.id] ?? IDENTITY_TWEAK), ...patch } }));
  };
  const resetTweak = () => {
    if (!summary) return;
    setTweaks((cur) => {
      const next = { ...cur };
      delete next[summary.id];
      return next;
    });
  };
  const copySnippet = () => {
    if (!summary || !navigator.clipboard) return;
    void navigator.clipboard.writeText(tweakSnippet(summary.id, tweak));
  };
  if (!summary || !baseBuild || !projectedBest) {
    return <div className="adm-content"><div className="adm-card"><div className="adm-empty">No tower deep-dive data loaded.</div></div></div>;
  }
  return (
    <div className="adm-content adm-tower-deep">
      <div className="adm-card">
        <div className="adm-card-head">
          <h3>Tower deep dive</h3>
          <span className="adm-hint">{report.preset} preset · {report.meta.simCount.toLocaleString()} sims · generated {new Date(report.generatedAt).toLocaleString()}</span>
        </div>
        <div className="adm-stat-row">
          <Stat label="likely OP" value={String(op.length)} />
          <Stat label="maps" value={String(report.meta.maps.length)} />
          <Stat label="difficulties" value={String(report.meta.difficulties.length)} />
          <Stat label="stages" value={String(report.meta.stages.length)} />
        </div>
      </div>

      <div className="adm-tower-deep-grid">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Ranking</h3><span className="adm-hint">simulation-led OP score</span></div>
          <div className="adm-deep-rank-list">
            {sorted.map((s) => (
              <button key={s.id} className={s.id === summary.id ? 'on' : ''} onClick={() => setSelected(s.id)}>
                <span><i style={{ background: towerGlow(s.id) }} />{s.name}</span>
                <b className={`adm-verdict-${s.verdict.replace(/[^a-z]/gi, '-').toLowerCase()}`}>{s.verdict}</b>
                <em>{s.opScore.toFixed(2)}</em>
                <small>Vet {pct(s.veteranWinRate)} · Apex {pct(s.apexWinRate)} · progress {pct(s.avgProgressPct)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="adm-card">
          <div className="adm-card-head">
            <h3>{summary.name}</h3>
            <span className="adm-hint">{summary.style} · {summary.verdict} · best sim {summary.bestSim}</span>
          </div>
          <div className="adm-mini-kpis">
            <Stat label="OP score" value={summary.opScore.toFixed(2)} />
            <Stat label="Veteran wins" value={pct(summary.veteranWinRate)} />
            <Stat label="Apex wins" value={pct(summary.apexWinRate)} />
            <Stat label="win cores" value={pct(summary.avgCorePctOnWins)} />
          </div>
          <div className="adm-two">
            <div>
              <div className="adm-subhead">Strengths</div>
              <div className="adm-tag-row">{summary.strengths.map((s) => <span key={s}>{s}</span>)}</div>
            </div>
            <div>
              <div className="adm-subhead">Weaknesses</div>
              <div className="adm-tag-row warn">{summary.weaknesses.map((s) => <span key={s}>{s}</span>)}</div>
            </div>
          </div>
          <div className="adm-deep-stage-list">
            {summary.notableStages.map((s) => <span key={s}>{s}</span>)}
          </div>
        </div>
      </div>

      <div className="adm-tower-deep-grid">
        <div className="adm-card">
          <div className="adm-card-head"><h3>What-if tweak</h3><span className="adm-hint">local projection for one tower</span></div>
          <div className="adm-tweak-grid">
            <TweakControl label="damage" value={tweak.damageMult} min={0.5} max={1.5} onChange={(damageMult) => setTweak({ damageMult })} />
            <TweakControl label="fire rate" value={tweak.fireRateMult} min={0.5} max={1.5} onChange={(fireRateMult) => setTweak({ fireRateMult })} />
            <TweakControl label="range" value={tweak.rangeMult} min={0.65} max={1.4} onChange={(rangeMult) => setTweak({ rangeMult })} />
            <TweakControl label="cost" value={tweak.costMult} min={0.65} max={2} onChange={(costMult) => setTweak({ costMult })} />
          </div>
          <div className="adm-mini-kpis">
            <Stat label="power index" value={`${Math.round(power * 100)}%`} />
            <Stat label="projected Vet" value={`${pct(summary.veteranWinRate)} → ${pct(projectedVeteran)}`} />
            <Stat label="projected Apex" value={`${pct(summary.apexWinRate)} → ${pct(projectedApex)}`} />
            <Stat label="best static" value={`${baseBuild.tierA}/${baseBuild.tierB} → ${projectedBest.tierA}/${projectedBest.tierB}`} />
          </div>
          <table className="adm-table adm-projection-table">
            <thead><tr><th>metric</th><th>current</th><th>projected</th><th>change</th></tr></thead>
            <tbody>
              <tr><td>best AoE / credit</td><td>{baseBuild.aoePerCredit.toFixed(4)}</td><td>{projectedBest.projectedAoePerCredit.toFixed(4)}</td><td>{multFmt(projectedBest.projectedAoePerCredit / Math.max(0.000001, baseBuild.aoePerCredit))}</td></tr>
              <tr><td>single DPS</td><td>{baseBuild.singleDps.toFixed(1)}</td><td>{projectedBest.projectedSingle.toFixed(1)}</td><td>{multFmt(projectedBest.projectedSingle / Math.max(0.000001, baseBuild.singleDps))}</td></tr>
              <tr><td>crowd DPS</td><td>{baseBuild.aoeDps.toFixed(1)}</td><td>{projectedBest.projectedAoe.toFixed(1)}</td><td>{multFmt(projectedBest.projectedAoe / Math.max(0.000001, baseBuild.aoeDps))}</td></tr>
              <tr><td>build cost</td><td>⌬{Math.round(baseBuild.cost).toLocaleString()}</td><td>⌬{Math.round(projectedBest.projectedCost).toLocaleString()}</td><td>{multFmt(projectedBest.projectedCost / Math.max(1, baseBuild.cost))}</td></tr>
            </tbody>
          </table>
          <div className="adm-tweak-actions">
            <button className="adm-mini" onClick={resetTweak}>reset</button>
            <button className="adm-mini" onClick={copySnippet}>copy config</button>
          </div>
          <pre className="adm-config-snippet">{tweakSnippet(summary.id, tweak)}</pre>
          <p className="adm-hint adm-eff-legend">Projection uses saved static data plus a small range weight. Rerun <code>npm run tower:deep-dive</code> after applying real values to verify actual wave outcomes.</p>
        </div>

        <div className="adm-card">
          <div className="adm-card-head"><h3>Best saved sims</h3><span className="adm-hint">selected tower only</span></div>
          <table className="adm-table">
            <thead><tr><th>stage</th><th>sector</th><th>protocol</th><th>result</th><th>cores</th><th>leaks</th><th>worst</th></tr></thead>
            <tbody>
              {selectedSims.map((s) => (
                <tr key={`${s.stageId}-${s.map}-${s.difficulty}`}>
                  <td>{s.stageLabel}</td>
                  <td>{s.mapName}</td>
                  <td>{s.difficultyName}</td>
                  <td style={{ color: s.won ? '#2ed573' : '#ff9f43' }}>{s.won ? 'WIN' : `w${s.finalWave}/${s.targetWaves}`}</td>
                  <td>{pct(s.corePct)}</td>
                  <td>{s.leaks}</td>
                  <td>{s.worstWave ? `w${s.worstWave.wave} ${pct(s.worstWave.pressure)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-card-head"><h3>Full tower summary</h3><span className="adm-hint">from saved deep-dive JSON</span></div>
        <table className="adm-table adm-deep-summary">
          <thead>
            <tr><th>tower</th><th>verdict</th><th>score</th><th>all wins</th><th>Vet</th><th>Apex</th><th>progress</th><th>best static</th><th>AoE/credit</th><th>best sim</th></tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} onClick={() => setSelected(s.id)}>
                <td><span className="adm-dot" style={{ background: towerGlow(s.id) }} />{s.name}</td>
                <td>{s.verdict}</td>
                <td>{s.opScore.toFixed(2)}</td>
                <td>{pct(s.winRate)}</td>
                <td>{pct(s.veteranWinRate)}</td>
                <td>{pct(s.apexWinRate)}</td>
                <td>{pct(s.avgProgressPct)}</td>
                <td>{s.bestStaticBuild}</td>
                <td>{s.bestStaticAoePerCredit.toFixed(4)}</td>
                <td>{s.bestSim}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StrategyInsights({ strategies, solo, stratArena, soloArena }: {
  strategies: StrategyResult[];
  solo: SoloResult[];
  stratArena: string;
  soloArena: string;
}) {
  const strat = [...strategies].sort((a, b) => b.avgWave - a.avgWave);
  const solos = [...solo].sort((a, b) => b.avgWave - a.avgWave);
  const best = strat[0];
  const worst = strat[strat.length - 1];
  const spread = best && worst ? best.avgWave - worst.avgWave : 0;
  const soloWins = solos.filter((s) => s.winRate >= 1);
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Strategy diagnostics</h3><span className="adm-hint">{stratArena} strategy bots / {soloArena} solo bots</span></div>
      <div className="adm-insight-grid">
        <div className="adm-insight">
          <b>Best opener</b>
          {best ? <span>{best.name}: w{Math.round(best.avgWave)}, {pct(best.winRate)} win</span> : <span>No strategy data.</span>}
          {best && <span>{best.desc}</span>}
        </div>
        <div className="adm-insight">
          <b>Weakest opener</b>
          {worst ? <span>{worst.name}: w{Math.round(worst.avgWave)}, {pct(worst.winRate)} win</span> : <span>No strategy data.</span>}
          <span>Spread: {spread.toFixed(1)} waves between best and worst.</span>
        </div>
        <div className="adm-insight">
          <b>Solo carries</b>
          {soloWins.length > 0
            ? soloWins.slice(0, 3).map((s) => <span key={s.id}>{s.name} can solo-clear in this arena.</span>)
            : <span>No tower solo-clears this arena.</span>}
        </div>
        <div className="adm-insight">
          <b>Solo ceiling</b>
          {solos.slice(0, 3).map((s) => <span key={s.id}>{s.name}: avg w{Math.round(s.avgWave)}, best w{s.bestWave}</span>)}
        </div>
      </div>
    </div>
  );
}

function EfficiencyTable({ efficiency }: { efficiency: TowerEfficiency[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const dmgVals = efficiency.filter((t) => t.style !== 'support' && (t.builds[1].single > 0 || t.builds[1].aoe > 0))
    .map((t) => blendEff(t.builds[1])).sort((a, b) => a - b);
  const median = dmgVals.length ? dmgVals[Math.floor(dmgVals.length / 2)] : 0;
  const sorted = [...efficiency].sort((a, b) => blendEff(b.builds[1]) - blendEff(a.builds[1]));
  const valueOf = (t: TowerEfficiency): { label: string; color: string } => {
    const b = t.builds[1];
    if (t.style === 'support' || (b.single <= 0 && b.aoe <= 0)) return { label: 'utility', color: '#a4b0be' };
    const e = blendEff(b);
    if (e >= median * 1.4) return { label: 'over-valued', color: '#2ed573' };
    if (e <= median * 0.6) return { label: 'under-valued', color: '#ff9f43' };
    return { label: 'fair', color: '#a4b0be' };
  };
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Tower cost-efficiency</h3><span className="adm-hint">at A·t4 build · costMult 1 · map-independent · click a row for the upgrade-step breakdown</span></div>
      <table className="adm-table adm-eff">
        <thead>
          <tr>
            <th>tower</th><th>style</th><th>type</th><th>cost</th>
            <th title="sustained single-target damage/sec">single DPS</th>
            <th title="potential damage/sec into a packed lane (pierce / splash / multi-target / aura)">crowd DPS</th>
            <th title="single-target DPS per credit spent">DPS/⌬</th>
            <th title="effective DPS vs Aegis armor (kinetic = 0)">vs armor</th>
            <th title="effective DPS vs phase-cloak (no sensors = 0)">vs cloak</th>
            <th title="effective DPS vs boss hulls (slow/drag/execute ignored)">vs boss</th>
            <th title="over/under-valued vs the median, judged on the BEST of single & crowd DPS-per-credit">value</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const b = t.builds[1];
            const v = valueOf(t);
            const isOpen = open === t.id;
            return (
              <Fragment key={t.id}>
                <tr className={`adm-eff-row ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : t.id)}>
                  <td><span className="adm-dot" style={{ background: towerGlow(t.id) }} />{t.name}</td>
                  <td className="adm-dim">{t.style}</td>
                  <td className="adm-dim">{t.damageType}</td>
                  <td>⌬{t.cost}</td>
                  <td>{b.single}</td>
                  <td style={{ color: b.aoe > b.single * 1.5 ? '#54a0ff' : undefined }}>{b.aoe}</td>
                  <td>{b.dpsPerCredit.toFixed(3)}</td>
                  <td style={{ color: b.vsArmored === 0 ? '#ff4757' : undefined }}>{b.vsArmored}</td>
                  <td style={{ color: b.vsCloaked === 0 ? '#ff4757' : undefined }}>{b.vsCloaked}</td>
                  <td>{b.vsBoss}</td>
                  <td style={{ color: v.color }}>{v.label}</td>
                </tr>
                {isOpen && (
                  <tr className="adm-eff-detail">
                    <td colSpan={11}>
                      <div className="adm-steps">
                        {([0, 1] as const).map((tr) => (
                          <div key={tr} className="adm-steps-track">
                            <div className="adm-steps-name">{t.steps.find((s) => s.track === tr)?.trackName}</div>
                            {t.steps.filter((s) => s.track === tr).map((s) => (
                              <div key={s.tier} className="adm-step" title={s.desc}>
                                <span className="adm-step-flag" style={{ background: FLAG_COLOR[s.flag] }}>{s.flag}</span>
                                <span className="adm-step-name">t{s.tier} {s.name}</span>
                                <span className="adm-step-cost">⌬{s.cost}</span>
                                <span className="adm-step-d">+{s.deltaSingle}/{s.deltaAoe} dps</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="adm-hint adm-eff-legend">
        <b>single DPS</b> = sustained one-target damage · <b>crowd DPS</b> = damage into a packed lane (pierce/splash/multi-target/aura — this is where AoE towers earn their keep) ·
        <b> DPS/⌬</b> = single-target damage per credit · <b>vs armor/cloak/boss</b> = effective DPS vs that hull type (<span style={{ color: '#ff4757' }}>red 0</span> = can't damage it) ·
        <b> value</b> judges over/under on the <i>better</i> of single &amp; crowd efficiency, so utility/AoE towers aren't penalized for low single-target numbers.
      </p>
    </div>
  );
}

// ---------------- difficulty model (player estimate) ----------------

const heatColor = (i: number) => {
  const c = Math.min(100, Math.max(0, i));
  return `hsl(${Math.round(142 - 1.42 * c)}, 62%, ${44 - c * 0.12}%)`;
};
const TAG_COLOR: Record<string, string> = { boss: '#ffffff', cloak: '#54a0ff', armor: '#8395a7', heal: '#7bed9f' };

function compressRanges(nums: number[]): string {
  if (nums.length === 0) return 'none';
  const s = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  let lo = s[0], prev = s[0];
  for (let i = 1; i <= s.length; i++) {
    if (s[i] === prev + 1) { prev = s[i]; continue; }
    out.push(lo === prev ? `${lo}` : `${lo}–${prev}`);
    lo = prev = s[i];
  }
  return out.join(', ');
}

function DiffLineChart({ waves, targetFn }: { waves: WaveDifficulty[]; targetFn: (p: number) => number }) {
  const W = 640, H = 200, padL = 30, padB = 22, padT = 10, padR = 10;
  const n = waves.length;
  const sx = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - Math.min(100, v) / 100) * (H - padT - padB);
  const idxPath = waves.map((w, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(w.index).toFixed(1)}`).join(' ');
  const tgtPath = waves.map((w, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(targetFn((w.wave - 1) / Math.max(1, n - 1))).toFixed(1)}`).join(' ');
  return (
    <svg className="adm-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {[0, 25, 50, 70, 100].map((g) => (
        <g key={g}>
          <line x1={padL} y1={sy(g)} x2={W - padR} y2={sy(g)} className="adm-grid" />
          <text x={padL - 5} y={sy(g) + 3} className="adm-axis" textAnchor="end">{g}</text>
        </g>
      ))}
      {waves.filter((w) => w.tags.includes('boss')).map((w, i) => (
        <line key={i} x1={sx(w.wave - 1)} y1={padT} x2={sx(w.wave - 1)} y2={H - padB} className="adm-marker" />
      ))}
      <path d={tgtPath} fill="none" stroke="#6c7aa6" strokeWidth={1.6} strokeDasharray="5 4" />
      <path d={idxPath} fill="none" stroke="#ff6b6b" strokeWidth={2} />
      {[1, Math.round(n / 2), n].map((w) => (
        <text key={w} x={sx(w - 1)} y={H - 6} className="adm-axis" textAnchor="middle">w{w}</text>
      ))}
    </svg>
  );
}

function DifficultyModel() {
  const curves = useMemo(() => analyzeDifficulty(), []);
  const maxW = Math.max(...curves.map((c) => c.waves.length));
  const [sel, setSel] = useState(curves.find((c) => c.diff === 'hard')?.diff ?? curves[0].diff);
  const [target, setTarget] = useState('Standard arc');
  const selCurve = curves.find((c) => c.diff === sel)!;
  const targetFn = DIFFICULTY_TARGETS[target];
  const n = selCurve.waves.length;
  const dev = selCurve.waves.map((w) => ({ wave: w.wave, delta: w.index - targetFn((w.wave - 1) / Math.max(1, n - 1)) }));
  const tooEasy = compressRanges(dev.filter((d) => d.delta <= -15).map((d) => d.wave));
  const tooHard = compressRanges(dev.filter((d) => d.delta >= 15).map((d) => d.wave));

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Difficulty model — player estimate</h3>
        <span className="adm-hint">incoming effective HP ÷ buying power, × threat &amp; speed · map-independent · no bot needed</span>
      </div>

      <div className="adm-heat" style={{ ['--cells' as string]: maxW }}>
        <div className="adm-heat-row adm-heat-axisrow">
          <span className="adm-heat-label" />
          <div className="adm-heat-cells">
            {Array.from({ length: maxW }, (_, i) => (
              <span key={i} className="adm-heat-tick">{(i + 1) % 10 === 0 ? i + 1 : ''}</span>
            ))}
          </div>
        </div>
        {curves.map((c) => (
          <div key={c.diff} className="adm-heat-row">
            <span className="adm-heat-label">{c.name}</span>
            <div className="adm-heat-cells">
              {Array.from({ length: maxW }, (_, i) => {
                const w = c.waves[i];
                if (!w) return <span key={i} className="adm-heat-cell empty" />;
                const tag = w.tags[0];
                return (
                  <span key={i} className="adm-heat-cell" style={{ background: heatColor(w.index) }}
                    title={`${c.name} · wave ${w.wave}\nindex ${w.index}/100\nthreat ${w.threat.toFixed(2)} (effHP ${w.effHP.toLocaleString()} / bank ⌬${w.bank.toLocaleString()})\nhulls ${w.hulls}${w.tags.length ? ` · ${w.tags.join(', ')}` : ''}`}>
                    {tag && <span className="adm-heat-mark" style={{ background: TAG_COLOR[tag] }} />}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="adm-legend">
        <span><i style={{ background: heatColor(20) }} /> trivial</span>
        <span><i style={{ background: heatColor(55) }} /> fair</span>
        <span><i style={{ background: heatColor(85) }} /> wall</span>
        <span style={{ marginLeft: 10 }}>marks:</span>
        {Object.entries(TAG_COLOR).map(([k, v]) => <span key={k}><i style={{ background: v }} /> {k}</span>)}
      </div>

      <div className="adm-card-head" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 12 }}>Tune to a target curve</h3>
        <div className="adm-selects">
          <select aria-label="Difficulty curve" value={sel} onChange={(e) => setSel(e.target.value)}>
            {curves.map((c) => <option key={c.diff} value={c.diff}>{c.name}</option>)}
          </select>
          <select aria-label="Target difficulty curve" value={target} onChange={(e) => setTarget(e.target.value)}>
            {Object.keys(DIFFICULTY_TARGETS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
      <DiffLineChart waves={selCurve.waves} targetFn={targetFn} />
      <div className="adm-legend">
        <span><i style={{ background: '#ff6b6b' }} /> estimated difficulty</span>
        <span><i style={{ background: '#6c7aa6' }} /> your target ({target})</span>
      </div>
      <div className="adm-devs">
        <div className="adm-dev"><b style={{ color: '#54a0ff' }}>Too easy vs target</b> (≥15 under): {tooEasy}</div>
        <div className="adm-dev"><b style={{ color: '#ff4757' }}>Too hard vs target</b> (≥15 over): {tooHard}</div>
      </div>
      <p className="adm-hint">The late-game sag is the economy snowball — when banked credits outgrow incoming HP. Lift it by tapering income (incomeMult/waveBonus) or steepening late HP (lateScale), then re-check here.</p>
    </div>
  );
}

function BalanceTab({ report }: { report: Report }) {
  const skills = ['rookie', 'standard', 'expert'];
  const stratArena = `${mapName(report.meta.strategyArena.map)} · ${diffName(report.meta.strategyArena.diff)}`;
  const soloArena = `${mapName(report.meta.soloArena.map)} · ${diffName(report.meta.soloArena.diff)}`;
  return (
    <div className="adm-content">
      <div className="adm-meta-bar">
        Generated {new Date(report.generatedAt).toLocaleString()} ·{' '}
        {report.meta.quick ? 'QUICK pass' : 'full pass'} · curve seeds {report.meta.curveSeeds} · grid seeds {report.meta.gridSeeds}
      </div>

      <DifficultyModel />

      <BalanceFindings report={report} />

      <CurveViewer curves={report.curves} />

      <div className="adm-card">
        <div className="adm-card-head"><h3>Win grid</h3><span className="adm-hint">avg final wave · win rate, per bot skill</span></div>
        <div className="adm-grids">
          {skills.map((s) => <GridBlock key={s} grid={report.grid} skill={s} />)}
        </div>
      </div>

      <TowerBalanceLab efficiency={report.efficiency} />

      <EfficiencyTable efficiency={report.efficiency} />

      <StrategyInsights strategies={report.strategies} solo={report.solo} stratArena={stratArena} soloArena={soloArena} />

      <div className="adm-card">
        <div className="adm-card-head"><h3>Strategy matrix</h3><span className="adm-hint">{stratArena} · constrained bots, identical cadence</span></div>
        <HBars
          data={[...report.strategies].sort((a, b) => b.avgWave - a.avgWave).map((s) => ({
            label: s.name, value: s.avgWave, color: winColor(s.winRate),
            sub: `${Math.round(s.winRate * 100)}% win`,
          }))}
          fmt={(v) => `w${Math.round(v)}`}
        />
        <p className="adm-hint">Green bars cleared the campaign; flat low bars couldn't afford their opening — focus strategies that skip the early game starve.</p>
      </div>

      <div className="adm-card">
        <div className="adm-card-head"><h3>Solo viability</h3><span className="adm-hint">{soloArena} · one tower kind, maxed</span></div>
        <HBars
          data={[...report.solo].sort((a, b) => b.avgWave - a.avgWave).map((s) => ({
            label: s.name, value: s.avgWave, color: s.winRate >= 1 ? '#2ed573' : towerGlow(s.id),
            sub: s.winRate >= 1 ? 'solo win' : '',
          }))}
          fmt={(v) => `w${Math.round(v)}`}
        />
      </div>
    </div>
  );
}

// ---------------- TELEMETRY tab ----------------

function bucket(wave: number): string {
  if (wave <= 0) return 'w0';
  const lo = Math.floor((wave - 1) / 5) * 5 + 1;
  return `w${lo}-${lo + 4}`;
}

// ---- telemetry analysis helpers ----
const DAY = 86_400_000;
const RANGE_MS: Record<string, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, all: Infinity };
const SKILL_FOR: Record<string, string> = { easy: 'rookie', normal: 'standard', hard: 'expert', extinction: 'expert' };
const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);
/** Wilson 95% lower bound — a small-sample-aware win rate (3/3 ranks below 200/300). */
function wilsonLow(wins: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  return Math.max(0, (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / d);
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pick-rate × win-rate scatter — classifies towers into meta / trap / sleeper / dead. */
function MetaScatter({ data }: { data: { id: string; name: string; pick: number; win: number; n: number }[] }) {
  const W = 580, H = 360, pad = 44;
  const maxPick = Math.max(0.01, ...data.map((d) => d.pick));
  const maxN = Math.max(1, ...data.map((d) => d.n));
  const sx = (p: number) => pad + (p / maxPick) * (W - pad * 2);
  const sy = (w: number) => H - pad - w * (H - pad * 2);
  return (
    <svg className="adm-scatter" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <line x1={sx(maxPick / 2)} y1={pad} x2={sx(maxPick / 2)} y2={H - pad} className="adm-grid" />
      <line x1={pad} y1={sy(0.5)} x2={W - pad} y2={sy(0.5)} className="adm-grid" />
      <text x={W - pad} y={pad - 6} className="adm-quad" textAnchor="end">★ META (popular · winning)</text>
      <text x={pad} y={pad - 6} className="adm-quad" textAnchor="start">◇ SLEEPER (rare · winning)</text>
      <text x={W - pad} y={H - pad + 16} className="adm-quad" textAnchor="end">⚠ TRAP (popular · losing)</text>
      <text x={pad} y={H - pad + 16} className="adm-quad" textAnchor="start">· niche</text>
      <text x={W / 2} y={H - 6} className="adm-axis" textAnchor="middle">pick rate →</text>
      <text x={12} y={H / 2} className="adm-axis" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>win rate →</text>
      {data.map((d) => {
        const r = 4 + 11 * Math.sqrt(d.n / maxN);
        return (
          <g key={d.id}>
            <circle cx={sx(d.pick)} cy={sy(d.win)} r={r} fill={towerGlow(d.id)} opacity={0.45} stroke={towerGlow(d.id)} />
            <text x={sx(d.pick)} y={sy(d.win) - r - 2} className="adm-axis" textAnchor="middle">{d.name.split(' ')[0]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Runs-per-day bars + win-rate line over time. */
function TimeSeries({ rows }: { rows: TelemetryRow[] }) {
  const byDay = new Map<string, { n: number; wins: number }>();
  for (const r of rows) {
    const k = dayKey(r.ts);
    const e = byDay.get(k) ?? { n: 0, wins: 0 };
    e.n++; if (r.won) e.wins++;
    byDay.set(k, e);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
  if (days.length < 2) return <div className="adm-empty">Need at least two days of data for a trend.</div>;
  const W = 580, H = 200, pad = 30;
  const maxN = Math.max(1, ...days.map(([, e]) => e.n));
  const bw = (W - pad * 2) / days.length;
  const sy = (v: number) => H - pad - v * (H - pad * 2);
  const line = days.map(([, e], i) => `${i === 0 ? 'M' : 'L'}${(pad + bw * (i + 0.5)).toFixed(1)},${sy(e.wins / e.n).toFixed(1)}`).join(' ');
  return (
    <svg className="adm-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} className="adm-grid" />)}
      {days.map(([, e], i) => (
        <rect key={i} x={pad + bw * i + 1} y={H - pad - (e.n / maxN) * (H - pad * 2)} width={bw - 2}
          height={(e.n / maxN) * (H - pad * 2)} fill="#54a0ff" opacity={0.25} />
      ))}
      <path d={line} fill="none" stroke="#2ed573" strokeWidth={2} />
      <text x={pad} y={H - 8} className="adm-axis">{days[0][0].slice(5)}</text>
      <text x={W - pad} y={H - 8} className="adm-axis" textAnchor="end">{days[days.length - 1][0].slice(5)}</text>
    </svg>
  );
}

interface TFilter { range: string; map: string; diff: string; mode: string; build: string }

function FilterBar({ filter, setFilter, builds, fetchedAt, onRefresh, onExport, shown, total }: {
  filter: TFilter; setFilter: (f: TFilter) => void; builds: string[];
  fetchedAt: number; onRefresh: () => void; onExport: () => void; shown: number; total: number;
}) {
  const set = (k: keyof TFilter) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilter({ ...filter, [k]: e.target.value });
  return (
    <div className="adm-filterbar">
      <select aria-label="Telemetry date range" value={filter.range} onChange={set('range')}>
        <option value="all">all time</option><option value="30d">last 30d</option>
        <option value="7d">last 7d</option><option value="24h">last 24h</option>
      </select>
      <select aria-label="Telemetry sector" value={filter.map} onChange={set('map')}>
        <option value="all">all sectors</option>{ALL_MAPS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select aria-label="Telemetry protocol" value={filter.diff} onChange={set('diff')}>
        <option value="all">all protocols</option>{DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select aria-label="Telemetry mode" value={filter.mode} onChange={set('mode')}>
        <option value="all">all modes</option><option value="campaign">campaign</option><option value="freeplay">freeplay</option>
      </select>
      {builds.length > 1 && (
        <select aria-label="Telemetry build" value={filter.build} onChange={set('build')}>
          <option value="all">all builds</option>{builds.map((b) => <option key={b} value={b}>{b || '(pre-build)'}</option>)}
        </select>
      )}
      <span className="adm-filter-count">{shown}/{total} runs</span>
      <div className="adm-filter-actions">
        <span className="adm-hint">as of {fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : '—'}</span>
        <button className="adm-mini" onClick={onRefresh}>↻ refresh</button>
        <button className="adm-mini" onClick={onExport}>⤓ CSV</button>
      </div>
    </div>
  );
}

// Balance canary: model cores curve vs live player median, per {map,diff}, flagging
// waves where reality diverges from the bot model. Reads runs/{runId} snapshots (admin).
function BalanceCanaryCard({ report }: { report: Report | null | 'missing' }) {
  const [rows, setRows] = useState<RunSnapshotRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState({ map: ALL_MAPS[0].id, diff: 'normal' });

  useEffect(() => {
    let live = true;
    fetchRunSnapshots(300).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, []);

  const ghostCurves = useMemo(
    () => (report && report !== 'missing' ? buildGhostCurves(report.curves) : []),
    [report],
  );
  const series: CanarySeries | null = useMemo(() => {
    if (!rows) return null;
    const ghost = ghostCurveFor(ghostCurves, sel.map, sel.diff);
    return ghost ? computeCanary(rows, ghost) : null;
  }, [rows, ghostCurves, sel]);

  if (!report || report === 'missing') {
    return (
      <div className="adm-card">
        <div className="adm-card-head"><h3>Balance canary</h3><span className="adm-hint">model vs live players</span></div>
        <div className="adm-empty">Run <code>npm run balance</code> to generate the model curves first.</div>
      </div>
    );
  }

  // chart geometry — model (cyan) vs live median (gold) coreFraction over waves
  const CW = 640, CH = 200, padL = 36, padB = 22, padT = 12, padR = 12;
  const allWaves = [...(series?.model ?? []).map((p) => p.wave), ...(series?.live ?? []).map((p) => p.wave)];
  const maxX = Math.max(1, ...allWaves);
  const sx = (w: number) => padL + (w / maxX) * (CW - padL - padR);
  const sy = (v: number) => padT + (1 - Math.max(0, Math.min(1, v))) * (CH - padT - padB);
  const modelPath = (series?.model ?? []).map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.wave).toFixed(1)},${sy(p.coreFraction).toFixed(1)}`).join(' ');
  const live
    = (series?.live ?? []).filter((p) => p.n >= 1);
  const livePath = live.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.wave).toFixed(1)},${sy(p.coreFraction).toFixed(1)}`).join(' ');

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Balance canary</h3>
        <span className="adm-hint">model cores (cyan) vs live player median (gold)</span>
      </div>
      <div className="adm-canary-controls">
        <select aria-label="Balance canary sector" value={sel.map} onChange={(e) => setSel((s) => ({ ...s, map: e.target.value }))}>
          {ALL_MAPS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select aria-label="Balance canary protocol" value={sel.diff} onChange={(e) => setSel((s) => ({ ...s, diff: e.target.value }))}>
          {DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="adm-dim">{rows === null ? 'loading runs…' : err ? 'fetch failed' : series ? `${series.runs} live runs · ${series.startingLives} starting cores` : 'no model curve'}</span>
      </div>
      {!series ? (
        <div className="adm-empty">{rows === null ? 'Establishing uplink…' : 'No model curve for this sector×protocol.'}</div>
      ) : (
        <>
          <svg className="adm-line" viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="xMidYMid meet">
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <g key={g}>
                <line x1={padL} y1={sy(g)} x2={CW - padR} y2={sy(g)} className="adm-grid" />
                <text x={padL - 5} y={sy(g) + 3} className="adm-axis" textAnchor="end">{Math.round(g * 100)}</text>
              </g>
            ))}
            {[0, Math.round(maxX / 2), maxX].map((w) => (
              <text key={w} x={sx(w)} y={CH - 6} className="adm-axis" textAnchor="middle">w{w}</text>
            ))}
            {series.divergences.map((d) => (
              <line key={d.wave} x1={sx(d.wave)} y1={padT} x2={sx(d.wave)} y2={CH - padB}
                stroke={d.severity === 'hard' ? 'rgba(255,71,87,0.45)' : 'rgba(254,202,87,0.35)'} strokeWidth={1} />
            ))}
            {modelPath && <path d={modelPath} fill="none" stroke="#4bcffa" strokeWidth={2} />}
            {livePath && <path d={livePath} fill="none" stroke="#ffd32a" strokeWidth={2} strokeDasharray="5 3" />}
          </svg>
          {series.divergences.length === 0 ? (
            <p className="adm-hint">Live medians track the model within tolerance (need ≥5 runs/wave to flag). {series.runs < 5 ? 'Low live sample — collect more runs.' : ''}</p>
          ) : (
            <table className="adm-table">
              <thead><tr><th>wave</th><th>model</th><th>live</th><th>Δ</th><th>n</th><th>read</th></tr></thead>
              <tbody>
                {series.divergences.slice(0, 8).map((d) => (
                  <tr key={d.wave}>
                    <td>w{d.wave}</td>
                    <td>{Math.round(d.model * 100)}%</td>
                    <td>{Math.round(d.live * 100)}%</td>
                    <td style={{ color: d.severity === 'hard' ? '#ff4757' : '#feca57' }}>{d.delta >= 0 ? '+' : ''}{Math.round(d.delta * 100)}%</td>
                    <td className="adm-dim">{d.n}</td>
                    <td style={{ textAlign: 'right' }} className="adm-dim">{d.delta > 0 ? 'players hold more cores than model' : 'players bleed faster than model'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function TelemetryTab({ report }: { report: Report | null | 'missing' }) {
  const [rows, setRows] = useState<TelemetryRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<TFilter>({ range: 'all', map: 'all', diff: 'all', mode: 'all', build: 'all' });

  useEffect(() => {
    let live = true;
    setRows(null); setErr(false);
    fetchTelemetry(2000).then((r) => { if (live) { setRows(r); setFetchedAt(Date.now()); } }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [reloadKey]);

  const builds = useMemo(() => [...new Set((rows ?? []).map((r) => r.build ?? ''))].sort(), [rows]);

  // apply the filter bar (time range / sector / protocol / mode / build)
  const filtered = useMemo(() => {
    if (!rows) return null;
    const now = Date.now();
    const winMs = RANGE_MS[filter.range] ?? Infinity;
    return rows.filter((r) =>
      (filter.range === 'all' || now - r.ts <= winMs) &&
      (filter.map === 'all' || r.map === filter.map) &&
      (filter.diff === 'all' || r.diff === filter.diff) &&
      (filter.mode === 'all' || (filter.mode === 'freeplay' ? r.freeplay : !r.freeplay)) &&
      (filter.build === 'all' || (r.build ?? '') === filter.build));
  }, [rows, filter]);

  const stats = useMemo(() => {
    const rows = filtered;
    if (!rows || rows.length === 0) return null;
    const n = rows.length;
    const avg = (f: (r: TelemetryRow) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
    // death/end histogram bucketed by wave, split by kind
    const buckets = new Map<string, { gameover: number; victory: number }>();
    for (const r of rows) {
      const b = bucket(r.wave);
      const e = buckets.get(b) ?? { gameover: 0, victory: 0 };
      if (r.kind === 'victory') e.victory++;
      else e.gameover++;
      buckets.set(b, e);
    }
    const histo = [...buckets.entries()].sort((a, b) => {
      const na = parseInt(a[0].slice(1)); const nb = parseInt(b[0].slice(1)); return na - nb;
    });
    // win-rate by map and diff
    const byMap = winRateBy(rows, (r) => r.map, ALL_MAPS.map((m) => m.id), mapName);
    const byDiff = winRateBy(rows, (r) => r.diff, DIFFICULTIES.map((d) => d.id), diffName);
    const fails = histo
      .map(([label, e]) => ({ label, losses: e.gameover, total: e.gameover + e.victory }))
      .filter((b) => b.losses > 0)
      .sort((a, b) => b.losses - a.losses)
      .slice(0, 4);
    const roughModes = [...byMap.map((m) => ({ kind: 'sector', ...m })), ...byDiff.map((d) => ({ kind: 'protocol', ...d }))]
      .filter((d) => d.n >= 2)
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 4);
    // tower popularity
    const towerCount = new Map<string, number>();
    const towerImpact = new Map<string, { runs: number; wins: number; wave: number; losses: number }>();
    let withTowers = 0;
    for (const r of rows) {
      if (r.towers) {
        withTowers++;
        for (const id of [...new Set(r.towers.split(',').filter(Boolean))]) {
          towerCount.set(id, (towerCount.get(id) ?? 0) + 1);
          const e = towerImpact.get(id) ?? { runs: 0, wins: 0, wave: 0, losses: 0 };
          e.runs++;
          e.wave += r.wave;
          if (r.won) e.wins++; else e.losses++;
          towerImpact.set(id, e);
        }
      }
    }
    const popularity = TOWERS.map((t) => ({ id: t.id, name: t.name, count: towerCount.get(t.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
    const towerOutcomes = TOWERS.map((t) => {
      const e = towerImpact.get(t.id) ?? { runs: 0, wins: 0, wave: 0, losses: 0 };
      return { id: t.id, name: t.name, runs: e.runs, winRate: e.runs ? e.wins / e.runs : 0, avgWave: e.runs ? e.wave / e.runs : 0 };
    }).filter((t) => t.runs > 0).sort((a, b) => b.runs - a.runs);
    const freeplayRows = rows.filter((r) => r.freeplay);
    const uniquePlayers = new Set(rows.map((r) => r.uid).filter(Boolean)).size;

    // pick-rate × win-rate scatter (meta classification)
    const scatter = TOWERS.map((t) => {
      const e = towerImpact.get(t.id);
      if (!e || e.runs === 0) return null;
      return { id: t.id, name: t.name, pick: e.runs / Math.max(1, withTowers), win: e.wins / e.runs, n: e.runs };
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    // damage-share "who actually carried" (from the dmg field: "id:pct,...")
    const dmgAcc = new Map<string, { sum: number; runs: number }>();
    let withDmg = 0;
    for (const r of rows) {
      if (!r.dmg) continue;
      withDmg++;
      for (const part of r.dmg.split(',')) {
        const [id, p] = part.split(':');
        if (!id) continue;
        const e = dmgAcc.get(id) ?? { sum: 0, runs: 0 };
        e.sum += Number(p) || 0; e.runs++;
        dmgAcc.set(id, e);
      }
    }
    const dmgLeaders = TOWERS.map((t) => {
      const e = dmgAcc.get(t.id);
      return { id: t.id, name: t.name, avgShare: e ? e.sum / Math.max(1, withDmg) : 0, runs: e?.runs ?? 0 };
    }).filter((t) => t.runs > 0).sort((a, b) => b.avgShare - a.avgShare);

    // real median loss-wave per sector×protocol (for sim-vs-real reconciliation)
    const lossMap = new Map<string, number[]>();
    for (const r of rows) {
      if (r.kind !== 'gameover') continue;
      const k = `${r.map}|${r.diff}`;
      (lossMap.get(k) ?? lossMap.set(k, []).get(k)!).push(r.wave);
    }
    const lossMedians = [...lossMap.entries()].map(([k, ws]) => {
      const [map, diff] = k.split('|');
      return { map, diff, median: median(ws), n: ws.length };
    });

    return {
      n,
      uniquePlayers,
      avgWave: avg((r) => r.wave),
      avgKills: avg((r) => r.kills),
      avgDur: avg((r) => r.durationS),
      avgLeaks: avg((r) => r.leaks ?? 0),
      avgCoresLeft: avg((r) => r.coresLeft ?? 0),
      avgAbilities: avg((r) => r.abilities ?? 0),
      wins: rows.filter((r) => r.won).length,
      histo,
      fails,
      roughModes,
      byMap,
      byDiff,
      popularity,
      towerOutcomes,
      withTowers,
      scatter,
      dmgLeaders,
      withDmg,
      lossMedians,
      freeplayRuns: freeplayRows.length,
      bestFreeplayWave: freeplayRows.length ? Math.max(...freeplayRows.map((r) => r.wave)) : 0,
    };
  }, [filtered]);

  const exportCsv = () => {
    const rs = filtered ?? [];
    const cols = ['ts', 'kind', 'map', 'diff', 'wave', 'kills', 'cash', 'won', 'freeplay', 'durationS', 'leaks', 'coresLeft', 'abilities', 'build', 'towers', 'dmg', 'uid'];
    const esc = (v: unknown) => { const x = String(v ?? '').replace(/"/g, '""'); return /[",\n]/.test(x) ? `"${x}"` : x; };
    const csv = [cols.join(','), ...rs.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `telemetry-${dayKey(fetchedAt || 0)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (err) return <TelemetryError />;
  if (rows === null) return <div className="adm-content"><div className="adm-card"><div className="adm-empty">Establishing uplink to telemetry…</div></div></div>;
  if (rows.length === 0) return <TelemetryEmpty />;

  const s = stats;
  const matched = report && report !== 'missing' ? report : null;
  // sim-vs-real: predicted bot reach wave vs real median loss wave, per slice
  const divergence = (s && matched ? s.lossMedians : [])
    .filter((d) => d.n >= 3)
    .map((d) => {
      const cell = matched!.grid.find((g) => g.map === d.map && g.diff === d.diff && g.skill === (SKILL_FOR[d.diff] ?? 'expert'));
      return cell ? { ...d, simReach: cell.avgWave, delta: d.median - cell.avgWave } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);

  return (
    <div className="adm-content">
      <FilterBar filter={filter} setFilter={setFilter} builds={builds} fetchedAt={fetchedAt}
        onRefresh={() => setReloadKey((k) => k + 1)} onExport={exportCsv}
        shown={filtered?.length ?? 0} total={rows.length} />

      <BalanceCanaryCard report={report} />

      {!s ? (
        <div className="adm-card"><div className="adm-empty">No runs match this filter.</div></div>
      ) : ((s: NonNullable<typeof stats>) => {
        const maxBucket = Math.max(1, ...s.histo.map(([, e]) => e.gameover + e.victory));
        return (
          <>
            <div className="adm-stat-row">
              <Stat label="runs (filtered)" value={s.n.toLocaleString()} />
              <Stat label="players seen" value={s.uniquePlayers.toLocaleString()} />
              <Stat label="win rate" value={pct(s.wins / s.n)} />
              <Stat label="avg wave reached" value={s.avgWave.toFixed(1)} />
            </div>

            {matched && (
              <div className="adm-card">
                <div className="adm-card-head"><h3>Sim vs real — does the model predict reality?</h3>
                  <span className="adm-hint">bot-predicted reach wave vs players' median loss wave</span></div>
                {divergence.length === 0 ? <div className="adm-empty">Need ≥3 real losses in a sector×protocol slice (widen the filter).</div> : (
                  <table className="adm-table">
                    <thead><tr><th>slice</th><th>sim reach (bot)</th><th>real median loss</th><th>Δ</th><th>read</th></tr></thead>
                    <tbody>
                      {divergence.map((d) => (
                        <tr key={`${d.map}-${d.diff}`}>
                          <td style={{ textAlign: 'left' }}>{mapName(d.map)} · {diffName(d.diff)} <span className="adm-dim">({d.n})</span></td>
                          <td>w{Math.round(d.simReach)}</td>
                          <td>w{Math.round(d.median)}</td>
                          <td style={{ color: Math.abs(d.delta) >= 8 ? '#feca57' : undefined }}>{d.delta >= 0 ? '+' : ''}{Math.round(d.delta)}</td>
                          <td style={{ textAlign: 'right' }} className="adm-dim">{d.delta > 4 ? 'players outlast the bot' : d.delta < -4 ? 'bot over-predicts' : 'sim matches'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="adm-hint">Large +Δ = the bot under-predicts human skill there (use real data to judge that slice, not the sim). Δ≈0 = trust the sim.</p>
              </div>
            )}

            <div className="adm-card">
              <div className="adm-card-head"><h3>Telemetry readout</h3><span className="adm-hint">filtered player data</span></div>
              <div className="adm-insight-grid">
                <div className="adm-insight">
                  <b>Where do players lose?</b>
                  {s.fails.length > 0 ? s.fails.map((f) => <span key={f.label}>{f.label}: {f.losses} of {f.total} endings</span>) : <span>No losses in this sample.</span>}
                </div>
                <div className="adm-insight">
                  <b>Hardest live slices</b><span className="adm-dim">win% (≥95% floor · n)</span>
                  {s.roughModes.length > 0 ? s.roughModes.map((m) => <span key={`${m.kind}-${m.id}`}>{m.kind} {m.label}: {pct(m.rate)} (≥{pct(wilsonLow(Math.round(m.rate * m.n), m.n))} · {m.n})</span>) : <span>Need ≥2 runs per slice.</span>}
                </div>
                <div className="adm-insight">
                  <b>Core pressure</b>
                  <span>Avg leaks: {s.avgLeaks.toFixed(1)} · cores left: {s.avgCoresLeft.toFixed(1)}</span>
                  <span>Avg abilities cast: {s.avgAbilities.toFixed(1)}</span>
                  <span>{s.freeplayRuns} freeplay runs, best wave {s.bestFreeplayWave}</span>
                </div>
                <div className="adm-insight">
                  <b>Avg run length</b>
                  <span>{Math.round(s.avgDur / 60)}m {Math.round(s.avgDur % 60)}s · {Math.round(s.avgKills)} hulls</span>
                </div>
              </div>
            </div>

            <div className="adm-card">
              <div className="adm-card-head"><h3>Run outcome by wave reached</h3><span className="adm-hint">where players' runs end</span></div>
              <div className="adm-histo">
                {s.histo.map(([b, e]) => {
                  const total = e.gameover + e.victory;
                  return (
                    <div key={b} className="adm-histo-col" title={`${b}: ${e.gameover} lost · ${e.victory} won`}>
                      <div className="adm-histo-stack" style={{ height: `${(total / maxBucket) * 100}%` }}>
                        <div style={{ flex: e.gameover, background: '#ff4757' }} />
                        <div style={{ flex: e.victory, background: '#2ed573' }} />
                      </div>
                      <span className="adm-histo-label">{b}</span>
                    </div>
                  );
                })}
              </div>
              <div className="adm-legend">
                <span><i style={{ background: '#ff4757' }} /> grid offline</span>
                <span><i style={{ background: '#2ed573' }} /> sector secured</span>
              </div>
            </div>

            <div className="adm-card">
              <div className="adm-card-head"><h3>Tower meta map</h3>
                <span className="adm-hint">{s.withTowers} runs with loadouts · bubble = sample size</span></div>
              {s.scatter.length === 0
                ? <div className="adm-empty">No loadout data in this slice yet.</div>
                : <MetaScatter data={s.scatter} />}
              <p className="adm-hint">Top-right = meta picks · top-left = under-used winners (sleepers) · bottom-right = popular traps. Cross-check against the BALANCE tab's efficiency flags.</p>
            </div>

            <div className="adm-card">
              <div className="adm-card-head"><h3>Who actually carried</h3>
                <span className="adm-hint">avg share of a run's damage · {s.withDmg} runs reported damage</span></div>
              {s.dmgLeaders.length === 0
                ? <div className="adm-empty">No damage-share data yet — new runs (this build) report it.</div>
                : <HBars data={s.dmgLeaders.slice(0, 12).map((t) => ({ label: t.name, value: Math.round(t.avgShare), color: towerGlow(t.id), sub: `${t.runs} runs` }))} unit="%" />}
            </div>

            <div className="adm-card">
              <div className="adm-card-head"><h3>Activity & win-rate over time</h3>
                <span className="adm-hint">bars = runs/day · line = daily win rate</span></div>
              <TimeSeries rows={filtered ?? []} />
            </div>

            <div className="adm-two">
              <div className="adm-card">
                <div className="adm-card-head"><h3>Win rate by sector</h3></div>
                <HBars data={s.byMap.map((d) => ({ label: d.label, value: Math.round(d.rate * 100), color: winColor(d.rate), sub: `${d.n} runs` }))} max={100} unit="%" />
              </div>
              <div className="adm-card">
                <div className="adm-card-head"><h3>Win rate by protocol</h3></div>
                <HBars data={s.byDiff.map((d) => ({ label: d.label, value: Math.round(d.rate * 100), color: winColor(d.rate), sub: `${d.n} runs` }))} max={100} unit="%" />
              </div>
            </div>
          </>
        );
      })(s)}
    </div>
  );
}

function winRateBy(rows: TelemetryRow[], key: (r: TelemetryRow) => string, order: string[], label: (id: string) => string) {
  const m = new Map<string, { wins: number; n: number }>();
  for (const r of rows) {
    const k = key(r);
    const e = m.get(k) ?? { wins: 0, n: 0 };
    e.n++; if (r.won) e.wins++;
    m.set(k, e);
  }
  return order.filter((id) => m.has(id)).map((id) => {
    const e = m.get(id)!;
    return { id, label: label(id), rate: e.wins / e.n, n: e.n };
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="adm-stat"><div className="adm-stat-val">{value}</div><div className="adm-stat-label">{label}</div></div>;
}

function TelemetryEmpty() {
  return (
    <div className="adm-content"><div className="adm-card">
      <div className="adm-empty">
        <p>No telemetry returned.</p>
        <p className="adm-hint">Either no runs have been logged yet, or this signed-in Google account is not in the admin allowlist.
          The dashboard requires deployed Firestore rules that permit <code>isAdmin()</code> reads on <code>/telemetry</code>.</p>
      </div>
    </div></div>
  );
}

function TelemetryError() {
  return (
    <div className="adm-content"><div className="adm-card">
      <div className="adm-empty">
        <p>Telemetry read failed.</p>
        <p className="adm-hint">Firestore likely denied the admin read on <code>/telemetry</code>. Confirm Google sign-in, keep the admin
          email allowlist synchronized in source and rules, then deploy the updated firestore.rules.</p>
      </div>
    </div></div>
  );
}

// ---------------- RUN ANALYTICS tabs ----------------

const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const avgOf = <T,>(xs: T[], f: (x: T) => number): number => xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0;
const rec = (v: unknown): Record<string, number> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {};

function mergedRecordBars<T>(rows: T[], get: (row: T) => unknown, color = '#54a0ff', label = (id: string) => id) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [id, value] of Object.entries(rec(get(row)))) {
      totals.set(id, (totals.get(id) ?? 0) + num(value));
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, value]) => ({ label: label(id), value, color }));
}

function useRunAnalytics(limit = 1500) {
  const [rows, setRows] = useState<RunAnalyticsRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    setRows(null); setErr(false);
    fetchRunAnalytics(limit).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [limit, reloadKey]);
  return { rows, err, refresh: () => setReloadKey((k) => k + 1) };
}

function AnalyticsState({ rows, err }: { rows: RunAnalyticsRow[] | null; err: boolean }) {
  if (err) return <div className="adm-card"><div className="adm-empty adm-denied">Run analytics read failed. Deploy the updated Firestore rules and confirm this admin account is allowlisted.</div></div>;
  if (rows === null) return <div className="adm-card"><div className="adm-empty">Loading run analytics...</div></div>;
  if (rows.length === 0) return <div className="adm-card"><div className="adm-empty">No private run analytics yet. New completed, abandoned, or submitted runs will populate this screen.</div></div>;
  return null;
}

function OperationsHealthPanel({ runCount }: { runCount: number }) {
  const mode = import.meta.env.MODE || 'development';
  const hasAppCheckSiteKey = Boolean(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY);
  const hasDebugToken = Boolean(import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN);
  const checklist = [
    'Run npm run check:deploy-env before emulator or deploy work.',
    'Keep callable score, daily score, and feedback writes server-mediated.',
    'Smoke test score, replay, feedback, telemetry, and admin paths before App Check enforcement.',
    'Confirm portal hostnames before adding frame-ancestors exceptions.',
  ];
  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Security and deploy health</h3>
        <span className="adm-hint">runtime posture for release checks</span>
      </div>
      <div className="adm-stat-row">
        <Stat label="client build" value={TELEMETRY_BUILD} />
        <Stat label="runtime mode" value={mode} />
        <Stat label="App Check key" value={hasAppCheckSiteKey ? 'present' : 'off'} />
        <Stat label="analytics sample" value={runCount.toLocaleString()} />
      </div>
      <div className="adm-insight-grid">
        <div className="adm-insight"><b>Score writes</b><span>Callable-only submission path</span><span>Replay doc required before scoring</span></div>
        <div className="adm-insight"><b>Replay records</b><span>Append-only public verification docs</span><span>Chunks are create-only under rules</span></div>
        <div className="adm-insight"><b>Feedback privacy</b><span>Private receipt token lookup</span><span>Admin replies are server mediated</span></div>
        <div className="adm-insight"><b>App Check rollout</b><span>{hasAppCheckSiteKey ? 'Token plumbing ready' : 'No site key in this build'}</span><span>{hasDebugToken ? 'Debug token enabled' : 'No debug token exposed'}</span></div>
      </div>
      <div className="adm-devs">
        {checklist.map((item) => <span className="adm-dev" key={item}>{item}</span>)}
      </div>
    </div>
  );
}

function MiniArea({ values, color = '#54a0ff', height = 90 }: { values: number[]; color?: string; height?: number }) {
  const W = 420, H = height, pad = 8;
  if (values.length < 2) return <div className="adm-empty compact">Need more samples.</div>;
  const max = Math.max(1, ...values);
  const sx = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const sy = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W - pad},${H - pad} L${pad},${H - pad} Z`;
  return (
    <svg className="adm-mini-area" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={area} fill={color} opacity={0.16} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function analyticsByDay(rows: RunAnalyticsRow[]) {
  const byDay = new Map<string, { runs: number; wins: number; abandons: number; minutes: number }>();
  for (const r of rows) {
    const k = dayKey(r.endedAt || r.createdAt || Date.now());
    const e = byDay.get(k) ?? { runs: 0, wins: 0, abandons: 0, minutes: 0 };
    e.runs++;
    if (r.summary.outcome === 'victory') e.wins++;
    if (r.summary.outcome === 'abandoned') e.abandons++;
    e.minutes += r.summary.durationS / 60;
    byDay.set(k, e);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
}

function outcomeBars(rows: RunAnalyticsRow[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.summary.outcome, (counts.get(r.summary.outcome) ?? 0) + 1);
  const color: Record<string, string> = { victory: '#2ed573', gameover: '#ff4757', abandoned: '#ff9f43' };
  return [...counts.entries()].map(([label, value]) => ({ label, value, color: color[label] ?? '#54a0ff' }));
}

function FrictionRadar({ rows }: { rows: RunAnalyticsRow[] }) {
  const max = Math.max(1, rows.length);
  const metrics = [
    { label: 'abandon', value: rows.filter((r) => r.summary.outcome === 'abandoned').length / max, color: '#ff9f43' },
    { label: 'death', value: rows.filter((r) => r.summary.outcome === 'gameover').length / max, color: '#ff4757' },
    { label: 'failed buy', value: avgOf(rows, (r) => num(r.economy.failedPurchaseAttempts)) / 5, color: '#feca57' },
    { label: 'failed upgrade', value: avgOf(rows, (r) => num(r.economy.failedUpgradeAttempts)) / 5, color: '#54a0ff' },
    { label: 'idle cash', value: avgOf(rows, (r) => num(r.economy.idleWithCashS)) / 180, color: '#7bed9f' },
    { label: 'hidden', value: avgOf(rows, (r) => r.attention.sessionS ? r.attention.hiddenS / r.attention.sessionS : 0), color: '#a55eea' },
  ];
  const W = 520, H = 190, maxBar = 130;
  return (
    <svg className="adm-radar" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {metrics.map((m, i) => {
        const y = 22 + i * 27;
        const v = Math.max(0, Math.min(1, m.value));
        return (
          <g key={m.label}>
            <text x={8} y={y + 10} className="adm-axis">{m.label}</text>
            <rect x={112} y={y} width={maxBar} height={15} fill="rgba(75,207,250,0.08)" rx={3} />
            <rect x={112} y={y} width={maxBar * v} height={15} fill={m.color} opacity={0.72} rx={3} />
            <text x={252} y={y + 11} className="adm-axis">{Math.round(v * 100)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

function InsightDeck({ insights, domain, title = 'Generated readouts' }: { insights: DerivedInsight[]; domain?: MetricDomain; title?: string }) {
  const shown = insights.filter((insight) => !domain || insight.domain === domain).slice(0, 6);
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>{title}</h3><span className="adm-hint">threshold based, sample-size aware</span></div>
      {shown.length ? (
        <div className="adm-insight-card-grid">
          {shown.map((insight) => <InsightCard key={`${insight.domain}-${insight.signal}`} insight={insight} />)}
        </div>
      ) : <div className="adm-empty">No strong signals yet. Widen filters or collect more run analytics.</div>}
    </div>
  );
}

function InsightCard({ insight }: { insight: DerivedInsight }) {
  return (
    <article className={`adm-insight-card severity-${insight.severity}`}>
      <div><span>{insight.domain}</span><b>{insight.value}</b></div>
      <h4>{insight.signal}</h4>
      <p>{insight.meaning}</p>
      <em>{insight.followup}</em>
    </article>
  );
}

function SurvivalCurve({ buckets }: { buckets: ReturnType<typeof survivalBuckets> }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.runs));
  if (buckets.length === 0) return <div className="adm-empty">No survival data for this slice.</div>;
  return (
    <div className="adm-histo">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="adm-histo-col" title={`${bucket.label}: ${bucket.runs} runs, ${bucket.losses} losses, ${bucket.wins} wins`}>
          <div className="adm-histo-stack" style={{ height: `${Math.max(4, (bucket.runs / max) * 100)}%` }}>
            <div style={{ flex: bucket.losses, background: '#ff4757' }} />
            <div style={{ flex: bucket.wins, background: '#2ed573' }} />
            <div style={{ flex: Math.max(0, bucket.runs - bucket.losses - bucket.wins), background: '#54a0ff' }} />
          </div>
          <span className="adm-histo-label">{bucket.label}</span>
        </div>
      ))}
    </div>
  );
}

function HeatmapGrid({ cells, title }: { cells: Record<string, number>; title: string }) {
  const max = Math.max(1, ...Object.values(cells));
  return (
    <div className="adm-heatmap-wrap" aria-label={title}>
      {Array.from({ length: 9 }, (_, y) => (
        <div key={y} className="adm-heatmap-row">
          {Array.from({ length: 16 }, (_, x) => {
            const value = cells[`${x},${y}`] ?? 0;
            return (
              <span
                key={`${x},${y}`}
                className="adm-heatmap-cell"
                title={`${title} ${x},${y}: ${value}`}
                style={{ opacity: value ? 0.18 + (value / max) * 0.82 : 0.08 }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MetricBars({ data, color = '#54a0ff' }: { data: Array<{ label: string; value: number }>; color?: string }) {
  return data.length
    ? <HBars data={data.map((item) => ({ ...item, color }))} />
    : <div className="adm-empty">No values yet.</div>;
}

function readExplorerFilters(): AnalyticsFilters {
  if (typeof location === 'undefined') return DEFAULT_ANALYTICS_FILTERS;
  const params = new URLSearchParams(location.search);
  return {
    ...DEFAULT_ANALYTICS_FILTERS,
    range: safeFilter(params.get('range'), ['all', '24h', '7d', '30d'], DEFAULT_ANALYTICS_FILTERS.range),
    build: params.get('build') || 'all',
    map: params.get('map') || 'all',
    diff: params.get('diff') || 'all',
    mode: safeFilter(params.get('mode'), ['all', 'campaign', 'freeplay'], DEFAULT_ANALYTICS_FILTERS.mode),
    outcome: params.get('outcome') || 'all',
    waveBucket: params.get('wave') || 'all',
    uid: params.get('uid') || '',
    schema: params.get('schema') || 'all',
    cohort: safeFilter(params.get('cohort'), ['all', 'first', 'returning'], DEFAULT_ANALYTICS_FILTERS.cohort),
  };
}

function safeFilter<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function syncExplorerUrl(filters: AnalyticsFilters, domain: 'all' | MetricDomain, metricId: string): void {
  try {
    const url = new URL(location.href);
    url.searchParams.set('tab', 'explore');
    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== (DEFAULT_ANALYTICS_FILTERS as unknown as Record<string, string>)[key]) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    url.searchParams.set('domain', domain);
    url.searchParams.set('metric', metricId);
    history.replaceState(null, '', url);
  } catch {
    // URL persistence is convenience only.
  }
}

function metricSortValue(row: RunAnalyticsRow, metric: MetricDefinition): number | string {
  const value = readMetric(row, metric);
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).reduce<number>((sum, v) => sum + num(v), 0);
  return String(value ?? '');
}

function MetricExplorerTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  const [filters, setFilters] = useState<AnalyticsFilters>(() => readExplorerFilters());
  const [domain, setDomain] = useState<'all' | MetricDomain>(() => {
    const value = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('domain') : null;
    return METRIC_DOMAINS.some((item) => item.id === value) ? value as 'all' | MetricDomain : 'all';
  });
  const [metricId, setMetricId] = useState(() => typeof location !== 'undefined' ? new URLSearchParams(location.search).get('metric') || 'run.wave' : 'run.wave');
  const [sort, setSort] = useState<'metric' | 'wave' | 'duration' | 'date'>('metric');
  const [selected, setSelected] = useState<RunAnalyticsRow | null>(null);
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const dataset = buildAnalyticsDataset(data, filters);
  const metricOptions = metricsForDomain(domain);
  const metric = metricOptions.find((item) => item.id === metricId) ?? metricById(metricOptions[0]?.id ?? 'run.wave');
  const aggregate = aggregateMetric(dataset.filtered, metric);
  const top = metric.kind === 'record' || metric.kind === 'array' || metric.kind === 'string' || metric.kind === 'boolean'
    ? topRecord(dataset.filtered, metric)
    : aggregate.topValues;
  const builds = [...new Set(data.map((row) => row.build).filter(Boolean))].sort();
  const schemas = [...new Set(data.map((row) => String(row.schemaVersion)))].sort();
  const waveBuckets = availableWaveBuckets(data);
  const sorted = [...dataset.filtered].sort((a, b) => {
    if (sort === 'wave') return b.summary.wave - a.summary.wave;
    if (sort === 'duration') return b.summary.durationS - a.summary.durationS;
    if (sort === 'date') return (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt);
    const av = metricSortValue(a, metric);
    const bv = metricSortValue(b, metric);
    return typeof av === 'number' && typeof bv === 'number' ? bv - av : String(bv).localeCompare(String(av));
  }).slice(0, 80);
  const updateFilters = (patch: Partial<AnalyticsFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    syncExplorerUrl(next, domain, metric.id);
  };
  const updateDomain = (next: 'all' | MetricDomain) => {
    const nextMetric = metricsForDomain(next)[0]?.id ?? 'run.wave';
    setDomain(next);
    setMetricId(nextMetric);
    syncExplorerUrl(filters, next, nextMetric);
  };
  const updateMetric = (next: string) => {
    setMetricId(next);
    syncExplorerUrl(filters, domain, next);
  };
  const exportCsv = () => {
    const csv = metricCsv(dataset.filtered, [metric]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-analytics-${metric.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="adm-content">
      <div className="adm-filterbar adm-explorer-filters">
        <select aria-label="Analytics date range" value={filters.range} onChange={(e) => updateFilters({ range: e.target.value as AnalyticsFilters['range'] })}>
          <option value="all">all time</option><option value="30d">last 30d</option><option value="7d">last 7d</option><option value="24h">last 24h</option>
        </select>
        <select aria-label="Analytics sector" value={filters.map} onChange={(e) => updateFilters({ map: e.target.value })}>
          <option value="all">all sectors</option>{ALL_MAPS.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
        </select>
        <select aria-label="Analytics protocol" value={filters.diff} onChange={(e) => updateFilters({ diff: e.target.value })}>
          <option value="all">all protocols</option>{DIFFICULTIES.map((diff) => <option key={diff.id} value={diff.id}>{diff.name}</option>)}
        </select>
        <select aria-label="Analytics mode" value={filters.mode} onChange={(e) => updateFilters({ mode: e.target.value as AnalyticsFilters['mode'] })}>
          <option value="all">all modes</option><option value="campaign">campaign</option><option value="freeplay">freeplay</option>
        </select>
        <select aria-label="Analytics outcome" value={filters.outcome} onChange={(e) => updateFilters({ outcome: e.target.value })}>
          <option value="all">all outcomes</option><option value="victory">victory</option><option value="gameover">gameover</option><option value="abandoned">abandoned</option>
        </select>
        <select aria-label="Analytics wave bucket" value={filters.waveBucket} onChange={(e) => updateFilters({ waveBucket: e.target.value })}>
          <option value="all">all waves</option>{waveBuckets.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
        </select>
        <select aria-label="Analytics cohort" value={filters.cohort} onChange={(e) => updateFilters({ cohort: e.target.value as AnalyticsFilters['cohort'] })}>
          <option value="all">all cohorts</option><option value="first">first run</option><option value="returning">returning</option>
        </select>
        <select aria-label="Analytics schema" value={filters.schema} onChange={(e) => updateFilters({ schema: e.target.value })}>
          <option value="all">all schemas</option>{schemas.map((schema) => <option key={schema} value={schema}>schema {schema}</option>)}
        </select>
        <select aria-label="Analytics build" value={filters.build} onChange={(e) => updateFilters({ build: e.target.value })}>
          <option value="all">all builds</option>{builds.map((build) => <option key={build} value={build}>{build}</option>)}
        </select>
        <input aria-label="Analytics uid or run id" value={filters.uid} onChange={(e) => updateFilters({ uid: e.target.value })} placeholder="uid or run id" />
        <button className="adm-mini" onClick={refresh}>refresh</button>
        <button className="adm-mini" onClick={exportCsv}>CSV</button>
      </div>
      <div className="adm-filterbar adm-explorer-filters">
        <select aria-label="Metric domain" value={domain} onChange={(e) => updateDomain(e.target.value as 'all' | MetricDomain)}>
          {METRIC_DOMAINS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <select aria-label="Metric" value={metric.id} onChange={(e) => updateMetric(e.target.value)}>
          {metricOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="adm-filter-count">{dataset.filtered.length.toLocaleString()} / {data.length.toLocaleString()} runs</span>
        <span className="adm-hint">{metric.description}</span>
      </div>
      <div className="adm-stat-row">
        <Stat label="populated" value={`${aggregate.populated}/${aggregate.count}`} />
        <Stat label={metric.kind === 'boolean' ? 'true rate' : 'average'} value={metric.kind === 'boolean' ? pct(aggregate.trueCount / Math.max(1, aggregate.count)) : `${Math.round(aggregate.avg * 10) / 10}${metric.unit ?? ''}`} />
        <Stat label="median / p95" value={`${Math.round(aggregate.median * 10) / 10} / ${Math.round(aggregate.p95 * 10) / 10}`} />
        <Stat label="sum / max" value={`${Math.round(aggregate.sum).toLocaleString()} / ${Math.round(aggregate.max).toLocaleString()}`} />
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Top values</h3><span className="adm-hint">{metric.aggregation}</span></div>
          <MetricBars data={top} color={metric.domain === 'performance' ? '#ff9f43' : '#54a0ff'} />
        </div>
        <InsightDeck insights={dataset.insights} domain={metric.domain} title="Related insight cards" />
      </div>
      <div className="adm-card">
        <div className="adm-card-head">
          <h3>Run detail table</h3>
          <div className="adm-selects">
            {(['metric', 'wave', 'duration', 'date'] as const).map((key) => (
              <button key={key} className={sort === key ? 'on' : ''} onClick={() => setSort(key)}>{key.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <table className="adm-table adm-explorer-table">
          <thead><tr><th>run</th><th>uid</th><th>slice</th><th>outcome</th><th>wave</th><th>duration</th><th>{metric.label}</th><th /></tr></thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.runId}>
                <td>{row.runId.slice(0, 12)}</td>
                <td>{row.uid.slice(0, 10)}</td>
                <td>{mapName(row.summary.map)} / {diffName(row.summary.diff)}</td>
                <td>{row.summary.outcome}</td>
                <td>w{row.summary.wave}</td>
                <td>{Math.round(row.summary.durationS / 60)}m</td>
                <td>{formatMetricValue(readMetric(row, metric), metric)}</td>
                <td><button className="adm-mini" onClick={() => setSelected(row)}>open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="adm-empty">No runs match these filters.</div>}
      </div>
      {selected && <RunDetailDrawer row={selected} metric={metric} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RunDetailDrawer({ row, metric, onClose }: { row: RunAnalyticsRow; metric: MetricDefinition; onClose: () => void }) {
  const sections = ['summary', 'menu', 'controls', 'combat', 'placement', 'assistance', 'freeplay', 'towerInterest', 'progression', 'leaderboard', 'attention', 'performance'] as const;
  return (
    <div className="adm-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="adm-drawer" role="dialog" aria-label="Run analytics detail" onClick={(e) => e.stopPropagation()}>
        <div className="adm-card-head">
          <h3>{row.runId}</h3>
          <button className="adm-mini" onClick={onClose}>close</button>
        </div>
        <div className="adm-insight-grid">
          <div className="adm-insight"><b>Slice</b><span>{mapName(row.summary.map)} / {diffName(row.summary.diff)}</span><span>{row.summary.freeplay ? 'freeplay' : 'campaign'} / {row.summary.outcome}</span></div>
          <div className="adm-insight"><b>Selected metric</b><span>{metric.label}</span><span>{formatMetricValue(readMetric(row, metric), metric)}</span></div>
          <div className="adm-insight"><b>Run</b><span>w{row.summary.wave}, {row.summary.kills.toLocaleString()} kills</span><span>{Math.round(row.summary.durationS / 60)}m / build {row.build || 'unknown'}</span></div>
        </div>
        {sections.map((section) => (
          <details key={section} className="adm-json-section">
            <summary>{section}</summary>
            <pre>{JSON.stringify((row as unknown as Record<string, unknown>)[section], null, 2)}</pre>
          </details>
        ))}
      </aside>
    </div>
  );
}

function CombatStoryTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const dataset = buildAnalyticsDataset(data);
  const leaks = topRecord(data, metricById('combat.leaksByEnemy'));
  const ability = topRecord(data, metricById('combat.abilityCasts'));
  const pickups = topRecord(data, metricById('combat.pickupCollects'));
  const traitBars = [
    { label: 'cloaked', value: data.reduce((sum, row) => sum + row.combat.cloakedLeakCores, 0), color: '#ff6ec7' },
    { label: 'armored', value: data.reduce((sum, row) => sum + row.combat.armoredLeakCores, 0), color: '#feca57' },
    { label: 'boss', value: data.reduce((sum, row) => sum + row.combat.bossLeakCores, 0), color: '#ff4757' },
  ].filter((item) => item.value > 0);
  const wavePressure = [
    { label: 'first leak', value: avgOf(data.filter((row) => row.combat.firstLeakWave > 0), (row) => row.combat.firstLeakWave), color: '#ff9f43' },
    { label: 'peak enemies', value: avgOf(data, (row) => row.combat.peakEnemies), color: '#54a0ff' },
    { label: 'avg wave sec', value: avgOf(data, (row) => row.combat.avgWaveDurationS), color: '#7bed9f' },
    { label: 'longest wave sec', value: avgOf(data, (row) => row.combat.longestWaveDurationS), color: '#ffd32a' },
  ].filter((item) => item.value > 0);
  return (
    <div className="adm-content">
      <div className="adm-filterbar"><span className="adm-filter-count">{data.length.toLocaleString()} combat analytics docs</span><button className="adm-mini" onClick={refresh}>refresh</button></div>
      <div className="adm-stat-row">
        <Stat label="avg first leak" value={wavePressure[0]?.value ? `w${wavePressure[0].value.toFixed(1)}` : 'n/a'} />
        <Stat label="avg peak enemies" value={avgOf(data, (row) => row.combat.peakEnemies).toFixed(1)} />
        <Stat label="avg wave length" value={`${Math.round(avgOf(data, (row) => row.combat.avgWaveDurationS))}s`} />
        <Stat label="special leak share" value={pct((traitBars.reduce((sum, item) => sum + item.value, 0)) / Math.max(1, data.reduce((sum, row) => sum + row.summary.leaks, 0)))} />
      </div>
      <InsightDeck insights={dataset.insights} domain="combat" title="Combat readouts" />
      <div className="adm-card"><div className="adm-card-head"><h3>Survival curve</h3><span className="adm-hint">wins/losses by ending wave</span></div><SurvivalCurve buckets={survivalBuckets(data)} /></div>
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>Leak suspects</h3><span className="adm-hint">enemy ids causing cores lost</span></div><MetricBars data={leaks} color="#ff6b6b" /></div>
        <div className="adm-card"><div className="adm-card-head"><h3>Leak traits</h3><span className="adm-hint">threat class pressure</span></div>{traitBars.length ? <HBars data={traitBars} /> : <div className="adm-empty">No trait leaks recorded.</div>}</div>
      </div>
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>Ability usage</h3><span className="adm-hint">casts by ability id</span></div><MetricBars data={ability} color="#a55eea" /></div>
        <div className="adm-card"><div className="adm-card-head"><h3>Pickup collection</h3><span className="adm-hint">pickup interaction by type</span></div><MetricBars data={pickups} color="#2ed573" /></div>
      </div>
      <div className="adm-card"><div className="adm-card-head"><h3>Wave pressure markers</h3><span className="adm-hint">averages per run</span></div><HBars data={wavePressure} /></div>
    </div>
  );
}

function SystemsStoryTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const dataset = buildAnalyticsDataset(data);
  const placed = topRecord(data, metricById('placement.placedByTower')).map((item) => ({ ...item, label: TOWER_MAP[item.label]?.name ?? item.label }));
  const sold = topRecord(data, metricById('placement.soldByTower')).map((item) => ({ ...item, label: TOWER_MAP[item.label]?.name ?? item.label }));
  const first = topRecord(data, metricById('placement.firstTowerId')).map((item) => ({ ...item, label: TOWER_MAP[item.label]?.name ?? item.label }));
  const failedReasons = topRecord(data, metricById('placement.failedByReason'));
  const upgradeReasons = topRecord(data, metricById('placement.failedUpgradeByReason'));
  const placementCells = mergeCells(data, (row) => row.placement.placementCells);
  const failedCells = mergeCells(data, (row) => row.placement.failedPlacementCells);
  const cashBars = [
    { label: 'cash float end', value: avgOf(data, (row) => num(row.economy.cashFloatedEnd)), color: '#ffd32a' },
    { label: 'cash at death', value: avgOf(data, (row) => num(row.difficulty.cashAtDeath)), color: '#ff4757' },
    { label: 'idle cash sec', value: avgOf(data, (row) => num(row.economy.idleWithCashS)), color: '#ff9f43' },
    { label: 'failed buys', value: avgOf(data, (row) => num(row.economy.failedPurchaseAttempts)), color: '#54a0ff' },
    { label: 'failed upgrades', value: avgOf(data, (row) => num(row.economy.failedUpgradeAttempts)), color: '#a55eea' },
  ];
  const blueprintBars = [
    { label: 'saves', value: data.reduce((sum, row) => sum + row.placement.blueprintSaves, 0), color: '#54a0ff' },
    { label: 'applies', value: data.reduce((sum, row) => sum + row.placement.blueprintApplies, 0), color: '#2ed573' },
    { label: 'placed from apply', value: data.reduce((sum, row) => sum + row.placement.blueprintApplyPlaced, 0), color: '#ffd32a' },
  ].filter((item) => item.value > 0);
  return (
    <div className="adm-content">
      <div className="adm-filterbar"><span className="adm-filter-count">{data.length.toLocaleString()} system analytics docs</span><button className="adm-mini" onClick={refresh}>refresh</button></div>
      <div className="adm-stat-row">
        <Stat label="cash float end" value={`cash ${Math.round(avgOf(data, (row) => num(row.economy.cashFloatedEnd))).toLocaleString()}`} />
        <Stat label="lost while rich" value={pct(data.filter((row) => ['gameover', 'abandoned'].includes(row.summary.outcome) && num(row.economy.cashFloatedEnd) >= 1200).length / Math.max(1, data.length))} />
        <Stat label="quick sellbacks" value={data.reduce((sum, row) => sum + row.placement.quickSellbacks, 0).toLocaleString()} />
        <Stat label="target changes" value={data.reduce((sum, row) => sum + row.placement.targetModeChanges, 0).toLocaleString()} />
      </div>
      <OperationsHealthPanel runCount={data.length} />
      <InsightDeck insights={dataset.insights.filter((item) => item.domain === 'towers' || item.domain === 'placement')} title="Systems readouts" />
      <div className="adm-card"><div className="adm-card-head"><h3>Economy friction</h3><span className="adm-hint">averages per run</span></div><HBars data={cashBars} /></div>
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>First tower choices</h3><span className="adm-hint">opening habits</span></div><MetricBars data={first} /></div>
        <div className="adm-card"><div className="adm-card-head"><h3>Tower pick rate</h3><span className="adm-hint">placements by tower</span></div><MetricBars data={placed} color="#2ed573" /></div>
      </div>
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>Sold towers</h3><span className="adm-hint">sell behavior</span></div><MetricBars data={sold} color="#ff9f43" /></div>
        <div className="adm-card"><div className="adm-card-head"><h3>Failed reasons</h3><span className="adm-hint">placement and upgrade blocks</span></div><MetricBars data={[...failedReasons, ...upgradeReasons.map((item) => ({ ...item, label: `upgrade ${item.label}` }))]} color="#feca57" /></div>
      </div>
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>Placement heatmap</h3><span className="adm-hint">16x9 binned cells</span></div><HeatmapGrid title="placements" cells={placementCells} /></div>
        <div className="adm-card"><div className="adm-card-head"><h3>Failed placement heatmap</h3><span className="adm-hint">where players try invalid builds</span></div><HeatmapGrid title="failed placements" cells={failedCells} /></div>
      </div>
      <div className="adm-card"><div className="adm-card-head"><h3>Blueprint usage</h3><span className="adm-hint">save/apply follow-through</span></div>{blueprintBars.length ? <HBars data={blueprintBars} /> : <div className="adm-empty">Blueprint counters will appear after save/apply events.</div>}</div>
    </div>
  );
}

function UxPerfStoryTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const dataset = buildAnalyticsDataset(data);
  const inputBars = [
    { label: 'keyboard', value: data.reduce((sum, row) => sum + row.controls.keyboardInputs, 0), color: '#54a0ff' },
    { label: 'pointer', value: data.reduce((sum, row) => sum + row.controls.pointerInputs, 0), color: '#2ed573' },
    { label: 'touch', value: data.reduce((sum, row) => sum + row.controls.touchInputs, 0), color: '#ffd32a' },
  ].filter((item) => item.value > 0);
  const controlBars = [
    { label: 'pause toggles', value: data.reduce((sum, row) => sum + row.controls.pauseToggles, 0), color: '#54a0ff' },
    { label: 'speed changes', value: data.reduce((sum, row) => sum + row.controls.speedChanges, 0), color: '#7bed9f' },
    { label: 'abort armed', value: data.reduce((sum, row) => sum + row.controls.abortArmed, 0), color: '#ff4757' },
    { label: 'placement cancels', value: data.reduce((sum, row) => sum + row.controls.placementCancels, 0), color: '#feca57' },
    { label: 'ability aim cancels', value: data.reduce((sum, row) => sum + row.controls.abilityAimCancels, 0), color: '#a55eea' },
  ].filter((item) => item.value > 0);
  const assistBars = [
    { label: 'AI opens', value: data.reduce((sum, row) => sum + row.assistance.aiMenuOpens + row.assistance.aiGameOpens, 0), color: '#a55eea' },
    { label: 'AI questions', value: data.reduce((sum, row) => sum + row.assistance.aiQuestions, 0), color: '#54a0ff' },
    { label: 'AI successes', value: data.reduce((sum, row) => sum + row.assistance.aiSuccesses, 0), color: '#2ed573' },
    { label: 'AI errors', value: data.reduce((sum, row) => sum + row.assistance.aiErrors, 0), color: '#ff4757' },
    { label: 'feedback submits', value: data.reduce((sum, row) => sum + row.assistance.feedbackSubmits, 0), color: '#ffd32a' },
    { label: 'replies viewed', value: data.reduce((sum, row) => sum + row.assistance.feedbackRepliesViewed, 0), color: '#7bed9f' },
  ].filter((item) => item.value > 0);
  const viewportCounts = new Map<string, number>();
  const viewportFps = new Map<string, { fps: number; n: number; drops: number }>();
  for (const row of data) {
    const bucket = viewportBucket(row);
    viewportCounts.set(bucket, (viewportCounts.get(bucket) ?? 0) + 1);
    const e = viewportFps.get(bucket) ?? { fps: 0, n: 0, drops: 0 };
    if (row.performance.fpsAvg > 0) { e.fps += row.performance.fpsAvg; e.n++; }
    e.drops += row.performance.qualityDowngrades;
    viewportFps.set(bucket, e);
  }
  const viewportBars = [...viewportCounts.entries()].map(([label, value]) => ({ label, value, color: '#54a0ff', sub: `${Math.round((viewportFps.get(label)?.fps ?? 0) / Math.max(1, viewportFps.get(label)?.n ?? 0))} fps / ${viewportFps.get(label)?.drops ?? 0} drops` }));
  const leaderboardBars = [
    { label: 'opens', value: data.reduce((sum, row) => sum + num(row.leaderboard.openCount), 0), color: '#54a0ff' },
    { label: 'score submits', value: data.reduce((sum, row) => sum + num(row.leaderboard.scoreSubmitAttempts), 0), color: '#2ed573' },
    { label: 'score failures', value: data.reduce((sum, row) => sum + num(row.leaderboard.scoreSubmitFailures), 0), color: '#ff4757' },
    { label: 'replay opens', value: data.reduce((sum, row) => sum + num(row.leaderboard.replayOpens), 0), color: '#ffd32a' },
  ].filter((item) => item.value > 0);
  return (
    <div className="adm-content">
      <div className="adm-filterbar"><span className="adm-filter-count">{data.length.toLocaleString()} UX/perf analytics docs</span><button className="adm-mini" onClick={refresh}>refresh</button></div>
      <div className="adm-stat-row">
        <Stat label="avg fps" value={Math.round(avgOf(data.filter((row) => row.performance.fpsAvg > 0), (row) => row.performance.fpsAvg)).toString()} />
        <Stat label="long frames/run" value={avgOf(data, (row) => row.performance.longFrames).toFixed(1)} />
        <Stat label="widget pause/run" value={`${Math.round(avgOf(data, (row) => row.assistance.widgetPauseS))}s`} />
        <Stat label="standalone share" value={pct(data.filter((row) => row.performance.displayStandalone).length / Math.max(1, data.length))} />
      </div>
      <InsightDeck insights={dataset.insights.filter((item) => item.domain === 'performance' || item.domain === 'assistance')} title="UX and performance readouts" />
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>Input modality</h3><span className="adm-hint">interaction counts</span></div>{inputBars.length ? <HBars data={inputBars} /> : <div className="adm-empty">No input counters yet.</div>}</div>
        <div className="adm-card"><div className="adm-card-head"><h3>Control habits</h3><span className="adm-hint">friction and command usage</span></div>{controlBars.length ? <HBars data={controlBars} /> : <div className="adm-empty">No control counters yet.</div>}</div>
      </div>
      <div className="adm-two">
        <div className="adm-card"><div className="adm-card-head"><h3>Help and feedback</h3><span className="adm-hint">privacy-safe outcomes only</span></div>{assistBars.length ? <HBars data={assistBars} /> : <div className="adm-empty">No help activity yet.</div>}</div>
        <div className="adm-card"><div className="adm-card-head"><h3>Viewport performance</h3><span className="adm-hint">device bucket, avg FPS, quality drops</span></div>{viewportBars.length ? <HBars data={viewportBars} /> : <div className="adm-empty">No viewport samples yet.</div>}</div>
      </div>
      <div className="adm-card"><div className="adm-card-head"><h3>Leaderboard loop</h3><span className="adm-hint">submission and replay behavior</span></div>{leaderboardBars.length ? <HBars data={leaderboardBars} /> : <div className="adm-empty">No leaderboard activity yet.</div>}</div>
    </div>
  );
}

function mergeCells(rows: RunAnalyticsRow[], get: (row: RunAnalyticsRow) => Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(get(row))) out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

function RunIntelligenceTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const dataset = buildAnalyticsDataset(data);
  const freeplay = data.filter((r) => r.summary.freeplay);
  const days = analyticsByDay(data);
  const avgActive = avgOf(data, (r) => r.attention.activeS);
  const avgHidden = avgOf(data, (r) => r.attention.hiddenS);
  const avgCashFloat = avgOf(data, (r) => num(r.economy.cashFloatedEnd));
  const avgIdleCash = avgOf(data, (r) => num(r.economy.idleWithCashS));
  const avgFirstLeak = avgOf(data.filter((r) => num(r.combat?.firstLeakWave) > 0), (r) => num(r.combat?.firstLeakWave));
  const lostWhileRich = data.filter((r) => ['gameover', 'abandoned'].includes(r.summary.outcome) && num(r.economy.cashFloatedEnd) >= 1200).length;
  const avgLongFrames = avgOf(data, (r) => num(r.performance.longFrames));
  const avgQualityDrops = avgOf(data, (r) => num(r.performance.qualityDowngrades));
  const standaloneRuns = data.filter((r) => r.performance.displayStandalone).length;
  const installEvents = data.reduce((sum, r) => sum + num(r.performance.installed), 0);
  const mostCommonEnd = [...data].sort((a, b) => b.summary.wave - a.summary.wave)[0];
  const leakEnemies = new Map<string, number>();
  const failedByMap = new Map<string, number>();
  for (const r of data) {
    const topLeak = str(r.difficulty.topLeakEnemy);
    if (topLeak) leakEnemies.set(topLeak, (leakEnemies.get(topLeak) ?? 0) + 1);
    if (r.summary.outcome === 'gameover') failedByMap.set(r.summary.map, (failedByMap.get(r.summary.map) ?? 0) + 1);
  }
  const leakBars = [...leakEnemies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, value]) => ({ label, value, color: '#ff6b6b' }));
  const failMapBars = [...failedByMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, value]) => ({ label: mapName(id), value, color: '#ff9f43' }));
  const failReasonBars = mergedRecordBars(data, (r) => r.placement?.failedByReason, '#feca57');
  const placementCells = mergedRecordBars(data, (r) => r.placement?.placementCells, '#54a0ff');
  const firstTowerBars = (() => {
    const counts = new Map<string, number>();
    for (const r of data) {
      const id = r.placement?.firstTowerId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, value]) => ({ label: TOWER_MAP[id]?.name ?? id, value, color: towerGlow(id) }));
  })();
  const leakTraitBars = [
    { label: 'cloaked cores', value: data.reduce((sum, r) => sum + num(r.combat?.cloakedLeakCores), 0), color: '#ff6ec7' },
    { label: 'armored cores', value: data.reduce((sum, r) => sum + num(r.combat?.armoredLeakCores), 0), color: '#feca57' },
    { label: 'boss cores', value: data.reduce((sum, r) => sum + num(r.combat?.bossLeakCores), 0), color: '#ff4757' },
  ].filter((d) => d.value > 0);

  return (
    <div className="adm-content">
      <div className="adm-filterbar">
        <span className="adm-filter-count">{data.length.toLocaleString()} replay analytics docs</span>
        <button className="adm-mini" onClick={refresh}>refresh</button>
      </div>
      <InsightDeck insights={dataset.insights} title="Overview readouts" />
      <div className="adm-stat-row">
        <Stat label="avg active time" value={`${Math.round(avgActive / 60)}m`} />
        <Stat label="hidden per run" value={`${Math.round(avgHidden)}s`} />
        <Stat label="cash floated end" value={`⌬${Math.round(avgCashFloat).toLocaleString()}`} />
        <Stat label="freeplay share" value={pct(freeplay.length / data.length)} />
        <Stat label="lost while rich" value={pct(lostWhileRich / data.length)} />
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Outcome mix</h3><span className="adm-hint">completed, lost, abandoned</span></div>
          <HBars data={outcomeBars(data)} fmt={(v) => `${v}`} />
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Friction radar</h3><span className="adm-hint">normalized rates, not raw counts</span></div>
          <FrictionRadar rows={data} />
        </div>
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Run volume trend</h3><span className="adm-hint">last 30 active days</span></div>
        <MiniArea values={days.map(([, e]) => e.runs)} color="#54a0ff" height={120} />
        <div className="adm-legend">
          <span><i style={{ background: '#54a0ff' }} /> runs per day</span>
          <span>Latest: {days.at(-1)?.[0] ?? 'n/a'}</span>
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Enemy leak suspects</h3><span className="adm-hint">top leak enemy on death/ending</span></div>
          {leakBars.length ? <HBars data={leakBars} /> : <div className="adm-empty">No leak culprit data yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Losses by sector</h3><span className="adm-hint">where deaths cluster</span></div>
          {failMapBars.length ? <HBars data={failMapBars} /> : <div className="adm-empty">No gameover data in analytics yet.</div>}
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Placement learning</h3><span className="adm-hint">top binned build cells</span></div>
          {placementCells.length ? <HBars data={placementCells} /> : <div className="adm-empty">No placement buckets yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>First tower choices</h3><span className="adm-hint">opening habit by run</span></div>
          {firstTowerBars.length ? <HBars data={firstTowerBars} /> : <div className="adm-empty">No tower placement data yet.</div>}
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Placement friction</h3><span className="adm-hint">failed placement reasons</span></div>
          {failReasonBars.length ? <HBars data={failReasonBars} /> : <div className="adm-empty">No failed placements yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Leak traits</h3><span className="adm-hint">cores lost by threat class</span></div>
          {leakTraitBars.length ? <HBars data={leakTraitBars} /> : <div className="adm-empty">No trait-specific leaks yet.</div>}
        </div>
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Economy interpretation</h3><span className="adm-hint">what to tune first</span></div>
        <div className="adm-insight-grid">
          <div className="adm-insight"><b>Cash pressure</b><span>Avg end float: ⌬{Math.round(avgCashFloat).toLocaleString()}</span><span>Idle-with-cash window: {Math.round(avgIdleCash)}s</span></div>
          <div className="adm-insight"><b>Deepest run</b><span>{mostCommonEnd ? `${mostCommonEnd.summary.callsign} reached w${mostCommonEnd.summary.wave} on ${mapName(mostCommonEnd.summary.map)}` : 'No runs'}</span></div>
          <div className="adm-insight"><b>Purchase friction</b><span>{Math.round(avgOf(data, (r) => num(r.economy.failedPurchaseAttempts)) * 10) / 10} failed tower buys/run</span><span>{Math.round(avgOf(data, (r) => num(r.economy.failedUpgradeAttempts)) * 10) / 10} failed upgrades/run</span></div>
          <div className="adm-insight"><b>Attention</b><span>{Math.round(avgOf(data, (r) => r.attention.focusLosses) * 10) / 10} focus losses/run</span><span>{Math.round(avgOf(data, (r) => r.attention.pausedS))}s paused/run</span></div>
          <div className="adm-insight"><b>Combat pressure</b><span>First leak avg: {avgFirstLeak ? `w${avgFirstLeak.toFixed(1)}` : 'n/a'}</span><span>Peak enemies avg: {avgOf(data, (r) => num(r.combat?.peakEnemies)).toFixed(1)}</span></div>
          <div className="adm-insight"><b>Performance</b><span>{Math.round(avgLongFrames)} long frames/run</span><span>{avgQualityDrops.toFixed(1)} quality drops/run</span><span>{pct(standaloneRuns / data.length)} standalone / {installEvents} installs</span></div>
        </div>
      </div>
    </div>
  );
}

function EngagementTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const byUid = new Map<string, RunAnalyticsRow[]>();
  for (const r of data) {
    const list = byUid.get(r.uid) ?? [];
    list.push(r);
    byUid.set(r.uid, list);
  }
  const players = [...byUid.entries()].map(([uid, runs]) => ({
    uid,
    runs,
    sessions: Math.max(...runs.map((r) => num(r.progression.sessions))),
    daysSinceFirstSeen: Math.min(...runs.map((r) => num(r.progression.daysSinceFirstSeen))),
    won: runs.some((r) => r.summary.outcome === 'victory'),
    returnedAfterLoss: runs.length > 1 && runs[0].summary.outcome !== 'gameover',
  }));
  const funnelKeys = [
    ['deployClickedAt', 'deploy'],
    ['firstTowerPlacedAt', 'first tower'],
    ['firstUpgradeBoughtAt', 'first upgrade'],
    ['firstWaveSurvivedAt', 'survived wave'],
    ['firstWinAt', 'first win'],
  ] as const;
  const funnel = funnelKeys.map(([key, label]) => ({
    label,
    value: data.filter((r) => num(r.onboarding[key]) > 0).length,
    color: key === 'firstWinAt' ? '#2ed573' : '#54a0ff',
  }));
  const sessionBars = [
    { label: '1 run', value: players.filter((p) => p.runs.length === 1).length, color: '#ff9f43' },
    { label: '2-3 runs', value: players.filter((p) => p.runs.length >= 2 && p.runs.length <= 3).length, color: '#feca57' },
    { label: '4+ runs', value: players.filter((p) => p.runs.length >= 4).length, color: '#2ed573' },
  ];
  const speedBars = [
    { label: '1x', value: Math.round(avgOf(data, (r) => r.attention.speed1S)), color: '#54a0ff' },
    { label: '2x', value: Math.round(avgOf(data, (r) => r.attention.speed2S)), color: '#7bed9f' },
    { label: '4x', value: Math.round(avgOf(data, (r) => r.attention.speed4S)), color: '#ffd32a' },
  ];
  const panelBars = [
    { label: 'shop', value: Math.round(avgOf(data, (r) => r.attention.shopPanelS)), color: '#54a0ff' },
    { label: 'upgrade', value: Math.round(avgOf(data, (r) => r.attention.upgradePanelS)), color: '#ffd32a' },
    { label: 'overlay', value: Math.round(avgOf(data, (r) => r.attention.overlayS)), color: '#ff9f43' },
    { label: 'widget', value: Math.round(avgOf(data, (r) => r.attention.widgetOpenS)), color: '#a55eea' },
  ];
  const assistanceBars = [
    { label: 'AI opens', value: data.reduce((sum, r) => sum + num(r.assistance?.aiMenuOpens) + num(r.assistance?.aiGameOpens), 0), color: '#a55eea' },
    { label: 'AI questions', value: data.reduce((sum, r) => sum + num(r.assistance?.aiQuestions), 0), color: '#54a0ff' },
    { label: 'AI errors', value: data.reduce((sum, r) => sum + num(r.assistance?.aiErrors), 0), color: '#ff9f43' },
    { label: 'feedback sends', value: data.reduce((sum, r) => sum + num(r.assistance?.feedbackSubmits), 0), color: '#2ed573' },
    { label: 'replies viewed', value: data.reduce((sum, r) => sum + num(r.assistance?.feedbackRepliesViewed), 0), color: '#ffd32a' },
  ].filter((d) => d.value > 0);
  const controlBars = [
    { label: 'pause toggles', value: data.reduce((sum, r) => sum + num(r.controls?.pauseToggles), 0), color: '#54a0ff' },
    { label: 'speed changes', value: data.reduce((sum, r) => sum + num(r.controls?.speedChanges), 0), color: '#7bed9f' },
    { label: 'panel collapses', value: data.reduce((sum, r) => sum + num(r.controls?.sidePanelCollapses), 0), color: '#feca57' },
    { label: 'abort armed', value: data.reduce((sum, r) => sum + num(r.controls?.abortArmed), 0), color: '#ff4757' },
    { label: 'wave key launches', value: data.reduce((sum, r) => sum + num(r.controls?.waveLaunchKeys), 0), color: '#a55eea' },
  ].filter((d) => d.value > 0);
  const unlockUse = new Map<string, { earned: number; viewed: number; used: number }>();
  for (const r of data) {
    for (const id of r.progression.unlocksEarned) (unlockUse.get(id) ?? unlockUse.set(id, { earned: 0, viewed: 0, used: 0 }).get(id)!).earned++;
    for (const id of r.progression.unlocksViewed) (unlockUse.get(id) ?? unlockUse.set(id, { earned: 0, viewed: 0, used: 0 }).get(id)!).viewed++;
    for (const id of r.progression.unlockedTowerIdsUsed) (unlockUse.get(id) ?? unlockUse.set(id, { earned: 0, viewed: 0, used: 0 }).get(id)!).used++;
  }
  const unlockBars = [...unlockUse.entries()].map(([id, v]) => ({ label: TOWER_MAP[id]?.name ?? id, value: v.used, color: towerGlow(id), sub: `${v.earned} earned / ${v.viewed} viewed` }))
    .sort((a, b) => b.value - a.value).slice(0, 10);

  return (
    <div className="adm-content">
      <div className="adm-filterbar">
        <span className="adm-filter-count">{players.length.toLocaleString()} players / {data.length.toLocaleString()} runs</span>
        <button className="adm-mini" onClick={refresh}>refresh</button>
      </div>
      <div className="adm-stat-row">
        <Stat label="multi-run players" value={pct(players.filter((p) => p.runs.length > 1).length / Math.max(1, players.length))} />
        <Stat label="players with win" value={pct(players.filter((p) => p.won).length / Math.max(1, players.length))} />
        <Stat label="avg runs/player" value={avgOf(players, (p) => p.runs.length).toFixed(1)} />
        <Stat label="avg session count" value={avgOf(players, (p) => p.sessions).toFixed(1)} />
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Onboarding funnel</h3><span className="adm-hint">run docs with each milestone</span></div>
          <HBars data={funnel} max={data.length} fmt={(v) => `${v}`} />
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Runs per player</h3><span className="adm-hint">retention shape</span></div>
          <HBars data={sessionBars} />
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Speed preference</h3><span className="adm-hint">avg seconds per run</span></div>
          <HBars data={speedBars} />
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Panel dwell</h3><span className="adm-hint">avg seconds per run</span></div>
          <HBars data={panelBars} />
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Help and feedback loop</h3><span className="adm-hint">privacy-safe counters only</span></div>
          {assistanceBars.length ? <HBars data={assistanceBars} /> : <div className="adm-empty">No AI/help activity yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Control habits</h3><span className="adm-hint">run-level action counters</span></div>
          {controlBars.length ? <HBars data={controlBars} /> : <div className="adm-empty">No control counters yet.</div>}
        </div>
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Unlock follow-through</h3><span className="adm-hint">earned vs viewed vs actually used later</span></div>
        {unlockBars.length ? <HBars data={unlockBars} /> : <div className="adm-empty">Unlock events will appear after players cross new thresholds.</div>}
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Engagement recommendations</h3><span className="adm-hint">derived from attention/funnel signals</span></div>
        <div className="adm-idea-grid">
          <IdeaCard tag="first 5 minutes" title="Reward the first upgrade" body="If first-upgrade conversion is low, give a one-time upgrade voucher after wave 3 so players learn paths before the economy gets noisy." />
          <IdeaCard tag="return loop" title="Run recap with next goal" body="After loss, show one specific next objective: 'reach wave 25 on Twin Reactor' or 'try one sensor tower'. Tie it to a small account reward." />
          <IdeaCard tag="confusion" title="Explain idle-with-cash" body="If players sit on cash before dying, surface a subtle commander prompt pointing to affordable upgrades or the strongest tower underperforming." />
          <IdeaCard tag="mastery" title="Replay a better run" body="Once replay viewer exists, show a leaderboard ghost/build order for the same map and protocol after a player loses twice there." />
        </div>
      </div>
    </div>
  );
}

function IdeaCard({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="adm-idea">
      <span>{tag}</span>
      <b>{title}</b>
      <p>{body}</p>
    </div>
  );
}

function FreeplayLabTab() {
  const { rows, err, refresh } = useRunAnalytics();
  const state = AnalyticsState({ rows, err });
  if (state) return <div className="adm-content">{state}</div>;
  const data = rows!;
  const freeplay = data.filter((r) => r.summary.freeplay);
  const waveBuckets = new Map<string, number>();
  for (const r of freeplay) waveBuckets.set(bucket(r.summary.wave), (waveBuckets.get(bucket(r.summary.wave)) ?? 0) + 1);
  const waveBars = [...waveBuckets.entries()].sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
    .map(([label, value]) => ({ label, value, color: '#54a0ff' }));
  const avgWave = avgOf(freeplay, (r) => r.summary.wave);
  const bestWave = freeplay.length ? Math.max(...freeplay.map((r) => r.summary.wave)) : 0;
  const avgFloat = avgOf(freeplay, (r) => num(r.economy.cashFloatedEnd));
  const avgDuration = avgOf(freeplay, (r) => r.summary.durationS);
  const dailyShare = freeplay.length ? freeplay.filter((r) => !!r.freeplay?.dailyId).length / freeplay.length : 0;
  const contractBars = mergedRecordBars(freeplay, (r) => r.freeplay?.contractSelections, '#54a0ff');
  const relicBars = mergedRecordBars(freeplay, (r) => r.freeplay?.relicSelections, '#ffd32a');
  const riskAcceptedBars = mergedRecordBars(freeplay, (r) => r.freeplay?.riskAccepted, '#2ed573');
  const riskDeclinedBars = mergedRecordBars(freeplay, (r) => r.freeplay?.riskDeclined, '#ff9f43');
  const mutatorBars = mergedRecordBars(freeplay, (r) => r.freeplay?.mutatorWaves, '#a55eea');
  const rivalBars = mergedRecordBars(freeplay, (r) => r.freeplay?.rivalDefeats, '#ff6b6b');
  const checkpointSubmits = freeplay.reduce((sum, r) => sum + num(r.freeplay?.checkpointSubmits), 0);
  const ideas = [
    ['Relic Drafts', 'Every 5 freeplay waves, offer 1 of 3 run-warping relics: double support aura but bosses gain shields, missiles home harder but reload slower, burn zones merge into firestorms.'],
    ['Elite Mutators', 'Let the armada roll escalating modifiers: armored swarm, cloak surge, healer convoy, boss escort, credit drought, overdrive storm. Show the next modifier before launch.'],
    ['Prestige Contracts', 'At campaign victory, choose a contract before entering freeplay: no sells, limited towers, one damage type, low cores. Contracts multiply score and cosmetics.'],
    ['Boss Rival System', 'Every 10 waves, spawn a named flagship that remembers what killed it last time and returns with counters. Kill streaks unlock badges.'],
    ['Endless Shop Rotation', 'After wave cap, rotate experimental upgrades: temporary overclocks, tower fusions, aura amplifiers, map-wide commander tech.'],
    ['Freeplay Milestones', 'Wave 75/100/125 should each unlock a new visual state, title, map variant, or commander line so deep runs feel authored.'],
    ['Leaderboard Ghosts', 'Let a player load the build order/tower layout from a leaderboard run as a ghost overlay and race against its wave cadence.'],
    ['Risk Payout Waves', 'Optional red-alert waves: harder enemy packet now for permanent score multiplier or a rare upgrade currency payout.'],
    ['Adaptive Economy', 'If cash float stays high, freeplay can spawn bounty elites that cost attention to kill, while reducing passive wave bonuses.'],
    ['Tower Fusion Lab', 'At high waves, combine two maxed towers into a hybrid role with a downside. This gives excess cash a fantasy sink.'],
    ['Map Events', 'Random freeplay events per sector: lanes invert briefly, blockers power up, beacon zones move, storm disables sensors for one wave.'],
    ['Daily Endless Seed', 'One global daily freeplay seed with fixed modifiers. Everyone competes on the same conditions, which makes scores feel fairer.'],
  ] as const;
  return (
    <div className="adm-content">
      <div className="adm-filterbar">
        <span className="adm-filter-count">{freeplay.length.toLocaleString()} freeplay analytics runs</span>
        <button className="adm-mini" onClick={refresh}>refresh</button>
      </div>
      <div className="adm-stat-row">
        <Stat label="avg freeplay wave" value={avgWave ? `w${avgWave.toFixed(1)}` : 'n/a'} />
        <Stat label="best wave" value={bestWave ? `w${bestWave}` : 'n/a'} />
        <Stat label="avg run length" value={avgDuration ? `${Math.round(avgDuration / 60)}m` : 'n/a'} />
        <Stat label="avg cash float" value={avgFloat ? `⌬${Math.round(avgFloat).toLocaleString()}` : 'n/a'} />
        <Stat label="daily share" value={pct(dailyShare)} />
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Freeplay ending waves</h3><span className="adm-hint">analytics only</span></div>
          {waveBars.length ? <HBars data={waveBars} /> : <div className="adm-empty">No freeplay analytics yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Freeplay design goals</h3></div>
          <div className="adm-devs">
            <span className="adm-dev">Make excess cash turn into interesting choices, not just bigger numbers.</span>
            <span className="adm-dev">Add readable threat variety every 5-10 waves so deep runs have chapters.</span>
            <span className="adm-dev">Create opt-in risk for leaderboard climbers without punishing casual victory runs.</span>
            <span className="adm-dev">Give players permanent reasons to attempt one more deep run tomorrow.</span>
          </div>
        </div>
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Freeplay decision funnel</h3><span className="adm-hint">contracts, relics, risks, checkpoints</span></div>
        <div className="adm-insight-grid">
          <div className="adm-insight"><b>Checkpoint banking</b><span>{checkpointSubmits.toLocaleString()} submissions</span><span>Avg multiplier {avgOf(freeplay, (r) => num(r.freeplay?.scoreMultiplierEnd) || 1).toFixed(2)}x</span></div>
          <div className="adm-insight"><b>Relic offers</b><span>{freeplay.reduce((sum, r) => sum + num(r.freeplay?.relicOffers), 0).toLocaleString()} offers shown</span><span>{relicBars.reduce((sum, r) => sum + r.value, 0).toLocaleString()} relics selected</span></div>
          <div className="adm-insight"><b>Risk choices</b><span>{riskAcceptedBars.reduce((sum, r) => sum + r.value, 0).toLocaleString()} accepted</span><span>{riskDeclinedBars.reduce((sum, r) => sum + r.value, 0).toLocaleString()} declined</span></div>
          <div className="adm-insight"><b>Daily endless</b><span>{pct(dailyShare)} of freeplay analytics</span><span>{freeplay.filter((r) => !!r.freeplay?.dailyId).length} daily runs</span></div>
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Contract choices</h3><span className="adm-hint">prestige entry picks</span></div>
          {contractBars.length ? <HBars data={contractBars} /> : <div className="adm-empty">No contract selections yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Relic picks</h3><span className="adm-hint">what players choose</span></div>
          {relicBars.length ? <HBars data={relicBars} /> : <div className="adm-empty">No relic selections yet.</div>}
        </div>
      </div>
      <div className="adm-two">
        <div className="adm-card">
          <div className="adm-card-head"><h3>Risk decisions</h3><span className="adm-hint">accepted and declined packets</span></div>
          {riskAcceptedBars.length || riskDeclinedBars.length ? (
            <>
              {riskAcceptedBars.length ? <HBars data={riskAcceptedBars.map((d) => ({ ...d, label: `${d.label} accepted` }))} /> : null}
              {riskDeclinedBars.length ? <HBars data={riskDeclinedBars.map((d) => ({ ...d, label: `${d.label} declined` }))} /> : null}
            </>
          ) : <div className="adm-empty">No risk decisions yet.</div>}
        </div>
        <div className="adm-card">
          <div className="adm-card-head"><h3>Mutator exposure</h3><span className="adm-hint">waves played under each modifier</span></div>
          {mutatorBars.length ? <HBars data={mutatorBars} /> : <div className="adm-empty">No mutator wave data yet.</div>}
        </div>
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Rival defeats</h3><span className="adm-hint">named boss clears</span></div>
        {rivalBars.length ? <HBars data={rivalBars} /> : <div className="adm-empty">No rival defeats yet.</div>}
      </div>
      <div className="adm-card">
        <div className="adm-card-head"><h3>Freeplay upgrade backlog</h3><span className="adm-hint">ranked ideas to make endless mode less solved</span></div>
        <div className="adm-idea-grid">
          {ideas.map(([title, body], i) => <IdeaCard key={title} tag={`idea ${i + 1}`} title={title} body={body} />)}
        </div>
      </div>
    </div>
  );
}

// ---------------- replay of the day ----------------

const SPOT_RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;

function SpotlightTab({ user }: { user: User }) {
  const [pinned, setPinned] = useState<PinnedSpotlight | null>(null);
  const [candidates, setCandidates] = useState<RankedScoreEntry[] | null>(null);
  const [manualId, setManualId] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [pin, campaign, freeplay] = await Promise.all([
        fetchPinnedSpotlightAdmin(),
        fetchGlobalTop(false, 20),
        fetchGlobalTop(true, 20),
      ]);
      setPinned(pin);
      const seen = new Set<string>();
      const dedup = [...campaign, ...freeplay]
        .filter((r) => r.runId && SPOT_RUN_ID_RE.test(r.runId) && !seen.has(r.runId) && (seen.add(r.runId), true))
        .sort((a, b) => b.wave - a.wave)
        .slice(0, 24);
      setCandidates(dedup);
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Load failed.' });
    }
  };
  useEffect(() => { void load(); }, []);

  const doPin = async (s: ReplaySpotlight) => {
    setBusy(true); setStatus(null);
    try {
      await pinReplayOfTheDay(s, user.email);
      setStatus({ kind: 'ok', text: `Pinned ${s.callsign} · Wave ${s.wave}. (Live on the menu within ~1 min.)` });
      await load();
    } catch (e) { setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Pin failed.' }); }
    finally { setBusy(false); }
  };
  const pinManual = async () => {
    const id = manualId.trim();
    if (!SPOT_RUN_ID_RE.test(id)) { setStatus({ kind: 'err', text: 'Not a valid run id (expected r_…).' }); return; }
    setBusy(true); setStatus(null);
    try {
      const s = await spotlightFromRunId(id);
      if (!s) { setStatus({ kind: 'err', text: 'No replay found for that run id.' }); return; }
      await pinReplayOfTheDay(s, user.email);
      setManualId('');
      setStatus({ kind: 'ok', text: `Pinned ${s.callsign} · Wave ${s.wave}.` });
      await load();
    } catch (e) { setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Pin failed.' }); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true); setStatus(null);
    try { await unpinReplayOfTheDay(); setStatus({ kind: 'ok', text: 'Cleared — reverted to the automatic daily pick.' }); await load(); }
    catch (e) { setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Clear failed.' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="adm-spotlight">
      <div className="adm-filterbar">
        <span className="adm-filter-count">REPLAY OF THE DAY</span>
        <button className="adm-mini" disabled={busy} onClick={() => void load()}>refresh</button>
      </div>
      <p className="adm-spot-help">Pin a run to feature on the menu spotlight, or clear to use the automatic daily pick (strongest recent run).</p>

      <div className="adm-spot-current">
        {pinned ? (
          <>
            <div><b>Pinned:</b> {pinned.callsign} · Wave {pinned.wave} · {pinned.mapName} {pinned.diffName}{pinned.freeplay ? ' · FREEPLAY' : ''}</div>
            <div className="adm-spot-dim">{pinned.runId}{pinned.pinnedBy ? ` · by ${pinned.pinnedBy}` : ''}</div>
            <div className="adm-spot-row">
              <a className="adm-mini" href={`/?run=${pinned.runId}`} target="_blank" rel="noreferrer">▶ watch</a>
              <button className="adm-mini" disabled={busy} onClick={() => void clear()}>clear (use automatic)</button>
            </div>
          </>
        ) : (
          <div className="adm-spot-dim">No pin set — the menu shows the automatic daily pick.</div>
        )}
      </div>

      {status && <div className={`adm-spot-status ${status.kind}`}>{status.text}</div>}

      <div className="adm-spot-manual">
        <input className="adm-spot-input" placeholder="paste run id (r_…)" value={manualId} onChange={(e) => setManualId(e.target.value)} />
        <button className="adm-mini" disabled={busy || !manualId.trim()} onClick={() => void pinManual()}>pin by id</button>
      </div>

      <div className="adm-spot-listhead">Top runs with replays</div>
      {candidates === null ? <div className="adm-spot-dim">Loading…</div>
        : candidates.length === 0 ? <div className="adm-spot-dim">No runs with replays yet.</div>
        : (
          <div className="adm-spot-list">
            {candidates.map((r) => (
              <div key={r.runId} className={`adm-spot-cand ${pinned?.runId === r.runId ? 'on' : ''}`}>
                <span className="adm-spot-cn">{r.name}</span>
                <span className="adm-spot-dim">W{r.wave} · {r.mapName} {r.diffName}{r.freeplay ? ' · FP' : ''}</span>
                <a className="adm-mini" href={`/?run=${r.runId}`} target="_blank" rel="noreferrer">▶</a>
                <button className="adm-mini" disabled={busy || pinned?.runId === r.runId}
                  onClick={() => void doPin({ runId: r.runId!, callsign: r.name, wave: r.wave, mapName: r.mapName, diffName: r.diffName, freeplay: r.freeplay })}>
                  {pinned?.runId === r.runId ? 'pinned' : 'pin'}
                </button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ---------------- shell ----------------

function AdminGate({ user, allowed, loading, error, onSignIn, onSignOut }: {
  user: User | null;
  allowed: boolean;
  loading: boolean;
  error: string;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="adm-root adm-login-root">
      <div className="adm-login-card">
        <div className="adm-eyebrow">LANTERN SEVEN · ADMIN</div>
        <h1>OPERATIONS CONSOLE</h1>
        {loading ? (
          <p className="adm-hint">Checking command credentials...</p>
        ) : user && !allowed ? (
          <>
            <p className="adm-denied">Signed in as {user.email}, but this account is not on the admin allowlist.</p>
            <button className="adm-exit" onClick={onSignOut}>SIGN OUT</button>
          </>
        ) : (
          <>
            <p className="adm-hint">Sign in with the approved Google account to read and respond to player messages.</p>
            <button className="adm-google" onClick={onSignIn}>SIGN IN WITH GOOGLE</button>
          </>
        )}
        {error && <p className="adm-denied">{error}</p>}
        <button className="adm-exit adm-login-exit" onClick={clearAdmin}>BACK TO GAME</button>
      </div>
    </div>
  );
}

function InboxTab({ user }: { user: User }) {
  const [rows, setRows] = useState<FeedbackMessage[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'replied' | 'archived' | 'all'>('open');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => watchFeedback((r) => {
    setRows(r);
    setErr('');
  }, () => setErr('Feedback inbox read failed. Check Firebase Auth provider and deployed Firestore rules.')), []);

  const visible = useMemo(() => {
    const list = rows ?? [];
    return filter === 'all' ? list : list.filter((r) => (r.status ?? 'open') === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      open: list.filter((r) => (r.status ?? 'open') === 'open').length,
      replied: list.filter((r) => r.status === 'replied').length,
      archived: list.filter((r) => r.status === 'archived').length,
      all: list.length,
    };
  }, [rows]);

  const saveReply = async (row: FeedbackMessage) => {
    const reply = (drafts[row.id] ?? row.reply ?? '').trim();
    if (!reply) return;
    setBusy(row.id);
    try {
      await replyToFeedback(row.id, reply, user);
      setDrafts((d) => ({ ...d, [row.id]: '' }));
    } catch {
      setErr('Reply failed. Confirm this Google account is allowlisted in firestore.rules.');
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (row: FeedbackMessage, status: 'open' | 'archived') => {
    setBusy(row.id);
    try {
      await setFeedbackStatus(row.id, status);
    } catch {
      setErr('Status update failed. Confirm this Google account is allowlisted in firestore.rules.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="adm-content">
      <div className="adm-meta-bar">Signed in as {user.email} · {counts.all} player messages</div>
      <div className="adm-card">
        <div className="adm-card-head">
          <h3>Player inbox</h3>
          <div className="adm-selects adm-inbox-filters">
            {(['open', 'replied', 'archived', 'all'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f.toUpperCase()} {counts[f]}
              </button>
            ))}
          </div>
        </div>
        {err && <div className="adm-empty adm-denied">{err}</div>}
        {rows === null ? (
          <div className="adm-empty">Loading messages...</div>
        ) : visible.length === 0 ? (
          <div className="adm-empty">No {filter === 'all' ? '' : filter} messages.</div>
        ) : (
          <div className="adm-inbox-list">
            {visible.map((row) => {
              const draft = drafts[row.id] ?? row.reply ?? '';
              return (
                <article key={row.id} className={`adm-message status-${row.status ?? 'open'}`}>
                  <div className="adm-message-head">
                    <div>
                      <span className="adm-status">{row.status ?? 'open'}</span>
                      <span className="adm-msg-date">{row.ts ? new Date(row.ts).toLocaleString() : 'unknown time'}</span>
                    </div>
                    <div className="adm-msg-meta">{row.ctx || 'unknown'} · {row.uid || 'no uid'}</div>
                  </div>
                  <p className="adm-msg-text">{row.text}</p>
                  {row.reply && (
                    <div className="adm-saved-reply">
                      <b>Reply saved</b>
                      <p>{row.reply}</p>
                      <span>{row.repliedBy}{row.replyTs ? ` · ${new Date(row.replyTs).toLocaleString()}` : ''}</span>
                    </div>
                  )}
                  <textarea
                    className="adm-reply-box"
                    maxLength={2000}
                    aria-label={`Reply to ${row.ctx} feedback from ${row.uid}`}
                    placeholder="Write an admin response..."
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  />
                  <div className="adm-message-actions">
                    <button className="adm-exit" disabled={busy === row.id || !draft.trim()} onClick={() => void saveReply(row)}>
                      {busy === row.id ? 'SAVING...' : 'SAVE REPLY'}
                    </button>
                    {(row.status ?? 'open') !== 'open' && (
                      <button className="adm-exit" disabled={busy === row.id} onClick={() => void changeStatus(row, 'open')}>REOPEN</button>
                    )}
                    {row.status !== 'archived' && (
                      <button className="adm-exit" disabled={busy === row.id} onClick={() => void changeStatus(row, 'archived')}>ARCHIVE</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  type AdminTab = 'inbox' | 'balance' | 'towers' | 'telemetry' | 'explore' | 'overview' | 'journey' | 'combat' | 'systems' | 'freeplay' | 'uxperf' | 'spotlight';
  const [tab, setTabState] = useState<AdminTab>(() => {
    const t = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tab') : null;
    return t === 'balance' || t === 'towers' || t === 'telemetry' || t === 'explore' || t === 'overview' || t === 'journey'
      || t === 'combat' || t === 'systems' || t === 'freeplay' || t === 'uxperf' || t === 'spotlight' ? t : 'inbox';
  });
  const setTab = (t: AdminTab) => {
    setTabState(t);
    try { const u = new URL(location.href); u.searchParams.set('tab', t); history.replaceState(null, '', u); } catch { /* ignore */ }
  };
  const [report, setReport] = useState<Report | null | 'missing'>(null);
  const [towerReport, setTowerReport] = useState<TowerDeepDiveReport | null | 'missing'>(null);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [authErr, setAuthErr] = useState('');

  useEffect(() => watchAdminAuth((u, ok) => {
    setUser(u);
    setAllowed(ok);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    fetch('/balance-report.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Report) => setReport(j))
      .catch(() => setReport('missing'));
  }, []);

  useEffect(() => {
    fetch('/tower-deep-dive-report.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: TowerDeepDiveReport) => setTowerReport(j))
      .catch(() => setTowerReport('missing'));
  }, []);

  if (!authReady || !user || !allowed) {
    return (
      <AdminGate
        user={user}
        allowed={allowed}
        loading={!authReady}
        error={authErr}
        onSignIn={() => {
          setAuthErr('');
          void signInAdmin().catch((e) => setAuthErr(e instanceof Error ? e.message : 'Google sign-in failed.'));
        }}
        onSignOut={() => void signOutAdmin()}
      />
    );
  }

  return (
    <div className="adm-root">
      <header className="adm-topbar">
        <div className="adm-brand">
          <span className="adm-eyebrow">LANTERN SEVEN · OPERATIONS</span>
          <h1>OPERATIONS CONSOLE</h1>
        </div>
        <nav className="adm-tabs">
          <button className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>INBOX</button>
          <button className={tab === 'spotlight' ? 'on' : ''} onClick={() => setTab('spotlight')}>SPOTLIGHT</button>
          <button className={tab === 'balance' ? 'on' : ''} onClick={() => setTab('balance')}>BALANCE</button>
          <button className={tab === 'towers' ? 'on' : ''} onClick={() => setTab('towers')}>TOWERS</button>
          <button className={tab === 'telemetry' ? 'on' : ''} onClick={() => setTab('telemetry')}>TELEMETRY</button>
          <button className={tab === 'explore' ? 'on' : ''} onClick={() => setTab('explore')}>EXPLORE</button>
          <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>OVERVIEW</button>
          <button className={tab === 'journey' ? 'on' : ''} onClick={() => setTab('journey')}>JOURNEY</button>
          <button className={tab === 'combat' ? 'on' : ''} onClick={() => setTab('combat')}>COMBAT</button>
          <button className={tab === 'systems' ? 'on' : ''} onClick={() => setTab('systems')}>SYSTEMS</button>
          <button className={tab === 'freeplay' ? 'on' : ''} onClick={() => setTab('freeplay')}>FREEPLAY</button>
          <button className={tab === 'uxperf' ? 'on' : ''} onClick={() => setTab('uxperf')}>UX/PERF</button>
        </nav>
        <div className="adm-actions">
          <span className="adm-readonly">{user.email}</span>
          <button className="adm-exit" onClick={() => void signOutAdmin()}>SIGN OUT</button>
          <button className="adm-exit" onClick={clearAdmin}>EXIT</button>
        </div>
      </header>

      {tab === 'inbox' ? <InboxTab user={user} /> : tab === 'spotlight' ? <SpotlightTab user={user} /> : tab === 'balance' ? (
        report === null ? <div className="adm-content"><div className="adm-card"><div className="adm-empty">Loading balance report…</div></div></div>
          : report === 'missing'
            ? <div className="adm-content"><div className="adm-card"><div className="adm-empty">
                <p>No balance report found at <code>/balance-report.json</code>.</p>
                <p className="adm-hint">Run <code>npm run balance</code> to generate it.</p>
              </div></div></div>
            : <BalanceTab report={report} />
      ) : tab === 'towers' ? (
        towerReport === null ? <div className="adm-content"><div className="adm-card"><div className="adm-empty">Loading tower deep dive…</div></div></div>
          : towerReport === 'missing'
            ? <div className="adm-content"><div className="adm-card"><div className="adm-empty">
                <p>No tower deep-dive report found at <code>/tower-deep-dive-report.json</code>.</p>
                <p className="adm-hint">Run <code>npm run tower:deep-dive</code> to generate it.</p>
              </div></div></div>
            : <TowerDeepDiveTab report={towerReport} />
      ) : tab === 'telemetry' ? <TelemetryTab report={report} />
        : tab === 'explore' ? <MetricExplorerTab />
          : tab === 'overview' ? <RunIntelligenceTab />
            : tab === 'journey' ? <EngagementTab />
              : tab === 'combat' ? <CombatStoryTab />
                : tab === 'systems' ? <SystemsStoryTab />
                  : tab === 'freeplay' ? <FreeplayLabTab />
                    : <UxPerfStoryTab />}
    </div>
  );
}
