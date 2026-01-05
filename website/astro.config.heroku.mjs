import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import remarkToc from 'remark-toc';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeUrls from 'rehype-urls';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';
import node from '@astrojs/node';

import tailwind from '@astrojs/tailwind';
import AstroPWA from '@vite-pwa/astro';
import AstroPWA from '@vite-pwa/astro';

const site = `https://strudel.cc/`; // root url without a path
const base = '/'; // base path of the strudel site
const baseNoTrailing = base.endsWith('/') ? base.slice(0, -1) : base;

// this rehype plugin fixes relative links
// it works by prepending the base + page path to anchor links
// and by prepending the base path to other relative links starting with /
// this is necessary when using a base href like <base href={base} />
// examples with base as "mybase":
//   #gain -> /mybase/learn/effects/#gain
//   /some/page -> /mybase/some/page
function relativeURLFix() {
  return (tree, file) => {
    const chunks = file.history[0].split('/src/pages/'); // file.history[0] is the file path
    const path = chunks[chunks.length - 1].slice(0, -4); // only path inside src/pages, without .mdx
    return rehypeUrls((url) => {
      let newHref = baseNoTrailing;
      if (url.href.startsWith('#')) {
        // special case: a relative anchor link to the current page
        newHref += `/${path}/${url.href}`;
      } else if (url.href.startsWith('/')) {
        // any other relative url starting with /
        newHref += url.pathname;
        if (url.pathname.indexOf('.') == -1) {
          // append trailing slash to resource only if there is no file extension
          newHref += url.pathname.endsWith('/') ? '' : '/';
        }
        newHref += url.search || '';
        newHref += url.hash || '';
      } else {
        // leave this URL alone
        return;
      }
      // console.log(url.href + ' -> ', newHref);
      return newHref;
    })(tree);
  };
}
const options = {
  // See https://mdxjs.com/advanced/plugins
  remarkPlugins: [
    remarkToc,
    // E.g. `remark-frontmatter`
  ],
  rehypePlugins: [rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'append' }], relativeURLFix],
};

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [
    react(),
    mdx(options),
    tailwind(),
    // Minimal PWA config for Heroku to avoid build errors
    AstroPWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        enabled: false,
      },
      workbox: {
        // Minimal workbox config to reduce memory usage
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 2097152, // 2MB limit
      },
      manifest: {
        name: 'Strudel REPL',
        short_name: 'Strudel',
        description: 'Strudel is a music live coding environment for the browser.',
        theme_color: '#222222',
        icons: [
          {
            src: 'icons/manifest-icon-192.maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  site,
  base,
  vite: {
    plugins: [bundleAudioWorkletPlugin()],
    build: {
      // Optimize for Heroku build constraints
      chunkSizeWarningLimit: 2000, // Increase threshold to reduce warnings
      minify: 'terser', // Use terser for better compression
      rollupOptions: {
        output: {
          manualChunks: {
            // Split large dependencies into separate chunks to reduce memory usage
            'vendor-react': ['react', 'react-dom'],
            'vendor-codemirror': ['@codemirror/state', '@codemirror/view', '@codemirror/lang-javascript'],
            'vendor-audio': ['@strudel/webaudio'],
            'vendor-core': ['@strudel/core'],
            'vendor-csound': ['@strudel/csound'],
          }
        }
      }
    },
    ssr: {
      // Example: Force a broken package to skip SSR processing, if needed
      // external: ['fraction.js'], // https://github.com/infusion/Fraction.js/issues/51
    },
  },
});