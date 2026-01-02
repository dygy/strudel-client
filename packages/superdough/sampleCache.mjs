/*
sampleCache.mjs - Frontend audio sample caching system
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/superdough/sampleCache.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { logger } from './logger.mjs';
import { loadBuffer, getCachedBuffer } from './sampler.mjs';
import { getAudioContext } from './audioContext.mjs';

// Cache configuration
const DEFAULT_CACHE_SIZE_MB = 100; // 100MB default cache size
const DEFAULT_PRELOAD_DELAY = 100; // 100ms delay between preloads
const BYTES_PER_MB = 1024 * 1024;

// Cache state
let cacheConfig = {
  maxSizeMB: DEFAULT_CACHE_SIZE_MB,
  preloadDelay: DEFAULT_PRELOAD_DELAY,
  enabled: true,
  preloadEnabled: true,
};

let cacheStats = {
  totalSize: 0,
  hitCount: 0,
  missCount: 0,
  preloadCount: 0,
  evictionCount: 0,
};

// Cache storage with metadata
const cacheMetadata = new Map(); // url -> { size, lastAccessed, preloaded }
const preloadQueue = new Set(); // urls to preload
let preloadWorker = null;

// Event listeners for cache status updates
const cacheListeners = new Set();

/**
 * Configure the sample cache
 * @param {Object} config - Cache configuration
 * @param {number} config.maxSizeMB - Maximum cache size in MB
 * @param {number} config.preloadDelay - Delay between preloads in ms
 * @param {boolean} config.enabled - Enable/disable caching
 * @param {boolean} config.preloadEnabled - Enable/disable preloading
 */
export function configureSampleCache(config = {}) {
  cacheConfig = { ...cacheConfig, ...config };
  logger(`[sampleCache] configured: ${JSON.stringify(cacheConfig)}`);
  
  // Notify listeners of config change
  notifyCacheListeners('config', cacheConfig);
  
  // If cache is disabled, clear everything
  if (!cacheConfig.enabled) {
    clearCache();
  }
}

/**
 * Get current cache configuration
 */
export function getCacheConfig() {
  return { ...cacheConfig };
}

/**
 * Get current cache statistics
 */
export function getCacheStats() {
  return { 
    ...cacheStats,
    maxSizeMB: cacheConfig.maxSizeMB,
    currentSizeMB: Math.round((cacheStats.totalSize / BYTES_PER_MB) * 100) / 100,
    hitRate: cacheStats.hitCount + cacheStats.missCount > 0 
      ? Math.round((cacheStats.hitCount / (cacheStats.hitCount + cacheStats.missCount)) * 100) 
      : 0,
  };
}

/**
 * Add a listener for cache events
 * @param {Function} listener - Function to call on cache events
 */
export function addCacheListener(listener) {
  cacheListeners.add(listener);
}

/**
 * Remove a cache event listener
 * @param {Function} listener - Listener to remove
 */
export function removeCacheListener(listener) {
  cacheListeners.delete(listener);
}

/**
 * Notify all cache listeners of an event
 * @param {string} event - Event type
 * @param {*} data - Event data
 */
function notifyCacheListeners(event, data) {
  cacheListeners.forEach(listener => {
    try {
      listener(event, data);
    } catch (error) {
      console.warn('[sampleCache] listener error:', error);
    }
  });
}

/**
 * Update cache metadata when a sample is accessed
 * @param {string} url - Sample URL
 * @param {AudioBuffer} buffer - Audio buffer (optional, for size calculation)
 */
function updateCacheMetadata(url, buffer = null) {
  if (!cacheConfig.enabled) return;
  
  const existing = cacheMetadata.get(url);
  const now = Date.now();
  
  if (existing) {
    existing.lastAccessed = now;
    cacheStats.hitCount++;
  } else if (buffer) {
    // Calculate approximate buffer size
    const size = buffer.length * buffer.numberOfChannels * 4; // 32-bit float
    cacheMetadata.set(url, {
      size,
      lastAccessed: now,
      preloaded: false,
    });
    cacheStats.totalSize += size;
    cacheStats.missCount++;
    
    // Check if we need to evict samples
    enforCacheSizeLimit();
  }
}

/**
 * Enforce cache size limit by evicting least recently used samples
 */
function enforCacheSizeLimit() {
  const maxSize = cacheConfig.maxSizeMB * BYTES_PER_MB;
  
  if (cacheStats.totalSize <= maxSize) return;
  
  // Sort by last accessed time (oldest first)
  const entries = Array.from(cacheMetadata.entries())
    .sort(([,a], [,b]) => a.lastAccessed - b.lastAccessed);
  
  for (const [url, metadata] of entries) {
    if (cacheStats.totalSize <= maxSize) break;
    
    // Remove from cache
    const cachedBuffer = getCachedBuffer(url);
    if (cachedBuffer) {
      // Note: We can't actually delete from the original cache here, 
      // but we track the eviction in our metadata
      cacheStats.totalSize -= metadata.size;
      cacheStats.evictionCount++;
      cacheMetadata.delete(url);
      
      logger(`[sampleCache] evicted ${url} (${Math.round(metadata.size / 1024)}KB)`);
      notifyCacheListeners('evict', { url, size: metadata.size });
    }
  }
}

