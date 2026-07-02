// Instrumented headless run: plays a full game with a given bot profile and
// captures PER-WAVE telemetry, not just the final win/loss. This is what lets
// us see WHERE a difficulty curve spikes or sags across all phases.

import { Game } from '../../src/game/engine';
import { Bot, type BotSkill, type Profile } from '../../src/game/bot';
import { getWave } from '../../src/game/waves';
import { rbe } from '../../src/game/enemies';
import type { GameMap, DifficultyDef } from '../../src/game/types';

const DT = 1 / 20;
const MAX_TIME = 60 * 90; // 90 game-minutes hard cap
const BUILD_WINDOW = 4; // seconds the bot shops between waves (matches scripts/sim.ts)

export interface WaveRecord {
  wave: number;
  livesStart: number;
  livesEnd: number;
  /** cores lost during this wave */
  livesLost: number;
  /** credits on hand the moment the wave launched */
  creditsStart: number;
  /** towers standing when the wave launched */
  towersStart: number;
  /** max cores this wave could cost if every hull (and its children) leaked */
  maxLeak: number;
  /** livesLost / maxLeak — fraction of the wave that broke through (0..1) */
  leakPct: number;
  /** livesLost / livesStart — how hard this single wave bit the core pool */
  pressure: number;
  /** livesEnd / startingLives — cores remaining as a fraction (1 = untouched) */
  coreFraction: number;
  /** game-seconds the wave took */
  durationS: number;
}

export interface RunResult {
  won: boolean;
  finalWave: number;
  livesLeft: number;
  startingLives: number;
  waves: WaveRecord[];
}

/** Sum of layered hull counts a wave can leak (count × recursive children). */
function waveMaxLeak(waveNumber: number): number {
  const def = getWave(waveNumber);
  return def.reduce((sum, grp) => sum + grp.count * rbe(grp.type), 0);
}

// Deterministic seeding: the CI balance gate compares quick runs against the
// committed baseline, so identical inputs MUST produce identical results —
// unseeded runs made the gate flake on borderline cells (same commit passed
// one CI run and failed its twin).
function fnv32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runInstrumented(
  map: GameMap,
  diff: DifficultyDef,
  profile: BotSkill | Profile,
  seedKey = 'default-0',
): RunResult {
  const seed = fnv32(`${map.id}|${diff.id}|${typeof profile === 'string' ? profile : 'custom'}|${seedKey}`);
  const game = new Game(map, diff, { seed, lifetimeKills: 0 });
  const bot = new Bot(game, profile, mulberry(seed ^ 0x9e3779b9));
  const startingLives = game.lives;
  const waves: WaveRecord[] = [];
  let time = 0;
  let idle = 0;

  // snapshot taken at the instant a wave launches; closed when it ends
  let open: { wave: number; livesStart: number; creditsStart: number; towersStart: number; t0: number } | null = null;

  const close = (livesEnd: number) => {
    if (!open) return;
    const maxLeak = Math.max(1, waveMaxLeak(open.wave));
    const livesLost = Math.max(0, open.livesStart - livesEnd);
    waves.push({
      wave: open.wave,
      livesStart: open.livesStart,
      livesEnd,
      livesLost,
      creditsStart: Math.round(open.creditsStart),
      towersStart: open.towersStart,
      maxLeak,
      leakPct: livesLost / maxLeak,
      pressure: open.livesStart > 0 ? livesLost / open.livesStart : 0,
      coreFraction: startingLives > 0 ? livesEnd / startingLives : 0,
      durationS: time - open.t0,
    });
    open = null;
  };

  while (time < MAX_TIME) {
    if (game.phase === 'gameover') { close(game.lives); break; }
    if (game.phase === 'victory') { close(game.lives); break; }

    if (game.phase === 'build') {
      idle += DT;
      bot.act(time);
      if (idle > BUILD_WINDOW) {
        idle = 0;
        game.startWave(); // phase -> 'wave', game.wave incremented
        open = {
          wave: game.wave,
          livesStart: game.lives,
          creditsStart: game.credits,
          towersStart: game.towers.length,
          t0: time,
        };
      }
    } else {
      bot.act(time);
    }

    game.update(DT);
    time += DT;

    // wave finished: engine flipped phase back to build (or to a terminal phase)
    if (open && game.phase !== 'wave') close(game.lives);
  }

  // time-cap with a wave still in flight
  if (open) close(game.lives);

  const won = game.phase === 'victory';
  return { won, finalWave: game.wave, livesLeft: game.lives, startingLives, waves };
}
