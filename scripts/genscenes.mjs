// Story cutscenes with baked-in caption text — GPT image models render text reliably.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".env.local"), "utf8").match(/OPENROUTER_API_KEY=(\S+)/)[1];
const S = "Cinematic dark sci-fi digital painting, neon cyan and violet palette on near-black navy, painterly, dramatic rim light, widescreen movie still. At the bottom of the image, a clean letterboxed black bar containing this exact subtitle text in elegant white sans-serif type: ";
const SCENES = {
  "scene-1": S + '"Lanterns One through Four are dark. Seven still burns." --- Scene: a chain of five lighthouse space stations stretching into the void, four extinguished and drifting dead, the farthest one blazing with cyan light.',
  "scene-2": S + '"It is not battle-code. It is a delivery schedule." --- Scene: a war room of stunned officers around a holographic table projecting an endless orderly queue of machine warships, route lines like a subway map.',
  "scene-3": S + '"The ceasefire reached every fleet but one." --- Scene: an armistice signing hall aboard a station, document glowing on the table, while outside the window a single distant fleet keeps marching the wrong way.',
  "scene-4": S + '"An armada that wanted us dead would not arrive one polite wave at a time." --- Scene: a lone warden silhouetted at a lighthouse window, watching machine ships queue in a perfect patient line into the kill zone.',
  "scene-5": S + '"It has been trying to deliver the end of the war for 284 years." --- Scene: inside a colossal dreadnought hold, a single pristine diplomatic courier case in a beam of light, dwarfed by the vast scarred chamber.',
  "scene-6": S + '"The lane held. The light goes on." --- Scene: dawn-gold light breaking over the lighthouse spire above a drifting field of dead machine hulls, a cherry tree blossoming in its glass dome.',
};
for (const [name, prompt] of Object.entries(SCENES)) {
  if (existsSync(join(root, "public", "art", `${name}.png`))) { console.log(name, "exists"); continue; }
  let done = false;
  for (const model of ["openai/gpt-5-image-mini", "google/gemini-2.5-flash-image"]) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], modalities: ["image","text"], image_config: { aspect_ratio: "16:9" } }),
      });
      if (!res.ok) { console.log(name, model, "HTTP", res.status); continue; }
      const j = await res.json();
      const img = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!img) { console.log(name, model, "no image"); continue; }
      writeFileSync(join(root, "public", "art", `${name}.png`), Buffer.from(img.slice(img.indexOf(",")+1), "base64"));
      console.log(`${name}.png via ${model} ($${(j.usage?.cost ?? 0).toFixed(4)})`);
      done = true; break;
    } catch (e) { console.log(name, model, e.message); }
  }
  if (!done) console.log(name, "FAILED all models");
}
