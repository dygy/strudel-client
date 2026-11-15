/**
 * useScreenRecorder — React hook managing the ScreenRecorderEngine lifecycle.
 *
 * Exposes recording state, toggle handler, and auto-download on stop.
 * While recording, asks before the page goes and saves the recording so far when it does (recordingUnload.ts).
 *
 * Requirements: 4.2, 4.3, 4.6, 6.1, 6.2, 8.1, 8.2, 9.4
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { ScreenRecorderEngine, type ScreenRecorderState } from './ScreenRecorderEngine';
import { openRecordingTap, type RecordingTap } from './recordingTap';
import { generateScreenFilename } from './formatUtils';
import { downloadBlob, installRecordingUnload } from './recordingUnload';

export interface UseScreenRecorderReturn {
  isScreenRecording: boolean;
  screenRecordingElapsedSeconds: number;
  handleScreenRecordToggle: () => void;
  screenRecordingError: string | null;
  isScreenRecordingSupported: boolean;
}

/** Create a temporary <a> element, trigger download, and revoke the blob URL. */
const autoDownloadBlob = downloadBlob;

export function useScreenRecorder(isAudioRecording: boolean): UseScreenRecorderReturn {
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [screenRecordingElapsedSeconds, setScreenRecordingElapsedSeconds] = useState(0);
  const [screenRecordingError, setScreenRecordingError] = useState<string | null>(null);

  const engineRef = useRef<ScreenRecorderEngine | null>(null);
  // The open tap (spec 026 Record as heard owns a trim node): closed once the recording has stopped.
  const tapRef = useRef<RecordingTap | null>(null);
  const closeTap = useCallback(() => {
    tapRef.current?.close();
    tapRef.current = null;
  }, []);

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
        if (!state.isRecording) closeTap(); // stopped, or the start failed: the engine let go of the tap
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
  }, [handleRecordingStopped, closeTap]);

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

      // Start recording: from destinationGain (pre-EQ), or the main EQ's output when Record as heard
      // is on and the EQ exists (spec 026). Chosen now; a change mid-recording applies next time.
      // Record as heard records through a −1 dB trim (no codec clipping); closed when the recording stops.
      const controller = getSuperdoughAudioController();
      closeTap();
      const tap = openRecordingTap(getAudioContext(), controller?.output?.destinationGain);

      if (!tap) {
        setScreenRecordingError('Audio output not available. Press play first.');
        return;
      }

      setScreenRecordingError(null);
      tapRef.current = tap;
      // A cancelled picker starts nothing and reports nothing: close the tap then too.
      void Promise.resolve(engine.start(tap.node)).then(() => {
        if (tapRef.current === tap && !engine.getState().isRecording) closeTap();
      });
    } else {
      // Stop recording — get the blob and auto-download (Req 6.1, 6.2)
      engine
        .stop()
        .then((blob) => {
          handleRecordingStopped(blob);
        })
        .catch((err) => {
          setScreenRecordingError(`Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  }, [getOrCreateEngine, isAudioRecording, handleRecordingStopped, closeTap]);

  // Spec 030 review #1: beforeunload only asks while recording ("Stay" leaves the recording untouched);
  // pagehide downloads the recording so far, synchronously. Why: recordingUnload.ts.
  useEffect(
    () =>
      installRecordingUnload({
        isRecording: () => Boolean(engineRef.current?.getState().isRecording),
        snapshot: () => engineRef.current?.snapshot() ?? null,
        filename: () => generateScreenFilename(new Date()),
      }),
    [],
  );

  // Cleanup engine on unmount (Req 9.4)
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
    isScreenRecording,
    screenRecordingElapsedSeconds,
    handleScreenRecordToggle,
    screenRecordingError,
    isScreenRecordingSupported,
  };
}
