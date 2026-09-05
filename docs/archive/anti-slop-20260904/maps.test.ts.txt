import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_MAPS, pathLength } from '../../src/game/maps';
import type { GameMap, Vec } from '../../src/game/types';

const W = 1280;
const H = 720;
const MIN_SEGMENT = 80;

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function minPathDistance(p: Vec, map: GameMap): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < map.path.length; i++) {
    best = Math.min(best, distToSegment(p, map.path[i - 1], map.path[i]));
  }
  return best;
}

function isOffscreen(p: Vec): boolean {
  return p.x < 0 || p.x > W || p.y < 0 || p.y > H;
}

describe('map data', () => {
  test('campaign atlas contains twelve unique sector ids in progression order', () => {
    assert.deepEqual(ALL_MAPS.map((map) => map.id), [
      'orbital',
      'carousel',
      'reactor',
      'splice',
      'mobius',
      'mirror',
      'hyperlane',
      'blackout',
      'throat',
      'foundry',
      'umbral',
      'cinder',
    ]);
    assert.equal(new Set(ALL_MAPS.map((map) => map.id)).size, 12);
  });

  test('all sectors keep path geometry inside the playfield after spawn and before exit', () => {
    for (const map of ALL_MAPS) {
      assert.ok(map.path.length >= 2, `${map.id} needs a path`);
      assert.ok(isOffscreen(map.path[0]), `${map.id} must spawn off-screen`);
      assert.ok(isOffscreen(map.path.at(-1)!), `${map.id} must exit off-screen`);

      for (const point of map.path.slice(1, -1)) {
        assert.ok(point.x >= map.pathWidth / 2, `${map.id} path x too low`);
        assert.ok(point.x <= W - map.pathWidth / 2, `${map.id} path x too high`);
        assert.ok(point.y >= map.pathWidth / 2, `${map.id} path y too low`);
        assert.ok(point.y <= H - map.pathWidth / 2, `${map.id} path y too high`);
      }

      for (let i = 1; i < map.path.length; i++) {
        const a = map.path[i - 1];
        const b = map.path[i];
        assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= MIN_SEGMENT, `${map.id} segment ${i} is too short`);
      }
    }
  });

  test('blocker discs clear the full lane width on every segment', () => {
    // The old centerline-only check let Foundry's wall grid overlap the
    // vertical connector segments (shipped 2026-07-05, owner-reported).
    // A blocker's disc must clear the lane edge with a small visual margin.
    const MARGIN = 4;
    for (const map of ALL_MAPS) {
      for (const blocker of map.blockers) {
        if (blocker.r === 0) continue; // point markers, not walls
        const clearance = minPathDistance(blocker, map) - blocker.r - map.pathWidth / 2;
        assert.ok(
          clearance >= MARGIN,
          `${map.id} blocker at ${blocker.x},${blocker.y} r${blocker.r} intrudes into the lane (clearance ${clearance.toFixed(1)}px)`,
        );
      }
    }
  });

  test('new sectors preserve their intended geometry roles', () => {
    const byId = Object.fromEntries(ALL_MAPS.map((map) => [map.id, map]));
    assert.ok(pathLength(byId.carousel.path) > pathLength(byId.orbital.path), 'carousel should be a long breather route');
    assert.ok(byId.foundry.blockers.length > Math.max(...ALL_MAPS.filter((map) => map.id !== 'foundry').map((map) => map.blockers.length)));
    assert.ok(byId.splice.path.filter((point) => point.x === 520 && point.y === 360).length >= 2, 'splice should share a central choke');

    const mirror = byId.mirror;
    for (let i = 0; i < mirror.path.length; i++) {
      const a = mirror.path[i];
      const b = mirror.path[mirror.path.length - 1 - i];
      assert.equal(a.x + b.x, W, `mirror x symmetry at waypoint ${i}`);
      assert.equal(a.y + b.y, H, `mirror y symmetry at waypoint ${i}`);
    }
  });
});
