// Sanity-run the second sector trio with the standard bot.
import { Game } from '../src/game/engine';
import { Bot } from '../src/game/bot';
import { MAPS2, DIFFICULTIES } from '../src/game/maps';
import { setMuted } from '../src/game/sound';

setMuted(true);

for (const map of MAPS2) {
  for (const diff of [DIFFICULTIES[1], DIFFICULTIES[3]]) {
    console.log(`-- starting ${map.name} / ${diff.name}`);
    const g = new Game(map, diff);
    const bot = new Bot(g, 'standard');
    let t = 0;
    let idle = 0;
    let lastWave = -1;
    while (t < 3600 && g.phase !== 'gameover' && g.phase !== 'victory') {
      if (g.phase === 'build') {
        idle += 0.05;
        bot.act(t);
        if (idle > 4) { idle = 0; g.startWave(); }
      } else {
        bot.act(t);
      }
      g.update(0.05);
      t += 0.05;
      if (g.wave !== lastWave) { lastWave = g.wave; if (g.wave % 10 === 0) console.log(`   wave ${g.wave} t=${Math.round(t)}s enemies=${g.enemies.length}`); }
    }
    console.log(`   RESULT: wave ${g.wave} ${g.phase} lives ${g.lives} t=${Math.round(t)}s`);
  }
}
