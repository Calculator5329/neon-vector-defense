// Commander-ability icons via Gemini flash image. node scripts/genability.mjs [id ...]
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const only = process.argv.slice(2);
const STYLE = "A single bold flat neon sci-fi game UI ability icon, centered and filling the frame, on a plain solid near-black navy background (#05070f), glowing cyan and violet with crisp high-contrast edges, clean vector-like symbol, simple and legible at small size, no text, no letters, no numbers, no border, square 1:1. Icon concept: ";
const ICONS = {
  "ability-strike": "an orbital energy lance beaming straight down from above into a circular targeting reticle on the ground, impact flare",
  "ability-chrono": "a glowing hourglass enclosed in a rippling slow-motion time-dilation field, frozen blue clock energy",
  "ability-overdrive": "an overcharging reactor core radiating upward lightning bolts, a redlined power gauge surging",
  "ability-salvage": "a stack of glowing hexagonal credit tokens beaming upward out of a requisition crate, currency surge",
  "ability-cascade": "a web of interconnected resonance nodes detonating in a chain reaction, pulses bursting outward along the links",
  "ability-mirror": "a reflective shield-mirror portal deflecting an incoming arrow back the way it came, a clean bounce of light",
};
let total = 0;
for (const [name, concept] of Object.entries(ICONS)) {
  if (only.length && !only.includes(name)) continue;
  if (existsSync(join(root, "public", "art", `${name}.png`))) { console.log(name, "exists, skip"); continue; }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: STYLE + concept }], modalities: ["image", "text"], image_config: { aspect_ratio: "1:1" } }),
    });
    if (!res.ok) { console.log(name, "HTTP", res.status, (await res.text().catch(() => "")).slice(0, 160)); continue; }
    const j = await res.json();
    const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!img) { console.log(name, "no image"); continue; }
    writeFileSync(join(root, "public", "art", `${name}.png`), Buffer.from(img.slice(img.indexOf(",") + 1), "base64"));
    total += j.usage?.cost ?? 0;
    console.log(`${name}.png ($${(j.usage?.cost ?? 0).toFixed(4)})`);
  } catch (e) { console.log(name, "failed:", e.message); }
}
console.log(`TOTAL: $${total.toFixed(4)}`);
