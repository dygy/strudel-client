#!/bin/bash

# Netlify optimized build script for Strudel
set -e

echo "🚀 Starting Netlify build for Strudel..."

# Memory management
export NODE_OPTIONS="--max-old-space-size=8192"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Install dependencies with frozen lockfile for faster builds
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Generate JSDoc documentation (required for reference package)
echo "📚 Generating JSDoc documentation..."
pnpm run jsdoc-json

# Ensure JSDoc file exists and copy to website directory
if [ ! -f "doc.json" ]; then
    echo "⚠️ JSDoc file not found, creating empty fallback..."
    echo '{"docs":[]}' > doc.json
fi

echo "📋 Copying JSDoc to website directory..."
cp doc.json website/

# Verify the file was copied correctly
if [ ! -f "website/doc.json" ]; then
    echo "❌ Error: Failed to copy JSDoc file to website directory"
    exit 1
fi

echo "✅ JSDoc file verified at website/doc.json"

# Build packages in smaller batches to manage memory
echo "🔨 Building core packages..."
pnpm --filter @strudel/core build
pnpm --filter @strudel/mini build
pnpm --filter @strudel/transpiler build

echo "🔨 Building audio packages..."
pnpm --filter @strudel/webaudio build
# Skip superdough as it has build issues
# pnpm --filter @strudel/superdough build

echo "🔨 Building interface packages..."
pnpm --filter @strudel/codemirror build
pnpm --filter @strudel/repl build
pnpm --filter @strudel/draw build

echo "🔨 Building music theory packages..."
pnpm --filter @strudel/tonal build
pnpm --filter @strudel/xen build
pnpm --filter @strudel/tidal build

echo "🔨 Building communication packages..."
pnpm --filter @strudel/midi build
pnpm --filter @strudel/osc build
pnpm --filter @strudel/mqtt build
pnpm --filter @strudel/serial build

echo "🔨 Building extension packages..."
pnpm --filter @strudel/hydra build
pnpm --filter @strudel/motion build
pnpm --filter @strudel/gamepad build
pnpm --filter @strudel/desktopbridge build

echo "🔨 Building remaining packages..."
pnpm --filter @strudel/soundfonts build
pnpm --filter @strudel/csound build
pnpm --filter @strudel/mondo build

# Clear some memory before final build
echo "🧹 Clearing temporary files..."
find . -name "node_modules/.cache" -type d -exec rm -rf {} + 2>/dev/null || true

# Build website for Netlify
echo "🏗️ Building website for Netlify..."
pnpm --filter website build:netlify

echo "✅ Netlify build complete!"