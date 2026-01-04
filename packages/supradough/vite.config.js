import { defineConfig } from 'vite';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

export default defineConfig({
  plugins: [bundleAudioWorkletPlugin()],
  build: {
    lib: {
      entry: 'index.mjs',
      name: 'supradough',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: [],
    },
  },
});