// Procedural audio engine — layered synth SFX + generative ambient score.
// No assets: everything is synthesized in WebAudio at runtime.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let delaySend: GainNode | null = null;
let musicOn = true;
let musicStarted = false;

function ensure(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    comp.connect(meter);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1.8; // hot — the compressor on master catches peaks
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.3;
    musicBus.connect(master);

    // a long feedback delay gives everything a cavernous "station interior" tail
    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = 0.34;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    delay.connect(damp).connect(fb).connect(delay);
    delaySend = ctx.createGain();
    delaySend.gain.value = 0.25;
    delaySend.connect(delay);
    delay.connect(master);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (!musicStarted && musicOn) startMusic();
  return ctx;
}

let meter: AnalyserNode | null = null;

/** peak absolute sample at the output right now (0..1) */
export function audioPeak(): number {
  if (!meter) return -1;
  const buf = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(buf);
  let p = 0;
  for (const v of buf) p = Math.max(p, Math.abs(v));
  return p;
}

export function audioDebug() {
  return {
    state: ctx?.state ?? 'no-ctx',
    master: master?.gain.value,
    sfxBus: sfxBus?.gain.value,
    musicBus: musicBus?.gain.value,
    musicStarted,
    sfxOn,
    musicOn,
    nowPlaying: musicEl?.src ?? null,
  };
}

// ---- separate SFX / music controls ----
let sfxOn = true;
export function setSfx(on: boolean) { sfxOn = on; }
export function isSfxOn() { return sfxOn; }
// legacy aliases (muted == sfx off)
export function setMuted(m: boolean) { setSfx(!m); }
export function isMuted() { return !sfxOn; }

// ---- music: shuffled playlists so the score never sits on one loop ----
const MENU_TRACKS = ['/audio/theme.mp3', '/audio/theme-2.mp3', '/audio/theme-3.mp3'];
let musicEl: HTMLAudioElement | null = null;
let playlist: string[] = [];
let plIdx = 0;

function startPlaylist(tracks: string[]) {
  playlist = [...tracks].sort(() => Math.random() - 0.5);
  plIdx = 0;
  playNextTrack();
}

function playNextTrack() {
  if (typeof Audio === 'undefined' || playlist.length === 0) return;
  if (musicEl) { musicEl.pause(); musicEl = null; }
  const src = playlist[plIdx % playlist.length];
  plIdx++;
  const el = new Audio(src);
  el.volume = 0.11;
  el.addEventListener('ended', () => { if (musicOn) playNextTrack(); });
  el.addEventListener('error', () => {
    playlist = playlist.filter((t) => t !== src);
    if (musicOn && playlist.length > 0) playNextTrack();
    else if (musicBus) musicBus.gain.value = musicOn ? 0.3 : 0; // procedural fallback
  });
  musicEl = el;
  if (musicBus) musicBus.gain.value = 0; // generated track replaces procedural pads
  if (musicOn) void el.play().catch(() => {});
}

export function setMusic(on: boolean) {
  musicOn = on;
  if (!on) {
    musicEl?.pause();
    if (musicBus) musicBus.gain.value = 0;
    return;
  }
  if (musicEl) void musicEl.play().catch(() => {});
  else startPlaylist(MENU_TRACKS);
  if (ctx && !musicStarted) startMusic();
}
export function isMusicOn() { return musicOn; }

/** sector ambience playlist in-game (sector track + theme variations); null = menu set */
export function playSectorTheme(mapId: string | null) {
  if (typeof Audio === 'undefined') return;
  const tracks = mapId
    ? [`/audio/amb-${mapId}.mp3`, '/audio/theme-2.mp3', '/audio/theme-3.mp3']
    : MENU_TRACKS;
  if (musicOn) startPlaylist(tracks);
  else playlist = tracks; // queued for when music returns
}

