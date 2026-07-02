import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  abandonmentBuckets,
  arsenalHealth,
  buildAdminInsights,
  survivalCurves,
} from '../../src/adminInsights';
import { normalizeRunAnalyticsDoc } from '../../src/game/analyticsSchema';
import type { RunAnalyticsRow } from '../../src/game/leaderboard';

function row(
  id: string,
  patch: {
    build?: string;
    diff?: string;
    wave?: number;
    outcome?: 'victory' | 'gameover' | 'abandoned';
    credits?: number;
    runsBeforeStart?: number;
    towers?: Record<string, number>;
  },
): RunAnalyticsRow {
  return normalizeRunAnalyticsDoc(id, {
    schemaVersion: 2,
    runId: id,
    uid: `u_${id}`,
    createdAt: 1,
    endedAt: 2,
    build: patch.build ?? 'b1',
    summary: {
      callsign: 'TEST',
      map: 'orbital',
      mapName: 'Orbital Relay',
      diff: patch.diff ?? 'normal',
      diffName: 'Veteran',
      freeplay: false,
      outcome: patch.outcome ?? 'gameover',
      phase: patch.outcome ?? 'gameover',
      wave: patch.wave ?? 1,
      kills: 1,
      credits: patch.credits ?? 0,
      cashEarned: 1,
      leaks: 0,
      coresLeft: patch.outcome === 'victory' ? 1 : 0,
      durationS: 60,
    },
    abandonment: {
      quitWithCash: patch.outcome === 'abandoned' ? patch.credits ?? 0 : 0,
    },
    placement: { placedByTower: patch.towers ?? {}, buildOrder: Object.keys(patch.towers ?? {}) },
    progression: { runsBeforeStart: patch.runsBeforeStart ?? 0 },
  });
}

describe('admin live-ops insights', () => {
  test('computes per-protocol survival curves and cliffs', () => {
    const rows = [
      row('r_surv1', { diff: 'normal', wave: 4, outcome: 'victory' }),
      row('r_surv2', { diff: 'normal', wave: 3, outcome: 'gameover' }),
      row('r_surv3', { diff: 'normal', wave: 3, outcome: 'abandoned' }),
      row('r_surv4', { diff: 'hard', wave: 2, outcome: 'victory' }),
    ];
    const normal = survivalCurves(rows).find((curve) => curve.diff === 'normal');
    assert.ok(normal);
    assert.deepEqual(normal.points.find((point) => point.wave === 3), {
      wave: 3,
      reached: 3,
      cleared: 1,
      clearRate: 1 / 3,
    });
    assert.equal(normal.cliffs[0].wave, 3);
  });

  test('groups abandonment spikes by wave, cohort, and cash float', () => {
    const rows = [
      row('r_ab1', { wave: 2, outcome: 'abandoned', credits: 1000, runsBeforeStart: 0 }),
      row('r_ab2', { wave: 2, outcome: 'abandoned', credits: 50, runsBeforeStart: 4 }),
      row('r_ab3', { wave: 5, outcome: 'abandoned', credits: 900, runsBeforeStart: 2 }),
      row('r_ab4', { wave: 5, outcome: 'gameover', credits: 1200, runsBeforeStart: 0 }),
    ];
    const result = abandonmentBuckets(rows);
    assert.equal(result.total, 3);
    assert.equal(result.firstSession, 1);
    assert.equal(result.returning, 2);
    assert.equal(result.quitWithCash, 2);
    assert.equal(result.buckets[0].wave, 2);
    assert.equal(result.buckets[0].quitWithCashRate, 0.5);
  });

  test('flags dead and dominant towers from real-player usage', () => {
    const rows = [
      row('r_t1', { wave: 4, outcome: 'victory', towers: { pulse: 1 } }),
      row('r_t2', { wave: 4, outcome: 'victory', towers: { pulse: 1 } }),
      row('r_t3', { wave: 4, outcome: 'gameover', towers: { tesla: 1 } }),
      row('r_t4', { wave: 4, outcome: 'gameover', towers: { rail: 1 } }),
    ];
    const health = arsenalHealth(rows);
    const pulse = health.find((tower) => tower.towerId === 'pulse');
    const gauss = health.find((tower) => tower.towerId === 'gauss');
    assert.ok(pulse?.flags.includes('dominant'));
    assert.ok(gauss?.flags.includes('dead'));
    assert.equal(pulse?.winRate, 1);
  });

  test('compares active and baseline builds independently', () => {
    const rows = [
      row('r_b1', { build: 'old', wave: 2, outcome: 'gameover' }),
      row('r_b2', { build: 'new', wave: 4, outcome: 'victory' }),
      row('r_b3', { build: 'new', wave: 3, outcome: 'gameover' }),
    ];
    const report = buildAdminInsights(rows, { build: 'new', compareBuild: 'old' });
    assert.deepEqual(report.builds, ['new', 'old']);
    assert.equal(report.active.rows, 2);
    assert.equal(report.active.winRate, 0.5);
    assert.equal(report.compare?.rows, 1);
    assert.equal(report.compare?.winRate, 0);
  });
});
