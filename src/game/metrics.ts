export const METRIC_EVENTS = {
  MENU_TAB_SWITCH: 'menu_tab_switch',
  MENU_MAP_SELECT: 'menu_map_select',
  LOCKED_MAP_CLICK: 'locked_map_click',
  MENU_PROTOCOL_SELECT: 'menu_protocol_select',
  LOCKED_PROTOCOL_CLICK: 'locked_protocol_click',
  DEPLOY_ATTEMPT: 'deploy_attempt',
  LEADERBOARD_TAB_OPEN: 'leaderboard_tab_open',
  LEADERBOARD_MODE_TOGGLE: 'leaderboard_mode_toggle',
  FIRST_PAUSE: 'first_pause',
  SPEED_CHANGE: 'speed_change',
  SIDE_PANEL_COLLAPSE: 'side_panel_collapse',
  SIDE_PANEL_EXPAND: 'side_panel_expand',
  ABORT_ARMED: 'abort_armed',
  ABORT_CONFIRMED: 'abort_confirmed',
  ABILITY_AIM_CANCEL: 'ability_aim_cancel',
  PLACEMENT_CANCEL: 'placement_cancel',
  WAVE_LAUNCH_CLICK: 'wave_launch_click',
  WAVE_LAUNCH_KEY: 'wave_launch_key',
  AUTO_TOGGLE: 'auto_toggle',
  SOUND_TOGGLE: 'sound_toggle',
  MUSIC_TOGGLE: 'music_toggle',
  TUTORIAL_VIEW: 'tutorial_view',
  TUTORIAL_DISMISS: 'tutorial_dismiss',
  BRIEFING_VIEW: 'briefing_view',
  BRIEFING_DISMISS: 'briefing_dismiss',
  CLOAK_TIP_VIEW: 'cloak_tip_view',
  CLOAK_TIP_DISMISS: 'cloak_tip_dismiss',
  AI_WIDGET_OPEN: 'ai_widget_open',
  AI_HELP_SUBMIT: 'ai_help_submit',
  AI_HELP_SUCCESS: 'ai_help_success',
  AI_HELP_ERROR: 'ai_help_error',
  AI_HELP_QUOTA: 'ai_help_quota',
  FEEDBACK_WIDGET_OPEN: 'feedback_widget_open',
  FEEDBACK_SUBMIT: 'feedback_submit',
  FEEDBACK_SUCCESS: 'feedback_success',
  FEEDBACK_ERROR: 'feedback_error',
  FEEDBACK_REPLY_VIEW: 'feedback_reply_view',
  QUALITY_DOWNGRADE: 'quality_downgrade',
  QUALITY_RECOVER: 'quality_recover',
  FREEPLAY_ENTER: 'freeplay_enter',
  FREEPLAY_CONTRACT_SELECT: 'freeplay_contract_select',
  FREEPLAY_DAILY_START: 'freeplay_daily_start',
  FREEPLAY_RELIC_OFFER: 'freeplay_relic_offer',
  FREEPLAY_RELIC_SELECT: 'freeplay_relic_select',
  FREEPLAY_RISK_OFFER: 'freeplay_risk_offer',
  FREEPLAY_RISK_ACCEPT: 'freeplay_risk_accept',
  FREEPLAY_RISK_DECLINE: 'freeplay_risk_decline',
  FREEPLAY_RISK_CLEAR: 'freeplay_risk_clear',
  FREEPLAY_CHECKPOINT_SUBMIT: 'freeplay_checkpoint_submit',
  FREEPLAY_MUTATOR_WAVE_START: 'freeplay_mutator_wave_start',
  FREEPLAY_RIVAL_SPAWN: 'freeplay_rival_spawn',
  FREEPLAY_RIVAL_DEFEAT: 'freeplay_rival_defeat',
} as const;

export type MetricEventName = typeof METRIC_EVENTS[keyof typeof METRIC_EVENTS];
export type InputKind = 'keyboard' | 'pointer' | 'touch';

export interface AppMetricSnapshot {
  menu: {
    pageAgeAtDeployS: number;
    deployAttempts: number;
    deployBlocked: number;
    firstDeployAtS: number;
    tabSwitches: number;
    deployTabOpens: number;
    leaderboardTabOpens: number;
    selectedMap: string | null;
    selectedDiff: string | null;
    mapSelections: Record<string, number>;
    protocolSelections: Record<string, number>;
    lockedMapClicks: Record<string, number>;
    lockedProtocolClicks: Record<string, number>;
  };
  controls: {
    keyboardInputs: number;
    pointerInputs: number;
    touchInputs: number;
    soundToggles: number;
    musicToggles: number;
  };
  assistance: {
    aiMenuOpens: number;
    aiGameOpens: number;
    aiQuestions: number;
    aiSuccesses: number;
    aiErrors: number;
    aiQuotaErrors: number;
    feedbackMenuOpens: number;
    feedbackGameOpens: number;
    feedbackSubmits: number;
    feedbackSuccesses: number;
    feedbackErrors: number;
    feedbackRepliesViewed: number;
  };
  leaderboard: {
    menuOpens: number;
    campaignModeClicks: number;
    freeplayModeClicks: number;
  };
  performance: {
    qualityDowngrades: number;
    qualityRecoveries: number;
    displayStandalone: boolean;
    installPromptSeen: number;
    installed: number;
  };
}

const pageLoadedAt = nowMs();
let pending = freshSnapshot();
let active = freshSnapshot();
let activeRun = false;

