import { defineMiddleware } from 'astro:middleware';
import { setRuntimeEnv } from './lib/server-env';

/**
 * Cloudflare hands bindings, vars and secrets to the Worker per request rather
 * than as build-time constants. Capture them here so `serverEnv()` can be used
 * from module scope in API routes. On non-Cloudflare targets (`astro dev`,
 * prerendering at build time) `locals.runtime` is undefined and this no-ops.
 */
export const onRequest = defineMiddleware((context, next) => {
  setRuntimeEnv((context.locals as { runtime?: { env?: unknown } })?.runtime?.env);
  return next();
});
