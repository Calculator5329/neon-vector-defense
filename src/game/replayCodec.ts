import type { RunEvent } from './runTelemetry';

export const REPLAY_ACTION_CODEC = 'r3';

export interface ReplayActionPack {
  codec: typeof REPLAY_ACTION_CODEC;
  count: number;
  towerIds: string[];
  data: string;
}

export interface ReplayActionChunkLike {
  actions: ReplayActionPack;
}

export interface ReplayActionTables {
  towerIds: string[];
}

const PACK_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const PACK_LOOKUP = new Map([...PACK_ALPHABET].map((char, index) => [char, index]));

const ACTION_TYPES = [
  'wave_start',
  'tower_place',
  'tower_upgrade',
  'tower_sell',
  'target_mode',
  'target_filter',
  'ability_cast',
  'pickup_collect',
  'freeplay_enter',
  'freeplay_relic_select',
  'freeplay_risk_accept',
  'freeplay_risk_decline',
  'speed_change',
  'bonus_opt_in',
  'bonus_skip',
  'bonus_shot',
  'run_end',
] as const;

export type ReplayActionType = typeof ACTION_TYPES[number];

const OPCODE = new Map<ReplayActionType, number>(ACTION_TYPES.map((type, index) => [type, index + 1]));
const TYPE_BY_OPCODE = new Map([...OPCODE.entries()].map(([type, code]) => [code, type]));
const TARGET_MODES = ['first', 'last', 'strong', 'close'] as const;
const TARGET_FILTERS = ['boss', 'armored', 'cloaked', 'healer', 'spawner'] as const;
const ABILITIES = ['strike', 'chrono', 'overdrive', 'salvage', 'cascade', 'mirror', 'recalibrate'] as const;
const PICKUPS = ['cash', 'slow', 'bomb'] as const;
const CONTRACTS = ['standard', 'ironcore', 'leanGrid', 'volatile', 'purist'] as const;
const RELICS = ['beaconChoir', 'emberDoctrine', 'siegeDoctrine', 'sensorCrown', 'salvageTax', 'chronoMarket', 'rivalBounty', 'stormCapacitors'] as const;
const RISKS = ['redline', 'blackout', 'bounty'] as const;
const SPEEDS = [1, 2, 4] as const;

export function isReplayActionEvent(event: RunEvent): boolean {
  return OPCODE.has(event.type as ReplayActionType);
}

export function replayActionEvents(events: RunEvent[]): RunEvent[] {
  return normalizeReplayActionEvents(events);
}

export function normalizeReplayActionEvents(events: RunEvent[]): RunEvent[] {
  return events.filter(isReplayActionEvent).map(normalizeActionEvent);
}