export const appMetrics = {
  beginRun(mapId: string, diffId: string): AppMetricSnapshot {
    active = clone(pending);
    activeRun = true;
    active.menu.selectedMap = mapId;
    active.menu.selectedDiff = diffId;
    active.menu.pageAgeAtDeployS = elapsedS();
    if (!active.menu.firstDeployAtS) active.menu.firstDeployAtS = elapsedS();
    pending = freshSnapshot();
    return clone(active);
  },

  endRun(): void {
    activeRun = false;
  },

  snapshot(): AppMetricSnapshot {
    return clone(activeRun ? active : pending);
  },

  recordMenuTab(tab: 'deploy' | 'board'): void {
    const metrics = target();
    metrics.menu.tabSwitches++;
    if (tab === 'deploy') metrics.menu.deployTabOpens++;
    else {
      metrics.menu.leaderboardTabOpens++;
      metrics.leaderboard.menuOpens++;
    }
  },

  recordMapSelect(mapId: string): void {
    const menu = target().menu;
    menu.selectedMap = cleanId(mapId);
    bump(menu.mapSelections, cleanId(mapId));
  },

  recordLockedMapClick(mapId: string): void {
    bump(target().menu.lockedMapClicks, cleanId(mapId));
  },

  recordProtocolSelect(diffId: string): void {
    const menu = target().menu;
    menu.selectedDiff = cleanId(diffId);
    bump(menu.protocolSelections, cleanId(diffId));
  },

  recordLockedProtocolClick(diffId: string): void {
    bump(target().menu.lockedProtocolClicks, cleanId(diffId));
  },

  recordDeployAttempt(mapId: string, diffId: string, unlocked: boolean): void {
    const menu = target().menu;
    menu.deployAttempts++;
    if (!unlocked) menu.deployBlocked++;
    menu.selectedMap = cleanId(mapId);
    menu.selectedDiff = cleanId(diffId);
    if (!menu.firstDeployAtS) menu.firstDeployAtS = elapsedS();
  },

  recordLeaderboardMode(freeplay: boolean): void {
    const leaderboard = target().leaderboard;
    if (freeplay) leaderboard.freeplayModeClicks++;
    else leaderboard.campaignModeClicks++;
  },

  recordInput(kind: InputKind): void {
    const controls = target().controls;
    if (kind === 'keyboard') controls.keyboardInputs++;
    else if (kind === 'touch') controls.touchInputs++;
    else controls.pointerInputs++;
  },

  recordSoundToggle(kind: 'sound' | 'music'): void {
    const controls = target().controls;
    if (kind === 'sound') controls.soundToggles++;
    else controls.musicToggles++;
  },

  recordAIWidget(open: boolean, placement: 'menu' | 'game'): void {
    if (!open) return;
    const assistance = target().assistance;
    if (placement === 'game') assistance.aiGameOpens++;
    else assistance.aiMenuOpens++;
  },

  recordAIQuestion(result: 'submit' | 'success' | 'error' | 'quota'): void {
    const assistance = target().assistance;
    if (result === 'submit') assistance.aiQuestions++;
    else if (result === 'success') assistance.aiSuccesses++;
    else if (result === 'quota') {
      assistance.aiErrors++;
      assistance.aiQuotaErrors++;
    } else assistance.aiErrors++;
  },

  recordFeedbackWidget(open: boolean, ctx: string): void {
    if (!open) return;
    const assistance = target().assistance;
    if (ctx === 'game') assistance.feedbackGameOpens++;
    else assistance.feedbackMenuOpens++;
  },

  recordFeedbackSubmit(ok: boolean): void {
    const assistance = target().assistance;
    assistance.feedbackSubmits++;
    if (ok) assistance.feedbackSuccesses++;
    else assistance.feedbackErrors++;
  },

  recordFeedbackReplyViewed(count = 1): void {
    target().assistance.feedbackRepliesViewed += Math.max(0, Math.floor(count));
  },

  recordQualityChange(lite: boolean): void {
    const performance = target().performance;
    if (lite) performance.qualityDowngrades++;
    else performance.qualityRecoveries++;
  },

  recordDisplayMode(standalone: boolean): void {
    target().performance.displayStandalone = standalone;
  },

  recordInstallPromptSeen(): void {
    target().performance.installPromptSeen++;
  },

  recordInstalled(): void {
    target().performance.installed++;
  },
};

function freshSnapshot(): AppMetricSnapshot {
  return {
    menu: {
      pageAgeAtDeployS: 0,
      deployAttempts: 0,
      deployBlocked: 0,
      firstDeployAtS: 0,
      tabSwitches: 0,
      deployTabOpens: 0,
      leaderboardTabOpens: 0,
      selectedMap: null,
      selectedDiff: null,
      mapSelections: {},
      protocolSelections: {},
      lockedMapClicks: {},
      lockedProtocolClicks: {},
    },
    controls: {
      keyboardInputs: 0,
      pointerInputs: 0,
      touchInputs: 0,
      soundToggles: 0,
      musicToggles: 0,
    },
    assistance: {
      aiMenuOpens: 0,
      aiGameOpens: 0,
      aiQuestions: 0,
      aiSuccesses: 0,
      aiErrors: 0,
      aiQuotaErrors: 0,
      feedbackMenuOpens: 0,
      feedbackGameOpens: 0,
      feedbackSubmits: 0,
      feedbackSuccesses: 0,
      feedbackErrors: 0,
      feedbackRepliesViewed: 0,
    },
    leaderboard: {
      menuOpens: 0,
      campaignModeClicks: 0,
      freeplayModeClicks: 0,
    },
    performance: {
      qualityDowngrades: 0,
      qualityRecoveries: 0,
      displayStandalone: false,
      installPromptSeen: 0,
      installed: 0,
    },
  };
}

function target(): AppMetricSnapshot {
  return activeRun ? active : pending;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function cleanId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function elapsedS(): number {
  return Math.max(0, Math.round((nowMs() - pageLoadedAt) / 100) / 10);
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
