#!/usr/bin/env node

/**
 * VCSL Samples Sync Script
 * 
 * This script helps manage the VCSL (VSCO Community Sample Library) fork
 * to ensure reliable access to samples in Strudel.
 * 
 * Usage:
 *   node scripts/sync-vcsl-samples.js [command]
 * 
 * Commands:
 *   check    - Check if samples are accessible
 *   fork     - Instructions for forking the repository
 *   sync     - Instructions for syncing updates
 *   test     - Test sample accessibility
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ORIGINAL_REPO = 'sgossner/VCSL';
const FORKED_REPO = 'strudel-cycles/VCSL';
const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

/**
 * Make HTTP request and return promise
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    // Add User-Agent header for GitHub API
    const requestOptions = {
      ...options,
      headers: {
        'User-Agent': 'Strudel-VCSL-Sync/1.0',
        ...options.headers
      }
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Check if a sample URL is accessible
 */
async function checkSampleUrl(samplePath, repo = FORKED_REPO) {
  // Don't double-encode if already encoded
  const encodedPath = samplePath.includes('%20') ? samplePath : encodeURIComponent(samplePath);
  const url = `https://raw.githubusercontent.com/${repo}/master/${encodedPath}`;
  
  try {
    const response = await httpRequest(url, { method: 'HEAD' });
    return {
      url,
      accessible: response.statusCode === 200,
      statusCode: response.statusCode,
      contentLength: response.headers['content-length']
    };
  } catch (error) {
    return {
      url,
      accessible: false,
      error: error.message
    };
  }
}

/**
 * Load and parse vcsl.json
 */
function loadVcslJson() {
  try {
    const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error loading vcsl.json:', error.message);
    process.exit(1);
  }
}

/**
 * Test sample accessibility
 */
async function testSamples(limit = 10) {
  console.log('🧪 Testing VCSL sample accessibility...\n');
  
  const vcslData = loadVcslJson();
  const allSamples = [];
  
  // Collect all sample paths
  for (const [category, samples] of Object.entries(vcslData)) {
    if (Array.isArray(samples)) {
      for (const sample of samples) {
        allSamples.push({ category, path: sample });
      }
    }
  }
  
  // Test a subset of samples
  const samplesToTest = allSamples.slice(0, limit);
  const results = [];
  
  console.log(`Testing ${samplesToTest.length} samples from ${Object.keys(vcslData).length} categories...\n`);
  
  for (let i = 0; i < samplesToTest.length; i++) {
    const sample = samplesToTest[i];
    process.stdout.write(`[${i + 1}/${samplesToTest.length}] Testing ${sample.category}... `);
    
    const result = await checkSampleUrl(sample.path, ORIGINAL_REPO);
    results.push({ ...sample, ...result });
    
    if (result.accessible) {
      console.log('✅ OK');
    } else {
      console.log(`❌ FAILED (${result.statusCode || result.error})`);
    }
  }
  
  // Summary
  const accessible = results.filter(r => r.accessible).length;
  const failed = results.length - accessible;
  
  console.log(`\n📊 Results:`);
  console.log(`   ✅ Accessible: ${accessible}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success rate: ${((accessible / results.length) * 100).toFixed(1)}%`);
  
  if (failed > 0) {
    console.log(`\n❌ Failed samples:`);
    results.filter(r => !r.accessible).forEach(r => {
      console.log(`   ${r.category}: ${r.path}`);
      console.log(`   Error: ${r.statusCode || r.error}\n`);
    });
  }
  
  return results;
}

/**
 * Check repository status
 */
async function checkRepositories() {
  console.log('🔍 Checking repository status...\n');
  
  // Check original repository
  try {
    const originalResponse = await httpRequest(`https://api.github.com/repos/${ORIGINAL_REPO}`);
    if (originalResponse.statusCode === 200) {
      const originalData = JSON.parse(originalResponse.data);
      console.log(`✅ Original repository (${ORIGINAL_REPO}):`);
      console.log(`   Last updated: ${new Date(originalData.updated_at).toLocaleDateString()}`);
      console.log(`   Default branch: ${originalData.default_branch}`);
      console.log(`   Size: ${(originalData.size / 1024).toFixed(1)} MB`);
    } else {
      console.log(`❌ Original repository (${ORIGINAL_REPO}): HTTP ${originalResponse.statusCode}`);
    }
  } catch (error) {
    console.log(`❌ Original repository (${ORIGINAL_REPO}): ${error.message}`);
  }
  
  console.log();
  
  // Check forked repository
  try {
    const forkedResponse = await httpRequest(`https://api.github.com/repos/${FORKED_REPO}`);
    if (forkedResponse.statusCode === 200) {
      const forkedData = JSON.parse(forkedResponse.data);
      console.log(`✅ Forked repository (${FORKED_REPO}):`);
      console.log(`   Last updated: ${new Date(forkedData.updated_at).toLocaleDateString()}`);
      console.log(`   Default branch: ${forkedData.default_branch}`);
      console.log(`   Size: ${(forkedData.size / 1024).toFixed(1)} MB`);
    } else if (forkedResponse.statusCode === 404) {
      console.log(`❌ Forked repository (${FORKED_REPO}): Not found`);
      console.log(`   This repository needs to be forked from ${ORIGINAL_REPO}`);
    } else {
      console.log(`❌ Forked repository (${FORKED_REPO}): HTTP ${forkedResponse.statusCode}`);
    }
  } catch (error) {
    console.log(`❌ Forked repository (${FORKED_REPO}): ${error.message}`);
    console.log(`   This repository needs to be forked from ${ORIGINAL_REPO}`);
  }
}

