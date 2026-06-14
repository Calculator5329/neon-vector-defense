import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let KEY = existsSync(join(root, ".env.local"))
  ? readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)?.[1]
  : undefined;
KEY ||= process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("No OPENROUTER_API_KEY in .env.local or env"); process.exit(1); }
const S = "Dark sci-fi space illustration, neon cyan and violet palette on near-black navy, painterly, cinematic rim light, no text, establishing shot, lots of dark space, subtle.";
// THE HOLLOW sectors — the dark past the Combine's old line.
const P = {
  "sector-umbral": S + " A dead relay corridor being devoured by the Hollow: a void of negative light bleeding violet-black across the scene, draining the glow out of everything, with only three small fragile pools of pale lantern-light holding the dark back. Light visibly bending and pouring toward the darkness, ominous, starving, deep indigo and violet tones.",
  "sector-cinder": S + " A wreckage-choked causeway of burnt, broken relay struts twisting into one tight double-back passage, smouldering ember-orange glow in the cracks, drifting ash and smoke, charred metal, a coffin-like kill-box, amber and rust and charcoal tones.",
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
