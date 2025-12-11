#!/usr/bin/env node

/**
 * VSCO-2-CE Dynamic Discovery Script
 * 
 * This script discovers the structure of the VSCO-2-CE repository
 * and creates a JSON mapping for local sample storage.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ORIGINAL_REPO = 'sgossner/VSCO-2-CE';
const OUTPUT_JSON = path.join(__dirname, '../website/public/vsco2.json');
const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vsco2');

/**
 * Make HTTP request to GitHub API or raw content
 */
async function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            // Try to parse as JSON first (API response)
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch {
            // If not JSON, return as text (raw content)
            resolve(data);
          }
        } else if (res.statusCode === 403) {
          console.log(`⚠️  Access forbidden: ${url}`);
          resolve(null);
        } else if (res.statusCode === 404) {
          console.log(`⚠️  Not found: ${url}`);
          resolve(null);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
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
 * Get directory contents from GitHub
 */
async function getDirectoryContents(dirPath = '') {
  const url = `https://api.github.com/repos/${ORIGINAL_REPO}/contents/${dirPath}`;
  console.log(`🔍 Exploring: ${dirPath || 'root'}`);
  
  try {
    const contents = await makeRequest(url);
    if (!contents || !Array.isArray(contents)) {
      return [];
    }
    
    return contents;
  } catch (error) {
    console.log(`⚠️  Failed to get contents for ${dirPath}: ${error.message}`);
    return [];
  }
}

/**
 * Check if a file is an audio file
 */
function isAudioFile(filename) {
  const audioExtensions = ['.wav', '.mp3', '.flac', '.aiff', '.ogg'];
  const ext = path.extname(filename).toLowerCase();
  return audioExtensions.includes(ext);
}

/**
 * Format file size
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Create a category name from directory path
 */
function createCategoryName(dirPath) {
  // Convert path to category name
  // e.g., "Strings/Violin/Sustain" -> "violin_sustain"
  const parts = dirPath.split('/').filter(part => part.length > 0);
  
  // Take the last 1-2 meaningful parts
  const relevantParts = parts.slice(-2);
  
  return relevantParts
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Recursively discover all audio files
 */
async function discoverAudioFiles(dirPath = '', discovered = {}, totalSize = 0) {
  const contents = await getDirectoryContents(dirPath);
  
  for (const item of contents) {
    if (item.type === 'dir') {
      // Recursively explore subdirectories
      const result = await discoverAudioFiles(item.path, discovered, totalSize);
      totalSize = result.totalSize;
    } else if (item.type === 'file' && isAudioFile(item.name)) {
      // Found an audio file
      console.log(`  🎵 Found: ${item.name} (${formatSize(item.size)})`);
      
      const categoryName = createCategoryName(item.path);
      const samplePath = `samples/vsco2/${item.path}`;
      
      if (!discovered[categoryName]) {
        discovered[categoryName] = [];
      }
      
      discovered[categoryName].push(samplePath);
      totalSize += item.size;
    }
  }
  
  return { discovered, totalSize };
}

/**
 * Main discovery function
 */
async function discoverVSCO2() {
  console.log('🎼 Discovering VSCO-2-CE repository structure...\n');
  
  try {
    const { discovered, totalSize } = await discoverAudioFiles();
    
    // Create the JSON structure
    const vsco2Data = {};
    
    // Sort categories and samples
    const sortedCategories = Object.keys(discovered).sort();
    for (const category of sortedCategories) {
      vsco2Data[category] = discovered[category].sort();
    }
    
    // Write the JSON file
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(vsco2Data, null, 2));
    
    // Calculate statistics
    const totalSamples = Object.values(vsco2Data).reduce((sum, samples) => sum + samples.length, 0);
    const categories = Object.keys(vsco2Data);
    
    console.log(`\n📊 Discovery Results:`);
    console.log(`   🎵 Total audio files found: ${totalSamples}`);
    console.log(`   📄 Total size: ${formatSize(totalSize)}`);
    console.log(`   🏷️  Categories: ${categories.length}`);
    
    if (categories.length > 0) {
      console.log(`   📝 Examples: ${categories.slice(0, 10).join(', ')}${categories.length > 10 ? '...' : ''}`);
    }
    
    console.log(`✅ Created vsco2.json with ${categories.length} categories`);
    
    return { categories: categories.length, samples: totalSamples, size: totalSize };
    
  } catch (error) {
    console.error('❌ Discovery failed:', error.message);
    process.exit(1);
  }
}

/**
 * Download samples function
 */
async function downloadSamples(limit = null) {
  console.log('📥 Downloading VSCO-2-CE samples...\n');
  
  // First discover the structure
  const stats = await discoverVSCO2();
  
  // Then download (implementation would be similar to VCSL download script)
  console.log(`\n💡 Discovery complete. Use download-vsco2-samples.js to download the ${stats.samples} samples.`);
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2] || 'help';
  const arg = process.argv[3];
  
  switch (command) {
    case 'discover':
      await discoverVSCO2();
      break;
      
    case 'download':
      const limit = arg ? parseInt(arg) : null;
      await downloadSamples(limit);
      break;
      
    case 'help':
    default:
      console.log('🎼 VSCO-2-CE Dynamic Discovery Script\n');
      console.log('Available commands:');
      console.log('  discover         - Discover repository structure and create vsco2.json');
      console.log('  download [limit] - Discover and download all files (optional limit)');
      console.log('  help             - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/discover-vsco2-samples.js discover    # Just discover structure');
      console.log('  node scripts/discover-vsco2-samples.js download    # Discover and download all');
      console.log('  node scripts/discover-vsco2-samples.js download 50 # Download first 50 files');
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