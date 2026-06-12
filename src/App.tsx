import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './App.css';
import { Game, W, H } from './game/engine';
import { render, drawTowerBody } from './game/render';
import { TOWERS, sellValue } from './game/towers';
import { ALL_MAPS, MAPS, DIFFICULTIES } from './game/maps';
import { ENEMIES } from './game/enemies';
import { ABILITIES } from './game/abilities';
import { BRIEFING, LONGWATCH_BRIEFING, ARCHIVE, ABILITY_LORE, RECEIVER_DESC, ARMISTICE_LINES } from './game/lore';
import { RECEIVER_COST } from './game/engine';
import { progress } from './game/storage';
import { Bot } from './game/bot';
import { boardId, submitScore, fetchTop, type ScoreEntry } from './game/leaderboard';

// story cutscenes (generated, captions baked into the frames) — shown in campaign modes
const CUTSCENES = [
  { wave: 0, img: '/art/scene-1.png', title: 'CHAPTER I — SEVEN STILL BURNS' },
  { wave: 14, img: '/art/scene-2.png', title: 'CHAPTER II — THE SCHEDULE' },
  { wave: 26, img: '/art/scene-3.png', title: 'CHAPTER III — 04:47' },
  { wave: 41, img: '/art/scene-4.png', title: 'CHAPTER IV — A POLITE ARMADA' },
  { wave: 50, img: '/art/scene-5.png', title: 'CHAPTER V — THE POUCH' },
  { wave: -1, img: '/art/scene-6.png', title: 'EPILOGUE — THE LIGHT GOES ON' },
];
import { sfx, setMuted, isMuted, setMusic, isMusicOn, playBriefing, playSectorTheme, playNarration } from './game/sound';
import type { GameMap, DifficultyDef, TowerDef, Tower, TargetMode, Vec } from './game/types';

type Screen = 'menu' | 'game';
const TARGET_MODES: TargetMode[] = ['first', 'last', 'strong', 'close'];

// browser perf harness: /?perf=<mapId>&diff=<diffId> auto-runs the expert bot at 4x
// with rendering on and a live FPS meter. Example: /?perf=throat&diff=hard
const PERF_PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const PERF_MAP = PERF_PARAMS.get('perf');

export default function App() {
  const [screen, setScreen] = useState<Screen>(PERF_MAP !== null ? 'game' : 'menu');
  const [map, setMap] = useState<GameMap>(ALL_MAPS.find((m) => m.id === PERF_MAP) ?? MAPS[0]);
  const [diff, setDiff] = useState<DifficultyDef>(
    DIFFICULTIES.find((d) => d.id === PERF_PARAMS.get('diff')) ?? DIFFICULTIES[1]);

  if (screen === 'menu') {
    return (
      <MainMenu
        map={map} diff={diff} setMap={setMap} setDiff={setDiff}
        onStart={() => { sfx.click(); setScreen('game'); }}
      />
    );
  }
  return <GameScreen map={map} diff={diff} onExit={() => setScreen('menu')} />;
}

// ---------------- Main menu ----------------

