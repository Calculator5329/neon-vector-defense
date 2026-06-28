// Meta-progression persisted across sessions (localStorage).
// The Archive is knowledge the Warden keeps; best waves are the service record.

const KEY = 'nvd-progress-v1';
const DEMO_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1';

interface Progress {
  /** indices into ARCHIVE recovered across all runs */
  archive: number[];
  /** best wave reached, keyed `${mapId}:${diffId}` */
  best: Record<string, number>;
  /** true once the Diplomat's Gambit ending has been seen */
  armistice: boolean;
  /** cumulative waves cleared across all runs - service record only */
  totalWaves: number;
  /** lifetime service record */
  runs: number;
  victories: number;
  kills: number;
  /** saved defense layouts per map */
  blueprints: Record<string, BlueprintEntry[]>;
  /** recent run history, newest first */
  history: RunRecord[];
  /** leaderboard display name */
  playerName: string;
  /** map ids the player has won at least once (gates the next sector) */
  clearedMaps: string[];
  /** coarse anonymous retention counters */
  firstSeenAt: number;
  lastSeenAt: number;
  sessions: number;
  sessionDays: Record<string, number>;
}

export interface RunRecord {
  map: string;
  diff: string;
  wave: number;
  kills: number;
  cash: number;
  won: boolean;
  freeplay: boolean;
  date: number;
  leaks?: number;
  durationS?: number;
  towers?: string;
}

export interface BlueprintEntry {
  id: string;
  x: number;
  y: number;
  a: number;
  b: number;
}

function freshProgress(): Progress {
  return { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', clearedMaps: [], firstSeenAt: 0, lastSeenAt: 0, sessions: 0, sessionDays: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : [];
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(value)) if (Number.isFinite(Number(val))) out[key] = Number(val);
  return out;
}

function blueprintRecord(value: unknown): Record<string, BlueprintEntry[]> {
  if (!isRecord(value)) return {};
  const out: Record<string, BlueprintEntry[]> = {};
  for (const [mapId, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    out[mapId] = entries.filter(isRecord).map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      x: finiteNumber(entry.x),
      y: finiteNumber(entry.y),
      a: finiteNumber(entry.a),
      b: finiteNumber(entry.b),
    })).filter((entry) => entry.id);
  }
  return out;
}

function runHistory(value: unknown): RunRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    map: typeof entry.map === 'string' ? entry.map : '',
    diff: typeof entry.diff === 'string' ? entry.diff : '',
    wave: finiteNumber(entry.wave),
    kills: finiteNumber(entry.kills),
    cash: finiteNumber(entry.cash),
    won: entry.won === true,
    freeplay: entry.freeplay === true,
    date: finiteNumber(entry.date),
    leaks: entry.leaks === undefined ? undefined : finiteNumber(entry.leaks),
    durationS: entry.durationS === undefined ? undefined : finiteNumber(entry.durationS),
    towers: typeof entry.towers === 'string' ? entry.towers : undefined,
  })).filter((entry) => entry.map && entry.diff).slice(0, 30);
}

export function normalizeProgress(value: unknown): Progress {
  const src = isRecord(value) ? value : {};
  const out = { ...src } as unknown as Progress;
  out.archive = numberArray(src.archive);
  out.best = numberRecord(src.best);
  out.armistice = src.armistice === true;
  out.totalWaves = finiteNumber(src.totalWaves);
  out.runs = finiteNumber(src.runs);
  out.victories = finiteNumber(src.victories);
  out.kills = finiteNumber(src.kills);
  out.blueprints = blueprintRecord(src.blueprints);
  out.history = runHistory(src.history);
  out.playerName = typeof src.playerName === 'string' ? src.playerName.slice(0, 20) : '';
  out.clearedMaps = stringArray(src.clearedMaps);
  out.firstSeenAt = finiteNumber(src.firstSeenAt);
  out.lastSeenAt = finiteNumber(src.lastSeenAt);
  out.sessions = finiteNumber(src.sessions);
  out.sessionDays = numberRecord(src.sessionDays);
  return out;
}

function load(): Progress {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return normalizeProgress(JSON.parse(raw));
  } catch { /* corrupted or unavailable — start fresh */ }
  return freshProgress();
}

let cache = load();

