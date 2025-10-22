#!/bin/bash

# Strudel Vercel Deployment Script
# This script helps deploy the Strudel website to Vercel

set -e

echo "🎵 Strudel Vercel Deployment Script"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "website/package.json" ]; then
    echo "❌ Error: Please run this script from the root of the Strudel repository"
    exit 1
fi

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Navigate to website directory
cd website

# Check if user is logged in to Vercel
if ! vercel whoami &> /dev/null; then
    echo "🔐 You need to login to Vercel first."
    echo "Please run: vercel login"
    echo "Or set VERCEL_TOKEN environment variable"
    exit 1
fi

echo "🔧 Installing dependencies..."
if command -v pnpm &> /dev/null; then
    pnpm install
else
    npm install
fi

echo "🏗️  Building the website..."
if command -v pnpm &> /dev/null; then
    pnpm build
else
    npm run build
fi

echo "🚀 Deploying to Vercel..."

# Check if this is a production deployment
if [ "$1" = "--production" ] || [ "$1" = "-p" ]; then
    echo "🌟 Deploying to production..."
    vercel --prod
else
    echo "🧪 Deploying to preview..."
    vercel
fi

echo "✅ Deployment complete!"
echo ""
echo "💡 Tips:"
echo "   • Use './scripts/deploy-vercel.sh --production' for production deployments"
echo "   • Use 'vercel --help' for more Vercel CLI options"
echo "   • Configure custom domains in your Vercel dashboard"
echo "   • Run 'vercel login' if you get authentication errors"