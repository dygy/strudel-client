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
```bash
npm run deploy:vercel:prod  # Deploy to Vercel production
```

## Package Development
- All `@strudel/*` packages use `workspace:*` dependencies
- Changes to packages require rebuilding: `pnpm run build:packages`
- Each package has its own `vite.config.js` for building
- Use `.mjs` extension for ES modules