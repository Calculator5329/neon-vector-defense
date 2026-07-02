import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Build-freshness tag: baked into the bundle as __BUILD_TAG__ AND emitted as
// /build-tag.json. Installed/PWA clients compare the two on focus and offer a
// reload toast when a newer deploy exists (see src/buildFreshness.ts).
const BUILD_TAG = Date.now().toString(36);
const PORTAL = process.env.VITE_PORTAL === 'crazygames' || process.env.VITE_PORTAL === 'poki'
  ? process.env.VITE_PORTAL
  : 'none';

const BASE_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'none'",
  "script-src 'self' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://accounts.google.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://*.cloudfunctions.net https://*.workers.dev",
  "frame-src https://www.google.com/recaptcha/ https://apis.google.com https://accounts.google.com https://*.firebaseapp.com",
  "manifest-src 'self'",
  "worker-src 'self'",
];

const PORTAL_CSP = {
  crazygames: BASE_CSP.map((directive) => {
    if (directive.startsWith('script-src')) return `${directive} https://sdk.crazygames.com`;
    if (directive.startsWith('connect-src')) return `${directive} https://sdk.crazygames.com https://*.crazygames.com`;
    return directive;
  }).join('; '),
  poki: BASE_CSP.map((directive) => {
    if (directive.startsWith('script-src')) return `${directive} https://game-cdn.poki.com https://poki-gdn.com https://*.poki-gdn.com`;
    if (directive.startsWith('connect-src')) return `${directive} https://game-cdn.poki.com https://poki-gdn.com https://*.poki-gdn.com https://*.poki.com`;
    return directive;
  }).join('; '),
} as const;

// Split stable vendor code into its own long-cached chunks so a game-code change
// doesn't bust the React/Firestore cache, and the player's first load can fetch in
// parallel. firebase/auth is deliberately NOT merged into the eager firebase chunk:
// it is reached only via the lazy admin chunk (src/game/adminAuth.ts) and the
// dynamic import in src/game/anonAuth.ts (player sign-in right before the first
// server write), so players never download it on first paint.
export default defineConfig({
  // honor an externally assigned port (preview/CI harnesses set PORT)
  server: { port: Number(process.env.PORT) || 5173 },
  plugins: [
    react(),
    {
      name: 'nvd-build-tag',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-tag.json', source: JSON.stringify({ tag: BUILD_TAG }) });
      },
    },
    {
      name: 'nvd-portal-csp',
      transformIndexHtml() {
        if (PORTAL === 'none') return [];
        return [{
          tag: 'meta',
          injectTo: 'head-prepend' as const,
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: PORTAL_CSP[PORTAL],
          },
        }];
      },
    },
  ],
  define: {
    __BUILD_TAG__: JSON.stringify(BUILD_TAG),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/@firebase/auth') || id.includes('/firebase/auth')) return undefined;
          // firestore is reached only via the dynamic import in firestoreLazy.ts;
          // merging it into the eager 'firebase' chunk would defeat that laziness
          if (id.includes('/@firebase/firestore') || id.includes('/firebase/firestore')) return undefined;
          if (id.includes('/@firebase/') || id.includes('/firebase/')) return 'firebase';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react';
          return undefined;
        },
      },
    },
  },
});
