import type { TowerDef, TowerStats, UpgradeDef, UpgradeTrack } from './types';
import { getBalance } from './balanceConfig';

function base(partial: Partial<TowerStats>): TowerStats {
  return {
    range: 100, fireRate: 1, damage: 1, damageType: 'kinetic', pierce: 1,
    projectileSpeed: 520, splash: 0, count: 1, detection: false,
    slowPower: 0, slowDuration: 0, burnDps: 0, burnDuration: 0,
    burnZoneRadius: 0, burnZoneDps: 0, burnZoneDuration: 0, droneSwarm: 0,
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
    desc: 'Cheap and reliable bolt turret. One path becomes an energy lane-piercer; the other becomes close-range shrapnel.',
    lore: 'Standard issue since the First Incursion. Every Warden\'s first friend.',
    color: '#4bcffa', glow: '#8be9ff', style: 'bolt',
    base: base({ range: 110, fireRate: 1.4, damage: 1 }),
    tracks: [
      track('Solar Lance', [
        u('Long-Range Optics', '+35% range.', 100, (s) => { s.range *= 1.35; }),
        u('Twin Emitters', 'Two bolts per volley.', 185, (s) => { s.count = 2; }),
        u('Piercing Lattice', 'Energy bolts punch through 4 targets.', 260, (s) => { s.pierce = 4; s.damageType = 'energy'; }),
        u('Overcharge Core', '2× damage, +40% rate, energy bolts.', 520, (s) => { s.damage *= 2; s.fireRate *= 1.4; s.damageType = 'energy'; }),
        u('Helios Array', 'BONUS: three bolts, 2× damage.', 1400, (s) => { s.count = 3; s.damage *= 2; }),
        u('THE DAWN GUN', 'BONUS: a lance of dawnlight that runs the WHOLE lane — pierces every hull, 3× damage.', 3200, (s) => { s.damage *= 3; s.pierce = 999; s.fireRate *= 1.4; s.projectileSpeed = 1400; }),
      ]),
      track('Bullet Storm', [
        u('Gyro Loaders', '+30% fire rate.', 90, (s) => { s.fireRate *= 1.3; }),
        u('Close-Quarters Bursts', 'Shorter range, small explosive splash.', 210, (s) => { s.splash = 24; s.range *= 0.9; s.damageType = 'explosive'; }),
        u('Auto-Foundry', '+1 damage.', 300, (s) => { s.damage += 1; }),
        u('Cyclone Drive', '+80% fire rate.', 640, (s) => { s.fireRate *= 1.8; }),
        u('Bullet Hurricane', 'BONUS: four bolts, +50% rate.', 1500, (s) => { s.count = 4; s.fireRate *= 1.5; }),
        u('SINGULAR STORM', 'BONUS: +3 damage, pierce 6, +60% rate. The air itself becomes shrapnel.', 3400, (s) => { s.damage += 3; s.pierce = 6; s.fireRate *= 1.6; }),
      ]),
    ],
  },
  {
    id: 'tesla', name: 'Tesla Coil', short: 'TSL', cost: 280, unlockAt: 150,
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
        u('EVENT TESLA', 'BONUS: every discharge chains across 24 hulls — a whole convoy lit at once.', 3500, (s) => { s.chain = 24; s.damage += 3; s.count = 20; }),
      ]),
    ],
  },
  {
    id: 'cryo', name: 'Cryo Emitter', short: 'CRY', cost: 320, unlockAt: 420,
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
        u('THE LONG WINTER', 'BONUS: 92% slow — hulls nearly freeze solid — and +70% radius. Spring is cancelled.', 3200, (s) => { s.slowPower = 0.92; s.slowDuration *= 1.5; s.range *= 1.7; s.damage += 3; }),
      ]),
    ],
  },
  {
    id: 'rail', name: 'Railgun Post', short: 'RLG', cost: 420, unlockAt: 1700,
    desc: 'Early precision rail post. It supplies utility, pierce, and finishers before the true siege guns come online.',
    lore: 'The slug arrives before the sound does. The sound never arrives — this is space.',
    color: '#ff6b6b', glow: '#ffa8a8', style: 'rail',
    base: base({ range: 9999, fireRate: 0.55, damage: 3 }),
    tracks: [
      track('Mass Driver', [
        u('AP Slugs', 'Rounds shred armor — damages Aegis hulls.', 220, (s) => { s.shred = true; }),
        u('Spotter Uplink', 'Detects cloaked hostiles.', 240, (s) => { s.detection = true; }),
        u('Fast Cycler', '+80% fire rate.', 400, (s) => { s.fireRate *= 1.8; }),
        u('Singularity Rounds', '6 damage, pierce 5.', 900, (s) => { s.damage = 6; s.pierce = 5; }),
        u('Mass Driver', 'BONUS: 12 damage, pierce 7.', 1800, (s) => { s.damage = 12; s.pierce = 7; }),
        u('ORBITAL GAUGE', 'BONUS: 30 damage and the slug NEVER STOPS — pierces the entire lane. Technically a war crime somewhere.', 4000, (s) => { s.damage = 30; s.pierce = 999; s.shred = true; }),
      ]),
      track('Phantom Round', [
        u('Suppressors', '+25% fire rate.', 200, (s) => { s.fireRate *= 1.25; }),
        u('Hunter Optics', 'Detects cloaks.', 240, (s) => { s.detection = true; }),
        u('Twin Rails', 'Two slugs per shot.', 520, (s) => { s.count = 2; }),
        u('Executioner Rounds', 'Kills non-boss hulls under 15% hp outright.', 880, (s) => { s.execute = 0.15; }),
        u('DEATHMARK', 'BONUS: execute threshold 30%.', 1700, (s) => { s.execute = 0.3; }),
        u('ONE TRUE SHOT', 'BONUS: 3× damage and executes any non-boss hull under HALF health. The slug remembers your name.', 3800, (s) => { s.damage *= 3; s.execute = 0.5; }),
      ]),
    ],
  },
  {
    id: 'missile', name: 'Missile Battery', short: 'MSL', cost: 540, unlockAt: 4800,
    desc: 'Slow homing warheads for burst damage and boss pressure. Larger hits, fewer gimmicks, real armor-breaking upgrades.',
    lore: 'Old colonial ordnance, re-fused for drone signatures. Crude. Beloved.',
    color: '#ff9f43', glow: '#ffc48a', style: 'missile',
    base: base({ range: 155, fireRate: 0.62, damage: 4, damageType: 'explosive', splash: 48, projectileSpeed: 310 }),
    tracks: [
      track('Saturation', [
        u('Thermobaric Mix', '+50% blast radius.', 250, (s) => { s.splash *= 1.5; }),
        u('Twin Launchers', 'Two missiles per salvo.', 380, (s) => { s.count = 2; }),
        u('Auto-Loader', '+35% fire rate.', 460, (s) => { s.fireRate *= 1.35; }),
        u('Bunker Busters', 'Warheads shred armor, +3 damage.', 850, (s) => { s.shred = true; s.damage += 3; }),
        u('Saturation Barrage', 'BONUS: four missiles per salvo.', 1500, (s) => { s.count = 4; }),
        u('EXTINCTION ARC', 'BONUS: +6 damage, +50% blast. The horizon files a complaint.', 3400, (s) => { s.damage += 6; s.splash *= 1.5; }),
      ]),
      track('Hellfire', [
        u('Proximity Fuses', '+25% blast radius.', 220, (s) => { s.splash *= 1.25; }),
        u('Shaped Charges', '+3 damage.', 360, (s) => { s.damage += 3; }),
        u('White Phosphorus', 'Brief burn 5 dps for 2s.', 520, (s) => { s.burnDps = 5; s.burnDuration = 2; }),
        u('Cluster Payload', '+1 missile, +20% blast.', 780, (s) => { s.count += 1; s.splash *= 1.2; }),
        u('FIRESTORM', 'BONUS: +7 damage, shreds armor.', 1600, (s) => { s.damage += 7; s.shred = true; }),
        u('TACTICAL SUNRISE', 'BONUS: a six-warhead carpet, 2× damage, 2× blast. Day breaks twice.', 3600, (s) => { s.damage *= 2; s.splash *= 2; s.count = Math.max(s.count, 6); }),
      ]),
    ],
  },
  {
    id: 'drone', name: 'Drone Carrier', short: 'DRN', cost: 600, unlockAt: 7600,
    desc: 'Launches interceptor swarms that split fire across the lane. Broad coverage, sensor support, and many small kinetic hits.',
    lore: 'Fights the swarm with a swarm. The interceptors have started naming themselves.',
    color: '#1dd1a1', glow: '#8ef5d9', style: 'bolt',
    base: base({ range: 170, fireRate: 1.45, damage: 1, damageType: 'kinetic', pierce: 2, projectileSpeed: 500, droneSwarm: 2 }),
    tracks: [
      track('Carrier Group', [
        u('Second Wing', '+1 interceptor per launch.', 320, (s) => { s.droneSwarm += 1; }),
        u('Sensor Suite', 'Drones detect cloaks.', 280, (s) => { s.detection = true; }),
        u('Autocannon Pods', '+1 damage, pierce 4.', 520, (s) => { s.damage += 1; s.pierce = 4; }),
        u('Carrier Group', 'Two wings, +35% launch rate.', 980, (s) => { s.count = 2; s.fireRate *= 1.35; }),
        u('Ace Squadron', 'BONUS: +3 interceptors per launch.', 1500, (s) => { s.droneSwarm += 3; }),
        u('CARRIER ETERNAL', 'BONUS: +2 damage, +60% rate. The hangar never sleeps.', 3300, (s) => { s.damage += 2; s.fireRate *= 1.6; }),
      ]),
      track('Hive', [
        u('Extended Patrol', '+30% airspace.', 260, (s) => { s.range *= 1.3; }),
        u('Barbed Rotors', 'Pierce +2, +1 interceptor.', 340, (s) => { s.pierce += 2; s.droneSwarm += 1; }),
        u('Repair Bays', '+35% fire rate.', 480, (s) => { s.fireRate *= 1.35; }),
        u('Alloy Hulls', '+1 damage.', 700, (s) => { s.damage += 1; }),
        u('Locust Doctrine', 'BONUS: swarms sear hulls - 6 dps burn.', 1400, (s) => { s.burnDps = 6; s.burnDuration = 2; }),
        u('SWARM SINGULARITY', 'BONUS: +4 interceptors, pierce 8. The sky is a verb now.', 3200, (s) => { s.droneSwarm += 4; s.pierce = 8; }),
      ]),
    ],
  },
  {
    id: 'emp', name: 'EMP Spire', short: 'EMP', cost: 450, unlockAt: 3000,
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
    id: 'cantor', name: 'Starlight Cantor', short: 'CNT', cost: 680, unlockAt: 14000,
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
        u('THE UNENDING NOTE', 'BONUS: marks 8 hulls at once with permanent resonance. The whole convoy hears it.', 3300, (s) => { s.count = 8; s.fireRate *= 1.5; s.damage = 5; s.burnDuration = 999; }),
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
    id: 'prismarr', name: 'Prism Array', short: 'PRM', cost: 1600, unlockAt: 52000,
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
        u('WHITE HOLE', 'BONUS: an unbroken beam through the ENTIRE convoy, 2× damage. Color was a phase.', 5000, (s) => { s.pierce = 999; s.damage *= 2; s.fireRate *= 1.2; }),
      ]),
    ],
  },
  // ---- the strange ones ----
  {
    id: 'locust', name: 'Locust Shrine', short: 'LCS', cost: 900, unlockAt: 70000,
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
    id: 'requiem', name: 'Drowned Star Reliquary', short: 'DSR', cost: 1900, unlockAt: 92000,
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
  {
    id: 'watchfire', name: 'Watchfire Beacon', short: 'WFB', cost: 2500, unlockAt: 118000,
    desc: 'Lantern Seven\'s own beacon, turned outward. A rotating lance of captured starlight that scours everything its beam crosses — continuous damage, no aiming, no cooldown.',
    lore: 'The light that guided a million ships home now sweeps the dark for the things that followed them. The keeper wept when they reversed the lens. Then they reversed it.',
    color: '#ffe8a3', glow: '#fff6d0', style: 'sweep',
    // damage = dps, range = beam length, fireRate = rotation speed (rad/s), count = beams
    base: base({ range: 170, fireRate: 1.1, damage: 16, damageType: 'energy', count: 1, detection: true, pierce: 999 }),
    tracks: [
      track('Full Beam', [
        u('Polished Lens', '+25% beam length.', 600, (s) => { s.range *= 1.25; }),
        u('Twin Lanterns', 'A second beam, opposite the first.', 1100, (s) => { s.count = 2; }),
        u('Brighter Burn', '+10 damage per second.', 1400, (s) => { s.damage += 10; }),
        u('Fast Rotor', '+45% rotation speed.', 1900, (s) => { s.fireRate *= 1.45; }),
        u('Quad Array', 'BONUS: four beams, full coverage.', 3600, (s) => { s.count = 4; }),
        u('THE UNBLINKING EYE', 'BONUS: 2.2× damage, +30% length. Nothing crosses the light unseen — or intact.', 8200, (s) => { s.damage *= 2.2; s.range *= 1.3; }),
      ]),
      track('Refraction', [
        u('Chill Filter', 'Swept hulls are slowed 30%.', 700, (s) => { s.slowPower = 0.3; s.slowDuration = 0.6; }),
        u('Solar Flare', 'Beam sets hulls burning: 10 dps.', 1200, (s) => { s.burnDps = 10; s.burnDuration = 1.5; }),
        u('Wide Aperture', '+1 beam, +20% length.', 1700, (s) => { s.count += 1; s.range *= 1.2; }),
        u('Searing Focus', '+12 damage per second.', 2100, (s) => { s.damage += 12; }),
        u('PRISM CROWN', 'BONUS: deep freeze (60% slow) + burn 20 dps across the sweep.', 3800, (s) => { s.slowPower = 0.6; s.slowDuration = 1; s.burnDps = 20; s.burnDuration = 2; }),
        u('DAYBREAK ENGINE', 'BONUS: 2× damage, +60% rotation. The night ends on your schedule now.', 8000, (s) => { s.damage *= 2; s.fireRate *= 1.6; }),
      ]),
    ],
  },
  {
    id: 'abyss', name: 'Abyss Gate', short: 'ABY', cost: 5200, unlockAt: 150000,
    desc: 'Forbidden endgame tower. Opens a void gate on a target cluster, shredding defenses, dragging hulls backward, and freezing the lane around the breach.',
    lore: 'The gate does not fire. It briefly convinces the battlefield that somewhere else is closer.',
    color: '#6c5ce7', glow: '#c8b6ff', style: 'rift',
    base: base({
      range: 210, fireRate: 0.28, damage: 18, damageType: 'energy',
      pierce: 999, splash: 72, count: 1, detection: true,
      slowPower: 0.35, slowDuration: 1.2, drag: 55, shred: true,
    }),
    tracks: [
      track('Event Horizon', [
        u('Mass Shadow', '+25% breach radius.', 1800, (s) => { s.splash *= 1.25; }),
        u('Cruel Gravity', '+45% drag.', 2600, (s) => { s.drag *= 1.45; }),
        u('Hawking Teeth', '+14 breach damage.', 3400, (s) => { s.damage += 14; }),
        u('Collapse Rhythm', '+50% breach rate.', 5200, (s) => { s.fireRate *= 1.5; }),
        u('Binary Horizon', 'BONUS: opens two gates per cycle.', 8200, (s) => { s.count = 2; }),
        u('THE MOUTH OF MIDNIGHT', 'BONUS: huge breach, 62 damage, brutal drag. The convoy exits through itself.', 16000, (s) => { s.damage = 62; s.splash = 132; s.drag *= 2.2; }),
      ]),
      track('Wormhole Network', [
        u('Far Aperture', '+35% range.', 1600, (s) => { s.range *= 1.35; }),
        u('Second Mouth', 'Opens a second gate on another cluster.', 3000, (s) => { s.count = 2; }),
        u('Slipstream Shear', '+40% breach rate.', 3800, (s) => { s.fireRate *= 1.4; }),
        u('Causal Burn', 'Breach applies 22 dps burn for 3 seconds.', 5400, (s) => { s.burnDps = 22; s.burnDuration = 3; }),
        u('Gate Choir', 'BONUS: opens three gates per cycle.', 9000, (s) => { s.count = 3; }),
        u('OMNIPRESENT EXIT', 'BONUS: five gates, unlimited reach, deeper slow. Every road leads through the abyss.', 17000, (s) => { s.count = 5; s.range = 9999; s.slowPower = 0.62; s.slowDuration = 2.2; }),
      ]),
    ],
  },
  // ---- THE HOLLOW arsenal: light against the hunger ----
  {
    id: 'ember', name: 'Ember Lattice', short: 'EMB', cost: 420, unlockAt: 11000,
    desc: 'Strings a lattice of caged starfire across its airspace — everything inside burns. The fire is energy, so armor and the Hollow are no shelter.',
    lore: 'Lantern-keepers lit a lattice of signal-fires when a relay went dark. This one never goes out, and it is no longer a signal.',
    color: '#ff7f50', glow: '#ffd0a0', style: 'pulse',
    base: base({ range: 95, fireRate: 1.1, damage: 0, damageType: 'energy', burnDps: 5, burnDuration: 2, pierce: 99 }),
    tracks: [
      track('Wildfire', [
        u('Banked Coals', 'Sear 8 dps.', 200, (s) => { s.burnDps = 8; }),
        u('Spreading Flame', '+35% lattice radius.', 280, (s) => { s.range *= 1.35; }),
        u('White Heat', 'Sear 13 dps.', 420, (s) => { s.burnDps = 13; }),
        u('Forge Wind', '+1 damage per pulse, +30% rate.', 700, (s) => { s.damage += 1; s.fireRate *= 1.3; }),
        u('CONFLAGRATION', 'BONUS: sear 22 dps.', 1500, (s) => { s.burnDps = 22; }),
        u('STAR-EATER', 'BONUS: sear 34 dps, +40% radius. It burns the cold itself.', 3200, (s) => { s.burnDps = 34; s.range *= 1.4; }),
      ]),
      track('Hearthlight', [
        u('Warding Glow', 'Reveals cloaked hulls in the lattice.', 220, (s) => { s.detection = true; }),
        u('Cinder Bite', '+2 damage per pulse.', 320, (s) => { s.damage += 2; }),
        u('Embered Air', 'Lattice slows hulls 30%.', 460, (s) => { s.slowPower = 0.3; s.slowDuration = 1; }),
        u('Coalwalk', '+3 damage per pulse.', 720, (s) => { s.damage += 3; }),
        u('PYRE FIELD', 'BONUS: slow 45%, +4 damage.', 1500, (s) => { s.slowPower = 0.45; s.damage += 4; }),
        u('THE LONG NOON', 'BONUS: +60% radius, sear +12 dps. A noon that does not end.', 3200, (s) => { s.range *= 1.6; s.burnDps += 12; }),
      ]),
    ],
  },
  {
    id: 'anchor', name: 'Phase Anchor', short: 'ANC', cost: 700, unlockAt: 22000,
    desc: 'A caged singularity that never fires. It rewrites where hulls ARE — pinning a column in a kill-pocket, or hurling it forward off its escorts. Its "ascension" is control, not damage.',
    lore: 'The civilian ancestor of the Abyss Gate: harbor-tugs once used it to berth freighters in a storm. The Concord kept the gentle version. The Combine did not.',
    color: '#8e7bef', glow: '#cdbcff', style: 'gravity',
    base: base({
      range: 120, fireRate: 1.0, damage: 0, damageType: 'energy', pierce: 99,
      drag: 26, slowPower: 0.25, slowDuration: 0.8, detection: false,
    }),
    tracks: [
      track('Singularity Well', [
        u('Deeper Well', '+35% range.', 300, (s) => { s.range *= 1.35; }),
        u('Mass Shadow', 'Stronger backward pull.', 450, (s) => { s.drag = 40; }),
        u('Time Dilation', 'Slow 45%, longer.', 650, (s) => { s.slowPower = 0.45; s.slowDuration = 1.4; }),
        u('Gravity Vise', 'Crushing pull + hold.', 1000, (s) => { s.drag = 70; s.slowPower = 0.55; }),
        u('EVENT WELL', 'BONUS: deep pull, +20% range.', 1900, (s) => { s.drag = 110; s.range *= 1.2; }),
        u('THE PIT', 'BONUS: a column simply stops existing forward. Brutal pull, deep slow, wide.', 3800, (s) => { s.drag = 180; s.slowPower = 0.7; s.slowDuration = 2; s.range *= 1.2; }),
      ]),
      track('Repulsor Field', [
        u('Reverse Polarity', 'Push hulls FORWARD, away from the anchor.', 320, (s) => { s.drag = -26; }),
        u('Phase Detector', 'Reveals cloaked hulls in the field.', 440, (s) => { s.detection = true; }),
        u('Hard Shove', 'Stronger forward push.', 650, (s) => { s.drag = -48; }),
        u('Dispersion Field', '+25% range, harder push.', 1000, (s) => { s.range *= 1.25; s.drag = -70; }),
        u('SCATTER ENGINE', 'BONUS: violent forward scatter — shatters heal-clusters and escorts.', 1900, (s) => { s.drag = -110; }),
        u('THE EXILE GATE', 'BONUS: hurls hulls forward then strands them mid-lane in your kill-zone.', 3800, (s) => { s.drag = -170; s.slowPower = 0.4; s.range *= 1.3; }),
      ]),
    ],
  },
  {
    id: 'sunspear', name: 'Sunspear Battery', short: 'SUN', cost: 760, unlockAt: 25000,
    desc: 'A focused spear of daylight on a rail. Energy, armor-shredding, and it sees through any cloak — built to put down the things the dark hides.',
    lore: 'Forged from the Meridian Gate\'s last working lens, after the Prism Array proved the principle. One shot, one dawn, repeated.',
    color: '#ffe066', glow: '#fff3a0', style: 'rail',
    base: base({ range: 9999, fireRate: 0.55, damage: 5, damageType: 'energy', detection: true, shred: true }),
    tracks: [
      track('Zenith', [
        u('Focused Beam', '+45% fire rate.', 400, (s) => { s.fireRate *= 1.45; }),
        u('Solar Slug', '8 damage.', 520, (s) => { s.damage = 8; }),
        u('Twin Dawn', 'Two spears per shot.', 760, (s) => { s.count = 2; }),
        u('Corona Rounds', '12 damage, pierce 3.', 1000, (s) => { s.damage = 12; s.pierce = 3; }),
        u('NOON GUN', 'BONUS: 18 damage, burn 8 dps.', 1800, (s) => { s.damage = 18; s.burnDps = Math.max(s.burnDps, 8); s.burnDuration = Math.max(s.burnDuration, 3); }),
        u('SECOND SUNRISE', 'BONUS: 2× damage, pierce 6. Dawn comes twice, and the dark does not.', 3800, (s) => { s.damage *= 2; s.pierce = 6; }),
      ]),
      track('Eclipse', [
        u('Sunspot Optics', '+20% fire rate, stronger anti-cloak focus.', 240, (s) => { s.fireRate *= 1.2; s.detection = true; }),
        u('Glare', 'Executes non-boss hulls under 15% hp.', 480, (s) => { s.execute = 0.15; }),
        u('Burning Core', 'Hits sear 8 dps for 3s, +2 damage.', 640, (s) => { s.burnDps = 8; s.burnDuration = 3; s.damage += 2; }),
        u('Heliograph', 'Execute threshold 25%.', 980, (s) => { s.execute = 0.25; }),
        u('STARFALL', 'BONUS: execute 35%, burn 14 dps.', 1700, (s) => { s.execute = 0.35; s.burnDps = 14; s.burnDuration = 4; }),
        u('THE LAST LIGHT', 'BONUS: 3× damage, executes any non-boss hull under HALF health. The dark blinks first.', 3900, (s) => { s.damage *= 3; s.execute = 0.5; }),
      ]),
    ],
  },
  // ---- kinetic / explosive / fire reinforcements ----
  {
    id: 'flak', name: 'Flak Battery', short: 'FLK', cost: 360, unlockAt: 900,
    desc: 'Throws a fast wall of bursting flak — cheap shrapnel that shreds swarms. Blast-plated hulls swallow it whole, so keep a backup.',
    lore: 'Colonial point-defense, re-aimed at the lane. It was built to kill incoming missiles. Drones are easier.',
    color: '#ffa502', glow: '#ffd56b', style: 'missile',
    base: base({ range: 145, fireRate: 1.85, damage: 1, damageType: 'explosive', splash: 20, projectileSpeed: 560, count: 2, pierce: 2 }),
    tracks: [
      track('Barrage', [
        u('Twin Barrels', '+2 shells per burst.', 130, (s) => { s.count += 2; }),
        u('Shrapnel Cloud', '+2 pierce, small blast growth.', 200, (s) => { s.pierce += 2; s.splash *= 1.2; }),
        u('Rapid Cycler', '+55% fire rate.', 300, (s) => { s.fireRate *= 1.55; }),
        u('Heavy Shells', '+1 damage.', 520, (s) => { s.damage += 1; }),
        u('FLAK STORM', 'BONUS: eight-shell bursts.', 1200, (s) => { s.count = Math.max(s.count, 8); }),
        u('IRON RAIN', 'BONUS: +2 damage, +40% rate, pierce 8. The sky rusts.', 2600, (s) => { s.damage += 2; s.fireRate *= 1.4; s.pierce = 8; }),
      ]),
      track('Proximity', [
        u('Proximity Fuses', '+20% blast radius, +1 pierce.', 150, (s) => { s.splash *= 1.2; s.pierce += 1; }),
        u('Tracer Rounds', 'Detects cloaked hulls.', 200, (s) => { s.detection = true; }),
        u('Airburst Pattern', '+3 shells, +20% rate.', 340, (s) => { s.count += 3; s.fireRate *= 1.2; }),
        u('Cluster Payload', '+2 shells, +1 damage.', 560, (s) => { s.count += 2; s.damage += 1; }),
        u('DEADHAND', 'BONUS: detects cloaks, pierce 7.', 1300, (s) => { s.detection = true; s.pierce = Math.max(s.pierce, 7); }),
        u('SCATTERSTORM', 'BONUS: ten shells, +2 damage. Everything in the lane is downwind.', 2700, (s) => { s.count = Math.max(s.count, 10); s.damage += 2; }),
      ]),
    ],
  },
  {
    id: 'cinder', name: 'Cinder Mortar', short: 'CDR', cost: 640, unlockAt: 19000,
    desc: 'Lobs incendiary shells that splash, then leave the lane burning. The blast is a courtesy; the fire is the point.',
    lore: 'Loaded with the last of Relay 6\'s reactor coolant — which, it turns out, is not coolant at all once it meets air.',
    color: '#ff6348', glow: '#ffae6b', style: 'missile',
    base: base({ range: 170, fireRate: 0.58, damage: 2, damageType: 'explosive', splash: 36, burnDps: 5, burnDuration: 2, burnZoneRadius: 42, burnZoneDps: 8, burnZoneDuration: 4, projectileSpeed: 300 }),
    tracks: [
      track('Wildfire', [
        u('Thermite Core', 'Burn zones sear 14 dps.', 280, (s) => { s.burnZoneDps = 14; }),
        u('Wide Bloom', '+35% burn-zone radius.', 360, (s) => { s.burnZoneRadius *= 1.35; }),
        u('Long Burn', 'Fire zones linger 7s.', 460, (s) => { s.burnZoneDuration = 7; }),
        u('Double Shell', 'Two shells, +1 damage.', 760, (s) => { s.count = 2; s.damage += 1; }),
        u('FIRESTORM', 'BONUS: burn zones sear 26 dps.', 1500, (s) => { s.burnZoneDps = 26; }),
        u('THE LONG SUMMER', 'BONUS: burn zones sear 40 dps, +50% radius, linger 10s.', 3400, (s) => { s.burnZoneDps = 40; s.burnZoneRadius *= 1.5; s.burnZoneDuration = 10; }),
      ]),
      track('Pyroclasm', [
        u('Shaped Charge', '+3 blast damage.', 260, (s) => { s.damage += 3; }),
        u('Tracer Fuses', 'Detects cloaked hulls.', 360, (s) => { s.detection = true; }),
        u('Cluster Burn', '+1 shell.', 600, (s) => { s.count += 1; }),
        u('Magma Core', 'Burn zones sear 20 dps, +2 blast damage.', 900, (s) => { s.burnZoneDps = 20; s.damage += 2; }),
        u('CALDERA', 'BONUS: +60% burn-zone radius, +6 damage.', 1600, (s) => { s.burnZoneRadius *= 1.6; s.damage += 6; }),
        u('ASHFALL', 'BONUS: four shells, burn zones sear 32 dps.', 3500, (s) => { s.count = Math.max(s.count, 4); s.burnZoneDps = 32; }),
      ]),
    ],
  },
  {
    id: 'gauss', name: 'Gauss Bastion', short: 'GAU', cost: 1500, unlockAt: 36000,
    desc: 'A fortress-grade gauss driver: one tungsten slug, unlimited range, obscene single-target punch. Raw kinetic, so shred the armor first.',
    lore: 'Salvaged from the Meridian Gate\'s anchor cannon. It does not aim so much as decide.',
    color: '#dfe6e9', glow: '#ffffff', style: 'rail',
    base: base({ range: 9999, fireRate: 0.26, damage: 16, damageType: 'kinetic', pierce: 1 }),
    tracks: [
      track('Mass Driver', [
        u('Hardened Slugs', 'Rounds shred armor.', 380, (s) => { s.shred = true; }),
        u('Fast Loader', '+45% fire rate.', 520, (s) => { s.fireRate *= 1.45; }),
        u('Tungsten Core', '28 damage.', 760, (s) => { s.damage = 28; }),
        u('Through-and-Through', 'Pierce 3, +10 damage.', 1200, (s) => { s.pierce = 3; s.damage += 10; }),
        u('SIEGE BREAKER', 'BONUS: 58 damage.', 2000, (s) => { s.damage = 58; }),
        u('CONTINENTAL GUN', 'BONUS: 2× damage, pierces the WHOLE lane, shreds. The slug arrives before the order to fire.', 4200, (s) => { s.damage *= 2; s.pierce = 999; s.shred = true; }),
      ]),
      track('Bastion', [
        u('Spotter Array', 'Detects cloaked hulls.', 340, (s) => { s.detection = true; }),
        u('Twin Drivers', 'Two heavy slugs per shot, slower cycle.', 620, (s) => { s.count = 2; s.fireRate *= 0.82; }),
        u('Sabot Rounds', 'Shred armor, +12 damage.', 820, (s) => { s.shred = true; s.damage += 12; }),
        u('Kill-Order', 'Executes non-boss hulls under 20% hp.', 1300, (s) => { s.execute = 0.2; }),
        u('SIEGE WALL', 'BONUS: three slugs, +18 damage.', 2100, (s) => { s.count = 3; s.damage += 18; }),
        u('THE LAST WORD', 'BONUS: 2× damage, execute 40%. It does not leave survivors to disagree.', 4400, (s) => { s.damage *= 2; s.execute = 0.4; }),
      ]),
    ],
  },
];

export const TOWER_MAP: Record<string, TowerDef> = Object.fromEntries(TOWERS.map((t) => [t.id, t]));

/** Arsenal display + hotkey order: by unlock threshold, so the menu reads as the
 *  order you actually earn them (EMP Spire sits in its early slot, etc.). */
export const TOWERS_BY_UNLOCK: TowerDef[] = [...TOWERS].sort((a, b) => a.unlockAt - b.unlockAt);

export function computeStats(def: TowerDef, tierA: number, tierB: number): TowerStats {
  const s = { ...def.base };
  for (let i = 0; i < tierA; i++) def.tracks[0].upgrades[i].apply(s);
  for (let i = 0; i < tierB; i++) def.tracks[1].upgrades[i].apply(s);
  // remote balance overrides (identity 1× by default — no-op unless a config is loaded)
  const o = getBalance().tower(def.id);
  s.damage *= o.damageMult;
  s.range *= o.rangeMult;
  s.fireRate *= o.fireRateMult;
  return s;
}

export function sellValue(invested: number): number {
  return Math.floor(invested * 0.8);
}
