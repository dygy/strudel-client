#!/usr/bin/env node

/**
 * Strudel Deployment Helper
 * 
 * This script provides an interactive way to deploy Strudel to various platforms.
 * Run with: node deploy.js
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function runCommand(command, cwd = process.cwd()) {
  try {
    console.log(`🔧 Running: ${command}`);
    const result = execSync(command, { 
      cwd, 
      stdio: 'inherit',
      encoding: 'utf8'
    });
    return result;
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    console.error(error.message);
    process.exit(1);
  }
}

function checkPrerequisites() {
  console.log('🔍 Checking prerequisites...');
  
  // Check if we're in the right directory
  if (!existsSync('website/package.json')) {
    console.error('❌ Error: Please run this script from the root of the Strudel repository');
    process.exit(1);
  }
  
  // Check if pnpm is installed
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
  } catch {
    console.error('❌ pnpm is not installed. Please install it first: npm install -g pnpm');
    process.exit(1);
  }
  
  console.log('✅ Prerequisites check passed');
}

async function deployToVercel() {
  console.log('\n🚀 Deploying to Vercel...');
  
  // Check if Vercel CLI is installed
  try {
    execSync('vercel --version', { stdio: 'ignore' });
  } catch {
    console.log('📦 Installing Vercel CLI...');
    runCommand('npm install -g vercel');
  }
  
  // Check if user is logged in
  try {
    execSync('vercel whoami', { stdio: 'ignore' });
  } catch {
    console.log('🔐 You need to login to Vercel first.');
    console.log('Please run: vercel login');
    console.log('Or set VERCEL_TOKEN environment variable');
    return;
  }
  
  const isProduction = await question('Deploy to production? (y/N): ');
  
  console.log('📦 Installing dependencies...');
  try {
    runCommand('pnpm install', './website');
  } catch {
    console.log('📦 pnpm not found, using npm...');
    runCommand('npm install', './website');
  }
  
  console.log('🏗️  Building project...');
  try {
    runCommand('pnpm build', './website');
  } catch {
    runCommand('npm run build', './website');
  }
  
  console.log('🚀 Deploying...');
  const deployCommand = isProduction.toLowerCase() === 'y' ? 'vercel --prod' : 'vercel';
  runCommand(deployCommand, './website');
  
  console.log('✅ Deployment complete!');
}

async function deployToNetlify() {
  console.log('\n🌐 Deploying to Netlify...');
  
  // Check if Netlify CLI is installed
  try {
    execSync('netlify --version', { stdio: 'ignore' });
  } catch {
    console.log('📦 Installing Netlify CLI...');
    runCommand('npm install -g netlify-cli');
  }
  
  console.log('📦 Installing dependencies...');
  runCommand('pnpm install', './website');
  
  console.log('🏗️  Building project...');
  runCommand('pnpm build', './website');
  
  console.log('🚀 Deploying...');
  runCommand('netlify deploy --prod --dir=dist', './website');
  
  console.log('✅ Deployment complete!');
}

async function buildOnly() {
  console.log('\n🏗️  Building project only...');
  
  console.log('📦 Installing dependencies...');
  runCommand('pnpm install', './website');
  
  console.log('🏗️  Building project...');
  runCommand('pnpm build', './website');
  
  console.log('✅ Build complete! Files are in website/dist/');
}

async function main() {
  console.log('🎵 Strudel Deployment Helper');
  console.log('============================\n');
  
  checkPrerequisites();
  
  console.log('Choose deployment option:');
  console.log('1. Deploy to Vercel (recommended)');
  console.log('2. Deploy to Netlify');
  console.log('3. Build only (for manual deployment)');
  console.log('4. Exit');
  
  const choice = await question('\nEnter your choice (1-4): ');
  
  switch (choice) {
    case '1':
      await deployToVercel();
      break;
    case '2':
      await deployToNetlify();
      break;
    case '3':
      await buildOnly();
      break;
    case '4':
      console.log('👋 Goodbye!');
      break;
    default:
      console.log('❌ Invalid choice. Please run the script again.');
      break;
  }
  
  rl.close();
}

main().catch(console.error);