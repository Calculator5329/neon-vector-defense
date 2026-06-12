import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const T = {
  "theme-2": "Dark ambient sci-fi score, slow evolving minor pads with a gentle hopeful major lift midway, distant choir-like synth, deep space lighthouse vigil, sparse, cinematic, no drums, no vocals.",
  "theme-3": "Mysterious dark ambient space music, low cello-like synth drones, slow glassy bell motifs, vast emptiness with faint warm undertones, contemplative, seamless, no drums, no vocals.",
};
for (const [name, prompt] of Object.entries(T)) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
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
  writeFileSync(join(root, "public", "audio", `${name}.mp3`), audio);
  console.log(`${name}.mp3 (${Math.round(audio.length/1024)} KB, $${cost.toFixed(4)})`);
}
