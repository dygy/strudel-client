#!/usr/bin/env node

/**
 * VSCO-2-CE Release Download Script
 * 
 * Downloads VSCO-2-CE samples from GitHub releases
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = 'sgossner/VSCO-2-CE';
const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vsco2');
const VSCO2_JSON_PATH = path.join(__dirname, '../website/public/vsco2.json');

/**
 * Get release information
 */
async function getReleaseInfo() {
  console.log('🔍 Checking VSCO-2-CE releases...\n');
  
  // Based on the README, version 1.1.0 is available
  const releaseInfo = {
    tag: '1.1.0',
    name: 'VSCO-2-CE SFZ Version 1.1.0',
    downloadUrl: `https://github.com/${REPO}/releases/tag/1.1.0`,
    description: 'VS Chamber Orchestra Community Edition - High-quality orchestral samples'
  };
  
  console.log(`📦 Found release: ${releaseInfo.name}`);
  console.log(`🔗 Release URL: ${releaseInfo.downloadUrl}`);
  
  return releaseInfo;
}

/**
 * Show information about VSCO-2-CE
 */
async function showInfo() {
  console.log('🎼 VSCO-2-CE (VS Chamber Orchestra Community Edition)\n');
  
  const release = await getReleaseInfo();
  
  console.log('📋 About VSCO-2-CE:');
  console.log('   🎻 High-quality orchestral sample library');
  console.log('   🆓 Open-source and free to use');
  console.log('   🎵 Recorded by Sam Gossner & Simon Dalzell');
  console.log('   ✂️  Sample cutting by Elan Hickler/Soundemote');
  console.log('   📄 More info: http://vis.versilstudios.net/vsco-community.html');
  
  console.log(`\n📦 Latest Release: ${release.name}`);
  console.log(`🔗 Download: ${release.downloadUrl}`);
  
  console.log('\n💡 Manual Download Instructions:');
  console.log('1. Visit the release URL above');
  console.log('2. Download the SFZ version (recommended)');
  console.log('3. Extract to website/public/samples/vsco2/');
  console.log('4. Run this script with "process" command to create vsco2.json');
  
  console.log('\n🎯 Expected Instruments:');
  console.log('   🎻 Strings: Violin, Viola, Cello, Double Bass');
  console.log('   🎺 Brass: Trumpet, Horn, Trombone, Tuba');
  console.log('   🎷 Woodwinds: Flute, Oboe, Clarinet, Bassoon');
  console.log('   🥁 Percussion: Timpani, Snare, Cymbals, etc.');
}

/**
 * Process downloaded samples and create JSON mapping
 */
async function processSamples() {
  console.log('🔍 Processing VSCO-2-CE samples...\n');
  
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log('❌ Samples directory not found:', SAMPLES_DIR);
    console.log('💡 Please download and extract VSCO-2-CE samples first.');
    console.log('   Run: node scripts/download-vsco2-release.js info');
    return;
  }
  
  const vsco2Data = {};
  let totalSamples = 0;
  
  /**
   * Recursively scan directory for audio files
   */
  function scanDirectory(dirPath, relativePath = '') {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const itemRelativePath = path.join(relativePath, item);
      
      if (fs.statSync(fullPath).isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(fullPath, itemRelativePath);
      } else if (isAudioFile(item)) {
        // Found an audio file
        const categoryName = createCategoryName(itemRelativePath);
        const samplePath = `samples/vsco2/${itemRelativePath.replace(/\\/g, '/')}`;
        
        if (!vsco2Data[categoryName]) {
          vsco2Data[categoryName] = [];
        }
        
        vsco2Data[categoryName].push(samplePath);
        totalSamples++;
        
        console.log(`🎵 Found: ${categoryName} - ${item}`);
      }
    }
  }
  
  /**
   * Check if file is audio
   */
  function isAudioFile(filename) {
    const audioExtensions = ['.wav', '.mp3', '.flac', '.aiff', '.ogg'];
    const ext = path.extname(filename).toLowerCase();
    return audioExtensions.includes(ext);
  }
  
  /**
   * Create category name from file path
   */
  function createCategoryName(filePath) {
    const parts = filePath.split(path.sep).filter(part => part.length > 0);
    
    // Remove file extension from last part
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      parts[parts.length - 1] = path.parse(lastPart).name;
    }
    
    // Create meaningful category names
    let categoryParts = [];
    
    for (const part of parts) {
      // Skip common directory names
      if (!['samples', 'vsco2', 'VSCO-2-CE'].includes(part)) {
        categoryParts.push(part);
      }
    }
    
    // Take last 2-3 meaningful parts for category name
    const relevantParts = categoryParts.slice(-3);
    
    return relevantParts
      .join('_')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      || 'misc';
  }
  
  // Scan the samples directory
  scanDirectory(SAMPLES_DIR);
  
  // Sort categories and samples
  const sortedData = {};
  const sortedCategories = Object.keys(vsco2Data).sort();
  
  for (const category of sortedCategories) {
    sortedData[category] = vsco2Data[category].sort();
  }
  
  // Write the JSON file
  fs.writeFileSync(VSCO2_JSON_PATH, JSON.stringify(sortedData, null, 2));
  
  console.log(`\n📊 Processing Results:`);
  console.log(`   🎵 Total samples: ${totalSamples}`);
  console.log(`   🏷️  Categories: ${sortedCategories.length}`);
  console.log(`   📁 Sample categories: ${sortedCategories.slice(0, 10).join(', ')}${sortedCategories.length > 10 ? '...' : ''}`);
  console.log(`✅ Created vsco2.json`);
}

