import type { DifficultyDef, GameMap } from './types';

// All coordinates in a 1280x720 logical space.
export const MAPS: GameMap[] = [
  {
    id: 'orbital',
    name: 'Orbital Relay',
    desc: 'A long, winding supply corridor around the relay core. Plenty of room to build.',
    difficulty: 'Easy',
    pathWidth: 46,
    path: [
      { x: -40, y: 140 }, { x: 320, y: 140 }, { x: 320, y: 360 }, { x: 130, y: 360 },
      { x: 130, y: 580 }, { x: 620, y: 580 }, { x: 620, y: 130 }, { x: 950, y: 130 },
      { x: 950, y: 430 }, { x: 790, y: 430 }, { x: 790, y: 640 }, { x: 1160, y: 640 },
      { x: 1160, y: 300 }, { x: 1320, y: 300 },
    ],
    blockers: [{ x: 640, y: 360, r: 0 }],
    theme: { bg1: '#070b1a', bg2: '#0d1330', path: '#141d3d', pathEdge: '#2e4a8f' },
  },
  {
    id: 'reactor',
    name: 'Twin Reactor',
    desc: 'Two reactor cores pinch the lanes into tight chokepoints. Watch your spacing.',
    difficulty: 'Medium',
    pathWidth: 44,
    path: [
      { x: 640, y: -40 }, { x: 640, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 420 },
      { x: 540, y: 420 }, { x: 540, y: 250 }, { x: 1030, y: 250 }, { x: 1030, y: 520 },
      { x: 740, y: 520 }, { x: 740, y: 660 }, { x: 320, y: 660 }, { x: 320, y: 560 },
      { x: 120, y: 560 }, { x: 120, y: 760 },
    ],
    blockers: [
      { x: 395, y: 285, r: 58 },
      { x: 885, y: 385, r: 58 },
    ],
    theme: { bg1: '#0c071a', bg2: '#1a0d30', path: '#241440', pathEdge: '#6b2e8f' },
  },
  {
    id: 'hyperlane',
    name: 'Hyperlane Junction',
    desc: 'A short, brutal crossing lane. Hostiles are on top of you almost instantly.',
    difficulty: 'Hard',
    pathWidth: 42,
    path: [
      { x: -40, y: 600 }, { x: 420, y: 600 }, { x: 420, y: 180 }, { x: 860, y: 180 },
      { x: 860, y: 600 }, { x: 640, y: 600 }, { x: 640, y: 90 }, { x: 1100, y: 90 },
      { x: 1100, y: 480 }, { x: 1320, y: 480 },
    ],
    blockers: [
      { x: 200, y: 250, r: 80 },
      { x: 1080, y: 650, r: 70 },
    ],
    theme: { bg1: '#160707', bg2: '#2b0d14', path: '#3a1420', pathEdge: '#8f2e44' },
  },
];

export const MAPS2: GameMap[] = [
  {
    id: 'mobius',
    name: 'Möbius Drift',
    desc: 'A serpentine causeway folding back on itself. Towers cover many passes — and carriers pulse them all.',
    difficulty: 'Medium',
    pathWidth: 42,
    music: 'orbital',
    path: [
      { x: -40, y: 95 }, { x: 1110, y: 95 }, { x: 1110, y: 240 }, { x: 170, y: 240 },
      { x: 170, y: 385 }, { x: 1110, y: 385 }, { x: 1110, y: 530 }, { x: 170, y: 530 },
      { x: 170, y: 660 }, { x: 660, y: 660 }, { x: 660, y: 770 },
    ],
    blockers: [],
    theme: { bg1: '#06140f', bg2: '#0b2b1f', path: '#103428', pathEdge: '#2e8f6e' },
  },
  {
    id: 'blackout',
    name: 'Blackout Reach',
    desc: 'A dead sector. Outside the three beacon circles, tower range drops 35%. Build in the light.',
    difficulty: 'Hard',
    pathWidth: 44,
    music: 'reactor',
    path: [
      { x: -40, y: 360 }, { x: 250, y: 360 }, { x: 250, y: 130 }, { x: 640, y: 130 },
      { x: 640, y: 580 }, { x: 1010, y: 580 }, { x: 1010, y: 300 }, { x: 1320, y: 300 },
    ],
    blockers: [],
    zones: [
      { x: 250, y: 250, r: 150 },
      { x: 640, y: 360, r: 160 },
      { x: 1010, y: 440, r: 150 },
    ],
    theme: { bg1: '#0d0a04', bg2: '#1d1408', path: '#251a0c', pathEdge: '#8f6c2e' },
  },
  {
    id: 'throat',
    name: 'The Throat',
    desc: 'Wreckage chokes the sector into one tight double-back. A kill-box paradise — until a carrier walks in.',
    difficulty: 'Hard',
    pathWidth: 40,
    music: 'hyperlane',
    path: [
      { x: -40, y: 200 }, { x: 540, y: 200 }, { x: 540, y: 330 }, { x: 280, y: 330 },
      { x: 280, y: 460 }, { x: 540, y: 460 }, { x: 540, y: 590 }, { x: 900, y: 590 },
      { x: 900, y: 200 }, { x: 1100, y: 200 }, { x: 1100, y: 460 }, { x: 1320, y: 460 },
    ],
    blockers: [
      { x: 160, y: 600, r: 110 },
      { x: 1150, y: 80, r: 90 },
      { x: 80, y: 80, r: 90 },
      { x: 760, y: 350, r: 70 },
    ],
    theme: { bg1: '#140707', bg2: '#260c0c', path: '#331111', pathEdge: '#8f2e2e' },
  },
];

