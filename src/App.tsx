import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import './App.css';
import { ALL_MAPS, MAPS, DIFFICULTIES } from './game/maps';
import { progress } from './game/storage';
import { needsAgeGate } from './game/consent';
import { buildAIHelpContext } from './game/aiContext';
import { appMetrics } from './game/metrics';
import { dailyChallenge, dailyChallengeSignature, loadRemoteDailyOverride } from './game/dailyChallenge';
import {
  loadRemoteWeeklyGauntlet,
  loadRemoteWeeklyOverride,
  weeklyChallenge,
  weeklyChallengeSignature,
  type WeeklyGauntletDoc,
} from './game/weeklyChallenge';

import { sfx } from './game/sound';
import { watchBuildFreshness } from './buildFreshness';
import Modal from './Modal';
import { meta } from './game/meta';
import type { GameMap, DifficultyDef } from './game/types';
import { isAdmin } from './game/admin';
import AgeGate from './AgeGate';
import { PERF_PARAMS, PERF_MAP, DEMO_MODE, AI_HELP_ENABLED, isRunId } from './appShared';
import { AIHelpWidget } from './widgets/AIHelpWidget';
import { FeedbackWidget } from './widgets/FeedbackWidget';
import { MainMenu } from './menu/MainMenu';
import { GameScreen } from './game-ui/GameScreen';
import { portal } from './game/portal';
// Lazy: the 2,900-line dashboard + admin auth SDK are code-split off the player path,
// loaded only on the /admin route. PrivacyView is lazy too (rare /privacy route).
const AdminDashboard = lazy(() => import('./AdminDashboard'));
const PrivacyView = lazy(() => import('./PrivacyView'));
// Battle Plan replay viewer — public read-only surface, code-split off the player path.
const ReplayViewer = lazy(() => import('./ReplayViewer'));

type Screen = 'menu' | 'game';

// Unlinked owner console route; real access control is Firebase Auth + rules.
const ADMIN = isAdmin();

function isPrivacyRoute(): boolean {
  return typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === '/privacy';
}

// ?run=<runId> deep link → Battle Plan viewer (served by the **→index.html rewrite).
function runIdFromUrl(): string | null {
  const id = PERF_PARAMS.get('run');
  return isRunId(id) ? id : null;
}

function RouteFallback({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100svh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--accent)',
        fontFamily: 'Orbitron, sans-serif',
        fontSize: 13,
        letterSpacing: 1.4,
      }}
    >
      {label}
    </div>
  );
}

export default function App() {
  if (ADMIN) return <Suspense fallback={<RouteFallback label="LOADING OPERATIONS" />}><AdminDashboard /></Suspense>;
  if (isPrivacyRoute()) return <Suspense fallback={<RouteFallback label="LOADING PRIVACY" />}><PrivacyView /></Suspense>;
  // Public, read-only replay — writes nothing, so it bypasses the AgeGate like /privacy.
  const watchId = runIdFromUrl();
  if (watchId) return <Suspense fallback={<RouteFallback label="LOADING REPLAY" />}><ReplayViewer runId={watchId} onExit={() => { location.href = '/'; }} /></Suspense>;
  return <Gate />;
}

// Neutral age gate blocks first paint until answered (COPPA). perf/demo bypass it —
// they never post player-attributed data, and the consent module defaults them to
// the restricted tier anyway. A child component so the hook isn't conditional on ADMIN.
function Gate() {
  const bypassGate = PERF_MAP !== null || DEMO_MODE;
  const [gated, setGated] = useState(!bypassGate && needsAgeGate());
  if (gated) return <AgeGate onDone={() => setGated(false)} />;
  return <Main />;
}