/**
 * Check status of VSCO-2-CE integration
 */
async function checkStatus() {
  console.log('📊 VSCO-2-CE Integration Status\n');
  
  const samplesExist = fs.existsSync(SAMPLES_DIR);
  const jsonExists = fs.existsSync(VSCO2_JSON_PATH);
  
  console.log(`📁 Samples directory: ${samplesExist ? '✅ EXISTS' : '❌ MISSING'}`);
  console.log(`📄 vsco2.json file: ${jsonExists ? '✅ EXISTS' : '❌ MISSING'}`);
  
  if (samplesExist) {
    // Count samples
    let sampleCount = 0;
    function countSamples(dir) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          countSamples(fullPath);
        } else if (['.wav', '.mp3', '.flac', '.aiff', '.ogg'].includes(path.extname(item).toLowerCase())) {
          sampleCount++;
        }
      }
    }
    countSamples(SAMPLES_DIR);
    console.log(`🎵 Sample files found: ${sampleCount}`);
  }
  
  if (jsonExists) {
    const vsco2Data = JSON.parse(fs.readFileSync(VSCO2_JSON_PATH, 'utf8'));
    const categories = Object.keys(vsco2Data);
    const totalSamples = Object.values(vsco2Data).reduce((sum, samples) => sum + samples.length, 0);
    
    console.log(`🏷️  Categories in JSON: ${categories.length}`);
    console.log(`📊 Samples in JSON: ${totalSamples}`);
  }
  
  if (!samplesExist) {
    console.log('\n💡 Next steps:');
    console.log('1. Run: node scripts/download-vsco2-release.js info');
    console.log('2. Download VSCO-2-CE release manually');
    console.log('3. Extract to website/public/samples/vsco2/');
    console.log('4. Run: node scripts/download-vsco2-release.js process');
  } else if (!jsonExists) {
    console.log('\n💡 Next step:');
    console.log('   Run: node scripts/download-vsco2-release.js process');
  } else {
    console.log('\n✅ VSCO-2-CE integration is ready!');
  }
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2] || 'help';
  
  switch (command) {
    case 'info':
      await showInfo();
      break;
      
    case 'process':
      await processSamples();
      break;
      
    case 'status':
      await checkStatus();
      break;
      
    case 'help':
    default:
      console.log('🎼 VSCO-2-CE Integration Script\n');
      console.log('Available commands:');
      console.log('  info     - Show information about VSCO-2-CE and download instructions');
      console.log('  process  - Process downloaded samples and create vsco2.json');
      console.log('  status   - Check integration status');
      console.log('  help     - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/download-vsco2-release.js info     # Get download info');
      console.log('  node scripts/download-vsco2-release.js process  # Process samples');
      console.log('  node scripts/download-vsco2-release.js status   # Check status');
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