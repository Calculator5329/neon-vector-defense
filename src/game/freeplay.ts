import type { DamageType, WaveGroup } from './types';
import { ALL_MAPS, DIFFICULTIES } from './maps';

export type FreeplayContractId = 'standard' | 'ironcore' | 'leanGrid' | 'volatile' | 'purist';
export type FreeplayRelicId = 'beaconChoir' | 'emberDoctrine' | 'siegeDoctrine' | 'sensorCrown' | 'salvageTax' | 'chronoMarket' | 'rivalBounty' | 'stormCapacitors';
export type FreeplayMutatorId = 'cloakSurge' | 'healerConvoy' | 'armoredSwarm' | 'speedSurge' | 'shieldedBoss' | 'creditDrought' | 'sensorBlackout' | 'splitPressure';
export type FreeplayRivalId = 'vesper' | 'orrery' | 'blackbox' | 'redSaint';
export type RiskWaveId = 'redline' | 'blackout' | 'bounty';

export interface FreeplayContract {
  id: FreeplayContractId;
  name: string;
  short: string;
  desc: string;
  multiplier: number;
  maxTowers?: number;
  livesMult?: number;
  noSell?: boolean;
  noBlueprint?: boolean;
  bonusType?: DamageType;
  penaltyType?: DamageType;
}

export interface FreeplayRelic {
  id: FreeplayRelicId;
  name: string;
  desc: string;
  downside: string;
  scoreMult: number;
}

export interface FreeplayMutator {
  id: FreeplayMutatorId;
  name: string;
  desc: string;
  scoreMult: number;
}

export interface FreeplayRival {
  id: FreeplayRivalId;
  name: string;
  desc: string;
  scoreMult: number;
}

export interface RiskWaveOffer {
  id: RiskWaveId;
  name: string;
  desc: string;
  reward: string;
  mutatorIds: FreeplayMutatorId[];
  scoreMult: number;
  bonusCredits: number;
}

export interface DailyFreeplaySeed {
  id: string;
  dateKey: string;
  mapId: string;
  diffId: string;
  title: string;
  rules: string[];
  contractIds: FreeplayContractId[];
  relicIds: FreeplayRelicId[];
  mutatorBias: FreeplayMutatorId[];
  rivalIds: FreeplayRivalId[];
}

export interface FreeplayState {
  contract: FreeplayContract | null;
  relics: FreeplayRelic[];
  nextRelicOffer: FreeplayRelic[];
  lastRelicOfferWave: number;
  currentMutators: FreeplayMutator[];
  nextMutators: FreeplayMutator[];
  rival: FreeplayRival | null;
  rivalLevel: number;
  riskOffer: RiskWaveOffer | null;
  riskAccepted: RiskWaveOffer | null;
  riskCleared: number;
  scoreMult: number;
  lastCheckpointWave: number;
  daily: DailyFreeplaySeed | null;
}

export const FREEPLAY_CONTRACTS: FreeplayContract[] = [
  { id: 'standard', name: 'Open Continuance', short: 'OPEN', desc: 'No special restriction. A clean endless run with standard scoring.', multiplier: 1 },
  { id: 'ironcore', name: 'Iron Core Oath', short: 'IRON', desc: 'Start freeplay with fewer cores, but every checkpoint is worth more.', multiplier: 1.2, livesMult: 0.65 },
  { id: 'leanGrid', name: 'Lean Grid Mandate', short: 'LEAN', desc: 'Tower count is capped at 18. Every placement has to matter.', multiplier: 1.35, maxTowers: 18 },
  { id: 'volatile', name: 'Volatile Salvage', short: 'VOLT', desc: 'No selling. The Board pays for conviction, not regret.', multiplier: 1.3, noSell: true },
  { id: 'purist', name: 'Kinetic Purity Clause', short: 'PURE', desc: 'Kinetic towers hit harder, energy damage is taxed by the contract.', multiplier: 1.25, bonusType: 'kinetic', penaltyType: 'energy' },
];

