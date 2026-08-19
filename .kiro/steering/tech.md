# Technology Stack

## Build System & Package Management
- **Package Manager**: pnpm (required)
- **Workspace**: pnpm workspaces with monorepo structure
- **Build Tool**: Vite for bundling and development
- **Testing**: Vitest for unit tests and benchmarks
- **Linting**: ESLint with custom configuration
- **Formatting**: Prettier

## Core Technologies
- **Runtime**: Node.js (latest recommended)
- **Language**: JavaScript (ES modules), TypeScript (partial migration in progress)
- **Audio**: Web Audio API, AudioWorklets
- **Frontend**: Astro (website), CodeMirror (editor)
- **Desktop**: Tauri (optional desktop app)

## Key Libraries
- **Audio Processing**: Custom superdough engine, Web Audio API
- **Pattern Engine**: Custom pattern system inspired by TidalCycles
- **Music Theory**: @tonaljs integration
- **Visualization**: Custom drawing utilities, Hydra integration
- **Communication**: OSC, MIDI, WebSockets

## Common Commands

### Initial Setup
```bash
npm run setup:workspace    # Full workspace setup
# OR manually:
pnpm install
pnpm run build:packages
```

### Development
```bash
pnpm dev                   # Start development server
pnpm --filter website dev  # Website only (packages must be built)
pnpm run build:packages    # Build all packages
```

### Testing & Quality
```bash
pnpm test                  # Run all tests
pnpm test-ui              # Test with UI
pnpm test-coverage        # Coverage report
pnpm bench                # Run benchmarks
pnpm lint                 # ESLint check
pnpm run codeformat       # Format code
pnpm run check            # Full quality check
```

### Building
```bash
pnpm build                # Build everything
pnpm --filter @strudel/core build  # Build specific package
```

### Deployment
The site runs on Cloudflare Workers (Astro SSR via `@astrojs/cloudflare`,
static assets served from the same Worker).

```bash
npm run build:cloudflare    # Build with astro.config.cloudflare.mjs
npm run deploy:cloudflare   # Build + wrangler deploy
npm run dev:cloudflare      # astro dev against the Cloudflare adapter
npm run preview:cloudflare  # wrangler dev (workerd, real bindings)
npm run deploy:cloudflare:logs  # wrangler tail
```

Config lives in `website/wrangler.jsonc`. Public values are `vars` there;
`SUPABASE_SERVICE_ROLE_KEY` is a Worker secret:

```bash
cd website && npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Locally that secret comes from `website/.dev.vars` (git-ignored, see
`.dev.vars.example`). Server code reads env through `src/lib/server-env.ts`
rather than `import.meta.env`, because Cloudflare supplies vars and secrets
per request instead of at build time.

## Package Development
- All `@strudel/*` packages use `workspace:*` dependencies
- Changes to packages require rebuilding: `pnpm run build:packages`
- Each package has its own `vite.config.js` for building
- Use `.mjs` extension for ES modules