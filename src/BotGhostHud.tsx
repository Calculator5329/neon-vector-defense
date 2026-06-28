import { useEffect, useMemo, useRef, useState } from 'react';
import { ghostAtWave, type GhostCurve } from './game/ghostCurve';
import { DIFFICULTIES } from './game/maps';
import { sfx } from './game/sound';

type BotGhostHudProps = {
  curves: GhostCurve[];
  matchedDiffId: string;
  wave: number;
  cores: number;
  currentStartingLives: number;
  phase: string;
};

const PROFILE_COLORS = ['#2ed573', '#8e7bef', '#54a0ff', '#ff9f43', '#ff6b81'];

function curveKey(curve: GhostCurve): string {
  return `${curve.map}:${curve.diff}:${curve.skill}`;
}

function diffName(id: string): string {
  return DIFFICULTIES.find((d) => d.id === id)?.name ?? id;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function signed(n: number): string {
  if (n === 0) return '±0';
  return n > 0 ? `+${n}` : `${n}`;
}

function profileLabel(curve: GhostCurve): string {
  return `${diffName(curve.diff)} / ${curve.skill}`;
}

function profileShortLabel(curve: GhostCurve): string {
  return `${curve.skill.toUpperCase()} ${diffName(curve.diff).toUpperCase()}`;
}

function curveStats(curve: GhostCurve) {
  const first = curve.points[0];
  const last = curve.points[curve.points.length - 1];
  const firstLeak = curve.points.find((p) => p.cores < curve.startingLives);
  let hardestDrop = 0;
  let hardestDropWave = first?.wave ?? 0;
  let pressureWave = first?.wave ?? 0;
  let maxPressure = 0;
  for (let i = 1; i < curve.points.length; i++) {
    const drop = curve.points[i - 1].cores - curve.points[i].cores;
    if (drop > hardestDrop) {
      hardestDrop = drop;
      hardestDropWave = curve.points[i].wave;
    }
    const pressure = curve.points[i].pressure ?? 0;
    if (pressure > maxPressure) {
      maxPressure = pressure;
      pressureWave = curve.points[i].wave;
    }
  }
  return {
    firstLeakWave: firstLeak?.wave ?? null,
    finishCores: last?.cores ?? curve.startingLives,
    minCores: Math.min(curve.startingLives, ...curve.points.map((p) => p.cores)),
    hardestDrop,
    hardestDropWave,
    maxPressure,
    pressureWave,
  };
}

// Live bot-rival readout. Defaults to the matched campaign profile, then lets the
// player switch to any bundled bot curve for the same sector.
export default function BotGhostHud({ curves, matchedDiffId, wave, cores, currentStartingLives }: BotGhostHudProps) {
  const matchedCurve = useMemo(
    () => curves.find((c) => c.diff === matchedDiffId) ?? curves[0] ?? null,
    [curves, matchedDiffId],
  );
  const [selectedKey, setSelectedKey] = useState(() => matchedCurve ? curveKey(matchedCurve) : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (matchedCurve) setSelectedKey(curveKey(matchedCurve));
  }, [matchedCurve]);

  const selectedCurve = curves.find((c) => curveKey(c) === selectedKey) ?? matchedCurve;
  if (!selectedCurve) return null;
  const g = ghostAtWave(selectedCurve, wave);
  if (!g) return null;

  const playerPct = cores / Math.max(1, currentStartingLives);
  const botPct = g.cores / Math.max(1, selectedCurve.startingLives);
  const ahead = playerPct >= botPct;
  const deltaPct = Math.round((playerPct - botPct) * 100);
  const tone = ahead ? '#2ed573' : '#ff6b81';

  const W = 78, H = 22, pad = 2;
  const maxWave = selectedCurve.points[selectedCurve.points.length - 1]?.wave || 1;
  const sx = (w: number) => pad + (w / maxWave) * (W - pad * 2);
  const sy = (frac: number) => pad + (1 - Math.max(0, Math.min(1, frac))) * (H - pad * 2);
  const line = selectedCurve.points.map((p) => `${sx(p.wave).toFixed(1)},${sy(p.coreFraction).toFixed(1)}`).join(' ');
  const px = sx(Math.min(wave, maxWave)), py = sy(playerPct);

  return (
    <>
      <button className="tb-stat ghost" onClick={() => { sfx.click(); setOpen(true); }}
        title={`AI rival ${profileLabel(selectedCurve)}: ${g.cores}/${selectedCurve.startingLives} cores by wave ${g.wave}. You: ${cores}/${currentStartingLives}.`}>
        <span className="ghost-label">AI</span>
        <span className="ghost-cores">{pct(botPct)}</span>
        <span className="ghost-delta" style={{ color: tone }}>{signed(deltaPct)}</span>
        <svg className="ghost-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <polyline points={line} fill="none" stroke="rgba(120,150,255,0.55)" strokeWidth="1.2" />
          <line x1={px} y1={pad} x2={px} y2={H - pad} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <circle cx={px} cy={py} r="2.6" fill={tone} />
        </svg>
      </button>
      {open && (
        <GhostModal
          curves={curves}
          selectedKey={curveKey(selectedCurve)}
          matchedDiffId={matchedDiffId}
          wave={wave}
          cores={cores}
          currentStartingLives={currentStartingLives}
          onSelect={setSelectedKey}
          onClose={() => { sfx.click(); setOpen(false); }}
        />
      )}
    </>
  );
}

