import { useEffect, useRef, useState } from 'react';
import { W, H } from '../game/engine';
import { TOWERS_BY_UNLOCK } from '../game/towers';
import { ALL_MAPS, DIFFICULTIES } from '../game/maps';
import { ENEMY_LIST } from '../game/enemies';
import { progress } from '../game/storage';
import { appMetrics } from '../game/metrics';
import type { DailyFreeplaySeed } from '../game/freeplay';
import { fetchReplayOfTheDay, type ReplaySpotlight } from '../game/replaySpotlight';

import { sfx } from '../game/sound';
import OperationsBoard from '../OperationsBoard';
import Bestiary from '../Bestiary';
import { meta, rankBandKey } from '../game/meta';
import type { GameMap, DifficultyDef } from '../game/types';
import { DEMO_MODE } from '../appShared';
import { LeaderboardTab } from './LeaderboardTab';
import { HowToPlay } from '../game-ui/HowToPlay';
import { SettingsPanel } from '../game-ui/SettingsPanel';

// ---------------- Main menu ----------------

// Sequential unlock: a sector opens only once every prior sector has been
// progressed (cleared, or reached wave 20+). No swiss-cheese gaps.
function mapProgressed(m: GameMap): boolean {
  if (DEMO_MODE) return true;
  return progress.mapCleared(m.id) || progress.bestWaveAny(m.id) >= 20;
}
function mapUnlocked(idx: number): boolean {
  if (DEMO_MODE) return true;
  if (idx < 2) return true;
  for (let i = 0; i < idx; i++) if (!mapProgressed(ALL_MAPS[i])) return false;
  return true;
}

// Featured "Replay of the Day" spotlight — pulls a deterministic strong run from
// the live global boards. Renders nothing while loading or when no replay exists,
// so it never shows an empty box. The WATCH anchor reuses the ?run deep link;
// ReplayViewer records the watch telemetry on mount, so none is wired here.
function ReplayOfTheDayCard() {
  const [spot, setSpot] = useState<ReplaySpotlight | null>(null);
  useEffect(() => {
    let live = true;
    fetchReplayOfTheDay().then((s) => { if (live) setSpot(s); });
    return () => { live = false; };
  }, []);
  if (!spot) return null;
  return (
    <div className="replay-of-day-card">
      <div>
        <div className="replay-of-day-kicker">REPLAY OF THE DAY</div>
        <div className="replay-of-day-title">{spot.callsign} · Wave {spot.wave}</div>
        <div className="replay-of-day-rules">{spot.mapName} · {spot.diffName}</div>
      </div>
      <a className="replay-of-day-watch" href={`/?run=${spot.runId}`} title="Watch today's featured battle plan">▶ WATCH</a>
    </div>
  );
}