function save() {
  if (DEMO_MODE) return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* storage full or blocked — non-fatal */ }
}

export const progress = {
  get archive(): number[] { return cache.archive; },
  get armisticeSeen(): boolean { return cache.armistice; },
  get totalWaves(): number { return cache.totalWaves; },
  addWaves(n: number) {
    cache.totalWaves += n;
    save();
  },
  get record() { return { runs: cache.runs, victories: cache.victories, kills: cache.kills }; },
  /** @deprecated use addRun */
  get history(): RunRecord[] { return cache.history; },
  addRun(rec: RunRecord) {
    cache.history.unshift(rec);
    if (cache.history.length > 30) cache.history.length = 30;
    cache.runs += 1;
    cache.kills += rec.kills;
    if (rec.won) cache.victories += 1;
    if (rec.freeplay) {
      const c = cache as unknown as { fpRuns?: number; fpBest?: number; fpKills?: number };
      c.fpRuns = (c.fpRuns ?? 0) + 1;
      c.fpBest = Math.max(c.fpBest ?? 0, rec.wave);
      c.fpKills = (c.fpKills ?? 0) + rec.kills;
    }
    if (rec.won && !cache.clearedMaps.includes(rec.map)) cache.clearedMaps.push(rec.map);
    if (rec.won && rec.diff === 'hard') (cache as unknown as { apexW?: boolean }).apexW = true;
    save();
  },
  addFreeplayRun(rec: RunRecord) {
    const c = cache as unknown as { fpRuns?: number; fpBest?: number; fpKills?: number };
    c.fpRuns = (c.fpRuns ?? 0) + 1;
    c.fpBest = Math.max(c.fpBest ?? 0, rec.wave);
    c.fpKills = (c.fpKills ?? 0) + rec.kills;
    save();
  },
  get playerName(): string { return cache.playerName; },
  set playerName(n: string) { cache.playerName = n.slice(0, 20); save(); },
  // audio prefs persist through the already-throw-safe storage wrapper, so a player's
  // mute/music choice sticks across reloads (common preference on portals).
  get audioMuted(): boolean { return (cache as unknown as { mutedPref?: boolean }).mutedPref ?? false; },
  set audioMuted(v: boolean) { (cache as unknown as { mutedPref?: boolean }).mutedPref = v; save(); },
  get musicOff(): boolean { return (cache as unknown as { musicOff?: boolean }).musicOff ?? false; },
  set musicOff(v: boolean) { (cache as unknown as { musicOff?: boolean }).musicOff = v; save(); },
  // accessibility + QoL prefs (same throw-safe persistence as audio)
  get reducedMotion(): boolean { return (cache as unknown as { reducedMotion?: boolean }).reducedMotion ?? false; },
  set reducedMotion(v: boolean) { (cache as unknown as { reducedMotion?: boolean }).reducedMotion = v; save(); },
  get colorblind(): boolean { return (cache as unknown as { colorblind?: boolean }).colorblind ?? false; },
  set colorblind(v: boolean) { (cache as unknown as { colorblind?: boolean }).colorblind = v; save(); },
  /** preferred run speed (1/2/4), restored on each new run; 0 = unset */
  get preferredSpeed(): number { return (cache as unknown as { prefSpeed?: number }).prefSpeed ?? 0; },
  set preferredSpeed(v: number) { (cache as unknown as { prefSpeed?: number }).prefSpeed = v; save(); },
  /** chosen music pack id */
  get musicPack(): string { return (cache as unknown as { musicPack?: string }).musicPack ?? 'concord'; },
  set musicPack(v: string) { (cache as unknown as { musicPack?: string }).musicPack = v; save(); },
  mapCleared(mapId: string): boolean { return cache.clearedMaps.includes(mapId); },
  get apexCleared(): boolean { return (cache as unknown as { apexW?: boolean }).apexW ?? false; },
  /** lifetime freeplay service record */
  get freeplay() {
    const c = cache as unknown as { fpRuns?: number; fpBest?: number; fpKills?: number };
    return { runs: c.fpRuns ?? 0, bestWave: c.fpBest ?? 0, kills: c.fpKills ?? 0 };
  },
  /** anonymous per-device id (no login) — correlates feedback, scores & telemetry */
  get uid(): string {
    const c = cache as unknown as { uid?: string };
    if (!c.uid) { c.uid = 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); save(); }
    return c.uid;
  },
  markSession() {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (!cache.firstSeenAt) cache.firstSeenAt = now;
    if (!cache.lastSeenAt || now - cache.lastSeenAt > 30 * 60 * 1000) {
      cache.sessions += 1;
      cache.sessionDays[day] = (cache.sessionDays[day] ?? 0) + 1;
    }
    cache.lastSeenAt = now;
    save();
  },
  /** read-only copy of per-day session counts (keys 'YYYY-MM-DD') — for the watch streak */
  get sessionDays(): Record<string, number> { return { ...cache.sessionDays }; },
  get engagement() {
    const now = Date.now();
    const firstSeenAt = cache.firstSeenAt || now;
    const lastSeenAt = cache.lastSeenAt || firstSeenAt;
    const day = new Date(now).toISOString().slice(0, 10);
    return {
      firstSeenAt,
      lastSeenAt,
      sessions: cache.sessions,
      sessionsToday: cache.sessionDays[day] ?? 0,
      daysSinceFirstSeen: Math.floor((now - firstSeenAt) / 86400000),
      daysSinceLastSeen: Math.floor((now - lastSeenAt) / 86400000),
    };
  },
  /** tower ids whose unlock modal has already been shown */
  unlockSeen(id: string): boolean { return ((cache as unknown as { unlk?: string[] }).unlk ?? []).includes(id); },
  markUnlockSeen(id: string) {
    const c = cache as unknown as { unlk?: string[] };
    c.unlk = c.unlk ?? [];
    if (!c.unlk.includes(id)) { c.unlk.push(id); save(); }
  },
  get cloakTipSeen(): boolean { return (cache as unknown as { cloakTip?: boolean }).cloakTip ?? false; },
  set cloakTipSeen(v: boolean) { (cache as unknown as { cloakTip?: boolean }).cloakTip = v; save(); },
  // Combine Bestiary: enemy types the Warden has identified in the field
  get enemiesSeen(): string[] { return (cache as unknown as { foes?: string[] }).foes ?? []; },
  /** mark an enemy id discovered; returns true if it was NEW */
  discoverEnemy(id: string): boolean {
    const c = cache as unknown as { foes?: string[] };
    c.foes = c.foes ?? [];
    if (c.foes.includes(id)) return false;
    c.foes.push(id); save(); return true;
  },
  // count of identified hulls the player has already seen in the Bestiary (drives the NEW badge)
  get bestiaryAck(): number { return (cache as unknown as { foesAck?: number }).foesAck ?? 0; },
  set bestiaryAck(v: number) { (cache as unknown as { foesAck?: number }).foesAck = v; save(); },
  get tutorialSeen(): boolean { return (cache as unknown as { tut?: boolean }).tut ?? false; },
  set tutorialSeen(v: boolean) { (cache as unknown as { tut?: boolean }).tut = v; save(); },
  blueprint(mapId: string): BlueprintEntry[] {
    return cache.blueprints[mapId] ?? [];
  },
  saveBlueprint(mapId: string, entries: BlueprintEntry[]) {
    cache.blueprints[mapId] = entries;
    save();
  },
  endRun(kills: number, won: boolean) {
    cache.runs += 1;
    cache.kills += kills;
    if (won) cache.victories += 1;
    save();
  },
  addArchive(i: number) {
    if (!cache.archive.includes(i)) {
      cache.archive.push(i);
      save();
    }
  },
  best(mapId: string, diffId: string): number {
    return cache.best[`${mapId}:${diffId}`] ?? 0;
  },
  /** best wave reached on a map across all protocols */
  bestWaveAny(mapId: string): number {
    let m = 0;
    for (const k in cache.best) if (k.startsWith(`${mapId}:`)) m = Math.max(m, cache.best[k]);
    return m;
  },
  recordWave(mapId: string, diffId: string, wave: number) {
    const k = `${mapId}:${diffId}`;
    if (wave > (cache.best[k] ?? 0)) {
      cache.best[k] = wave;
      save();
    }
  },
  markArmistice() {
    cache.armistice = true;
    save();
  },
  reset() {
    cache = freshProgress();
    save();
  },
};
