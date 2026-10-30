# System Architecture Overview: Strudel Client

---

## 1. Application & Technology Stack

- **Monorepo:** pnpm workspaces (pnpm 10, Node 24.12.0, pinned in `package.json` `engines`), with Lerna metadata.
- **Pattern and audio packages:** `packages/*`, published as `@strudel/*`. These are plain ES modules (`.mjs`), with TypeScript only in places. Audio runs on the Web Audio API and AudioWorklets, bundled with `vite-plugin-bundle-audioworklet`.
- **Website and REPL:** `website/`, built with Astro and React islands. The editor is CodeMirror 6 (`packages/codemirror`). State lives in nanostores (`website/src/stores`).
- **Desktop:** Tauri (`src-tauri/`, `packages/desktopbridge`).

## 2. Data & Persistence

- **Database:** Supabase Postgres. The schema is in `supabase_schema.sql`, with tree tables in `website/src/lib/database/tree-schema.sql`. There are **no migration files**: `supabase/` holds only `config.toml`. Every table has RLS by `auth.uid()`.
  - `tracks`: the real store for code, folder, multitrack and steps.
  - `folders`, `profiles`, `file_system_nodes`.
  - `tree_nodes`, `tree_relationships`, `tree_metadata`: unused. The tables stay in the database; their API and `TreeManager` were removed on 2026-10-30 (spec 002).
- **Server access:** Astro API routes under `website/src/pages/api/*`. These are tracks, folders, filesystem (read-only `tree`), library, auth and admin. User routes and the REPL SSR page act as the user through `api/_userClient.ts` (anon key + the user's token), so RLS applies. `SUPABASE_SERVICE_ROLE_KEY` is read only by the admin surfaces; `pages/api/__tests__/serviceKeyScope.test.ts` enforces the list. There are no edge functions.
- **Client cache:** sample cache settings, and per-browser settings in localStorage. Since autosave became strict, **files require login**: there is no local-only file store.

## 3. Infrastructure & Deployment

- **Hosting:** a Cloudflare Worker called `strudel-client`, at the custom domain `strudel.dygy.app`. It is configured in `website/wrangler.jsonc` with `nodejs_compat` and an `ASSETS` binding.
  - The build is `pnpm build:cloudflare`, using `website/astro.config.cloudflare.mjs`.
  - The output is static. Server rendering is limited to `/api/*`, `/admin` and `/repl/*`.
  - Docs pages are prerendered to keep the Worker under its 3 MiB script limit.
  - The Cloudflare build runs with PWA off and image passthrough.
- **CI/CD:** `.github/workflows/deploy.yml`.
  - **Push to `main` → build → `wrangler deploy` to PROD.** There is no staging environment.
  - The `check` job (format, lint, test) runs first. **Any failure blocks the deploy** (`needs: check`). On PRs, `check` runs without a deploy.
- **Secrets (names only):**
  - Wrangler vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`.
  - Wrangler secret: `SUPABASE_SERVICE_ROLE_KEY`, with `.dev.vars` locally.
  - GitHub secret: `CLOUDFLARE_API_TOKEN`.
- **Legacy:** `.forgejo/` holds upstream CI and is not used. The Heroku leftovers (`Dockerfile`, `server.js`, the `express` dependency) were removed on 2026-10-30.

## 4. External Services & APIs

- **Auth:** Supabase Auth with Google OAuth (PKCE). The callback is the `/auth/callback` page: the browser client exchanges the code, since only it holds the code verifier. The unused server-side `/api/auth/callback` and the debug surfaces (`/api/debug/auth`, `/debug-auth`) were removed on 2026-10-30.
- **Analytics:** a Weaver tracker in `website/src/components/HeadCommon.astro`. The site key is public by design.
- **Search:** Algolia, for the upstream docs.
- **Samples:** loaded at runtime from remote sample maps (GitHub/CDN), as in upstream.

## 5. Observability & Monitoring

- **Logs:** Cloudflare Workers observability is on. Use `pnpm deploy:cloudflare:logs` (`wrangler tail`).
- **Deploy status:** `gh run list --repo dygy/strudel-client`.
- **Traffic:** the Weaver dashboard, or the Weaver MCP (`get_overview`, `get_top_pages`).

## 6. Package Dependency Order

Changes flow `core` → `mini`/`tonal`/`transpiler` → `webaudio`/`superdough` → `codemirror`/`repl` → `website`. The website imports packages via `workspace:*`, so a single push ships them all together. Release order only matters inside one commit set: the build has to pass as a whole.