// announcer voice lines (generated, see scripts/genvox.mjs)
const voxCache: Record<string, HTMLAudioElement> = {};
let lastVox = 0;
export function vox(name: string) {
  if (!sfxOn || typeof Audio === 'undefined') return;
  const now = performance.now();
  if (now - lastVox < 2500) return;
  lastVox = now;
  let el = voxCache[name];
  if (!el) {
    el = new Audio(`/audio/vox/${name}.wav`);
    el.volume = 0.8;
    voxCache[name] = el;
  }
  el.currentTime = 0;
  void el.play().catch(() => {});
}

/** voiced transmission; returns a stopper */
export function playBriefing(src = '/audio/briefing.wav'): () => void {
  if (!sfxOn || typeof Audio === 'undefined') return () => {};
  const el = new Audio(src);
  el.volume = 0.85;
  void el.play().catch(() => {});
  return () => { el.pause(); };
}

/** short musical stinger for run endings */
export function playStinger(name: 'victory' | 'defeat') {
  if (!sfxOn || typeof Audio === 'undefined') return;
  const el = new Audio(`/audio/stinger-${name}.mp3`);
  el.volume = 0.4;
  void el.play().catch(() => {});
}

/** archive narration; stops any previous reading */
let narrationEl: HTMLAudioElement | null = null;
export function playNarration(index: number): () => void {
  if (typeof Audio === 'undefined') return () => {};
  narrationEl?.pause();
  const el = new Audio(`/audio/vox/frag-read-${index}.wav`);
  el.volume = 0.85;
  narrationEl = el;
  void el.play().catch(() => {});
  return () => { el.pause(); };
}

// ---------------- synth primitives ----------------

interface Voice {
  freq: number;
  freq2?: number;       // slide target
  type: OscillatorType;
  dur: number;
  vol: number;
  attack?: number;
  detune?: number;      // adds a 2nd detuned osc
  lp?: number;          // lowpass cutoff
  lp2?: number;         // cutoff slide target
  echo?: number;        // 0..1 send to the delay
}

// One reusable white-noise buffer for every burst — building+filling a fresh
// AudioBuffer per call was a steady allocation drip at high fire rates (the gain
// envelope below shapes the decay, so the source buffer can be flat and shared).
let noiseBuf: AudioBuffer | null = null;
function pooledNoise(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.floor(c.sampleRate); // 1 second, long enough for any burst
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}

// Global concurrent-voice cap: a packed late-game board can't spawn unbounded
// oscillator graphs (the per-type throttles bound each sound, not the total).
let activeVoices = 0;
const MAX_VOICES = 30;
function bump(node: AudioScheduledSourceNode) {
  activeVoices++;
  node.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
}

function voice(v: Voice) {
  if (!sfxOn) return;
  const c = ensure();
  if (!c || !sfxBus || !delaySend || activeVoices >= MAX_VOICES) return;
  const t = c.currentTime;
  const gn = c.createGain();
  const atk = v.attack ?? 0.004;
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(v.vol, t + atk);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);

  let out: AudioNode = gn;
  if (v.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(v.lp, t);
    if (v.lp2) f.frequency.exponentialRampToValueAtTime(Math.max(40, v.lp2), t + v.dur);
    gn.connect(f);
    out = f;
  }
  out.connect(sfxBus);
  if (v.echo) {
    const send = c.createGain();
    send.gain.value = v.echo;
    out.connect(send).connect(delaySend);
  }

  const mk = (det: number) => {
    const o = c.createOscillator();
    o.type = v.type;
    o.frequency.setValueAtTime(v.freq, t);
    if (v.freq2) o.frequency.exponentialRampToValueAtTime(Math.max(25, v.freq2), t + v.dur);
    o.detune.value = det;
    o.connect(gn);
    o.start(t);
    o.stop(t + v.dur + 0.05);
    return o;
  };
  bump(mk(0)); // one voice-count per call, released when the primary osc ends
  if (v.detune) mk(v.detune);
}

