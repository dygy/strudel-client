#!/bin/bash

# Strudel Package Sync Script
# This script helps sync packages with the original Strudel repository

set -e

echo "🎵 Strudel Package Sync Script"
echo "=============================="

# Current packages in our workspace
echo "📦 Current packages in workspace:"
ls -1 packages/ | grep -v README.md | sort

echo ""
echo "🔍 Packages used in website/package.json:"
grep -o '"@strudel/[^"]*"' website/package.json | sed 's/"@strudel\///g' | sed 's/"//g' | sort

echo ""
echo "🔍 Packages imported in website code:"
grep -r "from '@strudel/" website/src/ | sed 's/.*@strudel\///g' | sed 's/[^a-z-].*//' | sort | uniq

echo ""
echo "📋 Required packages based on analysis:"
echo "- codemirror"
echo "- core" 
echo "- csound"
echo "- draw"
echo "- gamepad"
echo "- hydra"
echo "- midi"
echo "- mini"
echo "- mondo"
echo "- motion"
echo "- mqtt"
echo "- osc"
echo "- serial"
echo "- soundfonts"
echo "- tidal"
echo "- tonal"
echo "- transpiler"
echo "- webaudio"
echo "- xen"
echo "- desktopbridge (optional, for Tauri)"

echo ""
echo "💡 To add missing packages from original repository:"
echo "   1. Copy the package directory from origin/strudel/packages/"
echo "   2. Place it in ./packages/"
echo "   3. Run 'pnpm install' to link dependencies"
echo "   4. Run 'pnpm run build:packages' to build all packages"