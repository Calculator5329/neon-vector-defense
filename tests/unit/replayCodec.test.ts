import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  actionHash,
  decodeReplayActionBundle,
  decodeReplayActions,
  encodeReplayActionChunk,
  encodeReplayActions,
  normalizeReplayActionEvents,
  type ReplayActionTables,
} from '../../src/game/replayCodec';
import type { RunEvent } from '../../src/game/runTelemetry';

function event(type: string, simTick: number, payload: Record<string, unknown> = {}): RunEvent {
  return {
    type,
    t: Math.round((simTick / 60) * 10) / 10,
    simTick,
    wave: Math.max(0, Math.floor(Number(payload.wave ?? 1))),
    cash: Math.max(0, Math.floor(Number(payload.cash ?? 1000))),
    lives: Math.max(0, Math.floor(Number(payload.lives ?? 20))),
    speed: Math.max(1, Math.floor(Number(payload.speed ?? 1))),
    ...payload,
  };
}

describe('r3 replay action codec', () => {
  test('round-trips every re-simulation action shape', () => {
    const actions = normalizeReplayActionEvents([
      event('wave_start', 0, { wave: 1, speed: 1 }),
      event('tower_place', 6, { towerId: 'pulse', x: 124.3, y: 256.7, cash: 900 }),
      event('tower_upgrade', 10, { towerUid: 1, track: 0, cash: 720 }),
      event('tower_upgrade', 12, { towerUid: 1, track: 1, cash: 620 }),
      event('target_mode', 14, { towerUid: 1, mode: 'strong' }),
      event('target_filter', 16, { towerUid: 1, filters: 'boss,armored,cloaked' }),
      event('ability_cast', 18, { abilityId: 'strike', x: 300.2, y: 120.8 }),
      event('ability_cast', 22, { abilityId: 'overdrive' }),
      event('pickup_collect', 30, { x: 500.1, y: 400.9, cash: 660 }),
      event('speed_change', 35, { speed: 2 }),
      event('tower_sell', 40, { towerUid: 1, cash: 840 }),
      event('freeplay_enter', 50, { wave: 60, contractId: 'leanGrid' }),
      event('freeplay_relic_select', 55, { wave: 65, relicId: 'sensorCrown' }),
      event('freeplay_risk_accept', 60, { wave: 66, riskId: 'blackout' }),
      event('freeplay_risk_decline', 70, { wave: 70, riskId: 'bounty' }),
      event('run_end', 90, { wave: 70, outcome: 'abandoned' }),
    ]);

    const encoded = encodeReplayActions(actions, { towerIds: ['pulse', 'tesla'] });
    assert.deepEqual(decodeReplayActions(encoded), actions);
    assert.deepEqual(encoded.towerIds, ['pulse', 'tesla']);
  });

  test('decodes root plus chunks with the shared tower table', () => {
    const rootEvents = normalizeReplayActionEvents([
      event('wave_start', 0),
      event('tower_place', 3, { towerId: 'tesla', x: 100, y: 200 }),
    ]);
    const chunkEvents = normalizeReplayActionEvents([
      event('tower_upgrade', 8, { towerUid: 1, track: 1 }),
      event('run_end', 20, { outcome: 'victory' }),
    ]);
    const root = encodeReplayActions(rootEvents, { towerIds: ['pulse', 'tesla'] });
    const tables: ReplayActionTables = { towerIds: root.towerIds };
    const chunk = encodeReplayActionChunk(chunkEvents, tables);

    assert.deepEqual(decodeReplayActionBundle(root, [chunk]), [...rootEvents, ...chunkEvents]);
    assert.match(actionHash(root, [chunk]), /^[a-f0-9]{8}$/);
    assert.notEqual(actionHash(root, []), actionHash(root, [chunk]));
  });

  test('rejects non-monotonic simTick streams', () => {
    assert.throws(
      () => encodeReplayActions([
        event('wave_start', 10),
        event('speed_change', 9, { speed: 4 }),
      ]),
      /monotonic simTick/,
    );
  });

  test('filters unsupported telemetry events before encoding', () => {
    const actions = normalizeReplayActionEvents([
      event('run_start', 0),
      event('wave_start', 1),
      event('leak', 2),
      event('run_end', 3, { outcome: 'gameover' }),
    ]);
    assert.deepEqual(actions.map((action) => action.type), ['wave_start', 'run_end']);
  });

  test('canonicalizes target_filter payloads through the r3 bitmask', () => {
    const actions = normalizeReplayActionEvents([
      event('target_filter', 10, { towerUid: 7, filters: 'spawner,boss,unknown,armored,boss' }),
      event('target_filter', 12, { towerUid: 7, filters: '' }),
    ]);
    assert.deepEqual(actions.map((action) => action.filters), ['boss,armored,spawner', '']);
    assert.deepEqual(decodeReplayActions(encodeReplayActions(actions)), actions);
  });
});
