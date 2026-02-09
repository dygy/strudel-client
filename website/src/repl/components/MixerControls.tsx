/**
 * MixerControls - React component for DJ-style audio mixer controls
 * 
 * Provides UI for:
 * - Mode toggle (Live/Preview)
 * - Device selection
 * - Transition controls
 * - Visual feedback
 * 
 * @component
 * @example
 * ```tsx
 * <MixerControls 
 *   mixer={audioMixer} 
 *   onModeChange={(mode) => console.log('Mode changed to:', mode)} 
 * />
 * ```
 */

import { useState, useEffect } from 'react';
import type { AudioMixer } from '@strudel/mixer';

/**
 * Props for MixerControls component
 * 
 * @interface MixerControlsProps
 * @property {AudioMixer | null} mixer - AudioMixer instance
 * @property {(mode: 'live' | 'preview') => void} [onModeChange] - Callback when mode changes
 */
interface MixerControlsProps {
  mixer: AudioMixer | null;
  onModeChange?: (mode: 'live' | 'preview') => void;
}

interface MixerState {
  currentMode: 'live' | 'preview';
  liveActive: boolean;
  previewActive: boolean;
  liveDevice: string | null;
  previewDevice: string | null;
  availableDevices: MediaDeviceInfo[];
  isTransitioning: boolean;
}

export function MixerControls({ mixer, onModeChange }: MixerControlsProps) {
  const [state, setState] = useState<MixerState>({
    currentMode: 'live',
    liveActive: false,
    previewActive: false,
    liveDevice: null,
    previewDevice: null,
    availableDevices: [],
    isTransitioning: false,
  });

  useEffect(() => {
    if (!mixer) return;

    // Load available devices
    mixer.getAvailableDevices().then(devices => {
      setState(prev => ({ ...prev, availableDevices: devices }));
    });

    // Listen for stream state changes
    const handleStreamChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { stream, active } = customEvent.detail;
      setState(prev => ({
        ...prev,
        [`${stream}Active`]: active,
      }));
    };

    // Listen for transition state changes
    const handleTransition = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { state: transitionState } = customEvent.detail;
      setState(prev => ({
        ...prev,
        isTransitioning: transitionState === 'start',
      }));
    };

    window.addEventListener('mixer-stream-change', handleStreamChange);
    window.addEventListener('mixer-transition', handleTransition);

    return () => {
      window.removeEventListener('mixer-stream-change', handleStreamChange);
      window.removeEventListener('mixer-transition', handleTransition);
    };
  }, [mixer]);

  const handleModeToggle = () => {
    const newMode = state.currentMode === 'live' ? 'preview' : 'live';
    setState(prev => ({ ...prev, currentMode: newMode }));
    onModeChange?.(newMode);
  };

  const handleTransition = async (type: 'instant' | 'crossfade') => {
    if (!mixer) return;

    setState(prev => ({ ...prev, isTransitioning: true }));
    try {
      await mixer.transition(type);
      setState(prev => ({ ...prev, currentMode: 'live' }));
      onModeChange?.('live');
    } catch (err) {
      console.error('Transition failed:', err);
      alert(`Transition failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setState(prev => ({ ...prev, isTransitioning: false }));
    }
  };

  const handleDeviceChange = async (stream: 'live' | 'preview', deviceId: string) => {
    if (!mixer) return;

    try {
      if (stream === 'live') {
        await mixer.setDevices(deviceId, state.previewDevice);
        setState(prev => ({ ...prev, liveDevice: deviceId }));
      } else {
        await mixer.setDevices(state.liveDevice, deviceId);
        setState(prev => ({ ...prev, previewDevice: deviceId }));
      }
    } catch (err) {
      console.error(`Failed to set ${stream} device:`, err);
      alert(`Failed to set ${stream} device: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  if (!mixer) {
    return null;
  }

  return (
    <div className="mixer-controls">
      <style>{`
        .mixer-controls {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .mode-toggle {
          display: flex;
          gap: 0.5rem;
        }

        .mode-toggle button {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
          font-weight: 500;
        }

        .mode-toggle button:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .mode-toggle button.active {
          background: rgba(59, 130, 246, 0.5);
          border-color: rgba(59, 130, 246, 0.8);
        }

        .mode-toggle button.live.active {
          background: rgba(239, 68, 68, 0.5);
          border-color: rgba(239, 68, 68, 0.8);
        }

        .device-selection {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .device-row {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .device-row label {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .device-row select {
          padding: 0.5rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          color: #fff;
          font-size: 0.85rem;
        }

        .device-row select:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.8);
        }

        .transition-controls {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .transition-controls button {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(34, 197, 94, 0.3);
          color: #fff;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.85rem;
          font-weight: 500;
        }

        .transition-controls button:hover:not(:disabled) {
          background: rgba(34, 197, 94, 0.5);
        }

        .transition-controls button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .transition-status {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.7);
          font-style: italic;
        }
      `}</style>

      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={`live ${state.currentMode === 'live' ? 'active' : ''}`}
          onClick={handleModeToggle}
        >
          Live {state.liveActive && '🔊'}
        </button>
        <button
          className={state.currentMode === 'preview' ? 'active' : ''}
          onClick={handleModeToggle}
        >
          Preview {state.previewActive && '🎧'}
        </button>
      </div>

      {/* Device Selection */}
      <div className="device-selection">
        <div className="device-row">
          <label>Live Output:</label>
          <select
            value={state.liveDevice || ''}
            onChange={(e) => handleDeviceChange('live', e.target.value)}
          >
            <option value="">System Default</option>
            {state.availableDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Device ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
        <div className="device-row">
          <label>Preview Output:</label>
          <select
            value={state.previewDevice || ''}
            onChange={(e) => handleDeviceChange('preview', e.target.value)}
          >
            <option value="">System Default</option>
            {state.availableDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Device ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transition Controls */}
      <div className="transition-controls">
        <button
          onClick={() => handleTransition('instant')}
          disabled={state.isTransitioning || !state.previewActive}
          title="Instantly switch preview to live"
        >
          Instant Switch
        </button>
        <button
          onClick={() => handleTransition('crossfade')}
          disabled={state.isTransitioning || !state.previewActive}
          title="Gradually crossfade preview to live"
        >
          Crossfade
        </button>
        {state.isTransitioning && <span className="transition-status">Transitioning...</span>}
      </div>
    </div>
  );
}
