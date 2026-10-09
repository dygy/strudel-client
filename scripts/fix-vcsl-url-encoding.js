#!/usr/bin/env node

/**
 * Fix VCSL URL Encoding Issues
 *
 * This script fixes URL encoding issues in vcsl.json by double-encoding spaces
 * so they survive the URL decoding that happens in the application.
 */

const fs = require('fs');
const path = require('path');

const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

/**
 * Fix URL encoding in vcsl.json
 */
function fixUrlEncoding() {
  console.log('🔧 Fixing URL encoding in vcsl.json...\n');

  try {
    // Read the current vcsl.json
    const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
    const vcslData = JSON.parse(content);

    let totalSamples = 0;
    let fixedSamples = 0;

    // Process each category
    for (const [category, samples] of Object.entries(vcslData)) {
      if (Array.isArray(samples)) {
        for (let i = 0; i < samples.length; i++) {
          totalSamples++;
          const originalPath = samples[i];

          // Double-encode %20 to %2520 so it survives URL decoding
          const fixedPath = originalPath.replace(/%20/g, '%2520');

          if (fixedPath !== originalPath) {
            samples[i] = fixedPath;
            fixedSamples++;
          }
        }
      }
    }

    // Write the updated JSON
    fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(vcslData, null, 2));

    console.log(`✅ Fixed URL encoding:`);
    console.log(`   📊 Total samples: ${totalSamples}`);
    console.log(`   🔧 Fixed samples: ${fixedSamples}`);
    console.log(`   📁 Categories: ${Object.keys(vcslData).length}`);

    if (fixedSamples > 0) {
      console.log(`\n💡 Changes made:`);
      console.log(`   - Converted %20 to %2520 in ${fixedSamples} sample paths`);
      console.log(`   - This ensures URLs work correctly after application URL decoding`);
    } else {
      console.log(`\n✨ No changes needed - all URLs already properly encoded`);
    }
  } catch (error) {
    console.error('❌ Error fixing URL encoding:', error.message);
    process.exit(1);
  }
}

/**
 * Revert URL encoding changes
 */
function revertUrlEncoding() {
  console.log('↩️  Reverting URL encoding changes in vcsl.json...\n');

  try {
    // Read the current vcsl.json
    const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
    const vcslData = JSON.parse(content);

    let totalSamples = 0;
    let revertedSamples = 0;

    // Process each category
    for (const [category, samples] of Object.entries(vcslData)) {
      if (Array.isArray(samples)) {
        for (let i = 0; i < samples.length; i++) {
          totalSamples++;
          const originalPath = samples[i];

          // Revert %2520 back to %20
          const revertedPath = originalPath.replace(/%2520/g, '%20');

          if (revertedPath !== originalPath) {
            samples[i] = revertedPath;
            revertedSamples++;
          }
        }
      }
    }

    // Write the updated JSON
    fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(vcslData, null, 2));

    console.log(`✅ Reverted URL encoding:`);
    console.log(`   📊 Total samples: ${totalSamples}`);
    console.log(`   ↩️  Reverted samples: ${revertedSamples}`);
    console.log(`   📁 Categories: ${Object.keys(vcslData).length}`);
  } catch (error) {
    console.error('❌ Error reverting URL encoding:', error.message);
    process.exit(1);
  }
}

/**
 * Show current encoding status
 */
function showStatus() {
  console.log('📊 VCSL URL Encoding Status\n');

  try {
    const content = fs.readFileSync(VCSL_JSON_PATH, 'utf8');
    const vcslData = JSON.parse(content);

    let totalSamples = 0;
    let singleEncoded = 0;
    let doubleEncoded = 0;
    let noSpaces = 0;

    for (const [category, samples] of Object.entries(vcslData)) {
      if (Array.isArray(samples)) {
        for (const samplePath of samples) {
          totalSamples++;

          if (samplePath.includes('%2520')) {
            doubleEncoded++;
          } else if (samplePath.includes('%20')) {
            singleEncoded++;
          } else if (!samplePath.includes(' ')) {
            noSpaces++;
          }
        }
      }
    }

    console.log(`📁 Categories: ${Object.keys(vcslData).length}`);
    console.log(`📊 Total samples: ${totalSamples}`);
    console.log(`🔧 Double-encoded (%2520): ${doubleEncoded}`);
    console.log(`📝 Single-encoded (%20): ${singleEncoded}`);
    console.log(`✨ No spaces: ${noSpaces}`);

    if (singleEncoded > 0) {
      console.log(`\n⚠️  ${singleEncoded} samples may have URL encoding issues`);
      console.log(`   Run: node scripts/fix-vcsl-url-encoding.js fix`);
    } else if (doubleEncoded > 0) {
      console.log(`\n✅ ${doubleEncoded} samples are double-encoded (should work correctly)`);
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
    case 'fix':
      fixUrlEncoding();
      break;

    case 'revert':
      revertUrlEncoding();
      break;

    case 'status':
      showStatus();
      break;

    case 'help':
    default:
      console.log('🔧 Fix VCSL URL Encoding Issues\n');
      console.log('Available commands:');
      console.log('  fix      - Double-encode spaces (%20 → %2520) to fix URL decoding issues');
      console.log('  revert   - Revert double-encoding (%2520 → %20)');
      console.log('  status   - Show current encoding status');
      console.log('  help     - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/fix-vcsl-url-encoding.js fix     # Fix encoding issues');
      console.log('  node scripts/fix-vcsl-url-encoding.js status  # Check current status');
      console.log('  node scripts/fix-vcsl-url-encoding.js revert  # Undo changes');
      break;
  }
}

// Run the script
if (require.main === module) {
  main();
}
