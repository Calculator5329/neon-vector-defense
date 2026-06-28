import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import worker from '../../worker/openrouter-proxy.js';

const env = {
  APP_URL: 'https://neon-vector-defense-7.web.app',
  OPENROUTER_API_KEY: 'test-key',
  AI_COOKIE_SECRET: 'test-secret',
  OPENROUTER_MODEL: 'test-model',
};

let originalFetch;
let fetchCalls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Build near the bend.' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request({ origin = env.APP_URL, cookie = '', body = { message: 'What now?' }, contentLength = '' } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (contentLength) headers.set('Content-Length', contentLength);
  return new Request('https://ai.test/help', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('AI worker request gate', () => {
  test('allows the configured app origin and returns CORS headers', async () => {
    const res = await worker.fetch(request(), env);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.reply, 'Build near the bend.');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), env.APP_URL);
    assert.equal(fetchCalls, 1);
  });

  test('rejects bad origins before calling OpenRouter', async () => {
    const res = await worker.fetch(request({ origin: 'https://example.invalid' }), env);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'origin_not_allowed');
    assert.equal(fetchCalls, 0);
  });

  test('rejects missing origins before calling OpenRouter', async () => {
    const res = await worker.fetch(request({ origin: '' }), env);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'origin_not_allowed');
    assert.equal(fetchCalls, 0);
  });

  test('rejects oversized requests before parsing JSON', async () => {
    const res = await worker.fetch(request({ contentLength: '32001' }), env);
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'request_too_large');
    assert.equal(fetchCalls, 0);
  });

  test('rejects oversized actual bodies even with a small content length', async () => {
    const res = await worker.fetch(request({
      body: { message: 'x'.repeat(33_000) },
      contentLength: '1',
    }), env);
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'request_too_large');
    assert.equal(fetchCalls, 0);
  });

  test('limits resettable cookie conversations to five', async () => {
    let cookie = '';
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(request({ cookie }), env);
      assert.equal(res.status, 200);
      cookie = res.headers.get('Set-Cookie') ?? cookie;
    }
    const limited = await worker.fetch(request({ cookie }), env);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'conversation_limit');
    assert.equal(fetchCalls, 5);
  });
});
