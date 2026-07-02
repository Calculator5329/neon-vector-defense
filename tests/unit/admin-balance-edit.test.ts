import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  balanceOverrideRows,
  clampBalanceMult,
  pruneIdentityBalanceDoc,
  sanitizeBalanceDoc,
  towerPreviewRows,
} from '../../src/game/adminBalanceEdit';
import { TOWER_MAP } from '../../src/game/towers';

describe('admin balance editor helpers', () => {
  test('clamps malformed multipliers and sanitizes version text', () => {
    assert.equal(clampBalanceMult('2.5'), 2.5);
    assert.equal(clampBalanceMult('bad'), 1);
    assert.equal(clampBalanceMult(10), 4);
    assert.equal(clampBalanceMult(0), 0.25);

    const doc = sanitizeBalanceDoc({
      version: 'bad label!!!',
      global: { abilityCooldownMult: 0.1 },
      towers: { siphon: { damageMult: 9, projectileSpeedMult: '2' } },
      unknown: { secret: true },
    });
    assert.deepEqual(doc, {
      version: 'badlabel',
      global: { abilityCooldownMult: 0.25 },
      towers: { siphon: { damageMult: 4, projectileSpeedMult: 2 } },
    });
  });

  test('prunes identity values into a sparse publish doc', () => {
    const doc = pruneIdentityBalanceDoc({
      income: { killMult: 1, waveBonusMult: 0.9 },
      global: { abilityCooldownMult: 1 },
      diffs: { normal: { hpMult: 1, lateScale: 1.15 } },
      enemies: { scout: { hpMult: 1, speedMult: 0.8 } },
      towers: { lure: { slowMult: 1.2, burnMult: 1 } },
    });
    assert.deepEqual(doc, {
      income: { waveBonusMult: 0.9 },
      diffs: { normal: { lateScale: 1.15 } },
      enemies: { scout: { speedMult: 0.8 } },
      towers: { lure: { slowMult: 1.2 } },
    });
  });

  test('reports active override paths in stable order', () => {
    const rows = balanceOverrideRows({
      version: 'ops-1',
      global: { abilityCooldownMult: 0.75 },
      towers: { lure: { slowMult: 1.5, burnMult: 1 } },
      enemies: { scout: { speedMult: 1.1 } },
    });
    assert.deepEqual(rows, [
      { path: 'version', value: 'ops-1' },
      { path: 'global.abilityCooldownMult', value: 0.75 },
      { path: 'enemies.scout.speedMult', value: 1.1 },
      { path: 'towers.lure.slowMult', value: 1.5 },
    ]);
  });

  test('previews tower overrides without mutating static definitions', () => {
    const cinder = TOWER_MAP.cinder;
    const [base] = towerPreviewRows(cinder, {
      towers: { cinder: { costMult: 0.5, splashMult: 1.5, burnMult: 2 } },
    });
    assert.equal(base.staticStats.cost, cinder.cost);
    assert.equal(base.overriddenStats.cost, Math.round(cinder.cost * 0.5));
    assert.equal(base.staticStats.splash, 27);
    assert.equal(base.overriddenStats.splash, 40.5);
    assert.equal(base.staticStats.burnDps + base.staticStats.burnZoneDps, 9.75);
    assert.equal(base.overriddenStats.burnDps + base.overriddenStats.burnZoneDps, 19.5);
  });
});
