// Hollow ambience + victory/defeat stingers (Lyria) + Hollow transmission portrait (image).
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];

async function music(name, prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/lyria-3-clip-preview", modalities: ["audio","text"], messages: [{ role: "user", content: prompt }], stream: true }),
  });
  if (!res.ok) { console.log(name, "HTTP", res.status); return; }
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
  if (audio.length < 1000) { console.log(name, "no audio"); return; }
  writeFileSync(join(root, "public", "audio", `${name}.mp3`), audio);
  console.log(`${name}.mp3 (${Math.round(audio.length/1024)} KB, $${cost.toFixed(4)})`);
}

await music("amb-hollow", "Deeply unsettling dark ambient horror score: wrong-sounding detuned drones, reversed glassy textures, distant organic groaning of something vast eating light, sparse heartbeat-like sub pulse, dread, seamless loop, no vocals, no drums.");
await music("stinger-victory", "Short triumphant cinematic resolution: warm major synth swell rising out of darkness into gentle radiant chords, relieved and earned, lighthouse at dawn, about 10 seconds, no vocals.");
await music("stinger-defeat", "Short tragic cinematic resolution: a single cold minor chord decaying into vast empty reverb, a light going out, mournful, about 10 seconds, no vocals.");

const { existsSync } = await import("node:fs"); if (existsSync(join(root, "public", "art", "hollow.png"))) { console.log("hollow.png exists, skipping"); process.exit(0); } const imgPrompt = "Dark sci-fi illustration, neon cyan and violet palette on near-black navy, painterly, cinematic rim light, no text. Square. A corrupted transmission portrait: where a face should be there is only a void that bends the static around it, sickly green-white light leaking from the edges of the frame, glitch artifacts, the silhouette of something vast and hungry behind the noise. The Hollow, announcing itself.";
const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "google/gemini-2.5-flash-image", messages: [{ role: "user", content: imgPrompt }], modalities: ["image","text"], image_config: { aspect_ratio: "1:1" } }),
});
const j = await r.json();
const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
if (img) { writeFileSync(join(root, "public", "art", "hollow.png"), Buffer.from(img.slice(img.indexOf(",")+1), "base64")); console.log(`hollow.png ($${(j.usage?.cost ?? 0).toFixed(4)})`); }
else console.log("hollow.png failed", JSON.stringify(j).slice(0, 150));

