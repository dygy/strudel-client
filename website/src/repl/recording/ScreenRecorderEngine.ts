/**
 * ScreenRecorderEngine — core recording engine that captures the browser tab
 * (video via getDisplayMedia) combined with Strudel's audio output
 * (via DestinationGain → MediaStreamDestination) into a WebM file.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4,
 *               4.1, 4.6, 6.1, 6.3, 9.1, 9.2, 9.3, 9.4
 */

export interface ScreenRecorderState {
  isRecording: boolean;
  elapsedSeconds: number;
  error: string | null;
}

export interface ScreenRecorderCallbacks {
  onStateChange?: (state: ScreenRecorderState) => void;
  onExternalStop?: () => void;
}

/** Internal chunk storage for incremental video+audio data (Req 3.4). */
interface ScreenChunkStore {
  chunks: Blob[];
  totalBytes: number;
  startTime: number;
}

const TIMER_INTERVAL_MS = 250;

/** Ordered MIME type fallback chain (Req 3.2). */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export class ScreenRecorderEngine {
  private audioContext: AudioContext | null;
  private callbacks: ScreenRecorderCallbacks;

  private tabCaptureStream: MediaStream | null = null;
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private destinationGainRef: GainNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private chunkStore: ScreenChunkStore | null = null;

  private state: ScreenRecorderState = {
    isRecording: false,
    elapsedSeconds: 0,
    error: null,
  };

  constructor(audioContext: AudioContext, callbacks?: ScreenRecorderCallbacks) {
    this.audioContext = audioContext;
    this.callbacks = callbacks ?? {};
  }

  /** Req 1.4 / 4.1: Check if Screen Capture API is available. */
  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices !== 'undefined' &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function'
    );
  }

  /** Returns the current ScreenRecorderState. */
  getState(): ScreenRecorderState {
    return { ...this.state };
  }

  /**
   * Request tab capture, connect audio, create combined MediaRecorder, start.
   *
   * Req 1.1: getDisplayMedia with preferCurrentTab
   * Req 1.2: Extract video track from tab capture
   * Req 1.3: Error on permission denied
   * Req 1.4: AudioContext must be running
   * Req 2.1: Create MediaStreamDestination, connect to DestinationGain
   * Req 2.2: Combined stream with one video + one audio track
   * Req 2.4: Error if AudioContext not running
   * Req 3.1: Combined stream construction
   * Req 3.2: MIME type fallback chain
   * Req 3.3: videoBitsPerSecond 2500 kbps
   * Req 3.4: Incremental chunk collection
   * Req 4.6: Listen for video track "ended" (browser "Stop sharing")
   */
  async start(destinationGain: GainNode): Promise<void> {
    if (!this.audioContext) {
      this.updateState({ error: 'ScreenRecorderEngine has been destroyed.' });
      return;
    }

    if (this.state.isRecording) {
      return; // Already recording, no-op
    }

    // Req 1.4 / 2.4: AudioContext must be running
    if (this.audioContext.state !== 'running') {
      this.updateState({
        error: 'Audio playback must be active before screen recording. Press play first.',
      });
      return;
    }

    let tabStream: MediaStream;
    try {
      // Req 1.1: Request tab capture with preferCurrentTab hint
      tabStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' } as MediaTrackConstraints,
        preferCurrentTab: true,
        audio: false,
      } as DisplayMediaStreamOptions);
    } catch (err) {
      // Req 1.3: Permission denied or user cancelled
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Screen capture permission is required to record. Please allow access and try again.'
          : `Failed to start screen capture: ${err instanceof Error ? err.message : String(err)}`;
      this.updateState({ error: message });
      return;
    }

    try {
      this.tabCaptureStream = tabStream;

      // Req 2.1: Create MediaStreamDestination and connect to DestinationGain
      this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
      destinationGain.connect(this.mediaStreamDestination);
      this.destinationGainRef = destinationGain;

      // Req 2.2 / 3.1: Build combined stream with one video track + one audio track
      const combinedStream = new MediaStream([
        ...tabStream.getVideoTracks(),
        ...this.mediaStreamDestination.stream.getAudioTracks(),
      ]);

      // Req 3.2: Select MIME type with fallback chain
      const mimeType = this.selectMimeType();
      if (!mimeType) {
        this.cleanupStreamsAndNodes();
        this.updateState({ error: 'Your browser does not support WebM video recording.' });
        return;
      }

      // Req 3.3: Create MediaRecorder with video bitrate
      this.mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });

      // Req 3.4: Incremental chunk storage
      this.chunkStore = {
        chunks: [],
        totalBytes: 0,
        startTime: Date.now(),
      };

      // Collect chunks incrementally
      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0 && this.chunkStore) {
          this.chunkStore.chunks.push(event.data);
          this.chunkStore.totalBytes += event.data.size;
        }
      };

      // Error handling
      this.mediaRecorder.onerror = () => {
        this.updateState({
          isRecording: false,
          error: 'Recording error occurred. Any captured video has been preserved.',
        });
        this.clearTimer();
      };

      // Req 4.6: Listen for video track "ended" event (browser "Stop sharing")
      const videoTrack = tabStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          if (this.state.isRecording) {
            this.callbacks.onExternalStop?.();
          }
        });
      }

      // Start recording with timeslice for periodic chunks
      this.mediaRecorder.start(1000);

      // Start elapsed time timer
      this.startTimer();

      this.updateState({
        isRecording: true,
        elapsedSeconds: 0,
        error: null,
      });
    } catch (err) {
      // MediaRecorder constructor failure or other setup error
      this.cleanupStreamsAndNodes();
      this.updateState({
        error: `Failed to start recording: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Stop recording, disconnect nodes, stop tracks, and return the captured
   * video+audio as a WebM Blob.
   *
   * Req 6.1: Assemble chunks into WebM Blob
   * Req 6.3: Handle empty recording (zero chunks)
   * Req 9.1: Stop all video tracks on tab capture stream
   * Req 9.2: Disconnect MediaStreamDestination from DestinationGain
   * Req 9.3: Release chunk data
   */
  stop(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (!this.mediaRecorder || !this.state.isRecording) {
        // Not recording — return empty blob
        this.updateState({ isRecording: false });
        resolve(new Blob([], { type: 'video/webm' }));
        return;
      }

      const recorder = this.mediaRecorder;

      recorder.onstop = () => {
        const chunks = this.chunkStore?.chunks ?? [];
        const blob = new Blob(chunks, { type: recorder.mimeType });

        // Req 9.1, 9.2, 9.3: Clean up all resources
        this.cleanupStreamsAndNodes();
        this.clearTimer();
        this.clearChunkStore();

        this.updateState({
          isRecording: false,
          elapsedSeconds: 0,
          error: null,
        });

        resolve(blob);
      };

      try {
        recorder.stop();
      } catch (err) {
        // If stop fails, salvage what we have
        const chunks = this.chunkStore?.chunks ?? [];
        const blob = new Blob(chunks, { type: 'video/webm' });
        this.cleanupStreamsAndNodes();
        this.clearTimer();
        this.clearChunkStore();
        this.updateState({ isRecording: false });
        if (chunks.length > 0) {
          resolve(blob);
        } else {
          reject(err);
        }
      }
    });
  }

  /**
   * Release all resources. Calls stop() if currently recording,
   * then nulls all references (Req 9.4).
   */
  async destroy(): Promise<void> {
    if (this.state.isRecording) {
      try {
        await this.stop();
      } catch {
        // Best-effort stop during destroy
      }
    }

    this.cleanupStreamsAndNodes();
    this.clearTimer();
    this.clearChunkStore();
    this.audioContext = null;
    this.mediaRecorder = null;
    this.mediaStreamDestination = null;
    this.tabCaptureStream = null;
    this.destinationGainRef = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private updateState(partial: Partial<ScreenRecorderState>): void {
    this.state = { ...this.state, ...partial };
    this.callbacks.onStateChange?.({ ...this.state });
  }

  /** Select the highest-priority supported MIME type from the fallback chain. */
  private selectMimeType(): string | null {
    for (const candidate of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private startTimer(): void {
    this.clearTimer();
    const startTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      this.updateState({ elapsedSeconds: Math.floor(elapsed) });
    }, TIMER_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /** Stop all tracks on the tab capture stream, disconnect audio nodes. */
  private cleanupStreamsAndNodes(): void {
    // Req 9.1: Stop all video tracks on the tab capture stream
    if (this.tabCaptureStream) {
      for (const track of this.tabCaptureStream.getTracks()) {
        track.stop();
      }
      this.tabCaptureStream = null;
    }

    // Req 9.2: Disconnect MediaStreamDestination from DestinationGain
    try {
      if (this.destinationGainRef && this.mediaStreamDestination) {
        this.destinationGainRef.disconnect(this.mediaStreamDestination);
      }
    } catch {
      // Already disconnected — safe to ignore
    }

    this.mediaStreamDestination = null;
    this.destinationGainRef = null;
    this.mediaRecorder = null;
  }

  /** Req 9.3: Release all captured data from memory. */
  private clearChunkStore(): void {
    if (this.chunkStore) {
      this.chunkStore.chunks = [];
      this.chunkStore.totalBytes = 0;
      this.chunkStore = null;
    }
  }
}
