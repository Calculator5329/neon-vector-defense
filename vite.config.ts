import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Split stable vendor code into its own long-cached chunks so a game-code change
// doesn't bust the React/Firestore cache, and the player's first load can fetch in
// parallel. firebase/auth is deliberately NOT merged into the eager firebase chunk:
// it is reached only via the lazy admin chunk (src/game/adminAuth.ts) and the
// dynamic import in src/game/anonAuth.ts (player sign-in right before the first
// server write), so players never download it on first paint.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/@firebase/auth') || id.includes('/firebase/auth')) return undefined;
          if (id.includes('/@firebase/') || id.includes('/firebase/')) return 'firebase';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react';
          return undefined;
        },
      },
    },
  },
});