// THE HOLLOW sectors — the dark past the Combine's old line.
export const MAPS3: GameMap[] = [
  {
    id: 'umbral',
    name: 'Umbral Reach',
    desc: 'A dead corridor the Hollow has already started eating. Outside the three light-pools, your towers lose 35% range — the dark drinks the beam.',
    difficulty: 'Hard',
    pathWidth: 44,
    music: 'reactor',
    path: [
      { x: -40, y: 130 }, { x: 300, y: 130 }, { x: 300, y: 500 }, { x: 600, y: 500 },
      { x: 600, y: 160 }, { x: 940, y: 160 }, { x: 940, y: 540 }, { x: 1320, y: 540 },
    ],
    blockers: [],
    zones: [
      { x: 300, y: 315, r: 150 },
      { x: 600, y: 330, r: 150 },
      { x: 940, y: 350, r: 150 },
    ],
    theme: { bg1: '#0a0614', bg2: '#190b28', path: '#22103a', pathEdge: '#8a5cff' },
  },
  {
    id: 'cinder',
    name: 'Cinder Causeway',
    desc: 'A wreckage-choked double-back of burnt relay struts. A kill-box paradise — until the Umbra walks the lane and the kill-box becomes a coffin.',
    difficulty: 'Hard',
    pathWidth: 42,
    music: 'hyperlane',
    path: [
      { x: 640, y: -40 }, { x: 640, y: 170 }, { x: 240, y: 170 }, { x: 240, y: 470 },
      { x: 560, y: 470 }, { x: 560, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 560 },
      { x: 1120, y: 560 }, { x: 1120, y: 200 }, { x: 1320, y: 200 },
    ],
    blockers: [
      { x: 400, y: 320, r: 70 },
      { x: 760, y: 410, r: 62 },
      { x: 1010, y: 120, r: 58 },
    ],
    theme: { bg1: '#140a04', bg2: '#281408', path: '#34190a', pathEdge: '#d06a2a' },
  },
];

export const ALL_MAPS = [...MAPS, ...MAPS2, ...MAPS3];

export const DIFFICULTIES: DifficultyDef[] = [
  { id: 'easy', name: 'Recruit', lives: 200, cash: 900, costMult: 0.85, hpMult: 0.9, lateScale: 0.015, waves: 50, desc: '200 cores · cheap towers · no phase-cloaks · 50 waves' },
  { id: 'normal', name: 'Veteran', lives: 120, cash: 700, costMult: 1.0, hpMult: 1.4, lateScale: 0.03, waves: 60, desc: '120 cores · adaptive armada · 60 waves' },
  { id: 'hard', name: 'Apex', lives: 80, cash: 700, costMult: 1.2, hpMult: 1.8, lateScale: 0.075, waves: 70, desc: '80 cores · hardened adaptive hulls · escalating siege · 70 waves' },
  { id: 'extinction', name: 'Extinction', lives: 70, cash: 950, costMult: 1.2, hpMult: 1.95, lateScale: 0.11, waves: 80, desc: '70 cores · relentless armada · brutal escalating adaptation · 80 waves' },
];

/** Total length of a polyline path. */
export function pathLength(path: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return len;
}