export function encodeReplayActions(events: RunEvent[], tables?: Partial<ReplayActionTables>): ReplayActionPack {
  const actions = normalizeReplayActionEvents(events);
  const towerIds = tables?.towerIds?.length ? [...tables.towerIds] : Array.from(new Set(actions
    .map((event) => typeof event.towerId === 'string' ? event.towerId : '')
    .filter(Boolean)));
  const towerCode = new Map(towerIds.map((id, index) => [id, index]));
  let prevTick = 0;
  let data = '';
  for (const event of actions) {
    const tick = cleanTick(event.simTick);
    if (tick < prevTick) throw new Error('r3 replay actions require monotonic simTick order');
    data += enc(tick - prevTick);
    prevTick = tick;
    data += enc(OPCODE.get(event.type as ReplayActionType) ?? 0);
    data += enc(cleanInt(event.wave));
    data += enc(enumCode(SPEEDS, cleanSpeed(event.speed)));
    switch (event.type as ReplayActionType) {
      case 'wave_start':
        break;
      case 'tower_place':
        data += enc(towerCode.get(str(event.towerId)) ?? towerIds.length);
        data += enc(cleanInt(event.towerUid));
        data += enc(signedToUInt(pos(event.x)));
        data += enc(signedToUInt(pos(event.y)));
        break;
      case 'tower_upgrade':
        data += enc(cleanInt(event.towerUid));
        data += enc(cleanInt(event.track));
        break;
      case 'tower_sell':
        data += enc(cleanInt(event.towerUid));
        break;
      case 'target_mode':
        data += enc(cleanInt(event.towerUid));
        data += enc(enumCode(TARGET_MODES, str(event.mode)));
        break;
      case 'target_filter':
        data += enc(cleanInt(event.towerUid));
        data += enc(targetFilterMask(str(event.filters)));
        break;
      case 'ability_cast': {
        const hasPos = typeof event.x === 'number' && typeof event.y === 'number';
        data += enc(enumCode(ABILITIES, str(event.abilityId)));
        data += enc(hasPos ? 1 : 0);
        if (hasPos) {
          data += enc(signedToUInt(pos(event.x)));
          data += enc(signedToUInt(pos(event.y)));
        }
        break;
      }
      case 'pickup_collect':
        data += enc(enumCode(PICKUPS, str(event.kind)));
        data += enc(signedToUInt(pos(event.x)));
        data += enc(signedToUInt(pos(event.y)));
        break;
      case 'freeplay_enter':
        data += enc(enumCode(CONTRACTS, str(event.contractId) || 'standard'));
        break;
      case 'freeplay_relic_select':
        data += enc(enumCode(RELICS, str(event.relicId)));
        break;
      case 'freeplay_risk_accept':
      case 'freeplay_risk_decline':
        data += enc(enumCode(RISKS, str(event.riskId)));
        break;
      case 'speed_change':
        data += enc(enumCode(SPEEDS, cleanSpeed(event.speed)));
        break;
      case 'bonus_opt_in':
      case 'bonus_skip':
        break;
      case 'bonus_shot':
        data += enc(signedToUInt(pos(event.x)));
        data += enc(signedToUInt(pos(event.y)));
        data += enc(typeof event.targetId === 'number' && event.targetId >= 0 ? Math.floor(event.targetId) + 1 : 0);
        break;
      case 'run_end':
        data += enc(enumCode(['victory', 'gameover', 'abandoned'] as const, str(event.outcome) || 'abandoned'));
        break;
    }
  }
  return { codec: REPLAY_ACTION_CODEC, count: actions.length, towerIds, data };
}

export function encodeReplayActionChunk(events: RunEvent[], tables: ReplayActionTables): ReplayActionPack {
  return encodeReplayActions(events, tables);
}

export function decodeReplayActions(pack: ReplayActionPack | null | undefined, tables?: Partial<ReplayActionTables>): RunEvent[] {
  if (!pack || pack.codec !== REPLAY_ACTION_CODEC || typeof pack.data !== 'string' || !Array.isArray(pack.towerIds)) return [];
  const towerIds = pack.towerIds.length ? pack.towerIds : (tables?.towerIds ?? []);
  const events: RunEvent[] = [];
  let index = 0;
  let tick = 0;
  while (index < pack.data.length && events.length < pack.count) {
    const delta = dec(pack.data, index); if (!delta) break; index = delta.next;
    const op = dec(pack.data, index); if (!op) break; index = op.next;
    const wave = dec(pack.data, index); if (!wave) break; index = wave.next;
    const speedCode = dec(pack.data, index); if (!speedCode) break; index = speedCode.next;
    tick += delta.value;
    const type = TYPE_BY_OPCODE.get(op.value);
    if (!type) break;
    const event: RunEvent = {
      type,
      t: roundS(tick / 60),
      simTick: tick,
      wave: wave.value,
      cash: 0,
      lives: 0,
      speed: SPEEDS[speedCode.value] ?? 1,
    };
    const read = () => {
      const next = dec(pack.data, index);
      if (!next) return null;
      index = next.next;
      return next.value;
    };
    switch (type) {
      case 'wave_start':
        break;
      case 'tower_place': {
        const towerIdx = read(); const towerUid = read(); const x = read(); const y = read();
        if (towerIdx == null || towerUid == null || x == null || y == null) return events;
        event.towerId = towerIds[towerIdx] ?? '';
        event.towerUid = towerUid;
        event.x = uintToSigned(x) / 10;
        event.y = uintToSigned(y) / 10;
        break;
      }
      case 'tower_upgrade': {
        const towerUid = read(); const track = read();
        if (towerUid == null || track == null) return events;
        event.towerUid = towerUid;
        event.track = track === 1 ? 1 : 0;
        break;
      }
      case 'tower_sell': {
        const towerUid = read();
        if (towerUid == null) return events;
        event.towerUid = towerUid;
        break;
      }
      case 'target_mode': {
        const towerUid = read(); const mode = read();
        if (towerUid == null || mode == null) return events;
        event.towerUid = towerUid;
        event.mode = TARGET_MODES[mode] ?? TARGET_MODES[0];
        break;
      }
      case 'target_filter': {
        const towerUid = read(); const mask = read();
        if (towerUid == null || mask == null) return events;
        event.towerUid = towerUid;
        event.filters = targetFilterString(mask);
        break;
      }
      case 'ability_cast': {
        const ability = read(); const hasPos = read();
        if (ability == null || hasPos == null) return events;
        event.abilityId = ABILITIES[ability] ?? ABILITIES[0];
        if (hasPos) {
          const x = read(); const y = read();
          if (x == null || y == null) return events;
          event.x = uintToSigned(x) / 10;
          event.y = uintToSigned(y) / 10;
        }
        break;
      }
      case 'pickup_collect': {
        const kind = read(); const x = read(); const y = read();
        if (kind == null || x == null || y == null) return events;
        event.kind = PICKUPS[kind] ?? PICKUPS[0];
        event.x = uintToSigned(x) / 10;
        event.y = uintToSigned(y) / 10;
        break;
      }
      case 'freeplay_enter': {
        const contract = read();
        if (contract == null) return events;
        event.contractId = CONTRACTS[contract] ?? CONTRACTS[0];
        break;
      }
      case 'freeplay_relic_select': {
        const relic = read();
        if (relic == null) return events;
        event.relicId = RELICS[relic] ?? RELICS[0];
        break;
      }
      case 'freeplay_risk_accept':
      case 'freeplay_risk_decline': {
        const risk = read();
        if (risk == null) return events;
        event.riskId = RISKS[risk] ?? RISKS[0];
        break;
      }
      case 'speed_change': {
        const speed = read();
        if (speed == null) return events;
        event.speed = SPEEDS[speed] ?? 1;
        break;
      }
      case 'bonus_opt_in':
      case 'bonus_skip':
        break;
      case 'bonus_shot': {
        const x = read(); const y = read(); const targetId = read();
        if (x == null || y == null || targetId == null) return events;
        event.x = uintToSigned(x) / 10;
        event.y = uintToSigned(y) / 10;
        event.targetId = targetId - 1;
        break;
      }
      case 'run_end': {
        const outcome = read();
        if (outcome == null) return events;
        event.outcome = (['victory', 'gameover', 'abandoned'] as const)[outcome] ?? 'abandoned';
        break;
      }
    }
    events.push(event);
  }
  return events.length === pack.count ? events : [];
}

