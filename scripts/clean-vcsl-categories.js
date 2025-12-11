#!/usr/bin/env node

/**
 * Clean VCSL Category Names
 * 
 * This script cleans up the category names in vcsl.json to be more user-friendly
 * by removing technical prefixes and making them more readable.
 */

const fs = require('fs');
const path = require('path');

const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

/**
 * Clean category name to be more user-friendly
 */
function cleanCategoryName(categoryName) {
  return categoryName
    // Remove technical prefixes
    .replace(/^struck_20idiophones_/, '')
    .replace(/^struck_20membranophones_/, '')
    .replace(/^edge_blown_20aerophones_/, '')
    .replace(/^lip_20aerophones_/, '')
    .replace(/^free_20aerophones_/, '')
    .replace(/^other_20membranophones_/, '')
    // Replace underscores and numbers with spaces
    .replace(/_20/g, ' ')
    .replace(/_2c_20/g, ', ')
    .replace(/_/g, ' ')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim()
    // Capitalize first letter of each word
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Clean up VCSL category names
 */
function cleanVcslCategories() {
  console.log('🧹 Cleaning VCSL category names...\n');
  
  if (!fs.existsSync(VCSL_JSON_PATH)) {
    console.log('❌ vcsl.json not found:', VCSL_JSON_PATH);
    return;
  }
  
  // Read current vcsl.json
  const vcslData = JSON.parse(fs.readFileSync(VCSL_JSON_PATH, 'utf8'));
  
  // Clean category names
  const cleanedData = {};
  let changedCount = 0;
  
  for (const [oldCategory, samples] of Object.entries(vcslData)) {
    const newCategory = cleanCategoryName(oldCategory);
    
    if (newCategory !== oldCategory) {
      console.log(`🔄 ${oldCategory} → ${newCategory}`);
      changedCount++;
    }
    
    cleanedData[newCategory] = samples;
  }
  
  // Write cleaned data
  fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(cleanedData, null, 2));
  
  console.log(`\n📊 Cleanup Results:`);
  console.log(`   🏷️  Categories cleaned: ${changedCount}`);
  console.log(`   🎵 Total categories: ${Object.keys(cleanedData).length}`);
  console.log(`✅ Cleaned category names in vcsl.json`);
  
  return { cleaned: changedCount, total: Object.keys(cleanedData).length };
}

/**
 * Main function
 */
function main() {
  const command = process.argv[2] || 'clean';
  
  switch (command) {
    case 'clean':
      cleanVcslCategories();
      break;
      
    case 'help':
    default:
      console.log('🧹 Clean VCSL Category Names\n');
      console.log('Available commands:');
      console.log('  clean  - Clean up category names in vcsl.json');
      console.log('  help   - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/clean-vcsl-categories.js clean  # Clean category names');
      break;
  }
}

// Run the script
if (require.main === module) {
  main();
}