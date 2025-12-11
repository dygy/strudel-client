#!/usr/bin/env node

/**
 * Download Discovered VCSL Samples
 * 
 * This script downloads the samples from the vcsl.json file that was created
 * by the discover script
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ORIGINAL_REPO = 'sgossner/VCSL';
const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vcsl');
const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

/**
 * Download a file from URL to local path
 */
async function downloadFile(url, localPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const fileStream = fs.createWriteStream(localPath);
      res.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      
      fileStream.on('error', reject);
    });
    
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
    req.end();
  });
}

/**
 * Load vcsl.json
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
 * Download all samples from vcsl.json
 */
async function downloadAllSamples(limit = null) {
  console.log('📥 Downloading discovered VCSL samples...\n');
  
  const vcslData = loadVcslJson();
  const allSamples = [];
  
  // Collect all sample paths
  for (const [category, samples] of Object.entries(vcslData)) {
    if (Array.isArray(samples)) {
      for (const samplePath of samples) {
        // Handle both formats: local paths and GitHub paths
        let githubPath, localPath;
        
        if (samplePath.startsWith('samples/vcsl/')) {
          // Already local format
          githubPath = samplePath.replace('samples/vcsl/', '');
          localPath = samplePath;
        } else {
          // GitHub format - convert to local
          githubPath = samplePath;
          localPath = `samples/vcsl/${samplePath}`;
        }
        
        allSamples.push({
          category,
          localPath,
          githubPath,
          url: `https://raw.githubusercontent.com/${ORIGINAL_REPO}/master/${githubPath}`
        });
      }
    }
  }
  
  const samplesToDownload = limit ? allSamples.slice(0, limit) : allSamples;
  
  console.log(`Downloading ${samplesToDownload.length} samples from ${Object.keys(vcslData).length} categories...\n`);
  
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  
  for (let i = 0; i < samplesToDownload.length; i++) {
    const sample = samplesToDownload[i];
    const localPath = path.join(__dirname, '../website/public', sample.localPath);
    const fileName = path.basename(sample.githubPath);
    
    process.stdout.write(`[${i + 1}/${samplesToDownload.length}] ${sample.category}: ${fileName}... `);
    
    try {
      // Check if file already exists
      if (fs.existsSync(localPath)) {
        console.log('⏭️  EXISTS');
        skipped++;
        continue;
      }
      
      await downloadFile(sample.url, localPath);
      console.log('✅ OK');
      downloaded++;
      
      // Small delay to avoid rate limiting
      if (i % 5 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.log(`❌ FAILED (${error.message})`);
      failed++;
    }
  }
  
  console.log(`\n📊 Download Results:`);
  console.log(`   ✅ Downloaded: ${downloaded}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success rate: ${((downloaded / (downloaded + failed)) * 100).toFixed(1)}%`);
  
  return { downloaded, failed, skipped, total: samplesToDownload.length };
}

/**
 * Show status
 */
function showStatus() {
  console.log('📊 Discovered VCSL Samples Status\n');
  
  const vcslData = loadVcslJson();
  let totalSamples = 0;
  let localSamples = 0;
  
  for (const [category, samples] of Object.entries(vcslData)) {
    if (Array.isArray(samples)) {
      totalSamples += samples.length;
      
      for (const samplePath of samples) {
        const localPath = path.join(__dirname, '../website/public', samplePath);
        if (fs.existsSync(localPath)) {
          localSamples++;
        }
      }
    }
  }
  
  console.log(`📁 Categories: ${Object.keys(vcslData).length}`);
  console.log(`📊 Samples: ${localSamples}/${totalSamples} (${((localSamples/totalSamples)*100).toFixed(1)}%)`);
  
  if (localSamples === totalSamples) {
    console.log('✅ All discovered samples are available locally');
  } else {
    console.log(`⚠️  ${totalSamples - localSamples} samples missing`);
    console.log('   Run: node scripts/download-discovered-samples.js download');
  }
  
  // Show categories
  console.log(`\n🏷️  Available categories:`);
  Object.keys(vcslData).forEach(category => {
    const count = vcslData[category].length;
    console.log(`   ${category}: ${count} samples`);
  });
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2] || 'help';
  const arg = process.argv[3];
  
  switch (command) {
    case 'download':
      const limit = arg ? parseInt(arg) : null;
      await downloadAllSamples(limit);
      break;
      
    case 'status':
      showStatus();
      break;
      
    case 'help':
    default:
      console.log('🎵 Download Discovered VCSL Samples\n');
      console.log('Available commands:');
      console.log('  download [limit]  - Download samples from vcsl.json (optional limit)');
      console.log('  status           - Show download status');
      console.log('  help             - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/download-discovered-samples.js download     # Download all');
      console.log('  node scripts/download-discovered-samples.js download 50  # Download first 50');
      console.log('  node scripts/download-discovered-samples.js status       # Check status');
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