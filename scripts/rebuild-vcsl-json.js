#!/usr/bin/env node

/**
 * Rebuild VCSL JSON from Local Files
 * 
 * This script scans the local VCSL samples directory and creates
 * a vcsl.json file based on what actually exists locally.
 */

const fs = require('fs');
const path = require('path');

const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vcsl');
const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

/**
 * Check if file is an audio file
 */
function isAudioFile(filename) {
  const audioExtensions = ['.wav', '.mp3', '.flac', '.aiff', '.ogg'];
  const ext = path.extname(filename).toLowerCase();
  return audioExtensions.includes(ext);
}

/**
 * Create category name from file path
 */
function createCategoryName(relativePath) {
  // Remove the file extension and get directory parts
  const pathParts = relativePath.split('/').filter(part => part.length > 0);
  
  // Remove the filename, keep directory structure
  const relevantParts = pathParts.slice(0, -1); // Remove filename only
  
  // Create category name from the path structure
  let categoryName = '';
  
  if (relevantParts.length >= 2) {
    // Use the last 2 directory levels for category name
    const lastTwo = relevantParts.slice(-2);
    categoryName = lastTwo.join('_');
  } else if (relevantParts.length === 1) {
    categoryName = relevantParts[0];
  } else {
    categoryName = 'misc';
  }
  
  // Clean up the category name
  return categoryName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/struck_idiophones/, '')
    .replace(/struck_membranophones/, '')
    .replace(/edge_blown_aerophones/, '')
    .replace(/lip_aerophones/, '')
    .replace(/free_aerophones/, '')
    .replace(/^_|_$/g, '');
}

/**
 * Recursively scan directory for audio files
 */
function scanDirectory(dirPath, basePath, samples = {}) {
  if (!fs.existsSync(dirPath)) {
    console.log(`⚠️  Directory not found: ${dirPath}`);
    return samples;
  }
  
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const relativePath = path.relative(basePath, fullPath);
    
    if (fs.statSync(fullPath).isDirectory()) {
      // Recursively scan subdirectories
      scanDirectory(fullPath, basePath, samples);
    } else if (isAudioFile(item)) {
      // Found an audio file
      const categoryName = createCategoryName(relativePath);
      // Remove the 'vcsl' prefix from relativePath since we're already in the vcsl directory
      const cleanPath = relativePath.replace(/^vcsl\//, '');
      const samplePath = `samples/vcsl/${cleanPath.replace(/\\/g, '/')}`;
      
      if (!samples[categoryName]) {
        samples[categoryName] = [];
      }
      
      samples[categoryName].push(samplePath);
      console.log(`🎵 ${categoryName}: ${item}`);
    }
  }
  
  return samples;
}

/**
 * Rebuild vcsl.json from local files
 */
function rebuildVcslJson() {
  console.log('🔄 Rebuilding vcsl.json from local files...\n');
  
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log('❌ VCSL samples directory not found:', SAMPLES_DIR);
    console.log('💡 Please ensure VCSL samples are downloaded first.');
    return;
  }
  
  // Scan all local samples
  const samples = scanDirectory(SAMPLES_DIR, SAMPLES_DIR);
  
  // Sort categories and samples
  const sortedSamples = {};
  const sortedCategories = Object.keys(samples).sort();
  
  for (const category of sortedCategories) {
    if (samples[category].length > 0) {
      sortedSamples[category] = samples[category].sort();
    }
  }
  
  // Apply URL encoding fix (double-encode spaces)
  const fixedSamples = {};
  for (const [category, sampleList] of Object.entries(sortedSamples)) {
    fixedSamples[category] = sampleList.map(samplePath => 
      samplePath.replace(/%20/g, '%2520')
    );
  }
  
  // Write the JSON file
  fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(fixedSamples, null, 2));
  
  // Calculate statistics
  const totalSamples = Object.values(fixedSamples).reduce((sum, samples) => sum + samples.length, 0);
  const categories = Object.keys(fixedSamples);
  
  console.log(`\n📊 Rebuild Results:`);
  console.log(`   🎵 Total samples: ${totalSamples}`);
  console.log(`   🏷️  Categories: ${categories.length}`);
  console.log(`   📁 Categories: ${categories.join(', ')}`);
  console.log(`✅ Rebuilt vcsl.json with ${categories.length} categories`);
  
  return { categories: categories.length, samples: totalSamples };
}

/**
 * Main function
 */
function main() {
  const command = process.argv[2] || 'rebuild';
  
  switch (command) {
    case 'rebuild':
      rebuildVcslJson();
      break;
      
    case 'help':
    default:
      console.log('🔄 Rebuild VCSL JSON from Local Files\n');
      console.log('Available commands:');
      console.log('  rebuild  - Scan local files and rebuild vcsl.json');
      console.log('  help     - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/rebuild-vcsl-json.js rebuild  # Rebuild from local files');
      break;
  }
}

// Run the script
if (require.main === module) {
  main();
}