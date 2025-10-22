# 🛠️ Workspace Development Guide

This guide explains how to work with the Strudel monorepo using local packages instead of npm packages.

## 🚀 Quick Setup

### 1. Initial Setup
```bash
# Setup workspace with local packages
npm run setup:workspace

# Or manually:
pnpm install
pnpm run build:packages
```

### 2. Development
```bash
# Start development server (builds packages first)
pnpm dev

# Or start only website (assumes packages are built)
pnpm --filter website dev
```

## 📦 Package Management

### Using Local Packages
All `@strudel/*` packages now use `workspace:*` versions, which means:
- ✅ **Always Latest**: Uses the current code from the repository
- ✅ **Live Updates**: Changes to packages are reflected immediately
- ✅ **No Version Conflicts**: No need to publish/update versions during development

### Package Dependencies
```json
{
  "@strudel/core": "workspace:*",
  "@strudel/mini": "workspace:*",
  "@strudel/webaudio": "workspace:*"
  // ... all other @strudel packages
}
```

## 🔧 Development Workflow

### 1. Making Changes to Packages
```bash
# Make changes to any package in packages/
cd packages/core
# Edit files...

# Rebuild the specific package
pnpm build

# Or rebuild all packages
pnpm run build:packages
```

### 2. Testing Changes
```bash
# Changes are automatically available in website
# Just refresh your browser or restart dev server
pnpm dev
```

### 3. Building for Production
```bash
# Build all packages first
pnpm run build:packages

# Then build website
cd website
pnpm build
```

## 📋 Available Commands

### Root Level
```bash
# Setup workspace from scratch
npm run setup:workspace

# Build all packages (excluding website)
npm run build:packages

# Clean all node_modules
npm run clean:workspace

# Start development (builds packages + website)
pnpm dev

# Build everything
pnpm build

# Run tests
pnpm test
```

### Package Level
```bash
# Build specific package
pnpm --filter @strudel/core build

# Test specific package
pnpm --filter @strudel/core test

# Build all packages except website
pnpm -r --filter='!website' build
```

### Website Level
```bash
# Website development
pnpm --filter website dev

# Build website only
pnpm --filter website build

# Install website dependencies
pnpm --filter website install
```

## 🔍 Troubleshooting

### "Module not found" errors
```bash
# Rebuild packages
pnpm run build:packages

# Or setup workspace again
npm run setup:workspace
```

### Dependency issues
```bash
# Clean and reinstall
npm run clean:workspace
pnpm install
```

### Build failures
```bash
# Check if all packages build individually
pnpm -r --filter='!website' build

# Check specific package
pnpm --filter @strudel/core build
```

### Website not reflecting package changes
```bash
# Rebuild the changed package
cd packages/your-package
pnpm build

# Restart website dev server
pnpm --filter website dev
```

## 📁 Project Structure

```
strudel/
├── packages/              # Active Strudel packages (20 packages)
│   ├── core/             # @strudel/core - Core functionality
│   ├── mini/             # @strudel/mini - Mini notation
│   ├── webaudio/         # @strudel/webaudio - Web Audio API
│   ├── codemirror/       # @strudel/codemirror - Code editor
│   ├── draw/             # @strudel/draw - Visualization
│   ├── transpiler/       # @strudel/transpiler - Code transpilation
│   ├── tonal/            # @strudel/tonal - Music theory
│   ├── midi/             # @strudel/midi - MIDI support
│   ├── osc/              # @strudel/osc - OSC protocol
│   ├── hydra/            # @strudel/hydra - Hydra visuals
│   ├── csound/           # @strudel/csound - Csound integration
│   ├── tidal/            # @strudel/tidal - Tidal compatibility
│   ├── soundfonts/       # @strudel/soundfonts - SoundFont support
│   ├── gamepad/          # @strudel/gamepad - Gamepad input
│   ├── motion/           # @strudel/motion - Motion sensors
│   ├── mqtt/             # @strudel/mqtt - MQTT protocol
│   ├── serial/           # @strudel/serial - Serial communication
│   ├── mondo/            # @strudel/mondo - Mondo notation
│   ├── xen/              # @strudel/xen - Xenharmonic music
│   └── desktopbridge/    # @strudel/desktopbridge - Desktop integration
├── website/              # Main website/REPL
├── scripts/              # Development scripts
├── pnpm-workspace.yaml   # Workspace configuration
└── package.json          # Root package.json
```

## 🎯 Benefits of Workspace Setup

1. **Latest Code**: Always use the most recent code from the repository
2. **Fast Development**: No need to publish packages to test changes
3. **Consistent Versions**: All packages use the same workspace versions
4. **Easy Debugging**: Can debug directly into package source code
5. **Simplified Workflow**: One command to build everything

## 🔄 Switching Back to NPM Packages

If you need to switch back to published npm packages:

```bash
# In website/package.json, change:
"@strudel/core": "workspace:*"
# Back to:
"@strudel/core": "^1.2.4"

# Then reinstall
cd website
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## 📚 Additional Resources

- [pnpm Workspaces Documentation](https://pnpm.io/workspaces)
- [Lerna Documentation](https://lerna.js.org/)
- [Strudel Contributing Guide](./CONTRIBUTING.md)

---

Happy coding! 🎵✨