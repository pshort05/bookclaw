import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: {
    alias: {
      // Import shared code as '@bookclaw/shared' (the barrel) instead of deep
      // relative paths; survives moving the shared tree. CSS/font side-effect
      // imports stay relative (they aren't part of the JS barrel).
      '@bookclaw/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
