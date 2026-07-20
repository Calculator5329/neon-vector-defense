// THE YAKKOB — a hand-authored "special edition" challenge, not a seeded daily.
//
// Lore: a pixelated dwarf dug too greedily and too deep beneath Lantern Seven and
// broke through into the old prism vault. He came back up carrying two instruments
// and a grin: the Prism Array and the Watchfire Beacon. That is the whole arsenal.
//
// It is UNLOCKED by clicking the digging dwarf on the main menu (see YakkobDwarf),
// after which it takes the Weekly Mutation's slot in the challenges dock. Because its
// id is a fixed word (not `daily-YYYY-MM-DD`), both the client and the Cloud Functions
// reject it for the online daily boards — THE YAKKOB is deliberately LOCAL-RANKED only
// (best wave tracked on-device via meta.bestYakkobWave). No deploy required.

import { buildTwistForId, type DailyChallenge } from './dailyChallenge';

export const YAKKOB_ID = 'yakkob';
export const YAKKOB_TOWER_IDS = ['prismarr', 'watchfire'] as const;

/** True when a challenge is THE YAKKOB (drives the squished-icon quirk + local ranking). */
export function isYakkob(challenge: { special?: string } | null | undefined): boolean {
  return challenge?.special === 'yakkob';
}

/** True for the two towers whose shop icons render squished (0.75× height) in THE YAKKOB. */
export function isYakkobSquishedTower(towerId: string): boolean {
  return towerId === 'prismarr' || towerId === 'watchfire';
}

export const THE_YAKKOB: DailyChallenge = {
  id: YAKKOB_ID,
  dateKey: 'special',
  special: 'yakkob',
  mapId: 'foundry',
  diffId: 'normal',
  title: 'THE YAKKOB',
  arsenal: {
    id: 'fixedPool',
    name: 'The Yakkob',
    short: 'YAKKOB',
    desc: 'Only the Prism Array and the Watchfire Beacon answer the call — the dwarf brought back nothing else.',
    towerIds: [...YAKKOB_TOWER_IDS],
    // The two premium beams at 40% requisition — the vault paid for itself. Keeps the
    // opening playable when the whole arsenal costs 1600+ / 2500+ at list price.
    costMultiplier: 0.4,
  },
  twist: buildTwistForId('glassCannon'),
  boon: {
    id: 'doublePickups',
    name: 'Dwarf\'s Luck',
    short: 'LUCK',
    desc: 'Combat pickups drop twice as often.',
    pickupDropMultiplier: 2,
  },
  rules: [
    'Only the Prism Array and the Watchfire Beacon are available — and their icons come back from the vault a little squashed.',
    'Both beams cost 40% of list price. Towers deal +30% damage, but reactor cores start at 60%.',
    'Combat pickups drop twice as often.',
    'Special edition — ranked locally on this device by wave, then hulls destroyed.',
  ],
};
