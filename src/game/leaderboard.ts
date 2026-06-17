// Global leaderboards, feedback, and telemetry on Firestore.
// Firebase web config is public by design; access control lives in firestore.rules.

import {
  addDoc,
  collection,
  doc as firestoreDoc,
  getDoc,
  getDocs,
  limit as limitResults,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebaseClient';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { progress } from './storage';
import type { PrivateRunAnalyticsDoc, RunCheckpointDoc, RunUploadBundle } from './runTelemetry';

const VALID_MAPS = new Set(ALL_MAPS.map((m) => m.id));
const VALID_DIFFS = new Set(DIFFICULTIES.map((d) => d.id));
const LEADERBOARD_CACHE_TTL_MS = 30_000;
const topCache = new Map<string, { expires: number; rows: ScoreEntry[] }>();
const globalTopCache = new Map<string, { expires: number; rows: RankedScoreEntry[] }>();

export interface ScoreEntry {
  name: string;
  cash: number;
  kills: number;
  wave: number;
  freeplay: boolean;
  ts: number;
  uid?: string;
  runId?: string;
  meta?: string;
  daily?: string;
  checkpoint?: boolean;
}

export interface RankedScoreEntry extends ScoreEntry {
  board: string;
  map: string;
  diff: string;
  mapName: string;
  diffName: string;
}

function cloneScores<T extends ScoreEntry>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/** board id for a mode: mapId_diffId, with _fp for freeplay runs */
export function boardId(mapId: string, diffId: string, freeplay: boolean): string {
  return `${mapId}_${diffId}${freeplay ? '_fp' : ''}`;
}

function validBoard(board: string): boolean {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  return !!match?.groups && VALID_MAPS.has(match.groups.map) && VALID_DIFFS.has(match.groups.diff);
}

function isValidRunId(id: string): boolean {
  return /^r_[A-Za-z0-9_-]{8,80}$/.test(id);
}

function invalidateBoardCache(board: string): void {
  for (const key of topCache.keys()) {
    if (key.startsWith(`${board}:`)) topCache.delete(key);
  }
  globalTopCache.clear();
}

function boardMeta(board: string): Omit<RankedScoreEntry, keyof ScoreEntry> | null {
  const match = /^(?<map>[a-z]+)_(?<diff>[a-z]+)(?:_fp)?$/.exec(board);
  if (!match?.groups || !VALID_MAPS.has(match.groups.map) || !VALID_DIFFS.has(match.groups.diff)) return null;
  const map = ALL_MAPS.find((m) => m.id === match.groups!.map);
  const diff = DIFFICULTIES.find((d) => d.id === match.groups!.diff);
  return {
    board,
    map: match.groups.map,
    diff: match.groups.diff,
    mapName: map?.name ?? match.groups.map,
    diffName: diff?.name ?? match.groups.diff,
  };
}

export async function submitScore(board: string, entry: ScoreEntry): Promise<boolean> {
  if (!validBoard(board)) return false;
  try {
    const payload: ScoreEntry = {
      name: entry.name.slice(0, 20),
      cash: Math.max(0, Math.floor(entry.cash)),
      kills: Math.max(0, Math.floor(entry.kills)),
      wave: Math.max(0, Math.floor(entry.wave)),
      freeplay: entry.freeplay,
      ts: Math.floor(entry.ts),
      uid: (entry.uid ?? progress.uid).slice(0, 40),
    };
    if (entry.runId && isValidRunId(entry.runId)) payload.runId = entry.runId;
    if (entry.meta) payload.meta = entry.meta.slice(0, 240);
    if (entry.daily) payload.daily = entry.daily.slice(0, 80);
    if (entry.checkpoint !== undefined) payload.checkpoint = !!entry.checkpoint;
    await addDoc(collection(db, 'boards', board, 'scores'), payload);
    invalidateBoardCache(board);
    return true;
  } catch (error) {
    console.warn('Score submit failed', error);
    return false;
  }
}

/** player feedback -> feedback collection. A local per-device id correlates replies without login. */
export async function submitFeedback(text: string, ctx: string): Promise<string | null> {
  try {
    const ref = await addDoc(collection(db, 'feedback'), {
      uid: progress.uid,
      text: text.slice(0, 1000),
      ts: Date.now(),
      ctx: ctx.slice(0, 200),
      status: 'open',
    });
    return ref.id;
  } catch (error) {
    console.warn('Feedback submit failed', error);
    return null;
  }
}

export interface FeedbackReply {
  id: string;
  text: string;
  ctx: string;
  ts: number;
  reply: string;
  replyTs: number;
  status: string;
}

type FeedbackData = {
  text?: string;
  ctx?: string;
  ts?: number;
  reply?: string;
  replyTs?: number;
  status?: string;
};

/** Fetch only feedback documents this browser created, so replies can show without player login. */
export async function fetchFeedbackReplies(ids: string[]): Promise<FeedbackReply[]> {
  const clean = [...new Set(ids)]
    .filter((id) => /^[A-Za-z0-9_-]{8,80}$/.test(id))
    .slice(-20);
  if (clean.length === 0) return [];
  try {
    const snaps = await Promise.all(clean.map(async (id) => {
      try {
        return await getDoc(firestoreDoc(db, 'feedback', id));
      } catch {
        return null;
      }
    }));
    return snaps
      .filter((snap): snap is NonNullable<typeof snap> => snap !== null && snap.exists())
      .map((snap) => {
        const data = snap.data() as FeedbackData;
        return {
          id: snap.id,
          text: data.text ?? '',
          ctx: data.ctx ?? '',
          ts: Number(data.ts ?? 0),
          reply: data.reply ?? '',
          replyTs: Number(data.replyTs ?? 0),
          status: data.status ?? 'open',
        };
      })
      .filter((row) => !!row.reply);
  } catch (error) {
    console.warn('Feedback reply fetch failed', error);
    return [];
  }
}

/** Build/version tag stamped on every telemetry event, so the dashboard can compare
 *  player outcomes BEFORE vs AFTER a balance patch. Bump this when you ship changes. */
export const TELEMETRY_BUILD = 'hollow-1';

export interface TelemetryEvent {
  kind: string;
  map: string;
  diff: string;
  wave: number;
  kills: number;
  cash: number;
  won: boolean;
  freeplay: boolean;
  durationS: number;
  leaks?: number;
  coresLeft?: number;
  /** comma-separated tower def ids fielded this run (for popularity analysis) */
  towers?: string;
  /** top damage contributors this run: "towerId:pct,..." (causal "who carried") */
  dmg?: string;
  /** commander abilities cast this run */
  abilities?: number;
  /** stamped automatically from TELEMETRY_BUILD — don't pass at the call site */
  build?: string;
}

/** anonymous gameplay telemetry -> telemetry collection (write-only for players). */
export function logTelemetry(e: TelemetryEvent): void {
  void (async () => {
    try {
      await addDoc(collection(db, 'telemetry'), {
        uid: progress.uid,
        ts: Date.now(),
        kind: e.kind.slice(0, 30),
        map: e.map.slice(0, 30),
        diff: e.diff.slice(0, 30),
        wave: Math.max(0, Math.floor(e.wave)),
        kills: Math.max(0, Math.floor(e.kills)),
        cash: Math.max(0, Math.floor(e.cash)),
        won: e.won,
        freeplay: e.freeplay,
        durationS: Math.max(0, Math.floor(e.durationS)),
        leaks: Math.max(0, Math.floor(e.leaks ?? 0)),
        coresLeft: Math.max(0, Math.floor(e.coresLeft ?? 0)),
        towers: (e.towers ?? '').slice(0, 200),
        dmg: (e.dmg ?? '').slice(0, 120),
        abilities: Math.max(0, Math.floor(e.abilities ?? 0)),
        build: TELEMETRY_BUILD.slice(0, 30),
      });
    } catch (error) {
      console.warn('Telemetry log failed', error);
      // Fire-and-forget telemetry must never affect the game loop.
    }
  })();
}

export async function submitRunReplay(bundle: RunUploadBundle): Promise<boolean> {
  if (!isValidRunId(bundle.run.runId)) return false;
  try {
    await setDoc(firestoreDoc(db, 'runs', bundle.run.runId), bundle.run);
    await Promise.all(bundle.chunks.map((chunk) =>
      setDoc(firestoreDoc(db, 'runs', bundle.run.runId, 'chunks', `c${chunk.chunk}`), chunk)));
    return true;
  } catch (error) {
    console.warn('Run replay submit failed', error);
    return false;
  }
}

export async function submitRunAnalytics(doc: PrivateRunAnalyticsDoc): Promise<boolean> {
  if (!isValidRunId(doc.runId)) return false;
  try {
    await setDoc(firestoreDoc(db, 'runAnalytics', doc.runId), doc, { merge: true });
    return true;
  } catch (error) {
    console.warn('Run analytics submit failed', error);
    return false;
  }
}

export async function submitRunCheckpoint(doc: RunCheckpointDoc): Promise<boolean> {
  if (!isValidRunId(doc.runId)) return false;
  try {
    const chunkId = `c${String(Math.max(0, Math.floor(doc.chunk))).padStart(6, '0')}`;
    await setDoc(firestoreDoc(db, 'runCheckpoints', doc.runId, 'chunks', chunkId), doc);
    return true;
  } catch (error) {
    console.warn('Run checkpoint submit failed', error);
    return false;
  }
}

export interface TelemetryRow extends TelemetryEvent {
  uid: string;
  ts: number;
}

type TelemetryData = TelemetryRow;

export interface RunAnalyticsRow extends PrivateRunAnalyticsDoc {
  id: string;
}

function normalizeRunAnalytics(id: string, data: Partial<PrivateRunAnalyticsDoc>): RunAnalyticsRow {
  const summary = {
    callsign: '',
    map: '',
    mapName: '',
    diff: '',
    diffName: '',
    freeplay: false,
    outcome: 'abandoned' as const,
    phase: '',
    wave: 0,
    kills: 0,
    credits: 0,
    cashEarned: 0,
    leaks: 0,
    coresLeft: 0,
    durationS: 0,
    ...(data.summary ?? {}),
  };
  const appMenu = (data.menu ?? {}) as Partial<PrivateRunAnalyticsDoc['menu']>;
  const appControls = (data.controls ?? {}) as Partial<PrivateRunAnalyticsDoc['controls']>;
  const assistance = (data.assistance ?? {}) as Partial<PrivateRunAnalyticsDoc['assistance']>;
  const freeplay = (data.freeplay ?? {}) as Partial<PrivateRunAnalyticsDoc['freeplay']>;
  const performance = (data.performance ?? {}) as Partial<PrivateRunAnalyticsDoc['performance']>;
  return {
    id,
    schemaVersion: Number(data.schemaVersion ?? 1),
    runId: data.runId ?? id,
    uid: data.uid ?? '',
    createdAt: Number(data.createdAt ?? 0),
    endedAt: Number(data.endedAt ?? data.createdAt ?? 0),
    build: data.build ?? '',
    summary,
    onboarding: data.onboarding ?? {},
    abandonment: data.abandonment ?? {},
    difficulty: data.difficulty ?? {},
    economy: data.economy ?? {},
    menu: {
      pageAgeAtDeployS: Number(appMenu.pageAgeAtDeployS ?? 0),
      deployAttempts: Number(appMenu.deployAttempts ?? 0),
      deployBlocked: Number(appMenu.deployBlocked ?? 0),
      firstDeployAtS: Number(appMenu.firstDeployAtS ?? 0),
      tabSwitches: Number(appMenu.tabSwitches ?? 0),
      deployTabOpens: Number(appMenu.deployTabOpens ?? 0),
      leaderboardTabOpens: Number(appMenu.leaderboardTabOpens ?? 0),
      selectedMap: appMenu.selectedMap ?? null,
      selectedDiff: appMenu.selectedDiff ?? null,
      mapSelections: appMenu.mapSelections ?? {},
      protocolSelections: appMenu.protocolSelections ?? {},
      lockedMapClicks: appMenu.lockedMapClicks ?? {},
      lockedProtocolClicks: appMenu.lockedProtocolClicks ?? {},
    },
    controls: {
      keyboardInputs: Number(appControls.keyboardInputs ?? 0),
      pointerInputs: Number(appControls.pointerInputs ?? 0),
      touchInputs: Number(appControls.touchInputs ?? 0),
      soundToggles: Number(appControls.soundToggles ?? 0),
      musicToggles: Number(appControls.musicToggles ?? 0),
      pauseToggles: Number(appControls.pauseToggles ?? 0),
      firstPauseAt: Number(appControls.firstPauseAt ?? 0),
      speedChanges: Number(appControls.speedChanges ?? 0),
      speed1Clicks: Number(appControls.speed1Clicks ?? 0),
      speed2Clicks: Number(appControls.speed2Clicks ?? 0),
      speed4Clicks: Number(appControls.speed4Clicks ?? 0),
      autoToggles: Number(appControls.autoToggles ?? 0),
      sidePanelCollapses: Number(appControls.sidePanelCollapses ?? 0),
      sidePanelExpands: Number(appControls.sidePanelExpands ?? 0),
      abortArmed: Number(appControls.abortArmed ?? 0),
      abortConfirmed: Number(appControls.abortConfirmed ?? 0),
      placementCancels: Number(appControls.placementCancels ?? 0),
      abilityAimCancels: Number(appControls.abilityAimCancels ?? 0),
      waveLaunchClicks: Number(appControls.waveLaunchClicks ?? 0),
      waveLaunchKeys: Number(appControls.waveLaunchKeys ?? 0),
      cloakTipViews: Number(appControls.cloakTipViews ?? 0),
      tutorialViews: Number(appControls.tutorialViews ?? 0),
      briefingViews: Number(appControls.briefingViews ?? 0),
    },
    combat: {
      firstLeakWave: Number(data.combat?.firstLeakWave ?? 0),
      biggestLeakWave: Number(data.combat?.biggestLeakWave ?? 0),
      biggestLeakCores: Number(data.combat?.biggestLeakCores ?? 0),
      leaksByEnemy: data.combat?.leaksByEnemy ?? {},
      cloakedLeakCores: Number(data.combat?.cloakedLeakCores ?? 0),
      revealedLeakCores: Number(data.combat?.revealedLeakCores ?? 0),
      armoredLeakCores: Number(data.combat?.armoredLeakCores ?? 0),
      bossLeakCores: Number(data.combat?.bossLeakCores ?? 0),
      peakEnemies: Number(data.combat?.peakEnemies ?? 0),
      waveStarts: Number(data.combat?.waveStarts ?? 0),
      waveEnds: Number(data.combat?.waveEnds ?? 0),
      avgWaveDurationS: Number(data.combat?.avgWaveDurationS ?? 0),
      longestWaveDurationS: Number(data.combat?.longestWaveDurationS ?? 0),
      enemiesAtEnd: Number(data.combat?.enemiesAtEnd ?? 0),
      abilityCasts: data.combat?.abilityCasts ?? {},
      pickupCollects: data.combat?.pickupCollects ?? {},
    },
    placement: {
      firstTowerId: data.placement?.firstTowerId ?? null,
      buildOrder: data.placement?.buildOrder ?? [],
      upgradeOrder: data.placement?.upgradeOrder ?? [],
      placedByTower: data.placement?.placedByTower ?? {},
      soldByTower: data.placement?.soldByTower ?? {},
      failedByReason: data.placement?.failedByReason ?? {},
      failedByTower: data.placement?.failedByTower ?? {},
      failedUpgradeByReason: data.placement?.failedUpgradeByReason ?? {},
      placementCells: data.placement?.placementCells ?? {},
      failedPlacementCells: data.placement?.failedPlacementCells ?? {},
      sellCells: data.placement?.sellCells ?? {},
      beaconZonePlacements: Number(data.placement?.beaconZonePlacements ?? 0),
      darkZonePlacements: Number(data.placement?.darkZonePlacements ?? 0),
      blueprintSaves: Number(data.placement?.blueprintSaves ?? 0),
      blueprintApplies: Number(data.placement?.blueprintApplies ?? 0),
      blueprintApplyPlaced: Number(data.placement?.blueprintApplyPlaced ?? 0),
      targetModeChanges: Number(data.placement?.targetModeChanges ?? 0),
      quickSellbacks: Number(data.placement?.quickSellbacks ?? 0),
    },
    assistance: {
      aiMenuOpens: Number(assistance.aiMenuOpens ?? 0),
      aiGameOpens: Number(assistance.aiGameOpens ?? 0),
      aiQuestions: Number(assistance.aiQuestions ?? 0),
      aiSuccesses: Number(assistance.aiSuccesses ?? 0),
      aiErrors: Number(assistance.aiErrors ?? 0),
      aiQuotaErrors: Number(assistance.aiQuotaErrors ?? 0),
      feedbackMenuOpens: Number(assistance.feedbackMenuOpens ?? 0),
      feedbackGameOpens: Number(assistance.feedbackGameOpens ?? 0),
      feedbackSubmits: Number(assistance.feedbackSubmits ?? 0),
      feedbackSuccesses: Number(assistance.feedbackSuccesses ?? 0),
      feedbackErrors: Number(assistance.feedbackErrors ?? 0),
      feedbackRepliesViewed: Number(assistance.feedbackRepliesViewed ?? 0),
      widgetPauseS: Number(assistance.widgetPauseS ?? 0),
    },
    freeplay: {
      entered: Boolean(freeplay.entered ?? summary.freeplay),
      contractId: freeplay.contractId ?? null,
      dailyId: freeplay.dailyId ?? null,
      scoreMultiplierEnd: Number(freeplay.scoreMultiplierEnd ?? 1),
      contractSelections: freeplay.contractSelections ?? {},
      relicOffers: Number(freeplay.relicOffers ?? 0),
      relicSelections: freeplay.relicSelections ?? {},
      riskOffers: freeplay.riskOffers ?? {},
      riskAccepted: freeplay.riskAccepted ?? {},
      riskDeclined: freeplay.riskDeclined ?? {},
      riskCleared: freeplay.riskCleared ?? {},
      checkpointSubmits: Number(freeplay.checkpointSubmits ?? 0),
      mutatorWaves: freeplay.mutatorWaves ?? {},
      rivalSpawns: freeplay.rivalSpawns ?? {},
      rivalDefeats: freeplay.rivalDefeats ?? {},
    },
    towerInterest: {
      shopOpens: Number(data.towerInterest?.shopOpens ?? 0),
      shopSelections: data.towerInterest?.shopSelections ?? {},
      lockedTowerClicks: data.towerInterest?.lockedTowerClicks ?? {},
      unaffordableTowerClicks: data.towerInterest?.unaffordableTowerClicks ?? {},
      failedPlacements: Number(data.towerInterest?.failedPlacements ?? 0),
      upgradePanelOpens: Number(data.towerInterest?.upgradePanelOpens ?? 0),
      upgradePanelByTower: data.towerInterest?.upgradePanelByTower ?? {},
      failedUpgrades: Number(data.towerInterest?.failedUpgrades ?? 0),
      quickSellbacks: Number(data.towerInterest?.quickSellbacks ?? 0),
      targetModeChanges: Number(data.towerInterest?.targetModeChanges ?? 0),
      abilityUses: data.towerInterest?.abilityUses ?? {},
      pickupCollects: data.towerInterest?.pickupCollects ?? {},
    },
    progression: {
      lifetimeKillsAtStart: Number(data.progression?.lifetimeKillsAtStart ?? 0),
      runsBeforeStart: Number(data.progression?.runsBeforeStart ?? 0),
      victoriesBeforeStart: Number(data.progression?.victoriesBeforeStart ?? 0),
      firstSeenAt: Number(data.progression?.firstSeenAt ?? 0),
      lastSeenAt: Number(data.progression?.lastSeenAt ?? 0),
      sessions: Number(data.progression?.sessions ?? 0),
      sessionsToday: Number(data.progression?.sessionsToday ?? 0),
      daysSinceFirstSeen: Number(data.progression?.daysSinceFirstSeen ?? 0),
      daysSinceLastSeen: Number(data.progression?.daysSinceLastSeen ?? 0),
      unlocksEarned: data.progression?.unlocksEarned ?? [],
      unlocksViewed: data.progression?.unlocksViewed ?? [],
      unlockedTowerIdsUsed: data.progression?.unlockedTowerIdsUsed ?? [],
    },
    leaderboard: data.leaderboard ?? {},
    attention: {
      activeS: Number(data.attention?.activeS ?? 0),
      hiddenS: Number(data.attention?.hiddenS ?? 0),
      idleS: Number(data.attention?.idleS ?? 0),
      pausedS: Number(data.attention?.pausedS ?? 0),
      focusLosses: Number(data.attention?.focusLosses ?? 0),
      sessionS: Number(data.attention?.sessionS ?? 0),
      sidePanelS: Number(data.attention?.sidePanelS ?? 0),
      shopPanelS: Number(data.attention?.shopPanelS ?? 0),
      upgradePanelS: Number(data.attention?.upgradePanelS ?? 0),
      overlayS: Number(data.attention?.overlayS ?? 0),
      widgetOpenS: Number(data.attention?.widgetOpenS ?? 0),
      speed1S: Number(data.attention?.speed1S ?? 0),
      speed2S: Number(data.attention?.speed2S ?? 0),
      speed4S: Number(data.attention?.speed4S ?? 0),
    },
    performance: {
      viewportW: Number(performance.viewportW ?? 0),
      viewportH: Number(performance.viewportH ?? 0),
      devicePixelRatio: Number(performance.devicePixelRatio ?? 1),
      fpsMin: Number(performance.fpsMin ?? 0),
      fpsAvg: Number(performance.fpsAvg ?? 0),
      fpsSamples: Number(performance.fpsSamples ?? 0),
      longFrames: Number(performance.longFrames ?? 0),
      qualityDowngrades: Number(performance.qualityDowngrades ?? 0),
      qualityRecoveries: Number(performance.qualityRecoveries ?? 0),
      displayStandalone: Boolean(performance.displayStandalone ?? false),
      installPromptSeen: Number(performance.installPromptSeen ?? 0),
      installed: Number(performance.installed ?? 0),
      userAgent: performance.userAgent ?? '',
    },
  };
}

/** Admin-only: read recent telemetry events for the dashboard. */
export async function fetchTelemetry(limit = 1000): Promise<TelemetryRow[]> {
  try {
    const q = query(collection(db, 'telemetry'), orderBy('ts', 'desc'), limitResults(limit));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as Partial<TelemetryData>;
      return {
        uid: data.uid ?? '',
        ts: Number(data.ts ?? 0),
        kind: data.kind ?? '',
        map: data.map ?? '',
        diff: data.diff ?? '',
        wave: Number(data.wave ?? 0),
        kills: Number(data.kills ?? 0),
        cash: Number(data.cash ?? 0),
        won: data.won ?? false,
        freeplay: data.freeplay ?? false,
        durationS: Number(data.durationS ?? 0),
        leaks: Number(data.leaks ?? 0),
        coresLeft: Number(data.coresLeft ?? 0),
        towers: data.towers ?? '',
        dmg: data.dmg ?? '',
        abilities: Number(data.abilities ?? 0),
        build: data.build ?? '',
      };
    });
  } catch {
    return [];
  }
}

