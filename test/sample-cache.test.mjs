import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import the cache system directly
const {
  configureSampleCache,
  getCacheConfig,
  getCacheStats,
  clearCache,
  addCacheListener,
  removeCacheListener,
} = await import('../packages/superdough/sampleCache.mjs');

describe('Sample Cache System', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearCache();
    
    // Reset configuration
    configureSampleCache({
      maxSizeMB: 100,
      preloadDelay: 50, // Faster for tests
      enabled: true,
      preloadEnabled: true,
    });
  });

  afterEach(() => {
    clearCache();
  });

  describe('Configuration', () => {
    it('should configure cache settings', () => {
      const config = {
        maxSizeMB: 50,
        preloadDelay: 200,
        enabled: false,
        preloadEnabled: false,
      };
      
      configureSampleCache(config);
      
      const currentConfig = getCacheConfig();
      expect(currentConfig).toEqual(config);
    });

    it('should get default configuration', () => {
      const config = getCacheConfig();
      expect(config).toEqual({
        maxSizeMB: 100,
        preloadDelay: 50,
        enabled: true,
        preloadEnabled: true,
      });
    });

    it('should clear cache when disabled', () => {
      configureSampleCache({ enabled: false });
      
      const newStats = getCacheStats();
      expect(newStats.totalSize).toBe(0);
      expect(newStats.hitCount).toBe(0);
      expect(newStats.missCount).toBe(0);
    });
  });

  describe('Cache Statistics', () => {
    it('should return initial cache statistics', () => {
      const stats = getCacheStats();
      expect(stats).toEqual({
        totalSize: 0,
        hitCount: 0,
        missCount: 0,
        preloadCount: 0,
        evictionCount: 0,
        maxSizeMB: 100,
        currentSizeMB: 0,
        hitRate: 0,
      });
    });

    it('should calculate hit rate correctly', () => {
      const stats = getCacheStats();
      expect(typeof stats.hitRate).toBe('number');
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(100);
    });
  });

  describe('Event Listeners', () => {
    it('should add and remove cache listeners', () => {
      const listener = vi.fn();
      
      addCacheListener(listener);
      
      // Trigger a config change to test listener
      configureSampleCache({ maxSizeMB: 200 });
      
      expect(listener).toHaveBeenCalledWith('config', expect.any(Object));
      
      removeCacheListener(listener);
      
      // Should not be called after removal
      listener.mockClear();
      configureSampleCache({ maxSizeMB: 300 });
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      
      addCacheListener(badListener);
      
      // Should not throw when listener errors
      expect(() => {
        configureSampleCache({ maxSizeMB: 150 });
      }).not.toThrow();
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      clearCache();
      
      const stats = getCacheStats();
      expect(stats.totalSize).toBe(0);
      expect(stats.hitCount).toBe(0);
      expect(stats.missCount).toBe(0);
      expect(stats.preloadCount).toBe(0);
      expect(stats.evictionCount).toBe(0);
    });

    it('should handle configuration changes', () => {
      // Test multiple configuration changes
      configureSampleCache({ maxSizeMB: 50 });
      expect(getCacheConfig().maxSizeMB).toBe(50);
      
      configureSampleCache({ preloadDelay: 1000 });
      expect(getCacheConfig().preloadDelay).toBe(1000);
      
      configureSampleCache({ enabled: false });
      expect(getCacheConfig().enabled).toBe(false);
    });

    it('should maintain cache state across configuration changes', () => {
      // Change config but keep cache enabled
      configureSampleCache({ maxSizeMB: 200 });
      
      const stats = getCacheStats();
      expect(stats.maxSizeMB).toBe(200);
      expect(stats.totalSize).toBe(0); // Should still be 0 since no samples loaded
    });
  });

  describe('URL Extraction (Unit Tests)', () => {
    // Since we can't easily test the full preloading without mocking the entire audio system,
    // let's test the URL extraction logic by accessing it indirectly
    
    it('should handle empty code', async () => {
      // This should not throw and should handle empty input gracefully
      const { preloadTrackSamples } = await import('../packages/superdough/sampleCache.mjs');
      
      expect(() => preloadTrackSamples('', 'empty-track')).not.toThrow();
      expect(() => preloadTrackSamples('   ', 'whitespace-track')).not.toThrow();
    });

    it('should handle code without URLs', async () => {
      const { preloadTrackSamples } = await import('../packages/superdough/sampleCache.mjs');
      
      const trackCode = `
        s("bd hh sd hh");
        note("c d e f");
        sound("piano");
      `;
      
      expect(() => preloadTrackSamples(trackCode, 'no-urls-track')).not.toThrow();
    });

    it('should handle malformed code gracefully', async () => {
      const { preloadTrackSamples } = await import('../packages/superdough/sampleCache.mjs');
      
      const malformedCode = `
        samples({
          incomplete: "https://example.com/sample.wav
        s("test");
        invalid syntax here
      `;
      
      expect(() => preloadTrackSamples(malformedCode, 'malformed-track')).not.toThrow();
    });
  });

  describe('Cache Disabled Scenarios', () => {
    it('should not process anything when cache is disabled', async () => {
      configureSampleCache({ enabled: false });
      
      const { preloadTrackSamples, preloadSamples } = await import('../packages/superdough/sampleCache.mjs');
      
      // These should complete quickly and not attempt any processing
      await preloadTrackSamples('s("https://example.com/test.wav")', 'test');
      await preloadSamples(['https://example.com/test.wav']);
      
      const stats = getCacheStats();
      expect(stats.preloadCount).toBe(0);
    });

    it('should not preload when preloading is disabled', async () => {
      configureSampleCache({ preloadEnabled: false });
      
      const { preloadTrackSamples, preloadSamples } = await import('../packages/superdough/sampleCache.mjs');
      
      await preloadTrackSamples('s("https://example.com/test.wav")', 'test');
      await preloadSamples(['https://example.com/test.wav']);
      
      const stats = getCacheStats();
      expect(stats.preloadCount).toBe(0);
    });
  });

  describe('Integration with Settings', () => {
    it('should work with various cache size limits', () => {
      const sizes = [10, 50, 100, 500];
      
      sizes.forEach(size => {
        configureSampleCache({ maxSizeMB: size });
        const config = getCacheConfig();
        expect(config.maxSizeMB).toBe(size);
        
        const stats = getCacheStats();
        expect(stats.maxSizeMB).toBe(size);
      });
    });

    it('should work with various preload delays', () => {
      const delays = [50, 100, 500, 1000];
      
      delays.forEach(delay => {
        configureSampleCache({ preloadDelay: delay });
        const config = getCacheConfig();
        expect(config.preloadDelay).toBe(delay);
      });
    });
  });
});