function MainMenu(props: {
  map: GameMap; diff: DifficultyDef;
  setMap: (m: GameMap) => void; setDiff: (d: DifficultyDef) => void;
  onStart: () => void;
}) {
  return (
    <div className="menu-root">
      <div className="menu-stars" />
      <h1 className="menu-title">NEON VECTOR<span> DEFENSE</span></h1>
      <p className="menu-sub">Year 2347. The Combine has found Lantern Seven. A million archived souls are listening to the hull. Hold the lane.</p>

      <div className="menu-section-label">SELECT SECTOR</div>
      <div className="map-grid">
        {ALL_MAPS.map((m) => (
          <button
            key={m.id}
            className={`map-card ${props.map.id === m.id ? 'active' : ''}`}
            onClick={() => { sfx.click(); props.setMap(m); }}
          >
            <div className="map-thumb-stack">
              <img className="map-thumb-art" src={`/art/sector-${m.id}.png`} alt="" />
              <MapThumb map={m} />
            </div>
            <div className="map-card-name">{m.name}</div>
            <div className={`map-card-diff diff-${m.difficulty.toLowerCase()}`}>{m.difficulty}</div>
            <div className="map-card-desc">{m.desc}</div>
            {progress.best(m.id, props.diff.id) > 0 && (
              <div className="map-card-best">SERVICE RECORD · WAVE {progress.best(m.id, props.diff.id)}</div>
            )}
          </button>
        ))}
      </div>

      <div className="menu-section-label">SELECT PROTOCOL</div>
      <div className="diff-row">
        {DIFFICULTIES.map((d) => {
          const locked = d.id === 'ngplus' && !progress.armisticeSeen;
          if (locked) {
            return (
              <div key={d.id} className="diff-card diff-locked" title="Sealed. End the war the other way first.">
                <div className="diff-name">🔒 ????</div>
                <div className="diff-desc">The Archive knows another ending.</div>
              </div>
            );
          }
          return (
            <button
              key={d.id}
              className={`diff-card ${props.diff.id === d.id ? 'active' : ''} ${d.id === 'ngplus' ? 'diff-ngplus' : ''}`}
              onClick={() => { sfx.click(); props.setDiff(d); }}
            >
              <div className="diff-name">{d.name}</div>
              <div className="diff-desc">{d.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="menu-section-label">SECTOR LEADERBOARD</div>
      <MenuLeaderboard map={props.map} diff={props.diff} />

      <div className="menu-settings">
        <button className="tb-btn" onClick={() => { progress.cutscenes = !progress.cutscenes; sfx.click(); props.setDiff({ ...props.diff }); }}>
          🎬 CUTSCENES {progress.cutscenes ? 'ON' : 'OFF'}
        </button>
        <input className="name-input" maxLength={20} placeholder="CALLSIGN"
          defaultValue={progress.playerName}
          onBlur={(e) => { progress.playerName = e.target.value.trim(); }} />
      </div>

      {progress.history.length > 0 && (
        <div className="history-panel">
          <div className="menu-section-label">RECENT CAMPAIGNS</div>
          {progress.history.slice(0, 6).map((r, i) => (
            <div key={i} className={`lb-row ${r.won ? 'won' : ''}`}>
              <span className="lb-name">{ALL_MAPS.find((m) => m.id === r.map)?.name ?? r.map} · {DIFFICULTIES.find((d) => d.id === r.diff)?.name ?? r.diff}</span>
              <span className="lb-wave">W{r.wave}</span>
              <span className="lb-cash">⌬{r.cash.toLocaleString()}</span>
              <span className="lb-kills">☠{r.kills}</span>
              <span className="lb-rank">{r.won ? (r.freeplay ? '∞' : '✓') : '✕'}</span>
            </div>
          ))}
        </div>
      )}

      {progress.record.runs > 0 && (
        <div className="warden-record">
          <span>CAMPAIGNS {progress.record.runs}</span>
          <span>LANTERNS HELD {progress.record.victories}</span>
          <span>HULLS DESTROYED {progress.record.kills.toLocaleString()}</span>
          <span>WAVES CLEARED {progress.totalWaves}</span>
          <span>{progress.armisticeSeen ? 'ARMISTICE ✓' : 'ARMISTICE —'}</span>
        </div>
      )}

      <button className="start-btn" onClick={props.onStart}>▶ DEPLOY</button>
    </div>
  );
}

function MenuLeaderboard({ map, diff }: { map: GameMap; diff: DifficultyDef }) {
  const [fp, setFp] = useState(false);
  const [rows, setRows] = useState<ScoreEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    fetchTop(boardId(map.id, diff.id, fp)).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [map.id, diff.id, fp]);
  return (
    <div className="menu-lb">
      <div className="menu-lb-head">
        <span>{map.name} · {diff.name}</span>
        <button className={`tb-btn ${fp ? 'on' : ''}`} onClick={() => { setFp(!fp); sfx.click(); }}>FREEPLAY</button>
      </div>
      {rows === null && <div className="hint-dim">contacting sector command…</div>}
      {rows !== null && rows.length === 0 && <div className="hint-dim">No records yet. Be the first Warden on this board.</div>}
      {rows !== null && rows.length > 0 && (
        <div className="lb-table">
          {rows.map((r, i) => (
            <div key={i} className="lb-row">
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-name">{r.name}</span>
              <span className="lb-cash">⌬{r.cash.toLocaleString()}</span>
              <span className="lb-kills">☠{r.kills}</span>
              {fp && <span className="lb-wave">W{r.wave}</span>}
            </div>
          ))}
        </div>
      )}
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

// ---------------- Game screen ----------------

function GameScreen({ map, diff, onExit }: { map: GameMap; diff: DifficultyDef; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0); // bump to restart the sector
  const gameRef = useRef<Game | null>(null);
  const runRef = useRef(-1);
  if (!gameRef.current || runRef.current !== run) {
    gameRef.current = new Game(map, diff);
    runRef.current = run;
  }
  const game = gameRef.current;
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;

  const [, setTick] = useState(0);
  const [placing, setPlacing] = useState<TowerDef | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [aiming, setAiming] = useState(false);
  const [briefed, setBriefed] = useState(PERF_MAP !== null);
  const botRef = useRef<Bot | null>(null);
  const fpsRef = useRef({ frames: 0, t: 0, fps: 0, worst: 999 });
  const [cutscene, setCutscene] = useState<number | null>(null);
  const [cloakTip, setCloakTip] = useState(false);
  const cutsceneRef = useRef<number | null>(null);
  const briefedRef = useRef(false);
  const scenesShownRef = useRef(new Set<number>());
  cutsceneRef.current = cutscene;
  briefedRef.current = briefed;
  useEffect(() => { scenesShownRef.current = new Set(); }, [run]);
  const [sideTab, setSideTab] = useState<'build' | 'intel'>('build');
  const hoverRef = useRef<Vec | null>(null);
  const placingRef = useRef<TowerDef | null>(null);
  const selectedRef = useRef<Tower | null>(null);
  const aimingRef = useRef(false);
  placingRef.current = placing;
  aimingRef.current = aiming;
  selectedRef.current = game.towers.find((t) => t.uid === selectedUid) ?? null;

  // sector ambience while deployed
  useEffect(() => {
    playSectorTheme(diff.id === 'ngplus' ? 'hollow' : (map.music ?? map.id));
    return () => playSectorTheme(null);
  }, [map.id, map.music, diff.id]);

  // main loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let uiTimer = 0;
    if (PERF_MAP !== null && !botRef.current) {
      game.speed = 4;
      game.autoNext = true;
      botRef.current = new Bot(game, 'expert');
    }
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (botRef.current) {
        botRef.current.act(game.time);
        if (game.phase === 'victory') { game.freeplay = true; game.phase = 'build'; }
        const f = fpsRef.current;
        f.frames++;
        if (dt > 0) f.worst = Math.min(f.worst, 1 / dt);
        if (now - f.t > 1000) { f.fps = f.frames; f.frames = 0; f.t = now; }
      }
      game.update(dt);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const hover = hoverRef.current;
        const pl = placingRef.current;
        render(ctx, game, {
          hover,
          placing: pl,
          canPlaceHere: !!(hover && pl) && game.canPlace(hover!) && game.credits >= game.cost(pl!),
          selected: selectedRef.current,
          aimingStrike: aimingRef.current,
        });
      }
      uiTimer += dt;
      if (uiTimer > 0.12) {
        uiTimer = 0;
        setTick((t) => t + 1);
        // first-cloaked-hull explainer
        if (game.cloakTipPending) {
          game.cloakTipPending = false;
          game.paused = true;
          setCloakTip(true);
        }
        // story cutscene triggers (campaign modes only, skippable via menu toggle)
        if (progress.cutscenes && diff.id !== 'ngplus' && PERF_MAP === null &&
            cutsceneRef.current === null && briefedRef.current) {
          const shown = scenesShownRef.current;
          for (let i = 0; i < CUTSCENES.length; i++) {
            if (shown.has(i)) continue;
            const c = CUTSCENES[i];
            const due = c.wave === -1
              ? game.phase === 'victory'
              : game.phase === 'build' && game.wave >= c.wave;
            if (due) {
              shown.add(i);
              game.paused = true;
              setCutscene(i);
              break;
            }
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  const toCanvas = useCallback((ev: { clientX: number; clientY: number }): Vec => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    // account for object-fit: contain letterboxing
    const scale = Math.min(r.width / W, r.height / H);
    const ox = r.left + (r.width - W * scale) / 2;
    const oy = r.top + (r.height - H * scale) / 2;
    return { x: (ev.clientX - ox) / scale, y: (ev.clientY - oy) / scale };
  }, []);

  // touch: dragging a finger shows the placement ghost; the tap's click event places
  const onCanvasTouch = (ev: React.TouchEvent) => {
    const t = ev.touches[0];
    if (t) hoverRef.current = toCanvas(t);
  };

  const onCanvasMove = (ev: React.MouseEvent) => { hoverRef.current = toCanvas(ev); };
  const onCanvasLeave = () => { hoverRef.current = null; };
  const onCanvasClick = (ev: React.MouseEvent) => {
    const pos = toCanvas(ev);
    if (aiming) {
      game.castAbility('strike', pos);
      setAiming(false);
      return;
    }
    if (game.collectPickup(pos)) return;
    if (placing) {
      const t = game.placeTower(placing, pos);
      if (t && !ev.shiftKey) setPlacing(null);
      return;
    }
    // select tower under cursor
    let found: Tower | null = null;
    for (const t of game.towers) {
      if (Math.hypot(t.pos.x - pos.x, t.pos.y - pos.y) <= 20) { found = t; break; }
    }
    setSelectedUid(found ? found.uid : null);
    if (found) sfx.click();
  };
  const onContext = (ev: React.MouseEvent) => {
    ev.preventDefault();
    setPlacing(null);
    setSelectedUid(null);
    setAiming(false);
  };

  const useAbility = (id: typeof ABILITIES[number]['id']) => {
    const a = ABILITIES.find((x) => x.id === id)!;
    if (!game.abilityReady(id)) { sfx.error(); return; }
    if (a.targeted) {
      setAiming((v) => !v);
      setPlacing(null);
      setSelectedUid(null);
    } else {
      game.castAbility(id);
    }
  };
  const useAbilityRef = useRef(useAbility);
  useAbilityRef.current = useAbility;

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { setPlacing(null); setSelectedUid(null); setAiming(false); }
      if (ev.key === ' ') {
        ev.preventDefault();
        if (game.phase === 'build') game.startWave();
        else game.paused = !game.paused;
      }
      const ab = { q: 'strike', w: 'chrono', e: 'overdrive', r: 'salvage', t: 'cascade', y: 'mirror' } as const;
      const k = ev.key.toLowerCase() as keyof typeof ab;
      if (ab[k]) useAbilityRef.current(ab[k]);
      const n = ev.key === '0' ? 10 : parseInt(ev.key);
      if (n >= 1 && n <= TOWERS.length) {
        const def = TOWERS[n - 1];
        setPlacing((p) => (p?.id === def.id ? null : def));
        setSelectedUid(null);
        setAiming(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  const selected = selectedRef.current;

  return (
    <div className="game-root">
      <div className="topbar">
        <button className="tb-btn exit" onClick={onExit}>✕ ABORT</button>
        <div className="tb-stat lives" title="Reactor cores (lives)">⬢ {game.lives}</div>
        <div className="tb-stat credits" title="Credits">⌬ {Math.floor(game.credits)}</div>
        <div className="tb-stat wave">
          WAVE {game.wave}{game.phase === 'build' ? ` / ${game.freeplay ? '∞' : diff.waves}` : ''}
        </div>
        {PERF_MAP !== null && (
          <div className="tb-stat" style={{ color: '#7bed9f' }} title="Perf harness: expert bot, 4x, auto-freeplay">
            ⏱ {fpsRef.current.fps}fps · {game.enemies.length}E {game.particles.length}P {game.projectiles.length}J
          </div>
        )}
        {game.adaptation.type && (
          <div className="tb-stat" style={{ color: '#ff9f43' }} title="Apex protocol: the Combine has armored against your most-used damage type for 10 waves">
            ⛨ {game.adaptation.type} −35%
          </div>
        )}
        <div className="tb-spacer" />
        <div className="tb-stat kills" title="Hostiles destroyed">☠ {game.totalKills}</div>
        <button
          className={`tb-btn ${game.autoNext ? 'on' : ''}`}
          title="Auto-start next wave"
          onClick={() => { game.autoNext = !game.autoNext; sfx.click(); }}
        >AUTO</button>
        {[1, 2, 4].map((s) => (
          <button key={s} className={`tb-btn ${game.speed === s ? 'on' : ''}`}
            onClick={() => { game.speed = s; sfx.click(); }}>{s}×</button>
        ))}
        <button className={`tb-btn ${game.paused ? 'on' : ''}`}
          onClick={() => { game.paused = !game.paused; sfx.click(); }}>
          {game.paused ? '▶' : '⏸'}
        </button>
        <MusicButton />
        <button className={`tb-btn ${muted ? '' : 'on'}`} title="Sound effects & voice on/off"
          onClick={() => { const m = !muted; setMuted(m); setMutedState(m); sfx.click(); }}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="game-body">
        <div className="canvas-wrap">
          <canvas
            ref={canvasRef} width={W} height={H}
            onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave}
            onClick={onCanvasClick} onContextMenu={onContext}
            onTouchStart={onCanvasTouch} onTouchMove={onCanvasTouch}
            style={{ cursor: placing ? 'crosshair' : 'default', touchAction: 'none' }}
          />
          {/* commander abilities */}
          <div className="ability-bar">
            {game.abilities.map((a, i) => {
              const locked = game.wave < a.def.unlockWave;
              const ready = !locked && a.cd <= 0;
              const pct = a.cd / a.def.cooldown;
              return (
                <button
                  key={a.def.id}
                  className={`ability-btn ${ready ? 'ready' : ''} ${aiming && a.def.id === 'strike' ? 'aiming' : ''}`}
                  disabled={locked}
                  title={locked
                    ? `${a.def.name} — comes online at wave ${a.def.unlockWave}`
                    : `${a.def.name} (${'QWERTY'[i]}) — ${a.def.desc}\n\n${ABILITY_LORE[a.def.id] ?? ''}`}
                  onClick={() => useAbility(a.def.id)}
                >
                  <span className="ability-icon">{locked ? '🔒' : a.def.icon}</span>
                  <span className="ability-key">{'QWERTY'[i]}</span>
                  {a.cd > 0 && <span className="ability-cd" style={{ height: `${pct * 100}%` }} />}
                  {a.cd > 0 && <span className="ability-cd-num">{Math.ceil(a.cd)}</span>}
                </button>
              );
            })}
          </div>

          {/* threat advisories */}
          {game.noticeTimer > 0 && <div className="notice">{game.notice}</div>}

          {game.phase === 'build' && (
            <button className="wave-btn" onClick={() => { game.startWave(); setTick((t) => t + 1); }}>
              ▶ LAUNCH WAVE {game.wave + 1}
            </button>
          )}
          {game.paused && <div className="overlay-label">PAUSED</div>}
          {!briefed && (
            <BriefingOverlay
              lines={diff.id === 'ngplus' ? LONGWATCH_BRIEFING : BRIEFING}
              portrait={diff.id === 'ngplus' ? '/art/hollow.png' : '/art/briefing.png'}
              audio={diff.id === 'ngplus' ? '/audio/vox/longwatch-brief.wav' : '/audio/briefing.wav'}
              onDone={() => { setBriefed(true); sfx.waveStart(); }}
            />
          )}
          {game.phase === 'gameover' && (
            <Overlay title="GRID OFFLINE" color="#ff4757" art="/art/defeat.png" report={<><AfterAction game={game} /><SubmitScore game={game} map={map} diff={diff} /></>}
              lines={[`The armada broke through on wave ${game.wave}.`, `${game.totalKills} hostiles destroyed.`]}
              buttons={[
                { label: '↻ RETRY SECTOR', fn: () => { sfx.click(); setSelectedUid(null); setPlacing(null); setRun((r) => r + 1); } },
                { label: 'MAIN MENU', fn: onExit },
              ]}
            />
          )}
          {cloakTip && (
            <div className="cutscene-overlay" onClick={() => { setCloakTip(false); progress.cloakTipSeen = true; game.paused = false; sfx.click(); }}>
              <div className="cutscene-box tip-box">
                <div className="cutscene-title" style={{ color: '#ff6ec7' }}>⚠ PHASE-CLOAKED HOSTILES</div>
                <p className="tip-text">
                  The shimmering, translucent hulls entering the corridor are <b>phase-cloaked</b> —
                  your towers cannot see them without sensor coverage, and they will walk straight through your defense.
                </p>
                <p className="tip-text">
                  Counter them with the <b style={{ color: '#54a0ff' }}>EMP Spire</b> (reveals cloaks for every tower in its aura),
                  or towers with their own sensors: <b style={{ color: '#ffa8a8' }}>Railgun · Spotter Uplink</b>,{' '}
                  <b style={{ color: '#8ef5d9' }}>Drone Carrier · Sensor Suite</b>, or the <b style={{ color: '#9ffff5' }}>Oracle Lens</b>.
                </p>
                <button className="start-btn small">UNDERSTOOD</button>
              </div>
            </div>
          )}
          {cutscene !== null && (
            <CutsceneOverlay
              scene={CUTSCENES[cutscene]}
              onDone={() => { setCutscene(null); game.paused = false; sfx.click(); }}
            />
          )}
          {game.phase === 'armistice' && (
            <Overlay title="THE LONG SIGNAL" color="#ffd32a" art="/art/armistice.png" report={<><AfterAction game={game} /><SubmitScore game={game} map={map} diff={diff} /></>}
              lines={ARMISTICE_LINES}
              buttons={[{ label: 'MAIN MENU', fn: onExit }]}
            />
          )}
          {game.phase === 'victory' && (
            <Overlay title="SECTOR SECURED" color="#2ed573" art="/art/victory.png" report={<><AfterAction game={game} /><SubmitScore game={game} map={map} diff={diff} /></>}
              lines={[`All ${diff.waves} waves repelled on ${map.name}.`, `${game.totalKills} hostiles destroyed.`]}
              buttons={[
                { label: '∞ FREEPLAY', fn: () => { game.freeplay = true; game.phase = 'build'; sfx.click(); } },
                { label: 'MAIN MENU', fn: onExit },
              ]}
            />
          )}
        </div>

        <div className="sidebar">
          <div className="side-tabs">
            <button className={sideTab === 'build' ? 'on' : ''} onClick={() => { setSideTab('build'); setSelectedUid(null); sfx.click(); }}>⚒ BUILD</button>
            <button className={sideTab === 'intel' ? 'on' : ''} onClick={() => { setSideTab('intel'); sfx.click(); }}>
              ✦ INTEL{game.newArchive ? <span className="tab-dot" /> : null}
            </button>
          </div>
          {sideTab === 'build' ? (
            <>
              {selected ? (
                <UpgradePanel game={game} tower={selected} onSold={() => setSelectedUid(null)} />
              ) : (
                <Shop game={game} placing={placing} setPlacing={(d) => { setPlacing(d); setSelectedUid(null); }} />
              )}
              <ReceiverPanel game={game} />
            </>
          ) : (
            <>
              <ArchivePanel game={game} />
              <Codex />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefingOverlay({ onDone, lines, portrait, audio }: { onDone: () => void; lines: string[]; portrait: string; audio: string }) {
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    stopRef.current = playBriefing(audio);
    return () => stopRef.current();
  }, [audio]);
  return (
    <div className="overlay">
      <div className="overlay-box briefing" style={{ borderColor: '#4bcffa' }}>
        <img className="brief-portrait" src={portrait} alt="Transmission" />
        <h2 style={{ color: '#4bcffa' }}>INCOMING TRANSMISSION</h2>
        {lines.map((l, i) => <p key={i} className="brief-line">{l}</p>)}
        <div className="overlay-btns">
          <button className="start-btn small" onClick={() => { stopRef.current(); onDone(); }}>ACKNOWLEDGE</button>
        </div>
      </div>
    </div>
  );
}

function MusicButton() {
  const [on, setOn] = useState(isMusicOn());
  return (
    <button className={`tb-btn ${on ? 'on' : ''}`} title="Music on/off"
      onClick={() => { const v = !on; setMusic(v); setOn(v); }}>♪</button>
  );
}

function AfterAction({ game }: { game: Game }) {
  const s = game.runStats;
  const dmg = Object.entries(s.dmg).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxDmg = dmg[0]?.[1] ?? 1;
  const kills = Object.entries(s.kills).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const name = (id: string) => TOWERS.find((t) => t.id === id)?.name ?? ENEMIES[id]?.name ?? id;
  return (
    <div className="aar">
      <div className="aar-title">AFTER-ACTION REPORT</div>
      <div className="aar-cols">
        <div className="aar-col">
          <div className="aar-head">DAMAGE BY INSTRUMENT</div>
          {dmg.length === 0 && <div className="aar-row"><span>no shots fired</span></div>}
          {dmg.map(([id, v]) => (
            <div key={id} className="aar-row" title={`${Math.round(v)} damage`}>
              <span>{name(id)}</span>
              <div className="aar-bar"><div style={{ width: `${(v / maxDmg) * 100}%`, background: TOWERS.find((t) => t.id === id)?.glow ?? '#4bcffa' }} /></div>
            </div>
          ))}
        </div>
        <div className="aar-col">
          <div className="aar-head">HULLS DESTROYED</div>
          {kills.map(([id, v]) => (
            <div key={id} className="aar-row">
              <span>{name(id)}</span><b>{v}</b>
            </div>
          ))}
          <div className="aar-row dim"><span>Cores lost to leaks</span><b>{s.leaks}</b></div>
          <div className="aar-row dim"><span>Abilities invoked</span><b>{s.abilitiesCast}</b></div>
        </div>
      </div>
    </div>
  );
}

function CutsceneOverlay({ scene, onDone }: { scene: { img: string; title: string }; onDone: () => void }) {
  // any key, any click, or the button — a cutscene must never trap the player
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { ev.preventDefault(); onDone(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);
  return (
    <div className="cutscene-overlay" onClick={onDone}>
      <div className="cutscene-box">
        <div className="cutscene-title">{scene.title}</div>
        <img className="cutscene-img" src={scene.img} alt="" />
        <button className="start-btn small">CONTINUE ▶</button>
        <div className="hint-dim">click anywhere or press any key</div>
      </div>
    </div>
  );
}

function SubmitScore({ game, map, diff }: { game: Game; map: GameMap; diff: DifficultyDef }) {
  const [name, setName] = useState(progress.playerName);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [top, setTop] = useState<ScoreEntry[] | null>(null);
  const eligible = game.phase === 'victory' || game.phase === 'armistice' ||
    (game.phase === 'gameover' && game.freeplay);
  if (!eligible) return null;
  const board = boardId(map.id, diff.id, game.freeplay);

  const submit = async () => {
    const n = (name.trim() || 'WARDEN').slice(0, 20);
    progress.playerName = n;
    setState('busy');
    const ok = await submitScore(board, {
      name: n,
      cash: Math.round(game.runStats.cashEarned),
      kills: game.totalKills,
      wave: game.wave,
      freeplay: game.freeplay,
      ts: Date.now(),
    });
    if (ok) {
      setTop(await fetchTop(board));
      setState('done');
      sfx.upgrade();
    } else {
      setState('err');
    }
  };

  return (
    <div className="submit-score">
      <div className="aar-title">GLOBAL LEADERBOARD — {map.name.toUpperCase()} · {diff.name.toUpperCase()}{game.freeplay ? ' · FREEPLAY' : ''}</div>
      {state !== 'done' && (
        <div className="submit-row">
          <input className="name-input" maxLength={20} placeholder="CALLSIGN"
            value={name} onChange={(e) => setName(e.target.value)} />
          <span className="submit-stats">⌬{Math.round(game.runStats.cashEarned).toLocaleString()} · ☠{game.totalKills}{game.freeplay ? ` · W${game.wave}` : ''}</span>
          <button className="start-btn small" disabled={state === 'busy'} onClick={submit}>
            {state === 'busy' ? '…' : state === 'err' ? 'RETRY' : 'SUBMIT'}
          </button>
        </div>
      )}
      {state === 'done' && top && (
        <div className="lb-table">
          {top.map((r, i) => (
            <div key={i} className={`lb-row ${r.name === name.trim() ? 'me' : ''}`}>
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-name">{r.name}</span>
              <span className="lb-cash">⌬{r.cash.toLocaleString()}</span>
              <span className="lb-kills">☠{r.kills}</span>
              {r.freeplay && <span className="lb-wave">W{r.wave}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Overlay(props: { title: string; color: string; lines: string[]; buttons: { label: string; fn: () => void }[]; art?: string; report?: ReactNode }) {
  return (
    <div className="overlay">
      <div className="overlay-box" style={{ borderColor: props.color }}>
        {props.art && <img className="overlay-art" src={props.art} alt="" />}
        <h2 style={{ color: props.color }}>{props.title}</h2>
        {props.lines.map((l, i) => <p key={i}>{l}</p>)}
        {props.report}
        <div className="overlay-btns">
          {props.buttons.map((b) => (
            <button key={b.label} className="start-btn small" onClick={b.fn}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- Shop ----------------

function Shop({ game, placing, setPlacing }: {
  game: Game; placing: TowerDef | null; setPlacing: (d: TowerDef | null) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-title">ARSENAL</div>
      <div className="shop-grid">
        {TOWERS.map((def, i) => {
          const lockedBy = def.unlockAt - progress.totalWaves;
          if (lockedBy > 0) {
            return (
              <div key={def.id} className="shop-item shop-locked" title={`${def.name} — clear ${lockedBy} more wave${lockedBy === 1 ? '' : 's'} (any sector) to unlock`}>
                <div className="shop-lock-icon">🔒</div>
                <div className="shop-name">{def.name}</div>
                <div className="shop-cost">{lockedBy} waves to go</div>
              </div>
            );
          }
          const cost = game.cost(def);
          const afford = game.credits >= cost;
          return (
            <button
              key={def.id}
              className={`shop-item ${placing?.id === def.id ? 'active' : ''} ${afford ? '' : 'poor'}`}
              style={{ ['--tc' as string]: def.color, ['--tg' as string]: def.glow }}
              onClick={() => { sfx.click(); setPlacing(placing?.id === def.id ? null : def); }}
              title={def.desc}
            >
              <TowerIcon def={def} />
              <div className="shop-name">{def.name}</div>
              <div className="shop-foot">
                <span className="shop-cost">⌬{cost}</span>
                <span className={`shop-type t-${def.base.damageType}`}>{def.base.damageType}</span>
              </div>
              {i < 10 && <div className="shop-key">{(i + 1) % 10}</div>}
            </button>
          );
        })}
      </div>
      {placing ? (
        <div className="placing-hint">
          <b style={{ color: placing.glow }}>{placing.name}</b>
          <p>{placing.desc}</p>
        </div>
      ) : (
        <p className="hint-dim pad">1–9, 0 select · click map to build · Space launches</p>
      )}
      <div className="bp-row">
        <button className="tb-btn" disabled={game.towers.length === 0}
          title="Save the current layout (positions + upgrades) as this sector's blueprint"
          onClick={() => { game.saveBlueprint(); }}>
          ⬇ SAVE LAYOUT
        </button>
        <button className="tb-btn" disabled={progress.blueprint(game.map.id).length === 0}
          title="Rebuild the saved blueprint, placing and upgrading as far as credits allow"
          onClick={() => { game.applyBlueprint(); }}>
          ⬆ BUILD SAVED{progress.blueprint(game.map.id).length > 0 ? ` (${progress.blueprint(game.map.id).length})` : ''}
        </button>
      </div>
      <button
        className={`upgrade-btn bonus-up oc-btn ${game.credits >= game.overchargeCost() ? '' : 'poor'}`}
        title="Repeatable late-game sink: every level adds +8% damage to all towers for this run"
        onClick={() => { game.buyOvercharge(); }}
      >
        <div className="up-name">⚡ GRID OVERCHARGE {game.overcharge > 0 ? `Lv${game.overcharge}` : ''}</div>
        <div className="up-desc">All towers +8% damage, repeatable.{game.overcharge > 0 ? ` Active: +${game.overcharge * 8}%` : ''}</div>
        <div className="up-cost">⌬{game.overchargeCost().toLocaleString()}</div>
      </button>
    </div>
  );
}

function TowerIcon({ def }: { def: TowerDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.scale(1.25, 1.25);
    drawTowerBody(ctx, { x: 24, y: 24 }, def, -Math.PI / 2, 0, 0, 1, 0, 1);
    ctx.restore();
  }, [def]);
  return <canvas ref={ref} width={60} height={60} className="tower-icon" />;
}

// ---------------- Upgrade panel ----------------

function TrackColumn({ game, tower, track }: { game: Game; tower: Tower; track: 0 | 1 }) {
  const tr = tower.def.tracks[track];
  const tier = game.tierOf(tower, track);
  const state = game.upgradeState(tower, track);
  const next = tier < 6 ? tr.upgrades[tier] : null;
  const cost = game.upgradeCost(tower, track);
  const isBonusNext = tier >= 4;
  return (
    <div className={`track-col ${track === 1 ? 'track-b' : ''}`}>
      <div className="track-name">{tr.name}</div>
      <div className="tier-track">
        {tr.upgrades.map((up, i) => (
          <div key={up.name} className={`tier-pip ${i < tier ? 'owned' : ''} ${i >= 4 ? 'bonus' : ''}`} title={`${up.name} — ${up.desc}`} />
        ))}
      </div>
      {state === 'maxed' && <div className="maxed small-max">★ MAXED ★</div>}
      {state === 'locked' && <div className="track-locked">Committed to {tower.def.tracks[tower.committed!].name}</div>}
      {state === 'ok' && next && (
        <button
          className={`upgrade-btn track-btn ${game.credits >= cost ? '' : 'poor'} ${isBonusNext ? 'bonus-up' : ''}`}
          title={isBonusNext && tower.committed === null ? 'BONUS TIER — buying this commits the tower to this track!' : next.desc}
          onClick={() => { game.upgradeTower(tower, track); }}
        >
          <div className="up-name">{isBonusNext ? '✦' : '▲'} {next.name}</div>
          <div className="up-desc">{next.desc}</div>
          <div className="up-cost">⌬{cost}</div>
        </button>
      )}
    </div>
  );
}

function UpgradePanel({ game, tower, onSold }: { game: Game; tower: Tower; onSold: () => void }) {
  const def = tower.def;
  const s = tower.stats;
  const rank = Game.rankOf(tower);
  return (
    <div className="panel tower-detail" style={{ borderColor: def.color }}>
      <button className="back-btn" onClick={() => { onSold(); sfx.click(); }}>← ALL TOWERS</button>
      <div className="panel-title" style={{ color: def.glow }}>
        {def.name}
        {(tower.tierA >= 5 || tower.tierB >= 5) && <span className="rank-stars"> ✦ASCENDED</span>}
        {rank > 0 && (
          <span className="rank-stars" title={`Veterancy rank ${rank}: +${rank * 6}% damage (earned from kills)`}>
            {' '}{'★'.repeat(rank)}
          </span>
        )}
      </div>
      <div className="stat-rows">
        <Stat label="Damage" value={s.damage > 0 ? `${s.damage} ${s.damageType}` : '—'} />
        <Stat label="Rate" value={s.fireRate > 0 ? `${(s.fireRate * tower.rateBuff).toFixed(2)}/s` : 'aura'} />
        <Stat label="Range" value={s.range > 2000 ? '∞' : Math.round(s.range * tower.rangeBuff).toString()} />
        {s.pierce > 1 && s.pierce < 90 && <Stat label="Pierce" value={`${s.pierce}`} />}
        {s.splash > 0 && <Stat label="Blast" value={`${Math.round(s.splash)}`} />}
        {s.slowPower > 0 && <Stat label="Slow" value={`${Math.round(s.slowPower * 100)}%`} />}
        {s.detection && <Stat label="Sensors" value="cloak detect" />}
        <Stat label="Kills" value={`${tower.kills}`} />
        <Stat label="Invested" value={`⌬${tower.invested}`} />
      </div>
      <p className="lore-line">“{def.lore}”</p>

      <div className="track-row">
        <TrackColumn game={game} tower={tower} track={0} />
        <TrackColumn game={game} tower={tower} track={1} />
      </div>
      {tower.committed === null && (tower.tierA >= 4 || tower.tierB >= 4) && (
        <p className="hint-dim">✦ Bonus tiers are exclusive — the first one you buy locks the other track's bonuses.</p>
      )}

      <div className="panel-title small">TARGETING</div>
      <div className="target-row">
        {TARGET_MODES.map((m) => (
          <button key={m} className={`tb-btn ${tower.target === m ? 'on' : ''}`}
            onClick={() => { game.setTargetMode(tower, m); sfx.click(); }}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      <button className="sell-btn" onClick={() => { game.sellTower(tower); onSold(); }}>
        SELL FOR ⌬{sellValue(tower.invested)}
      </button>
      <p className="hint-dim pad">Esc or right-click to deselect.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span className="stat-val">{value}</span>
    </div>
  );
}

// ---------------- The Diplomat's Gambit ----------------

function ReceiverPanel({ game }: { game: Game }) {
  if (game.receiver) {
    return (
      <div className="panel receiver listening">
        <div className="panel-title" style={{ color: '#ffd32a' }}>📡 RECEIVER LISTENING</div>
        <p className="hint-dim">Towers at 75% rate. The next LEVIATHAN to enter the corridor will hail instead of fight. Let it through.</p>
      </div>
    );
  }
  if (!game.canBuildReceiver()) return null;
  return (
    <div className="panel receiver">
      <div className="panel-title" style={{ color: '#ffd32a' }}>THE DIPLOMAT'S GAMBIT</div>
      <p className="hint-dim">{RECEIVER_DESC}</p>
      <button
        className={`upgrade-btn receiver-btn ${game.credits >= RECEIVER_COST ? '' : 'poor'}`}
        onClick={() => { game.buildReceiver(); }}
      >
        <div className="up-name">📡 Build the Antique Receiver</div>
        <div className="up-desc">Command votes no. The Continuity votes yes.</div>
        <div className="up-cost">⌬{RECEIVER_COST}</div>
      </button>
    </div>
  );
}

// ---------------- Archive ----------------

function ArchivePanel({ game }: { game: Game }) {
  const [open, setOpen] = useState(true);
  const fresh = game.newArchive;
  return (
    <div className="panel codex">
      <button className={`panel-title btn ${fresh && !open ? 'archive-fresh' : ''}`}
        onClick={() => { setOpen(!open); game.newArchive = false; sfx.click(); }}>
        ARCHIVE {game.archive.length}/{ARCHIVE.length} {fresh && !open ? '✦' : open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="codex-list">
          {ARCHIVE.map((f, i) => (
            game.archive.includes(i) ? (
              <div key={i} className="archive-frag">
                {f.art && <img className="archive-art" src={f.art} alt="" />}
                <div className="archive-title">
                  <button className="frag-play" title="Listen" onClick={() => { playNarration(i); }}>▶</button>
                  {f.title}
                </div>
                <div className="archive-text">{f.text}</div>
              </div>
            ) : (
              <div key={i} className="archive-frag locked">
                <div className="archive-title">▒▒▒▒▒▒▒▒▒▒</div>
                <div className="archive-text">Recovered after wave {f.wave}.</div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Codex ----------------

function Codex() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel codex">
      <button className="panel-title btn" onClick={() => { setOpen(!open); sfx.click(); }}>
        THREAT CODEX {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="codex-list">
          {Object.values(ENEMIES).map((e) => (
            <div key={e.id} className="codex-entry">
              <div className="codex-row">
                <span className="codex-dot" style={{ background: e.color, boxShadow: `0 0 6px ${e.glow}` }} />
                <span className="codex-name">{e.name}</span>
                <span className="codex-tags">
                  {e.hp > 1 ? `${e.hp}hp ` : ''}
                  {e.armored ? '🛡armored ' : ''}
                  {e.immuneExplosive ? '⊘blast ' : ''}
                  {e.immuneCryo ? '⊘cryo ' : ''}
                  {e.boss ? '☠BOSS' : ''}
                </span>
              </div>
              <div className="codex-lore">{e.lore}</div>
            </div>
          ))}
          <p className="hint-dim">Armored hulls ignore kinetic fire (use energy, blasts, or AP rounds). Cloaked signatures need sensor towers or an EMP Spire.</p>
        </div>
      )}
    </div>
  );
}
