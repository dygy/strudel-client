#!/usr/bin/env node

/**
 * Discover VCSL Samples Script
 * 
 * This script dynamically discovers all audio files in the VCSL repository
 * and downloads them locally, creating the proper JSON mapping
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ORIGINAL_REPO = 'sgossner/VCSL';
const SAMPLES_DIR = path.join(__dirname, '../website/public/samples/vcsl');
const VCSL_JSON_PATH = path.join(__dirname, '../website/public/vcsl.json');

/**
 * Make HTTP request and return promise
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      ...options,
      headers: {
        'User-Agent': 'Strudel-VCSL-Discover/1.0',
        ...options.headers
      }
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          data: data
        });
      });
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
 * Get directory contents from GitHub API
 */
async function getDirectoryContents(repoPath = '') {
  const url = `https://api.github.com/repos/${ORIGINAL_REPO}/contents/${encodeURIComponent(repoPath)}`;
  
  try {
    const response = await httpRequest(url);
    if (response.statusCode === 200) {
      return JSON.parse(response.data);
    } else {
      console.warn(`⚠️  Failed to get contents for ${repoPath}: HTTP ${response.statusCode}`);
      return [];
    }
  } catch (error) {
    console.warn(`⚠️  Error getting contents for ${repoPath}:`, error.message);
    return [];
  }
}

/**
 * Recursively discover all audio files in the repository
 */
