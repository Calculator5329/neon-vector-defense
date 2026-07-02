import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const S = "Dark sci-fi illustration, neon cyan and violet palette on near-black navy, painterly, cinematic rim light, no text. Square.";
const P = {
  "frag-0": S + " A small blossoming cherry tree inside a warm glass dome on a space station deck, tended by a maintenance robot, stars beyond.",
  "frag-1": S + " A disassembled angular red scout drone on a workbench, its open core revealing a cargo manifest slate glowing softly, two engineers staring.",
  "frag-2": S + " A war museum hologram of two fleets frozen mid-battle over a gate route, eleven service flags dimmed below.",
  "frag-3": S + " An old signal console printing an endless repeating delivery schedule on translucent tape that coils across a dark floor.",
  "frag-4": S + " A battered journal floating in a ruined lighthouse control room, pages open, handwriting visible as faint light.",
  "frag-5": S + " A grand ceasefire signing hall aboard a station, two empty chairs, a single document on the table, clock reading 04:47.",
  "frag-6": S + " The open carrier bay of a huge red machine warship: padded, climate-misted, gentle interior lighting, clearly built to carry something fragile.",
  "frag-7": S + " A suppressed star chart where machine fleet routes form a patient orderly queue between lighthouse beacons, one route highlighted.",
  "frag-9": S + " A cherry tree in full blossom on a station observation deck, petals drifting in zero gravity past a window full of warship silhouettes holding fire.",
};
for (const [name, prompt] of Object.entries(P)) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: prompt }], modalities: ["image","text"], image_config: { aspect_ratio: "1:1" } }),
  });
  if (!res.ok) { console.log(name, "HTTP", res.status); continue; }
  const j = await res.json();
  const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) { console.log(name, "no image"); continue; }
  writeFileSync(join(root, "public", "art", `${name}.png`), Buffer.from(img.slice(img.indexOf(",")+1), "base64"));
  console.log(`${name}.png ($${(j.usage?.cost ?? 0).toFixed(4)})`);
}
