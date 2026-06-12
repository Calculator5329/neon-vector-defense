// Headless balance simulator.
//   npm run sim            — full matrix (3 skills × 3 maps × 3 difficulties)
//   npm run sim -- quick   — fewer seeds for a fast pass
//
// Verdicts we tune toward:
//   Recruit  should be beaten by the rookie bot   (forgiving for new players)
//   Veteran  should need standard play            (rookie falls short)
//   Apex     should need expert play              (standard falls short)

import { Game } from '../src/game/engine';
import { Bot, type BotSkill } from '../src/game/bot';
import { MAPS, DIFFICULTIES } from '../src/game/maps';
import { setMuted } from '../src/game/sound';

setMuted(true);

const QUICK = process.argv.includes('quick');
const SEEDS = QUICK ? 2 : 4;
const DT = 1 / 20;
const MAX_TIME = 60 * 90; // 90 minutes of game time hard cap

interface Result {
  wave: number;
  won: boolean;
  livesLeft: number;
}

function runOne(mapIdx: number, diffIdx: number, skill: BotSkill): Result {
  const game = new Game(MAPS[mapIdx], DIFFICULTIES[diffIdx]);
  const bot = new Bot(game, skill);
  let time = 0;
  let idleTimer = 0;

  while (time < MAX_TIME) {
    if (game.phase === 'gameover') return { wave: game.wave, won: false, livesLeft: 0 };
    if (game.phase === 'victory') return { wave: game.wave, won: true, livesLeft: game.lives };
    if (game.phase === 'build') {
      // give the bot a short shopping window between waves
      idleTimer += DT;
      bot.act(time);
      if (idleTimer > 4) {
        idleTimer = 0;
        game.startWave();
      }
    } else {
      bot.act(time);
    }
    game.update(DT);
    time += DT;
  }
  return { wave: game.wave, won: false, livesLeft: game.lives };
}

function fmt(n: number, w: number) {
  return String(n).padStart(w);
}

console.log('NEON VECTOR DEFENSE — balance simulation');
console.log(`seeds per cell: ${SEEDS}\n`);

const skills: BotSkill[] = ['rookie', 'standard', 'expert'];

for (const skill of skills) {
  console.log(`=== ${skill.toUpperCase()} BOT ===`);
  console.log('map               | diff     | avg wave | wins | avg lives left');
  for (let m = 0; m < MAPS.length; m++) {
    for (let d = 0; d < DIFFICULTIES.length; d++) {
      const results: Result[] = [];
      for (let s = 0; s < SEEDS; s++) results.push(runOne(m, d, skill));
      const avgWave = results.reduce((a, r) => a + r.wave, 0) / results.length;
      const wins = results.filter((r) => r.won).length;
      const avgLives = Math.round(results.reduce((a, r) => a + r.livesLeft, 0) / results.length);
      console.log(
        `${MAPS[m].name.padEnd(17)} | ${DIFFICULTIES[d].name.padEnd(8)} | ${fmt(Math.round(avgWave), 8)} | ${fmt(wins, 2)}/${SEEDS} | ${fmt(avgLives, 6)}`,
      );
    }
  }
  console.log('');
}
