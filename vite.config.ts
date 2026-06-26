import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Split stable vendor code into its own long-cached chunks so a game-code change
// doesn't bust the React/Firestore cache, and the player's first load can fetch in
// parallel. firebase/auth is deliberately NOT chunked here — it must stay in the
// lazy admin chunk (see src/game/adminAuth.ts) so players never download it.
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
