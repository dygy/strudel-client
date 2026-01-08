import { useState, useEffect } from 'react';
import { useTranslation } from '@src/i18n';
import { Checkbox } from './SettingsTab';

// Import cache functions from @strudel/webaudio (which re-exports superdough)
let cacheAPI: any = null;

// Initialize cache API
const initializeCacheAPI = async () => {
  try {
    const webaudioModule = await import('@strudel/webaudio') as any;
    if (webaudioModule.configureSampleCache) {
      cacheAPI = {
        configure: webaudioModule.configureSampleCache,
        getConfig: webaudioModule.getCacheConfig,
        getStats: webaudioModule.getCacheStats,
        addListener: webaudioModule.addCacheListener,
        removeListener: webaudioModule.removeCacheListener,
        clearCache: webaudioModule.clearCache,
        preloadTrackSamples: webaudioModule.preloadTrackSamples,
      };
      return true;
    }
  } catch (error) {
    console.warn('Sample cache not available:', error);
  }
  return false;
};

interface CacheStats {
  hitCount: number;
  missCount: number;
  preloadCount: number;
  evictionCount: number;
  currentSizeMB: number;
  maxSizeMB: number;
  hitRate: number;
}

interface CacheConfig {
  maxSizeMB: number;
  preloadDelay: number;
  enabled: boolean;
  preloadEnabled: boolean;
}

