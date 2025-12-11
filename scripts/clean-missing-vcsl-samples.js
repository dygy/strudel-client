#!/usr/bin/env node

/**
 * Clean Missing VCSL Samples
 * 
 * This script removes references to non-existent samples from vcsl.json
 * to prevent 404 errors in the application.
 */

const fs = require('fs');
const path = require('path');

const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');
const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vcsl');

/**
 * Check if a sample file exists locally
 */
function sampleExists(samplePath) {
  // Convert the JSON path to actual file path
  // Remove 'samples/vcsl/' prefix and handle URL encoding
  const relativePath = samplePath.replace('samples/vcsl/', '');
  
  // The files are stored with %20 encoding, but JSON has %2520
  // So we need to convert %2520 back to %20 for the file system path
  const fileSystemPath = relativePath.replace(/%2520/g, '%20');
  const fullPath = path.join(SAMPLES_DIR, fileSystemPath);
  
  return fs.existsSync(fullPath);
}

/**
 * Clean missing samples from vcsl.json
 */
function cleanMissingSamples() {
  console.log('🧹 Cleaning missing samples from vcsl.json...\n');
  
  try {
    // Read the current vcsl.json
    const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
    const vcslData = JSON.parse(content);
    
    let totalSamples = 0;
    let removedSamples = 0;
    let emptyCategories = 0;
    const removedCategories = [];
    
    // Process each category
    for (const [category, samples] of Object.entries(vcslData)) {
      if (Array.isArray(samples)) {
        const originalCount = samples.length;
        totalSamples += originalCount;
        
        // Filter out non-existent samples
        const existingSamples = samples.filter(samplePath => {
          const exists = sampleExists(samplePath);
          if (!exists) {
            console.log(`❌ Removing missing: ${category}/${path.basename(samplePath)}`);
            removedSamples++;
          }
          return exists;
        });
        
        // Update the category
        if (existingSamples.length === 0) {
          // Remove empty categories
          delete vcslData[category];
          emptyCategories++;
          removedCategories.push(category);
          console.log(`🗑️  Removed empty category: ${category}`);
        } else {
          vcslData[category] = existingSamples;
        }
      }
    }
    
    // Write the cleaned JSON
    fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(vcslData, null, 2));
    
    console.log(`\n✅ Cleaned vcsl.json:`);
    console.log(`   📊 Total samples processed: ${totalSamples}`);
    console.log(`   ❌ Removed missing samples: ${removedSamples}`);
    console.log(`   🗑️  Removed empty categories: ${emptyCategories}`);
    console.log(`   📁 Remaining categories: ${Object.keys(vcslData).length}`);
    
    if (removedCategories.length > 0) {
      console.log(`\n🗑️  Removed categories: ${removedCategories.join(', ')}`);
    }
    
    if (removedSamples > 0) {
      console.log(`\n💡 This should eliminate 404 errors for missing samples in the Strudel interface.`);
    } else {
      console.log(`\n✨ No missing samples found - vcsl.json is already clean!`);
    }
    
  } catch (error) {
    console.error('❌ Error cleaning missing samples:', error.message);
    process.exit(1);
  }
}

/**
 * Show status of missing samples
 */
function showStatus() {
  console.log('📊 VCSL Missing Samples Status\n');
  
  try {
    const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
    const vcslData = JSON.parse(content);
    
    let totalSamples = 0;
    let existingSamples = 0;
    let missingSamples = 0;
    const missingByCategory = {};
    
    for (const [category, samples] of Object.entries(vcslData)) {
      if (Array.isArray(samples)) {
        let categoryMissing = 0;
        
        for (const samplePath of samples) {
          totalSamples++;
          
          if (sampleExists(samplePath)) {
            existingSamples++;
          } else {
            missingSamples++;
            categoryMissing++;
          }
        }
        
        if (categoryMissing > 0) {
          missingByCategory[category] = categoryMissing;
        }
      }
    }
    
    console.log(`📁 Categories: ${Object.keys(vcslData).length}`);
    console.log(`📊 Total samples in JSON: ${totalSamples}`);
    console.log(`✅ Existing samples: ${existingSamples}`);
    console.log(`❌ Missing samples: ${missingSamples}`);
    
    if (missingSamples > 0) {
      console.log(`\n❌ Missing samples by category:`);
      for (const [category, count] of Object.entries(missingByCategory)) {
        console.log(`   ${category}: ${count} missing`);
      }
      console.log(`\n⚠️  Run: node scripts/clean-missing-vcsl-samples.js clean`);
    } else {
      console.log(`\n✅ All samples in vcsl.json exist locally!`);
    }
    
  } catch (error) {
    console.error('❌ Error checking status:', error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
function main() {
  const command = process.argv[2] || 'help';
  
  switch (command) {
    case 'clean':
      cleanMissingSamples();
      break;
      
    case 'status':
      showStatus();
      break;
      
    case 'help':
    default:
      console.log('🧹 Clean Missing VCSL Samples\n');
      console.log('Available commands:');
      console.log('  clean    - Remove references to non-existent samples from vcsl.json');
      console.log('  status   - Show status of missing samples');
      console.log('  help     - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/clean-missing-vcsl-samples.js status  # Check for missing samples');
      console.log('  node scripts/clean-missing-vcsl-samples.js clean   # Remove missing sample references');
      break;
  }
}

// Run the script
if (require.main === module) {
  main();
}