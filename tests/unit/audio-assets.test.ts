import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ABILITIES } from '../../src/game/abilities';
import { ALL_MAPS } from '../../src/game/maps';
import { MUSIC_PACKS } from '../../src/game/sound';

const root = process.cwd();

function assertAsset(path: string) {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  assert.ok(existsSync(join(root, 'public', normalized)), `missing public asset: ${path}`);
}

describe('audio asset coverage', () => {
  test('music packs, sector ambience, stingers, briefing, and voice lines exist', () => {
    const assets = new Set<string>();

    for (const pack of MUSIC_PACKS) {
      assert.ok(pack.tracks.length > 0, `${pack.id} should have composed tracks`);
      for (const track of pack.tracks) assets.add(track);
    }

    for (const map of ALL_MAPS) assets.add(`/audio/amb-${map.music ?? map.id}.mp3`);
    for (const name of ['menu-theme', 'boss-theme', 'briefing', 'stinger-victory', 'stinger-defeat']) {
      assets.add(`/audio/${name}.mp3`);
    }

    for (const name of [
      'archive',
      'gameover',
      'leviathan-down',
      'low-cores',
      'titan-down',
      'unlock',
      'victory',
      'wave-boss',
      'wave-clear',
      'wave-cloaked',
      'wave-incoming',
      'wave-leviathan',
    ]) {
      assets.add(`/audio/vox/${name}.mp3`);
    }
    for (const ability of ABILITIES) assets.add(`/audio/vox/cast-${ability.id}.mp3`);

    for (const asset of [...assets].sort()) assertAsset(asset);
  });
});
