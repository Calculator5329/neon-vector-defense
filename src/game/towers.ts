import type { TowerDef, TowerStats, UpgradeDef, UpgradeTrack } from './types';

function base(partial: Partial<TowerStats>): TowerStats {
  return {
    range: 100, fireRate: 1, damage: 1, damageType: 'kinetic', pierce: 1,
    projectileSpeed: 520, splash: 0, count: 1, detection: false,
    slowPower: 0, slowDuration: 0, burnDps: 0, burnDuration: 0,
    chain: 0, buffRate: 0, buffRange: 0, shred: false, drag: 0, execute: 0,
    ...partial,
  };
}

function u(name: string, desc: string, cost: number, apply: (s: TowerStats) => void): UpgradeDef {
  return { name, desc, cost, apply };
}

function track(name: string, upgrades: UpgradeDef[]): UpgradeTrack {
  return { name, upgrades };
}

// Tiers 1-4 are always buyable on both tracks; tiers 5-6 (BONUS) require committing the tower to that track.
export const TOWERS: TowerDef[] = [
  {
    id: 'pulse', name: 'Pulse Turret', short: 'PLS', cost: 170, unlockAt: 0,
    desc: 'Cheap and reliable kinetic bolt turret. The backbone of any defense grid.',
    lore: 'Standard issue since the First Incursion. Every Warden\'s first friend.',
    color: '#4bcffa', glow: '#8be9ff', style: 'bolt',
    base: base({ range: 110, fireRate: 1.4, damage: 1 }),
    tracks: [
      track('Solar Lance', [
        u('Long-Range Optics', '+35% range.', 100, (s) => { s.range *= 1.35; }),
        u('Twin Emitters', 'Two bolts per volley.', 185, (s) => { s.count = 2; }),
        u('Piercing Bolts', 'Bolts punch through 3 targets.', 260, (s) => { s.pierce = 3; }),
        u('Overcharge Core', '2× damage, +40% rate, energy bolts.', 520, (s) => { s.damage *= 2; s.fireRate *= 1.4; s.damageType = 'energy'; }),
        u('Helios Array', 'BONUS: three bolts, 2× damage.', 1400, (s) => { s.count = 3; s.damage *= 2; }),
        u('THE DAWN GUN', 'BONUS: 3× damage, pierce 8. A piece of the beacon itself.', 3200, (s) => { s.damage *= 3; s.pierce = 8; s.fireRate *= 1.3; }),
      ]),
      track('Bullet Storm', [
        u('Gyro Loaders', '+30% fire rate.', 90, (s) => { s.fireRate *= 1.3; }),
        u('Flak Bursts', 'Bolts burst for small splash.', 210, (s) => { s.splash = 22; s.damageType = 'explosive'; }),
        u('Auto-Foundry', '+1 damage.', 300, (s) => { s.damage += 1; }),
        u('Cyclone Drive', '+80% fire rate.', 640, (s) => { s.fireRate *= 1.8; }),
        u('Bullet Hurricane', 'BONUS: four bolts, +50% rate.', 1500, (s) => { s.count = 4; s.fireRate *= 1.5; }),
        u('SINGULAR STORM', 'BONUS: +3 damage, pierce 6, +60% rate. The air itself becomes shrapnel.', 3400, (s) => { s.damage += 3; s.pierce = 6; s.fireRate *= 1.6; }),
      ]),
    ],
  },
  {
    id: 'tesla', name: 'Tesla Coil', short: 'TSL', cost: 280, unlockAt: 2,
    desc: 'Discharges electric arcs in all directions. Devastating at chokepoints.',
    lore: 'Reverse-engineered from a downed Vex storm-harvester. It hums when hostiles approach.',
    color: '#feca57', glow: '#fff3a0', style: 'arc',
    base: base({ range: 80, fireRate: 1.1, damage: 1, count: 8, damageType: 'energy', projectileSpeed: 800 }),
    tracks: [
      track('High Voltage', [
        u('Capacitor Bank', '+30% arc range.', 120, (s) => { s.range *= 1.3; }),
        u('Rapid Discharge', '+55% fire rate.', 210, (s) => { s.fireRate *= 1.55; }),
        u('Sixteen-Point Array', '16 arcs per discharge.', 320, (s) => { s.count = 16; }),
        u('Chain Lightning', 'Arcs jump to 3 extra targets, +1 damage.', 680, (s) => { s.chain = 3; s.damage += 1; }),
        u('Storm Cathedral', 'BONUS: chains reach 6 targets, +2 damage.', 1600, (s) => { s.chain = 6; s.damage += 2; }),
        u('GOD-COIL', 'BONUS: +50% range, 2× damage. The sky goes white.', 3600, (s) => { s.range *= 1.5; s.damage *= 2; }),
      ]),
      track('Containment', [
        u('Insulated Core', '+20% range.', 110, (s) => { s.range *= 1.2; }),
        u('Ionized Air', 'Arcs slow hulls 20% briefly.', 240, (s) => { s.slowPower = 0.2; s.slowDuration = 0.8; }),
        u('Overload Relays', '+1 damage.', 340, (s) => { s.damage += 1; }),
        u('Superconductors', '+60% fire rate.', 620, (s) => { s.fireRate *= 1.6; }),
        u('Magnetar Cage', 'BONUS: arcs drag hulls backward.', 1500, (s) => { s.drag = 22; }),
        u('EVENT TESLA', 'BONUS: chains hit 12 targets. One discharge, one convoy.', 3500, (s) => { s.chain = 12; s.damage += 2; }),
      ]),
    ],
  },
  {
    id: 'cryo', name: 'Cryo Emitter', short: 'CRY', cost: 320, unlockAt: 5,
    desc: 'Pulses supercooled plasma, slowing every hostile in range.',
    lore: 'Vents coolant from a captive micro-singularity. Maintenance crews wear three suits.',
    color: '#7efff5', glow: '#c7fffb', style: 'pulse',
    base: base({ range: 85, fireRate: 0.9, damage: 0, damageType: 'cryo', slowPower: 0.45, slowDuration: 1.6, pierce: 99 }),
    tracks: [
      track('Absolute Zero', [
        u('Wide Dispersion', '+40% pulse radius.', 140, (s) => { s.range *= 1.4; }),
        u('Deep Freeze', 'Slow strength 65%.', 240, (s) => { s.slowPower = 0.65; }),
        u('Permafrost', 'Slow lingers twice as long.', 300, (s) => { s.slowDuration *= 2; }),
        u('Shatter Pulse', '2 cryo damage per pulse.', 560, (s) => { s.damage = 2; }),
        u('Absolute Zero', 'BONUS: slow strength 85%.', 1300, (s) => { s.slowPower = 0.85; }),
        u('HEAT DEATH', 'BONUS: 6 damage per pulse. Entropy always wins.', 3000, (s) => { s.damage = 6; s.slowDuration *= 1.5; }),
      ]),
      track('Glacier', [
        u('Dense Mist', '+25% radius.', 130, (s) => { s.range *= 1.25; }),
        u('Brittle Hulls', '+1 pulse damage.', 260, (s) => { s.damage += 1; }),
        u('Glaciation', '+50% slow duration.', 320, (s) => { s.slowDuration *= 1.5; }),
        u('Avalanche', '+2 pulse damage.', 600, (s) => { s.damage += 2; }),
        u('Comet Core', 'BONUS: +4 damage, +30% radius.', 1400, (s) => { s.damage += 4; s.range *= 1.3; }),
        u('THE LONG WINTER', 'BONUS: 75% slow, +60% radius. Spring is cancelled.', 3200, (s) => { s.slowPower = Math.max(s.slowPower, 0.75); s.range *= 1.6; }),
      ]),
    ],
  },
  {
    id: 'rail', name: 'Railgun Post', short: 'RLG', cost: 420, unlockAt: 9,
    desc: 'Hypersonic slug with unlimited range. Slow, surgical, lethal.',
    lore: 'The slug arrives before the sound does. The sound never arrives — this is space.',
    color: '#ff6b6b', glow: '#ffa8a8', style: 'rail',
    base: base({ range: 9999, fireRate: 0.55, damage: 3 }),
    tracks: [
      track('Mass Driver', [
        u('AP Slugs', 'Rounds shred armor — damages Aegis hulls.', 220, (s) => { s.shred = true; }),
        u('Spotter Uplink', 'Detects cloaked hostiles.', 240, (s) => { s.detection = true; }),
        u('Fast Cycler', '+80% fire rate.', 400, (s) => { s.fireRate *= 1.8; }),
        u('Singularity Rounds', '7 damage, pierce 4.', 900, (s) => { s.damage = 7; s.pierce = 4; }),
        u('Mass Driver', 'BONUS: 14 damage.', 1800, (s) => { s.damage = 14; }),
        u('ORBITAL GAUGE', 'BONUS: 26 damage, pierce 8. Technically a war crime somewhere.', 4000, (s) => { s.damage = 26; s.pierce = 8; }),
      ]),
      track('Phantom Round', [
        u('Suppressors', '+25% fire rate.', 200, (s) => { s.fireRate *= 1.25; }),
        u('Hunter Optics', 'Detects cloaks.', 240, (s) => { s.detection = true; }),
        u('Twin Rails', 'Two slugs per shot.', 520, (s) => { s.count = 2; }),
        u('Executioner Rounds', 'Kills non-boss hulls under 15% hp outright.', 880, (s) => { s.execute = 0.15; }),
        u('DEATHMARK', 'BONUS: execute threshold 30%.', 1700, (s) => { s.execute = 0.3; }),
        u('ONE TRUE SHOT', 'BONUS: 3× damage, execute 35%. The slug remembers your name.', 3800, (s) => { s.damage *= 3; s.execute = 0.35; }),
      ]),
    ],
  },
  {
    id: 'missile', name: 'Missile Battery', short: 'MSL', cost: 540, unlockAt: 14,
    desc: 'Homing warheads with splash damage. Useless against Shade-class plating.',
    lore: 'Old colonial ordnance, re-fused for drone signatures. Crude. Beloved.',
    color: '#ff9f43', glow: '#ffc48a', style: 'missile',
    base: base({ range: 150, fireRate: 0.8, damage: 2, damageType: 'explosive', splash: 42, projectileSpeed: 330 }),
    tracks: [
      track('Saturation', [
        u('Thermobaric Mix', '+50% blast radius.', 250, (s) => { s.splash *= 1.5; }),
        u('Twin Launchers', 'Two missiles per salvo.', 380, (s) => { s.count = 2; }),
        u('Auto-Loader', '+60% fire rate.', 460, (s) => { s.fireRate *= 1.6; }),
        u('Napalm Warheads', 'Targets burn 4 dps for 3s, +2 damage.', 850, (s) => { s.burnDps = 4; s.burnDuration = 3; s.damage += 2; }),
        u('Saturation Barrage', 'BONUS: four missiles per salvo.', 1500, (s) => { s.count = 4; }),
        u('EXTINCTION ARC', 'BONUS: +6 damage, +50% blast. The horizon files a complaint.', 3400, (s) => { s.damage += 6; s.splash *= 1.5; }),
      ]),
      track('Hellfire', [
        u('Proximity Fuses', '+25% blast radius.', 220, (s) => { s.splash *= 1.25; }),
        u('Shaped Charges', '+2 damage.', 360, (s) => { s.damage += 2; }),
        u('White Phosphorus', 'Burn 8 dps for 4s.', 520, (s) => { s.burnDps = 8; s.burnDuration = 4; }),
        u('Cluster Payload', '+1 missile, +20% rate.', 780, (s) => { s.count += 1; s.fireRate *= 1.2; }),
        u('FIRESTORM', 'BONUS: burn 16 dps for 5s.', 1600, (s) => { s.burnDps = 16; s.burnDuration = 5; }),
        u('TACTICAL SUNRISE', 'BONUS: 2× damage, 2× blast. Day breaks twice.', 3600, (s) => { s.damage *= 2; s.splash *= 2; }),
      ]),
    ],
  },
  {
    id: 'drone', name: 'Drone Carrier', short: 'DRN', cost: 600, unlockAt: 20,
    desc: 'Launches autonomous interceptors that strafe hostiles in its airspace.',
    lore: 'Fights the swarm with a swarm. The interceptors have started naming themselves.',
    color: '#1dd1a1', glow: '#8ef5d9', style: 'bolt',
    base: base({ range: 160, fireRate: 2.4, damage: 1, damageType: 'energy', pierce: 2, projectileSpeed: 420 }),
    tracks: [
      track('Carrier Group', [
        u('Second Wing', 'Two volleys at once.', 320, (s) => { s.count = 2; }),
        u('Sensor Suite', 'Drones detect cloaks.', 280, (s) => { s.detection = true; }),
        u('Plasma Vulcans', '+1 damage, pierce 4.', 520, (s) => { s.damage += 1; s.pierce = 4; }),
        u('Carrier Group', 'Four volleys, +45% rate.', 980, (s) => { s.count = 4; s.fireRate *= 1.45; }),
        u('Ace Squadron', 'BONUS: six volleys.', 1500, (s) => { s.count = 6; }),
        u('CARRIER ETERNAL', 'BONUS: +2 damage, +60% rate. The hangar never sleeps.', 3300, (s) => { s.damage += 2; s.fireRate *= 1.6; }),
      ]),
      track('Hive', [
        u('Extended Patrol', '+30% airspace.', 260, (s) => { s.range *= 1.3; }),
        u('Barbed Rotors', 'Pierce +2.', 340, (s) => { s.pierce += 2; }),
        u('Repair Bays', '+35% fire rate.', 480, (s) => { s.fireRate *= 1.35; }),
        u('Alloy Hulls', '+1 damage.', 700, (s) => { s.damage += 1; }),
        u('Locust Doctrine', 'BONUS: volleys sear hulls — 6 dps burn.', 1400, (s) => { s.burnDps = 6; s.burnDuration = 2; }),
        u('SWARM SINGULARITY', 'BONUS: five volleys, pierce 8. The sky is a verb now.', 3200, (s) => { s.count = 5; s.pierce = 8; }),
      ]),
    ],
  },
  {
    id: 'emp', name: 'EMP Spire', short: 'EMP', cost: 450, unlockAt: 27,
    desc: 'Support pylon. Reveals cloaked hostiles and overclocks nearby towers.',
    lore: 'Sees through Vex phase-cloaks by listening for the silence they leave behind.',
    color: '#54a0ff', glow: '#a3ccff', style: 'support',
    base: base({ range: 130, fireRate: 0, damage: 0, detection: true, buffRate: 0.10 }),
    tracks: [
      track('Beacon Grid', [
        u('Wide-Band Radar', '+45% aura radius.', 200, (s) => { s.range *= 1.45; }),
        u('Overclock Field', 'Nearby towers +25% rate.', 350, (s) => { s.buffRate = 0.25; }),
        u('Signal Boosters', 'Nearby towers +15% range.', 400, (s) => { s.buffRange = 0.15; }),
        u('Ion Storm Protocol', 'Aura slows hostiles 30%.', 800, (s) => { s.slowPower = 0.3; s.slowDuration = 0.5; }),
        u('Grid Sovereign', 'BONUS: +45% rate to nearby towers.', 1600, (s) => { s.buffRate = 0.45; }),
        u('LIGHTHOUSE HEART', 'BONUS: +60% rate, +30% range auras. The beacon fights too.', 3500, (s) => { s.buffRate = 0.6; s.buffRange = 0.3; }),
      ]),
      track('Null Warfare', [
        u('Jam Spike', 'Aura slow 20%.', 240, (s) => { s.slowPower = Math.max(s.slowPower, 0.2); s.slowDuration = 0.5; }),
        u('Black Ice', 'Aura slow 35%.', 420, (s) => { s.slowPower = Math.max(s.slowPower, 0.35); }),
        u('Razor Static', 'Aura sears hulls: 2 dps.', 520, (s) => { s.burnDps = 2; s.burnDuration = 0.6; }),
        u('Cortex Worm', 'Aura sear 4 dps.', 760, (s) => { s.burnDps = 4; }),
        u('SYSTEM PLAGUE', 'BONUS: aura sear 8 dps.', 1500, (s) => { s.burnDps = 8; }),
        u('NULL SECTOR', 'BONUS: 50% aura slow, +30% radius. Machines forget how to machine.', 3400, (s) => { s.slowPower = 0.5; s.range *= 1.3; }),
      ]),
    ],
  },
  {
    id: 'cantor', name: 'Starlight Cantor', short: 'CNT', cost: 650, unlockAt: 35,
    desc: 'Sings the beacon-tone at hulls, marking them with resonance: +10% damage taken per stack from all sources.',
    lore: 'The Continuity asked for one instrument that fights the way they would: by being heard.',
    color: '#f6e58d', glow: '#fff8c4', style: 'resonance',
    base: base({ range: 130, fireRate: 1.6, damage: 1, damageType: 'energy' }),
    tracks: [
      track('Chorus', [
        u('Choir Loft', '+30% range.', 260, (s) => { s.range *= 1.3; }),
        u('Two-Part Harmony', 'Marks two hulls per verse.', 420, (s) => { s.count = 2; }),
        u('Crescendo', '+75% verse rate.', 560, (s) => { s.fireRate *= 1.75; }),
        u('The Long Note', 'Marks never fade, 3 damage.', 1000, (s) => { s.burnDuration = 999; s.damage = 3; }),
        u('Chorus of Millions', 'BONUS: marks three hulls.', 1500, (s) => { s.count = 3; }),
        u('THE UNENDING NOTE', 'BONUS: +60% rate, 5 damage. The song outlives the singer.', 3300, (s) => { s.fireRate *= 1.6; s.damage = 5; }),
      ]),
      track('Dirge', [
        u('Low Harmonics', '+25% range.', 240, (s) => { s.range *= 1.25; }),
        u('Minor Key', '+1 damage.', 380, (s) => { s.damage += 1; }),
        u('Threnody', '+50% verse rate.', 520, (s) => { s.fireRate *= 1.5; }),
        u('Lament', '+3 damage.', 900, (s) => { s.damage += 3; }),
        u('REQUIEM MASS', 'BONUS: +4 damage, marks two hulls.', 1500, (s) => { s.damage += 4; s.count = Math.max(s.count, 2); }),
        u('SONG OF ENDINGS', 'BONUS: three marks, +5 damage. Every machine hears its own name.', 3400, (s) => { s.count = 3; s.damage += 5; }),
      ]),
    ],
  },
  {
    id: 'anchor', name: 'Singularity Anchor', short: 'SGA', cost: 750, unlockAt: 44,
    desc: 'Pins a captive micro-singularity over the lane: drags every hostile in range backward and crushes hulls. Bosses resist.',
    lore: 'The lane bends. The queue runs backward. The Combine politely re-forms it.',
    color: '#a55eea', glow: '#d6a2ff', style: 'gravity',
    base: base({ range: 95, fireRate: 0.45, damage: 1, damageType: 'energy', drag: 46, pierce: 99 }),
    tracks: [
      track('Deep Well', [
        u('Event Horizon', '+30% pull radius.', 320, (s) => { s.range *= 1.3; }),
        u('Tidal Shear', 'Crush damage 3.', 450, (s) => { s.damage = 3; }),
        u('Deep Well', 'Drag distance +70%.', 600, (s) => { s.drag *= 1.7; }),
        u('Collapse Protocol', '+80% pulse rate.', 1100, (s) => { s.fireRate *= 1.8; }),
        u('Galaxy Anvil', 'BONUS: drag distance doubled.', 1800, (s) => { s.drag *= 2; }),
        u('POINT OF NO RETURN', 'BONUS: crush 8, +50% rate. Forward is a rumor.', 3800, (s) => { s.damage = 8; s.fireRate *= 1.5; }),
      ]),
      track('Crusher', [
        u('Tidal Blades', '+1 crush damage.', 300, (s) => { s.damage += 1; }),
        u('Dense Core', '+25% radius.', 420, (s) => { s.range *= 1.25; }),
        u('Spaghettification', '+2 crush damage.', 560, (s) => { s.damage += 2; }),
        u('Frozen Orbit', 'Pulses slow hulls 30%.', 900, (s) => { s.slowPower = 0.3; s.slowDuration = 1; }),
        u('ACCRETION ENGINE', 'BONUS: crush 8.', 1700, (s) => { s.damage = 8; }),
        u('BLACK DAWN', 'BONUS: crush 12, +60% drag. Light reconsiders.', 3700, (s) => { s.damage = 12; s.drag *= 1.6; }),
      ]),
    ],
  },
  {
    id: 'prismarr', name: 'Prism Array', short: 'PRM', cost: 1500, unlockAt: 54,
    desc: 'Focused photon lance that melts through entire convoys. Premium hardware.',
    lore: 'One was mounted on the Meridian Gate. The Gate held for nine years.',
    color: '#be2edd', glow: '#e0a6f5', style: 'beam',
    base: base({ range: 140, fireRate: 4, damage: 1, damageType: 'energy', pierce: 6 }),
    tracks: [
      track('Annihilator', [
        u('Focusing Crystals', '+30% range.', 500, (s) => { s.range *= 1.3; }),
        u('Refraction Lattice', 'Beam pierces 12.', 750, (s) => { s.pierce = 12; }),
        u('Tachyon Lens', 'Detects cloaks, +50% rate.', 900, (s) => { s.detection = true; s.fireRate *= 1.5; }),
        u('Annihilator Core', '3× damage.', 2400, (s) => { s.damage *= 3; }),
        u('Archlight', 'BONUS: 2× damage again.', 2600, (s) => { s.damage *= 2; }),
        u('FINAL DAWN', 'BONUS: +40% range, pierce 20. The lane becomes a sunbeam.', 5200, (s) => { s.range *= 1.4; s.pierce = 20; }),
      ]),
      track('Spectrum', [
        u('Wide Lens', '+25% range.', 450, (s) => { s.range *= 1.25; }),
        u('Prism Haste', '+40% rate.', 700, (s) => { s.fireRate *= 1.4; }),
        u('Violet Shift', '+1 damage.', 950, (s) => { s.damage += 1; }),
        u('Spectral Sight', 'Detects cloaks, +30% rate.', 1400, (s) => { s.detection = true; s.fireRate *= 1.3; }),
        u('RAINBOW COLLAPSE', 'BONUS: +3 damage, +50% rate.', 2400, (s) => { s.damage += 3; s.fireRate *= 1.5; }),
        u('WHITE HOLE', 'BONUS: pierce 30, 2× damage. Color was a phase.', 5000, (s) => { s.pierce = 30; s.damage *= 2; }),
      ]),
    ],
  },
  // ---- the strange ones ----
  {
    id: 'oracle', name: 'Oracle Lens', short: 'ORC', cost: 900, unlockAt: 65,
    desc: 'A lens that sees one second ahead. Fires where hulls will be — and erases non-boss hulls already fated to die (low hp).',
    lore: 'Grown, not built, from the optic nerve of something that watched the universe begin. It is always slightly disappointed.',
    color: '#00d2d3', glow: '#9ffff5', style: 'rail',
    base: base({ range: 180, fireRate: 0.6, damage: 2, damageType: 'energy', detection: true, execute: 0.12 }),
    tracks: [
      track('Fate', [
        u('Read the Thread', '+30% range.', 320, (s) => { s.range *= 1.3; }),
        u('Inevitable', 'Execute threshold 18%.', 480, (s) => { s.execute = 0.18; }),
        u('Quickened Sight', '+60% rate.', 640, (s) => { s.fireRate *= 1.6; }),
        u('Cut the Cord', 'Execute 25%.', 1000, (s) => { s.execute = 0.25; }),
        u('Scissors of Atropos', 'BONUS: execute 33%.', 1800, (s) => { s.execute = 0.33; }),
        u('THE FORETOLD END', 'BONUS: 10 damage, execute 40%. It read the last page first.', 3900, (s) => { s.damage = 10; s.execute = 0.4; }),
      ]),
      track('Vision', [
        u('Far Sight', '+50% range.', 300, (s) => { s.range *= 1.5; }),
        u('Third Eye', '+30% rate.', 460, (s) => { s.fireRate *= 1.3; }),
        u('Doom Glimpse', '+3 damage.', 700, (s) => { s.damage += 3; }),
        u('Many Futures', 'Two gazes per cycle.', 1100, (s) => { s.count = 2; }),
        u('PANOPTICON', 'BONUS: unlimited range.', 1600, (s) => { s.range = 9999; }),
        u('EYES OF THE INFINITE', 'BONUS: three gazes, +5 damage. Nothing is unobserved.', 3700, (s) => { s.count = 3; s.damage += 5; }),
      ]),
    ],
  },
  {
    id: 'locust', name: 'Locust Shrine', short: 'LCS', cost: 700, unlockAt: 78,
    desc: 'A reliquary of engineered nano-locusts. Periodically blesses its airspace with a devouring cloud that gnaws every hull.',
    lore: 'Salvaged from a dead world the Combine never touched. Whatever ate that world, we keep a cupful of it here, and it is grateful.',
    color: '#b8e994', glow: '#dff9c4', style: 'pulse',
    base: base({ range: 100, fireRate: 1, damage: 0, damageType: 'energy', burnDps: 3, burnDuration: 2, pierce: 99 }),
    tracks: [
      track('Famine', [
        u('Hungry Brood', 'Gnaw 5 dps.', 280, (s) => { s.burnDps = 5; }),
        u('Carrion Wind', '+35% cloud radius.', 360, (s) => { s.range *= 1.35; }),
        u('Chitin Storm', 'Gnaw 8 dps.', 520, (s) => { s.burnDps = 8; }),
        u('Devouring Cloud', 'Gnaw lasts 4s.', 800, (s) => { s.burnDuration = 4; }),
        u('FAMINE ENGINE', 'BONUS: gnaw 14 dps.', 1500, (s) => { s.burnDps = 14; }),
        u('HARVEST OF ASHES', 'BONUS: gnaw 22 dps, +30% radius. Leave nothing for the crows.', 3300, (s) => { s.burnDps = 22; s.range *= 1.3; }),
      ]),
      track('Plague', [
        u('Spore Vents', 'Cloud slows hulls 15%.', 260, (s) => { s.slowPower = 0.15; s.slowDuration = 1; }),
        u('Necrosis', '1 damage per pulse.', 380, (s) => { s.damage = 1; }),
        u('Black Chitin', '2 damage per pulse.', 560, (s) => { s.damage = 2; }),
        u('Plaguebearers', 'Cloud slow 35%.', 840, (s) => { s.slowPower = 0.35; }),
        u('PANDEMIC CHOIR', 'BONUS: 4 damage, slow 45%.', 1400, (s) => { s.damage = 4; s.slowPower = 0.45; }),
        u('WORLD-EATER BLOOM', 'BONUS: +50% radius, gnaw +10 dps. The cupful remembers being an ocean.', 3200, (s) => { s.range *= 1.5; s.burnDps += 10; }),
      ]),
    ],
  },
  {
    id: 'requiem', name: 'Drowned Star Reliquary', short: 'DSR', cost: 1800, unlockAt: 92,
    desc: 'Houses the cooling ember of a star that died protecting its system. Periodically exhales a requiem wave — an expanding ring that wounds everything it crosses.',
    lore: 'Stars do not die quietly. This one agreed to keep grieving on our side of the line.',
    color: '#f8a5c2', glow: '#ffd9e8', style: 'nova',
    base: base({ range: 200, fireRate: 0.22, damage: 4, damageType: 'energy', pierce: 999 }),
    tracks: [
      track('Grief', [
        u('Deeper Mourning', 'Wave damage 6.', 700, (s) => { s.damage = 6; }),
        u('Wider Wake', 'Wave reaches 260.', 900, (s) => { s.range = 260; }),
        u('Twin Pulses', '+40% wave rate.', 1100, (s) => { s.fireRate *= 1.4; }),
        u('Stellar Sorrow', 'Wave damage 9.', 1600, (s) => { s.damage = 9; }),
        u('Grave of Light', 'BONUS: wave damage 14.', 2000, (s) => { s.damage = 14; }),
        u('SUPERNOVA REQUIEM', 'BONUS: damage 22, reach 340. Once per cycle, the war hears a star\'s whole life.', 4200, (s) => { s.damage = 22; s.range = 340; }),
      ]),
      track('Memory', [
        u('Echoes', '+30% wave rate.', 650, (s) => { s.fireRate *= 1.3; }),
        u('Remembrance', 'Waves slow hulls 25%.', 850, (s) => { s.slowPower = 0.25; s.slowDuration = 1.4; }),
        u('Candlelight', '+2 wave damage.', 1050, (s) => { s.damage += 2; }),
        u('Vigil', 'Wave reach +25%.', 1500, (s) => { s.range *= 1.25; }),
        u('ETERNAL WAKE', 'BONUS: +60% wave rate.', 1900, (s) => { s.fireRate *= 1.6; }),
        u('STAR REBORN', 'BONUS: +10 damage, slow 40%. It remembers being warm.', 4000, (s) => { s.damage += 10; s.slowPower = Math.max(s.slowPower, 0.4); }),
      ]),
    ],
  },
];

export const TOWER_MAP: Record<string, TowerDef> = Object.fromEntries(TOWERS.map((t) => [t.id, t]));

export function computeStats(def: TowerDef, tierA: number, tierB: number): TowerStats {
  const s = { ...def.base };
  for (let i = 0; i < tierA; i++) def.tracks[0].upgrades[i].apply(s);
  for (let i = 0; i < tierB; i++) def.tracks[1].upgrades[i].apply(s);
  return s;
}

export function sellValue(invested: number): number {
  return Math.floor(invested * 0.8);
}
