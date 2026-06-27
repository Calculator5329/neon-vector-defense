import { memo, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './App.css';
import { Game, W, H } from './game/engine';
import { render, drawTowerBody, setRenderQuality } from './game/render';
import { TOWERS, TOWERS_BY_UNLOCK, sellValue } from './game/towers';
import { ALL_MAPS, MAPS, DIFFICULTIES } from './game/maps';
import { ENEMIES } from './game/enemies';
import { ABILITIES } from './game/abilities';
import { BRIEFING, LONGWATCH_BRIEFING, ABILITY_LORE, RECEIVER_DESC, ARMISTICE_LINES } from './game/lore';
import { RECEIVER_COST } from './game/engine';
import { progress } from './game/storage';
import { Bot } from './game/bot';
import { isMilestoneWave } from './game/writePolicy';
import { needsAgeGate } from './game/consent';
import {
  boardId,
  submitScore,
  submitDailyScore,
  fetchTop,
  fetchDailyTop,
  fetchGlobalTop,
  submitRunReplay,
  submitRunAnalytics,
  submitRunCheckpoint,
  submitFeedback,
  fetchFeedbackReplies,
  logTelemetry,
  TELEMETRY_BUILD,
  type FeedbackReply,
  type ScoreEntry,
  type RankedScoreEntry,
} from './game/leaderboard';
import type { RunCheckpointReason } from './game/runTelemetry';
import { askAIHelp } from './game/aiHelp';
import { buildAIHelpContext, type AIHelpContext } from './game/aiContext';
import { appMetrics, METRIC_EVENTS } from './game/metrics';
import {
  FREEPLAY_CONTRACTS,
  dailyFreeplaySeed,
  rivalForWave,
  type DailyFreeplaySeed,
  type FreeplayContractId,
  type FreeplayRelicId,
  type RiskWaveId,
} from './game/freeplay';

import { sfx, setMuted, isMuted, setMusic, isMusicOn, playBriefing, playSectorTheme, MUSIC_PACKS, getMusicPack, setMusicPack } from './game/sound';
import { applyAccessibility } from './game/settings';
import DossierShare from './DossierShare';
import BotGhostHud from './BotGhostHud';
import OperationsBoard from './OperationsBoard';
import { meta, type RunMetaReward } from './game/meta';
import { buildGhostCurves, ghostCurveFor, judgeRun, type GhostCurve } from './game/ghostCurve';
import { GHOST_CURVES_RAW } from './game/ghostCurveData';
import { buildDossierInputFromGame, type DossierInput } from './game/dossier';
import type { GameMap, DifficultyDef, TowerDef, Tower, TargetMode, Vec } from './game/types';
import { isAdmin } from './game/admin';
import AgeGate from './AgeGate';
// Lazy: the 2,900-line dashboard + admin auth SDK are code-split off the player path,
// loaded only on the /admin route. PrivacyView is lazy too (rare /privacy route).
const AdminDashboard = lazy(() => import('./AdminDashboard'));
const PrivacyView = lazy(() => import('./PrivacyView'));
// Battle Plan replay viewer — public read-only surface, code-split off the player path.
const ReplayViewer = lazy(() => import('./ReplayViewer'));

type Screen = 'menu' | 'game';
const TARGET_MODES: TargetMode[] = ['first', 'last', 'strong', 'close'];
const WIDGET_OPEN_EVENT = 'nvd-widget-open-change';

// browser perf harness: /?perf=<mapId>&diff=<diffId> auto-runs the expert bot at 4x
// with rendering on and a live FPS meter. Example: /?perf=throat&diff=hard
const PERF_PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const PERF_MAP = PERF_PARAMS.get('perf');
const DEMO_MODE = PERF_PARAMS.get('demo') === '1';
const AI_HELP_ENABLED = Boolean(import.meta.env.VITE_AI_HELP_URL);
const DEMO_UNLOCK_KILLS = Math.max(...TOWERS_BY_UNLOCK.map((tower) => tower.unlockAt));
// Bot-rival ghost curves (matched-difficulty AI cores pace), built once from the bundled asset.
const GHOST_CURVES: GhostCurve[] = buildGhostCurves(GHOST_CURVES_RAW);

// Unlinked owner console route; real access control is Firebase Auth + rules.
const ADMIN = isAdmin();

function utilityWidgetOpen(): boolean {
  return document.body.classList.contains('ai-open') || document.body.classList.contains('fb-open');
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function liveUnlockKills(game: Game): number {
  if (game.isDailyFreeplay) return DEMO_UNLOCK_KILLS;
  return DEMO_MODE ? DEMO_UNLOCK_KILLS : progress.record.kills + game.totalKills;
}

function towerAvailable(game: Game, def: TowerDef): boolean {
  return DEMO_MODE || game.towerAvailable(def);
}

function towerLockText(game: Game, def: TowerDef): string {
  if (game.isDailyFreeplay) return `${def.name} is not in today's Daily arsenal`;
  const lockedBy = Math.max(1, def.unlockAt - liveUnlockKills(game));
  return `${def.name} locked - destroy ${lockedBy.toLocaleString()} more hostiles`;
}

function isPrivacyRoute(): boolean {
  return typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === '/privacy';
}

const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;
function isRunId(id: string | null | undefined): id is string {
  return !!id && RUN_ID_RE.test(id);
}
// ?run=<runId> deep link → Battle Plan viewer (served by the **→index.html rewrite).
function runIdFromUrl(): string | null {
  const id = PERF_PARAMS.get('run');
  return isRunId(id) ? id : null;
}

export default function App() {
  if (ADMIN) return <Suspense fallback={null}><AdminDashboard /></Suspense>;
  if (isPrivacyRoute()) return <Suspense fallback={null}><PrivacyView /></Suspense>;
  // Public, read-only replay — writes nothing, so it bypasses the AgeGate like /privacy.
  const watchId = runIdFromUrl();
  if (watchId) return <Suspense fallback={null}><ReplayViewer runId={watchId} onExit={() => { location.href = '/'; }} /></Suspense>;
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
  const [dailySeed] = useState(() => dailyFreeplaySeed());
  const [dailyMode, setDailyMode] = useState(false);
  const [comeback, setComeback] = useState(false);
  useEffect(() => { progress.markSession(); }, []);
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
    setDailyMode(false);
    sfx.click();
    setScreen('game');
  };
  const startDaily = () => {
    appMetrics.recordDeployAttempt(dailySeed.mapId, dailySeed.diffId, true);
    setMap(ALL_MAPS.find((m) => m.id === dailySeed.mapId) ?? MAPS[0]);
    setDiff(DIFFICULTIES.find((d) => d.id === dailySeed.diffId) ?? DIFFICULTIES[1]);
    setDailyMode(true);
    sfx.click();
    setScreen('game');
  };

  return (
    <>
      {screen === 'menu'
        ? <MainMenu map={map} diff={diff} setMap={setMap} setDiff={setDiff}
            dailySeed={dailySeed} onStart={startCampaign} onStartDaily={startDaily} />
        : <GameScreen map={map} diff={diff} dailySeed={dailyMode ? dailySeed : null} onExit={() => { setDailyMode(false); setScreen('menu'); }} />}
      {AI_HELP_ENABLED && screen === 'menu' && (
        <AIHelpWidget getContext={() => buildAIHelpContext({ screen: 'menu', map, diff })} />
      )}
      {screen === 'menu' && <FeedbackWidget ctx="menu" />}
      {comeback && screen === 'menu' && (
        <ComebackPrompt onClose={() => { meta.markComebackSeen(new Date().toISOString().slice(0, 10)); setComeback(false); sfx.click(); }} />
      )}
    </>
  );
}

function ComebackPrompt({ onClose }: { onClose: () => void }) {
  const streak = meta.streak;
  return (
    <div className="cutscene-overlay" onClick={onClose}>
      <div className="cutscene-box tip-box" onClick={(e) => e.stopPropagation()}>
        <div className="cutscene-title" style={{ color: '#ffd32a' }}>⚠ THE LANTERN DIMMED</div>
        <p className="tip-text">
          You held a <b>{streak.best}-day watch</b> over Lantern Seven before the signal lapsed.
          The Combine never sleeps, Warden — light the beacon again today to start a new streak.
        </p>
        <button className="start-btn small" onClick={onClose}>RESUME THE WATCH ▸</button>
      </div>
    </div>
  );
}

// ---------------- AI help (menu-only, rate-limited server side) ----------------

type AIChatMessage = { role: 'assistant' | 'user'; content: string };

function AIHelpWidget({
  getContext,
  placement = 'menu',
  blocked = false,
  sideOpen = false,
}: {
  getContext: () => AIHelpContext;
  placement?: 'menu' | 'game';
  blocked?: boolean;
  sideOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [turnsRemaining, setTurnsRemaining] = useState<number | null>(null);
  const [conversationsRemaining, setConversationsRemaining] = useState<number | null>(null);
  const [messages, setMessages] = useState<AIChatMessage[]>([
    { role: 'assistant', content: 'Ask me about towers, waves, hidden hulls, unlocks, controls, or your last run.' },
  ]);

  const send = async () => {
    const q = text.trim();
    if (!q || state === 'busy') return;
    setText('');
    setState('busy');
    setMessages((m) => [...m, { role: 'user', content: q }]);
    appMetrics.recordAIQuestion('submit');
    try {
      const res = await askAIHelp(q, conversationId, getContext(), messages);
      setConversationId(res.conversationId);
      setTurnsRemaining(res.turnsRemaining);
      setConversationsRemaining(res.conversationsRemaining);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      appMetrics.recordAIQuestion('success');
      sfx.click();
    } catch (error) {
      appMetrics.recordAIQuestion(error instanceof Error && /quota|limit|turns|chats/i.test(error.message) ? 'quota' : 'error');
      setMessages((m) => [...m, {
        role: 'assistant',
        content: error instanceof Error ? error.message : 'AI uplink is unavailable.',
      }]);
    } finally {
      setState('idle');
    }
  };

  const startNew = () => {
    setConversationId(undefined);
    setTurnsRemaining(null);
    setMessages([{ role: 'assistant', content: 'New uplink ready. What do you want to know about this run?' }]);
    sfx.click();
  };
  useEffect(() => {
    if (blocked && open) setOpen(false);
  }, [blocked, open]);
  useEffect(() => {
    document.body.classList.toggle('ai-open', open);
    appMetrics.recordAIWidget(open, placement);
    window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'ai', open } }));
    return () => {
      document.body.classList.remove('ai-open');
      window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'ai', open: false } }));
    };
  }, [open, placement]);

  return (
    <div
      className={`ai-root ${placement === 'game' ? 'in-game' : 'on-menu'} ${placement === 'game' ? (sideOpen ? 'sidebar-open' : 'sidebar-collapsed') : ''} ${blocked ? 'widget-blocked' : ''}`}
      data-testid="ai-widget"
    >
      {open && (
        <div className="ai-panel">
          <div className="ai-head">
            <span>WARDEN AI</span>
            <div className="ai-head-actions">
              <button className="ai-new" aria-label="Start new Warden AI chat" onClick={startNew}>NEW</button>
              <button className="ai-x" aria-label="Close Warden AI" onClick={() => { setOpen(false); sfx.click(); }}>x</button>
            </div>
          </div>
          <div className="ai-log">
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>{m.content}</div>
            ))}
            {state === 'busy' && <div className="ai-msg assistant">Thinking...</div>}
          </div>
          <form className="ai-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input
              className="ai-input"
              maxLength={900}
              aria-label="Ask Warden AI about the game"
              placeholder="Ask about the game..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="ai-send" aria-label="Send question to Warden AI" disabled={!text.trim() || state === 'busy'}>SEND</button>
          </form>
          {(turnsRemaining !== null || conversationsRemaining !== null) && (
            <div className="ai-quota">
              {turnsRemaining !== null && <span>{turnsRemaining} turns left</span>}
              {conversationsRemaining !== null && <span>{conversationsRemaining} chats left</span>}
            </div>
          )}
        </div>
      )}
      <button className="ai-toggle" title="Ask Warden AI" aria-label="Ask Warden AI" aria-expanded={open} onClick={() => { setOpen((o) => !o); sfx.click(); }}>
        AI
      </button>
    </div>
  );
}

