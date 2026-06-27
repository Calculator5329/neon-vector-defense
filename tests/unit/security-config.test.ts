import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

interface Header {
  key: string;
  value: string;
}

interface HostingHeaderBlock {
  source: string;
  headers: Header[];
}

interface FirebaseJson {
  hosting: {
    headers: HostingHeaderBlock[];
  };
}

function rootHeaders(): Header[] {
  const config = JSON.parse(readFileSync('firebase.json', 'utf8')) as FirebaseJson;
  return config.hosting.headers.find((entry) => entry.source === '**')?.headers ?? [];
}

describe('hosting security headers', () => {
  test('ships a CSP with the app runtime dependencies allowlisted', () => {
    const csp = rootHeaders().find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "form-action 'none'",
      "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://*.cloudfunctions.net https://*.workers.dev",
      "frame-src https://www.google.com/recaptcha/",
      "frame-ancestors 'self' https://*.crazygames.com https://*.poki.com",
      "worker-src 'self'",
    ]) {
      assert.ok(csp.includes(directive), `missing CSP directive: ${directive}`);
    }
  });

  test('keeps baseline browser hardening headers', () => {
    const headers = new Map(rootHeaders().map((header) => [header.key, header.value]));
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.match(headers.get('Permissions-Policy') ?? '', /geolocation=\(\)/);
  });
});