export const FREEPLAY_RELICS: FreeplayRelic[] = [
  { id: 'beaconChoir', name: 'Beacon Choir', desc: 'Support auras are amplified and sensor coverage resists blackouts.', downside: 'Rival disruption pulses happen more often.', scoreMult: 1.08 },
  { id: 'emberDoctrine', name: 'Ember Doctrine', desc: 'Burn and lingering fire effects hit much harder.', downside: 'Kill income is reduced while the doctrine is active.', scoreMult: 1.06 },
  { id: 'siegeDoctrine', name: 'Siege Doctrine', desc: 'Missile, rail, and beam finals crack bosses and rivals harder.', downside: 'Swarm mutators add more bodies.', scoreMult: 1.08 },
  { id: 'sensorCrown', name: 'Sensor Crown', desc: 'Detection towers pierce cloak surges and sensor blackout penalties.', downside: 'Cloaked waves arrive more often.', scoreMult: 1.05 },
  { id: 'salvageTax', name: 'Salvage Tax', desc: 'Wave and risk rewards pay extra credits.', downside: 'Basic kill rewards taper harder after wave 60.', scoreMult: 1.04 },
  { id: 'chronoMarket', name: 'Chrono Market', desc: 'Abilities recover faster during freeplay.', downside: 'Speed-surge mutators are more intense.', scoreMult: 1.05 },
  { id: 'rivalBounty', name: 'Rival Bounty', desc: 'Rival defeats pay a large bounty and score bump.', downside: 'Rivals enter with extra escort armor.', scoreMult: 1.1 },
  { id: 'stormCapacitors', name: 'Storm Capacitors', desc: 'Final-tier energy and arc towers gain extra chain pressure.', downside: 'Armored swarm mutators are more common.', scoreMult: 1.06 },
];

export const FREEPLAY_MUTATORS: FreeplayMutator[] = [
  { id: 'cloakSurge', name: 'Cloak Surge', desc: 'A portion of the wave phase-cloaks, forcing sensor coverage.', scoreMult: 1.04 },
  { id: 'healerConvoy', name: 'Healer Convoy', desc: 'Seraph escorts join the wave and repair dense hull packs.', scoreMult: 1.05 },
  { id: 'armoredSwarm', name: 'Armored Swarm', desc: 'Extra Aegis/Juggernaut pressure tests kinetic answers.', scoreMult: 1.05 },
  { id: 'speedSurge', name: 'Speed Surge', desc: 'Fast hulls arrive in compressed packets.', scoreMult: 1.04 },
  { id: 'shieldedBoss', name: 'Shielded Boss', desc: 'Boss hulls arrive with bonus health and escort screens.', scoreMult: 1.06 },
  { id: 'creditDrought', name: 'Credit Drought', desc: 'Kill income is temporarily tighter for this wave.', scoreMult: 1.08 },
  { id: 'sensorBlackout', name: 'Sensor Blackout', desc: 'Only strong sensor networks fully counter cloaked hulls.', scoreMult: 1.07 },
  { id: 'splitPressure', name: 'Split Pressure', desc: 'Heavy and fast groups overlap instead of arriving politely.', scoreMult: 1.05 },
];

export const FREEPLAY_RIVALS: FreeplayRival[] = [
  { id: 'vesper', name: 'VESPER, the Quiet Star', desc: 'A cloaked flagship with phantom escorts.', scoreMult: 1.08 },
  { id: 'orrery', name: 'ORRERY, the Siege Wheel', desc: 'A shielded capital that brings titan screens.', scoreMult: 1.1 },
  { id: 'blackbox', name: 'BLACKBOX, the Memory Ship', desc: 'A rival that jams nearby towers with disruption pulses.', scoreMult: 1.09 },
  { id: 'redSaint', name: 'RED SAINT, the Bounty Hull', desc: 'A brutal bounty flagship that pays if destroyed.', scoreMult: 1.12 },
];

export const RISK_WAVES: RiskWaveOffer[] = [
  { id: 'redline', name: 'Redline Packet', desc: 'Add speed and split pressure to the next wave.', reward: '+12% score multiplier and credits on clear.', mutatorIds: ['speedSurge', 'splitPressure'], scoreMult: 1.12, bonusCredits: 450 },
  { id: 'blackout', name: 'Blackout Packet', desc: 'Add cloak surge and sensor blackout.', reward: '+15% score multiplier and a relic reroll on clear.', mutatorIds: ['cloakSurge', 'sensorBlackout'], scoreMult: 1.15, bonusCredits: 300 },
  { id: 'bounty', name: 'Bounty Packet', desc: 'Add shielded boss pressure and a healer convoy.', reward: '+18% score multiplier and a large bounty on clear.', mutatorIds: ['shieldedBoss', 'healerConvoy'], scoreMult: 1.18, bonusCredits: 700 },
];

