import { ghostAtWave, type GhostCurve } from './game/ghostCurve';

// Live "bot rival" readout: the matched-difficulty AI's cores pace at the current wave,
// plus a sparkline of its core curve with the player's position marked. Campaign-only
// (report curves are campaign-matched); renders nothing when there's no curve/point.
export default function BotGhostHud({ curve, wave, cores }: { curve: GhostCurve | null; wave: number; cores: number; phase: string }) {
  if (!curve) return null;
  const g = ghostAtWave(curve, wave);
  if (!g) return null;

  const ahead = cores >= g.cores;
  const delta = cores - g.cores;
  const deltaTxt = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
  const tone = ahead ? '#2ed573' : '#ff6b81';

  // sparkline geometry
  const W = 78, H = 22, pad = 2;
  const maxWave = curve.points[curve.points.length - 1]?.wave || 1;
  const sx = (w: number) => pad + (w / maxWave) * (W - pad * 2);
  const sy = (c: number) => pad + (1 - Math.min(1, c / curve.startingLives)) * (H - pad * 2);
  const line = curve.points.map((p) => `${sx(p.wave).toFixed(1)},${sy(p.cores).toFixed(1)}`).join(' ');
  const px = sx(Math.min(wave, maxWave)), py = sy(Math.min(cores, curve.startingLives));

  return (
    <div className="tb-stat ghost" title={`AI rival (${curve.skill}) held ~${g.cores} cores by wave ${g.wave}. You: ${cores}. Beat its pace to out-ward the armada.`}>
      <span className="ghost-label">🤖</span>
      <span className="ghost-cores">{g.cores}</span>
      <span className="ghost-delta" style={{ color: tone }}>{deltaTxt}</span>
      <svg className="ghost-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <polyline points={line} fill="none" stroke="rgba(120,150,255,0.55)" strokeWidth="1.2" />
        <line x1={px} y1={pad} x2={px} y2={H - pad} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        <circle cx={px} cy={py} r="2.6" fill={tone} />
      </svg>
    </div>
  );
}
