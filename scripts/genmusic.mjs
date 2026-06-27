// Generate missing per-sector ambience + the second "Drift" music pack via Lyria.
//   node scripts/genmusic.mjs              — all (skips existing)
//   node scripts/genmusic.mjs amb-mobius   — only the named track(s)
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const only = process.argv.slice(2);

const TRACKS = {
  // per-sector ambience (maps that lack an amb-*.mp3) — themed to each sector's lore
  "amb-mobius": "Hypnotic dark ambient space music, a slowly looping circular synth motif that folds back on itself, disorienting Möbius drift, gentle phasing pads, weightless and patient, seamless loop, no drums, no vocals.",
  "amb-blackout": "Sparse eerie dark ambient, a near-silent dead sector, faint flickering beacon tones in a void of black, cold isolation, the occasional distant metallic groan, very minimal, seamless loop, no drums, no vocals.",
  "amb-throat": "Tense claustrophobic dark ambient, a low drone tightening like a closing throat, slow building dread, distant capital-ship rumble, ominous and compressed, seamless loop, no vocals.",
  "amb-umbral": "Corrupted sickly dark ambient, the Hollow bleeding through, detuned wavering pads and sickly green-white shimmer, the dark drinking the light, unsettling, seamless loop, no drums, no vocals.",
  "amb-cinder": "Smoldering ashen dark ambient, burnt relay wreckage, low ember-crackle texture under a heavy mournful drone, ominous heat-haze, the kill-box becoming a coffin, seamless loop, no vocals.",
  // second selectable music pack — warmer/melodic counterpoint to the contemplative "Concord" pack
  "drift-1": "Warm melodic synthwave space drift, a slow nostalgic analog arpeggio with a gentle major-key glow, hopeful lighthouse vigil over a calm starfield, dreamy and uplifting, soft brushed pulse, no vocals.",
  "drift-2": "Mellow retro sci-fi ambient drift, a soft pulsing bassline under shimmering chorus pads, a quiet confident groove, deep-space cruise between battles, seamless, no vocals.",
  "drift-3": "Ethereal ambient drift, a glassy bell melody over deep warm pads, weightless and serene, slow tidal swells, the calm between waves, seamless loop, no vocals.",
  "boss-theme": "Intense dark sci-fi BOSS BATTLE music, driving ominous low brass-like synth stabs over pounding war drums and a relentless pulse, a colossal capital warship bearing down, rising dread and adrenaline, cinematic and heavy, seamless loop, no vocals.",
  "menu-theme": "Calm cinematic sci-fi MAIN MENU theme, a slow hopeful melodic synth motif over deep warm space pads, a quiet lighthouse vigil among the stars, welcoming and atmospheric, seamless loop, no drums, no vocals.",
};

let total = 0;
for (const [name, prompt] of Object.entries(TRACKS)) {
  if (only.length && !only.includes(name)) continue;
  if (existsSync(join(root, "public", "audio", `${name}.mp3`))) { console.log(name, "exists, skip"); continue; }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/lyria-3-clip-preview", modalities: ["audio", "text"], messages: [{ role: "user", content: prompt }], stream: true }),
    });
    if (!res.ok) { console.log(name, "HTTP", res.status, (await res.text().catch(() => "")).slice(0, 160)); continue; }
    const chunks = []; let buf = ""; let cost = 0; const dec = new TextDecoder();
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
        try { const j = JSON.parse(line.slice(6)); const d = j.choices?.[0]?.delta?.audio?.data; if (d) chunks.push(Buffer.from(d, "base64")); if (j.usage?.cost) cost = j.usage.cost; } catch {}
      }
    }
    const audio = Buffer.concat(chunks);
    if (audio.length < 1000) { console.log(name, "no audio"); continue; }
    writeFileSync(join(root, "public", "audio", `${name}.mp3`), audio);
    total += cost;
    console.log(`${name}.mp3 (${Math.round(audio.length / 1024)} KB, $${cost.toFixed(4)})`);
  } catch (e) { console.log(name, "failed:", e.message); }
}
console.log(`TOTAL: $${total.toFixed(4)}`);
