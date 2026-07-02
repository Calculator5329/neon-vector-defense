// One-off art generation via OpenRouter image models.
//   $env:OPENROUTER_API_KEY="sk-..."; node scripts/genart.mjs [asset ...]
// Saves PNGs to public/art/. Re-run with asset names to regenerate selectively.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// project-local .env.local wins over global env vars (stale system-wide keys are a real hazard)
let KEY = existsSync(join(root, '.env.local'))
  ? readFileSync(join(root, '.env.local'), 'utf8').match(/OPENROUTER_API_KEY=(\S+)/)?.[1]
  : undefined;
KEY ||= process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error('Set OPENROUTER_API_KEY (env var or .env.local) first.');
  process.exit(1);
}
const outDir = join(root, 'public', 'art');
mkdirSync(outDir, { recursive: true });

const STYLE =
  'Dark deep-space scene, neon cyan (#4bcffa) and violet (#be2edd) palette on near-black navy, ' +
  'clean cinematic sci-fi illustration with strong rim-light glow, painterly but crisp, no text, no watermark, no UI.';

const ASSETS = {
  'menu-bg': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} A colossal lighthouse-relay space station â€” an elongated crystalline spire with a brilliant ` +
      `white-cyan beacon at its crown â€” floating in a violet nebula. Thin threads of light stretch from the beacon ` +
      `toward distant star systems like a web of routes. Near the spire's midsection, a small glass observation ` +
      `dome glows warmly, and inside it a single blossoming cherry tree is faintly visible. Vast scale, lonely, ` +
      `hopeful. Wide establishing shot.`,
  },
  'briefing': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '1:1',
    prompt:
      `${STYLE} A flickering holographic bust of a weathered human Sector Command officer, mid-50s, transmitted ` +
      `over long distance: translucent cyan hologram with horizontal scanline artifacts and slight double-exposure ` +
      `ghosting, stern but tired eyes, high collar uniform with a small lantern insignia. Head and shoulders, ` +
      `centered, dark background.`,
  },
  'victory': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} The lighthouse-relay spire shining at full brilliance above a drifting field of broken machine ` +
      `hulls, its beacon cutting a clean column of light through the debris. Warm gold-white dawn glow mixing ` +
      `into the cyan. Triumphant, quiet, survived-the-night feeling.`,
  },
  'defeat': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} The lighthouse-relay spire gone dark, only red emergency embers glowing along its length, ` +
      `silhouettes of angular machine warships drifting past in the background, the beacon extinguished. ` +
      `Smoke and sparks in vacuum, elegiac, the light has gone out.`,
  },
  'sector-orbital': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} Wide vista of a deep-blue orbital relay corridor: a winding chain of small beacon pylons curving ` +
      `around a central relay core station, calm and methodical, cool blue tones dominant. Establishing shot, ` +
      `lots of dark space, subtle.`,
  },
  'sector-reactor': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} Two enormous twin reactor cores glowing violet-magenta, connected by tight energy conduits that ` +
      `pinch into narrow chokepoint channels between them, industrial and claustrophobic, purple tones dominant. ` +
      `Establishing shot, lots of dark space, subtle.`,
  },
  'sector-hyperlane': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} A dangerous red-lit hyperlane junction gate: crossing traffic lanes of light intersecting at a ` +
      `massive ring gate, warning-red and crimson tones dominant, fast and hostile feeling. Establishing shot, ` +
      `lots of dark space, subtle.`,
  },
  'leviathan': {
    model: 'google/gemini-2.5-flash-image',
    aspect: '16:9',
    prompt:
      `${STYLE} An ancient colossal violet dreadnought warship, hull scarred by three centuries of travel, ` +
      `gun blisters welded on as afterthoughts. Its forward cargo cradle is open, gently illuminated, holding a ` +
      `single small pristine sealed command case that glows softly white. Melancholic, not menacing â€” a giant ` +
      `that only wants to hand something over. Side profile, vast scale.`,
  },
};

const wanted = process.argv.slice(2);
const list = Object.entries(ASSETS).filter(([name]) => wanted.length === 0 || wanted.includes(name));

let spent = 0;
for (const [name, a] of list) {
  process.stdout.write(`generating ${name} (${a.model})... `);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: a.model,
      messages: [{ role: 'user', content: `${a.prompt} Aspect ratio ${a.aspect}.` }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: a.aspect },
    }),
  });
  if (!res.ok) {
    console.log(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    continue;
  }
  const json = await res.json();
  const img = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img || !img.startsWith('data:image')) {
    console.log(`no image in response: ${JSON.stringify(json).slice(0, 300)}`);
    continue;
  }
  const b64 = img.slice(img.indexOf(',') + 1);
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  const usage = json.usage ?? {};
  spent += usage.cost ?? 0;
  console.log(`saved (${Math.round(Buffer.from(b64, 'base64').length / 1024)} KB, cost $${(usage.cost ?? 0).toFixed(4)})`);
}
console.log(`total cost this run: $${spent.toFixed(4)}`);