function GhostModal({
  curves,
  selectedKey,
  matchedDiffId,
  wave,
  cores,
  currentStartingLives,
  onSelect,
  onClose,
}: {
  curves: GhostCurve[];
  selectedKey: string;
  matchedDiffId: string;
  wave: number;
  cores: number;
  currentStartingLives: number;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const selectedCurve = curves.find((c) => curveKey(c) === selectedKey) ?? curves.find((c) => c.diff === matchedDiffId) ?? curves[0];
  const g = ghostAtWave(selectedCurve, wave);
  const botCores = g?.cores ?? selectedCurve.startingLives;
  const playerPct = cores / Math.max(1, currentStartingLives);
  const botPct = botCores / Math.max(1, selectedCurve.startingLives);
  const deltaCores = cores - botCores;
  const deltaPct = playerPct - botPct;
  const ahead = deltaPct >= 0;
  const stats = curveStats(selectedCurve);

  const W = 640, H = 214, padL = 46, padB = 30, padT = 22, padR = 46;
  const maxWave = Math.max(1, ...curves.flatMap((curve) => curve.points.map((p) => p.wave)));
  const sx = (w: number) => padL + (w / maxWave) * (W - padL - padR);
  const sy = (frac: number) => padT + (1 - Math.max(0, Math.min(1, frac))) * (H - padT - padB);
  const pathFor = (curve: GhostCurve) => curve.points
    .map((p, i) => `${i ? 'L' : 'M'}${sx(p.wave).toFixed(1)},${sy(p.coreFraction).toFixed(1)}`)
    .join(' ');
  const px = sx(Math.min(wave, maxWave)), py = sy(playerPct);
  const playerLabelAnchor = px > W - padR - 46 ? 'end' : 'start';
  const playerLabelX = playerLabelAnchor === 'end' ? px - 10 : px + 10;
  const playerLabelY = py < padT + 18
    ? py + 18
    : py > H - padB - 18
      ? py - 10
      : py + 4;

  const sortedCurves = curves.length ? curves : [selectedCurve];
  const selectedIndex = Math.max(0, sortedCurves.findIndex((curve) => curveKey(curve) === curveKey(selectedCurve)));
  const selectedColor = PROFILE_COLORS[selectedIndex % PROFILE_COLORS.length];

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="ghost-modal-overlay" onClick={onClose}>
      <div
        className="ghost-modal ghost-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ghost-modal-title"
        aria-describedby="ghost-modal-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ghost-modal-head">
          <span id="ghost-modal-title">AI RIVAL · {profileShortLabel(selectedCurve)}</span>
          <button ref={closeRef} className="ghost-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p id="ghost-modal-desc" className="ghost-modal-sub">Compare your live run against bundled bot profiles for this sector. The chart uses core percentage so Recruit, Veteran, Apex, and Long Watch starts are comparable.</p>

        <div className="ghost-profile-switch" role="tablist" aria-label="AI rival profile">
          {sortedCurves.map((curve, i) => {
            const key = curveKey(curve);
            const selected = key === curveKey(selectedCurve);
            const matched = curve.diff === matchedDiffId;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? 'on' : ''}
                style={{ borderColor: selected ? PROFILE_COLORS[i % PROFILE_COLORS.length] : undefined }}
                onClick={() => { sfx.click(); onSelect(key); }}
              >
                <b>{curve.skill}</b>
                <span>{diffName(curve.diff)}{matched ? ' · matched' : ''}</span>
              </button>
            );
          })}
        </div>

        <svg className="ghost-modal-chart ghost-modal-chart-deep" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {[0, 0.25, 0.5, 0.75, 1].map((gr) => (
            <g key={gr}>
              <line x1={padL} y1={sy(gr)} x2={W - padR} y2={sy(gr)} className="gm-grid" />
              <text x={padL - 5} y={sy(gr) + 3} className="gm-axis" textAnchor="end">{Math.round(gr * 100)}</text>
            </g>
          ))}
          {[0, Math.round(maxWave / 2), maxWave].map((w) => (
            <text key={w} x={sx(w)} y={H - 7} className="gm-axis" textAnchor="middle">W{w}</text>
          ))}
          {sortedCurves.map((curve, i) => (
            <path
              key={curveKey(curve)}
              d={pathFor(curve)}
              fill="none"
              stroke={PROFILE_COLORS[i % PROFILE_COLORS.length]}
              strokeDasharray={curveKey(curve) === curveKey(selectedCurve) ? undefined : i % 2 === 0 ? '5 4' : '2 3'}
              strokeWidth={curveKey(curve) === curveKey(selectedCurve) ? 2.6 : 1.2}
              opacity={curveKey(curve) === curveKey(selectedCurve) ? 0.95 : 0.28}
            />
          ))}
          <line x1={px} y1={padT} x2={px} y2={H - padB} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
          <circle cx={px} cy={py} r="4.8" fill={ahead ? '#2ed573' : '#ff6b81'} />
          <text
            x={playerLabelX}
            y={playerLabelY}
            className="gm-axis gm-player-label"
            fill={ahead ? '#2ed573' : '#ff6b81'}
            textAnchor={playerLabelAnchor}
          >
            YOU
          </text>
        </svg>

        <div className="ghost-modal-legend">
          {sortedCurves.map((curve, i) => (
            <span key={curveKey(curve)} className={curveKey(curve) === curveKey(selectedCurve) ? 'on' : ''}>
              <i style={{ background: PROFILE_COLORS[i % PROFILE_COLORS.length] }} data-pattern={i % 2 === 0 ? 'dash' : 'dot'} />
              {diffName(curve.diff)} / {curve.skill}
            </span>
          ))}
        </div>

        <div className="ghost-modal-rows ghost-modal-rows-deep">
          <div><span>Bot cores @ W{wave}</span><b>{botCores}/{selectedCurve.startingLives} ({pct(botPct)})</b></div>
          <div><span>Your cores</span><b style={{ color: ahead ? '#2ed573' : '#ff6b81' }}>{cores}/{currentStartingLives} ({pct(playerPct)})</b></div>
          <div><span>Core delta</span><b style={{ color: ahead ? '#2ed573' : '#ff6b81' }}>{signed(deltaCores)} cores / {signed(Math.round(deltaPct * 100))} pts</b></div>
          <div><span>Bot credits @ W{wave}</span><b>{g?.creditsStart === undefined ? 'n/a' : Math.round(g.creditsStart).toLocaleString()}</b></div>
          <div><span>Bot towers @ W{wave}</span><b>{g?.towersStart === undefined ? 'n/a' : g.towersStart.toFixed(1)}</b></div>
          <div><span>Bot leak pressure @ W{wave}</span><b>{g?.pressure === undefined ? 'n/a' : pct(g.pressure)}</b></div>
          <div><span>Bot usually reaches</span><b>W{Math.round(selectedCurve.avgFinalWave)}</b></div>
          <div><span>Bot win rate</span><b>{pct(selectedCurve.winRate)}</b></div>
          <div><span>First bot leak</span><b>{stats.firstLeakWave ? `W${stats.firstLeakWave}` : 'none seen'}</b></div>
          <div><span>Worst bot drop</span><b>{stats.hardestDrop ? `${stats.hardestDrop} cores @ W${stats.hardestDropWave}` : 'none'}</b></div>
          <div><span>Worst pressure wave</span><b>{stats.maxPressure ? `${pct(stats.maxPressure)} @ W${stats.pressureWave}` : 'none'}</b></div>
          <div><span>Lowest bot cores</span><b>{stats.minCores}</b></div>
          <div><span>Finish cores</span><b>{stats.finishCores}</b></div>
          <div><span>Comparison profile</span><b style={{ color: selectedColor }}>{profileLabel(selectedCurve)}</b></div>
        </div>

        <div className="ghost-modal-verdict" style={{ color: ahead ? '#2ed573' : '#ff6b81' }}>
          {ahead ? 'You are ahead of this rival profile — hold the pace.' : 'This rival profile is ahead on core percentage — tighten the defense.'}
        </div>
      </div>
    </div>
  );
}
