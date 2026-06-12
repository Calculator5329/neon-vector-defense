// Meta-progression persisted across sessions (localStorage).
// The Archive is knowledge the Warden keeps; best waves are the service record.

const KEY = 'nvd-progress-v1';

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
  /** story cutscenes on/off */
  cutscenes: boolean;
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
    if (raw) return { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', cutscenes: true, ...JSON.parse(raw) };
  } catch { /* corrupted or unavailable â€” start fresh */ }
  return { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', cutscenes: true };
}

let cache = load();

function save() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* storage full or blocked â€” non-fatal */ }
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
    save();
  },
  get playerName(): string { return cache.playerName; },
  set playerName(n: string) { cache.playerName = n.slice(0, 20); save(); },
  get cutscenes(): boolean { return cache.cutscenes; },
  set cutscenes(on: boolean) { cache.cutscenes = on; save(); },
  get cloakTipSeen(): boolean { return (cache as unknown as { cloakTip?: boolean }).cloakTip ?? false; },
  set cloakTipSeen(v: boolean) { (cache as unknown as { cloakTip?: boolean }).cloakTip = v; save(); },
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
    cache = { archive: [], best: {}, armistice: false, totalWaves: 0, runs: 0, victories: 0, kills: 0, blueprints: {}, history: [], playerName: '', cutscenes: true };
    save();
  },
};


