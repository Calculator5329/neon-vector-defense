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
  /** cumulative waves cleared across all runs - the tower unlock track */
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

function load(): Progress {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', clearedMaps: [], ...JSON.parse(raw) };
  } catch { /* corrupted or unavailable — start fresh */ }
  return { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', clearedMaps: [] };
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
  get playerName(): string { return cache.playerName; },
  set playerName(n: string) { cache.playerName = n.slice(0, 20); save(); },
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
  /** tower ids whose unlock modal has already been shown */
  unlockSeen(id: string): boolean { return ((cache as unknown as { unlk?: string[] }).unlk ?? []).includes(id); },
  markUnlockSeen(id: string) {
    const c = cache as unknown as { unlk?: string[] };
    c.unlk = c.unlk ?? [];
    if (!c.unlk.includes(id)) { c.unlk.push(id); save(); }
  },
  get cloakTipSeen(): boolean { return (cache as unknown as { cloakTip?: boolean }).cloakTip ?? false; },
  set cloakTipSeen(v: boolean) { (cache as unknown as { cloakTip?: boolean }).cloakTip = v; save(); },
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
    cache = { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', clearedMaps: [] };
    save();
  },
};
