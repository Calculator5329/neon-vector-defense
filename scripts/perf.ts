// Engine performance stress test — expert bot at max speed, every map,
// campaign + freeplay until gameover / wave cap / time budget.
//   npm run perf            — all six maps
//   npm run perf -- quick   — first map only
import { Game } from '../src/game/engine';
import { Bot } from '../src/game/bot';
import { ALL_MAPS, DIFFICULTIES } from '../src/game/maps';
import { setMuted, setMusic } from '../src/game/sound';

setMuted(true);
setMusic(false);

const WAVE_CAP = 150;
const WALL_BUDGET_MS = 120_000; // per map
const FRAME_DT = 1 / 60;

const maps = process.argv.includes('quick') ? ALL_MAPS.slice(0, 1) : ALL_MAPS;
const diff = DIFFICULTIES[1]; // Veteran
let regressions = 0;

console.log(`PERF STRESS — expert bot · ${diff.name} · 4x speed · freeplay to wave ${WAVE_CAP}`);
console.log('map               | wave | end       | avg ms | p99 ms | max ms | peak hulls | peak fx | sim s/wall s');

for (const map of maps) {
  const g = new Game(map, diff);
  g.speed = 4;
  g.autoNext = true;
  const bot = new Bot(g, 'expert');
  const samples: number[] = [];
  let peakEnemies = 0;
  let peakFx = 0;
  let idle = 0;
  const wallStart = performance.now();

  while (g.wave < WAVE_CAP && g.phase !== 'gameover' && performance.now() - wallStart < WALL_BUDGET_MS) {
    if (g.phase === 'victory') g.enterFreeplay('standard');
    if (g.phase === 'build') {
      idle += FRAME_DT;
      bot.act(g.time);
      if (idle > 1) { idle = 0; g.startWave(); }
    } else {
      bot.act(g.time);
    }
    const t0 = performance.now();
    g.update(FRAME_DT); // one rendered-frame's worth of game time at 4x
    samples.push(performance.now() - t0);
    peakEnemies = Math.max(peakEnemies, g.enemies.length);
    peakFx = Math.max(peakFx, g.particles.length + g.projectiles.length + g.beams.length);
  }

  samples.sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p99 = samples[Math.floor(samples.length * 0.99)];
  const max = samples[samples.length - 1];
  const wallS = (performance.now() - wallStart) / 1000;
  const simS = g.time;
  const end = g.phase === 'gameover' ? 'gameover' : g.wave >= WAVE_CAP ? 'wave cap' : 'time cap';
  console.log(
    `${map.name.padEnd(17)} | ${String(g.wave).padStart(4)} | ${end.padEnd(9)} | ${avg.toFixed(2).padStart(6)} | ${p99.toFixed(2).padStart(6)} | ${max.toFixed(1).padStart(6)} | ${String(peakEnemies).padStart(10)} | ${String(peakFx).padStart(7)} | ${(simS / wallS).toFixed(0).padStart(6)}x`,
  );
  if (avg > 8) {
    console.log(`  ⚠ ${map.name}: avg update ${avg.toFixed(2)}ms leaves <8ms for rendering at 60fps`);
    regressions++;
  }
}

// A perf gate that can't fail is theater: CI runs this as "Performance Smoke",
// so a budget regression must produce a non-zero exit, not a log line.
if (regressions > 0) {
  console.error(`PERF GATE FAILED — ${regressions} map(s) over the 8ms average update budget`);
  process.exit(1);
}