export function decodeReplayActionBundle(runActions: ReplayActionPack, chunks: Array<ReplayActionChunkLike | ReplayActionPack>): RunEvent[] {
  const tables: ReplayActionTables = { towerIds: runActions.towerIds };
  return [
    ...decodeReplayActions(runActions, tables),
    ...chunks.flatMap((chunk) => decodeReplayActions(actionPackFrom(chunk), tables)),
  ];
}

export function decodeReplayActionStream(runActions: ReplayActionPack, chunks: Array<ReplayActionChunkLike | ReplayActionPack>): RunEvent[] {
  return decodeReplayActionBundle(runActions, chunks);
}

export function actionHash(runActions: ReplayActionPack, chunks: Array<ReplayActionChunkLike | ReplayActionPack> = []): string {
  const lines = [stablePackLine(runActions), ...chunks.map((chunk) => stablePackLine(actionPackFrom(chunk)))];
  return fnv1aHex(lines);
}

export function hashReplayActionPacks(runActions: ReplayActionPack, chunks: Array<ReplayActionChunkLike | ReplayActionPack> = []): string {
  return actionHash(runActions, chunks);
}

export function encodedReplayActionBytes(runActions: ReplayActionPack, chunks: Array<ReplayActionChunkLike | ReplayActionPack> = []): number {
  return JSON.stringify([runActions, ...chunks.map(actionPackFrom)]).length;
}

function stablePackLine(pack: ReplayActionPack): string {
  return `${pack.codec}|${pack.count}|${pack.towerIds.join(',')}|${pack.data}\n`;
}

function actionPackFrom(input: ReplayActionChunkLike | ReplayActionPack): ReplayActionPack {
  return 'actions' in input ? input.actions : input;
}

