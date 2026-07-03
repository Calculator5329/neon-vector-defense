export type ReplayIntegrityStatus = 'complete' | 'manifest-missing' | 'manifest-mismatch';

export interface ReplayChunkInput {
  exists: boolean;
  actions?: unknown;
}

interface ReplayManifest {
  chunkEventCounts: number[];
  actionHash: string;
  complete: boolean;
}

const RUN_LEGACY_REPLAY_FIELDS = new Set(['events', 'snapshots', 'deathRecords']);
const MANIFEST_FIELDS = new Set(['chunkEventCounts', 'actionHash', 'complete']);

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

export function replayActionHash(rootActions: unknown, chunkActions: unknown[] = []): string {
  return fnv1aHex([stableActionPackLine(rootActions), ...chunkActions.map(stableActionPackLine)]);
}

function stableActionPackLine(raw: unknown): string {
  if (!validActionPack(raw)) return 'invalid\n';
  return `${raw.codec}|${raw.count}|${raw.towerIds.join(',')}|${raw.data}\n`;
}

function validActionPack(raw: unknown): raw is { codec: 'r3'; count: number; towerIds: string[]; data: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const data = raw as Record<string, unknown>;
  return data.codec === 'r3'
    && typeof data.count === 'number'
    && Number.isInteger(data.count)
    && data.count >= 0
    && data.count <= 650
    && Array.isArray(data.towerIds)
    && data.towerIds.every((id) => typeof id === 'string' && id.length <= 40)
    && typeof data.data === 'string'
    && data.data.length <= 200000;
}

function readManifest(raw: unknown): ReplayManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).some((key) => !MANIFEST_FIELDS.has(key))) return null;
  if (data.complete !== true) return null;
  if (typeof data.actionHash !== 'string' || !/^[a-f0-9]{8}$/.test(data.actionHash)) return null;
  if (!Array.isArray(data.chunkEventCounts)) return null;
  const chunkEventCounts = data.chunkEventCounts.map((value) => (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 650 ? value : -1
  ));
  if (chunkEventCounts.some((value) => value < 0)) return null;
  return { complete: true, actionHash: data.actionHash, chunkEventCounts };
}

function intField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
}

export function validateReplayManifest(run: Record<string, unknown>, chunks: ReplayChunkInput[]): ReplayIntegrityStatus {
  if (!('manifest' in run)) return 'manifest-missing';
  if (Object.keys(run).some((key) => RUN_LEGACY_REPLAY_FIELDS.has(key))) return 'manifest-mismatch';
  const manifest = readManifest(run.manifest);
  if (!manifest) return 'manifest-mismatch';

  if (!validActionPack(run.actions)) return 'manifest-mismatch';
  const chunkCount = intField(run, 'chunkCount');
  const eventCount = intField(run, 'eventCount');
  if (chunkCount !== manifest.chunkEventCounts.length) return 'manifest-mismatch';
  if (chunks.length !== chunkCount) return 'manifest-mismatch';

  const chunkActions: unknown[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = chunks[i];
    if (!chunk?.exists) return 'manifest-mismatch';
    if (!validActionPack(chunk.actions)) return 'manifest-mismatch';
    if (chunk.actions.count !== manifest.chunkEventCounts[i]) return 'manifest-mismatch';
    chunkActions.push(chunk.actions);
  }

  const expectedEventCount = run.actions.count + manifest.chunkEventCounts.reduce((sum, value) => sum + value, 0);
  if (eventCount !== expectedEventCount) return 'manifest-mismatch';
  if (replayActionHash(run.actions, chunkActions) !== manifest.actionHash) return 'manifest-mismatch';
  return 'complete';
}
