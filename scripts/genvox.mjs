// Generate announcer voice lines (the Continuity — Lantern Seven's million-soul chorus).
// Saves to public/audio/vox/. Usage: node scripts/genvox.mjs [name ...]
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let KEY = existsSync(join(root, '.env.local'))
  ? readFileSync(join(root, '.env.local'), 'utf8').match(/OPENROUTER_API_KEY=(\S+)/)?.[1]
  : process.env.OPENROUTER_API_KEY;
const outDir = join(root, 'public', 'audio', 'vox');
mkdirSync(outDir, { recursive: true });

const STYLE = 'You are the calm, slightly ethereal voice of a space station AI carrying a million archived human minds — gentle, layered, unhurried, with quiet warmth. Say ONLY the following line, nothing else:';

const LINES = {
  'wave-boss': 'Warning. Carrier-class signature inbound.',
  'wave-leviathan': 'All hands. LEVIATHAN-class signature detected.',
  'wave-cloaked': 'Phase-cloaked contacts. Sensor coverage advised.',
  'wave-clear': 'Corridor clear. Well held, Warden.',
  'gameover': 'The light has gone out. We remember you, Warden.',
  'victory': 'Sector secured. One million, one hundred six thousand souls thank you.',
  'archive': 'Archive fragment recovered.',
  'courier': 'Hold fire. The leviathan is hailing us.',
  'armistice': 'The war is over. The receipt is signed. Come home.',
  'low-cores': 'Warden. The cores are failing.',
  'unlock': 'New instrument pattern decrypted.',
  'wave-incoming': 'Hostiles inbound.',
  'cast-strike': 'Orbital strike, away.',
  'cast-chrono': 'Chronal field engaged.',
  'cast-overdrive': 'Reactors to overdrive.',
  'cast-salvage': 'Emergency requisition inbound.',
  'cast-cascade': 'Null cascade.',
  'cast-mirror': 'Mirror protocol active.',
};

async function streamAudio(content) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-audio-mini',
      modalities: ['text', 'audio'],
      audio: { voice: 'sage', format: 'pcm16' },
      messages: [{ role: 'user', content }],
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const chunks = [];
  let buf = '';
  let cost = 0;
  const dec = new TextDecoder();
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const j = JSON.parse(line.slice(6));
        const d = j.choices?.[0]?.delta?.audio?.data;
        if (d) chunks.push(Buffer.from(d, 'base64'));
        if (j.usage?.cost) cost = j.usage.cost;
      } catch { /* partial */ }
    }
  }
  return { pcm: Buffer.concat(chunks), cost };
}

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const wanted = process.argv.slice(2);
let total = 0;
for (const [name, line] of Object.entries(LINES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  try {
    const { pcm, cost } = await streamAudio(`${STYLE}\n"${line}"`);
    if (pcm.length < 2000) throw new Error('empty');
    writeFileSync(join(outDir, `${name}.wav`), wav(pcm));
    total += cost;
    console.log(`${name}.wav (${Math.round(pcm.length / 1024)} KB, $${cost.toFixed(4)})`);
  } catch (e) { console.log(`${name} FAILED: ${e.message}`); }
}
console.log(`total: $${total.toFixed(4)}`);
