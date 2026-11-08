import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the site under /table-mountain-wingsuit/. Only the production build (and `vite preview` of it) uses
// that base; `npm run dev` and Vitest stay at the root so local URLs do not change.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/table-mountain-wingsuit/' : '/',
  // The version shows in the tester feedback form's technical-details line.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
    // The terrain geometry tests take 2 to 4 s each on the reference laptop and about 3x that on a
    // GitHub-hosted runner, where Vitest's 5 s default made one of them time out (CI run 42512063754).
    testTimeout: 30_000,
  },
}));
