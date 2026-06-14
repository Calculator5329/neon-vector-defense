import type { Wave, WaveGroup } from './types';

function g(type: string, count: number, gap: number, opts: Partial<WaveGroup> = {}): WaveGroup {
  return { type, count, gap, ...opts };
}

// 70 designed waves. Index 0 = wave 1.
const WAVES: Wave[] = [
  /* 1 */ [g('scout', 10, 1.0)],
  /* 2 */ [g('scout', 18, 0.8)],
  /* 3 */ [g('scout', 12, 0.7), g('raider', 4, 1.1, { delay: 1 })],
  /* 4 */ [g('raider', 10, 0.9), g('scout', 10, 0.5, { delay: 1 })],
  /* 5 */ [g('raider', 16, 0.7)],
  /* 6 */ [g('scout', 20, 0.35), g('raider', 8, 0.8, { delay: 1 })],
  /* 7 */ [g('stinger', 8, 1.0), g('raider', 10, 0.6, { delay: 1 })],
  /* 8 */ [g('stinger', 14, 0.7)],
  /* 9 */ [g('raider', 14, 0.5), g('stinger', 10, 0.6, { delay: 1 })],
  /* 10 */ [g('stinger', 18, 0.5), g('scout', 14, 0.3, { delay: 0.5 })],
  /* 11 */ [g('phantom', 6, 1.2), g('stinger', 10, 0.6, { delay: 1 })],
  /* 12 */ [g('phantom', 10, 0.8)],
  /* 13 */ [g('stinger', 16, 0.45), g('phantom', 8, 0.7, { delay: 1 })],
  /* 14 */ [g('scout', 10, 0.3, { cloaked: true }), g('stinger', 12, 0.5, { delay: 1 })],
  /* 15 */ [g('phantom', 14, 0.55), g('raider', 12, 0.4, { delay: 0.5 })],
  /* 16 */ [g('wraith', 8, 0.9), g('phantom', 8, 0.6, { delay: 1 })],
  /* 17 */ [g('stinger', 12, 0.4, { cloaked: true })],
  /* 18 */ [g('wraith', 14, 0.6)],
  /* 19 */ [g('phantom', 12, 0.5), g('wraith', 10, 0.6, { delay: 1 })],
  /* 20 */ [g('shade', 8, 1.0), g('wraith', 8, 0.6, { delay: 1.5 })],
  /* 21 */ [g('shade', 12, 0.8)],
  /* 22 */ [g('prism', 12, 0.8)],
  /* 23 */ [g('shade', 8, 0.8), g('prism', 8, 0.8, { delay: 0.5 })],
  /* 24 */ [g('phantom', 12, 0.35, { cloaked: true }), g('shade', 8, 0.8, { delay: 1 })],
  /* 25 */ [g('aegis', 6, 1.4), g('wraith', 12, 0.5, { delay: 1.5 })],
  /* 26 */ [g('aegis', 10, 1.0)],
  /* 27 */ [g('chrono', 10, 0.9), g('prism', 8, 0.7, { delay: 1 })],
  /* 28 */ [g('chrono', 14, 0.7)],
  /* 29 */ [g('aegis', 8, 0.9), g('chrono', 8, 0.7, { delay: 1 })],
  /* 30 */ [g('wraith', 16, 0.35, { cloaked: true }), g('seraph', 2, 4, { delay: 0.5 }), g('aegis', 8, 0.9, { delay: 1 })],
  /* 31 */ [g('vortex', 8, 1.1), g('chrono', 8, 0.7, { delay: 1 })],
  /* 32 */ [g('vortex', 12, 0.8)],
  /* 33 */ [g('vortex', 10, 0.7), g('aegis', 8, 0.9, { delay: 0.8 })],
  /* 34 */ [g('shade', 12, 0.5, { cloaked: true }), g('seraph', 3, 3, { delay: 0.5 }), g('vortex', 10, 0.7, { delay: 1 })],
  /* 35 */ [g('vortex', 16, 0.55), g('phantom', 16, 0.3, { delay: 0.5 })],
  /* 36 */ [g('juggernaut', 4, 1.6), g('vortex', 8, 0.7, { delay: 1.5 })],
  /* 37 */ [g('juggernaut', 7, 1.2)],
  /* 38 */ [g('chrono', 14, 0.45, { cloaked: true }), g('juggernaut', 5, 1.2, { delay: 1 })],
  /* 39 */ [g('juggernaut', 8, 0.9), g('seraph', 4, 2.5, { delay: 0.5 }), g('aegis', 10, 0.7, { delay: 0.5 })],
  /* 40 */ [g('titan', 1, 1), g('vortex', 10, 0.6, { delay: 2 })],
  /* 41 */ [g('juggernaut', 10, 0.8), g('vortex', 12, 0.5, { delay: 1 })],
  /* 42 */ [g('titan', 2, 6), g('juggernaut', 6, 1.0, { delay: 2 })],
  /* 43 */ [g('vortex', 14, 0.4, { cloaked: true }), g('juggernaut', 8, 0.9, { delay: 1 })],
  /* 44 */ [g('titan', 2, 4), g('chrono', 16, 0.4, { delay: 1.5 })],
  /* 45 */ [g('juggernaut', 14, 0.6), g('seraph', 5, 2, { delay: 1 })],
  /* 46 */ [g('titan', 3, 4), g('juggernaut', 6, 0.9, { delay: 2 })],
  /* 47 */ [g('juggernaut', 10, 0.55, { cloaked: true })],
  /* 48 */ [g('titan', 4, 3.5), g('vortex', 16, 0.4, { delay: 1 })],
  /* 49 */ [g('titan', 5, 3), g('juggernaut', 10, 0.7, { delay: 2 })],
  /* 50 */ [g('leviathan', 1, 1), g('juggernaut', 8, 0.9, { delay: 3 })],
  /* 51 */ [g('titan', 6, 2.6)],
  /* 52 */ [g('juggernaut', 18, 0.45), g('titan', 3, 3, { delay: 1 })],
  /* 53 */ [g('titan', 4, 2.5, { cloaked: true })],
  /* 54 */ [g('leviathan', 1, 1), g('titan', 3, 3, { delay: 4 })],
  /* 55 */ [g('titan', 8, 2.2), g('seraph', 6, 1.8, { delay: 1 }), g('juggernaut', 12, 0.5, { delay: 0.5 })],
  /* 56 */ [g('leviathan', 2, 8), g('vortex', 20, 0.3, { delay: 2 })],
  /* 57 */ [g('titan', 10, 1.8)],
  /* 58 */ [g('leviathan', 2, 6), g('titan', 4, 2.5, { delay: 3 })],
  /* 59 */ [g('juggernaut', 24, 0.35, { cloaked: true }), g('titan', 6, 2, { delay: 1 })],
  /* 60 */ [g('leviathan', 3, 5), g('titan', 4, 2.2, { delay: 4 })],
  /* 61 */ [g('leviathan', 2, 5), g('titan', 8, 1.6, { delay: 2 })],
  /* 62 */ [g('titan', 12, 1.4), g('seraph', 8, 1.5, { delay: 0.5 }), g('juggernaut', 16, 0.4, { delay: 0.5 })],
  /* 63 */ [g('leviathan', 3, 4), g('juggernaut', 20, 0.35, { delay: 2 })],
  /* 64 */ [g('titan', 6, 1.6, { cloaked: true }), g('leviathan', 2, 5, { delay: 2 })],
  /* 65 */ [g('leviathan', 4, 4)],
  /* 66 */ [g('leviathan', 3, 4), g('titan', 10, 1.4, { delay: 2 })],
  /* 67 */ [g('titan', 16, 1.1)],
  /* 68 */ [g('leviathan', 5, 3.2), g('titan', 6, 1.6, { delay: 3 })],
  /* 69 */ [g('leviathan', 4, 3, { cloaked: true }), g('juggernaut', 24, 0.3, { delay: 1 })],
  /* 70 */ [g('leviathan', 7, 2.6), g('titan', 8, 1.4, { delay: 4 })],
];

/** Get wave definition for a 1-based wave number. Beyond the table, scale endlessly. */
export function getWave(n: number): Wave {
  if (n <= WAVES.length) return WAVES[n - 1];
  const over = n - WAVES.length;
  return [
    g('leviathan', 4 + Math.floor(over * 1.5), Math.max(0.8, 2.6 - over * 0.1)),
    g('titan', 8 + over * 2, Math.max(0.5, 1.4 - over * 0.05), { delay: 2, cloaked: over % 2 === 0 }),
  ];
}

export function waveBonus(n: number): number {
  return 40 + n * 3;
}

/** Kill rewards taper after wave 30 so the late game stays a decision, not a pile. */
export function incomeMult(n: number): number {
  return n <= 30 ? 1 : Math.max(0.35, 1 - (n - 30) * 0.018);
}
