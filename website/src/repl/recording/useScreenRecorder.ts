/**
 * useScreenRecorder — React hook managing the ScreenRecorderEngine lifecycle.
 *
 * Exposes recording state, toggle handler, and auto-download on stop.
 * Registers a beforeunload handler for emergency WebM download.
 *
 * Requirements: 4.2, 4.3, 4.6, 6.1, 6.2, 8.1, 8.2, 9.4
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { ScreenRecorderEngine, type ScreenRecorderState } from './ScreenRecorderEngine';
import { generateScreenFilename } from './formatUtils';

export interface UseScreenRecorderReturn {
  isScreenRecording: boolean;
  screenRecordingElapsedSeconds: number;
  handleScreenRecordToggle: () => void;
  screenRecordingError: string | null;
  isScreenRecordingSupported: boolean;
}

/** Create a temporary <a> element, trigger download, and revoke the blob URL. */
function autoDownloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useScreenRecorder(isAudioRecording: boolean): UseScreenRecorderReturn {
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [screenRecordingElapsedSeconds, setScreenRecordingElapsedSeconds] = useState(0);
  const [screenRecordingError, setScreenRecordingError] = useState<string | null>(null);

  const engineRef = useRef<ScreenRecorderEngine | null>(null);

  const isScreenRecordingSupported = ScreenRecorderEngine.isSupported();

  /** Auto-download the WebM blob and reset state after recording stops. */
  const handleRecordingStopped = useCallback((blob: Blob) => {
    if (blob.size > 0) {
      autoDownloadBlob(blob, generateScreenFilename(new Date()));
    } else {
      setScreenRecordingError('Screen recording was empty — nothing to export.');
    }
  }, []);

  /** Lazily create the engine on first record toggle (AudioContext may not exist at mount). */
  const getOrCreateEngine = useCallback((): ScreenRecorderEngine | null => {
    if (engineRef.current) return engineRef.current;

    const audioContext = getAudioContext();
    if (!audioContext) {
      setScreenRecordingError('AudioContext is not available.');
      return null;
    }

    const engine = new ScreenRecorderEngine(audioContext, {
      onStateChange: (state: ScreenRecorderState) => {
        setIsScreenRecording(state.isRecording);
        setScreenRecordingElapsedSeconds(state.elapsedSeconds);
        if (state.error) setScreenRecordingError(state.error);
      },
      onExternalStop: () => {
        // Browser "Stop sharing" fired — auto-stop and download (Req 4.6)
        const eng = engineRef.current;
        if (!eng) return;
        eng
          .stop()
          .then((blob) => {
            handleRecordingStopped(blob);
          })
          .catch((err) => {
            setScreenRecordingError(
              `Failed to finalize recording: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      },
    });

    engineRef.current = engine;
    return engine;
  }, [handleRecordingStopped]);

  /** Toggle screen recording on/off (Req 4.2, 4.3). */
  const handleScreenRecordToggle = useCallback(() => {
    const engine = getOrCreateEngine();
    if (!engine) return;

    if (!engine.getState().isRecording) {
      // Req 8.1, 8.2: Mutual exclusion — cannot start while audio recording is active
      if (isAudioRecording) {
        setScreenRecordingError('Cannot start screen recording while audio recording is active.');
        return;
      }

      // Start recording — get destinationGain from superdough controller
      const controller = getSuperdoughAudioController();
      const destinationGain = controller?.output?.destinationGain;

      if (!destinationGain) {
        setScreenRecordingError('Audio output not available. Press play first.');
        return;
      }

      setScreenRecordingError(null);
      engine.start(destinationGain);
    } else {
      // Stop recording — get the blob and auto-download (Req 6.1, 6.2)
      engine
        .stop()
        .then((blob) => {
          handleRecordingStopped(blob);
        })
        .catch((err) => {
          setScreenRecordingError(
            `Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  }, [getOrCreateEngine, isAudioRecording, handleRecordingStopped]);

  // beforeunload emergency download — best-effort WebM save
  useEffect(() => {
    const handleBeforeUnload = () => {
      const engine = engineRef.current;
      if (!engine || !engine.getState().isRecording) return;

      try {
        engine
          .stop()
          .then((blob) => {
            if (blob.size === 0) return;
            autoDownloadBlob(blob, generateScreenFilename(new Date()));
          })
          .catch(() => {
            // Best-effort — swallow errors on unload
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

  // Cleanup engine on unmount (Req 9.4)
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, []);

  return {
    isScreenRecording,
    screenRecordingElapsedSeconds,
    handleScreenRecordToggle,
    screenRecordingError,
    isScreenRecordingSupported,
  };
}
