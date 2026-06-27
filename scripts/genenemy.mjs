// Combine Bestiary portraits via Gemini flash image. node scripts/genenemy.mjs [id ...]
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const only = process.argv.slice(2);
const STYLE = "Dark sci-fi machine-enemy unit portrait, painterly concept-art, cinematic rim light, centered on a near-black deep-navy void background, glowing neon accents, menacing, no text, no labels, square 1:1. Subject: ";
const ENEMIES = {
  "enemy-scout": "a small cheap disposable triangular recon drone, crimson-red glow, swarm unit, flimsy printed frame, single glowing eye-sensor",
  "enemy-raider": "a triangular raider drone wrapped in scavenged blue hull plating, electric-blue glow, patchwork armor over a smaller core",
  "enemy-stinger": "a green twin-bladed diamond-shaped interceptor drone, emerald glow, sharp aggressive wings, fast attack craft",
  "enemy-phantom": "a yellow diamond drone stripped down to a blazing burn-core, golden-white glow, shielding torn off for raw speed, motion-blurred",
  "enemy-wraith": "a sleek hot-pink courier blockade-runner ship, magenta glow, aerodynamic stealth lines built to outrun targeting",
  "enemy-shade": "a grey hexagonal warship hull clad in thick reactive ablative lattice plating, dull steel glow, blast-eating armor",
  "enemy-prism": "a white mirror-faceted hexagonal hull, brilliant diamond-bright reflective thermal armor refracting light",
  "enemy-aegis": "a heavy steel pentagonal armored siege hull forged from collapsed-star alloy, pale blue glow, impervious kinetic plating",
  "enemy-chrono": "a violet hexagonal hull phase-skipping out of time, purple glow, glitching afterimages and chronal distortion",
  "enemy-vortex": "a cyan pentagonal frame of spinning gravity coils, teal glow, a caged whirlpool of energy hauling cargo",
  "enemy-juggernaut": "a massive orange ceramic-composite pentagonal siege carapace, amber glow, brutal armored battering hull",
  "enemy-seraph": "a mint-green hexagonal repair tender emitting healing nanite beams, soft green glow, benevolent yet wrong machine angel",
  "enemy-titan": "a colossal red-orange capital carrier the size of a city block, fiery glow, a mobile foundry bristling with launch bays, a boss dreadnought",
  "enemy-leviathan": "an enormous violet capital dreadnought, purple glow, a sector-erasing fortress ship with launch cradles, a terrifying boss",
  "enemy-wisp": "a scrap of dark un-light, a starving fast Hollow wisp, void-black body with sickly violet glow leaking from cracks",
  "enemy-gorge": "a void-black hexagonal Hollow hull that bends light around itself, violet glow at the edges, a hole in space that eats blasts",
  "enemy-lampblack": "a void-black Hollow tender that un-happens wounds, deep violet un-light healing aura, an anti-light machine angel",
  "enemy-umbra": "THE UMBRA, a vast black void-entity capital boss, the light-eating Hollow leviathan, violet energy leaking from a tear in reality, cosmic dread",
};
let total = 0;
for (const [name, concept] of Object.entries(ENEMIES)) {
  if (only.length && !only.includes(name)) continue;
  if (existsSync(join(root, "public", "art", `${name}.png`))) { console.log(name, "exists, skip"); continue; }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: STYLE + concept }], modalities: ["image", "text"], image_config: { aspect_ratio: "1:1" } }),
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
