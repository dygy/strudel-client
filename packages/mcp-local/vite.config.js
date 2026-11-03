import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { dependencies } from './package.json';
import { thirdPartyNotices } from './build/notices.js';

// The host side: the MCP server, and the worker that transpiles and drives the sandbox.
// The @strudel/* packages are inlined, because only `dependencies` are installed with the package.
export default defineConfig({
  plugins: [thirdPartyNotices('THIRD-PARTY-NOTICES.host.txt')],
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      input: {
        cli: resolve(__dirname, 'src/cli.mjs'),
        worker: resolve(__dirname, 'src/worker.mjs'),
        'check-worker': resolve(__dirname, 'src/check-worker.mjs'),
      },
      external: [/^node:/, ...Object.keys(dependencies).map((name) => new RegExp(`^${name}(/|$)`))],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name].mjs' },
    },
  },
});
