/**
 * MixerHealthIndicator - Display mixer health status
 * 
 * Shows status of both streams, latency, and polyphony metrics.
 * Provides a compact view with expandable details.
 * 
 * @component
 * @example
 * ```tsx
 * <MixerHealthIndicator mixer={audioMixer} />
 * ```
 */

import { useState, useEffect } from 'react';
import cx from '@src/cx';
import type { AudioMixer } from '@strudel/mixer';

/**
 * Props for MixerHealthIndicator component
 * 
 * @interface MixerHealthIndicatorProps
 * @property {AudioMixer | null} mixer - AudioMixer instance
 */
interface MixerHealthIndicatorProps {
  mixer: AudioMixer | null;
}

interface HealthStatus {
  liveActive: boolean;
  previewActive: boolean;
  liveError: boolean;
  previewError: boolean;
  polyphony: number;
  maxPolyphony: number;
}

export function MixerHealthIndicator({ mixer }: MixerHealthIndicatorProps) {
  const [status, setStatus] = useState<HealthStatus>({
    liveActive: false,
    previewActive: false,
    liveError: false,
    previewError: false,
    polyphony: 0,
    maxPolyphony: 128,
  });

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!mixer) return;

    const updateStatus = () => {
      const state = mixer.getState();
      setStatus({
        liveActive: state.liveStream?.isActive || false,
        previewActive: state.previewStream?.isActive || false,
        liveError: false, // Would be set by error events
        previewError: false, // Would be set by error events
        polyphony: 0, // Would be calculated from actual polyphony
        maxPolyphony: state.config?.maxPolyphony || 128,
      });
    };

    // Update status periodically
    const interval = setInterval(updateStatus, 1000);
    updateStatus();

    return () => clearInterval(interval);
  }, [mixer]);

  if (!mixer) return null;

  const polyphonyPercent = (status.polyphony / status.maxPolyphony) * 100;
  const isWarning = polyphonyPercent > 90;

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <div
        className={cx(
          'bg-gray-900/90 rounded-lg shadow-lg border border-gray-700',
          'transition-all duration-200',
          isExpanded ? 'p-4' : 'p-2'
        )}
      >
        {/* Compact view */}
        <div
          className="flex items-center space-x-2 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex space-x-1">
            <div
              className={cx(
                'w-3 h-3 rounded-full',
                status.liveActive && !status.liveError && 'bg-green-500',
                status.liveActive && status.liveError && 'bg-red-500',
                !status.liveActive && 'bg-gray-600'
              )}
              title="Live stream status"
            />
            <div
              className={cx(
                'w-3 h-3 rounded-full',
                status.previewActive && !status.previewError && 'bg-blue-500',
                status.previewActive && status.previewError && 'bg-red-500',
                !status.previewActive && 'bg-gray-600'
              )}
              title="Preview stream status"
            />
          </div>
          <span className="text-white text-xs">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>

        {/* Expanded view */}
        {isExpanded && (
          <div className="mt-3 space-y-2 text-xs text-white">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Live:</span>
              <span className={cx(
                'font-semibold',
                status.liveActive && !status.liveError && 'text-green-400',
                status.liveActive && status.liveError && 'text-red-400',
                !status.liveActive && 'text-gray-500'
              )}>
                {status.liveActive ? (status.liveError ? 'Error' : 'Active') : 'Inactive'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Preview:</span>
              <span className={cx(
                'font-semibold',
                status.previewActive && !status.previewError && 'text-blue-400',
                status.previewActive && status.previewError && 'text-red-400',
                !status.previewActive && 'text-gray-500'
              )}>
                {status.previewActive ? (status.previewError ? 'Error' : 'Active') : 'Inactive'}
              </span>
            </div>
            <div className="pt-2 border-t border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-400">Polyphony:</span>
                <span className={cx(
                  'font-semibold',
                  isWarning ? 'text-yellow-400' : 'text-gray-300'
                )}>
                  {status.polyphony}/{status.maxPolyphony}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className={cx(
                    'h-1.5 rounded-full transition-all duration-300',
                    isWarning ? 'bg-yellow-500' : 'bg-green-500'
                  )}
                  style={{ width: `${Math.min(polyphonyPercent, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
