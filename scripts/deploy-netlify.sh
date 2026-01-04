#!/bin/bash

# Netlify deployment script for Strudel
set -e

echo "🚀 Starting Netlify deployment for Strudel..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Check if netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "📦 Installing Netlify CLI..."
    npm install -g netlify-cli
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Generate JSDoc documentation (required for reference package)
echo "📚 Generating JSDoc documentation..."
pnpm run jsdoc-json

# Build packages (excluding problematic ones)
echo "🔨 Building packages..."
pnpm -r --filter='!website' --filter='!hs2js' --filter='!embed' --filter='!sampler' --filter='!supradough' build

# Build website for Netlify
echo "🏗️ Building website for Netlify..."
pnpm --filter website build:netlify

# Deploy to Netlify
if [ "$1" = "--production" ] || [ "$1" = "--prod" ]; then
    echo "🌐 Deploying to production..."
    netlify deploy --prod --dir=website/dist
else
    echo "🧪 Deploying to preview..."
    netlify deploy --dir=website/dist
fi

echo "✅ Deployment complete!"