function normalizeActionEvent(event: RunEvent): RunEvent {
  const out: RunEvent = {
    type: event.type,
    t: roundS(cleanTick(event.simTick) / 60),
    simTick: cleanTick(event.simTick),
    wave: cleanInt(event.wave),
    cash: 0,
    lives: 0,
    speed: cleanSpeed(event.speed),
  };
  switch (event.type as ReplayActionType) {
    case 'wave_start':
      break;
    case 'tower_place':
      out.towerId = str(event.towerId);
      out.towerUid = cleanInt(event.towerUid);
      out.x = pos(event.x) / 10;
      out.y = pos(event.y) / 10;
      break;
    case 'tower_upgrade':
      out.towerUid = cleanInt(event.towerUid);
      out.track = cleanInt(event.track) === 1 ? 1 : 0;
      break;
    case 'tower_sell':
      out.towerUid = cleanInt(event.towerUid);
      break;
    case 'target_mode':
      out.towerUid = cleanInt(event.towerUid);
      out.mode = TARGET_MODES[enumCode(TARGET_MODES, str(event.mode))];
      break;
    case 'target_filter':
      out.towerUid = cleanInt(event.towerUid);
      out.filters = targetFilterString(targetFilterMask(str(event.filters)));
      break;
    case 'ability_cast':
      out.abilityId = ABILITIES[enumCode(ABILITIES, str(event.abilityId))];
      if (typeof event.x === 'number' && typeof event.y === 'number') {
        out.x = pos(event.x) / 10;
        out.y = pos(event.y) / 10;
      }
      break;
    case 'pickup_collect':
      out.kind = PICKUPS[enumCode(PICKUPS, str(event.kind))];
      out.x = pos(event.x) / 10;
      out.y = pos(event.y) / 10;
      break;
    case 'freeplay_enter':
      out.contractId = CONTRACTS[enumCode(CONTRACTS, str(event.contractId) || 'standard')];
      break;
    case 'freeplay_relic_select':
      out.relicId = RELICS[enumCode(RELICS, str(event.relicId))];
      break;
    case 'freeplay_risk_accept':
    case 'freeplay_risk_decline':
      out.riskId = RISKS[enumCode(RISKS, str(event.riskId))];
      break;
    case 'speed_change':
      out.speed = cleanSpeed(event.speed);
      break;
    case 'bonus_opt_in':
    case 'bonus_skip':
      break;
    case 'bonus_shot':
      out.x = pos(event.x) / 10;
      out.y = pos(event.y) / 10;
      out.targetId = typeof event.targetId === 'number' && event.targetId >= 0 ? Math.floor(event.targetId) : -1;
      break;
    case 'run_end':
      out.outcome = (['victory', 'gameover', 'abandoned'] as const)[enumCode(['victory', 'gameover', 'abandoned'] as const, str(event.outcome) || 'abandoned')];
      break;
  }
  return out;
}

function enc(n: number): string {
  let value = Math.max(0, Math.floor(n));
  let out = '';
  do {
    let chunk = value % 32;
    value = Math.floor(value / 32);
    if (value > 0) chunk += 32;
    out += PACK_ALPHABET[chunk];
  } while (value > 0);
  return out;
}

function dec(data: string, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 1;
  let i = start;
  while (i < data.length) {
    const code = PACK_LOOKUP.get(data[i++]);
    if (code == null) return null;
    value += (code % 32) * shift;
    if (code < 32) return { value, next: i };
    shift *= 32;
    if (shift > 1_099_511_627_776) return null;
  }
  return null;
}

function cleanTick(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function cleanInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function cleanSpeed(value: unknown): 1 | 2 | 4 {
  return value === 4 ? 4 : value === 2 ? 2 : 1;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pos(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) : 0;
}

function signedToUInt(value: number): number {
  return value < 0 ? ((-value) * 2) - 1 : value * 2;
}

function uintToSigned(value: number): number {
  return value % 2 === 0 ? value / 2 : -((value + 1) / 2);
}

function targetFilterMask(value: string): number {
  const selected = new Set(value.split(',').map((part) => part.trim()).filter(Boolean));
  let mask = 0;
  TARGET_FILTERS.forEach((filter, index) => {
    if (selected.has(filter)) mask |= 1 << index;
  });
  return mask;
}

function targetFilterString(mask: number): string {
  return TARGET_FILTERS
    .filter((_, index) => (mask & (1 << index)) !== 0)
    .join(',');
}

function enumCode<T extends readonly string[] | readonly number[]>(values: T, value: string | number): number {
  const index = (values as readonly (string | number)[]).indexOf(value);
  return index >= 0 ? index : 0;
}

function roundS(n: number): number {
  return Math.max(0, Math.round(n * 10) / 10);
}

function fnv1aHex(lines: Iterable<string>): string {
  let hash = 2166136261;
  for (const data of lines) {
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