export function createFreeplayState(): FreeplayState {
  return {
    contract: null,
    relics: [],
    nextRelicOffer: [],
    lastRelicOfferWave: 0,
    currentMutators: [],
    nextMutators: [],
    rival: null,
    rivalLevel: 0,
    riskOffer: null,
    riskAccepted: null,
    riskCleared: 0,
    scoreMult: 1,
    lastCheckpointWave: 0,
    daily: null,
  };
}

export function dailyFreeplaySeed(now = new Date()): DailyFreeplaySeed {
  const dateKey = now.toISOString().slice(0, 10);
  const seed = hash(dateKey);
  const map = ALL_MAPS[seed % ALL_MAPS.length];
  const diffPool = DIFFICULTIES.filter((d) => d.id !== 'easy');
  const diff = diffPool[Math.floor(seed / 7) % diffPool.length];
  const contractIds: FreeplayContractId[] = ['ironcore', 'leanGrid', 'volatile'];
  const relicIds = pickMany(FREEPLAY_RELICS.map((r) => r.id), seed + 11, 5);
  const mutatorBias = pickMany(FREEPLAY_MUTATORS.map((m) => m.id), seed + 23, 4);
  const rivalIds = pickMany(FREEPLAY_RIVALS.map((r) => r.id), seed + 37, 3);
  return {
    id: `daily-${dateKey}`,
    dateKey,
    mapId: map.id,
    diffId: diff.id,
    title: `Daily Endless ${dateKey.slice(5)}: ${map.name}`,
    rules: [
      'Fixed relic pool, rival order, and mutator bias.',
      'Checkpoint banking is allowed once per new best wave.',
      'Risk waves are worth +25% more score than standard freeplay.',
    ],
    contractIds,
    relicIds,
    mutatorBias,
    rivalIds,
  };
}

export function contractById(id: FreeplayContractId): FreeplayContract {
  return FREEPLAY_CONTRACTS.find((c) => c.id === id) ?? FREEPLAY_CONTRACTS[0];
}

export function relicById(id: FreeplayRelicId): FreeplayRelic {
  return FREEPLAY_RELICS.find((r) => r.id === id) ?? FREEPLAY_RELICS[0];
}

export function mutatorById(id: FreeplayMutatorId): FreeplayMutator {
  return FREEPLAY_MUTATORS.find((m) => m.id === id) ?? FREEPLAY_MUTATORS[0];
}

export function riskById(id: RiskWaveId): RiskWaveOffer {
  return RISK_WAVES.find((r) => r.id === id) ?? RISK_WAVES[0];
}

export function relicOffer(wave: number, owned: FreeplayRelic[], daily: DailyFreeplaySeed | null): FreeplayRelic[] {
  const pool = (daily?.relicIds.map(relicById) ?? FREEPLAY_RELICS).filter((r) => !owned.some((o) => o.id === r.id));
  if (pool.length <= 3) return pool;
  return pickMany(pool, wave * 97 + owned.length * 31 + (daily ? hash(daily.id) : 0), 3);
}

export function nextMutators(wave: number, relics: FreeplayRelic[], daily: DailyFreeplaySeed | null, risk?: RiskWaveOffer | null): FreeplayMutator[] {
  const ids = new Set<FreeplayMutatorId>();
  const over = Math.max(0, wave - 60);
  const count = wave < 60 ? 0 : wave < 70 ? 1 : wave < 90 ? 2 : 3;
  const bias = daily?.mutatorBias ?? [];
  for (let i = 0; i < count; i++) {
    const pool = i < bias.length ? bias.map(mutatorById) : FREEPLAY_MUTATORS;
    ids.add(pickOne(pool, wave * 41 + i * 17 + over * 3).id);
  }
  if (relics.some((r) => r.id === 'sensorCrown')) ids.add('cloakSurge');
  if (relics.some((r) => r.id === 'stormCapacitors')) ids.add('armoredSwarm');
  for (const id of risk?.mutatorIds ?? []) ids.add(id);
  return [...ids].map(mutatorById);
}

export function rivalForWave(wave: number, daily: DailyFreeplaySeed | null): FreeplayRival | null {
  if (wave < 70 || wave % 10 !== 0) return null;
  const rivals = daily?.rivalIds.map((id) => FREEPLAY_RIVALS.find((r) => r.id === id)!).filter(Boolean) ?? FREEPLAY_RIVALS;
  return rivals[Math.floor((wave - 70) / 10) % rivals.length] ?? null;
}

