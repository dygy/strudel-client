#!/usr/bin/env node

/**
 * Test VCSL Fallback Logic
 *
 * This script tests the fallback logic for VCSL samples loading
 */

const https = require('https');

async function testRepository(repo) {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${repo.replace('github:', '').replace('/master/', '')}`;

    const req = https.request(
      url,
      {
        headers: { 'User-Agent': 'Strudel-VCSL-Test/1.0' },
      },
      (res) => {
        resolve(res.statusCode === 200);
      },
    );

    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function main() {
  console.log('🧪 Testing VCSL repository fallback logic...\n');

  const forkedRepo = 'github:strudel-cycles/VCSL/master/';
  const originalRepo = 'github:sgossner/VCSL/master/';

  console.log('1. Testing forked repository...');
  const forkedExists = await testRepository(forkedRepo);
  console.log(`   ${forkedExists ? '✅' : '❌'} strudel-cycles/VCSL: ${forkedExists ? 'Available' : 'Not found'}`);

  console.log('\n2. Testing original repository...');
  const originalExists = await testRepository(originalRepo);
  console.log(`   ${originalExists ? '✅' : '❌'} sgossner/VCSL: ${originalExists ? 'Available' : 'Not found'}`);

  console.log('\n📋 Fallback Logic:');
  if (forkedExists) {
    console.log('   ✅ Will use forked repository (preferred)');
  } else if (originalExists) {
    console.log('   ⚠️  Will fallback to original repository');
    console.log('   💡 Consider creating the fork for better reliability');
  } else {
    console.log('   ❌ Both repositories unavailable - samples will fail to load');
  }

  console.log('\n🔧 To create the fork:');
  console.log('   node scripts/sync-vcsl-samples.js fork');
}

main().catch(console.error);
