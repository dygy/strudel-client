#!/bin/bash

# Strudel Workspace Setup Script
# This script sets up the workspace to use local packages instead of npm

set -e

echo "🎵 Setting up Strudel workspace with local packages"
echo "================================================="

# Check if we're in the right directory
if [ ! -f "pnpm-workspace.yaml" ]; then
    echo "❌ Error: Please run this script from the root of the Strudel repository"
    exit 1
fi

echo "🧹 Cleaning existing node_modules and lock files..."
rm -rf node_modules
rm -rf website/node_modules
rm -rf packages/*/node_modules
rm -f pnpm-lock.yaml
rm -f website/pnpm-lock.yaml

echo "📦 Installing workspace dependencies..."
pnpm install

echo "🏗️  Building all packages..."
pnpm run build:packages

echo "🔗 Linking workspace packages..."
cd website
pnpm install
cd ..

echo "✅ Workspace setup complete!"
echo ""
echo "📋 Next steps:"
echo "   • Run 'pnpm dev' to start development server"
echo "   • Run 'pnpm build' to build all packages"
echo "   • All @strudel packages now use local workspace versions"
echo ""
echo "💡 Tips:"
echo "   • Use 'pnpm -r build' to rebuild all packages"
echo "   • Use 'pnpm --filter website dev' to run only website dev server"
echo "   • Changes to packages will be reflected immediately in website"