import { defineConfig } from 'vite';
import { resolve } from 'path';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

// https://vitejs.dev/config/
export default defineConfig({
  // Bundles scratch/scratchProcessor.mjs?audioworklet into a data: URL (spec 019).
  plugins: [bundleAudioWorkletPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'index.mjs'),
      formats: ['es'],
      fileName: (ext) => ({ es: 'index.mjs' })[ext],
    },
    rollupOptions: {
      external: ['@strudel/core', '@strudel/midi', 'nanostores'],
    },
    target: 'esnext',
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
