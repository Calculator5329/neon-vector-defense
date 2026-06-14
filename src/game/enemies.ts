import type { EnemyDef } from './types';

// Layered enemy hierarchy, BTD-style: destroying one spawns its children.
// The Vex Combine — a self-replicating machine collective from the galactic rim.
const defs: EnemyDef[] = [
  {
    id: 'scout', name: 'Scout Drone', hp: 1, speed: 60, radius: 9, reward: 2,
    color: '#ff4757', glow: '#ff6b81', children: [], shape: 'tri',
    lore: 'Disposable recon frames. The Combine prints a million per cycle and grieves none of them.',
  },
  {
    id: 'raider', name: 'Raider Drone', hp: 1, speed: 84, radius: 10, reward: 3,
    color: '#3d8bfd', glow: '#74b3ff', children: ['scout'], shape: 'tri',
    lore: 'A scout wrapped in salvaged hull plate. Sheds its armor shell when destroyed — the scout inside keeps coming.',
  },
  {
    id: 'stinger', name: 'Stinger', hp: 1, speed: 108, radius: 10, reward: 4,
    color: '#2ed573', glow: '#7bed9f', children: ['raider'], shape: 'diamond',
    lore: 'Twin-bladed interceptor chassis. Its whine through a hull breach is the last sound many stations hear.',
  },
  {
    id: 'phantom', name: 'Phantom', hp: 1, speed: 190, radius: 10, reward: 5,
    color: '#ffd32a', glow: '#fff200', children: ['stinger'], shape: 'diamond',
    lore: 'Strips its own shielding for raw burn velocity. Wardens who hesitate do not get a second shot.',
  },
  {
    id: 'wraith', name: 'Wraith', hp: 1, speed: 210, radius: 11, reward: 6,
    color: '#ff6ec7', glow: '#ffa7dd', children: ['phantom'], shape: 'ship',
    lore: 'Courier-class blockade runner. Built to outrun targeting computers — and most of the time, it does.',
  },
  {
    id: 'shade', name: 'Shade', hp: 2, speed: 110, radius: 12, reward: 8,
    color: '#57606f', glow: '#a4b0be', children: ['wraith', 'wraith'],
    immuneExplosive: true, shape: 'hex',
    lore: 'Reactive ablative lattice swallows blast waves whole. Explosives are a donation, not a threat.',
  },
  {
    id: 'prism', name: 'Prism', hp: 2, speed: 120, radius: 12, reward: 8,
    color: '#f1f2f6', glow: '#ffffff', children: ['wraith', 'wraith'],
    immuneCryo: true, shape: 'hex',
    lore: 'Mirror-faceted thermal hull. Cryo plasma refracts off it like light off a diamond.',
  },
  {
    id: 'aegis', name: 'Aegis Hull', hp: 3, speed: 55, radius: 13, reward: 10,
    color: '#8395a7', glow: '#c8d6e5', children: ['shade', 'shade'],
    armored: true, shape: 'pent',
    lore: 'Forged from collapsed-star alloy. Kinetic rounds flatten against it like rain. Bring energy, blasts, or AP slugs.',
  },
  {
    id: 'chrono', name: 'Chrono Husk', hp: 2, speed: 130, radius: 12, reward: 10,
    color: '#9c88ff', glow: '#c8b6ff', children: ['shade', 'prism'],
    immuneExplosive: true, immuneCryo: true, shape: 'hex',
    lore: 'Phase-skips a few milliseconds out of sync. Blasts and cryo arrive at a moment it no longer occupies.',
  },
  {
    id: 'vortex', name: 'Vortex Frame', hp: 3, speed: 125, radius: 13, reward: 14,
    color: '#00d2d3', glow: '#7efff5', children: ['chrono', 'chrono'], shape: 'pent',
    lore: 'A spinning cage of gravity coils hauling two Chrono Husks to the front. The Combine wastes nothing.',
  },
  {
    id: 'juggernaut', name: 'Juggernaut Shell', hp: 14, speed: 95, radius: 15, reward: 24,
    color: '#cd6133', glow: '#ffa502', children: ['vortex', 'vortex'], shape: 'pent',
    lore: 'Ceramic-composite siege carapace. Crack it open and the payload inside cracks back.',
  },
  {
    id: 'seraph', name: 'Seraph Tender', hp: 5, speed: 72, radius: 14, reward: 18,
    color: '#7bed9f', glow: '#baffd0', children: ['chrono', 'chrono'],
    heal: { radius: 95, hps: 4 }, shape: 'hex',
    lore: 'A repair tender that mends the convoy as it moves. It has rebuilt the same frames ten thousand times. The Combine does not understand death; it only understands deferred maintenance.',
  },
  {
    id: 'titan', name: 'TITAN Carrier', hp: 240, speed: 38, radius: 26, reward: 150,
    color: '#e84118', glow: '#ff7f50', children: ['juggernaut', 'juggernaut', 'juggernaut', 'juggernaut'],
    boss: true, shape: 'capital',
    lore: 'Mobile foundry the size of a city block. Four Juggernaut bays, all loaded. Relay 4 fell to a single TITAN.',
  },
  {
    id: 'leviathan', name: 'LEVIATHAN Dreadnought', hp: 900, speed: 26, radius: 36, reward: 500,
    color: '#6c2eb9', glow: '#b388ff', children: ['titan', 'titan', 'titan', 'titan'],
    boss: true, shape: 'capital',
    lore: 'The Combine\'s answer to a fortified sector: erase the sector. Carries four TITANs in its launch cradles. There is no Relay 1 through 3 anymore.',
  },

  // ---- THE HOLLOW: the hunger that followed the Combine home. It does not deliver,
  // it does not queue — it eats light. Bleeds through in the deepest sieges and freeplay.
  {
    id: 'wisp', name: 'Hollow Wisp', hp: 2, speed: 142, radius: 9, reward: 6,
    color: '#2c2046', glow: '#b388ff', children: [], shape: 'tri',
    immuneCryo: true,
    lore: 'A scrap of un-light, fast and starving. Cold cannot slow what was never warm.',
  },
  {
    id: 'gorge', name: 'Hollow Gorge', hp: 9, speed: 72, radius: 13, reward: 16,
    color: '#231634', glow: '#9b6dff', children: ['wisp', 'wisp'], shape: 'hex',
    armored: true, immuneExplosive: true,
    lore: 'Light bends around it and does not return. Kinetic rounds flatten; blasts simply stop. Bring energy — or bring nothing.',
  },
  {
    id: 'lampblack', name: 'Lampblack Tender', hp: 7, speed: 64, radius: 14, reward: 20,
    color: '#1a1230', glow: '#7d5fff', children: ['gorge'], shape: 'hex',
    heal: { radius: 110, hps: 7 }, immuneCryo: true,
    lore: 'It mends its kin by un-happening their wounds. Where it tends the convoy, damage forgets it was ever dealt.',
  },
  {
    id: 'umbra', name: 'THE UMBRA', hp: 1400, speed: 22, radius: 40, reward: 850,
    color: '#0a0614', glow: '#b388ff', children: ['titan', 'titan'],
    boss: true, armored: true, immuneExplosive: true, shape: 'capital',
    lore: 'The thing the Combine spent three centuries holding back. Where it passes, the lighthouse forgets it was ever lit. It does not deliver. It does not queue. It eats the light — and then it starts on the dark.',
  },
];

export const ENEMIES: Record<string, EnemyDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Total layered enemy count (lives lost on leak), computed recursively. */
export function rbe(id: string): number {
  const d = ENEMIES[id];
  return 1 + d.children.reduce((n, c) => n + rbe(c), 0);
}