function Main() {
  const [screen, setScreen] = useState<Screen>(PERF_MAP !== null ? 'game' : 'menu');
  const [map, setMap] = useState<GameMap>(ALL_MAPS.find((m) => m.id === PERF_MAP) ?? MAPS[0]);
  const [diff, setDiff] = useState<DifficultyDef>(
    DIFFICULTIES.find((d) => d.id === PERF_PARAMS.get('diff'))
    ?? (progress.record.runs < 1 ? DIFFICULTIES[0] : DIFFICULTIES[1]));
  const [dailySeed, setDailySeed] = useState(() => dailyChallenge());
  const [weeklySeed, setWeeklySeed] = useState(() => weeklyChallenge());
  const [gauntlet, setGauntlet] = useState<WeeklyGauntletDoc | null>(null);
  const [runMode, setRunMode] = useState<'campaign' | 'daily' | 'weekly' | 'gauntlet'>('campaign');
  const [comeback, setComeback] = useState(false);
  const [staleBuild, setStaleBuild] = useState(false);
  useEffect(() => {
    if (!portal.isPortal) return;
    portal.loadingStart();
    void portal.init();
  }, []);
  useEffect(() => {
    if (portal.isPortal && screen === 'menu') portal.loadingFinished();
  }, [screen]);
  useEffect(() => { progress.markSession(); }, []);
  // Installed/PWA users can linger on a stale cached bundle; offer a reload
  // when a newer deploy is detected. Shown on the menu only — never mid-run.
  useEffect(() => watchBuildFreshness(() => setStaleBuild(true)), []);
  useEffect(() => {
    if (DEMO_MODE || PERF_MAP !== null) return;
    const refreshDailySeed = () => {
      const next = dailyChallenge();
      setDailySeed((prev) => (dailyChallengeSignature(prev) === dailyChallengeSignature(next) ? prev : next));
    };
    void loadRemoteDailyOverride().then(refreshDailySeed);
    const refreshWeeklySeed = () => {
      const next = weeklyChallenge();
      setWeeklySeed((prev) => (weeklyChallengeSignature(prev) === weeklyChallengeSignature(next) ? prev : next));
    };
    void loadRemoteWeeklyOverride().then(refreshWeeklySeed);
    void loadRemoteWeeklyGauntlet().then(setGauntlet);
    const onVisibility = () => { if (!document.hidden) refreshDailySeed(); };
    const refreshFromNetwork = () => {
      void loadRemoteDailyOverride().then(refreshDailySeed);
      void loadRemoteWeeklyOverride().then(refreshWeeklySeed);
      void loadRemoteWeeklyGauntlet().then(setGauntlet);
    };
    const timer = window.setInterval(refreshFromNetwork, 60_000);
    window.addEventListener('focus', refreshFromNetwork);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshFromNetwork);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  useEffect(() => {
    if (DEMO_MODE || PERF_MAP !== null) return;
    const today = new Date().toISOString().slice(0, 10);
    const s = meta.streak;
    if (s.brokenYesterday && meta.comebackSeenFor !== today) setComeback(true);
  }, []);
  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    appMetrics.recordDisplayMode(standalone);
    const onInstallPrompt = () => appMetrics.recordInstallPromptSeen();
    const onInstalled = () => appMetrics.recordInstalled();
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  const startCampaign = () => {
    setRunMode('campaign');
    sfx.click();
    portal.gameplayStart();
    setScreen('game');
  };
  const startDaily = () => {
    appMetrics.recordDeployAttempt(dailySeed.mapId, dailySeed.diffId, true);
    setMap(ALL_MAPS.find((m) => m.id === dailySeed.mapId) ?? MAPS[0]);
    setDiff(DIFFICULTIES.find((d) => d.id === dailySeed.diffId) ?? DIFFICULTIES[1]);
    setRunMode('daily');
    sfx.click();
    portal.gameplayStart();
    setScreen('game');
  };
  const startWeekly = () => {
    appMetrics.recordDeployAttempt(weeklySeed.mapId, weeklySeed.diffId, true);
    setMap(ALL_MAPS.find((m) => m.id === weeklySeed.mapId) ?? MAPS[0]);
    setDiff(DIFFICULTIES.find((d) => d.id === weeklySeed.diffId) ?? DIFFICULTIES[1]);
    setRunMode('weekly');
    sfx.click();
    portal.gameplayStart();
    setScreen('game');
  };
  const startGauntlet = () => {
    if (!gauntlet) return;
    setMap(ALL_MAPS.find((m) => m.id === gauntlet.map) ?? MAPS[0]);
    setDiff(DIFFICULTIES.find((d) => d.id === gauntlet.diff) ?? DIFFICULTIES[1]);
    setRunMode('gauntlet');
    sfx.click();
    portal.gameplayStart();
    setScreen('game');
  };
  const exitGame = useCallback(() => {
    portal.gameplayStop();
    setRunMode('campaign');
    setScreen('menu');
  }, []);

  return (
    <>
      {screen === 'menu'
        ? <MainMenu map={map} diff={diff} setMap={setMap} setDiff={setDiff}
            dailySeed={dailySeed} weeklySeed={weeklySeed} gauntlet={gauntlet}
            onStart={startCampaign} onStartDaily={startDaily} onStartWeekly={startWeekly} onStartGauntlet={startGauntlet} />
        : <GameScreen
            map={map}
            diff={diff}
            dailySeed={runMode === 'daily' ? dailySeed : null}
            weeklySeed={runMode === 'weekly' ? weeklySeed : null}
            gauntlet={runMode === 'gauntlet' ? gauntlet : null}
            onExit={exitGame}
          />}
      {AI_HELP_ENABLED && screen === 'menu' && (
        <AIHelpWidget getContext={() => buildAIHelpContext({ screen: 'menu', map, diff })} />
      )}
      {screen === 'menu' && <FeedbackWidget ctx="menu" />}
      {comeback && screen === 'menu' && (
        <ComebackPrompt onClose={() => { meta.markComebackSeen(new Date().toISOString().slice(0, 10)); setComeback(false); sfx.click(); }} />
      )}
      {staleBuild && screen === 'menu' && (
        <div className="update-toast" role="status" aria-live="polite" data-testid="update-toast">
          <span>A new build of Lantern Seven is live.</span>
          <button className="start-btn small" onClick={() => window.location.reload()}>RELOAD ▸</button>
          <button className="update-toast-x" aria-label="Dismiss update notice" onClick={() => setStaleBuild(false)}>✕</button>
        </div>
      )}
    </>
  );
}

function ComebackPrompt({ onClose }: { onClose: () => void }) {
  const streak = meta.streak;
  return (
    <Modal onClose={onClose} overlayClass="cutscene-overlay" boxClass="cutscene-box tip-box" labelledBy="comeback-title">
      <div className="cutscene-title" id="comeback-title" style={{ color: 'var(--gold)' }}>⚠ THE LANTERN DIMMED</div>
      <p className="tip-text">
        You held a <b>{streak.best}-day watch</b> over Lantern Seven before the signal lapsed.
        The Combine never sleeps, Warden — light the beacon again today to start a new streak.
      </p>
      <button className="start-btn small" onClick={onClose}>RESUME THE WATCH ▸</button>
    </Modal>
  );
}
