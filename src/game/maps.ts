import type { DifficultyDef, GameMap } from './types';
import { standardMapTheme } from './mapThemes';

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
    theme: standardMapTheme('orbital'),
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
    theme: standardMapTheme('reactor'),
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
    theme: standardMapTheme('hyperlane'),
  },
];

export const MAPS2: GameMap[] = [
  {
    id: 'carousel',
    name: 'The Carousel',
    desc: 'An outer-ring patrol route that slowly spirals inward. The long approach gives commanders time to breathe.',
    difficulty: 'Easy',
    pathWidth: 48,
    music: 'orbital',
    path: [
      { x: -40, y: 95 }, { x: 1180, y: 95 }, { x: 1180, y: 625 }, { x: 100, y: 625 },
      { x: 100, y: 165 }, { x: 1040, y: 165 }, { x: 1040, y: 555 }, { x: 240, y: 555 },
      { x: 240, y: 260 }, { x: 900, y: 260 }, { x: 900, y: 460 }, { x: 460, y: 460 },
      { x: 460, y: 760 },
    ],
    blockers: [],
    theme: standardMapTheme('carousel'),
  },
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
    theme: standardMapTheme('mobius'),
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
    theme: standardMapTheme('blackout'),
  },
  {
    id: 'splice',
    name: 'Splice Junction',
    desc: 'Braided service corridors cross through the same central choke. Coverage looks generous until the route folds back.',
    difficulty: 'Medium',
    pathWidth: 42,
    music: 'reactor',
    path: [
      { x: -40, y: 250 }, { x: 270, y: 250 }, { x: 520, y: 360 }, { x: 270, y: 470 },
      { x: 650, y: 470 }, { x: 520, y: 360 }, { x: 650, y: 250 }, { x: 1010, y: 250 },
      { x: 760, y: 360 }, { x: 1010, y: 470 }, { x: 1320, y: 470 },
    ],
    // r=24 fits the braid diamonds: their diagonals pass ~50px from center,
    // so anything bigger intrudes into the 42-wide lane
    blockers: [
      { x: 395, y: 360, r: 24 },
      { x: 885, y: 360, r: 24 },
    ],
    theme: standardMapTheme('splice'),
  },
  {
    id: 'mirror',
    name: 'Mirror Array',
    desc: 'A rotationally symmetric double-S through relay mirrors. Few obstructions, but every tower angle is awkward.',
    difficulty: 'Medium',
    pathWidth: 42,
    music: 'orbital',
    path: [
      { x: -40, y: 180 }, { x: 180, y: 180 }, { x: 180, y: 540 }, { x: 420, y: 540 },
      { x: 420, y: 180 }, { x: 640, y: 180 }, { x: 640, y: 540 }, { x: 860, y: 540 },
      { x: 860, y: 180 }, { x: 1100, y: 180 }, { x: 1100, y: 540 }, { x: 1320, y: 540 },
    ],
    blockers: [
      { x: 320, y: 360, r: 44 },
      { x: 960, y: 360, r: 44 },
    ],
    theme: standardMapTheme('mirror'),
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
    theme: standardMapTheme('throat'),
  },
];

// THE HOLLOW sectors — the dark past the Combine's old line.
export const MAPS3: GameMap[] = [
  {
    id: 'foundry',
    name: 'Foundry Floor',
    desc: 'Industrial switchbacks divided by furnace walls. The lane is readable; the build grid is not.',
    difficulty: 'Hard',
    pathWidth: 36,
    music: 'hyperlane',
    path: [
      { x: -40, y: 130 }, { x: 1000, y: 130 }, { x: 1000, y: 260 }, { x: 250, y: 260 },
      { x: 250, y: 390 }, { x: 1050, y: 390 }, { x: 1050, y: 520 }, { x: 300, y: 520 },
      { x: 300, y: 650 }, { x: 1320, y: 650 },
    ],
    // r=36 keeps 11px of clearance to the 36-wide lanes; the four relocated
    // walls used to sit on the vertical connector segments (x=250/300/1000/1050).
    blockers: [
      { x: 230, y: 195, r: 36 }, { x: 390, y: 195, r: 36 }, { x: 550, y: 195, r: 36 },
      { x: 710, y: 195, r: 36 }, { x: 870, y: 195, r: 36 }, { x: 1130, y: 195, r: 36 },
      { x: 150, y: 325, r: 36 }, { x: 390, y: 325, r: 36 }, { x: 550, y: 325, r: 36 },
      { x: 710, y: 325, r: 36 }, { x: 870, y: 325, r: 36 }, { x: 1030, y: 325, r: 36 },
      { x: 230, y: 455, r: 36 }, { x: 390, y: 455, r: 36 }, { x: 550, y: 455, r: 36 },
      { x: 710, y: 455, r: 36 }, { x: 870, y: 455, r: 36 }, { x: 1150, y: 455, r: 36 },
      { x: 390, y: 585, r: 36 }, { x: 500, y: 585, r: 36 }, { x: 640, y: 585, r: 36 },
      { x: 780, y: 585, r: 36 }, { x: 940, y: 585, r: 36 }, { x: 1100, y: 585, r: 36 },
    ],
    theme: standardMapTheme('foundry'),
  },
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
    theme: standardMapTheme('umbral'),
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
    theme: standardMapTheme('cinder'),
  },
];

