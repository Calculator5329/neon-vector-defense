import { ABILITIES } from './abilities';
import { ENEMIES, rbe } from './enemies';
import type { Game } from './engine';
import { ALL_MAPS, DIFFICULTIES } from './maps';
import { progress, type RunRecord } from './storage';
import { TOWERS_BY_UNLOCK } from './towers';
import type { DifficultyDef, GameMap, Tower } from './types';
import { getWave } from './waves';

type AIRecentRun = Omit<RunRecord, 'date'>;

export interface AIHelpContext {
  screen: 'menu' | 'game';
  selectedMap: string;
  selectedProtocol: string;
  ui: {
    mainMenuTabs: string[];
    startRun: string;
    sectorStep: string;
    protocolStep: string;
    leaderboardModes: string[];
    inRunButtons: string[];
    victoryButtons: string[];
    defeatButtons: string[];
    feedbackButton: string;
    aiButton: string;
    notes: string[];
  };
  player: {
    runs: number;
    victories: number;
    kills: number;
    totalWaves: number;
    clearedMaps: string[];
    apexCleared: boolean;
    freeplay: { runs: number; bestWave: number; kills: number };
    unlockedTowers: string[];
    nextTower: null | { name: string; killsNeeded: number; unlockAt: number };
    bestWaves: { map: string; best: number }[];
    recentRuns: AIRecentRun[];
    lastLoss?: AIRecentRun;
  };
  selection: {
    map: { id: string; name: string; desc: string; difficulty: string };
    protocol: { id: string; name: string; desc: string; waves: number; lives: number; cash: number };
  };
  liveRun?: {
    phase: string;
    wave: number;
    nextWave: number;
    freeplay: boolean;
    lives: number;
    startingLives: number;
    credits: number;
    kills: number;
    cashEarned: number;
    leaks: number;
    durationS: number;
    adaptation: string | null;
    towerCount: number;
    towers: Array<{ name: string; count: number; kills: number; tiers: string }>;
    selectedTower?: ReturnType<typeof towerSnapshot>;
    activeEnemies: Array<{ name: string; count: number; cloaked: number; revealed: number; traits: string[] }>;
    currentWave: ReturnType<typeof waveSnapshot>;
    upcomingWave: ReturnType<typeof waveSnapshot>;
    unlockedAbilities: string[];
    lockedAbilities: Array<{ name: string; unlockWave: number }>;
  };
  catalog: {
    sectors: Array<{ id: string; name: string; difficulty: string; desc: string }>;
    protocols: Array<{ id: string; name: string; waves: number; desc: string }>;
    towers: Array<{
      name: string;
      cost: number;
      unlockAt: number;
      damageType: string;
      desc: string;
      tracks: Array<{ name: string; upgrades: string[] }>;
    }>;
    enemies: Array<{ name: string; hp: number; speed: number; rbe: number; traits: string[]; children: string[]; lore: string }>;
    abilities: Array<{ name: string; unlockWave: number; desc: string }>;
  };
}

function traits(id: string, cloaked = false): string[] {
  const e = ENEMIES[id];
  const t: string[] = [];
  if (cloaked) t.push('phase-cloaked');
  if (e.armored) t.push('kinetic-resistant armored');
  if (e.immuneExplosive) t.push('explosive-immune');
  if (e.immuneCryo) t.push('cryo-immune');
  if (e.heal) t.push('healer');
  if (e.boss) t.push('boss/carrier');
  if (e.children.length > 0) t.push(`splits into ${e.children.map((c) => ENEMIES[c].name).join(', ')}`);
  return t;
}

function waveSnapshot(n: number, diff: DifficultyDef) {
  const allowCloak = diff.id !== 'easy';
  const groups = getWave(Math.max(1, n)).map((g) => ({
    enemy: ENEMIES[g.type].name,
    count: g.count,
    cloaked: allowCloak && !!g.cloaked,
    traits: traits(g.type, allowCloak && !!g.cloaked),
  }));
  return { wave: Math.max(1, n), groups };
}

