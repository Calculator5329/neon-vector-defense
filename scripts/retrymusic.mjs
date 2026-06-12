import { readFileSync } from "node:fs";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let attempt = 1; attempt <= 6; attempt++) {
  await sleep(45000);
  const { spawnSync } = await import("node:child_process");
  // re-run only the music section by checking which files exist
  const { existsSync } = await import("node:fs");
  const missing = ["amb-hollow", "stinger-victory", "stinger-defeat"].filter(n => !existsSync(`public/audio/${n}.mp3`));
  if (missing.length === 0) { console.log("all tracks present"); break; }
  console.log(`attempt ${attempt}, missing: ${missing.join(",")}`);
  const r = spawnSync("node", ["scripts/genhollow.mjs"], { encoding: "utf8" });
  console.log((r.stdout + r.stderr).split("\n").filter(l => l.includes(".mp3") || l.includes("429")).join("\n"));
}
