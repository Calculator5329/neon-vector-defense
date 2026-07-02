export type ReplayIntegrityStatus = 'complete' | 'manifest-missing' | 'manifest-mismatch';

export interface ReplayChunkInput {
  exists: boolean;
  events: unknown[];
}

interface ReplayManifest {
  chunkEventCounts: number[];
  eventHash: string;
  deathHash?: string;
  complete: boolean;
}

function eventType(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const value = (event as Record<string, unknown>).type;
  return typeof value === 'string' ? value : String(value ?? '');
}

function eventTime(event: unknown): number {
  if (!event || typeof event !== 'object') return 0;
  const value = (event as Record<string, unknown>).t;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function eventSimTick(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null;
  const value = (event as Record<string, unknown>).simTick;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function stableEventPair(event: unknown): string {
  return JSON.stringify([eventType(event), eventTime(event), eventSimTick(event)]);
}

export function replayEventHash(events: unknown[]): string {
  return fnv1aHex(events.map((event) => `${stableEventPair(event)}\n`));
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

function stableDeathRecordLines(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['invalid\n'];
  const records = raw as Record<string, unknown>;
  const lines = [
    `codec:${records.codec === 'd1' ? 'd1' : 'invalid'}\n`,
    `count:${typeof records.count === 'number' && Number.isFinite(records.count) ? Math.max(0, Math.floor(records.count)) : -1}\n`,
  ];
  if (!Array.isArray(records.waves)) return [...lines, 'waves:invalid\n'];
  for (const row of records.waves) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      lines.push('wave:invalid\n');
      continue;
    }
    const waveRow = row as Record<string, unknown>;
    const wave = typeof waveRow.wave === 'number' && Number.isFinite(waveRow.wave) ? Math.floor(waveRow.wave) : -1;
    const startDs = typeof waveRow.startDs === 'number' && Number.isFinite(waveRow.startDs) ? Math.floor(waveRow.startDs) : -1;
    const data = typeof waveRow.data === 'string' ? waveRow.data : '';
    lines.push(`${wave}:${startDs}:${data}\n`);
  }
  return lines;
}

export function replayDeathHash(records: unknown): string {
  return fnv1aHex(stableDeathRecordLines(records));
}

function readManifest(raw: unknown): ReplayManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (data.complete !== true) return null;
  if (typeof data.eventHash !== 'string' || !/^[a-f0-9]{8}$/.test(data.eventHash)) return null;
  const deathHash = data.deathHash;
  if (deathHash !== undefined && (typeof deathHash !== 'string' || !/^[a-f0-9]{8}$/.test(deathHash))) return null;
  if (!Array.isArray(data.chunkEventCounts)) return null;
  const chunkEventCounts = data.chunkEventCounts.map((value) => (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 650 ? value : -1
  ));
  if (chunkEventCounts.some((value) => value < 0)) return null;
  return { complete: true, eventHash: data.eventHash, deathHash, chunkEventCounts };
}

function intField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
}

export function validateReplayManifest(run: Record<string, unknown>, chunks: ReplayChunkInput[]): ReplayIntegrityStatus {
  if (!('manifest' in run)) return 'manifest-missing';
  const manifest = readManifest(run.manifest);
  if (!manifest) return 'manifest-mismatch';

  const docEvents = Array.isArray(run.events) ? run.events : [];
  const deathRecords = run.deathRecords;
  if (deathRecords !== undefined || manifest.deathHash !== undefined) {
    if (typeof manifest.deathHash !== 'string') return 'manifest-mismatch';
    if (replayDeathHash(deathRecords) !== manifest.deathHash) return 'manifest-mismatch';
  }
  const chunkCount = intField(run, 'chunkCount');
  const eventCount = intField(run, 'eventCount');
  if (chunkCount !== manifest.chunkEventCounts.length) return 'manifest-mismatch';
  if (chunks.length !== chunkCount) return 'manifest-mismatch';

  const chunkEvents: unknown[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = chunks[i];
    if (!chunk?.exists) return 'manifest-mismatch';
    if (chunk.events.length !== manifest.chunkEventCounts[i]) return 'manifest-mismatch';
    chunkEvents.push(...chunk.events);
  }

  const expectedEventCount = docEvents.length + manifest.chunkEventCounts.reduce((sum, value) => sum + value, 0);
  if (eventCount !== expectedEventCount) return 'manifest-mismatch';
  if (replayEventHash([...docEvents, ...chunkEvents]) !== manifest.eventHash) return 'manifest-mismatch';
  return 'complete';
}