export function MainMenu(props: {
  map: GameMap; diff: DifficultyDef;
  setMap: (m: GameMap) => void; setDiff: (d: DifficultyDef) => void;
  dailySeed: DailyFreeplaySeed;
  onStart: () => void;
  onStartDaily: () => void;
}) {
  const [tab, setTab] = useState<'deploy' | 'board' | 'ops'>('deploy');
  const [, bumpClaim] = useState(0); // re-read meta.claimableCount() for the nav badge after a claim
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bestiaryOpen, setBestiaryOpen] = useState(false);
  // Apex unlocks on a COMPLETED campaign (a win), matching its "survive one campaign"
  // copy — not on any run end (an instant wave-1 loss used to unlock it).
  const apexLocked = !DEMO_MODE && progress.record.victories < 1;
  const firstTime = !DEMO_MODE && progress.record.runs < 1;
  const selectedUnlocked = mapUnlocked(ALL_MAPS.findIndex((m) => m.id === props.map.id));
  // nav-tab cues: claimable operations + newly-identified hulls awaiting a Bestiary visit.
  // foesSeen must use the SAME basis the Bestiary acks with (ENEMY_LIST intersection, not the
  // raw persisted list) or a stale/removed enemy id would make the NEW badge stick forever.
  const claimable = DEMO_MODE ? 0 : meta.claimableCount();
  const foesSeen = ENEMY_LIST.filter((d) => progress.enemiesSeen.includes(d.id)).length;
  const foesNew = Math.max(0, foesSeen - progress.bestiaryAck);

  return (
    <div className="menu-root">
      <div className="menu-stars" />

      <header className="menu-topbar">
        <div className="menu-brand">
          <span className="menu-eyebrow">LANTERN SEVEN · SECTOR DEFENSE</span>
          <h1 className="menu-title">NEON VECTOR<span> DEFENSE</span></h1>
        </div>
        <nav className="menu-tabs" aria-label="Main menu sections">
          <button className={tab === 'deploy' ? 'on' : ''} aria-pressed={tab === 'deploy'} onClick={() => { appMetrics.recordMenuTab('deploy'); setTab('deploy'); sfx.click(); }}>DEPLOY</button>
          <button className={tab === 'board' ? 'on' : ''} aria-pressed={tab === 'board'} onClick={() => { appMetrics.recordMenuTab('board'); setTab('board'); sfx.click(); }}>LEADERBOARD</button>
          <button className={tab === 'ops' ? 'on' : ''} aria-pressed={tab === 'ops'} onClick={() => { setTab('ops'); sfx.click(); }}>
            OPERATIONS{claimable > 0 && <span className="tab-badge" aria-label={`${claimable} operations ready to claim`}>{claimable}</span>}
          </button>
          <button className="menu-tab-help" title={`Combine Bestiary — ${foesSeen}/${ENEMY_LIST.length} identified`}
            aria-label={`Combine Bestiary, ${foesSeen} of ${ENEMY_LIST.length} hulls identified${foesNew > 0 ? `, ${foesNew} new` : ''}`}
            onClick={() => { setBestiaryOpen(true); sfx.click(); }}>
            👾{foesNew > 0 && <span className="tab-badge new" aria-hidden="true">{foesNew}</span>}
          </button>
          <button className="menu-tab-help" title="How to play" onClick={() => { setHelp(true); sfx.click(); }}>?</button>
          <button className="menu-tab-help" title="Settings" aria-label="Settings" onClick={() => { setSettingsOpen(true); sfx.click(); }}>⚙</button>
        </nav>
      </header>

      {help && <HowToPlay onDone={() => { setHelp(false); sfx.click(); }} />}
      {settingsOpen && <SettingsPanel onClose={() => { setSettingsOpen(false); sfx.click(); }} />}
      {bestiaryOpen && <Bestiary onClose={() => { setBestiaryOpen(false); sfx.click(); }} />}

      {DEMO_MODE && (
        <div className="menu-demo-banner">
          RECRUITER DEMO: all sectors, protocols, and towers are unlocked for this session. Progression, telemetry, and score submission are disabled.
        </div>
      )}

      {/* one unified Commander Dossier (returning players) replaces the 3 ragged strips */}
      {progress.record.runs > 0 ? (
        <div className="commander-dossier">
          <div className="hero-stats">
            <span><b>{progress.record.victories}</b> lanterns held</span>
            <span><b>{progress.record.kills.toLocaleString()}</b> hulls destroyed</span>
            <span><b>{progress.totalWaves}</b> waves cleared</span>
            {progress.freeplay.runs > 0 && <span><b>{progress.freeplay.bestWave}</b> best freeplay wave</span>}
          </div>
          {!DEMO_MODE && (() => {
            const rank = meta.rank; const streak = meta.streak;
            return (
              <button className="menu-rank-strip" onClick={() => { setTab('ops'); sfx.click(); }} title="Open Operations">
                <img className="menu-rank-crest" src={`/art/rank-${rankBandKey(rank.rank)}.webp`} alt="" draggable={false} decoding="async" />
                <span className="menu-rank-title">{rank.title}</span>
                <span className="menu-rank-bar"><span className="menu-rank-fill" style={{ width: `${rank.pct * 100}%` }} /></span>
                <span className="menu-rank-meta"><i className="ico-diamond" aria-hidden="true" /> {meta.salvage.toLocaleString()}{streak.current > 0 ? ` · 🔥 ${streak.current}` : ''}</span>
              </button>
            );
          })()}
          {!DEMO_MODE && (() => {
            const k = progress.record.kills;
            const next = TOWERS_BY_UNLOCK.find((d) => d.unlockAt > k);
            if (!next) return null;
            const prev = TOWERS_BY_UNLOCK.filter((d) => d.unlockAt <= k).reduce((m, d) => Math.max(m, d.unlockAt), 0);
            const pct = Math.min(100, ((k - prev) / (next.unlockAt - prev)) * 100);
            return (
              <div className="menu-next-unlock" title={`${k.toLocaleString()} / ${next.unlockAt.toLocaleString()} hulls`}>
                <div className="unlock-label">NEXT: {next.name}</div>
                <div className="unlock-bar"><div className="unlock-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })()}
        </div>
      ) : (!DEMO_MODE && (
        <div className="menu-firsttime-note">COMMANDER INITIALIZED · CLEAR A SECTOR TO EARN YOUR WARDEN RANK</div>
      ))}

      <div className="menu-content">
        {tab === 'deploy' ? (
          <>
            <div className="menu-col">
              <div className="menu-section-label">① SELECT SECTOR</div>
              <div className="map-grid" data-testid="map-grid">
                {ALL_MAPS.map((m, i) => {
                  const unlocked = mapUnlocked(i);
                  const best = progress.bestWaveAny(m.id);
                  if (!unlocked) {
                    const prior = ALL_MAPS[Math.max(0, i - 1)];
                    return (
                      <button key={m.id} type="button" className="map-card map-card-locked" data-testid={`map-card-${m.id}`}
                        aria-disabled="true" aria-label={`Locked sector. Clear ${prior.name} or reach wave 20 to unlock.`}
                        title={`Reach wave 20 or clear ${ALL_MAPS[i - 1].name} to unlock`}
                        onClick={() => appMetrics.recordLockedMapClick(m.id)}>
                        <div className="map-lock">🔒</div>
                        <div className="map-card-name">CLASSIFIED</div>
                        <div className="map-card-desc">Clear {prior.name} or reach W20.</div>
                      </button>
                    );
                  }
                  const active = props.map.id === m.id;
                  return (
                    <button
                      key={m.id}
                      className={`map-card ${active ? 'active' : ''}`}
                      data-testid={`map-card-${m.id}`}
                      aria-label={`${m.name}. ${m.difficulty} sector. ${m.desc}`}
                      onClick={() => { appMetrics.recordMapSelect(m.id); sfx.click(); props.setMap(m); }}
                      title={m.desc}
                    >
                      {!active && firstTime && i === 0 && <div className="start-pill">START HERE</div>}
                      {progress.mapCleared(m.id) && <div className="map-clear-badge" title="Cleared">✓</div>}
                      <div className="map-thumb-stack">
                        <img className="map-thumb-art" src={`/art/sector-${m.id}.webp`} alt="" loading="lazy" decoding="async" />
                        <MapThumb map={m} />
                      </div>
                      <div className="map-card-row">
                        <span className="map-card-name">{m.name}</span>
                        <span className={`map-card-diff diff-${m.difficulty.toLowerCase()}`}>{m.difficulty}</span>
                      </div>
                      {best > 0 && <div className="map-card-best">BEST · W{best}</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="menu-col">
              <div className="menu-section-label">② SELECT PROTOCOL</div>
              <div className="diff-row" data-testid="diff-row">
                {DIFFICULTIES.map((d) => {
                  const locked = (d.id === 'hard' && apexLocked)
                    || (d.id === 'extinction' && !DEMO_MODE && !progress.apexCleared);
                  if (locked) {
                    const reason = d.id === 'extinction'
                        ? { label: '🔒 EXTINCTION', desc: 'Win an Apex campaign to unlock.', title: 'Beat Apex to face Extinction.' }
                        : { label: '🔒 APEX', desc: 'Survive one campaign to unlock.', title: 'Complete one campaign to unlock Apex.' };
                    return (
                      <button key={d.id} type="button" className="diff-card diff-locked" data-testid={`diff-card-${d.id}`}
                        aria-disabled="true" aria-label={`Locked protocol. ${reason.desc}`} title={reason.title}
                        onClick={() => appMetrics.recordLockedProtocolClick(d.id)}>
                        <div className="diff-name">{reason.label}</div>
                        <div className="diff-desc">{reason.desc}</div>
                      </button>
                    );
                  }
                  const active = props.diff.id === d.id;
                  return (
                    <button
                      key={d.id}
                      className={`diff-card ${active ? 'active' : ''} ${d.id === 'extinction' ? 'diff-extinction' : ''}`}
                      data-testid={`diff-card-${d.id}`}
                      aria-label={`${d.name} protocol. ${d.desc}`}
                      title={d.desc}
                      onClick={() => { appMetrics.recordProtocolSelect(d.id); sfx.click(); props.setDiff(d); }}
                    >
                      {!active && firstTime && d.id === 'easy' && <div className="start-pill">RECOMMENDED</div>}
                      <div className="diff-name">{d.name}</div>
                      <div className="diff-desc">{d.desc}</div>
                    </button>
                  );
                })}
              </div>
              <div className="daily-freeplay-card">
                <div>
                  <div className="daily-freeplay-kicker">DAILY ENDLESS SEED</div>
                  <div className="daily-freeplay-title">{props.dailySeed.title}</div>
                  <div className="daily-freeplay-rules">
                    {props.dailySeed.rules.slice(0, 2).join('  /  ')}
                  </div>
                  <div className="daily-freeplay-rules">
                    {props.dailySeed.towerIds.length} fixed towers - no campaign unlocks or global score.
                  </div>
                </div>
                <button className="tb-btn on" onClick={props.onStartDaily}>DAILY FREEPLAY</button>
              </div>
              <ReplayOfTheDayCard />
            </div>
          </>
        ) : tab === 'board' ? (
          <LeaderboardTab map={props.map} diff={props.diff} />
        ) : (
          <OperationsBoard onClaimed={() => bumpClaim((n) => n + 1)} />
        )}
      </div>

      {/* sticky launch bar — always visible, reflects the current selection */}
      <div className="deploy-bar">
        <div className="deploy-bar-inner">
          <div className="menu-legal">
            <a href="/privacy">Privacy &amp; Data Choices</a>
          </div>
          <div className="deploy-bar-sel">
            <span className="dbar-label">DEPLOYING TO</span>
            <span className="dbar-sec">{props.map.name}</span>
            <span className="dbar-dot">·</span>
            <span className="dbar-diff">{props.diff.name}</span>
          </div>
          <button className="start-btn deploy-bar-btn" data-testid="deploy-button" disabled={!selectedUnlocked}
            onClick={() => { appMetrics.recordDeployAttempt(props.map.id, props.diff.id, selectedUnlocked); props.onStart(); }}>
            {firstTime ? '▶ START MISSION' : '▶ DEPLOY'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MapThumb({ map }: { map: GameMap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const sx = c.width / W, sy = c.height / H;
    ctx.clearRect(0, 0, c.width, c.height); // transparent — sector art shows through
    ctx.strokeStyle = map.theme.pathEdge;
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = map.theme.pathEdge;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(map.path[0].x * sx, map.path[0].y * sy);
    for (const p of map.path) ctx.lineTo(p.x * sx, p.y * sy);
    ctx.stroke();
  }, [map]);
  return <canvas ref={ref} width={220} height={124} className="map-thumb" />;
}
