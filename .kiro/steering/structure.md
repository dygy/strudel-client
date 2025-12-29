# Project Structure

## Monorepo Organization
This is a pnpm workspace monorepo with packages organized by functionality.

## Root Directory
```
strudel/
├── packages/           # Core @strudel/* packages (20+ packages)
├── website/           # Main Strudel REPL and documentation site
├── examples/          # Usage examples and demos
├── scripts/           # Development and deployment scripts
├── test/              # Integration tests
├── docs/              # Technical documentation
├── src-tauri/         # Desktop app (Tauri)
├── tools/             # Development tools
└── samples/           # Audio samples
```

## Package Categories

### Core Packages
- **@strudel/core** - Pattern engine, fundamental functionality
- **@strudel/mini** - Mini notation parser
- **@strudel/transpiler** - Code transformation utilities

### Audio & Synthesis
- **@strudel/webaudio** - Web Audio API integration
- **@strudel/superdough** - Main audio engine
- **@strudel/soundfonts** - SoundFont support
- **@strudel/csound** - Csound integration

### Interface & Interaction
- **@strudel/codemirror** - Code editor integration
- **@strudel/repl** - REPL component
- **@strudel/draw** - Visualization utilities
- **@strudel/gamepad** - Gamepad input

### Music Theory & Notation
- **@strudel/tonal** - Music theory utilities
- **@strudel/xen** - Xenharmonic music support
- **@strudel/tidal** - TidalCycles compatibility

### Communication
- **@strudel/midi** - MIDI support
- **@strudel/osc** - OSC protocol
- **@strudel/mqtt** - MQTT messaging
- **@strudel/serial** - Serial communication
- **@strudel/desktopbridge** - Desktop app integration

### Extensions
- **@strudel/hydra** - Hydra visuals integration
- **@strudel/motion** - Motion sensor support

## File Conventions
- **Extensions**: Use `.mjs` for ES modules, `.ts` for TypeScript
- **Configuration**: Each package has `package.json` and `vite.config.js`
- **Documentation**: README.md in each package, JSDoc comments in code
- **Tests**: `test/` directories or `.test.mjs` files

## Key Directories
- **packages/core/** - Heart of the pattern system
- **website/src/** - Main application code
- **examples/** - Standalone usage examples
- **scripts/** - Automation and deployment scripts
- **docs/technical-manual/** - Technical documentation

## Development Workflow
1. Make changes in `packages/`
2. Run `pnpm run build:packages` to rebuild
3. Test in `website/` with `pnpm dev`
4. All packages use `workspace:*` for local development