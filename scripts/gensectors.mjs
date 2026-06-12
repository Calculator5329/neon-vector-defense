// Sector ambience loops via Lyria. node scripts/gensectors.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const TRACKS = {
  "amb-orbital": "Calm dark ambient space music, slow blue synth pads, gentle pulsing beacon tones, patient and watchful, seamless loop, no drums, no vocals.",
  "amb-reactor": "Tense industrial dark ambient, deep throbbing reactor hum, metallic resonances, claustrophobic purple atmosphere, slow menacing pulse, seamless loop, no vocals.",
  "amb-hyperlane": "Urgent dark ambient with driving low percussion pulse, red-alert energy, fast arpeggiated synth undercurrent, dangerous crossing, seamless loop, no vocals.",
};
for (const [name, prompt] of Object.entries(TRACKS)) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/lyria-3-clip-preview", modalities: ["audio","text"], messages: [{ role: "user", content: prompt }], stream: true }),
    });
    if (!res.ok) { console.log(name, "HTTP", res.status); continue; }
    const chunks = []; let buf = ""; let cost = 0;
    const dec = new TextDecoder();
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
    const ext = audio[0] === 0xff || audio.slice(0,3).toString() === "ID3" ? "mp3" : "wav";
    writeFileSync(join(root, "public", "audio", `${name}.${ext}`), audio);
    console.log(`${name}.${ext} (${Math.round(audio.length/1024)} KB, $${cost.toFixed(4)})`);
  } catch (e) { console.log(name, "failed:", e.message); }
}
