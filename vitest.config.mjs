import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

/// <reference types="vitest" />
export default defineConfig({
  plugins: [bundleAudioWorkletPlugin()],
  // Mirror website/tsconfig.json `paths` so website tests resolve the same imports as Astro.
  resolve: {
    alias: {
      '@src': fileURLToPath(new URL('./website/src', import.meta.url)),
      '@components': fileURLToPath(new URL('./website/src/components', import.meta.url)),
    },
  },
  test: {
    reporters: 'verbose',
    isolate: false,
    // isolate:false shares globals across files; without this a vi.stubGlobal('window') in one
    // file leaks into the next (core/signal.mjs then touches a missing `document`).
    unstubGlobals: true,
    silent: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress}.config.*',
      '**/shared.test.mjs',
    ],
  },
});