function noiseBurst(dur: number, vol: number, opts: { bp?: number; q?: number; lp?: number; lp2?: number; echo?: number } = {}) {
  if (!sfxOn) return;
  const c = ensure();
  if (!c || !sfxBus || !delaySend || activeVoices >= MAX_VOICES) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = pooledNoise(c);
  // start at a random offset so reusing one buffer doesn't sound repetitive
  src.loop = true;
  const gn = c.createGain();
  // a sharper-than-linear decay approximates the old per-sample envelope
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = src;
  if (opts.bp) {
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = opts.bp;
    f.Q.value = opts.q ?? 1.2;
    node.connect(f);
    node = f;
  }
  if (opts.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(opts.lp, t);
    if (opts.lp2) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.lp2), t + dur);
    node.connect(f);
    node = f;
  }
  node.connect(gn).connect(sfxBus);
  if (opts.echo) {
    const send = c.createGain();
    send.gain.value = opts.echo;
    gn.connect(send).connect(delaySend);
  }
  src.start(t, Math.random() * 0.9); // random offset into the shared buffer
  src.stop(t + dur + 0.02);          // looped source must be stopped explicitly
  bump(src);
}

/** sub-bass thump for impacts */
function thump(freq: number, dur: number, vol: number) {
  voice({ freq, freq2: freq * 0.4, type: 'sine', dur, vol, attack: 0.002 });
}

// throttle high-frequency sounds so 3x speed doesn't become a wall of noise
const lastPlayed: Record<string, number> = {};
function throttled(key: string, minGapMs: number, fn: () => void) {
  const now = performance.now();
  if (now - (lastPlayed[key] ?? 0) < minGapMs) return;
  lastPlayed[key] = now;
  fn();
}

const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

// ---------------- the sound set ----------------

