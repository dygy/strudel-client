/**
 * useAudioRecorder — React hook managing the AudioRecorderEngine lifecycle.
 *
 * Exposes recording state, toggle handler, export blob, and cleanup.
 * While recording, asks before the page goes and saves the recording so far when it does (recordingUnload.ts).
 *
 * Requirements: 2.2, 2.3, 6.3, 7.3
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { AudioRecorderEngine, type RecorderState } from './AudioRecorderEngine';
import { openRecordingTap, type RecordingTap } from './recordingTap';
import { generateFilename } from './formatUtils';
import { installRecordingUnload } from './recordingUnload';

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
  // The open tap (spec 026 Record as heard owns a trim node): closed once the recording has stopped.
  const tapRef = useRef<RecordingTap | null>(null);
  const closeTap = useCallback(() => {
    tapRef.current?.close();
    tapRef.current = null;
  }, []);

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
        if (!state.isRecording) closeTap(); // stopped, or the start failed: the engine let go of the tap
      },
      onMemoryWarning: (sizeMB: number) => {
        console.warn(`[AudioRecorder] Memory warning: ~${Math.round(sizeMB)} MB used. Consider stopping.`);
      },
    });

    engineRef.current = engine;
    return engine;
  }, [closeTap]);

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

      // Start recording: from destinationGain (pre-EQ), or the main EQ's output when Record as heard
      // is on and the EQ exists (spec 026). Chosen now; a change mid-recording applies next time.
      // Record as heard records through a −1 dB trim (no codec clipping); closed when the recording stops.
      const controller = getSuperdoughAudioController();
      closeTap();
      const tap = openRecordingTap(getAudioContext(), controller?.output?.destinationGain);

      if (!tap) {
        setError('Audio output not available. Press play first.');
        return;
      }

      setError(null);
      tapRef.current = tap;
      engine.start(tap.node);
      if (!engine.getState().isRecording) closeTap();
    } else {
      // Stop recording — get the blob
      engine
        .stop()
        .then((blob) => {
          if (blob.size > 0) {
            setExportBlob(blob);
          } else {
            setError('Recording was empty — nothing to export.');
          }
        })
        .catch((err) => {
          setError(`Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  }, [getOrCreateEngine, isScreenRecording, closeTap]);

  /** Clear the export blob after the user has handled it (Req 7.3). */
  const clearExport = useCallback(() => {
    setExportBlob(null);
  }, []);

  // Req 6.3, spec 030 review #1: beforeunload only asks while recording ("Stay" leaves the recording
  // untouched); pagehide downloads the recording so far, synchronously, as raw WebM. Why: recordingUnload.ts.
  useEffect(
    () =>
      installRecordingUnload({
        isRecording: () => Boolean(engineRef.current?.getState().isRecording),
        snapshot: () => engineRef.current?.snapshot() ?? null,
        filename: () => generateFilename(new Date(), 'webm'),
      }),
    [],
  );

  // Cleanup engine on unmount (Req 7.3)
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.destroy().then(closeTap, closeTap);
        engineRef.current = null;
      } else {
        closeTap();
      }
    };
  }, [closeTap]);

  return {
    isRecording,
    elapsedSeconds,
    handleRecordToggle,
    exportBlob,
    clearExport,
    error,
  };
}
