import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@src/i18n';
import { getAudioDevices } from '@strudel/webaudio';

const PREVIEW_DEVICE_KEY = 'strudel-preview-device';

interface MixerSettingsProps {
  mixer: any; // PreviewEngine instance
  isDisabled?: boolean;
}

export function MixerSettings({ mixer, isDisabled = false }: MixerSettingsProps) {
  const { t } = useTranslation('settings');
  const [devices, setDevices] = useState<Map<string, string>>(new Map());
  const [previewDeviceId, setPreviewDeviceId] = useState<string>('');
  const [devicesLoaded, setDevicesLoaded] = useState(false);

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
    </div>
  );
}