export const sfx = {
  // weapons
  shoot: () => throttled('shoot', 50, () => {
    voice({ freq: 950, freq2: 320, type: 'square', dur: 0.07, vol: 0.10, lp: 3200, lp2: 700 });
    noiseBurst(0.04, 0.05, { bp: 2600 });
  }),
  laser: () => throttled('laser', 65, () => {
    voice({ freq: 1500, freq2: 400, type: 'sawtooth', dur: 0.1, vol: 0.07, detune: 9, lp: 4200, lp2: 900 });
  }),
  zap: () => throttled('zap', 75, () => {
    voice({ freq: 240, freq2: 1400, type: 'sawtooth', dur: 0.09, vol: 0.08, lp: 5200 });
    noiseBurst(0.07, 0.06, { bp: 3400, q: 2.5 });
  }),
  rail: () => throttled('rail', 95, () => {
    voice({ freq: 2400, freq2: 110, type: 'sawtooth', dur: 0.22, vol: 0.11, detune: 14, lp: 6000, lp2: 300, echo: 0.4 });
    noiseBurst(0.1, 0.1, { bp: 1800 });
    thump(95, 0.16, 0.15);
  }),
  missile: () => throttled('missile', 85, () => {
    voice({ freq: 150, freq2: 420, type: 'triangle', dur: 0.3, vol: 0.12, lp: 1200 });
    noiseBurst(0.28, 0.07, { bp: 900, q: 0.8 });
  }),
  beamHum: () => throttled('beamHum', 70, () => {
    voice({ freq: 880, freq2: 660, type: 'sawtooth', dur: 0.12, vol: 0.05, detune: 6, lp: 2600 });
  }),
  gravity: () => throttled('gravity', 220, () => {
    voice({ freq: 60, freq2: 38, type: 'sine', dur: 0.5, vol: 0.16, echo: 0.3 });
    voice({ freq: 480, freq2: 90, type: 'sine', dur: 0.45, vol: 0.05 });
  }),
  resonance: () => throttled('resonance', 130, () => {
    voice({ freq: 523, type: 'sine', dur: 0.3, vol: 0.06, detune: 5, echo: 0.6, attack: 0.02 });
    voice({ freq: 784, type: 'sine', dur: 0.34, vol: 0.045, detune: 5, echo: 0.6, attack: 0.03 });
  }),
  cryo: () => throttled('cryo', 130, () => {
    voice({ freq: 2400, freq2: 700, type: 'sine', dur: 0.22, vol: 0.06, detune: 12, echo: 0.35 });
    noiseBurst(0.18, 0.04, { bp: 5200, q: 3 });
  }),

  // impacts
  pop: () => throttled('pop', 35, () => {
    const j = 0.85 + Math.random() * 0.4; // pitch jitter so a stream of kills doesn't sound stamped
    voice({ freq: 480 * j, freq2: 1150 * j, type: 'triangle', dur: 0.07, vol: 0.16 });
    voice({ freq: 1900 * j, freq2: 600, type: 'sine', dur: 0.09, vol: 0.07 });
    noiseBurst(0.07, 0.1, { bp: 2600 * j, q: 1.6 });
    noiseBurst(0.05, 0.05, { bp: 6200, q: 3 }); // glassy debris glint
  }),
  crunch: () => throttled('crunch', 50, () => {
    const j = 0.9 + Math.random() * 0.25;
    noiseBurst(0.16, 0.16, { bp: 700 * j, q: 0.7 });   // metal shear
    noiseBurst(0.09, 0.1, { bp: 2900, q: 2.2 });       // plate snap
    voice({ freq: 160 * j, freq2: 55, type: 'square', dur: 0.16, vol: 0.13, lp: 900 });
    thump(70, 0.18, 0.14);
  }),
  explosion: () => throttled('boom', 70, () => {
    noiseBurst(0.4, 0.22, { lp: 2400, lp2: 200, echo: 0.35 });
    thump(85, 0.35, 0.25);
  }),
  bossDown: () => {
    noiseBurst(0.7, 0.3, { lp: 3000, lp2: 120, echo: 0.5 });
    thump(55, 0.8, 0.3);
    later(120, () => noiseBurst(0.5, 0.18, { lp: 1500, lp2: 90 }));
    later(260, () => voice({ freq: 220, freq2: 55, type: 'sawtooth', dur: 0.6, vol: 0.12, lp: 900, lp2: 120 }));
  },
  leak: () => {
    voice({ freq: 170, freq2: 70, type: 'square', dur: 0.32, vol: 0.16, lp: 1100 });
    later(90, () => voice({ freq: 120, freq2: 55, type: 'square', dur: 0.3, vol: 0.12, lp: 800 }));
  },

  // economy / UI
  build: () => {
    noiseBurst(0.07, 0.08, { bp: 1200 });
    voice({ freq: 392, type: 'square', dur: 0.07, vol: 0.08, lp: 2400 });
    later(80, () => voice({ freq: 587, type: 'square', dur: 0.1, vol: 0.08, lp: 2800 }));
  },
  upgrade: () => [523, 659, 784].forEach((f, i) =>
    later(i * 65, () => voice({ freq: f, type: 'square', dur: 0.1, vol: 0.08, lp: 3000, echo: 0.2 }))),
  sell: () => voice({ freq: 520, freq2: 240, type: 'sine', dur: 0.18, vol: 0.1 }),
  pickup: () => {
    voice({ freq: 880, type: 'sine', dur: 0.09, vol: 0.1, echo: 0.3 });
    later(70, () => voice({ freq: 1318, type: 'sine', dur: 0.14, vol: 0.1, echo: 0.3 }));
  },
  archive: () => [659, 880, 1108, 1318].forEach((f, i) =>
    later(i * 110, () => voice({ freq: f, type: 'sine', dur: 0.5, vol: 0.06, detune: 4, echo: 0.7, attack: 0.03 }))),
  error: () => voice({ freq: 130, type: 'square', dur: 0.12, vol: 0.1, lp: 900 }),
  click: () => voice({ freq: 740, type: 'sine', dur: 0.045, vol: 0.08 }),

  // abilities
  strike: () => {
    voice({ freq: 3200, freq2: 200, type: 'sawtooth', dur: 0.5, vol: 0.1, detune: 20, lp: 8000, lp2: 300, echo: 0.5 });
    later(140, () => { noiseBurst(0.55, 0.28, { lp: 2600, lp2: 150, echo: 0.45 }); thump(50, 0.7, 0.32); });
  },
  chrono: () => {
    voice({ freq: 660, freq2: 110, type: 'sine', dur: 1.1, vol: 0.1, detune: 8, echo: 0.6, attack: 0.05 });
  },
  overdrive: () => {
    voice({ freq: 110, freq2: 440, type: 'sawtooth', dur: 0.5, vol: 0.1, lp: 1500, lp2: 4500 });
    later(180, () => voice({ freq: 220, freq2: 880, type: 'sawtooth', dur: 0.4, vol: 0.08, lp: 2000, lp2: 6000 }));
  },

  // flow
  waveStart: () => {
    voice({ freq: 330, freq2: 392, type: 'sawtooth', dur: 0.16, vol: 0.08, lp: 2200, echo: 0.3 });
    later(140, () => voice({ freq: 440, freq2: 523, type: 'sawtooth', dur: 0.2, vol: 0.08, lp: 2400, echo: 0.3 }));
  },
  waveClear: () => [523, 784, 1046].forEach((f, i) =>
    later(i * 95, () => voice({ freq: f, type: 'triangle', dur: 0.18, vol: 0.1, echo: 0.35 }))),
  gameOver: () => {
    voice({ freq: 220, freq2: 110, type: 'sawtooth', dur: 0.55, vol: 0.14, lp: 1400, lp2: 300, echo: 0.4 });
    later(320, () => voice({ freq: 165, freq2: 70, type: 'sawtooth', dur: 0.9, vol: 0.14, lp: 1000, lp2: 200, echo: 0.5 }));
  },
  victory: () => [523, 659, 784, 1046, 1318, 1568].forEach((f, i) =>
    later(i * 130, () => voice({ freq: f, type: 'triangle', dur: 0.3, vol: 0.11, detune: 6, echo: 0.5 }))),
};

