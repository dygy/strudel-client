import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import remarkToc from 'remark-toc';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeUrls from 'rehype-urls';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

import tailwind from '@astrojs/tailwind';

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
  output: 'static',
  integrations: [
    react(),
    mdx(options),
    tailwind(),
    // PWA disabled for Heroku builds to reduce complexity
  ],
  site,
  base,
  vite: {
    plugins: [bundleAudioWorkletPlugin()],
    define: {
      'import.meta.env.MODE': JSON.stringify('heroku')
    },
    build: {
      // Optimize for Heroku build constraints
      chunkSizeWarningLimit: 2000,
      minify: 'esbuild',
      target: 'es2020',
      sourcemap: false, // Disable source maps to save memory
      rollupOptions: {
        output: {
          // Simplified chunking for static build
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('react-dom')) {
                return 'vendor-react';
              }
              if (id.includes('@codemirror')) {
                return 'vendor-codemirror';
              }
              // Group other vendor code
              return 'vendor';
            }
            if (id.includes('@strudel/')) {
              return 'strudel';
            }
          }
        }
      }
    },
  },
});