/**
 * Show fork instructions
 */
function showForkInstructions() {
  console.log('🍴 VCSL Repository Fork Instructions\n');
  console.log('To fix the VCSL samples 404 errors, follow these steps:\n');
  
  console.log('1. Fork the repository:');
  console.log(`   • Go to: https://github.com/${ORIGINAL_REPO}`);
  console.log(`   • Click "Fork" button`);
  console.log(`   • Fork to: strudel-cycles organization`);
  console.log(`   • Repository name: VCSL`);
  console.log();
  
  console.log('2. Verify the fork:');
  console.log(`   • Check: https://github.com/${FORKED_REPO}`);
  console.log(`   • Ensure all files are present`);
  console.log();
  
  console.log('3. Test the samples:');
  console.log('   • Run: node scripts/sync-vcsl-samples.js test');
  console.log();
  
  console.log('4. Set up sync automation (optional):');
  console.log('   • Create GitHub Action to sync from upstream');
  console.log('   • Schedule weekly checks for updates');
  console.log();
  
  console.log('📝 Note: The prebake.ts file has already been updated to use the forked repository.');
}

/**
 * Show sync instructions
 */
function showSyncInstructions() {
  console.log('🔄 VCSL Repository Sync Instructions\n');
  console.log('To keep the forked repository up to date:\n');
  
  console.log('Manual sync:');
  console.log('1. Go to the forked repository:');
  console.log(`   https://github.com/${FORKED_REPO}`);
  console.log();
  console.log('2. Click "Sync fork" button');
  console.log('3. Click "Update branch" if changes are available');
  console.log();
  
  console.log('Automated sync (recommended):');
  console.log('1. Create .github/workflows/sync-upstream.yml in the forked repo:');
  console.log();
  console.log('```yaml');
  console.log('name: Sync Upstream');
  console.log('on:');
  console.log('  schedule:');
  console.log('    - cron: "0 0 * * 0"  # Weekly on Sunday');
  console.log('  workflow_dispatch:');
  console.log();
  console.log('jobs:');
  console.log('  sync:');
  console.log('    runs-on: ubuntu-latest');
  console.log('    steps:');
  console.log('      - uses: actions/checkout@v3');
  console.log('      - name: Sync upstream changes');
  console.log('        id: sync');
  console.log('        uses: aormsby/Fork-Sync-With-Upstream-action@v3.4');
  console.log('        with:');
  console.log(`          upstream_sync_repo: ${ORIGINAL_REPO}`);
  console.log(`          target_sync_branch: master`);
  console.log('          target_repo_token: ${{ secrets.GITHUB_TOKEN }}');
  console.log('```');
  console.log();
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2] || 'help';
  
  switch (command) {
    case 'check':
      await checkRepositories();
      break;
      
    case 'test':
      const limit = parseInt(process.argv[3]) || 10;
      await testSamples(limit);
      break;
      
    case 'fork':
      showForkInstructions();
      break;
      
    case 'sync':
      showSyncInstructions();
      break;
      
    case 'help':
    default:
      console.log('🎵 VCSL Samples Management Script\n');
      console.log('Available commands:');
      console.log('  check    - Check repository status');
      console.log('  test     - Test sample accessibility (default: 10 samples)');
      console.log('  fork     - Show fork instructions');
      console.log('  sync     - Show sync instructions');
      console.log('  help     - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/sync-vcsl-samples.js check');
      console.log('  node scripts/sync-vcsl-samples.js test 20');
      console.log('  node scripts/sync-vcsl-samples.js fork');
      break;
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script error:', error.message);
    process.exit(1);
  });
}

module.exports = {
  checkSampleUrl,
  testSamples,
  checkRepositories
};