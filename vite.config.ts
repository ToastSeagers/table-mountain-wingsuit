import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /table-mountain-wingsuit/. Only the production build uses
// that base; `npm run dev` and Vitest stay at the root so local URLs do not change.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/table-mountain-wingsuit/' : '/',
  build: {
    // Three.js alone is ~530 kB minified; the split keeps the game chunk small, so raise the warning line.
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: {
        // Three.js is most of the bundle and changes rarely, so it caches on its own.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