export async function fetchRunAnalytics(limit = 1000): Promise<RunAnalyticsRow[]> {
  try {
    const q = query(collection(db, 'runAnalytics'), orderBy('endedAt', 'desc'), limitResults(limit));
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeRunAnalytics(d.id, d.data() as Partial<PrivateRunAnalyticsDoc>));
  } catch {
    return [];
  }
}

export async function fetchTop(board: string, limit = 10): Promise<ScoreEntry[]> {
  if (!validBoard(board)) return [];
  const cacheKey = `${board}:${limit}`;
  const cached = topCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cloneScores(cached.rows);
  const sortField = board.endsWith('_fp') ? 'wave' : 'cash';
  try {
    const q = query(collection(db, 'boards', board, 'scores'), orderBy(sortField, 'desc'), limitResults(limit));
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => {
      const data = d.data() as Partial<ScoreEntry>;
      return {
        name: data.name ?? '???',
        cash: Number(data.cash ?? 0),
        kills: Number(data.kills ?? 0),
        wave: Number(data.wave ?? 0),
        freeplay: data.freeplay ?? false,
        ts: Number(data.ts ?? 0),
        uid: data.uid ?? '',
        runId: data.runId ?? '',
        meta: data.meta ?? '',
        daily: data.daily ?? '',
        checkpoint: data.checkpoint ?? false,
      };
    });
    topCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows });
    return cloneScores(rows);
  } catch {
    return [];
  }
}

export async function fetchGlobalTop(freeplay: boolean, limit = 20): Promise<RankedScoreEntry[]> {
  const cacheKey = `${freeplay ? 'fp' : 'campaign'}:${limit}`;
  const cached = globalTopCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cloneScores(cached.rows);
  const boards = ALL_MAPS.flatMap((map) =>
    DIFFICULTIES.map((diff) => boardId(map.id, diff.id, freeplay)));
  const perBoardLimit = Math.max(3, Math.min(10, limit));
  const rows = await Promise.all(boards.map(async (board) => {
    const meta = boardMeta(board);
    if (!meta) return [];
    const scores = await fetchTop(board, perBoardLimit);
    return scores.map((score) => ({ ...score, ...meta }));
  }));
  const sortField: keyof ScoreEntry = freeplay ? 'wave' : 'cash';
  const sorted = rows
    .flat()
    .sort((a, b) => (Number(b[sortField]) - Number(a[sortField])) || b.kills - a.kills || b.ts - a.ts)
    .slice(0, limit)
    .map((row) => ({ ...row }));
  globalTopCache.set(cacheKey, { expires: Date.now() + LEADERBOARD_CACHE_TTL_MS, rows: sorted });
  return cloneScores(sorted);
}
