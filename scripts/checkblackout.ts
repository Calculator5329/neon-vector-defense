import { Game } from "../src/game/engine";
import { Bot } from "../src/game/bot";
import { ALL_MAPS, DIFFICULTIES } from "../src/game/maps";
import { setMuted } from "../src/game/sound";
setMuted(true);
const map = ALL_MAPS.find(m => m.id === "blackout")!;
const g = new Game(map, DIFFICULTIES[1]);
g.speed = 4; g.autoNext = true;
const bot = new Bot(g, "expert");
let idle = 0;
const start = performance.now();
while (g.wave < 80 && g.phase !== "gameover" && performance.now() - start < 60000) {
  if (g.phase === "victory") g.enterFreeplay("standard");
  if (g.phase === "build") { idle += 1/60; bot.act(g.time); if (idle > 1) { idle = 0; g.startWave(); } }
  else bot.act(g.time);
  g.update(1/60);
}
console.log("Blackout expert:", "wave", g.wave, g.phase, "lives", g.lives);
