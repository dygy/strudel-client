# Strudel Client

A personal music workspace built on [Strudel](https://strudel.cc), the browser live-coding environment for algorithmic music (a JavaScript port of TidalCycles).

**Live:** <https://strudel.dygy.app> · **Upstream:** [codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel)

Upstream Strudel is a single-pattern scratchpad. This fork keeps the same pattern engine and editor and adds what you need to build a library and play it live:

- **Cloud library:** sign in with Google, and your tracks are saved per user in Supabase.
  - Organise them in folders, and build multitracks out of steps.
  - Import a ZIP or a folder, and export your library.
  - Strict autosave and an emergency save mean a reload never loses code.
- **Track URLs:** each track has an address, `/repl/<folder>/<track>/<step>`, that you can bookmark and reload.
- **Live-set tools:**
  - **Preview and transitions:** headphone preview on a second engine; transitions (Crossfade, Dip, Cut, Filter sweep, Bass swap, Echo-out, Layered intro) with Snap and tempo sync.
  - **Sets and performance:** a set playlist with Cue → Go; a full-screen performance mode.
  - **Control:** MIDI mapping for everything, and a vinyl scratch deck.
- **Mix and master:**
  - **EQ:** a 10-band parametric EQ (±24 dB) with low/high cuts and a limiter, 81 profile and genre presets, A/B slots and a live spectrum.
  - **Master FX:** a filter, delay and reverb throws, beat-repeat and brake.
  - **Loudness meter:** an EBU R128 loudness meter (LUFS M/S/I, LRA, true peak) with a clipping warning.
- **Editor:**
  - autocomplete that knows mini-notation, banks and samples;
  - Prettier formatting for Strudel code;
  - toggle and radio widgets in the code.
- **Recording:** audio as WAV/MP3 (before or after the EQ), and the screen or a tab as WebM.
- **Also included:**
  - `/embed`, a REPL with no login, for automation;
  - an MCP server at `/mcp`, so an AI assistant can read and edit your library;
  - an admin read-only view;
  - 9 locales, including RTL;
  - a compact layout for phones.

Every feature, with its code paths, spec and tests, is listed in [`context/product/feature-map.md`](./context/product/feature-map.md).

## Running locally

Requirements: Node **24.12.0** and pnpm 10.

```sh
pnpm i
pnpm dev                      # REPL at http://localhost:4321
```

The REPL requires a login, because files live in Supabase. For a local backend:

- Copy `website/.env.example` to `website/.env` and set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
- Copy `website/.dev.vars.example` to `website/.dev.vars` and set `SUPABASE_SERVICE_ROLE_KEY`, which only the server-side admin routes use.
- Both files are git-ignored, so never commit real keys.

Without them, `/embed` still runs the full REPL, minus the library.

The database schema is in [`supabase_schema.sql`](./supabase_schema.sql), and the migrations are in [`supabase/migrations/`](./supabase/migrations). Every table uses row-level security keyed on `auth.uid()`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the REPL dev server (Astro + React). |
| `pnpm exec vitest run` | Runs the whole test suite (~5,700 tests, about 30 s). |
| `pnpm run lint` / `pnpm run format-check` / `pnpm run codeformat` | Runs ESLint, checks Prettier formatting, and fixes it. |
| `pnpm run typecheck` | Type-checks the website (`tsc --noEmit`). |
| `pnpm build:cloudflare` | Runs the production build, a Cloudflare Worker that must stay under 3 MiB. |
| `pnpm deploy:cloudflare:logs` | Tails the production Worker's logs. |

## Repository layout

```
packages/        @strudel/* packages: core, mini, superdough, webaudio, codemirror, …
                 plus the fork's own: mixer (preview, transitions, scratch, master FX,
                 MIDI map, loudness meter) and equalizer
website/         Astro + React REPL, API routes, i18n, docs site, Cloudflare build
supabase/        migrations
context/         product docs (definition, roadmap, architecture, feature map) and
                 per-feature specs under context/spec/NNN-<slug>/
src-tauri/       desktop app (inherited from upstream)
```

The upstream packages stay mergeable: the fork prefers additive changes and marks the places where it diverges.

## Deployment

A push to `main` runs CI (format, lint, typecheck, tests). If CI passes, it builds and deploys to Cloudflare Workers at `strudel.dygy.app`. There is no staging.

Server code reads its environment per request through `website/src/lib/server-env.ts`. The service-role key is a Worker secret (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`).

## How changes are made

Features and fixes follow a spec-driven pipeline: spec → technical design → tasks → implementation → verification → review → push gate → verified on prod. The details are in [`CLAUDE.md`](./CLAUDE.md). The product docs live in [`context/product/`](./context/product):

- [product definition](./context/product/product-definition.md)
- [roadmap](./context/product/roadmap.md)
- [architecture](./context/product/architecture.md)
- [static suites](./context/product/static-suites.md)

## Licence

[GNU Affero General Public License v3](./LICENSE), the same as upstream Strudel. Code built on it can only be shared in free/open-source projects under the same licence.

Licensing for the default sound banks is described in the [dough-samples](https://github.com/felixroos/dough-samples/blob/main/README.md) repository.

## Credits

Strudel is made by Felix Roos, Alex McLean and [many contributors](https://codeberg.org/uzu/strudel/activity/contributors). Its community is in the #strudel channel on the [TidalCycles Discord](https://discord.com/invite/HGEdXmRkzT) and on the [Tidal Club forum](https://club.tidalcycles.org/).
