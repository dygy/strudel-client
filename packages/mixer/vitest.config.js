import { defineConfig } from 'vitest/config';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

export default defineConfig({
  // scratch/scratchWorklet.mjs imports the processor with ?audioworklet (spec 019).
  plugins: [bundleAudioWorkletPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.mjs'],
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', '*.config.js', 'dist/'],
    },
  },
});
