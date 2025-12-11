#!/usr/bin/env node

/**
 * Download VCSL Samples Script
 * 
 * This script downloads VCSL samples from the original repository
 * and stores them locally in the website/public/samples/vcsl/ directory
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ORIGINAL_REPO = 'sgossner/VCSL';
const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');
const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vcsl');

/**
 * Make HTTP request and return promise
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      ...options,
      headers: {
        'User-Agent': 'Strudel-VCSL-Download/1.0',
        ...options.headers
      }
    };
    
    const req = https.request(url, requestOptions, (res) => {
      resolve(res);
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Download a file from URL to local path
 */
async function downloadFile(url, localPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await httpRequest(url);
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const fileStream = fs.createWriteStream(localPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      
      fileStream.on('error', reject);
      response.on('error', reject);
      
    } catch (error) {
      reject(error);
    }
  });
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
 * Update vcsl.json to use local paths
 */
function updateVcslJson(vcslData) {
  const updatedData = {};
  
  for (const [category, samples] of Object.entries(vcslData)) {
    if (Array.isArray(samples)) {
      updatedData[category] = samples.map(samplePath => {
        // Convert from GitHub path to local path
        return `samples/vcsl/${samplePath}`;
      });
    }
  }
  
  // Write updated JSON
  fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(updatedData, null, 2));
  console.log('✅ Updated vcsl.json with local paths');
}

/**
 * Download all VCSL samples
 */
async function downloadAllSamples(limit = null) {
  console.log('📥 Downloading VCSL samples...\n');
  
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
  
  const samplesToDownload = limit ? allSamples.slice(0, limit) : allSamples;
  
  console.log(`Downloading ${samplesToDownload.length} samples from ${Object.keys(vcslData).length} categories...\n`);
  
  let downloaded = 0;
  let failed = 0;
  
  for (let i = 0; i < samplesToDownload.length; i++) {
    const sample = samplesToDownload[i];
    const url = `https://raw.githubusercontent.com/${ORIGINAL_REPO}/master/${sample.path}`;
    const localPath = path.join(SAMPLES_DIR, sample.path);
    
    process.stdout.write(`[${i + 1}/${samplesToDownload.length}] ${sample.category}: ${path.basename(sample.path)}... `);
    
    try {
      // Check if file already exists
      if (fs.existsSync(localPath)) {
        console.log('⏭️  EXISTS');
        downloaded++;
        continue;
      }
      
      await downloadFile(url, localPath);
      console.log('✅ OK');
      downloaded++;
      
      // Small delay to avoid rate limiting
      if (i % 10 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      console.log(`❌ FAILED (${error.message})`);
      failed++;
    }
  }
  
  // Summary
  console.log(`\n📊 Download Results:`);
  console.log(`   ✅ Downloaded: ${downloaded}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success rate: ${((downloaded / samplesToDownload.length) * 100).toFixed(1)}%`);
  
  if (downloaded > 0) {
    console.log(`\n📁 Samples stored in: ${SAMPLES_DIR}`);
    console.log(`📄 Total size: ${getSizeOfDirectory(SAMPLES_DIR)} MB`);
  }
  
  return { downloaded, failed, total: samplesToDownload.length };
}

/**
 * Get directory size in MB
 */
function getSizeOfDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  
  let totalSize = 0;
  
  function calculateSize(itemPath) {
    const stats = fs.statSync(itemPath);
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const items = fs.readdirSync(itemPath);
      items.forEach(item => {
        calculateSize(path.join(itemPath, item));
      });
    }
  }
  
  calculateSize(dirPath);
  return (totalSize / (1024 * 1024)).toFixed(1);
}

/**
 * Show download status
 */
function showStatus() {
  console.log('📊 VCSL Samples Status\n');
  
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log('❌ No local samples found');
    console.log('   Run: node scripts/download-vcsl-samples.js download');
    return;
  }
  
  const vcslData = loadVcslJson();
  let totalSamples = 0;
  let localSamples = 0;
  
  for (const [category, samples] of Object.entries(vcslData)) {
    if (Array.isArray(samples)) {
      totalSamples += samples.length;
      
      for (const sample of samples) {
        // Handle both old and new path formats
        const samplePath = sample.startsWith('samples/vcsl/') 
          ? sample.replace('samples/vcsl/', '') 
          : sample;
        const localPath = path.join(SAMPLES_DIR, samplePath);
        if (fs.existsSync(localPath)) {
          localSamples++;
        }
      }
    }
  }
  
  console.log(`📁 Local samples directory: ${SAMPLES_DIR}`);
  console.log(`📄 Total size: ${getSizeOfDirectory(SAMPLES_DIR)} MB`);
  console.log(`📊 Samples: ${localSamples}/${totalSamples} (${((localSamples/totalSamples)*100).toFixed(1)}%)`);
  
  if (localSamples === totalSamples) {
    console.log('✅ All samples are available locally');
  } else {
    console.log(`⚠️  ${totalSamples - localSamples} samples missing`);
    console.log('   Run: node scripts/download-vcsl-samples.js download');
  }
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
      const result = await downloadAllSamples(limit);
      
      if (result.downloaded > 0) {
        console.log('\n🔄 Updating vcsl.json with local paths...');
        updateVcslJson(loadVcslJson());
      }
      break;
      
    case 'status':
      showStatus();
      break;
      
    case 'update-json':
      console.log('🔄 Updating vcsl.json with local paths...');
      updateVcslJson(loadVcslJson());
      break;
      
    case 'help':
    default:
      console.log('🎵 VCSL Samples Download Script\n');
      console.log('Available commands:');
      console.log('  download [limit]  - Download VCSL samples locally (optional limit)');
      console.log('  status           - Show download status');
      console.log('  update-json      - Update vcsl.json to use local paths');
      console.log('  help             - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/download-vcsl-samples.js download     # Download all samples');
      console.log('  node scripts/download-vcsl-samples.js download 50  # Download first 50 samples');
      console.log('  node scripts/download-vcsl-samples.js status       # Check status');
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
  downloadAllSamples,
  updateVcslJson,
  getSizeOfDirectory
};