// THE FRACTURE sectors — four hostile approaches beyond the old Hollow line.
// Each route enters from a different edge so the closing atlas leg tests every
// ingress orientation instead of repeating the campaign's usual west approach.
export const MAPS4: GameMap[] = [
  {
    id: 'crossfeed',
    name: 'Crossfeed Gate',
    desc: 'North and west approach geometry folds through a shared relay throat. The long cross-map sightlines hide a vicious final turn.',
    difficulty: 'Hard',
    pathWidth: 40,
    music: 'reactor',
    path: [
      { x: 360, y: -40 }, { x: 360, y: 150 }, { x: 110, y: 150 }, { x: 110, y: 360 },
      { x: 560, y: 360 }, { x: 560, y: 110 }, { x: 850, y: 110 }, { x: 850, y: 560 },
      { x: 1080, y: 560 }, { x: 1080, y: 300 }, { x: 1320, y: 300 },
    ],
    blockers: [
      { x: 240, y: 270, r: 48 },
      { x: 710, y: 260, r: 56 },
      { x: 970, y: 430, r: 44 },
    ],
    theme: { bg1: '#071517', bg2: '#0b3032', path: '#104044', pathEdge: '#44f0dd' },
  },
  {
    id: 'needleglass',
    name: 'Needleglass Run',
    desc: 'A razor-thin eastbound filament leaves generous build pockets, but almost no forgiveness for coverage gaps.',
    difficulty: 'Hard',
    pathWidth: 28,
    music: 'orbital',
    path: [
      { x: -40, y: 610 }, { x: 180, y: 610 }, { x: 180, y: 420 }, { x: 470, y: 420 },
      { x: 470, y: 650 }, { x: 720, y: 650 }, { x: 720, y: 230 }, { x: 1010, y: 230 },
      { x: 1010, y: 500 }, { x: 1180, y: 500 }, { x: 1180, y: 160 }, { x: 1320, y: 160 },
    ],
    blockers: [
      { x: 330, y: 535, r: 46 },
      { x: 595, y: 535, r: 46 },
      { x: 865, y: 365, r: 46 },
      { x: 1100, y: 340, r: 42 },
    ],
    theme: { bg1: '#100816', bg2: '#26102f', path: '#35153f', pathEdge: '#f06dff' },
  },
  {
    id: 'bastion',
    name: 'Bastion Lattice',
    desc: 'A south-entry siege lane threads a defensive graveyard. Dense bastions turn every tower cluster into a commitment.',
    difficulty: 'Hard',
    pathWidth: 34,
    music: 'hyperlane',
    path: [
      { x: 210, y: 760 }, { x: 210, y: 610 }, { x: 480, y: 610 }, { x: 480, y: 430 },
      { x: 170, y: 430 }, { x: 170, y: 210 }, { x: 680, y: 210 }, { x: 680, y: 500 },
      { x: 1010, y: 500 }, { x: 1010, y: 170 }, { x: 1190, y: 170 }, { x: 1190, y: 360 },
      { x: 1320, y: 360 },
    ],
    blockers: [
      { x: 80, y: 90, r: 42 }, { x: 220, y: 90, r: 42 }, { x: 360, y: 90, r: 42 },
      { x: 500, y: 90, r: 42 }, { x: 640, y: 90, r: 42 }, { x: 780, y: 90, r: 42 },
      { x: 920, y: 90, r: 42 }, { x: 1060, y: 70, r: 38 }, { x: 1210, y: 70, r: 38 },
      { x: 330, y: 320, r: 40 }, { x: 510, y: 320, r: 40 }, { x: 820, y: 320, r: 40 },
      { x: 900, y: 630, r: 42 }, { x: 1060, y: 630, r: 42 }, { x: 1220, y: 630, r: 42 },
      { x: 80, y: 570, r: 40 }, { x: 600, y: 630, r: 40 }, { x: 740, y: 630, r: 40 },
    ],
    theme: { bg1: '#171006', bg2: '#34230a', path: '#46300e', pathEdge: '#ffd15a' },
  },
  {
    id: 'eventide',
    name: 'Eventide Crown',
    desc: 'A right-entry coronation spiral circles a dead star. Beacon light rewards broad coverage while the route steadily closes around the core.',
    difficulty: 'Hard',
    pathWidth: 38,
    music: 'reactor',
    path: [
      { x: 1320, y: 100 }, { x: 1120, y: 100 }, { x: 1120, y: 620 }, { x: 150, y: 620 },
      { x: 150, y: 170 }, { x: 950, y: 170 }, { x: 950, y: 500 }, { x: 340, y: 500 },
      { x: 340, y: 290 }, { x: 770, y: 290 }, { x: 770, y: 410 }, { x: 560, y: 410 },
      { x: 560, y: -40 },
    ],
    blockers: [
      { x: 640, y: 350, r: 36 },
      { x: 1050, y: 370, r: 46 },
      { x: 245, y: 395, r: 44 },
    ],
    zones: [
      { x: 150, y: 395, r: 145 },
      { x: 640, y: 350, r: 165 },
      { x: 1080, y: 350, r: 145 },
    ],
    theme: { bg1: '#060912', bg2: '#10162b', path: '#171f3d', pathEdge: '#ff527b' },
  },
];

export const ALL_MAPS = [
  MAPS[0],      // Orbital Relay
  MAPS2[0],     // The Carousel
  MAPS[1],      // Twin Reactor
  MAPS2[3],     // Splice Junction
  MAPS2[1],     // Mobius Drift
  MAPS2[4],     // Mirror Array
  MAPS[2],      // Hyperlane Junction
  MAPS2[2],     // Blackout Reach
  MAPS2[5],     // The Throat
  MAPS3[0],     // Foundry Floor
  MAPS3[1],     // Umbral Reach
  MAPS3[2],     // Cinder Causeway
  MAPS4[0],     // Crossfeed Gate
  MAPS4[1],     // Needleglass Run
  MAPS4[2],     // Bastion Lattice
  MAPS4[3],     // Eventide Crown
];

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
