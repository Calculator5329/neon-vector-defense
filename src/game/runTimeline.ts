import { enemyDef } from './enemies';
import { packUInt, unpackUInt } from './replayCodec';

/**
 * Compact kill/leak timeline stored with each public run (`final.timeline`).
 *
 * Frame-accurate replays re-simulate the engine from seed + actions and never read
 * this. It exists for runs the current engine can no longer re-simulate (engine or
 * balance drift): their cosmetic reconstruction plays these records back so hulls
 * die when and where they really died. It is display data only. It is not hashed,
 * not verified, and nothing that scores or verifies a run may trust it.
 *
 * Encoding `t1`: one varint stream in the r3 pack alphabet, per record:
 *   tick delta (1/60 s sim ticks since the previous record),
 *   code = enemyIndex * 2 + (leak ? 1 : 0),
 *   path distance / DIST_QUANTUM (rounded),
 *   kill: killer tower uid + 1 (0 = unknown); leak: cores lost.
 */
export const RUN_TIMELINE_CODEC = 't1';
/** Path-distance resolution in world px. The viewer draws on the recorded map
 *  geometry, so distance along the lane is enough to place a death. */
export const RUN_TIMELINE_DIST_QUANTUM = 4;
/** Hard ceiling on the encoded stream so a marathon run can never push the public
 *  run doc toward Firestore's 1 MB limit. Past it the timeline is marked truncated
 *  and records nothing more (kills or leaks); the cosmetic viewer names the wave
 *  where the record stops, and planned hulls after it never die. */
export const RUN_TIMELINE_MAX_CHARS = 480_000;

export interface RunTimelinePack {
  codec: typeof RUN_TIMELINE_CODEC;
  count: number;
  enemyIds: string[];
  data: string;
  /** present (true) only when recording stopped at RUN_TIMELINE_MAX_CHARS */
  truncated?: true;
}

interface RunTimelineBase {
  tick: number;
  enemyId: string;
  /** path distance in world px, quantised to RUN_TIMELINE_DIST_QUANTUM */
  dist: number;
}

export interface DecodedRunTimeline {
  entries: RunTimelineEntry[];
  /** the recorder hit RUN_TIMELINE_MAX_CHARS; nothing after the last entry was kept */
  truncated: boolean;
}

export type RunTimelineEntry =
  | (RunTimelineBase & { kind: 'kill'; towerUid: number | null })
  | (RunTimelineBase & { kind: 'leak'; coresLost: number });

/** Streams records into the t1 encoding as the run plays. Pure bookkeeping: it
 *  only reads the values it is handed, so it cannot feed back into the sim. */
export class RunTimelineWriter {
  private data = '';
  private count = 0;
  private prevTick = 0;
  private truncated = false;
  private readonly enemyIds: string[] = [];
  private readonly enemyCode = new Map<string, number>();

  kill(tick: number, enemyId: string, dist: number, towerUid: number | null): void {
    this.push(tick, enemyId, dist, false, towerUid == null ? 0 : uint(towerUid) + 1);
  }

  leak(tick: number, enemyId: string, dist: number, coresLost: number): void {
    this.push(tick, enemyId, dist, true, uint(coresLost));
  }

  pack(): RunTimelinePack {
    const pack: RunTimelinePack = {
      codec: RUN_TIMELINE_CODEC,
      count: this.count,
      enemyIds: [...this.enemyIds],
      data: this.data,
    };
    if (this.truncated) pack.truncated = true;
    return pack;
  }

  private push(tick: number, enemyId: string, dist: number, leak: boolean, tail: number): void {
    if (this.truncated) return;
    let code = this.enemyCode.get(enemyId);
    const isNewId = code == null;
    if (code == null) code = this.enemyIds.length;
    const t = Math.max(this.prevTick, uint(tick));
    const row = packUInt(t - this.prevTick)
      + packUInt(code * 2 + (leak ? 1 : 0))
      + packUInt(Math.round(Math.max(0, dist) / RUN_TIMELINE_DIST_QUANTUM))
      + packUInt(tail);
    if (this.data.length + row.length > RUN_TIMELINE_MAX_CHARS) {
      this.truncated = true;
      return;
    }
    if (isNewId) {
      this.enemyCode.set(enemyId, code);
      this.enemyIds.push(enemyId);
    }
    this.data += row;
    this.prevTick = t;
    this.count++;
  }
}

/** Decodes an untrusted `final.timeline` value. Returns null when the field is
 *  absent or not a t1 pack (every run recorded before the timeline shipped), and
 *  the records decoded so far if the stream is cut short or malformed. Records
 *  naming an enemy this build does not have are skipped. */
export function decodeRunTimeline(raw: unknown): DecodedRunTimeline | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pack = raw as Record<string, unknown>;
  if (pack.codec !== RUN_TIMELINE_CODEC) return null;
  if (typeof pack.data !== 'string' || pack.data.length > RUN_TIMELINE_MAX_CHARS) return null;
  if (!Array.isArray(pack.enemyIds)) return null;
  // An id this build does not know (retired since the run, or crafted, like
  // 'constructor') drops its records instead of reaching the renderer.
  const enemyIds: (string | null)[] = pack.enemyIds.map((id: unknown) => (typeof id === 'string' && enemyDef(id) ? id : null));
  const count = typeof pack.count === 'number' && Number.isInteger(pack.count) ? Math.max(0, pack.count) : 0;
  const data = pack.data;
  const out: RunTimelineEntry[] = [];
  let i = 0;
  let tick = 0;
  while (out.length < count && i < data.length) {
    const dt = unpackUInt(data, i); if (!dt) break;
    const code = unpackUInt(data, dt.next); if (!code) break;
    const dist = unpackUInt(data, code.next); if (!dist) break;
    const tail = unpackUInt(data, dist.next); if (!tail) break;
    i = tail.next;
    tick += dt.value;
    const enemyId = enemyIds[Math.floor(code.value / 2)];
    if (!enemyId) continue;
    const base = { tick, enemyId, dist: dist.value * RUN_TIMELINE_DIST_QUANTUM };
    out.push(code.value % 2 === 1
      ? { ...base, kind: 'leak', coresLost: tail.value }
      : { ...base, kind: 'kill', towerUid: tail.value === 0 ? null : tail.value - 1 });
  }
  return { entries: out, truncated: pack.truncated === true };
}

function uint(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
