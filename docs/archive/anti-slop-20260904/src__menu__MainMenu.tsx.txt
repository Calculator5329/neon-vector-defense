import { useEffect, useRef, useState } from 'react';
import { W, H } from '../game/engine';
import { TOWERS_BY_UNLOCK } from '../game/towers';
import { ALL_MAPS, DIFFICULTIES } from '../game/maps';
import { ENEMY_LIST } from '../game/enemies';
import { progress } from '../game/storage';
import { appMetrics } from '../game/metrics';
import { dailyModifierNames, type DailyChallenge } from '../game/dailyChallenge';
import { THE_YAKKOB } from '../game/yakkob';
import { YakkobDwarf } from './YakkobDwarf';
import type { ProtocolDrill } from '../game/protocolDrills';
import { weeklyModifierNames, type WeeklyChallenge, type WeeklyGauntletDoc } from '../game/weeklyChallenge';
import type { GauntletProtocolRoute } from '../game/gauntletProtocol';
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
import { IS_PORTAL_BUILD } from '../game/portal';

// ---------------- Main menu ----------------

type DeployMode = 'campaign' | 'daily' | 'drill' | 'weekly' | 'gauntlet' | 'gauntletProtocol' | 'yakkob';

const ATLAS_POS: Record<string, [number, number]> = {
  orbital: [8, 34],
  carousel: [16, 60],
  reactor: [25, 30],
  splice: [34, 56],
  mobius: [43, 34],
  mirror: [52, 62],
  hyperlane: [61, 30],
  blackout: [69, 56],
  throat: [77, 74],
  foundry: [75, 38],
  umbral: [88, 52],
  cinder: [94, 74],
};

function atlasPos(mapId: string, index: number): [number, number] {
  return ATLAS_POS[mapId] ?? [12 + index * 10, index % 2 ? 58 : 32];
}

type AtlasRegion = 'core' | 'forge' | 'dark';

function atlasRegion(mapId: string): AtlasRegion {
  if (['splice', 'foundry', 'cinder'].includes(mapId)) return 'forge';
  if (['blackout', 'throat', 'umbral'].includes(mapId)) return 'dark';
  return 'core';
}

function atlasRegionLabel(region: AtlasRegion): string {
  if (region === 'forge') return 'FORGE SECTOR';
  if (region === 'dark') return 'DARK SECTOR';
  return 'CORE SECTOR';
}

function masteryLevel(mapId: string): number {
  const anyCampaignClear = DIFFICULTIES.some((d) => progress.best(mapId, d.id) >= d.waves);
  const recruitClear = progress.mapCleared(mapId) || anyCampaignClear;
  const apexClear = progress.best(mapId, 'hard') >= (DIFFICULTIES.find((d) => d.id === 'hard')?.waves ?? 70);
  const extinctionClear = progress.best(mapId, 'extinction') >= (DIFFICULTIES.find((d) => d.id === 'extinction')?.waves ?? 80);
  return (recruitClear ? 1 : 0) + (apexClear ? 1 : 0) + (extinctionClear ? 1 : 0);
}

function MasteryStars({ level, label = 'Mastery' }: { level: number; label?: string }) {
  return (
    <span className="atlas-mastery" aria-label={`${label}: ${level} of 3 stars`}>
      {'★'.repeat(level)}<span>{'★'.repeat(3 - level)}</span>
    </span>
  );
}

