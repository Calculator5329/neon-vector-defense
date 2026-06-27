// Rank crests + rival flagship portraits via Gemini flash image. node scripts/genmeta.mjs [name ...]
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const only = process.argv.slice(2);

const CREST = "A sci-fi military RANK INSIGNIA CREST emblem, a single centered medallion badge filling the frame on a plain near-black navy background (#05070f), glowing neon, ornate but clean and legible, symmetrical, no text, no letters, no numbers, square 1:1. Tier concept: ";
const PORTRAIT = "A dark sci-fi ENEMY FLAGSHIP portrait, painterly concept art, menacing capital warship, centered on a near-black deep-navy void with cinematic rim light, no text, square 1:1. Subject: ";
const ART = {
  // rank crests — escalating prestige + warmth (dim steel → cyan → violet → radiant gold)
  "rank-recruit": CREST + "RECRUIT — a humble dull-steel chevron badge, plain and unadorned, faint cyan glow, the lowest rank",
  "rank-sentinel": CREST + "SENTINEL — a watchful single-eye shield badge, cool cyan glow, vigilant",
  "rank-warden": CREST + "WARDEN — a lighthouse beacon crest with radiating light beams, bright cyan glow, the keeper of the lantern",
  "rank-vanguard": CREST + "VANGUARD — a forward-thrusting winged spearhead crest, teal-and-violet glow, aggressive and proud",
  "rank-architect": CREST + "ARCHITECT — an intricate geometric constellation/blueprint crest, violet glow, precise and cerebral",
  "rank-luminary": CREST + "LUMINARY — a radiant sunburst star crest, brilliant gold-and-cyan glow, luminous",
  "rank-ascendant": CREST + "ASCENDANT — a transcendent winged halo crest crowned with a star, ornate gold-and-violet glow, the highest honor",
  // rival flagship portraits
  "rival-vesper": PORTRAIT + "VESPER the Quiet Star — a sleek ghostly cloaked phantom flagship, faint shimmering cyan stealth glow, half-vanished into the dark",
  "rival-orrery": PORTRAIT + "ORRERY the Siege Wheel — a massive ring/wheel-shaped shielded siege capital ship bristling with launch screens, amber-orange glow",
  "rival-blackbox": PORTRAIT + "BLACKBOX the Memory Ship — a dark angular jamming warship covered in disruption antennae and data-spires, glitchy green-violet glow",
  "rival-redsaint": PORTRAIT + "RED SAINT the Bounty Hull — a brutal ornate crimson bounty flagship, gilded and cruel, blood-red glow",
};
let total = 0;
for (const [name, prompt] of Object.entries(ART)) {
  if (only.length && !only.includes(name)) continue;
  if (existsSync(join(root, "public", "art", `${name}.png`))) { console.log(name, "exists, skip"); continue; }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: prompt }], modalities: ["image", "text"], image_config: { aspect_ratio: "1:1" } }),
    });
    if (!res.ok) { console.log(name, "HTTP", res.status, (await res.text().catch(() => "")).slice(0, 140)); continue; }
    const j = await res.json();
    const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!img) { console.log(name, "no image"); continue; }
    writeFileSync(join(root, "public", "art", `${name}.png`), Buffer.from(img.slice(img.indexOf(",") + 1), "base64"));
    total += j.usage?.cost ?? 0;
    console.log(`${name}.png ($${(j.usage?.cost ?? 0).toFixed(4)})`);
  } catch (e) { console.log(name, "failed:", e.message); }
}
console.log(`TOTAL: $${total.toFixed(4)}`);
