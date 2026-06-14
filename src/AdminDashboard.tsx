// Authenticated owner operations console. The unlinked /admin route is still
// protected by Firebase Google Auth plus the admin allowlist in Firestore rules.
// BALANCE reads public/balance-report.json; FEEDBACK and TELEMETRY read admin-only Firestore data.

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import './App.css';
import { ALL_MAPS, DIFFICULTIES } from './game/maps';
import { TOWERS, TOWER_MAP } from './game/towers';
import { clearAdmin } from './game/admin';
import { fetchTelemetry, type TelemetryRow } from './game/leaderboard';
import { analyzeDifficulty, DIFFICULTY_TARGETS, type WaveDifficulty } from './game/difficulty';
import {
  replyToFeedback,
  setFeedbackStatus,
  signInAdmin,
  signOutAdmin,
  watchAdminAuth,
  watchFeedback,
  type FeedbackMessage,
} from './game/firebaseClient';

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
          <select value={mapId} onChange={(e) => setMapId(e.target.value)}>
            {ALL_MAPS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={diffId} onChange={(e) => setDiffId(e.target.value)}>
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
            <Stat label="crowd DPS" value={String(cur.b.aoe)} />
            <Stat label="DPS / credit" value={cur.b.dpsPerCredit.toFixed(3)} />
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
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {curves.map((c) => <option key={c.diff} value={c.diff}>{c.name}</option>)}
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
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

function TelemetryTab() {
  const [rows, setRows] = useState<TelemetryRow[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    fetchTelemetry(1000).then((r) => { if (live) { setRows(r); } }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, []);

  const stats = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const n = rows.length;
    const avg = (f: (r: TelemetryRow) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
    // death/end histogram bucketed by wave, split by kind
    const buckets = new Map<string, { gameover: number; victory: number; armistice: number }>();
    for (const r of rows) {
      const b = bucket(r.wave);
      const e = buckets.get(b) ?? { gameover: 0, victory: 0, armistice: 0 };
      if (r.kind === 'victory') e.victory++;
      else if (r.kind === 'armistice') e.armistice++;
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
      .map(([label, e]) => ({ label, losses: e.gameover, total: e.gameover + e.victory + e.armistice }))
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
    return {
      n,
      uniquePlayers,
      avgWave: avg((r) => r.wave),
      avgKills: avg((r) => r.kills),
      avgDur: avg((r) => r.durationS),
      avgLeaks: avg((r) => r.leaks ?? 0),
      avgCoresLeft: avg((r) => r.coresLeft ?? 0),
      wins: rows.filter((r) => r.won).length,
      histo,
      fails,
      roughModes,
      byMap,
      byDiff,
      popularity,
      towerOutcomes,
      withTowers,
      freeplayRuns: freeplayRows.length,
      bestFreeplayWave: freeplayRows.length ? Math.max(...freeplayRows.map((r) => r.wave)) : 0,
    };
  }, [rows]);

  if (err) return <TelemetryError />;
  if (rows === null) return <div className="adm-content"><div className="adm-card"><div className="adm-empty">Establishing uplink to telemetry…</div></div></div>;
  if (rows.length === 0) return <TelemetryEmpty />;
  const s = stats!;
  const maxBucket = Math.max(1, ...s.histo.map(([, e]) => e.gameover + e.victory + e.armistice));

  return (
    <div className="adm-content">
      <div className="adm-meta-bar">{s.n} run events · {Math.round((s.wins / s.n) * 100)}% ended in a win</div>

      <div className="adm-stat-row">
        <Stat label="runs logged" value={s.n.toLocaleString()} />
        <Stat label="players seen" value={s.uniquePlayers.toLocaleString()} />
        <Stat label="avg wave reached" value={s.avgWave.toFixed(1)} />
        <Stat label="avg run length" value={`${Math.round(s.avgDur / 60)}m ${Math.round(s.avgDur % 60)}s`} />
      </div>

      <div className="adm-card">
        <div className="adm-card-head"><h3>Telemetry readout</h3><span className="adm-hint">live player data, newest {s.n} runs</span></div>
        <div className="adm-insight-grid">
          <div className="adm-insight">
            <b>Where do players lose?</b>
            {s.fails.length > 0 ? s.fails.map((f) => <span key={f.label}>{f.label}: {f.losses} losses out of {f.total} endings</span>) : <span>No losses in this sample.</span>}
          </div>
          <div className="adm-insight">
            <b>Hardest live slices</b>
            {s.roughModes.length > 0 ? s.roughModes.map((m) => <span key={`${m.kind}-${m.id}`}>{m.kind} {m.label}: {pct(m.rate)} win over {m.n} runs</span>) : <span>Need at least 2 runs per slice.</span>}
          </div>
          <div className="adm-insight">
            <b>Core pressure</b>
            <span>Avg leaks: {s.avgLeaks.toFixed(1)}</span>
            <span>Avg cores left at ending: {s.avgCoresLeft.toFixed(1)}</span>
            <span>{s.freeplayRuns} freeplay runs, best wave {s.bestFreeplayWave}</span>
          </div>
          <div className="adm-insight">
            <b>Most-played towers by outcome</b>
            {s.towerOutcomes.slice(0, 4).map((t) => <span key={t.id}>{t.name}: {t.runs} runs, {pct(t.winRate)} win, avg w{t.avgWave.toFixed(1)}</span>)}
          </div>
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-card-head"><h3>Run outcome by wave reached</h3><span className="adm-hint">where players' runs end</span></div>
        <div className="adm-histo">
          {s.histo.map(([b, e]) => {
            const total = e.gameover + e.victory + e.armistice;
            return (
              <div key={b} className="adm-histo-col" title={`${b}: ${e.gameover} lost · ${e.victory} won · ${e.armistice} armistice`}>
                <div className="adm-histo-stack" style={{ height: `${(total / maxBucket) * 100}%` }}>
                  <div style={{ flex: e.gameover, background: '#ff4757' }} />
                  <div style={{ flex: e.victory, background: '#2ed573' }} />
                  <div style={{ flex: e.armistice, background: '#ffd32a' }} />
                </div>
                <span className="adm-histo-label">{b}</span>
              </div>
            );
          })}
        </div>
        <div className="adm-legend">
          <span><i style={{ background: '#ff4757' }} /> grid offline</span>
          <span><i style={{ background: '#2ed573' }} /> sector secured</span>
          <span><i style={{ background: '#ffd32a' }} /> armistice</span>
        </div>
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

      <div className="adm-card">
        <div className="adm-card-head"><h3>Tower popularity</h3><span className="adm-hint">{s.withTowers} of {s.n} runs reported a loadout</span></div>
        {s.withTowers === 0
          ? <div className="adm-empty">No loadout data yet — runs logged before this build don't include tower composition. New runs will populate this.</div>
          : <HBars data={s.popularity.map((t) => ({ label: t.name, value: t.count, color: towerGlow(t.id) }))} />}
      </div>

      <div className="adm-card">
        <div className="adm-card-head"><h3>Tower outcome correlation</h3><span className="adm-hint">runs containing each tower type</span></div>
        {s.towerOutcomes.length === 0
          ? <div className="adm-empty">No tower outcome data yet.</div>
          : <HBars
              data={s.towerOutcomes.map((t) => ({
                label: t.name,
                value: Math.round(t.winRate * 100),
                color: towerGlow(t.id),
                sub: `${t.runs} runs / avg w${t.avgWave.toFixed(1)}`,
              }))}
              max={100}
              unit="%"
            />}
      </div>
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
  const [tab, setTab] = useState<'inbox' | 'balance' | 'telemetry'>('inbox');
  const [report, setReport] = useState<Report | null | 'missing'>(null);
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
          <button className={tab === 'balance' ? 'on' : ''} onClick={() => setTab('balance')}>BALANCE</button>
          <button className={tab === 'telemetry' ? 'on' : ''} onClick={() => setTab('telemetry')}>TELEMETRY</button>
        </nav>
        <div className="adm-actions">
          <span className="adm-readonly">{user.email}</span>
          <button className="adm-exit" onClick={() => void signOutAdmin()}>SIGN OUT</button>
          <button className="adm-exit" onClick={clearAdmin}>EXIT</button>
        </div>
      </header>

      {tab === 'inbox' ? <InboxTab user={user} /> : tab === 'balance' ? (
        report === null ? <div className="adm-content"><div className="adm-card"><div className="adm-empty">Loading balance report…</div></div></div>
          : report === 'missing'
            ? <div className="adm-content"><div className="adm-card"><div className="adm-empty">
                <p>No balance report found at <code>/balance-report.json</code>.</p>
                <p className="adm-hint">Run <code>npm run balance</code> to generate it.</p>
              </div></div></div>
            : <BalanceTab report={report} />
      ) : <TelemetryTab />}
    </div>
  );
}
