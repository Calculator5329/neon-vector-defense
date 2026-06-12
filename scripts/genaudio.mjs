// Generate music + voiceover via OpenRouter audio models (streaming). Saves to public/audio/.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let KEY = existsSync(join(root, '.env.local'))
  ? readFileSync(join(root, '.env.local'), 'utf8').match(/OPENROUTER_API_KEY=(\S+)/)?.[1]
  : undefined;
KEY ||= process.env.OPENROUTER_API_KEY;
const outDir = join(root, 'public', 'audio');
mkdirSync(outDir, { recursive: true });

async function streamAudio(body) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const chunks = [];
  let buf = '';
  let cost = 0;
  const decoder = new TextDecoder();
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const j = JSON.parse(line.slice(6));
        const d = j.choices?.[0]?.delta;
        const data = d?.audio?.data ?? d?.audio?.[0]?.data;
        if (data) chunks.push(Buffer.from(data, 'base64'));
        if (j.usage?.cost) cost = j.usage.cost;
      } catch { /* partial */ }
    }
  }
  return { audio: Buffer.concat(chunks), cost };
}

function wavWrap(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function save(name, audio, cost) {
  if (audio.length < 1000) throw new Error('no audio data');
  let file, out;
  if (audio.slice(0, 4).toString() === 'RIFF') { file = `${name}.wav`; out = audio; }
  else if (audio[0] === 0xff || audio.slice(0, 3).toString() === 'ID3') { file = `${name}.mp3`; out = audio; }
  else { file = `${name}.wav`; out = wavWrap(audio); }
  writeFileSync(join(outDir, file), out);
  console.log(`${file} saved (${Math.round(out.length / 1024)} KB, cost $${cost.toFixed(4)})`);
}

const BRIEF_SYS = 'You are a professional voice actor recording a final take for a video game. Delivery: weathered, tired but resolute military commander over a crackling long-range radio; slow, gravelly, deliberate. Speak the user message VERBATIM, exactly as written. Output ONLY the spoken line itself - no acknowledgements, no preamble, no commentary.';
const BRIEF = 'Sector Command to Warden of Lantern Seven. The Combine fleet has entered your approach corridor. Seven carries the Continuity of four colony ships. One million, one hundred and six thousand archived souls. They are awake in there. They can hear the hull. Lanterns One through Four are dark. Hold the lane, Warden. We are still trying to find out why the enemy is still fighting.';

const MUSIC = 'Dark ambient sci-fi game menu theme: slow sorrowful minor-key synth pads, deep sub drone, sparse glassy music-box arpeggios in vast reverb, lonely lighthouse drifting in deep space, cinematic, seamless loop, no vocals, no drums.';

const wanted = process.argv.slice(2);
if (!wanted.length || wanted.includes('briefing')) {
  try {
    const { audio, cost } = await streamAudio({
      model: 'openai/gpt-audio-mini',
      modalities: ['text', 'audio'],
      audio: { voice: 'onyx', format: 'pcm16' },
      messages: [{ role: 'system', content: BRIEF_SYS }, { role: 'user', content: BRIEF }],
    });
    save('briefing', audio, cost);
  } catch (e) { console.log('briefing failed:', e.message); }
}
if (!wanted.length || wanted.includes('theme')) {
  for (const model of ['google/lyria-3-clip-preview', 'google/lyria-3-pro-preview']) {
    try {
      const { audio, cost } = await streamAudio({ model, modalities: ['audio', 'text'], messages: [{ role: 'user', content: MUSIC }] });
      save('theme', audio, cost);
      break;
    } catch (e) { console.log(`${model} failed:`, e.message); }
  }
}
