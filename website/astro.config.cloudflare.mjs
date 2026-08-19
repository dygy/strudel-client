import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import remarkToc from 'remark-toc';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeUrls from 'rehype-urls';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';
import cloudflare from '@astrojs/cloudflare';
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

// Cloudflare Workers build. Run it with:
//   astro build --config astro.config.cloudflare.mjs
// https://astro.build/config
export default defineConfig({
  // Static by default, on-demand only where a route declares
  // `export const prerender = false` (the API routes, /admin and the two /repl
  // pages). Rendering the 55 MDX doc pages at build time instead of per request
  // keeps MiniRepl/csound out of the Worker bundle, which the 3 MiB free-plan
  // script limit does not have room for.
  output: 'static',
  adapter: cloudflare({
    // The site renders no <Image />, so skip the image endpoint entirely
    // rather than shipping sharp (unavailable in workerd) to the Worker.
    imageService: 'passthrough',
  }),
  integrations: [
    react(),
    mdx(options),
    tailwind(),
    // PWA is disabled here, matching the previous Heroku build.
  ],
  site,
  base,
  vite: {
    plugins: [bundleAudioWorkletPlugin()],
    worker: {
      // mp3Worker/prettierWorker are instantiated with `{ type: 'module' }`, and
      // their bundles code-split. Rollup rejects the Vite default of 'iife' for
      // split output, so build them as ES modules.
      format: 'es',
    },
    define: {
      'import.meta.env.MODE': JSON.stringify('cloudflare')
    },
    build: {
      chunkSizeWarningLimit: 10000,
      // Workers cap the compressed script at 3 MB (free) / 10 MB (paid), so the
      // server bundle is minified here even though the Heroku build was not.
      minify: 'esbuild',
      target: 'es2020',
      sourcemap: false, // Disable source maps to save memory
      rollupOptions: {
        // Disable manual chunking to avoid complexity
        output: {}
      }
    },
    // No `ssr.external` here: unlike Node on Heroku, the Worker has no
    // node_modules to resolve from at runtime, so anything reachable from the
    // server entry has to be bundled in.
  },
});