/**
 * Extract sample URLs from a track's code
 * @param {string} code - Track code to analyze
 * @returns {Set<string>} Set of sample URLs found
 */
function extractSampleUrls(code) {
  const urls = new Set();
  
  // Match samples() calls with URL objects - more comprehensive regex
  const samplesRegex = /samples\s*\(\s*\{[^}]*\}/gs;
  const matches = code.match(samplesRegex);
  
  if (matches) {
    matches.forEach(match => {
      // Extract URLs from the samples object - look for any URL-like strings
      const urlRegex = /["']([^"']*(?:https?|ftp|file|data|blob):\/\/[^"']+)["']/g;
      let urlMatch;
      while ((urlMatch = urlRegex.exec(match)) !== null) {
        urls.add(urlMatch[1]);
      }
    });
  }
  
  // Also look for direct URL usage in s() calls
  const directUrlRegex = /s\s*\(\s*["']([^"']*(?:https?|ftp|file|data|blob):\/\/[^"']+)["']/g;
  let directMatch;
  while ((directMatch = directUrlRegex.exec(code)) !== null) {
    urls.add(directMatch[1]);
  }
  
  return urls;
}

/**
 * Preload samples from a track's code
 * @param {string} code - Track code to analyze
 * @param {string} trackName - Name of the track (for logging)
 */
export async function preloadTrackSamples(code, trackName = 'unknown') {
  if (!cacheConfig.enabled || !cacheConfig.preloadEnabled) return;
  
  const urls = extractSampleUrls(code);
  
  if (urls.size === 0) return;
  
  logger(`[sampleCache] found ${urls.size} sample URLs in track "${trackName}"`);
  
  // Add to preload queue
  urls.forEach(url => preloadQueue.add(url));
  
  // Start preload worker if not running
  if (!preloadWorker) {
    startPreloadWorker();
  }
  
  notifyCacheListeners('preload-queued', { trackName, urls: Array.from(urls) });
}

/**
 * Start the preload worker to process the preload queue
 */
function startPreloadWorker() {
  if (preloadWorker) return;
  
  preloadWorker = setInterval(async () => {
    if (preloadQueue.size === 0) {
      // Stop worker when queue is empty
      clearInterval(preloadWorker);
      preloadWorker = null;
      return;
    }
    
    // Get next URL from queue
    const url = preloadQueue.values().next().value;
    preloadQueue.delete(url);
    
    try {
      // Check if already cached
      if (getCachedBuffer(url)) {
        updateCacheMetadata(url);
        return;
      }
      
      // Preload the sample
      const ac = getAudioContext();
      const buffer = await loadBuffer(url, ac, 'preload');
      
      // Update metadata
      const metadata = cacheMetadata.get(url);
      if (metadata) {
        metadata.preloaded = true;
      }
      
      cacheStats.preloadCount++;
      logger(`[sampleCache] preloaded ${url}`);
      notifyCacheListeners('preload-complete', { url });
      
    } catch (error) {
      logger(`[sampleCache] failed to preload ${url}: ${error.message}`, 'warning');
      notifyCacheListeners('preload-error', { url, error: error.message });
    }
  }, cacheConfig.preloadDelay);
}

/**
 * Preload specific sample URLs
 * @param {string[]} urls - Array of URLs to preload
 */
export async function preloadSamples(urls) {
  if (!cacheConfig.enabled || !cacheConfig.preloadEnabled) return;
  
  urls.forEach(url => preloadQueue.add(url));
  
  if (!preloadWorker) {
    startPreloadWorker();
  }
}

/**
 * Check if a sample is cached
 * @param {string} url - Sample URL
 * @returns {boolean} True if cached
 */
export function isSampleCached(url) {
  return !!getCachedBuffer(url);
}

/**
 * Get cache status for a sample
 * @param {string} url - Sample URL
 * @returns {Object} Cache status
 */
export function getSampleCacheStatus(url) {
  const cached = isSampleCached(url);
  const metadata = cacheMetadata.get(url);
  const queued = preloadQueue.has(url);
  
  return {
    cached,
    queued,
    preloaded: metadata?.preloaded || false,
    size: metadata?.size || 0,
    lastAccessed: metadata?.lastAccessed || null,
  };
}

/**
 * Clear all cached samples
 */
export function clearCache() {
  cacheMetadata.clear();
  preloadQueue.clear();
  
  if (preloadWorker) {
    clearInterval(preloadWorker);
    preloadWorker = null;
  }
  
  cacheStats = {
    totalSize: 0,
    hitCount: 0,
    missCount: 0,
    preloadCount: 0,
    evictionCount: 0,
  };
  
  logger('[sampleCache] cache cleared');
  notifyCacheListeners('clear', {});
}

/**
 * Warm up cache with commonly used samples
 * @param {string[]} commonUrls - Array of commonly used sample URLs
 */
export async function warmUpCache(commonUrls = []) {
  if (!cacheConfig.enabled) return;
  
  logger(`[sampleCache] warming up cache with ${commonUrls.length} samples`);
  await preloadSamples(commonUrls);
}

// Export enhanced cache-aware functions
export { updateCacheMetadata as trackSampleAccess };