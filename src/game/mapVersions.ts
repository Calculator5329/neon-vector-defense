import { ALL_MAPS } from './maps';
import type { GameMap } from './types';

// ── Historical map geometry for replays ──────────────────────────────────────
// Replays are exact re-simulations, and tower placement legality depends on the
// map's path/blockers/pathWidth. When a live map is re-tuned (blockers moved or
// resized), runs recorded under the OLD geometry must still replay and verify on
// that old geometry — re-running them on the new map silently rejects placements
// that were legal at record time, which drops towers from the replay and
// diverges everything downstream.
//
// Every run doc records setup.mapHash (FNV-1a over id/path/blockers/pathWidth).
// resolveReplayMap() maps (mapId, mapHash) to the exact geometry that hash was
// computed from: the current map when the hash still matches, otherwise a frozen
// snapshot from this registry. Whenever a sim-affecting map edit ships, the
// pre-edit geometry MUST be appended here (mapVersions.test.ts enforces that the
// current maps hash-resolve, and the snapshots below are append-only history).
//
// Only geometry that feeds the simulation is snapshotted. Cosmetic fields
// (theme, name, desc, music) always come from the current map.

/** Sim-affecting geometry of one historical map version. */
export interface ReplayMapGeometry {
  id: string;
  pathWidth: number;
  path: { x: number; y: number }[];
  blockers: { x: number; y: number; r: number }[];
  /** beacon zones affect tower range under Blackout Reach — sim-relevant */
  zones?: { x: number; y: number; r: number }[];
}

/** Byte-identical to runTelemetry/reSimulate hashMap: 8-char lowercase hex
 *  (the Firestore rules bound setup.mapHash to ^[a-f0-9]{8}$). */
export function hashReplayMapGeometry(geom: Pick<GameMap, 'id' | 'path' | 'blockers' | 'pathWidth'>): string {
  const data = JSON.stringify({
    id: geom.id,
    path: geom.path.map((p) => [Math.round(p.x), Math.round(p.y)]),
    blockers: geom.blockers.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]),
    pathWidth: geom.pathWidth,
  });
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Authored geometry revision for live sectors. The replay manifest remains
 * hash-pinned; this human-readable revision tells future map tuning which
 * initial geometry must be frozen in HISTORICAL_MAP_GEOMETRY before editing. */
export interface LiveMapGeometryVersion {
  revision: number;
  hash: string;
}

export const MAP_GEOMETRY_VERSIONS: Readonly<Record<string, LiveMapGeometryVersion>> = Object.freeze({
  crossfeed: Object.freeze({ revision: 1, hash: '2b15b235' }),
  needleglass: Object.freeze({ revision: 1, hash: 'ce3cacd2' }),
  bastion: Object.freeze({ revision: 1, hash: '0770b511' }),
  eventide: Object.freeze({ revision: 1, hash: 'bc3acc56' }),
});

/** Append-only: geometry of map versions that were live at some point but have
 *  since been re-tuned. Never edit an entry — add a new one. */
export const HISTORICAL_MAP_GEOMETRY: ReplayMapGeometry[] = [
  // splice pre-2026-07-05 (braid blockers r=42, shrunk to 24 for lane clearance)
  {
    id: 'splice',
    pathWidth: 42,
    path: [
      { x: -40, y: 250 }, { x: 270, y: 250 }, { x: 520, y: 360 }, { x: 270, y: 470 },
      { x: 650, y: 470 }, { x: 520, y: 360 }, { x: 650, y: 250 }, { x: 1010, y: 250 },
      { x: 760, y: 360 }, { x: 1010, y: 470 }, { x: 1320, y: 470 },
    ],
    blockers: [
      { x: 395, y: 360, r: 42 },
      { x: 885, y: 360, r: 42 },
    ],
  },
  // foundry pre-2026-07-05 (wall grid r=42, four walls at old positions before
  // the connector-lane clearance relocation shrank the grid to r=36)
  {
    id: 'foundry',
    pathWidth: 36,
    path: [
      { x: -40, y: 130 }, { x: 1000, y: 130 }, { x: 1000, y: 260 }, { x: 250, y: 260 },
      { x: 250, y: 390 }, { x: 1050, y: 390 }, { x: 1050, y: 520 }, { x: 300, y: 520 },
      { x: 300, y: 650 }, { x: 1320, y: 650 },
    ],
    blockers: [
      { x: 230, y: 195, r: 42 }, { x: 390, y: 195, r: 42 }, { x: 550, y: 195, r: 42 },
      { x: 710, y: 195, r: 42 }, { x: 870, y: 195, r: 42 }, { x: 1030, y: 195, r: 42 },
      { x: 230, y: 325, r: 42 }, { x: 390, y: 325, r: 42 }, { x: 550, y: 325, r: 42 },
      { x: 710, y: 325, r: 42 }, { x: 870, y: 325, r: 42 }, { x: 1030, y: 325, r: 42 },
      { x: 230, y: 455, r: 42 }, { x: 390, y: 455, r: 42 }, { x: 550, y: 455, r: 42 },
      { x: 710, y: 455, r: 42 }, { x: 870, y: 455, r: 42 }, { x: 1030, y: 455, r: 42 },
      { x: 360, y: 585, r: 42 }, { x: 500, y: 585, r: 42 }, { x: 640, y: 585, r: 42 },
      { x: 780, y: 585, r: 42 }, { x: 940, y: 585, r: 42 }, { x: 1100, y: 585, r: 42 },
    ],
  },
];

/** Resolve the exact map geometry a run was recorded on.
 *  - current map when the recorded hash matches (or the doc predates mapHash)
 *  - a frozen historical snapshot (cosmetics from the current map) otherwise
 *  - null when the hash matches no known version of that map */
export function resolveReplayMap(mapId: string, mapHash?: string): GameMap | null {
  const current = ALL_MAPS.find((map) => map.id === mapId);
  if (!current) return null;
  if (!mapHash || hashReplayMapGeometry(current) === mapHash) return current;
  const legacy = HISTORICAL_MAP_GEOMETRY.find(
    (geom) => geom.id === mapId && hashReplayMapGeometry(geom) === mapHash,
  );
  if (!legacy) return null;
  const resolved: GameMap = {
    ...current,
    pathWidth: legacy.pathWidth,
    path: legacy.path.map((p) => ({ ...p })),
    blockers: legacy.blockers.map((b) => ({ ...b })),
  };
  // zones are sim-relevant but unhashed; the snapshot is authoritative for its era
  if (legacy.zones) resolved.zones = legacy.zones.map((z) => ({ ...z }));
  else delete resolved.zones;
  return resolved;
}
