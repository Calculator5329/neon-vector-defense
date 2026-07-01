export type ReplayIntegrityStatus = 'complete' | 'legacy' | 'manifest-mismatch';

export interface ReplayChunkInput {
  exists: boolean;
  events: unknown[];
}

interface ReplayManifest {
  chunkEventCounts: number[];
  eventHash: string;
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

function stableEventPair(event: unknown): string {
  return JSON.stringify([eventType(event), eventTime(event)]);
}

export function replayEventHash(events: unknown[]): string {
  let hash = 2166136261;
  for (const event of events) {
    const data = `${stableEventPair(event)}\n`;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function readManifest(raw: unknown): ReplayManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (data.complete !== true) return null;
  if (typeof data.eventHash !== 'string' || !/^[a-f0-9]{8}$/.test(data.eventHash)) return null;
  if (!Array.isArray(data.chunkEventCounts)) return null;
  const chunkEventCounts = data.chunkEventCounts.map((value) => (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 650 ? value : -1
  ));
  if (chunkEventCounts.some((value) => value < 0)) return null;
  return { complete: true, eventHash: data.eventHash, chunkEventCounts };
}

function intField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
}

export function validateReplayManifest(run: Record<string, unknown>, chunks: ReplayChunkInput[]): ReplayIntegrityStatus {
  if (!('manifest' in run)) return 'legacy';
  const manifest = readManifest(run.manifest);
  if (!manifest) return 'manifest-mismatch';

  const docEvents = Array.isArray(run.events) ? run.events : [];
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
