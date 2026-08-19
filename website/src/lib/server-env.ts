/**
 * Server-side environment access.
 *
 * On Cloudflare Workers, vars and secrets are not available as build-time
 * constants: they are handed to the Worker per request on
 * `locals.runtime.env`. `src/middleware.ts` captures that object on the first
 * request so module-scope code can reach it without threading `locals` through
 * every helper.
 *
 * The `import.meta.env` fallbacks keep `astro dev` and the static/Node builds
 * working. Note that only the PUBLIC_ values fall back that way — the service
 * role key is deliberately never read from `import.meta.env`, because Vite
 * would inline it into the bundle at build time.
 */

type RuntimeEnv = Record<string, unknown>;

let runtimeEnv: RuntimeEnv | undefined;

/** Called from middleware with `locals.runtime.env` on each request. */
export function setRuntimeEnv(env: unknown): void {
  if (env && typeof env === 'object') {
    runtimeEnv = env as RuntimeEnv;
  }
}

function read(key: string): string | undefined {
  const fromRuntime = runtimeEnv?.[key];
  if (typeof fromRuntime === 'string' && fromRuntime !== '') {
    return fromRuntime;
  }
  // `process.env` is populated by wrangler/node runtimes; unlike
  // `import.meta.env` it is not statically inlined at build time.
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return fromProcess || undefined;
}

export interface ServerEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
}

export function serverEnv(): ServerEnv {
  return {
    supabaseUrl: read('PUBLIC_SUPABASE_URL') ?? import.meta.env.PUBLIC_SUPABASE_URL,
    supabaseAnonKey: read('PUBLIC_SUPABASE_ANON_KEY') ?? import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceKey: read('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  };
}