function PathGlyph({ map, className = '' }: { map: GameMap; className?: string }) {
  const points = map.path.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg className={`atlas-path-glyph ${className}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <polyline points={points} />
    </svg>
  );
}

// Sequential unlock: a sector opens only once every prior sector has been
// progressed (cleared, or reached wave 20+). No swiss-cheese gaps.
function mapProgressed(m: GameMap): boolean {
  if (DEMO_MODE) return true;
  return progress.mapCleared(m.id) || progress.bestWaveAny(m.id) >= 20;
}
function mapUnlocked(idx: number): boolean {
  if (DEMO_MODE) return true;
  // Grandfather: a sector the player has already played (any wave recorded or a
  // clear) never re-locks — inserting new maps into the chain must not take away
  // access veterans earned under the old ordering.
  const m = ALL_MAPS[idx];
  if (m && (progress.mapCleared(m.id) || progress.bestWaveAny(m.id) > 0)) return true;
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

function CommanderDossierRail({ onOpenOps }: { onOpenOps: () => void }) {
  const rank = meta.rank;
  const streak = meta.streak;
  return (
    <aside className="commander-rail" data-testid="commander-rail">
      <button className="rail-rank" onClick={onOpenOps} title="Open Operations">
        <img className="rail-rank-crest" src={`/art/rank-${rankBandKey(rank.rank)}.webp`} alt="" draggable={false} decoding="async" />
        <span>
          <b>{rank.title}</b>
          <i><span style={{ width: `${rank.pct * 100}%` }} /></i>
        </span>
      </button>
      <div className="rail-wallet">
        <span><i className="ico-diamond" aria-hidden="true" /> {meta.salvage.toLocaleString()} Salvage</span>
        <span>{streak.current} day watch</span>
      </div>
      <div className="rail-stats">
        <div><b>{progress.record.victories}</b><span>lanterns held</span></div>
        <div><b>{progress.record.kills.toLocaleString()}</b><span>hulls destroyed</span></div>
        <div><b>{progress.totalWaves}</b><span>waves cleared</span></div>
        <div><b>{meta.bestDailyWave || '-'}</b><span>best daily wave</span></div>
      </div>
      <ReplayOfTheDayCard />
    </aside>
  );
}

function WeeklyOpsSection(props: {
  weeklySeed: WeeklyChallenge;
  gauntlet: WeeklyGauntletDoc | null;
  gauntletProtocol: GauntletProtocolRoute;
  gauntletProtocolUnlocked: boolean;
  yakkobUnlocked: boolean;
  yakkobJustPlaced: boolean;
  onStartYakkob: () => void;
  deployMode: DeployMode;
  setDeployMode: (mode: DeployMode) => void;
}) {
  const weeklyMods = weeklyModifierNames(props.weeklySeed);
  return (
    <div className="weekly-ops-strip atlas-weekly-ops" data-testid="weekly-ops-strip">
      {props.yakkobUnlocked ? (
        // Unlocked: THE YAKKOB takes the Weekly Mutation's slot as a glowing special edition
        // and calls for a press. `yakkob-shimmer` fires a one-shot light sweep the moment it lands.
        <button
          className={`weekly-op-card yakkob-op-card yakkob-attn ${props.yakkobJustPlaced ? 'yakkob-shimmer' : ''} ${props.deployMode === 'yakkob' ? 'active' : ''}`}
          data-testid="yakkob-card"
          aria-label="Deploy THE YAKKOB"
          title={THE_YAKKOB.rules.join('\n')}
          onClick={() => { props.setDeployMode('yakkob'); props.onStartYakkob(); }}
        >
          <span>✦ THE YAKKOB ✦</span>
          <b>Prism Array · Watchfire Beacon</b>
          <em className="yakkob-cta" aria-hidden="true">▶ TAP TO DEPLOY</em>
        </button>
      ) : (
        <button
          className={`weekly-op-card ${props.deployMode === 'weekly' ? 'active' : ''}`}
          data-testid="weekly-mutation-card"
          aria-pressed={props.deployMode === 'weekly'}
          title={props.weeklySeed.rules.join('\n')}
          onClick={() => { props.setDeployMode('weekly'); sfx.click(); }}
        >
          <span>WEEKLY MUTATION</span>
          <b>{weeklyMods.slice(0, 4).join(' / ')}</b>
        </button>
      )}
      <button
        className={`weekly-op-card ${props.deployMode === 'gauntlet' ? 'active' : ''}`}
        data-testid="weekly-gauntlet-card"
        aria-pressed={props.deployMode === 'gauntlet'}
        aria-disabled={!props.gauntlet}
        title={props.gauntlet ? `Beat ${props.gauntlet.callsign}'s Wave ${props.gauntlet.wave}` : 'Weekly Champion Gauntlet has not been crowned yet.'}
        onClick={() => { if (props.gauntlet) { props.setDeployMode('gauntlet'); sfx.click(); } }}
      >
        <span>CHAMPION GAUNTLET</span>
        <b>{props.gauntlet ? `Beat ${props.gauntlet.callsign}'s Wave ${props.gauntlet.wave}` : 'Not crowned yet'}</b>
      </button>
      <button
        className={`weekly-op-card ${props.deployMode === 'gauntletProtocol' ? 'active' : ''}`}
        data-testid="gauntlet-protocol-card"
        aria-pressed={props.deployMode === 'gauntletProtocol'}
        aria-disabled={!props.gauntletProtocolUnlocked}
        title={props.gauntletProtocolUnlocked ? `Route: ${routeNames(props.gauntletProtocol.route)}` : 'Win any campaign to unlock.'}
        onClick={() => { if (props.gauntletProtocolUnlocked) { props.setDeployMode('gauntletProtocol'); sfx.click(); } }}
      >
        <span>GAUNTLET PROTOCOL</span>
        <b>{props.gauntletProtocolUnlocked ? `Route: ${routeNames(props.gauntletProtocol.route)}` : 'Win any campaign'}</b>
      </button>
    </div>
  );
}

