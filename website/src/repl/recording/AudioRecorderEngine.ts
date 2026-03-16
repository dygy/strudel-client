/**
 * AudioRecorderEngine — core recording engine that captures live audio
 * from the Strudel audio pipeline via MediaStreamDestination + MediaRecorder.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 3.1, 3.2, 3.3, 7.1, 7.2, 7.3
 */

export interface RecorderState {
  isRecording: boolean;
  elapsedSeconds: number;
  estimatedSizeMB: number;
  error: string | null;
}

export interface RecorderOptions {
  memoryWarningThresholdMB?: number; // default: 500
  onStateChange?: (state: RecorderState) => void;
  onMemoryWarning?: (sizeMB: number) => void;
}

/** Internal chunk storage for incremental audio data (Req 7.1). */
interface ChunkStore {
  chunks: Blob[];
  totalBytes: number;
  startTime: number;
  sampleRate: number;
}

const DEFAULT_MEMORY_WARNING_THRESHOLD_MB = 500;
const TIMER_INTERVAL_MS = 250;
const BYTES_PER_MB = 1024 * 1024;

export class AudioRecorderEngine {
  private audioContext: AudioContext | null;
  private options: Required<Pick<RecorderOptions, 'memoryWarningThresholdMB'>> & RecorderOptions;

  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private chunkStore: ChunkStore | null = null;

  private state: RecorderState = {
    isRecording: false,
    elapsedSeconds: 0,
    estimatedSizeMB: 0,
    error: null,
  };

  /** Tracks whether the memory warning has already fired for the current session. */
  private memoryWarningFired = false;

  constructor(audioContext: AudioContext, options?: RecorderOptions) {
    this.audioContext = audioContext;
    this.options = {
      memoryWarningThresholdMB: options?.memoryWarningThresholdMB ?? DEFAULT_MEMORY_WARNING_THRESHOLD_MB,
      onStateChange: options?.onStateChange,
      onMemoryWarning: options?.onMemoryWarning,
    };
  }

  /**
   * Start recording by connecting a MediaStreamDestination to the given
   * GainNode and starting a MediaRecorder.
   *
   * Validates that the AudioContext is in "running" state (Req 1.4).
   * Creates MediaStreamDestination and connects to destinationGain (Req 1.1).
   * Starts a timer that updates elapsedSeconds and estimatedSizeMB (Req 2.5).
   */
  start(destinationGain: GainNode): void {
    if (!this.audioContext) {
      this.updateState({ error: 'AudioRecorderEngine has been destroyed.' });
      return;
    }

    if (this.state.isRecording) {
      return; // Already recording, no-op
    }

    // Req 1.4: AudioContext must be running
    if (this.audioContext.state !== 'running') {
      this.updateState({
        error: 'Audio playback must be active before recording. Press play first.',
      });
      return;
    }

    try {
      // Req 1.1: Create MediaStreamDestination and connect to DestinationGain
      this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
      destinationGain.connect(this.mediaStreamDestination);

      // Create MediaRecorder with webm/opus codec
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.mediaStreamDestination.stream, { mimeType });

      // Req 7.1: Incremental chunk storage
      this.chunkStore = {
        chunks: [],
        totalBytes: 0,
        startTime: Date.now(),
        sampleRate: this.audioContext.sampleRate,
      };

      this.memoryWarningFired = false;

      // Collect chunks incrementally
      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0 && this.chunkStore) {
          this.chunkStore.chunks.push(event.data);
          this.chunkStore.totalBytes += event.data.size;

          const sizeMB = this.chunkStore.totalBytes / BYTES_PER_MB;
          this.updateState({ estimatedSizeMB: sizeMB });

          // Req 7.2: Memory warning when threshold exceeded (fire only once per session)
          if (!this.memoryWarningFired && sizeMB > this.options.memoryWarningThresholdMB) {
            this.memoryWarningFired = true;
            this.options.onMemoryWarning?.(sizeMB);
          }
        }
      };

      // Error handling: salvage existing chunks on MediaRecorder error
      this.mediaRecorder.onerror = () => {
        this.updateState({
          isRecording: false,
          error: 'Recording error occurred. Any captured audio has been preserved.',
        });
        this.clearTimer();
      };

      // Start recording with timeslice to get periodic chunks
      this.mediaRecorder.start(1000);

      // Start elapsed time timer
      this.startTimer();

      this.updateState({
        isRecording: true,
        elapsedSeconds: 0,
        estimatedSizeMB: 0,
        error: null,
      });
    } catch (err) {
      // MediaRecorder constructor failure or other setup error
      this.cleanupNodes();
      this.updateState({
        error: `Failed to start recording: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Stop recording, disconnect nodes, and return the captured audio as a Blob.
   *
   * Req 1.3: Disconnects MediaStreamDestination from DestinationGain.
   * Req 2.3: Finalizes captured audio data.
   */
  stop(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (!this.mediaRecorder || !this.state.isRecording) {
        // Not recording — return empty blob
        this.updateState({ isRecording: false });
        resolve(new Blob([], { type: 'audio/webm' }));
        return;
      }

      const recorder = this.mediaRecorder;

      recorder.onstop = () => {
        const chunks = this.chunkStore?.chunks ?? [];
        const blob = new Blob(chunks, { type: recorder.mimeType });

        // Req 1.3: Disconnect and clean up nodes
        this.cleanupNodes();
        this.clearTimer();

        this.updateState({
          isRecording: false,
          elapsedSeconds: 0,
          estimatedSizeMB: 0,
          error: null,
        });

        resolve(blob);
      };

      try {
        recorder.stop();
      } catch (err) {
        // If stop fails, salvage what we have
        const chunks = this.chunkStore?.chunks ?? [];
        const blob = new Blob(chunks, { type: 'audio/webm' });
        this.cleanupNodes();
        this.clearTimer();
        this.updateState({ isRecording: false });
        if (chunks.length > 0) {
          resolve(blob);
        } else {
          reject(err);
        }
      }
    });
  }

  /** Returns the current RecorderState. */
  getState(): RecorderState {
    return { ...this.state };
  }

  /**
   * Release all resources. Calls stop() if currently recording,
   * then nulls all references and clears the chunk store (Req 7.3).
   */
  async destroy(): Promise<void> {
    if (this.state.isRecording) {
      try {
        await this.stop();
      } catch {
        // Best-effort stop during destroy
      }
    }

    this.clearChunkStore();
    this.cleanupNodes();
    this.clearTimer();
    this.audioContext = null;
    this.mediaRecorder = null;
    this.mediaStreamDestination = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private updateState(partial: Partial<RecorderState>): void {
    this.state = { ...this.state, ...partial };
    this.options.onStateChange?.({ ...this.state });
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

  /** Disconnect MediaStreamDestination and release Web Audio nodes. */
  private cleanupNodes(): void {
    try {
      this.mediaStreamDestination?.disconnect();
    } catch {
      // Already disconnected — safe to ignore
    }
    this.mediaStreamDestination = null;
    this.mediaRecorder = null;
  }

  /** Req 7.3: Release all captured audio data from memory. */
  private clearChunkStore(): void {
    if (this.chunkStore) {
      this.chunkStore.chunks = [];
      this.chunkStore.totalBytes = 0;
      this.chunkStore = null;
    }
  }
}