// ---------------- Feedback (always available, anonymous) ----------------

const FEEDBACK_IDS_KEY = 'nvd-feedback-ids-v1';
const FEEDBACK_READ_KEY = 'nvd-feedback-read-v1';
const FEEDBACK_DISMISSED_KEY = 'nvd-feedback-dismissed-v1';

function loadFeedbackIds(): string[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_IDS_KEY);
    return raw ? JSON.parse(raw).filter((id: unknown) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveFeedbackId(id: string) {
  const ids = [...loadFeedbackIds().filter((x) => x !== id), id].slice(-20);
  try { localStorage.setItem(FEEDBACK_IDS_KEY, JSON.stringify(ids)); } catch { /* non-fatal */ }
}

function feedbackReadAt(): number {
  try { return Number(localStorage.getItem(FEEDBACK_READ_KEY) ?? 0); } catch { return 0; }
}

function markFeedbackRead(ts: number) {
  try { localStorage.setItem(FEEDBACK_READ_KEY, String(ts)); } catch { /* non-fatal */ }
}

function loadDismissedReplyIds(): string[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_DISMISSED_KEY);
    return raw ? JSON.parse(raw).filter((id: unknown) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveDismissedReplyIds(ids: string[]) {
  try { localStorage.setItem(FEEDBACK_DISMISSED_KEY, JSON.stringify([...new Set(ids)].slice(-50))); } catch { /* non-fatal */ }
}

function FeedbackWidget({ ctx, blocked = false, sideOpen = false }: { ctx: string; blocked?: boolean; sideOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'send'>('send');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [replies, setReplies] = useState<FeedbackReply[]>([]);
  const [readAt, setReadAt] = useState(() => feedbackReadAt());
  const [dismissedReplies, setDismissedReplies] = useState<string[]>(() => loadDismissedReplyIds());
  const [checkingReplies, setCheckingReplies] = useState(false);
  const MAX = 1000;
  const refreshReplies = useCallback(async () => {
    setCheckingReplies(true);
    const rows = await fetchFeedbackReplies(loadFeedbackIds());
    rows.sort((a, b) => b.replyTs - a.replyTs);
    setReplies(rows);
    setCheckingReplies(false);
  }, []);
  useEffect(() => {
    if (PERF_MAP !== null) return;
    const intervalMs = open ? 15000 : 60000;
    if (open || !document.body.classList.contains('game-active')) void refreshReplies();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (!open && document.body.classList.contains('game-active')) return;
      void refreshReplies();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [open, refreshReplies]);
  useEffect(() => {
    if (!open || replies.length === 0) return;
    const newest = Math.max(...replies.map((r) => r.replyTs));
    if (newest > readAt) {
      appMetrics.recordFeedbackReplyViewed(replies.filter((r) => r.replyTs > readAt).length);
      markFeedbackRead(newest);
      setReadAt(newest);
    }
  }, [open, readAt, replies]);
  useEffect(() => {
    if (blocked && open) setOpen(false);
  }, [blocked, open]);
  useEffect(() => {
    document.body.classList.toggle('fb-open', open);
    appMetrics.recordFeedbackWidget(open, ctx);
    window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'feedback', open } }));
    return () => {
      document.body.classList.remove('fb-open');
      window.dispatchEvent(new CustomEvent(WIDGET_OPEN_EVENT, { detail: { kind: 'feedback', open: false } }));
    };
  }, [ctx, open]);
  if (PERF_MAP !== null) return null; // not during perf runs
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setState('busy');
    const id = await submitFeedback(t, ctx);
    if (!id) {
      appMetrics.recordFeedbackSubmit(false);
      setState('err');
      sfx.error();
      return;
    }
    appMetrics.recordFeedbackSubmit(true);
    saveFeedbackId(id);
    setState('done');
    setText('');
    void refreshReplies();
    setTab('inbox');
    setTimeout(() => setState('idle'), 2200);
  };
  const visibleReplies = replies.filter((r) => !dismissedReplies.includes(r.id));
  const unread = visibleReplies.filter((r) => r.replyTs > readAt).length;
  const dismissedCount = replies.length - visibleReplies.length;
  const sentCount = loadFeedbackIds().length;
  const dismissReply = (id: string) => {
    const next = [...dismissedReplies, id];
    setDismissedReplies(next);
    saveDismissedReplyIds(next);
    sfx.click();
  };
  const restoreReplies = () => {
    setDismissedReplies([]);
    saveDismissedReplyIds([]);
    sfx.click();
  };
  return (
    <div
      className={`fb-root ${ctx === 'menu' ? 'on-menu' : 'on-game'} ${ctx === 'game' ? (sideOpen ? 'sidebar-open' : 'sidebar-collapsed') : ''} ${blocked ? 'widget-blocked' : ''}`}
      data-testid="message-widget"
    >
      {open && (
        <div className="fb-panel">
          <div className="fb-head">
            <span>MESSAGES</span>
            <button className="fb-x" aria-label="Close messages" onClick={() => { setOpen(false); sfx.click(); }}>✕</button>
          </div>
          <div className="fb-tabs">
            <button className={tab === 'inbox' ? 'on' : ''} onClick={() => { setTab('inbox'); sfx.click(); }}>
              INBOX{unread > 0 ? ` ${unread}` : ''}
            </button>
            <button className={tab === 'send' ? 'on' : ''} onClick={() => { setTab('send'); sfx.click(); }}>SEND</button>
          </div>
          {tab === 'inbox' && <div className="fb-replies">
            <div className="fb-section-row">
              <div className="fb-section-title">ADMIN REPLIES</div>
              <button className="fb-check" aria-label="Check for admin replies" disabled={checkingReplies} onClick={() => { void refreshReplies(); sfx.click(); }}>
                {checkingReplies ? 'CHECKING' : 'CHECK'}
              </button>
            </div>
            {visibleReplies.length > 0 ? (
              visibleReplies.slice(0, 4).map((r) => (
                <div key={r.id} className="fb-reply">
                  <div className="fb-reply-meta">
                    <span>{new Date(r.replyTs).toLocaleString()} / {r.ctx}</span>
                    <button className="fb-dismiss" title="Dismiss reply" aria-label="Dismiss admin reply" onClick={() => dismissReply(r.id)}>DISMISS</button>
                  </div>
                  <div className="fb-reply-body">{r.reply}</div>
                  <div className="fb-reply-quote">You: {r.text}</div>
                </div>
              ))
            ) : (
              <div className="fb-no-replies">
                {dismissedCount > 0
                  ? 'All admin replies are dismissed on this browser.'
                  : sentCount === 0
                    ? 'No messages sent from this browser yet.'
                    : 'No admin replies yet. Replies will appear here and the message icon will light up.'}
              </div>
            )}
            {dismissedCount > 0 && (
              <button className="fb-restore" onClick={restoreReplies}>RESTORE DISMISSED ({dismissedCount})</button>
            )}
          </div>}
          {tab === 'send' && (state === 'done' ? (
            <div className="fb-thanks">Transmission received. Admin replies will appear in Inbox.</div>
          ) : (
            <div className="fb-compose">
              <textarea className="fb-text" maxLength={MAX} value={text} autoFocus
                aria-label="Message to the developer"
                placeholder="Bug, idea, or anything at all — it goes straight to the developer."
                onChange={(e) => { setText(e.target.value); if (state === 'err') setState('idle'); }} />
              {state === 'err' && <div className="fb-error">Transmission failed. Your draft is still here; try again.</div>}
              <div className="fb-foot">
                <span className="fb-count">{text.length}/{MAX}</span>
                <button className="fb-send" aria-label="Send message to developer" disabled={!text.trim() || state === 'busy'} onClick={send}>
                  {state === 'busy' ? '…' : state === 'err' ? 'RETRY' : 'SEND ▸'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className={`fb-toggle ${unread ? 'has-reply' : ''}`} title={unread ? `${unread} admin reply` : 'Messages'} aria-label={unread ? `${unread} admin reply` : 'Messages'} aria-expanded={open} onClick={() => { setOpen((o) => { const next = !o; if (next && unread > 0) setTab('inbox'); return next; }); sfx.click(); }}>
        {open ? '✕' : '✉'}
      </button>
    </div>
  );
}

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

function MainMenu(props: {
  map: GameMap; diff: DifficultyDef;
  setMap: (m: GameMap) => void; setDiff: (d: DifficultyDef) => void;
  dailySeed: DailyFreeplaySeed;
  onStart: () => void;
  onStartDaily: () => void;
}) {
  const [tab, setTab] = useState<'deploy' | 'board' | 'ops'>('deploy');
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Apex unlocks on a COMPLETED campaign (a win), matching its "survive one campaign"
  // copy — not on any run end (an instant wave-1 loss used to unlock it).
  const apexLocked = !DEMO_MODE && progress.record.victories < 1;
  const ngLocked = !DEMO_MODE && !progress.armisticeSeen;
  const firstTime = !DEMO_MODE && progress.record.runs < 1;
  const selectedUnlocked = mapUnlocked(ALL_MAPS.findIndex((m) => m.id === props.map.id));

  return (
    <div className="menu-root">
      <div className="menu-stars" />

      <header className="menu-topbar">
        <div className="menu-brand">
          <span className="menu-eyebrow">LANTERN SEVEN · SECTOR DEFENSE</span>
          <h1 className="menu-title">NEON VECTOR<span> DEFENSE</span></h1>
        </div>
        <nav className="menu-tabs">
          <button className={tab === 'deploy' ? 'on' : ''} onClick={() => { appMetrics.recordMenuTab('deploy'); setTab('deploy'); sfx.click(); }}>DEPLOY</button>
          <button className={tab === 'board' ? 'on' : ''} onClick={() => { appMetrics.recordMenuTab('board'); setTab('board'); sfx.click(); }}>LEADERBOARD</button>
          <button className={tab === 'ops' ? 'on' : ''} onClick={() => { setTab('ops'); sfx.click(); }}>OPERATIONS</button>
          <button className="menu-tab-help" title="How to play" onClick={() => { setHelp(true); sfx.click(); }}>?</button>
          <button className="menu-tab-help" title="Settings" aria-label="Settings" onClick={() => { setSettingsOpen(true); sfx.click(); }}>⚙</button>
        </nav>
      </header>

      {help && <HowToPlay onDone={() => { setHelp(false); sfx.click(); }} />}
      {settingsOpen && <SettingsPanel onClose={() => { setSettingsOpen(false); sfx.click(); }} />}

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
                      onClick={() => { appMetrics.recordMapSelect(m.id); sfx.click(); props.setMap(m); }}
                      title={m.desc}
                    >
                      {!active && firstTime && i === 0 && <div className="start-pill">START HERE</div>}
                      {progress.mapCleared(m.id) && <div className="map-clear-badge" title="Cleared">✓</div>}
                      <div className="map-thumb-stack">
                        <img className="map-thumb-art" src={`/art/sector-${m.id}.png`} alt="" />
                        <MapThumb map={m} />
                      </div>
                      <div className="map-card-row">
                        <span className="map-card-name">{m.name}</span>
                        <span className={`map-card-diff diff-${m.difficulty.toLowerCase()}`}>{m.difficulty}</span>
                      </div>
                      <div className="map-card-desc">{m.desc}</div>
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
                  const locked = (d.id === 'ngplus' && ngLocked) || (d.id === 'hard' && apexLocked)
                    || (d.id === 'extinction' && !DEMO_MODE && !progress.apexCleared);
                  if (locked) {
                    const reason = d.id === 'ngplus'
                      ? { label: '🔒 SEALED SIGNAL', desc: 'Another ending unlocks this protocol.', title: 'Sealed. End the war the other way first.' }
                      : d.id === 'extinction'
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
                      className={`diff-card ${active ? 'active' : ''} ${d.id === 'ngplus' ? 'diff-ngplus' : ''} ${d.id === 'extinction' ? 'diff-extinction' : ''}`}
                      data-testid={`diff-card-${d.id}`}
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
            </div>
          </>
        ) : tab === 'board' ? (
          <LeaderboardTab map={props.map} diff={props.diff} />
        ) : (
          <OperationsBoard />
        )}
      </div>

      <div className="menu-legal">
        <a href="/privacy">Privacy &amp; Data Choices</a>
      </div>

      {/* sticky launch bar — always visible, reflects the current selection */}
      <div className="deploy-bar">
        <div className="deploy-bar-sel">
          <span className="dbar-label">DEPLOYING TO</span>
          <span className="dbar-sec">{props.map.name}</span>
          <span className="dbar-dot">·</span>
          <span className="dbar-diff">{props.diff.name}</span>
        </div>
        <button className="start-btn deploy-bar-btn" data-testid="deploy-button" disabled={!selectedUnlocked}
          onClick={() => { appMetrics.recordDeployAttempt(props.map.id, props.diff.id, selectedUnlocked); props.onStart(); }}>▶ DEPLOY</button>
      </div>
    </div>
  );
}

function LeaderboardTab({ map, diff }: { map: GameMap; diff: DifficultyDef }) {
  const [fp, setFp] = useState(false);
  const [globalRows, setGlobalRows] = useState<RankedScoreEntry[] | null>(null);
  const [localRows, setLocalRows] = useState<ScoreEntry[] | null>(null);
  const board = boardId(map.id, diff.id, fp);
  useEffect(() => {
    let live = true;
    setGlobalRows(null);
    setLocalRows(null);
    Promise.all([fetchGlobalTop(fp, 20), fetchTop(board, 5)]).then(([global, local]) => {
      if (!live) return;
      setGlobalRows(global);
      setLocalRows(local);
    });
    return () => { live = false; };
  }, [board, fp]);
  return (
    <div className="board-tab">
      <div className="board-head">
        <div className="board-title">GLOBAL LEADERBOARD <span>{fp ? 'FREEPLAY' : 'CAMPAIGN'}</span></div>
        <div className="board-modes">
          <button className={!fp ? 'on' : ''} onClick={() => { appMetrics.recordLeaderboardMode(false); setFp(false); sfx.click(); }}>CAMPAIGN</button>
          <button className={fp ? 'on' : ''} onClick={() => { appMetrics.recordLeaderboardMode(true); setFp(true); sfx.click(); }}>FREEPLAY</button>
        </div>
      </div>
      <div className={`board-list board-global ${fp ? 'fp' : ''}`}>
        <div className="board-row board-row-head">
          <span className="board-rank">#</span>
          <span className="board-name">CALLSIGN</span>
          <span className="board-context">SECTOR</span>
          <span className="board-context">PROTOCOL</span>
          {fp && <span className="board-wave">WAVE</span>}
          <span className="board-kills">HULLS</span>
          <span className="board-cash">CREDITS</span>
          <span className="board-watch">REPLAY</span>
        </div>
        {globalRows === null ? (
          <div className="board-empty">Establishing uplink...</div>
        ) : globalRows.length === 0 ? (
          <div className="board-empty">No global records yet - deploy and claim the top spot.</div>
        ) : (
          globalRows.map((r, i) => (
            <div key={`${r.board}-${i}`} className="board-row">
              <span className="board-rank">{i + 1}</span>
              <span className="board-name">
                <span>{r.name}</span>
                {fp && (r.meta || r.daily || r.checkpoint) && (
                  <span className="board-meta-tags">
                    {r.checkpoint && <b>CHECKPOINT</b>}
                    {r.daily && <b>DAILY</b>}
                    {r.meta && <em>{r.meta}</em>}
                  </span>
                )}
              </span>
              <span className="board-context">{r.mapName}</span>
              <span className="board-context">{r.diffName}</span>
              {fp && <span className="board-wave">{r.wave}</span>}
              <span className="board-kills">{r.kills.toLocaleString()}</span>
              <span className="board-cash">{`\u232c${r.cash.toLocaleString()}`}</span>
              <span className="board-watch">
                {isRunId(r.runId)
                  ? <a className="watch-btn" href={`/?run=${r.runId}`} title="Watch this battle plan">\u25b6 WATCH</a>
                  : null}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="board-local-head">
        <span>{map.name}</span>
        <b>{diff.name}</b>
      </div>
      <div className={`board-list board-local ${fp ? 'fp' : ''}`}>
        <div className="board-row board-row-head">
          <span className="board-rank">#</span>
          <span className="board-name">CALLSIGN</span>
          {fp && <span className="board-wave">WAVE</span>}
          <span className="board-cash">CREDITS</span>
        </div>
        {localRows === null ? (
          <div className="board-empty compact">Checking local board...</div>
        ) : localRows.length === 0 ? (
          <div className="board-empty compact">No records for this sector/protocol yet.</div>
        ) : (
          localRows.map((r, i) => (
            <div key={i} className="board-row">
              <span className="board-rank">{i + 1}</span>
              <span className="board-name">
                <span>{r.name}</span>
                {fp && (r.meta || r.daily || r.checkpoint) && (
                  <span className="board-meta-tags">
                    {r.checkpoint && <b>CHECKPOINT</b>}
                    {r.daily && <b>DAILY</b>}
                    {r.meta && <em>{r.meta}</em>}
                  </span>
                )}
              </span>
              {fp && <span className="board-wave">{r.wave}</span>}
              <span className="board-cash">{`\u232c${r.cash.toLocaleString()}`}</span>
            </div>
          ))
        )}
      </div>
      <div className="board-foot">{fp ? 'Global freeplay ranks by wave reached' : 'Global campaign ranks by credits earned'} - local board follows your deploy selection</div>
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

function GameScreen({ map, diff, dailySeed, onExit }: { map: GameMap; diff: DifficultyDef; dailySeed?: DailyFreeplaySeed | null; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [run, setRun] = useState(0); // bump to restart the sector
  const gameRef = useRef<Game | null>(null);
  const runRef = useRef(-1);
  if (!gameRef.current || runRef.current !== run) {
    const nextGame = new Game(map, diff);
    if (dailySeed) nextGame.startDailyFreeplay(dailySeed);
    // restore the player's preferred run speed (smart fast-forward persistence)
    if (PERF_MAP === null && progress.preferredSpeed > 0) nextGame.speed = progress.preferredSpeed;
    gameRef.current = nextGame;
    runRef.current = run;
  }
  const game = gameRef.current;
  if (import.meta.env.DEV) {
    const devWindow = window as unknown as { game: Game; appMetrics: typeof appMetrics };
    devWindow.game = game;
    devWindow.appMetrics = appMetrics;
  }

  const [, setTick] = useState(0);
  const [placing, setPlacing] = useState<TowerDef | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [aiming, setAiming] = useState(false);
  const [tutorial, setTutorial] = useState(PERF_MAP === null && !DEMO_MODE && !progress.tutorialSeen);
  const [briefed, setBriefed] = useState(PERF_MAP !== null || DEMO_MODE || !!dailySeed);
  const botRef = useRef<Bot | null>(null);
  const fpsRef = useRef({ frames: 0, t: 0, fps: 0, worst: 999 });
  // adaptive render quality: smoothed fps + a hysteresis flag (see render.setRenderQuality)
  const qualRef = useRef({ fps: 60, lite: false });
  const perfIdleRef = useRef(0);
  const [cloakTip, setCloakTip] = useState(false);
  const [unlockModal, setUnlockModal] = useState<TowerDef | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [checkpointState, setCheckpointState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [metaReward, setMetaReward] = useState<RunMetaReward | null>(null);
  const hoverRef = useRef<Vec | null>(null);
  const placingRef = useRef<TowerDef | null>(null);
  const selectedRef = useRef<Tower | null>(null);
  const aimingRef = useRef(false);
  const overlayRef = useRef(false);
  placingRef.current = placing;
  aimingRef.current = aiming;
  selectedRef.current = game.towers.find((t) => t.uid === selectedUid) ?? null;
  // unlock modals must never stack on the briefing / tutorial overlays
  const relicOfferOpen = game.phase === 'build' && game.freeplayState.nextRelicOffer.length > 0;
  overlayRef.current = tutorial || !briefed || contractOpen || relicOfferOpen;
  const blockingOverlay = tutorial || !briefed || cloakTip || unlockModal !== null || contractOpen || relicOfferOpen ||
    game.phase === 'gameover' || game.phase === 'victory' || game.phase === 'armistice';
  const sideOpenRef = useRef(sideOpen);
  const blockingOverlayRef = useRef(blockingOverlay);
  sideOpenRef.current = sideOpen;
  blockingOverlayRef.current = blockingOverlay;

  useEffect(() => {
    if (tutorial) game.recorder.recordControl(METRIC_EVENTS.TUTORIAL_VIEW);
  }, [game, tutorial]);
  useEffect(() => {
    if (!tutorial && !briefed) game.recorder.recordControl(METRIC_EVENTS.BRIEFING_VIEW);
  }, [briefed, game, tutorial]);
  useEffect(() => {
    if (cloakTip) game.recorder.recordControl(METRIC_EVENTS.CLOAK_TIP_VIEW);
  }, [cloakTip, game]);

  // returning players already earned earlier towers — mark them seen silently so
  // the unlock modal only celebrates genuinely new unlocks during this run.
  useEffect(() => {
    if (PERF_MAP !== null || DEMO_MODE || dailySeed) return;
    const banked = progress.record.kills;
    for (const d of TOWERS_BY_UNLOCK) {
      if (d.unlockAt > 0 && d.unlockAt <= banked) progress.markUnlockSeen(d.id);
    }
  }, [dailySeed, game]);

  useEffect(() => {
    const notePointer = () => game.recorder.noteInput('pointer');
    const noteKey = () => game.recorder.noteInput('keyboard');
    const noteTouch = () => game.recorder.noteInput('touch');
    const noteVisibility = () => game.recorder.noteVisibility(document.hidden);
    window.addEventListener('pointerdown', notePointer);
    window.addEventListener('keydown', noteKey);
    window.addEventListener('touchstart', noteTouch);
    document.addEventListener('visibilitychange', noteVisibility);
    noteVisibility();
    return () => {
      window.removeEventListener('pointerdown', notePointer);
      window.removeEventListener('keydown', noteKey);
      window.removeEventListener('touchstart', noteTouch);
      document.removeEventListener('visibilitychange', noteVisibility);
    };
  }, [game]);

  // Re-assert beginRun in an effect so it runs AFTER the previous run's endRun cleanup.
  // (The Game constructor also calls beginRun during render, but on RETRY that ran before
  // the old run's cleanup, leaving the new run inactive and dropping its app-metrics.)
  useEffect(() => {
    appMetrics.beginRun(game.map.id, game.diff.id);
    return () => appMetrics.endRun();
  }, [game]);

  // sector ambience while deployed
  useEffect(() => {
    playSectorTheme(diff.id === 'ngplus' ? 'hollow' : (map.music ?? map.id));
    return () => playSectorTheme(null);
  }, [map.id, map.music, diff.id]);

  // anonymous run-end telemetry (one event per run, terminal phases only)
  const loggedRunRef = useRef(false);
  useEffect(() => { loggedRunRef.current = false; }, [run]);
  const checkpointSeqRef = useRef(0);
  const checkpointBusyRef = useRef(false);
  const checkpointWaveRef = useRef(game.wave);
  useEffect(() => {
    checkpointSeqRef.current = 0;
    checkpointBusyRef.current = false;
    checkpointWaveRef.current = game.wave;
  }, [game, run]);

  const submitCheckpointNow = useCallback(async (reason: RunCheckpointReason) => {
    if (PERF_MAP !== null || DEMO_MODE) return false;
    const callsign = (progress.playerName.trim() || 'WARDEN').slice(0, 20);
    const doc = game.buildRunCheckpointDoc(callsign, progress.uid, TELEMETRY_BUILD, checkpointSeqRef.current++, reason);
    return submitRunCheckpoint(doc);
  }, [game]);

  const flushRunCheckpoint = useCallback((reason: RunCheckpointReason) => {
    if (checkpointBusyRef.current) return;
    checkpointBusyRef.current = true;
    void submitCheckpointNow(reason).finally(() => { checkpointBusyRef.current = false; });
  }, [submitCheckpointNow]);

  useEffect(() => {
    const flushHidden = () => {
      if (document.hidden) flushRunCheckpoint('visibility');
    };
    const flushPageHide = () => flushRunCheckpoint('visibility');
    document.addEventListener('visibilitychange', flushHidden);
    window.addEventListener('pagehide', flushPageHide);
    return () => {
      document.removeEventListener('visibilitychange', flushHidden);
      window.removeEventListener('pagehide', flushPageHide);
    };
  }, [flushRunCheckpoint]);

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
      // adaptive render quality: ease the FX detail down when the frame rate sags on a
      // packed late-game board, and back up when it recovers (hysteresis avoids flicker).
      if (dt > 0 && dt < 0.5) {
        const q = qualRef.current;
        q.fps = q.fps * 0.9 + (1 / dt) * 0.1;
        if (!q.lite && q.fps < 45) { q.lite = true; appMetrics.recordQualityChange(true); setRenderQuality(true); }
        else if (q.lite && q.fps > 55) { q.lite = false; appMetrics.recordQualityChange(false); setRenderQuality(false); }
      }
      game.recorder.observeAttention(dt, {
        hidden: document.hidden,
        paused: game.paused,
        speed: game.speed,
        panel: sideOpenRef.current ? (selectedRef.current ? 'upgrade' : 'shop') : 'none',
        overlay: blockingOverlayRef.current,
        widgetOpen: utilityWidgetOpen(),
        fps: qualRef.current.fps,
        enemyCount: game.enemies.length,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
      });
      if (botRef.current) {
        botRef.current.act(game.time);
        if (game.phase === 'victory') game.enterFreeplay('standard');
        // auto-launch: give the bot ~1.5s real-time to build, then start the wave
        if (game.phase === 'build') {
          perfIdleRef.current += dt;
          if (perfIdleRef.current > 1.5) { perfIdleRef.current = 0; game.startWave(); }
        }
        const f = fpsRef.current;
        f.frames++;
        if (dt > 0) f.worst = Math.min(f.worst, 1 / dt);
        if (now - f.t > 1000) { f.fps = f.frames; f.frames = 0; f.t = now; }
      }
      game.update(dt);
      // Checkpoint only on MILESTONE build phases (opener + every 10th wave), not every
      // wave + every 30s — that was ~60-90 Firestore writes/run. submitRunCheckpoint
      // additionally self-gates on consent + per-run sampling, so most runs write none.
      if (PERF_MAP === null && !DEMO_MODE && game.phase === 'build' && game.wave > checkpointWaveRef.current) {
        checkpointWaveRef.current = game.wave;
        if (isMilestoneWave(game.wave)) flushRunCheckpoint('wave');
      }
      // fire one anonymous telemetry event when a run ends (skip perf bot runs)
      if (PERF_MAP === null && !DEMO_MODE && !loggedRunRef.current &&
          (game.phase === 'gameover' || game.phase === 'victory' || game.phase === 'armistice')) {
        loggedRunRef.current = true;
        void submitCheckpointNow('terminal');
        logTelemetry({
          kind: game.phase, map: game.map.id, diff: game.diff.id,
          wave: game.wave, kills: game.totalKills, cash: Math.round(game.runStats.cashEarned),
          won: game.phase !== 'gameover', freeplay: game.freeplay, durationS: Math.round(game.time),
          leaks: game.runStats.leaks, coresLeft: game.lives,
          // tower types fielded this run (standing + any that fired before being sold)
          towers: [...new Set([...game.towers.map((t) => t.def.id), ...Object.keys(game.runStats.dmg)])].join(','),
          // top-3 damage contributors as "id:pct" — causal "which tower carried"
          dmg: (() => {
            const e = Object.entries(game.runStats.dmg).sort((a, b) => b[1] - a[1]);
            const total = e.reduce((s, [, v]) => s + v, 0) || 1;
            return e.slice(0, 3).map(([id, v]) => `${id}:${Math.round((v / total) * 100)}`).join(',');
          })(),
          abilities: game.runStats.abilitiesCast,
        });
        void submitRunAnalytics(game.buildRunAnalyticsDoc(progress.playerName || 'WARDEN', progress.uid, TELEMETRY_BUILD));
        // credit the meta layer (XP/salvage/quests) — cosmetic only; reads engine values, never mutates the Game
        const reward = meta.creditRun(game.runId, {
          wave: game.wave, kills: game.totalKills, cashEarned: game.runStats.cashEarned,
          won: game.phase !== 'gameover', freeplay: game.freeplay, diffId: game.diff.id,
          isDailyFreeplay: game.isDailyFreeplay, outcome: game.phase as 'victory' | 'armistice' | 'gameover',
        }, {
          towerKindsUsed: new Set([...game.towers.map((t) => t.def.id), ...Object.keys(game.runStats.dmg)]).size,
          abilitiesCast: game.runStats.abilitiesCast,
        });
        if (reward.xp || reward.salvage) setMetaReward(reward);
      }
      const ctx = ctxRef.current ?? (ctxRef.current = canvasRef.current?.getContext('2d') ?? null);
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
        // perf harness: a synchronous frame for CPU-cost timing immune to rAF throttle
        if (PERF_MAP !== null) {
          (window as unknown as { __frame?: (d: number) => void }).__frame = (d: number) => {
            game.update(d);
            render(ctx, game, { hover: null, placing: null, canPlaceHere: false, selected: null, aimingStrike: false });
          };
        }
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
        // tower-unlock modal (BTD-style): first time a tower's kill threshold is crossed.
        // Only during BUILD — a kill threshold is almost always crossed mid-combat, and a
        // full-screen pause-modal yanking the player out of an active wave is jarring; it
        // pops at the next build phase instead.
        if (PERF_MAP === null && !DEMO_MODE && !game.isDailyFreeplay && !game.paused && !overlayRef.current && game.phase === 'build') {
          const k = progress.record.kills + game.totalKills;
          const just = TOWERS_BY_UNLOCK.find((d) => d.unlockAt > 0 && d.unlockAt <= k && !progress.unlockSeen(d.id));
          if (just) {
            game.recorder.recordUnlockViewed(just.id);
            progress.markUnlockSeen(just.id);
            game.paused = true;
            setUnlockModal(just);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, flushRunCheckpoint, submitCheckpointNow]);

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
    if (placing) game.recorder.recordControl(METRIC_EVENTS.PLACEMENT_CANCEL);
    if (aiming) game.recorder.recordControl(METRIC_EVENTS.ABILITY_AIM_CANCEL);
    setPlacing(null);
    setSelectedUid(null);
    setAiming(false);
  };

  const useAbility = (id: typeof ABILITIES[number]['id']) => {
    const a = ABILITIES.find((x) => x.id === id)!;
    if (!game.abilityReady(id)) { sfx.error(); return; }
    if (a.targeted) {
      if (aiming) game.recorder.recordControl(METRIC_EVENTS.ABILITY_AIM_CANCEL);
      setAiming((v) => !v);
      setPlacing(null);
      setSelectedUid(null);
    } else {
      game.castAbility(id);
    }
  };
  const useAbilityRef = useRef(useAbility);
  useAbilityRef.current = useAbility;

  useEffect(() => {
    const pauseForWidgets = () => {
      if (utilityWidgetOpen()) game.paused = true;
    };
    window.addEventListener(WIDGET_OPEN_EVENT, pauseForWidgets);
    pauseForWidgets();
    return () => window.removeEventListener(WIDGET_OPEN_EVENT, pauseForWidgets);
  }, [game]);

  useLayoutEffect(() => {
    document.body.classList.add('game-active');
    document.body.classList.toggle('game-sidebar-open', sideOpen);
    document.body.classList.toggle('game-sidebar-collapsed', !sideOpen);
    document.body.classList.toggle('game-blocking-overlay', blockingOverlay);
    return () => {
      document.body.classList.remove('game-active', 'game-sidebar-open', 'game-sidebar-collapsed', 'game-blocking-overlay');
    };
  }, [sideOpen, blockingOverlay]);

  useEffect(() => {
    if (!abortConfirm) return;
    const id = window.setTimeout(() => setAbortConfirm(false), 3500);
    return () => window.clearTimeout(id);
  }, [abortConfirm]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (isTypingTarget(ev.target)) return;
      // 'm' mutes from anywhere — even behind a pausing modal (unlock/cloak/relic), so a
      // player can always kill unexpected audio without dismissing the overlay first.
      if (ev.key.toLowerCase() === 'm' && !utilityWidgetOpen()) {
        const m = !muted; setMuted(m); setMutedState(m); appMetrics.recordSoundToggle('sound');
        return;
      }
      if (utilityWidgetOpen() || blockingOverlayRef.current) return;
      if (ev.key === 'Escape') {
        if (placingRef.current) game.recorder.recordControl(METRIC_EVENTS.PLACEMENT_CANCEL);
        if (aimingRef.current) game.recorder.recordControl(METRIC_EVENTS.ABILITY_AIM_CANCEL);
        setPlacing(null); setSelectedUid(null); setAiming(false);
      }
      if (ev.key === ' ') {
        ev.preventDefault();
        if (game.phase === 'build') {
          game.recorder.recordControl(METRIC_EVENTS.WAVE_LAUNCH_KEY);
          game.startWave();
        } else {
          game.paused = !game.paused;
          game.recorder.recordControl(METRIC_EVENTS.FIRST_PAUSE, game.time);
        }
      }
      const ab = { q: 'strike', w: 'chrono', e: 'overdrive', r: 'salvage', t: 'cascade', y: 'mirror' } as const;
      const k = ev.key.toLowerCase() as keyof typeof ab;
      if (ab[k]) useAbilityRef.current(ab[k]);
      const n = ev.key === '0' ? 10 : parseInt(ev.key);
      if (n >= 1 && n <= TOWERS_BY_UNLOCK.length) {
        const def = TOWERS_BY_UNLOCK[n - 1];
        if (!towerAvailable(game, def)) {
          game.recorder.recordTowerShopSelect(def, 'locked');
          sfx.error();
          game.announce(towerLockText(game, def));
          return;
        }
        game.recorder.recordTowerShopSelect(def, game.credits >= game.cost(def) ? 'selected' : 'unaffordable');
        setPlacing((p) => (p?.id === def.id ? null : def));
        setSelectedUid(null);
        setAiming(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  const selected = selectedRef.current;
  const abortRisk = game.phase !== 'build' || game.wave > 0 || game.towers.length > 0 || game.totalKills > 0;
  const requestAbort = () => {
    if (abortRisk && !abortConfirm) {
      setAbortConfirm(true);
      game.paused = true;
      game.recorder.recordControl(METRIC_EVENTS.ABORT_ARMED);
      game.announce('Abort armed - press CONFIRM to leave this run.');
      sfx.error();
      return;
    }
    if (abortRisk) game.recorder.recordControl(METRIC_EVENTS.ABORT_CONFIRMED);
    if (abortRisk && game.phase !== 'gameover' && game.phase !== 'victory' && game.phase !== 'armistice') {
      game.abandonRun('abort');
      if (PERF_MAP === null && !DEMO_MODE) {
        void submitCheckpointNow('abort');
        void submitRunAnalytics(game.buildRunAnalyticsDoc(progress.playerName || 'WARDEN', progress.uid, TELEMETRY_BUILD));
      }
    }
    onExit();
  };

  useEffect(() => {
    if (checkpointState !== 'busy') setCheckpointState('idle');
  }, [game.wave]);

  const chooseContract = (id: FreeplayContractId) => {
    loggedRunRef.current = false;
    game.enterFreeplay(id);
    game.paused = false;
    setContractOpen(false);
    setTick((t) => t + 1);
    sfx.click();
  };

  const chooseRelic = (id: FreeplayRelicId) => {
    game.chooseRelic(id);
    setTick((t) => t + 1);
    sfx.upgrade();
  };

  const acceptRisk = (id: RiskWaveId) => {
    if (game.acceptRisk(id)) {
      setTick((t) => t + 1);
      sfx.upgrade();
    }
  };

  const declineRisk = () => {
    game.declineRisk();
    setTick((t) => t + 1);
    sfx.click();
  };

  const bankFreeplayCheckpoint = async () => {
    if (!game.canBankFreeplay() || checkpointState === 'busy' || DEMO_MODE) return;
    const n = (progress.playerName.trim() || 'WARDEN').slice(0, 20);
    const prevCheckpoint = game.freeplayState.lastCheckpointWave;
    setCheckpointState('busy');
    game.markFreeplayCheckpoint();
    await submitCheckpointNow('bank');
    game.recorder.recordScoreSubmitAttempt(game.telemetryState());
    const meta = game.freeplayMeta();
    const replayOk = await submitRunReplay(game.buildRunUploadBundle(n, TELEMETRY_BUILD));
    game.recorder.recordReplaySubmitResult(replayOk);
    const scoreEntry = {
      name: n,
      cash: Math.round(game.runStats.cashEarned),
      kills: game.totalKills,
      wave: game.wave,
      freeplay: true,
      ts: Date.now(),
      runId: replayOk ? game.runId : undefined,
      meta: meta.summary,
      daily: meta.daily || undefined,
      checkpoint: true,
    };
    const ok = meta.daily
      ? await submitDailyScore(meta.daily, scoreEntry)
      : await submitScore(boardId(map.id, diff.id, true), scoreEntry);
    game.recorder.recordScoreSubmitResult(ok);
    void submitRunAnalytics(game.buildRunAnalyticsDoc(n, progress.uid, TELEMETRY_BUILD));
    if (ok) {
      setCheckpointState('done');
      sfx.upgrade();
    } else {
      game.freeplayState.lastCheckpointWave = prevCheckpoint;
      setCheckpointState('err');
      sfx.error();
    }
    setTick((t) => t + 1);
  };

  return (
    <div className={`game-root ${sideOpen ? 'sidebar-open' : 'sidebar-collapsed'}`} data-testid="game-root">
      {AI_HELP_ENABLED && (
        <AIHelpWidget
          placement="game"
          blocked={blockingOverlay}
          sideOpen={sideOpen}
          getContext={() => buildAIHelpContext({ screen: 'game', map, diff, game, selectedTower: selectedRef.current })}
        />
      )}
      <FeedbackWidget ctx="game" blocked={blockingOverlay} sideOpen={sideOpen} />
      <div className="topbar">
        <button
          className={`tb-btn exit ${abortConfirm ? 'confirm' : ''}`}
          aria-label={abortConfirm ? 'Confirm abort run' : 'Abort run'}
          title={abortRisk ? 'Press once to arm abort, then confirm.' : 'Return to main menu'}
          onClick={requestAbort}
        >
          {abortConfirm ? 'CONFIRM' : '✕ ABORT'}
        </button>
        <div className="tb-stat lives" title="Reactor cores (lives)">⬢ {game.lives}</div>
        <div className="tb-stat credits" title="Credits">⌬ {Math.floor(game.credits)}</div>
        <div className="tb-stat wave">
          WAVE {game.wave}{game.phase === 'build' ? ` / ${game.freeplay ? '∞' : diff.waves}` : ''}
        </div>
        {!game.freeplay && (
          <BotGhostHud curve={ghostCurveFor(GHOST_CURVES, map.id, diff.id)} wave={game.wave} cores={game.lives} phase={game.phase} />
        )}
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
          aria-label="Toggle auto-start next wave"
          onClick={() => { game.autoNext = !game.autoNext; game.recorder.recordControl(METRIC_EVENTS.AUTO_TOGGLE, game.autoNext); sfx.click(); }}
        >AUTO</button>
        {[1, 2, 4].map((s) => (
          <button key={s} className={`tb-btn ${game.speed === s ? 'on' : ''}`}
            title={`Set game speed to ${s}x`}
            aria-label={`Set game speed to ${s}x`}
            onClick={() => { game.speed = s; progress.preferredSpeed = s; game.recorder.recordControl(METRIC_EVENTS.SPEED_CHANGE, s); sfx.click(); }}>{s}×</button>
        ))}
        <button className={`tb-btn ${game.paused ? 'on' : ''}`}
          title={game.paused ? 'Resume game' : 'Pause game'}
          aria-label={game.paused ? 'Resume game' : 'Pause game'}
          onClick={() => { game.paused = !game.paused; game.recorder.recordControl(METRIC_EVENTS.FIRST_PAUSE, game.time); sfx.click(); }}>
          {game.paused ? '▶' : '⏸'}
        </button>
        <MusicButton />
        <button className={`tb-btn ${muted ? '' : 'on'}`} title="Sound effects & voice on/off" aria-label="Toggle sound effects and voice"
          onClick={() => { const m = !muted; setMuted(m); setMutedState(m); appMetrics.recordSoundToggle('sound'); sfx.click(); }}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="game-body">
        <div className="canvas-wrap">
          <canvas
            data-testid="game-canvas"
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
                  aria-label={locked
                    ? `${a.def.name} locked until wave ${a.def.unlockWave}`
                    : `${a.def.name} ability, ${'QWERTY'[i]}`}
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

          {game.freeplay && game.phase === 'build' && (
            <FreeplayBuildPanel
              game={game}
              checkpointState={checkpointState}
              onAcceptRisk={acceptRisk}
              onDeclineRisk={declineRisk}
              onBank={bankFreeplayCheckpoint}
            />
          )}

          {game.phase === 'build' && (
            <button className="wave-btn" data-testid="launch-wave" disabled={relicOfferOpen} onClick={() => { game.recorder.recordControl(METRIC_EVENTS.WAVE_LAUNCH_CLICK); game.startWave(); setTick((t) => t + 1); }}>
              ▶ LAUNCH WAVE {game.wave + 1}
            </button>
          )}
          {game.paused && <div className="overlay-label">PAUSED</div>}
          {tutorial && (
            <HowToPlay onDone={() => { setTutorial(false); progress.tutorialSeen = true; sfx.click(); }} />
          )}
          {!tutorial && !briefed && (
            <BriefingOverlay
              lines={diff.id === 'ngplus' ? LONGWATCH_BRIEFING : BRIEFING}
              portrait={diff.id === 'ngplus' ? '/art/hollow.png' : '/art/briefing.png'}
              audio={diff.id === 'ngplus' ? '/audio/vox/longwatch-brief.wav' : '/audio/briefing.wav'}
              onDone={() => { setBriefed(true); sfx.waveStart(); }}
            />
          )}
          {game.phase === 'gameover' && (
            <Overlay title="GRID OFFLINE" color="#ff4757" art="/art/defeat.png" report={<><MetaReward reward={metaReward} /><AfterAction game={game} ghost={game.freeplay ? null : ghostCurveFor(GHOST_CURVES, map.id, diff.id)} /><SubmitScore game={game} map={map} diff={diff} /></>}
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
          {unlockModal && (
            <div className="cutscene-overlay" onClick={() => { setUnlockModal(null); game.paused = false; sfx.click(); }}>
              <div className="cutscene-box unlock-modal" style={{ borderColor: unlockModal.color, ['--bc' as string]: unlockModal.glow }} onClick={(e) => e.stopPropagation()}>
                <div className="unlock-eyebrow">◆ NEW INSTRUMENT UNLOCKED ◆</div>
                <div className="unlock-head">
                  <div className="unlock-badge" style={{ ['--tc' as string]: unlockModal.color, ['--tg' as string]: unlockModal.glow }}>
                    <TowerIcon def={unlockModal} />
                  </div>
                  <div>
                    <div className="unlock-name" style={{ color: unlockModal.glow }}>{unlockModal.name}</div>
                    <div className="unlock-type">{unlockModal.base.damageType} · ⌬{unlockModal.cost}</div>
                  </div>
                </div>
                <p className="tip-text">{unlockModal.desc}</p>
                <p className="unlock-lore">“{unlockModal.lore}”</p>
                <p className="hint-dim">Find it in your ARSENAL — two upgrade paths, commit to one for its devastating final tiers.</p>
                <button className="start-btn small" onClick={() => { setUnlockModal(null); game.paused = false; sfx.click(); }}>DEPLOY IT ▸</button>
              </div>
            </div>
          )}
          {contractOpen && <FreeplayContractModal onSelect={chooseContract} onCancel={() => { setContractOpen(false); game.paused = false; sfx.click(); }} />}
          {relicOfferOpen && <FreeplayRelicModal game={game} onSelect={chooseRelic} />}
          {game.phase === 'armistice' && (
            <Overlay title="THE LONG SIGNAL" color="#ffd32a" art="/art/armistice.png" report={<><MetaReward reward={metaReward} /><AfterAction game={game} ghost={game.freeplay ? null : ghostCurveFor(GHOST_CURVES, map.id, diff.id)} /><SubmitScore game={game} map={map} diff={diff} /></>}
              lines={ARMISTICE_LINES}
              buttons={[{ label: 'MAIN MENU', fn: onExit }]}
            />
          )}
          {game.phase === 'victory' && (
            <Overlay title="SECTOR SECURED" color="#2ed573" art="/art/victory.png" report={<><MetaReward reward={metaReward} /><AfterAction game={game} ghost={game.freeplay ? null : ghostCurveFor(GHOST_CURVES, map.id, diff.id)} /><SubmitScore game={game} map={map} diff={diff} /></>}
              lines={[`All ${diff.waves} waves repelled on ${map.name}.`, `${game.totalKills} hostiles destroyed.`]}
              buttons={[
                { label: '∞ FREEPLAY', fn: () => { game.paused = true; setContractOpen(true); sfx.click(); } },
                { label: 'MAIN MENU', fn: onExit },
              ]}
            />
          )}
        </div>

        <div className={`sidebar ${sideOpen ? '' : 'collapsed'}`} data-testid="game-sidebar">
          {sideOpen ? (
            <div className="side-body">
              {selected ? (
                <UpgradePanel game={game} tower={selected}
                  sig={`${Math.floor(game.credits)}|${selected.tierA}|${selected.tierB}|${selected.committed}|${selected.invested}|${selected.kills}|${selected.target}|${selected.rateBuff.toFixed(2)}|${selected.rangeBuff.toFixed(2)}`}
                  onSold={() => setSelectedUid(null)} onCollapse={() => { game.recorder.recordControl(METRIC_EVENTS.SIDE_PANEL_COLLAPSE); setSideOpen(false); sfx.click(); }} />
              ) : (
                <Shop game={game} placing={placing}
                  sig={`${Math.floor(game.credits)}|${game.totalKills}|${game.isDailyFreeplay ? [...(game.dailyTowerIds ?? [])].join(',') : 'campaign'}`}
                  setPlacing={(d) => { setPlacing(d); setSelectedUid(null); }} onCollapse={() => { game.recorder.recordControl(METRIC_EVENTS.SIDE_PANEL_COLLAPSE); setSideOpen(false); sfx.click(); }} />
              )}
              <ReceiverPanel game={game} />
            </div>
          ) : (
            <button className="side-rail" title="Expand panel" aria-label="Expand arsenal panel" onClick={() => { game.recorder.recordControl(METRIC_EVENTS.SIDE_PANEL_EXPAND); setSideOpen(true); sfx.click(); }}>
              <span className="side-rail-arrow">⟨</span>
              <span className="side-rail-label">ARSENAL</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FreeplayBuildPanel({
  game,
  checkpointState,
  onAcceptRisk,
  onDeclineRisk,
  onBank,
}: {
  game: Game;
  checkpointState: 'idle' | 'busy' | 'done' | 'err';
  onAcceptRisk: (id: RiskWaveId) => void;
  onDeclineRisk: () => void;
  onBank: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const fp = game.freeplayState;
  const nextWave = game.wave + 1;
  const nextRival = rivalForWave(nextWave, fp.daily);
  const meta = game.freeplayMeta();
  const risk = fp.riskOffer;
  const bankTarget = fp.daily ? 'DAILY' : 'FREEPLAY';
  const bankLabel = checkpointState === 'busy' ? 'BANKING...' : checkpointState === 'done' ? 'BANKED' : checkpointState === 'err' ? 'RETRY BANK' : `BANK ${bankTarget} RECORD`;
  if (collapsed) {
    return (
      <button className="freeplay-reopen" onClick={() => setCollapsed(false)} title="Show Freeplay Command">
        ◂ FREEPLAY {risk ? '⚠' : `${meta.scoreMult.toFixed(2)}x`}
      </button>
    );
  }
  return (
    <div className="freeplay-build-panel">
      <div className="freeplay-panel-head">
        <span>FREEPLAY COMMAND</span>
        <b>{meta.scoreMult.toFixed(2)}x</b>
        <button className="freeplay-close" aria-label="Hide Freeplay Command" title="Hide" onClick={() => setCollapsed(true)}>✕</button>
      </div>
      <div className="freeplay-chip-row">
        <span className="freeplay-chip contract">{fp.contract?.short ?? 'OPEN'}</span>
        {fp.daily && <span className="freeplay-chip daily">DAILY</span>}
        {fp.relics.slice(-3).map((r) => <span key={r.id} className="freeplay-chip">{r.name}</span>)}
      </div>
      <div className="freeplay-next-grid">
        <div>
          <span>Next Mutators</span>
          <b>{fp.nextMutators.length ? fp.nextMutators.map((m) => m.name).join(' + ') : 'Standard pressure'}</b>
        </div>
        <div>
          <span>Rival</span>
          <b>{nextRival ? nextRival.name : nextWave % 10 === 0 ? 'Signal forming' : 'None'}</b>
        </div>
      </div>
      {risk && (
        <div className="risk-offer">
          <div>
            <span>RED ALERT OFFER</span>
            <b>{risk.name}</b>
            <p>{risk.desc} {risk.reward}</p>
          </div>
          <div className="risk-actions">
            <button className="tb-btn on" onClick={() => onAcceptRisk(risk.id)}>ACCEPT</button>
            <button className="tb-btn" onClick={onDeclineRisk}>SKIP</button>
          </div>
        </div>
      )}
      <button className="freeplay-bank-btn" disabled={!game.canBankFreeplay() || checkpointState === 'busy' || DEMO_MODE} onClick={onBank}>
        {bankLabel}
      </button>
      <div className="freeplay-bank-note">
        {game.canBankFreeplay()
          ? `Bank wave ${game.wave} and keep playing.`
          : `Next bank unlocks after wave ${fp.lastCheckpointWave}.`}
      </div>
    </div>
  );
}

function FreeplayContractModal({ onSelect, onCancel }: { onSelect: (id: FreeplayContractId) => void; onCancel: () => void }) {
  return (
    <div className="cutscene-overlay" onClick={onCancel}>
      <div className="cutscene-box freeplay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cutscene-title">PRESTIGE CONTRACT</div>
        <p className="tip-text">Choose how the endless siege scores you. Higher multipliers add real constraints for the whole freeplay run.</p>
        <div className="contract-grid">
          {FREEPLAY_CONTRACTS.map((c) => (
            <button key={c.id} className="contract-card" onClick={() => onSelect(c.id)}>
              <span className="contract-mult">{c.multiplier.toFixed(2)}x</span>
              <b>{c.name}</b>
              <p>{c.desc}</p>
            </button>
          ))}
        </div>
        <button className="tb-btn" onClick={onCancel}>BACK</button>
      </div>
    </div>
  );
}

function FreeplayRelicModal({ game, onSelect }: { game: Game; onSelect: (id: FreeplayRelicId) => void }) {
  const offer = game.freeplayState.nextRelicOffer;
  return (
    <div className="cutscene-overlay">
      <div className="cutscene-box freeplay-modal">
        <div className="cutscene-title">RELIC DRAFT</div>
        <p className="tip-text">Pick one run modifier. Relics are permanent, powerful, and a little dangerous.</p>
        <div className="relic-grid">
          {offer.map((r) => (
            <button key={r.id} className="relic-card" onClick={() => onSelect(r.id)}>
              <span className="contract-mult">{r.scoreMult.toFixed(2)}x</span>
              <b>{r.name}</b>
              <p>{r.desc}</p>
              <em>{r.downside}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HowToPlay({ onDone }: { onDone: () => void }) {
  const steps: [string, string, string][] = [
    ['🎯', 'Build the grid', 'Pick a tower from the ARSENAL (or press 1–9/0), then click open ground beside the lane. Towers fire automatically at anything in range.'],
    ['⌬', 'Spend your credits', 'Every hull you destroy pays out. Bank it into more towers and upgrades.'],
    ['▲', 'Two upgrade tracks', 'Click a built tower to upgrade it down two paths. The final two tiers are expensive — and devastating — but you must COMMIT to one track to buy them.'],
    ['⚡', 'Commander abilities', 'Q/W/E/R/T/Y unlock as you advance — orbital strikes, time dilation, and more. Use them when the lane is breaking.'],
    ['⬢', 'Hold the lane', 'Hostiles that reach the OUT gate cost reactor cores. Lose them all and the lighthouse falls. Press SPACE or LAUNCH to send each wave; 1×/2×/4× sets the pace.'],
  ];
  return (
    <div className="overlay" data-testid="tutorial-overlay">
      <div className="overlay-box howto">
        <h2 style={{ color: '#4bcffa' }}>HOW TO HOLD THE LANE</h2>
        <div className="howto-steps">
          {steps.map(([icon, title, body]) => (
            <div key={title} className="howto-step">
              <span className="howto-icon">{icon}</span>
              <div>
                <div className="howto-title">{title}</div>
                <div className="howto-body">{body}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="overlay-btns">
          <button className="start-btn small" onClick={onDone}>GOT IT ▶</button>
        </div>
      </div>
    </div>
  );
}

function SettingsRow({ name, sub, on, onToggle }: { name: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="privacy-control">
      <div>
        <div className="privacy-control-name">{name}</div>
        <div className="privacy-control-sub">{sub}</div>
      </div>
      <button className={`privacy-toggle ${on ? 'on' : ''}`} onClick={onToggle}>{on ? 'ON' : 'OFF'}</button>
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const sfxOn = !isMuted();
  const musicOn = isMusicOn();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-box settings-box" style={{ borderColor: '#4bcffa' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ color: '#4bcffa' }}>SETTINGS</h2>
        <div className="privacy-controls">
          <SettingsRow name="Sound effects" sub="Procedural combat audio." on={sfxOn}
            onToggle={() => { setMuted(sfxOn); rerender(); if (!sfxOn) sfx.click(); }} />
          <SettingsRow name="Music" sub="Generative score." on={musicOn}
            onToggle={() => { setMusic(!musicOn); rerender(); }} />
          <div className="privacy-control">
            <div>
              <div className="privacy-control-name">Music pack</div>
              <div className="privacy-control-sub">Choose the soundtrack.</div>
            </div>
            <select className="age-gate-select settings-select" value={getMusicPack()}
              onChange={(e) => { setMusicPack(e.target.value); rerender(); sfx.click(); }}>
              {MUSIC_PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <SettingsRow name="Reduced motion" sub="Turns off screen shake and the red damage flash." on={progress.reducedMotion}
            onToggle={() => { progress.reducedMotion = !progress.reducedMotion; applyAccessibility(); rerender(); sfx.click(); }} />
          <SettingsRow name="Colorblind palette" sub="Colorblind-safe damage-type colors (kinetic/energy/cryo/blast)." on={progress.colorblind}
            onToggle={() => { progress.colorblind = !progress.colorblind; applyAccessibility(); rerender(); sfx.click(); }} />
        </div>
        <div className="overlay-btns"><button className="start-btn small" onClick={onClose}>DONE ▸</button></div>
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
    <div className="overlay" data-testid="briefing-overlay">
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
    <button className={`tb-btn ${on ? 'on' : ''}`} title="Music on/off" aria-label="Toggle music"
      onClick={() => { const v = !on; setMusic(v); setOn(v); appMetrics.recordSoundToggle('music'); }}>♪</button>
  );
}

function MetaReward({ reward }: { reward: RunMetaReward | null }) {
  if (!reward || (!reward.xp && !reward.salvage)) return null;
  const rank = meta.rank;
  return (
    <div className="meta-reward" data-testid="meta-reward">
      <div className="meta-reward-head">
        <span className="meta-reward-xp">+{reward.xp.toLocaleString()} XP</span>
        <span className="meta-reward-salvage">+<i className="ico-diamond" aria-hidden="true" />{reward.salvage.toLocaleString()} SALVAGE</span>
      </div>
      <div className="meta-reward-rank">
        <span>{rank.title}</span>
        <span className="meta-reward-bar"><span className="meta-reward-fill" style={{ width: `${rank.pct * 100}%` }} /></span>
      </div>
    </div>
  );
}

function AfterAction({ game, ghost }: { game: Game; ghost?: GhostCurve | null }) {
  const s = game.runStats;
  const dmg = Object.entries(s.dmg).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxDmg = dmg[0]?.[1] ?? 1;
  const kills = Object.entries(s.kills).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const name = (id: string) => TOWERS.find((t) => t.id === id)?.name ?? ENEMIES[id]?.name ?? id;
  const verdict = ghost ? judgeRun(ghost, game.wave, game.lives) : null;
  const outWarded = verdict && (verdict.beatWave || verdict.beatCores);
  return (
    <div className="aar">
      {outWarded && verdict && (
        <div className="aar-badge" title={`AI rival (${ghost!.skill}): ~${verdict.refCores} cores by wave ${verdict.refWave}.`}>
          <span className="aar-badge-star">★</span> OUT-WARDED THE AI
          <span className="aar-badge-sub">
            {verdict.beatWave ? `+${verdict.deltaWave} waves` : ''}
            {verdict.beatWave && verdict.beatCores ? ' · ' : ''}
            {verdict.beatCores ? `+${verdict.deltaCores} cores` : ''}
          </span>
        </div>
      )}
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


function SubmitScore({ game, map, diff }: { game: Game; map: GameMap; diff: DifficultyDef }) {
  const [name, setName] = useState(progress.playerName);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [top, setTop] = useState<ScoreEntry[] | null>(null);
  const [dossier, setDossier] = useState<DossierInput | null>(null);
  const [sharedRunId, setSharedRunId] = useState<string | undefined>(undefined);
  const eligible = game.phase === 'victory' || game.phase === 'armistice' ||
    (game.phase === 'gameover' && game.freeplay);
  useEffect(() => {
    if (eligible && !DEMO_MODE) game.recorder.recordLeaderboardOpen();
  }, [eligible, game]);
  if (!eligible) return null;
  const board = boardId(map.id, diff.id, game.freeplay);
  const freeplayMeta = game.freeplay ? game.freeplayMeta() : null;
  const dailyId = freeplayMeta?.daily ?? '';
  const leaderboardTitle = dailyId
    ? `DAILY LEADERBOARD - ${dailyId.toUpperCase()}`
    : `GLOBAL LEADERBOARD - ${map.name.toUpperCase()} / ${diff.name.toUpperCase()}${game.freeplay ? ' / FREEPLAY' : ''}`;

  if (DEMO_MODE) {
    return (
      <div className="submit-score demo-score-disabled">
        <div className="aar-title">RECRUITER DEMO RUN</div>
        <p>Leaderboard submission is disabled in demo mode so live score data stays clean.</p>
      </div>
    );
  }

  const submit = async () => {
    const n = (name.trim() || 'WARDEN').slice(0, 20);
    progress.playerName = n;
    setState('busy');
    game.recorder.recordScoreSubmitAttempt(game.telemetryState());
    const replayOk = await submitRunReplay(game.buildRunUploadBundle(n, TELEMETRY_BUILD));
    game.recorder.recordReplaySubmitResult(replayOk);
    const scoreEntry = {
      name: n,
      cash: Math.round(game.runStats.cashEarned),
      kills: game.totalKills,
      wave: game.wave,
      freeplay: game.freeplay,
      ts: Date.now(),
      runId: replayOk ? game.runId : undefined,
      meta: freeplayMeta?.summary,
      daily: dailyId || undefined,
      checkpoint: false,
    };
    const ok = dailyId
      ? await submitDailyScore(dailyId, scoreEntry)
      : await submitScore(board, scoreEntry);
    game.recorder.recordScoreSubmitResult(ok);
    void submitRunAnalytics(game.buildRunAnalyticsDoc(n, progress.uid, TELEMETRY_BUILD));
    if (ok) {
      setTop(dailyId ? await fetchDailyTop(dailyId) : await fetchTop(board));
      try { setDossier(buildDossierInputFromGame(game, n)); } catch (e) { console.warn('dossier build failed', e); }
      setSharedRunId(replayOk ? game.runId : undefined);
      setState('done');
      sfx.upgrade();
    } else {
      setState('err');
    }
  };

  return (
    <div className="submit-score">
      <div className="aar-title">{leaderboardTitle}</div>
      {state !== 'done' && (
        <div className="submit-row">
          <input className="name-input" maxLength={20} placeholder="CALLSIGN" aria-label="Leaderboard callsign"
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
      {state === 'done' && dossier && <DossierShare input={dossier} runId={sharedRunId} />}
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

// Memoized: the loop re-renders GameScreen ~8x/s, but the shop only needs to
// repaint when affordability (credits) or the unlock bar (kills) actually move.
// `sig` snapshots those so React.memo can skip otherwise-identical renders (the
// inline callbacks change identity every parent render, so the comparator ignores
// them — they close over stable useState setters, so old closures stay correct).
const Shop = memo(function Shop({ game, placing, setPlacing, onCollapse }: {
  game: Game; placing: TowerDef | null; setPlacing: (d: TowerDef | null) => void; onCollapse?: () => void;
  /** render signature: floor(credits)|totalKills — see comparator below */
  sig: string;
}) {
  // lifetime kills (banked at run end) + this run's kills so the bar fills live
  const kills = liveUnlockKills(game);
  const dailyMode = game.isDailyFreeplay;
  // the next tower the player will unlock, for the BTD-style progress bar
  const next = dailyMode ? undefined : TOWERS_BY_UNLOCK.find((d) => d.unlockAt > kills);
  const prevThreshold = TOWERS_BY_UNLOCK.filter((d) => d.unlockAt <= kills).reduce((m, d) => Math.max(m, d.unlockAt), 0);
  useEffect(() => { game.recorder.recordShopOpen(); }, [game]);
  return (
    <div className="panel panel-grow">
      <div className="panel-head">
        <div className="panel-title">ARSENAL</div>
        {onCollapse && <button className="panel-collapse" title="Collapse panel" aria-label="Collapse arsenal panel" onClick={onCollapse}>⟩</button>}
      </div>
      <div className="shop-grid" data-testid="shop-grid">
        {TOWERS_BY_UNLOCK.map((def, i) => {
          const lockedBy = def.unlockAt - kills;
          const available = towerAvailable(game, def);
          if (!available) {
            return (
              <div key={def.id} className="shop-item shop-locked" data-testid={`tower-${def.id}`} title={dailyMode ? `${def.name} is not in today's Daily arsenal` : `${def.name} - destroy ${lockedBy} more hostiles to unlock`}
                onClick={() => { game.recorder.recordTowerShopSelect(def, 'locked'); sfx.error(); }}>
                <div className="shop-lock-icon">🔒</div>
                <div className="shop-name">{def.name}</div>
                <div className="shop-cost">{dailyMode ? 'daily pool' : `${lockedBy} kills`}</div>
              </div>
            );
          }
          const cost = game.cost(def);
          const afford = game.credits >= cost;
          return (
            <button
              key={def.id}
              className={`shop-item ${placing?.id === def.id ? 'active' : ''} ${afford ? '' : 'poor'}`}
              data-testid={`tower-${def.id}`}
              style={{ ['--tc' as string]: def.color, ['--tg' as string]: def.glow }}
              onClick={() => { sfx.click(); game.recorder.recordTowerShopSelect(def, afford ? 'selected' : 'unaffordable'); setPlacing(placing?.id === def.id ? null : def); }}
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
      {next && (
        <div className="unlock-track" title={`${kills.toLocaleString()} / ${next.unlockAt.toLocaleString()} kills`}>
          <div className="unlock-bar">
            <div className="unlock-fill" style={{ width: `${Math.min(100, ((kills - prevThreshold) / (next.unlockAt - prevThreshold)) * 100)}%` }} />
          </div>
          <div className="unlock-label">NEXT: {next.name} · {kills.toLocaleString()} / {next.unlockAt.toLocaleString()} hulls</div>
        </div>
      )}
      {dailyMode && (
        <div className="unlock-track daily-arsenal" title="Daily arsenal is fixed for this seed">
          <div className="unlock-label">DAILY ARSENAL: {game.dailyTowerIds?.size ?? 0} fixed instruments</div>
        </div>
      )}
      {placing ? (
        <div className="placing-hint">
          <b style={{ color: placing.glow }}>{placing.name}</b>
          <p>{placing.desc}</p>
        </div>
      ) : (
        <p className="hint-dim pad">1–0 select first ten · click map to build · Space launches</p>
      )}
    </div>
  );
}, (a, b) => a.sig === b.sig && a.placing === b.placing);

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

// Memoized like Shop: repaints only when the selected tower's shown state changes
// (tiers/commit/invested/kills/target/buffs) or affordability (credits).
const UpgradePanel = memo(function UpgradePanel({ game, tower, onSold, onCollapse }: {
  game: Game; tower: Tower; onSold: () => void; onCollapse?: () => void; sig: string;
}) {
  const def = tower.def;
  const s = tower.stats;
  const rank = Game.rankOf(tower);
  useEffect(() => { game.recorder.recordUpgradePanelOpen(tower); }, [game, tower]);
  return (
    <div className="panel tower-detail panel-grow" style={{ borderColor: def.color }}>
      <div className="panel-head">
        <button className="back-btn" onClick={() => { onSold(); sfx.click(); }}>← ALL TOWERS</button>
        {onCollapse && <button className="panel-collapse" title="Collapse panel" aria-label="Collapse upgrade panel" onClick={onCollapse}>⟩</button>}
      </div>
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
}, (a, b) => a.tower === b.tower && a.sig === b.sig);

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
  if (game.diff.id === 'ngplus') return null;
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

// INTEL panel (Archive + Threat Codex) temporarily removed from the sidebar.
// The ArchivePanel / Codex components were here — recover from git history when re-adding.