function SectorAtlas(props: {
  map: GameMap;
  diff: DifficultyDef;
  setMap: (m: GameMap) => void;
  setDiff: (d: DifficultyDef) => void;
  deployMode: DeployMode;
  setDeployMode: (mode: DeployMode) => void;
  dailySeed: DailyChallenge;
  drills: ProtocolDrill[];
  selectedDrill: ProtocolDrill;
  setSelectedDrill: (drill: ProtocolDrill) => void;
  weeklySeed: WeeklyChallenge;
  gauntlet: WeeklyGauntletDoc | null;
  gauntletProtocol: GauntletProtocolRoute;
  gauntletProtocolUnlocked: boolean;
  yakkobUnlocked: boolean;
  onStartYakkob: () => void;
  firstTime: boolean;
  apexLocked: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const weeklyRef = useRef<HTMLDivElement>(null);
  // dock has two faces: campaign protocols vs seeded challenges (daily + weekly ops)
  const [dockTab, setDockTab] = useState<'protocols' | 'challenges'>(
    props.deployMode === 'campaign' ? 'protocols' : 'challenges');
  // one-shot shimmer sweep on the YAKKOB card the moment it lands in the dock
  const [yakkobPlaced, setYakkobPlaced] = useState(false);
  const prevYakkobUnlocked = useRef(props.yakkobUnlocked);
  const dailyMods = dailyModifierNames(props.dailySeed);
  const selectedMap = ALL_MAPS.find((m) => m.id === props.map.id) ?? ALL_MAPS[0];
  const selectedMastery = masteryLevel(selectedMap.id);
  const selectedBest = progress.bestWaveAny(selectedMap.id);

  useEffect(() => {
    const field = fieldRef.current;
    const canvas = canvasRef.current;
    if (!field || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const rect = field.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      let seed = 7331;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      ctx.fillStyle = 'rgba(207,217,255,0.72)';
      for (let i = 0; i < 150; i++) {
        ctx.globalAlpha = 0.12 + rnd() * 0.5;
        const size = rnd() < 0.1 ? 2 : 1;
        ctx.fillRect(rnd() * rect.width, rnd() * rect.height, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(75,207,250,0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      for (let i = 0; i < ALL_MAPS.length - 1; i++) {
        const [ax, ay] = atlasPos(ALL_MAPS[i].id, i);
        const [bx, by] = atlasPos(ALL_MAPS[i + 1].id, i + 1);
        ctx.beginPath();
        ctx.moveTo((ax / 100) * rect.width, (ay / 100) * rect.height);
        ctx.lineTo((bx / 100) * rect.width, (by / 100) * rect.height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);

  useEffect(() => {
    const idx = ALL_MAPS.findIndex((m) => m.id === props.map.id);
    if (idx >= 0 && !mapUnlocked(idx)) {
      const fallback = ALL_MAPS.find((_, i) => mapUnlocked(i));
      if (fallback) props.setMap(fallback);
    }
  }, [props.map, props.setMap]);

  // The moment THE YAKKOB unlocks: flip the dock to CHALLENGES, scroll its card (row 2,
  // right under DAILY) into view, focus it, and fire the one-shot shimmer.
  useEffect(() => {
    if (props.yakkobUnlocked && !prevYakkobUnlocked.current) {
      setDockTab('challenges');
      setYakkobPlaced(true);
      const raf = requestAnimationFrame(() => {
        const card = weeklyRef.current?.querySelector<HTMLButtonElement>('[data-testid="yakkob-card"]');
        card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        card?.focus();
      });
      const clear = setTimeout(() => setYakkobPlaced(false), 1500);
      prevYakkobUnlocked.current = props.yakkobUnlocked;
      return () => { cancelAnimationFrame(raf); clearTimeout(clear); };
    }
    prevYakkobUnlocked.current = props.yakkobUnlocked;
  }, [props.yakkobUnlocked]);

  const moveNodeFocus = (current: HTMLButtonElement, delta: number) => {
    const nodes = [...fieldRef.current?.querySelectorAll<HTMLButtonElement>('[data-atlas-node="true"]') ?? []];
    const at = nodes.indexOf(current);
    if (at < 0 || nodes.length === 0) return;
    nodes[(at + delta + nodes.length) % nodes.length].focus();
  };

  const openWeeklyOps = () => {
    // the beacon SELECTS the weekly mutation, it doesn't just point at it —
    // clicking a glowing map node and having nothing change reads as broken
    setDockTab('challenges');
    props.setDeployMode('weekly');
    sfx.click();
    requestAnimationFrame(() => {
      weeklyRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      weeklyRef.current?.querySelector<HTMLButtonElement>('[data-testid="weekly-mutation-card"]')?.focus();
    });
  };

  return (
    <section className="sector-atlas" data-testid="sector-atlas" aria-label="Sector Atlas">
      <div className="atlas-field" ref={fieldRef} data-testid="atlas-field">
        <canvas className="atlas-stars-canvas" ref={canvasRef} aria-hidden="true" />
        <div className="atlas-region-label atlas-region-core">CORE RELAY</div>
        <div className="atlas-region-label atlas-region-forge">THE FORGE BELT</div>
        <div className="atlas-region-label atlas-region-dark">THE DARK REACHES</div>
        {ALL_MAPS.map((m, i) => {
          const unlocked = mapUnlocked(i);
          const active = props.deployMode === 'campaign' && props.map.id === m.id;
          const [x, y] = atlasPos(m.id, i);
          const prior = ALL_MAPS[Math.max(0, i - 1)];
          const lockCopy = `Clear ${prior.name} or reach wave 20 to unlock.`;
          const region = atlasRegion(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={`atlas-node atlas-node-${region} ${active ? 'active' : ''} ${unlocked ? '' : 'locked'}`}
              data-atlas-node="true"
              data-testid={`map-node-${m.id}`}
              aria-disabled={!unlocked}
              aria-label={unlocked ? `${m.name}. ${m.difficulty} sector. ${m.desc}` : `Locked sector. ${lockCopy}`}
              title={unlocked ? m.desc : lockCopy}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => {
                if (!unlocked) {
                  appMetrics.recordLockedMapClick(m.id);
                  return;
                }
                appMetrics.recordMapSelect(m.id);
                props.setDeployMode('campaign');
                setDockTab('protocols');
                props.setMap(m);
                sfx.click();
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveNodeFocus(e.currentTarget, 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveNodeFocus(e.currentTarget, -1);
                }
              }}
            >
              {!active && props.firstTime && i === 0 && <span className="start-pill atlas-start">START HERE</span>}
              <span className="atlas-node-halo">
                <PathGlyph map={m} className={region} />
              </span>
              <span className="atlas-node-name">{unlocked ? m.name : 'CLASSIFIED'}</span>
              <MasteryStars level={unlocked ? masteryLevel(m.id) : 0} label={`${m.name} mastery`} />
            </button>
          );
        })}
        <button
          type="button"
          className="atlas-node atlas-weekly-beacon"
          data-atlas-node="true"
          data-testid="weekly-ops-beacon"
          aria-label="Open Weekly Ops"
          style={{ left: '90%', top: '30%' }}
          onClick={openWeeklyOps}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              moveNodeFocus(e.currentTarget, 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              moveNodeFocus(e.currentTarget, -1);
            }
          }}
        >
          <span className="atlas-node-halo">
            <PathGlyph map={selectedMap} className="weekly" />
          </span>
          <span className="atlas-node-name">WEEKLY OPS</span>
        </button>
      </div>

      <aside className="atlas-dock" data-testid="sector-dock" aria-live="polite">
        <div className="dock-kicker">{atlasRegionLabel(atlasRegion(selectedMap.id))}</div>
        <h2>{selectedMap.name}</h2>
        <div className="dock-mastery-row">
          <MasteryStars level={selectedMastery} />
          <span>{selectedMastery}/3 mastery</span>
        </div>
        <p>{selectedMap.desc}</p>
        <div className="dock-stat-grid">
          <div><span>Best wave</span><b>{selectedBest > 0 ? `W${selectedBest}` : '-'}</b></div>
          <div><span>Difficulty</span><b>{selectedMap.difficulty}</b></div>
        </div>
        <div className="dock-tabs" role="tablist" aria-label="Deploy options">
          <button
            role="tab"
            data-testid="dock-tab-protocols"
            aria-selected={dockTab === 'protocols'}
            className={dockTab === 'protocols' ? 'on' : ''}
            onClick={() => { setDockTab('protocols'); sfx.click(); }}
          >PROTOCOLS</button>
          <button
            role="tab"
            data-testid="dock-tab-challenges"
            aria-selected={dockTab === 'challenges'}
            className={dockTab === 'challenges' ? 'on' : ''}
            onClick={() => { setDockTab('challenges'); sfx.click(); }}
          >CHALLENGES</button>
        </div>
        {dockTab === 'protocols' ? (
        <div className="diff-row atlas-protocols" data-testid="diff-row">
          {DIFFICULTIES.map((d) => {
            const locked = (d.id === 'hard' && props.apexLocked)
              || (d.id === 'extinction' && !DEMO_MODE && !progress.apexCleared);
            const active = props.deployMode === 'campaign' && props.diff.id === d.id;
            const reason = d.id === 'extinction'
              ? { label: 'LOCKED EXTINCTION', desc: 'Win an Apex campaign to unlock.', title: 'Beat Apex to face Extinction.' }
              : { label: 'LOCKED APEX', desc: 'Survive one campaign to unlock.', title: 'Complete one campaign to unlock Apex.' };
            if (locked) {
              return (
                <button key={d.id} type="button" className="diff-card atlas-protocol-row diff-locked" data-testid={`diff-card-${d.id}`}
                  aria-disabled="true" aria-label={`Locked protocol. ${reason.desc}`} title={reason.title}
                  onClick={() => appMetrics.recordLockedProtocolClick(d.id)}>
                  <span className="diff-name">{reason.label}</span>
                  <span className="diff-desc">{reason.desc}</span>
                </button>
              );
            }
            return (
              <button
                key={d.id}
                className={`diff-card atlas-protocol-row ${active ? 'active' : ''} ${d.id === 'extinction' ? 'diff-extinction' : ''}`}
                data-testid={`diff-card-${d.id}`}
                aria-label={`${d.name} protocol. ${d.desc}`}
                title={d.desc}
                onClick={() => { appMetrics.recordProtocolSelect(d.id); props.setDeployMode('campaign'); sfx.click(); props.setDiff(d); }}
              >
                {!active && props.firstTime && d.id === 'easy' && <span className="start-pill">RECOMMENDED</span>}
                <span className="diff-name">{d.name}</span>
                <span className="diff-desc">{d.waves} waves · best {progress.best(selectedMap.id, d.id) ? `W${progress.best(selectedMap.id, d.id)}` : '—'}</span>
              </button>
            );
          })}
        </div>
        ) : (
        <div className="dock-challenges" ref={weeklyRef} data-testid="dock-challenges">
          <button
            className={`diff-card atlas-protocol-row daily-protocol ${props.deployMode === 'daily' ? 'active' : ''}`}
            data-testid="diff-card-daily"
            aria-label={`Daily Challenge protocol. ${dailyMods.join(', ')}`}
            aria-pressed={props.deployMode === 'daily'}
            title={props.dailySeed.rules.join('\n')}
            onClick={() => { props.setDeployMode('daily'); sfx.click(); }}
          >
            <span className="diff-name">DAILY CHALLENGE</span>
            <span className="diff-desc daily-card-mods">{dailyMods.join(' / ')}</span>
          </button>
          <WeeklyOpsSection
            weeklySeed={props.weeklySeed}
            gauntlet={props.gauntlet}
            gauntletProtocol={props.gauntletProtocol}
            gauntletProtocolUnlocked={props.gauntletProtocolUnlocked}
            yakkobUnlocked={props.yakkobUnlocked}
            yakkobJustPlaced={yakkobPlaced}
            onStartYakkob={props.onStartYakkob}
            deployMode={props.deployMode}
            setDeployMode={props.setDeployMode}
          />
        </div>
        )}
      </aside>
    </section>
  );
}

export function MainMenu(props: {
  map: GameMap; diff: DifficultyDef;
  setMap: (m: GameMap) => void; setDiff: (d: DifficultyDef) => void;
  dailySeed: DailyChallenge;
  drills: ProtocolDrill[];
  weeklySeed: WeeklyChallenge;
  gauntlet: WeeklyGauntletDoc | null;
  gauntletProtocol: GauntletProtocolRoute;
  onStart: () => void;
  onStartDaily: () => void;
  onStartDrill: (drill: ProtocolDrill) => void;
  onStartWeekly: () => void;
  onStartGauntlet: () => void;
  onStartGauntletProtocol: () => void;
  onStartYakkob: () => void;
  yakkobUnlocked: boolean;
  onUnlockYakkob: () => void;
}) {
  const [tab, setTab] = useState<'deploy' | 'board' | 'ops'>('deploy');
  const [deployMode, setDeployMode] = useState<DeployMode>('campaign');
  const [selectedDrill, setSelectedDrill] = useState(props.drills[0]);
  const [, bumpClaim] = useState(0); // re-read meta.claimableCount() for the nav badge after a claim
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bestiaryOpen, setBestiaryOpen] = useState(false);
  // Apex unlocks on a COMPLETED campaign (a win), matching its "survive one campaign"
  // copy — not on any run end (an instant wave-1 loss used to unlock it).
  const apexLocked = !DEMO_MODE && progress.record.victories < 1;
  const firstTime = !DEMO_MODE && progress.record.runs < 1;
  const gauntletProtocolUnlocked = DEMO_MODE || progress.record.victories >= 1;
  const selectedUnlocked = deployMode === 'daily' || deployMode === 'drill' || deployMode === 'weekly' || deployMode === 'gauntlet'
    || (deployMode === 'gauntletProtocol' && gauntletProtocolUnlocked)
    || (deployMode === 'yakkob' && props.yakkobUnlocked)
    || mapUnlocked(ALL_MAPS.findIndex((m) => m.id === props.map.id));
  // nav-tab cues: claimable operations + newly-identified hulls awaiting a Bestiary visit.
  // foesSeen must use the SAME basis the Bestiary acks with (ENEMY_LIST intersection, not the
  // raw persisted list) or a stale/removed enemy id would make the NEW badge stick forever.
  const claimable = DEMO_MODE ? 0 : meta.claimableCount();
  const foesSeen = ENEMY_LIST.filter((d) => progress.enemiesSeen.includes(d.id)).length;
  const foesNew = Math.max(0, foesSeen - progress.bestiaryAck);
  return (
    <div className="menu-root">
      <div className="menu-stars" />

      {tab === 'deploy' && !props.yakkobUnlocked && (
        <YakkobDwarf onUnlock={() => { props.onUnlockYakkob(); setDeployMode('yakkob'); }} />
      )}

      <header className="menu-topbar">
        <div className="menu-brand">
          <span className="menu-eyebrow">SECTOR DEFENSE PROTOCOL</span>
          <h1 className="menu-title">LANTERN<span> 7</span></h1>
        </div>
        <nav className="menu-tabs" aria-label="Main menu sections">
          <button className={tab === 'deploy' ? 'on' : ''} aria-pressed={tab === 'deploy'} onClick={() => { appMetrics.recordMenuTab('deploy'); setTab('deploy'); sfx.click(); }}>DEPLOY</button>
          <button className={tab === 'board' ? 'on' : ''} aria-pressed={tab === 'board'} onClick={() => { appMetrics.recordMenuTab('board'); setTab('board'); sfx.click(); }}>LEADERBOARD</button>
          <button className={tab === 'ops' ? 'on' : ''} aria-pressed={tab === 'ops'} onClick={() => { setTab('ops'); sfx.click(); }}>
            OPERATIONS{claimable > 0 && <span className="tab-badge" aria-label={`${claimable} operations ready to claim`}>{claimable}</span>}
          </button>
          <button className="menu-tab-help" title={`Combine Bestiary — ${foesSeen}/${ENEMY_LIST.length} identified`}
            data-testid="menu-utility-bestiary"
            aria-label={`Combine Bestiary, ${foesSeen} of ${ENEMY_LIST.length} hulls identified${foesNew > 0 ? `, ${foesNew} new` : ''}`}
            onClick={() => { setBestiaryOpen(true); sfx.click(); }}>
            <span className="menu-tab-icon" aria-hidden="true">👾</span>{foesNew > 0 && <span className="tab-badge new" aria-hidden="true">{foesNew}</span>}
          </button>
          <button className="menu-tab-help" title="How to play" data-testid="menu-utility-help" aria-label="How to play" onClick={() => { setHelp(true); sfx.click(); }}>
            <span className="menu-tab-icon" aria-hidden="true">?</span>
          </button>
          <button className="menu-tab-help" title="Settings" data-testid="menu-utility-settings" aria-label="Settings" onClick={() => { setSettingsOpen(true); sfx.click(); }}>
            <span className="menu-tab-icon" aria-hidden="true">⚙</span>
          </button>
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

      {/* one unified Commander Dossier (returning players) replaces the 3 ragged strips.
          Deploy-tab only: on Leaderboard/Operations it just pushed the content down. */}
      {tab === 'deploy' && (progress.record.runs > 0 ? (
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
      )))}

      <div className={`menu-layout menu-tab-${tab}`}>
        <CommanderDossierRail onOpenOps={() => { setTab('ops'); sfx.click(); }} />
        <main className="menu-main">
          <div className="menu-content">
        {tab === 'deploy' ? (
          <SectorAtlas
            map={props.map}
            diff={props.diff}
            setMap={props.setMap}
            setDiff={props.setDiff}
            deployMode={deployMode}
            setDeployMode={setDeployMode}
            dailySeed={props.dailySeed}
            drills={props.drills}
            selectedDrill={selectedDrill}
            setSelectedDrill={setSelectedDrill}
            weeklySeed={props.weeklySeed}
            gauntlet={props.gauntlet}
            gauntletProtocol={props.gauntletProtocol}
            gauntletProtocolUnlocked={gauntletProtocolUnlocked}
            yakkobUnlocked={props.yakkobUnlocked}
            onStartYakkob={props.onStartYakkob}
            firstTime={firstTime}
            apexLocked={apexLocked}
          />
        ) : tab === 'board' ? (
          <LeaderboardTab
            map={props.map}
            diff={props.diff}
            daily={props.dailySeed}
            weekly={props.weeklySeed}
            gauntlet={props.gauntlet}
            initialMode={deployMode === 'daily' ? 'daily' : deployMode === 'weekly' ? 'weekly' : deployMode === 'gauntlet' ? 'gauntlet' : 'campaign'}
          />
        ) : (
          <OperationsBoard onClaimed={() => bumpClaim((n) => n + 1)} />
        )}
      </div>

      {/* sticky launch bar — always visible, reflects the current selection */}
        </main>
      </div>
      {tab === 'deploy' && <div className="deploy-bar">
        <div className="deploy-bar-inner">
          <div className="menu-legal">
            {!IS_PORTAL_BUILD && <a href="/privacy">Privacy &amp; Data Choices</a>}
          </div>
          <div className="deploy-bar-sel">
            <span className="dbar-label">DEPLOYING TO</span>
            <span className="dbar-sec">{deployMode === 'daily'
              ? (ALL_MAPS.find((m) => m.id === props.dailySeed.mapId)?.name ?? props.dailySeed.mapId)
              : deployMode === 'yakkob'
                ? (ALL_MAPS.find((m) => m.id === THE_YAKKOB.mapId)?.name ?? THE_YAKKOB.mapId)
              : deployMode === 'drill'
                ? (ALL_MAPS.find((m) => m.id === selectedDrill.mapId)?.name ?? selectedDrill.mapId)
              : deployMode === 'weekly'
                ? (ALL_MAPS.find((m) => m.id === props.weeklySeed.mapId)?.name ?? props.weeklySeed.mapId)
                : deployMode === 'gauntlet' && props.gauntlet
                  ? (ALL_MAPS.find((m) => m.id === props.gauntlet?.map)?.name ?? props.gauntlet.map)
                  : deployMode === 'gauntletProtocol'
                    ? (ALL_MAPS.find((m) => m.id === props.gauntletProtocol.route[0])?.name ?? props.gauntletProtocol.route[0])
                    : props.map.name}</span>
            <span className="dbar-dot">·</span>
            <span className="dbar-diff">{deployMode === 'daily'
              ? 'DAILY CHALLENGE'
              : deployMode === 'yakkob'
                ? 'THE YAKKOB'
              : deployMode === 'drill'
                ? selectedDrill.title.toUpperCase()
              : deployMode === 'weekly'
                ? 'WEEKLY MUTATION'
                : deployMode === 'gauntlet'
                  ? 'CHAMPION GAUNTLET'
                  : deployMode === 'gauntletProtocol'
                    ? 'GAUNTLET PROTOCOL'
                    : props.diff.name}</span>
          </div>
          <button className={`start-btn deploy-bar-btn ${deployMode !== 'campaign' ? 'daily' : ''}`} data-testid="deploy-button" disabled={!selectedUnlocked || (deployMode === 'gauntlet' && !props.gauntlet)}
            onClick={() => {
              if (deployMode === 'daily') {
                appMetrics.recordDeployAttempt(props.dailySeed.mapId, props.dailySeed.diffId, true);
                props.onStartDaily();
              } else if (deployMode === 'yakkob') {
                appMetrics.recordDeployAttempt(THE_YAKKOB.mapId, THE_YAKKOB.diffId, true);
                props.onStartYakkob();
              } else if (deployMode === 'drill') {
                props.onStartDrill(selectedDrill);
              } else if (deployMode === 'weekly') {
                appMetrics.recordDeployAttempt(props.weeklySeed.mapId, props.weeklySeed.diffId, true);
                props.onStartWeekly();
              } else if (deployMode === 'gauntlet') {
                props.onStartGauntlet();
              } else if (deployMode === 'gauntletProtocol') {
                props.onStartGauntletProtocol();
              } else {
                appMetrics.recordDeployAttempt(props.map.id, props.diff.id, selectedUnlocked);
                props.onStart();
              }
            }}>
            {deployMode === 'daily'
              ? '▶ DAILY CHALLENGE'
              : deployMode === 'yakkob'
                ? '▶ THE YAKKOB'
              : deployMode === 'drill'
                ? '▶ START DRILL'
              : deployMode === 'weekly'
                ? '▶ WEEKLY MUTATION'
                : deployMode === 'gauntlet'
                  ? '▶ GAUNTLET'
                  : deployMode === 'gauntletProtocol'
                    ? '▶ GAUNTLET PROTOCOL'
                    : firstTime
                    ? '▶ START MISSION'
                    : '▶ DEPLOY'}
          </button>
        </div>
      </div>}
    </div>
  );
}

function routeNames(route: readonly string[]): string {
  return route.map((id) => ALL_MAPS.find((map) => map.id === id)?.name ?? id).join(' -> ');
}