export function riskOfferForWave(wave: number, daily: DailyFreeplaySeed | null): RiskWaveOffer | null {
  if (wave < 62 || wave % 4 !== 2) return null;
  return pickOne(RISK_WAVES, wave * 53 + (daily ? hash(daily.id) : 0));
}

export function freeplayIncomeMult(wave: number, relics: FreeplayRelic[], mutators: FreeplayMutator[]): number {
  let mult = 1;
  if (wave > 60) mult *= Math.max(0.42, 1 - (wave - 60) * 0.018);
  if (relics.some((r) => r.id === 'emberDoctrine')) mult *= 0.88;
  if (relics.some((r) => r.id === 'salvageTax')) mult *= 0.86;
  if (mutators.some((m) => m.id === 'creditDrought')) mult *= 0.7;
  return mult;
}

export function freeplayWaveBonusMult(wave: number): number {
  return wave <= 60 ? 1 : Math.max(0.35, 1 - (wave - 60) * 0.025);
}

export function applyMutatorsToWave(wave: number, base: WaveGroup[], mutators: FreeplayMutator[], rival: FreeplayRival | null, risk: RiskWaveOffer | null): WaveGroup[] {
  const groups = base.map((g) => ({ ...g }));
  const add = (type: string, count: number, gap: number, delay = 0, cloaked = false) => groups.push({ type, count, gap, delay, cloaked });
  const scale = Math.max(1, Math.floor((wave - 55) / 10));
  for (const m of mutators) {
    if (m.id === 'cloakSurge') {
      groups.forEach((g, i) => { if (i % 2 === 0) g.cloaked = true; });
      add('wraith', 8 + scale * 3, 0.38, 0.4, true);
    } else if (m.id === 'healerConvoy') {
      add('seraph', 2 + scale, 1.7, 0.7);
    } else if (m.id === 'armoredSwarm') {
      add('aegis', 6 + scale * 3, 0.55, 0.3);
      add('juggernaut', 4 + scale, 0.75, 1);
    } else if (m.id === 'speedSurge') {
      add('stinger', 18 + scale * 6, 0.18, 0.2);
      add('chrono', 10 + scale * 3, 0.35, 0.6);
    } else if (m.id === 'shieldedBoss') {
      add('titan', 1 + Math.floor(scale / 2), 2.4, 1.2);
    } else if (m.id === 'splitPressure') {
      groups.forEach((g) => { g.delay = Math.max(0, (g.delay ?? 0) * 0.45); });
      add('vortex', 10 + scale * 4, 0.35, 0.4);
    } else if (m.id === 'sensorBlackout') {
      add('phantom', 10 + scale * 3, 0.33, 0.5, true);
    }
  }
  if (rival) {
    const rivalType = rival.id === 'redSaint' ? 'leviathan' : rival.id === 'orrery' ? 'umbra' : 'leviathan';
    add(rivalType, 1, 1, 0.2, rival.id === 'vesper');
    if (rival.id === 'vesper') add('phantom', 14 + scale * 2, 0.25, 0.6, true);
    if (rival.id === 'orrery') add('titan', 3 + scale, 1.4, 1);
    if (rival.id === 'blackbox') add('chrono', 14 + scale * 3, 0.3, 0.7);
    if (rival.id === 'redSaint') add('seraph', 4 + scale, 1.2, 1);
  }
  if (risk?.id === 'bounty') add('leviathan', 1, 1, 0.4);
  return groups;
}

export function freeplaySummary(state: FreeplayState): string {
  const parts = [
    state.contract?.short,
    ...state.relics.map((r) => r.name),
    state.daily ? 'DAILY' : '',
  ].filter(Boolean);
  return parts.slice(0, 8).join(' / ');
}

export function freeplayScoreMultiplier(state: FreeplayState): number {
  const relicMult = state.relics.reduce((m, r) => m * r.scoreMult, 1);
  const mutatorMult = state.currentMutators.reduce((m, r) => m * r.scoreMult, 1);
  return roundMult((state.contract?.multiplier ?? 1) * relicMult * mutatorMult * state.scoreMult * (state.daily ? 1.15 : 1));
}

function pickOne<T>(items: T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

function pickMany<T>(items: T[], seed: number, count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  let s = seed;
  while (pool.length && out.length < count) {
    s = Math.imul(s ^ 0x9e3779b9, 1664525) + 1013904223;
    out.push(pool.splice(Math.abs(s) % pool.length, 1)[0]);
  }
  return out;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function roundMult(n: number): number {
  return Math.round(n * 100) / 100;
}