function towerSnapshot(t: Tower) {
  return {
    name: t.def.name,
    kills: t.kills,
    target: t.target,
    trackA: `${t.def.tracks[0].name} tier ${t.tierA}`,
    trackB: `${t.def.tracks[1].name} tier ${t.tierB}`,
    committed: t.committed === null ? null : t.def.tracks[t.committed].name,
    damage: t.stats.damage,
    damageType: t.stats.damageType,
    range: Math.round(t.stats.range * t.rangeBuff),
    detection: t.stats.detection,
    slow: t.stats.slowPower > 0 ? Math.round(t.stats.slowPower * 100) : 0,
  };
}

function compactRuns(runs: RunRecord[]): AIRecentRun[] {
  return runs.slice(0, 5).map((r) => ({
    map: r.map,
    diff: r.diff,
    wave: r.wave,
    kills: r.kills,
    cash: r.cash,
    won: r.won,
    freeplay: r.freeplay,
    leaks: r.leaks,
    durationS: r.durationS,
    towers: r.towers,
  }));
}

export function buildAIHelpContext(args: {
  screen: 'menu' | 'game';
  map: GameMap;
  diff: DifficultyDef;
  game?: Game;
  selectedTower?: Tower | null;
}): AIHelpContext {
  const bankedKills = progress.record.kills + (args.game?.totalKills ?? 0);
  const dailyGame = args.game?.isDailyChallenge ? args.game : null;
  const unlockedTowers = dailyGame
    ? TOWERS_BY_UNLOCK.filter((t) => dailyGame.towerAvailable(t)).map((t) => t.name)
    : TOWERS_BY_UNLOCK.filter((t) => t.unlockAt <= bankedKills).map((t) => t.name);
  const next = dailyGame ? undefined : TOWERS_BY_UNLOCK.find((t) => t.unlockAt > bankedKills);
  const recentRuns = compactRuns(progress.history);
  const live = args.game;
  const currentWaveNumber = live ? Math.max(1, live.wave) : 1;
  const nextWaveNumber = live ? (live.phase === 'build' ? live.wave + 1 : live.wave) : 1;

  return {
    screen: args.screen,
    selectedMap: args.map.name,
    selectedProtocol: args.diff.name,
    ui: {
      mainMenuTabs: ['DEPLOY', 'LEADERBOARD'],
      startRun: 'DEPLOY',
      sectorStep: 'SELECT SECTOR',
      protocolStep: 'SELECT PROTOCOL',
      leaderboardModes: ['CAMPAIGN', 'FREEPLAY', 'DAILY'],
      inRunButtons: ['ABORT', 'AUTO', 'PAUSE', 'LAUNCH WAVE', 'ARSENAL'],
      victoryButtons: ['∞ FREEPLAY', 'MAIN MENU'],
      defeatButtons: ['RETRY SECTOR', 'MAIN MENU'],
      feedbackButton: 'message icon',
      aiButton: 'AI',
      notes: [
        'Use these exact UI labels in answers.',
        'Do not say START MISSION; the start button is DEPLOY.',
        'Freeplay is offered after victory as ∞ FREEPLAY.',
        'Daily Challenge is a separate daily protocol, not freeplay.',
      ],
    },
    player: {
      runs: progress.record.runs,
      victories: progress.record.victories,
      kills: progress.record.kills,
      totalWaves: progress.totalWaves,
      clearedMaps: ALL_MAPS.filter((m) => progress.mapCleared(m.id)).map((m) => m.name),
      apexCleared: progress.apexCleared,
      freeplay: progress.freeplay,
      unlockedTowers,
      nextTower: next ? { name: next.name, killsNeeded: next.unlockAt - bankedKills, unlockAt: next.unlockAt } : null,
      bestWaves: ALL_MAPS.map((m) => ({ map: m.name, best: progress.bestWaveAny(m.id) })).filter((m) => m.best > 0),
      recentRuns,
      lastLoss: recentRuns.find((r) => !r.won),
    },
    selection: {
      map: { id: args.map.id, name: args.map.name, desc: args.map.desc, difficulty: args.map.difficulty },
      protocol: {
        id: args.diff.id,
        name: args.diff.name,
        desc: args.diff.desc,
        waves: args.diff.waves,
        lives: args.diff.lives,
        cash: args.diff.cash,
      },
    },
    liveRun: live ? {
      phase: live.phase,
      wave: live.wave,
      nextWave: nextWaveNumber,
      freeplay: live.freeplay,
      lives: live.lives,
      startingLives: live.startingLives,
      credits: Math.floor(live.credits),
      kills: live.totalKills,
      cashEarned: Math.round(live.runStats.cashEarned),
      leaks: live.runStats.leaks,
      durationS: Math.round(live.time),
      adaptation: live.adaptation.type ? `${live.adaptation.type} damage resisted by ${Math.round(live.adaptation.resist * 100)}%` : null,
      towerCount: live.towers.length,
      towers: Object.values(live.towers.reduce<Record<string, { name: string; count: number; kills: number; tiers: string }>>((acc, t) => {
        const row = acc[t.def.id] ?? { name: t.def.name, count: 0, kills: 0, tiers: '' };
        row.count += 1;
        row.kills += t.kills;
        row.tiers = [row.tiers, `A${t.tierA}/B${t.tierB}`].filter(Boolean).join(', ');
        acc[t.def.id] = row;
        return acc;
      }, {})),
      selectedTower: args.selectedTower ? towerSnapshot(args.selectedTower) : undefined,
      activeEnemies: Object.values(live.enemies.reduce<Record<string, { name: string; count: number; cloaked: number; revealed: number; traits: string[] }>>((acc, e) => {
        const key = e.def.id;
        const row = acc[key] ?? { name: e.def.name, count: 0, cloaked: 0, revealed: 0, traits: traits(e.def.id, e.cloaked) };
        row.count += 1;
        if (e.cloaked) row.cloaked += 1;
        if (e.revealed) row.revealed += 1;
        acc[key] = row;
        return acc;
      }, {})),
      currentWave: waveSnapshot(currentWaveNumber, args.diff),
      upcomingWave: waveSnapshot(nextWaveNumber, args.diff),
      unlockedAbilities: ABILITIES.filter((a) => live.wave >= a.unlockWave).map((a) => a.name),
      lockedAbilities: ABILITIES.filter((a) => live.wave < a.unlockWave).map((a) => ({ name: a.name, unlockWave: a.unlockWave })),
    } : undefined,
    catalog: {
      sectors: ALL_MAPS.map((m) => ({ id: m.id, name: m.name, difficulty: m.difficulty, desc: m.desc })),
      protocols: DIFFICULTIES.map((d) => ({ id: d.id, name: d.name, waves: d.waves, desc: d.desc })),
      towers: TOWERS_BY_UNLOCK.map((t) => ({
        name: t.name,
        cost: t.cost,
        unlockAt: t.unlockAt,
        damageType: t.base.damageType,
        desc: t.desc,
        tracks: t.tracks.map((tr) => ({ name: tr.name, upgrades: tr.upgrades.map((u) => `${u.name}: ${u.desc}`) })),
      })),
      enemies: Object.values(ENEMIES).map((e) => ({
        name: e.name,
        hp: e.hp,
        speed: e.speed,
        rbe: rbe(e.id),
        traits: traits(e.id),
        children: e.children.map((c) => ENEMIES[c].name),
        lore: e.lore,
      })),
      abilities: ABILITIES.map((a) => ({ name: a.name, unlockWave: a.unlockWave, desc: a.desc })),
    },
  };
}