export function SampleCacheSettings() {
  const { t } = useTranslation('settings');
  const [config, setConfig] = useState<CacheConfig>({
    maxSizeMB: 100,
    preloadDelay: 100,
    enabled: true,
    preloadEnabled: true,
  });
  const [stats, setStats] = useState<CacheStats>({
    hitCount: 0,
    missCount: 0,
    preloadCount: 0,
    evictionCount: 0,
    currentSizeMB: 0,
    maxSizeMB: 100,
    hitRate: 0,
  });
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    const setupCacheAPI = async () => {
      const initialized = await initializeCacheAPI();
      if (!initialized) return;
      
      setIsSupported(true);
      
      // Load initial config and stats
      try {
        const initialConfig = cacheAPI.getConfig();
        const initialStats = cacheAPI.getStats();
        setConfig(initialConfig);
        setStats(initialStats);
      } catch (error) {
        console.warn('Failed to load cache config/stats:', error);
      }

      // Listen for cache events
      const handleCacheEvent = (event: string, data: any) => {
        if (event === 'config') {
          setConfig(data);
        }
        // Update stats periodically
        try {
          const newStats = cacheAPI.getStats();
          setStats(newStats);
        } catch (error) {
          console.warn('Failed to update cache stats:', error);
        }
      };

      cacheAPI.addListener(handleCacheEvent);

      // Update stats every 5 seconds
      const statsInterval = setInterval(() => {
        try {
          const newStats = cacheAPI.getStats();
          setStats(newStats);
        } catch (error) {
          console.warn('Failed to update cache stats:', error);
        }
      }, 5000);

      return () => {
        cacheAPI.removeListener(handleCacheEvent);
        clearInterval(statsInterval);
      };
    };

    setupCacheAPI();
  }, []);

  const handleConfigChange = (key: keyof CacheConfig, value: any) => {
    if (!cacheAPI) return;
    
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    
    try {
      cacheAPI.configure(newConfig);
    } catch (error) {
      console.warn('Failed to update cache config:', error);
    }
  };

  const handleClearCache = () => {
    if (!cacheAPI) return;
    
    try {
      cacheAPI.clearCache();
      setStats({
        hitCount: 0,
        missCount: 0,
        preloadCount: 0,
        evictionCount: 0,
        currentSizeMB: 0,
        maxSizeMB: config.maxSizeMB,
        hitRate: 0,
      });
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  };

  if (!isSupported) {
    return (
      <div className="p-4 text-foreground">
        <p>{t('sampleCache.notSupported')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <h3 className="text-lg font-medium mb-4 text-foreground">{t('sampleCache.title')}</h3>
        <p className="text-sm text-foreground/70 mb-4">
          {t('sampleCache.description')}
        </p>
      </div>

      {/* Cache Status */}
      <div className="bg-background/50 border border-border p-4 rounded-lg">
        <h4 className="font-medium mb-3 text-foreground">{t('sampleCache.status')}</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-foreground/70">{t('sampleCache.cacheSize')}:</span>
            <span className="ml-2 font-mono text-foreground">
              {stats.currentSizeMB.toFixed(1)} / {stats.maxSizeMB} MB
            </span>
          </div>
          <div>
            <span className="text-foreground/70">{t('sampleCache.hitRate')}:</span>
            <span className="ml-2 font-mono text-foreground">{stats.hitRate}%</span>
          </div>
          <div>
            <span className="text-foreground/70">{t('sampleCache.hits')}:</span>
            <span className="ml-2 font-mono text-foreground">{stats.hitCount}</span>
          </div>
          <div>
            <span className="text-foreground/70">{t('sampleCache.misses')}:</span>
            <span className="ml-2 font-mono text-foreground">{stats.missCount}</span>
          </div>
          <div>
            <span className="text-foreground/70">{t('sampleCache.preloaded')}:</span>
            <span className="ml-2 font-mono text-foreground">{stats.preloadCount}</span>
          </div>
          <div>
            <span className="text-foreground/70">{t('sampleCache.evicted')}:</span>
            <span className="ml-2 font-mono text-foreground">{stats.evictionCount}</span>
          </div>
        </div>
        
        {/* Cache usage bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-foreground/70 mb-1">
            <span>{t('sampleCache.usage')}</span>
            <span>{((stats.currentSizeMB / stats.maxSizeMB) * 100).toFixed(1)}%</span>
          </div>
          <div className="w-full bg-background rounded-full h-2 border border-border">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min((stats.currentSizeMB / stats.maxSizeMB) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Cache Settings */}
      <div className="space-y-4">
        <h4 className="font-medium text-foreground">{t('sampleCache.configuration')}</h4>
        
        {/* Enable Cache */}
        <Checkbox
          label={t('sampleCache.enabled')}
          value={config.enabled}
          onChange={(e) => handleConfigChange('enabled', e.target.checked)}
        />

        {/* Enable Preloading */}
        <Checkbox
          label={t('sampleCache.preloadEnabled')}
          value={config.preloadEnabled}
          disabled={!config.enabled}
          onChange={(e) => handleConfigChange('preloadEnabled', e.target.checked)}
        />

        {/* Max Cache Size */}
        <div>
          <label className="block text-sm font-medium mb-2 text-foreground">
            {t('sampleCache.maxSize')} ({config.maxSizeMB} MB)
          </label>
          <input
            type="range"
            min="10"
            max="500"
            step="10"
            value={config.maxSizeMB}
            disabled={!config.enabled}
            onChange={(e) => handleConfigChange('maxSizeMB', parseInt(e.target.value))}
            className="w-full accent-blue-500 disabled:opacity-50"
          />
          <div className="flex justify-between text-xs text-foreground/70 mt-1">
            <span>10 MB</span>
            <span>500 MB</span>
          </div>
        </div>

        {/* Preload Delay */}
        <div>
          <label className="block text-sm font-medium mb-2 text-foreground">
            {t('sampleCache.preloadDelay')} ({config.preloadDelay} ms)
          </label>
          <input
            type="range"
            min="50"
            max="1000"
            step="50"
            value={config.preloadDelay}
            disabled={!config.enabled || !config.preloadEnabled}
            onChange={(e) => handleConfigChange('preloadDelay', parseInt(e.target.value))}
            className="w-full accent-blue-500 disabled:opacity-50"
          />
          <div className="flex justify-between text-xs text-foreground/70 mt-1">
            <span>50 ms</span>
            <span>1000 ms</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="pt-4 border-t border-border">
        <button
          onClick={handleClearCache}
          disabled={!config.enabled}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
        >
          {t('sampleCache.clearCache')}
        </button>
      </div>
    </div>
  );
}