#!/usr/bin/env node

/**
 * Update VCSL JSON Paths
 * 
 * This script updates the vcsl.json file to use local paths instead of GitHub paths
 */

const fs = require('fs');
const path = require('path');

const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

function updateVcslPaths() {
  console.log('🔄 Updating vcsl.json paths to local format...\n');
  
  // Load current vcsl.json
  const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
  const vcslData = JSON.parse(content);
  
  const updatedData = {};
  let totalSamples = 0;
  
  for (const [category, samples] of Object.entries(vcslData)) {
    if (Array.isArray(samples)) {
      updatedData[category] = samples.map(samplePath => {
        totalSamples++;
        // Convert GitHub path to local path
        if (samplePath.startsWith('samples/vcsl/')) {
          return samplePath; // Already local
        } else {
          return `samples/vcsl/${samplePath}`;
        }
      });
    }
  }
  
  // Write updated JSON
  fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(updatedData, null, 2));
  
  console.log(`✅ Updated vcsl.json:`);
  console.log(`   📁 Categories: ${Object.keys(updatedData).length}`);
  console.log(`   🎵 Total samples: ${totalSamples}`);
  console.log(`   📄 All paths now use local format: samples/vcsl/...`);
}

updateVcslPaths();