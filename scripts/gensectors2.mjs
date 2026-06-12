import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const S = "Dark sci-fi space illustration, neon cyan and violet palette on near-black navy, painterly, cinematic rim light, no text, establishing shot, lots of dark space, subtle.";
const P = {
  "sector-mobius": S + " An impossibly long serpentine supply causeway folding back over itself in glowing teal ribbons, drifting through a green-teal nebula, hypnotic and endless.",
  "sector-blackout": S + " A dark dead sector lit only by three amber beacon towers casting small circles of light, vast blackness between them, ominous powered-down ruins, amber and indigo tones.",
  "sector-throat": S + " A narrow crushing canyon of wrecked station debris forming a single tight throat-like passage, crimson warning lights along the walls, claustrophobic, red and rust tones.",
};
for (const [name, prompt] of Object.entries(P)) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: prompt }], modalities: ["image","text"], image_config: { aspect_ratio: "16:9" } }),
  });
  if (!res.ok) { console.log(name, "HTTP", res.status); continue; }
  const j = await res.json();
  const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) { console.log(name, "no image"); continue; }
  writeFileSync(join(root, "public", "art", `${name}.png`), Buffer.from(img.slice(img.indexOf(",")+1), "base64"));
  console.log(`${name}.png ($${(j.usage?.cost ?? 0).toFixed(4)})`);
}
