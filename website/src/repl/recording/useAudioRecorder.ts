/**
 * useAudioRecorder — React hook managing the AudioRecorderEngine lifecycle.
 *
 * Exposes recording state, toggle handler, export blob, and cleanup.
 * Registers a beforeunload handler for emergency WAV save.
 *
 * Requirements: 2.2, 2.3, 6.3, 7.3
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { AudioRecorderEngine, type RecorderState } from './AudioRecorderEngine';
import { encodeWAV } from './wavEncoder';
import { generateFilename } from './formatUtils';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  elapsedSeconds: number;
  handleRecordToggle: () => void;
  exportBlob: Blob | null;
  clearExport: () => void;
  error: string | null;
}

export function useAudioRecorder(isScreenRecording = false): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [exportBlob, setExportBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<AudioRecorderEngine | null>(null);

  /** Lazily create the engine on first record toggle (AudioContext may not exist at mount). */
  const getOrCreateEngine = useCallback((): AudioRecorderEngine | null => {
    if (engineRef.current) return engineRef.current;

    const audioContext = getAudioContext();
    if (!audioContext) {
      setError('AudioContext is not available.');
      return null;
    }

    const engine = new AudioRecorderEngine(audioContext, {
      onStateChange: (state: RecorderState) => {
        setIsRecording(state.isRecording);
        setElapsedSeconds(state.elapsedSeconds);
        if (state.error) setError(state.error);
      },
      onMemoryWarning: (sizeMB: number) => {
        console.warn(`[AudioRecorder] Memory warning: ~${Math.round(sizeMB)} MB used. Consider stopping.`);
      },
    });

    engineRef.current = engine;
    return engine;
  }, []);

  /** Toggle recording on/off (Req 2.2, 2.3). */
  const handleRecordToggle = useCallback(() => {
    const engine = getOrCreateEngine();
    if (!engine) return;

    if (!engine.getState().isRecording) {
      // Req 8.1, 8.2: Mutual exclusion — cannot start while screen recording is active
      if (isScreenRecording) {
        setError('Cannot start audio recording while screen recording is active.');
        return;
      }

      // Start recording — get destinationGain from superdough controller
      const controller = getSuperdoughAudioController();
      const destinationGain = controller?.output?.destinationGain;

      if (!destinationGain) {
        setError('Audio output not available. Press play first.');
        return;
      }

      setError(null);
      engine.start(destinationGain);
    } else {
      // Stop recording — get the blob
      engine.stop().then((blob) => {
        if (blob.size > 0) {
          setExportBlob(blob);
        } else {
          setError('Recording was empty — nothing to export.');
        }
      }).catch((err) => {
        setError(`Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [getOrCreateEngine, isScreenRecording]);

  /** Clear the export blob after the user has handled it (Req 7.3). */
  const clearExport = useCallback(() => {
    setExportBlob(null);
  }, []);

  // Req 6.3: beforeunload emergency save — best-effort WAV download
  useEffect(() => {
    const handleBeforeUnload = () => {
      const engine = engineRef.current;
      if (!engine || !engine.getState().isRecording) return;

      // Best-effort: stop and encode synchronously-ish
      // MediaRecorder.stop() is async, so we attempt to salvage what we can
      try {
        // We can't truly await here, but we try to trigger a download
        engine.stop().then((blob) => {
          if (blob.size === 0) return;

          const audioContext = getAudioContext();
          if (!audioContext) return;

          // Attempt to decode and encode as WAV for emergency save
          const reader = new FileReader();
          reader.onload = () => {
            const arrayBuffer = reader.result as ArrayBuffer;
            audioContext.decodeAudioData(arrayBuffer).then((audioBuffer) => {
              const wavBlob = encodeWAV(audioBuffer);
              const url = URL.createObjectURL(wavBlob);
              const a = document.createElement('a');
              a.href = url;
              a.download = generateFilename(new Date(), 'wav');
              a.click();
              URL.revokeObjectURL(url);
            }).catch(() => {
              // Last resort: download the raw webm blob
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = generateFilename(new Date(), 'wav');
              a.click();
              URL.revokeObjectURL(url);
            });
          };
          reader.readAsArrayBuffer(blob);
        }).catch(() => {
          // Nothing we can do
        });
      } catch {
        // Best-effort — swallow errors on unload
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Cleanup engine on unmount (Req 7.3)
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, []);

  return {
    isRecording,
    elapsedSeconds,
    handleRecordToggle,
    exportBlob,
    clearExport,
    error,
  };
}