async function discoverAudioFiles(currentPath = '', depth = 0) {
  const maxDepth = 10; // Prevent infinite recursion
  if (depth > maxDepth) {
    console.warn(`⚠️  Max depth reached for ${currentPath}`);
    return [];
  }
  
  console.log(`${'  '.repeat(depth)}🔍 Exploring: ${currentPath || 'root'}`);
  
  const contents = await getDirectoryContents(currentPath);
  const audioFiles = [];
  
  for (const item of contents) {
    if (item.type === 'file') {
      // Check if it's an audio file
      const ext = path.extname(item.name).toLowerCase();
      if (['.wav', '.mp3', '.flac', '.aiff', '.ogg'].includes(ext)) {
        const fullPath = currentPath ? `${currentPath}/${item.name}` : item.name;
        audioFiles.push({
          name: item.name,
          path: fullPath,
          size: item.size,
          downloadUrl: item.download_url
        });
        console.log(`${'  '.repeat(depth + 1)}🎵 Found: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`);
      }
    } else if (item.type === 'dir') {
      // Recursively explore subdirectories
      const subPath = currentPath ? `${currentPath}/${item.name}` : item.name;
      const subFiles = await discoverAudioFiles(subPath, depth + 1);
      audioFiles.push(...subFiles);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return audioFiles;
}

/**
 * Create category mapping from file paths
 */
function createCategoryMapping(audioFiles) {
  const categories = {};
  
  for (const file of audioFiles) {
    // Extract category from path structure
    const pathParts = file.path.split('/');
    
    // Create category name from path
    let categoryName = '';
    
    if (pathParts.length >= 2) {
      // Use the instrument/category structure
      const mainCategory = pathParts[0]; // e.g., "Membranophones"
      const subCategory = pathParts[1]; // e.g., "Struck Membranophones"
      
      if (pathParts.length >= 3) {
        const instrument = pathParts[2]; // e.g., "Bass Drum 1"
        categoryName = instrument.toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      } else {
        categoryName = subCategory.toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      }
    } else {
      // Fallback to filename-based category
      categoryName = path.basename(file.name, path.extname(file.name))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
    
    // Ensure category name is valid
    if (!categoryName || categoryName === '_') {
      categoryName = 'misc';
    }
    
    if (!categories[categoryName]) {
      categories[categoryName] = [];
    }
    
    categories[categoryName].push(`samples/vcsl/${file.path}`);
  }
  
  return categories;
}

/**
 * Download a file from URL to local path
 */
async function downloadFile(url, localPath, fileName) {
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
      
      // Download file using direct HTTPS request
      const fileReq = https.request(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        
        const fileStream = fs.createWriteStream(localPath);
        res.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        
        fileStream.on('error', reject);
      });
      
      fileReq.on('error', reject);
      fileReq.setTimeout(60000, () => {
        fileReq.destroy();
        reject(new Error('Download timeout'));
      });
      fileReq.end();
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Download all discovered audio files
 */
async function downloadAllFiles(audioFiles, limit = null) {
  const filesToDownload = limit ? audioFiles.slice(0, limit) : audioFiles;
  
  console.log(`\n📥 Downloading ${filesToDownload.length} audio files...\n`);
  
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  
  for (let i = 0; i < filesToDownload.length; i++) {
    const file = filesToDownload[i];
    const localPath = path.join(SAMPLES_DIR, file.path);
    
    process.stdout.write(`[${i + 1}/${filesToDownload.length}] ${file.name}... `);
    
    try {
      // Check if file already exists
      if (fs.existsSync(localPath)) {
        console.log('⏭️  EXISTS');
        skipped++;
        continue;
      }
      
      await downloadFile(file.downloadUrl, localPath, file.name);
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
  
  return { downloaded, failed, skipped, total: filesToDownload.length };
}

/**
 * Main discovery and download function
 */
async function discoverAndDownload(downloadFiles = false, limit = null) {
  console.log('🔍 Discovering VCSL repository structure...\n');
  
  const audioFiles = await discoverAudioFiles();
  
  console.log(`\n📊 Discovery Results:`);
  console.log(`   🎵 Total audio files found: ${audioFiles.length}`);
  
  // Calculate total size
  const totalSize = audioFiles.reduce((sum, file) => sum + file.size, 0);
  console.log(`   📄 Total size: ${(totalSize / (1024 * 1024)).toFixed(1)} MB`);
  
  // Show file type breakdown
  const extensions = {};
  audioFiles.forEach(file => {
    const ext = path.extname(file.name).toLowerCase();
    extensions[ext] = (extensions[ext] || 0) + 1;
  });
  
  console.log(`   📁 File types:`);
  Object.entries(extensions).forEach(([ext, count]) => {
    console.log(`      ${ext}: ${count} files`);
  });
  
  // Create category mapping
  const categories = createCategoryMapping(audioFiles);
  console.log(`   🏷️  Categories: ${Object.keys(categories).length}`);
  
  // Show some example categories
  const categoryNames = Object.keys(categories).slice(0, 10);
  console.log(`   📝 Examples: ${categoryNames.join(', ')}${Object.keys(categories).length > 10 ? '...' : ''}`);
  
  // Save category mapping to JSON
  fs.writeFileSync(VCSL_JSON_PATH, JSON.stringify(categories, null, 2));
  console.log(`\n✅ Created vcsl.json with ${Object.keys(categories).length} categories`);
  
  if (downloadFiles) {
    const result = await downloadAllFiles(audioFiles, limit);
    return { audioFiles, categories, downloadResult: result };
  }
  
  return { audioFiles, categories };
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2] || 'help';
  const arg = process.argv[3];
  
  switch (command) {
    case 'discover':
      await discoverAndDownload(false);
      break;
      
    case 'download':
      const limit = arg ? parseInt(arg) : null;
      await discoverAndDownload(true, limit);
      break;
      
    case 'help':
    default:
      console.log('🎵 VCSL Dynamic Discovery Script\n');
      console.log('Available commands:');
      console.log('  discover         - Discover repository structure and create vcsl.json');
      console.log('  download [limit] - Discover and download all files (optional limit)');
      console.log('  help             - Show this help message');
      console.log();
      console.log('Examples:');
      console.log('  node scripts/discover-vcsl-samples.js discover    # Just discover structure');
      console.log('  node scripts/discover-vcsl-samples.js download    # Discover and download all');
      console.log('  node scripts/discover-vcsl-samples.js download 50 # Download first 50 files');
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
  discoverAudioFiles,
  createCategoryMapping,
  discoverAndDownload
};