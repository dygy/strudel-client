import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@src/i18n';
import { getAudioDevices } from '@strudel/webaudio';
import { EqualizerUI } from './EqualizerUI';

const PREVIEW_DEVICE_KEY = 'strudel-preview-device';

interface MixerSettingsProps {
  mixer: any; // PreviewEngine instance
  isDisabled?: boolean;
  smoothTransitionManager?: any; // SmoothTransitionManager instance
}

export function MixerSettings({ mixer, isDisabled = false, smoothTransitionManager }: MixerSettingsProps) {
  const { t } = useTranslation('settings');
  const [devices, setDevices] = useState<Map<string, string>>(new Map());
  const [previewDeviceId, setPreviewDeviceId] = useState<string>('');
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  
  // Smooth transition settings
  const [smoothTransitionsEnabled, setSmoothTransitionsEnabled] = useState(false);
  const [transitionDuration, setTransitionDuration] = useState(2.0);

  // Load smooth transition settings on mount
  useEffect(() => {
    if (smoothTransitionManager) {
      const settings = smoothTransitionManager.getSettings();
      setSmoothTransitionsEnabled(settings.enabled);
      setTransitionDuration(settings.duration);
    }
  }, [smoothTransitionManager]);

  const loadDevices = useCallback(async () => {
    try {
      const devMap = await getAudioDevices();
      setDevices(devMap);
      setDevicesLoaded(true);

      // If selected preview device disappeared, reset
      if (previewDeviceId) {
        const ids = new Set(devMap.values());
        if (!ids.has(previewDeviceId)) {
          console.log('[MixerSettings] Preview device removed, resetting to default');
          setPreviewDeviceId('');
          try { localStorage.removeItem(PREVIEW_DEVICE_KEY); } catch (e) { /* ok */ }
          mixer?.setDevice?.('').catch(() => {});
        }
      }
    } catch (err) {
      console.error('[MixerSettings] Failed to load audio devices:', err);
    }
  }, [mixer, previewDeviceId]);

  // Load devices on click (lazy, like AudioDeviceSelector) + listen for changes
  useEffect(() => {
    const handleDeviceChange = () => {
      console.log('[MixerSettings] Device change detected, refreshing');
      loadDevices();
    };
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [loadDevices]);

  // Restore saved device on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PREVIEW_DEVICE_KEY);
      if (stored) setPreviewDeviceId(stored);
    } catch (e) { /* ok */ }
  }, []);

  const handleDropdownClick = () => {
    if (!devicesLoaded) loadDevices();
  };

  const handlePreviewDeviceChange = async (deviceId: string) => {
    setPreviewDeviceId(deviceId);
    try {
      if (deviceId) {
        localStorage.setItem(PREVIEW_DEVICE_KEY, deviceId);
      } else {
        localStorage.removeItem(PREVIEW_DEVICE_KEY);
      }
    } catch (e) { /* ok */ }

    if (mixer?.setDevice) {
      try {
        await mixer.setDevice(deviceId || null);
      } catch (err) {
        console.error('[MixerSettings] Failed to set preview device:', err);
      }
    }
  };

  const handleSmoothTransitionsToggle = (enabled: boolean) => {
    setSmoothTransitionsEnabled(enabled);
    if (smoothTransitionManager) {
      smoothTransitionManager.updateSettings({ enabled });
    }
  };

  const handleTransitionDurationChange = (duration: number) => {
    setTransitionDuration(duration);
    if (smoothTransitionManager) {
      smoothTransitionManager.updateSettings({ duration });
    }
  };

  if (!mixer) {
    return (
      <div className="p-4 bg-lineHighlight rounded-lg">
        <div className="flex items-center gap-2 text-foreground opacity-70">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm">{t('mixerNotAvailable')}</span>
        </div>
      </div>
    );
  }

  // Build options from the Map (label -> deviceId)
  const deviceOptions: { label: string; value: string }[] = [];
  devices.forEach((deviceId, label) => {
    deviceOptions.push({ label, value: deviceId });
  });

  return (
    <div className="space-y-4">
      {mixer.isInitialized && (
        <div className="p-3 bg-background border border-lineHighlight rounded-lg">
          <div className="flex items-center gap-2 text-foreground">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">{t('mixerPreviewEngineActive')}</span>
          </div>
        </div>
      )}

      {/* Smooth Track Transitions */}
      {smoothTransitionManager && (
        <div className="p-4 bg-background border border-lineHighlight rounded-lg space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-foreground">
                {t('smoothTransitions')}
              </label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={smoothTransitionsEnabled}
                  onChange={(e) => handleSmoothTransitionsToggle(e.target.checked)}
                  disabled={isDisabled}
                />
                <div className="w-11 h-6 bg-lineHighlight peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-foreground rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-foreground peer-checked:after:bg-background peer-checked:after:border-background"></div>
              </label>
            </div>
            <p className="text-xs text-foreground opacity-70">
              {t('smoothTransitionsDescription')}
            </p>
          </div>

          {smoothTransitionsEnabled && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-foreground">
                  {t('transitionDuration')}
                </label>
                <span className="text-sm text-foreground opacity-70">
                  {transitionDuration.toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={transitionDuration}
                onChange={(e) => handleTransitionDurationChange(parseFloat(e.target.value))}
                disabled={isDisabled}
                className="w-full h-2 bg-lineHighlight rounded-lg appearance-none cursor-pointer accent-foreground"
              />
              <div className="flex justify-between text-xs text-foreground opacity-50 mt-1">
                <span>0.5s</span>
                <span>10s</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          {t('mixerPreviewDevice')}
        </label>
        <select
          className="w-full px-4 py-3 bg-background border border-lineHighlight rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-foreground focus:border-transparent transition-all duration-200 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          value={previewDeviceId}
          onClick={handleDropdownClick}
          onChange={(e) => handlePreviewDeviceChange(e.target.value)}
          disabled={isDisabled}
        >
          <option value="">{t('mixerDefaultDevice')}</option>
          {deviceOptions.map(({ label, value }) => (
            <option key={value || label} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Equalizer UI */}
      <div className="pt-4 border-t border-lineHighlight">
        <EqualizerUI mixer={null} previewEngine={mixer} />
      </div>
    </div>
  );
}
