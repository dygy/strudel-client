import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { thirdPartyNotices } from './build/notices.js';

// The guest side: one script that runs inside QuickJS, holding core, mini and tonal.
const dropUnusedAssets = {
  name: 'drop-unused-assets',
  generateBundle(_options, bundle) {
    // NeoCyclist's SharedWorker script: the sandbox has no workers.
    for (const [name, file] of Object.entries(bundle)) {
      if (name.startsWith('assets/') && file.type !== 'chunk') {
        delete bundle[name];
      }
    }
  },
};

export default defineConfig({
  plugins: [dropUnusedAssets, thirdPartyNotices('THIRD-PARTY-NOTICES.guest.txt')],
  // the sandbox has no `process`, and must not gain one to satisfy the logger
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    emptyOutDir: false,
    target: 'esnext',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/guest/entry.mjs'),
      formats: ['iife'],
      name: 'strudelGuestBundle',
      fileName: () => 'guest.js',
    },
  },
});