// ---------------- generative ambient score ----------------
// A slow chord pad cycles through a minor progression while a sparse
// pentatonic music-box arpeggio twinkles over a deep bass drone.

const CHORDS = [
  [110, 220, 261.6, 329.6],   // Am
  [87.3, 174.6, 261.6, 349.2], // F
  [130.8, 261.6, 329.6, 392],  // C
  [98, 196, 246.9, 392],       // G
];
const PENTA = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];

function startMusic() {
  const c = ctx;
  if (!c || !musicBus || musicStarted) return;
  musicStarted = true;
  if (!musicOn) musicBus.gain.value = 0;

  // generated playlist carries the score; the pads below are only the fallback
  if (musicEl === null && musicOn) startPlaylist(MENU_TRACKS);

  let chordIdx = 0;

  const pad = () => {
    if (!ctx || !musicBus) return;
    const t = ctx.currentTime;
    const chord = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    for (const f of chord) {
      const o = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      o.type = 'sawtooth'; o2.type = 'sawtooth';
      o.frequency.value = f; o2.frequency.value = f;
      o2.detune.value = 7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.022, t + 3.2);
      g.gain.linearRampToValueAtTime(0.0001, t + 8);
      o.connect(g); o2.connect(g);
      g.connect(lp).connect(musicBus);
      o.start(t); o2.start(t);
      o.stop(t + 8.2); o2.stop(t + 8.2);
    }
    // deep drone an octave below the root
    const d = ctx.createOscillator();
    const dg = ctx.createGain();
    d.type = 'sine';
    d.frequency.value = chord[0] / 2;
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.linearRampToValueAtTime(0.05, t + 2.5);
    dg.gain.linearRampToValueAtTime(0.0001, t + 8);
    d.connect(dg).connect(musicBus);
    d.start(t); d.stop(t + 8.2);
    setTimeout(pad, 7400);
  };

  const sparkle = () => {
    if (!ctx || !musicBus || !delaySend) return;
    if (musicOn && !musicEl && Math.random() < 0.75) { // procedural fallback only
      const t = ctx.currentTime;
      const f = PENTA[Math.floor(Math.random() * PENTA.length)];
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g);
      g.connect(musicBus);
      const send = ctx.createGain();
      send.gain.value = 0.8;
      g.connect(send).connect(delaySend);
      o.start(t); o.stop(t + 1.7);
    }
    setTimeout(sparkle, 900 + Math.random() * 2200);
  };

  pad();
  setTimeout(sparkle, 2000);
}

