// Voice generation (announcer + archive narration) via gpt-audio-mini.
// Strict system prompt so the model speaks ONLY the script — no "Okay, understood" preambles.
//   npx tsx scripts/genvox.ts [name ...]
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE } from '../src/game/lore';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let KEY = existsSync(join(root, '.env.local'))
  ? readFileSync(join(root, '.env.local'), 'utf8').match(/OPENROUTER_API_KEY=(\S+)/)?.[1]
  : process.env.OPENROUTER_API_KEY;
const outDir = join(root, 'public', 'audio', 'vox');
mkdirSync(outDir, { recursive: true });

const SYS = (delivery: string) =>
  `You are a professional voice actor recording a final take for a video game. ` +
  `Delivery: ${delivery}. ` +
  `Speak the user's message VERBATIM, exactly as written. Output ONLY the spoken line itself — ` +
  `absolutely no acknowledgements, no preamble, no "okay", no commentary, no sign-off.`;

const CONTINUITY = 'calm, slightly ethereal female station AI carrying a million archived human minds; gentle, layered, unhurried, quiet warmth';
const ARCHIVIST = 'quiet, weathered human archivist reading recovered records late at night; intimate, measured, a little haunted';
const HOLLOW_CMD = 'urgent but controlled military commander over a crackling long-range radio, an edge of dread he is suppressing';

interface Line { text: string; voice: string; delivery: string }

const LINES: Record<string, Line> = {
  'wave-boss': { text: 'Warning. Carrier-class signature inbound.', voice: 'sage', delivery: CONTINUITY },
  'wave-leviathan': { text: 'All hands. LEVIATHAN-class signature detected.', voice: 'sage', delivery: CONTINUITY },
  'wave-cloaked': { text: 'Phase-cloaked contacts. Sensor coverage advised.', voice: 'sage', delivery: CONTINUITY },
  'wave-clear': { text: 'Corridor clear. Well held, Warden.', voice: 'sage', delivery: CONTINUITY },
  'gameover': { text: 'The light has gone out. We remember you, Warden.', voice: 'sage', delivery: CONTINUITY },
  'victory': { text: 'Sector secured. One million, one hundred six thousand souls thank you.', voice: 'sage', delivery: CONTINUITY },
  'archive': { text: 'Archive fragment recovered.', voice: 'sage', delivery: CONTINUITY },
  'courier': { text: 'Hold fire. The leviathan is hailing us.', voice: 'sage', delivery: CONTINUITY },
  'armistice': { text: 'The war is over. The receipt is signed. Come home.', voice: 'sage', delivery: CONTINUITY },
  'low-cores': { text: 'Warden. The cores are failing.', voice: 'sage', delivery: CONTINUITY },
  'unlock': { text: 'New instrument pattern decrypted.', voice: 'sage', delivery: CONTINUITY },
  'titan-down': { text: 'Carrier destroyed. Well shot, Warden.', voice: 'sage', delivery: CONTINUITY },
  'leviathan-down': { text: 'The dreadnought is down. The lane remembers.', voice: 'sage', delivery: CONTINUITY },
  'longwatch-brief': {
    text: 'Warden. The war you ended was never the only war. Something followed the Combine home through the old routes — the same hunger that hollowed the Locust world. It does not deliver. It does not queue. It eats light. The Combine remembers what you did for them. Their patrol frames are inbound to fight beside you. Two fleets, one lane, one lighthouse. They are calling it the Hollow. Keep the lantern lit.',
    voice: 'onyx', delivery: HOLLOW_CMD,
  },
};

// every Archive fragment, read by the archivist
ARCHIVE.forEach((f, i) => {
  LINES[`frag-read-${i}`] = { text: `${f.title}. ${f.text}`, voice: 'ash', delivery: ARCHIVIST };
});

async function gen(name: string, line: Line) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-audio-mini',
      modalities: ['text', 'audio'],
      audio: { voice: line.voice, format: 'pcm16' },
      messages: [
        { role: 'system', content: SYS(line.delivery) },
        { role: 'user', content: line.text },
      ],
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const chunks: Buffer[] = [];
  let buf = '';
  let cost = 0;
  const dec = new TextDecoder();
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(part, { stream: true });
    const ls = buf.split('\n');
    buf = ls.pop() ?? '';
    for (const l of ls) {
      if (!l.startsWith('data: ') || l.includes('[DONE]')) continue;
      try {
        const j = JSON.parse(l.slice(6));
        const d = j.choices?.[0]?.delta?.audio?.data;
        if (d) chunks.push(Buffer.from(d, 'base64'));
        if (j.usage?.cost) cost = j.usage.cost;
      } catch { /* partial */ }
    }
  }
  const pcm = Buffer.concat(chunks);
  if (pcm.length < 2000) throw new Error('empty');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(join(outDir, `${name}.wav`), Buffer.concat([h, pcm]));
  console.log(`${name}.wav (${Math.round(pcm.length / 1024)} KB, $${cost.toFixed(4)})`);
  return cost;
}

const wanted = process.argv.slice(2);
let total = 0;
for (const [name, line] of Object.entries(LINES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  try { total += await gen(name, line); } catch (e) { console.log(`${name} FAILED: ${(e as Error).message}`); }
}
console.log(`total: $${total.toFixed(4)}`);
