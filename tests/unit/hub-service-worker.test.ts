import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

test('a directory-installed worker leaves hub and sibling game caches and requests alone', async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const kept = ['hub-shell-v1', 'another-game', 'nvd-shell:/other-game/:v4'];
  const keys = [...kept, 'nvd-shell:/neon-vector-defense/:v4'];
  const deleted: string[] = [];
  const precached: string[] = [];
  const cached = new Response('game shell');
  const matches: string[] = [];
  runInNewContext(source, {
    URL, Response,
    self: {
      location: { href: 'https://hub.example/neon-vector-defense/sw.js', origin: 'https://hub.example' },
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => keys,
      delete: async (key: string) => { deleted.push(key); },
      open: async () => ({
        addAll: async (paths: string[]) => { precached.push(...paths); },
        match: async (path: string) => { matches.push(path); return cached; },
      }),
    },
    fetch: async () => { throw new Error('offline'); },
  });
  async function lifecycle(name: string) {
    let pending: Promise<unknown> | undefined;
    listeners.get(name)!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  }
  await lifecycle('install');
  assert.equal(precached.length, 6);
  assert.ok(precached.every((path) => path.startsWith('/neon-vector-defense/')));
  await lifecycle('activate');
  assert.deepEqual(deleted, ['nvd-shell:/neon-vector-defense/:v4']);
  let response: Promise<Response> | undefined;
  const respondWith = (promise: Promise<Response>) => { response = promise; };
  listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://hub.example/other-game/' }, respondWith });
  assert.equal(response, undefined, 'must not intercept another game');
  listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://hub.example/neon-vector-defense/?run=example' }, respondWith });
  assert.equal(await response, cached);
  assert.deepEqual(matches, ['/neon-vector-defense/index.html']);
});
