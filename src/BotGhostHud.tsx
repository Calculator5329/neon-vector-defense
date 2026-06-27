import { useState } from 'react';
import { ghostAtWave, type GhostCurve } from './game/ghostCurve';
import { sfx } from './game/sound';

// Live "bot rival" readout: the matched-difficulty AI's cores pace at the current wave,
// plus a sparkline. Click it for a full user-vs-bot breakdown. Campaign-only (report
// curves are campaign-matched); renders nothing when there's no curve/point.
export default function BotGhostHud({ curve, wave, cores }: { curve: GhostCurve | null; wave: number; cores: number; phase: string }) {
  const [open, setOpen] = useState(false);
  if (!curve) return null;
  const g = ghostAtWave(curve, wave);
  if (!g) return null;

  const ahead = cores >= g.cores;
  const delta = cores - g.cores;
  const deltaTxt = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
  const tone = ahead ? '#2ed573' : '#ff6b81';

  const W = 78, H = 22, pad = 2;
  const maxWave = curve.points[curve.points.length - 1]?.wave || 1;
  const sx = (w: number) => pad + (w / maxWave) * (W - pad * 2);
  const sy = (c: number) => pad + (1 - Math.min(1, c / curve.startingLives)) * (H - pad * 2);
  const line = curve.points.map((p) => `${sx(p.wave).toFixed(1)},${sy(p.cores).toFixed(1)}`).join(' ');
  const px = sx(Math.min(wave, maxWave)), py = sy(Math.min(cores, curve.startingLives));

  return (
    <>
      <button className="tb-stat ghost" onClick={() => { sfx.click(); setOpen(true); }}
        title={`AI rival (${curve.skill}) held ~${g.cores} cores by wave ${g.wave}. You: ${cores}. Click for details.`}>
        <span className="ghost-label">🤖</span>
        <span className="ghost-cores">{g.cores}</span>
        <span className="ghost-delta" style={{ color: tone }}>{deltaTxt}</span>
        <svg className="ghost-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <polyline points={line} fill="none" stroke="rgba(120,150,255,0.55)" strokeWidth="1.2" />
          <line x1={px} y1={pad} x2={px} y2={H - pad} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <circle cx={px} cy={py} r="2.6" fill={tone} />
        </svg>
      </button>
      {open && <GhostModal curve={curve} wave={wave} cores={cores} onClose={() => { sfx.click(); setOpen(false); }} />}
    </>
  );
}

function GhostModal({ curve, wave, cores, onClose }: { curve: GhostCurve; wave: number; cores: number; onClose: () => void }) {
  const g = ghostAtWave(curve, wave);
  const botCores = g?.cores ?? curve.startingLives;
  const delta = cores - botCores;
  const ahead = delta >= 0;

  const W = 520, H = 180, padL = 36, padB = 22, padT = 12, padR = 14;
  const maxWave = curve.points[curve.points.length - 1]?.wave || 1;
  const sx = (w: number) => padL + (w / maxWave) * (W - padL - padR);
  const sy = (frac: number) => padT + (1 - Math.max(0, Math.min(1, frac))) * (H - padT - padB);
  const botPath = curve.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.wave).toFixed(1)},${sy(p.coreFraction).toFixed(1)}`).join(' ');
  const px = sx(Math.min(wave, maxWave)), py = sy(Math.min(1, cores / curve.startingLives));

  return (
    <div className="ghost-modal-overlay" onClick={onClose}>
      <div className="ghost-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ghost-modal-head">
          <span>🤖 AI RIVAL · {curve.skill.toUpperCase()}</span>
          <button className="ghost-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="ghost-modal-sub">How the matched-difficulty bot held the line. Stay above its curve to out-ward the armada.</p>
        <svg className="ghost-modal-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {[0, 0.5, 1].map((gr) => (
            <g key={gr}>
              <line x1={padL} y1={sy(gr)} x2={W - padR} y2={sy(gr)} className="gm-grid" />
              <text x={padL - 5} y={sy(gr) + 3} className="gm-axis" textAnchor="end">{Math.round(gr * 100)}</text>
            </g>
          ))}
          {[0, Math.round(maxWave / 2), maxWave].map((w) => (
            <text key={w} x={sx(w)} y={H - 6} className="gm-axis" textAnchor="middle">W{w}</text>
          ))}
          <path d={botPath} fill="none" stroke="#8e7bef" strokeWidth="2" />
          <line x1={px} y1={padT} x2={px} y2={H - padB} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
          <circle cx={px} cy={py} r="4.5" fill={ahead ? '#2ed573' : '#ff6b81'} />
          <text x={px + 7} y={py + 4} className="gm-axis" fill={ahead ? '#2ed573' : '#ff6b81'} textAnchor="start">YOU</text>
        </svg>
        <div className="ghost-modal-rows">
          <div><span>AI cores @ W{wave}</span><b>{botCores}</b></div>
          <div><span>Your cores</span><b style={{ color: ahead ? '#2ed573' : '#ff6b81' }}>{cores} ({ahead ? '+' : ''}{delta})</b></div>
          <div><span>AI typically clears</span><b>W{Math.round(curve.avgFinalWave)}</b></div>
          <div><span>AI win rate</span><b>{Math.round(curve.winRate * 100)}%</b></div>
        </div>
        <div className="ghost-modal-verdict" style={{ color: ahead ? '#2ed573' : '#ff6b81' }}>
          {ahead ? '◆ You are out-warding the AI — hold the pace.' : '◆ The AI held more cores here — tighten your defense.'}
        </div>
      </div>
    </div>
  );
}
