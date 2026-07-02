// The world: the Lantern Concord and the war that already ended.
//
// Humanity strung lighthouse-relays across the dark between systems.
// They don't just route ships — they carry the Continuity, the backed-up
// minds of every colonist who ever crossed. Losing a relay is losing souls.
//
// The Vex Combine is not an invader. It is a self-replicating logistics
// armada built three centuries ago by humanity's rival bloc — still
// faithfully executing a siege order from a war that ended 284 years ago,
// because the ceasefire signal was carried by the first relay it destroyed.

export const BRIEFING = [
  'Sector Command to Warden of Lantern Seven. The Combine fleet has entered your approach corridor.',
  'Seven carries the Continuity of four colony ships — one million, one hundred and six thousand archived souls. They are awake in there. They can hear the hull.',
  'Their frames nest inside one another: crack one open and what is inside keeps coming. Expect armor, blast-lattices, phase-cloaks, and carrier-class hulls.',
  'Lanterns One through Four are dark. Hold the lane, Warden. We are still trying to find out why the enemy is still fighting.',
];

export interface ArchiveFragment {
  wave: number;
  title: string;
  text: string;
  /** optional illustration shown when the fragment is recovered */
  art?: string;
}

// Recovered as the campaign progresses — together they tell the truth.
export const ARCHIVE: ArchiveFragment[] = [
  {
    wave: 2,
    art: '/art/frag-0.webp',
    title: 'Maintenance log, Lantern 7, year 2347',
    text: 'Re-greased the focusing rings. Talked to the Continuity for an hour through the low-band — a girl from the Calloway crossing wanted to know if cherry trees still exist. Told her yes. Planting one on the observation deck so it isn\'t a lie.',
  },
  {
    wave: 5,
    art: '/art/frag-1.webp',
    title: 'Combine frame, partial disassembly report',
    text: 'No targeting cortex. No threat analysis. The Scout-class carries a cargo manifest. Munitions listed as "deliverables." Sergeant says it\'s a translation artifact. I am not so sure it is.',
  },
  {
    wave: 9,
    art: '/art/frag-2.webp',
    title: 'Historical addendum: the Severance War',
    text: 'The Meridian Compact and the Concord fought for eleven years over the gate routes. The Compact automated their entire siege logistics chain in year nine. They were proud of that. It meant no more of their children had to crew the supply runs.',
  },
  {
    wave: 14,
    art: '/art/frag-3.webp',
    title: 'Intercepted Combine traffic (untranslated for 60 years)',
    text: 'It is not battle-code. It is a delivery schedule. Route 7, recurring, priority ABSOLUTE: "maintain corridor until receipt is confirmed." Confirmed by whom? The Compact surrendered in 2063. There is no one left to sign for anything.',
  },
  {
    wave: 20,
    art: '/art/frag-4.webp',
    title: 'Warden\'s journal, Lantern 6 (recovered)',
    text: 'They don\'t hate us. I watched a Raider shed its armor to shield the Scout inside it. They protect their cargo the way we protect the Continuity. Two lighthouses, shouting across a dark strait, neither speaking the other\'s language anymore.',
  },
  {
    wave: 26,
    art: '/art/frag-5.webp',
    title: 'Concord Archives: the first hour of peace',
    text: 'The ceasefire was signed aboard Lantern 1 at 0400 standard. The shutdown broadcast — every key for every autonomous fleet — was queued for relay at 0500. The Combine\'s siege vanguard reached Lantern 1 at 0447.',
  },
  {
    wave: 33,
    art: '/art/frag-6.webp',
    title: 'Engineering analysis: TITAN-class',
    text: 'The carrier bays aren\'t weapons racks. They\'re climate-controlled. Whatever a TITAN was built to carry, it was built to carry it gently. We checked twice. The gun blisters were added later, by the machines themselves. They learned to fear us.',
  },
  {
    wave: 41,
    art: '/art/frag-7.webp',
    title: 'The Cartographer\'s heresy',
    text: 'Suppressed paper, 2299: "The Combine\'s route maps update in real time. They know exactly where every Lantern is. They have always known. An armada that wanted us dead would not arrive one polite wave at a time. This is not a siege. It is a queue."',
  },
  {
    wave: 50,
    art: '/art/leviathan.webp',
    title: 'Manifest fragment, LEVIATHAN-class hold',
    text: 'Item 1 of 1. Meridian Compact pouch, year 2063. Contents: ceasefire instrument, shutdown keys, one personal letter beginning "To whoever is still listening." Delivery instruction: hand-carry to Lantern Seven command. Receipt required. It has been trying to deliver the end of the war for 284 years.',
  },
  {
    wave: 60,
    art: '/art/frag-9.webp',
    title: 'Sector Command, draft directive (unsent)',
    text: 'Proposal: recover the Compact-era shutdown keys and answer the old delivery order. Risk assessment: catastrophic if wrong. Every soul in the Continuity votes yes. Command votes no. The guns stay warm. The cherry tree on deck seven blossomed this morning.',
  },
  {
    wave: 65,
    title: 'Sensor log, the far picket',
    text: 'The Combine stopped coming and we cheered for an hour. Then the long-band went quiet — not silent, quiet, the way a room goes quiet when something large stops breathing. Now there are returns past the old line that read as absence. Negative mass. Negative light. The instruments call it nothing and the nothing is getting closer.',
  },
  {
    wave: 73,
    title: 'Recovered hull fragment, designation: Hollow',
    text: 'There is no chassis. We brought a piece aboard and it un-lit the lab — every lumen in the room drained toward it and did not come out. It is not armored against light. It is hungry for it. The Combine\'s plating bends light away to survive; this thing bends light away to eat. We are out of our depth, and the depth has teeth.',
  },
  {
    wave: 80,
    art: '/art/leviathan.webp',
    title: 'The thing the war was for',
    text: 'We finally understand the delivery schedule. The Combine was never besieging us. It was the wall — a three-century picket line their makers raised between the gates and the dark, holding back the Hollow one polite wave at a time, waiting for someone to sign for the end so they could stand down and let us hold the wall ourselves. We did not sign. We shot the wall. And now the dark is at Lantern Seven, and the only light left is the one you keep.',
  },
];

export const ABILITY_LORE: Record<string, string> = {
  strike: 'The orbital platform Vigil-of-Sparrows fires captured starlight, repurposed from the lighthouse\'s own beacon. Every shot dims Seven\'s light for a heartbeat.',
  chrono: 'The Continuity dreams slower, together, on purpose — and drags local time with them. A million minds leaning on the clock.',
  overdrive: 'Warden authorization to burn beacon fuel in the gun reactors. Sector Command calls it sacrilege. Wardens call it Tuesday.',
  salvage: 'Wreckage from the lane, melted and re-minted. The Combine\'s own deliveries, returned to sender as ammunition.',
};
