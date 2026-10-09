/**
 * ScreenRecorderEngine (spec 015 §2.3): start after pick, cancel, stop, browser
 * "Stop sharing", MIME fallback. getDisplayMedia, MediaStream and MediaRecorder are
 * faked at the boundary and installed per test with vi.stubGlobal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreenRecorderEngine, type ScreenRecorderState } from '../ScreenRecorderEngine';

const PREFERRED = 'video/webm;codecs=vp9,opus';
const FALLBACK = 'video/webm;codecs=vp8,opus';

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'video' | 'audio') {
    super();
  }
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}

class FakeMediaStream {
  constructor(public tracks: FakeTrack[] = []) {}
  getTracks() {
    return [...this.tracks];
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

let supportedTypes: Set<string>;
let recorders: FakeMediaRecorder[];

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => supportedTypes.has(type));
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public stream: FakeMediaStream,
    options: { mimeType: string },
  ) {
    this.mimeType = options.mimeType;
    recorders.push(this);
  }
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    // Like the browser: a final dataavailable, then stop, asynchronously.
    Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(['frame'], { type: this.mimeType }) });
      this.onstop?.();
    });
  });
}

function setup({ audioState = 'running' } = {}) {
  const videoTrack = new FakeTrack('video');
  const displayStream = new FakeMediaStream([videoTrack]);
  let pick!: () => void;
  let cancel!: (err: unknown) => void;
  const getDisplayMedia = vi.fn(
    () =>
      new Promise<FakeMediaStream>((resolve, reject) => {
        pick = () => resolve(displayStream);
        cancel = reject;
      }),
  );
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

  const destination = { stream: new FakeMediaStream([new FakeTrack('audio')]) };
  const audioContext = { state: audioState, createMediaStreamDestination: vi.fn(() => destination) };
  const destinationGain = { connect: vi.fn(), disconnect: vi.fn() };
  const states: ScreenRecorderState[] = [];
  const onExternalStop = vi.fn();
  const engine = new ScreenRecorderEngine(audioContext as unknown as AudioContext, {
    onStateChange: (s) => states.push(s),
    onExternalStop,
  });

  return {
    engine,
    videoTrack,
    destination,
    destinationGain,
    getDisplayMedia,
    states,
    onExternalStop,
    pick: () => pick(),
    cancel: (err: unknown) => cancel(err),
    start: () => engine.start(destinationGain as unknown as GainNode),
  };
}

describe('ScreenRecorderEngine (spec 015 §2.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    supportedTypes = new Set([PREFERRED, FALLBACK, 'video/webm']);
    recorders = [];
    FakeMediaRecorder.isTypeSupported.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('recording starts only after the user picks what to share', () => {
    it('picking a screen or tab starts recording and the indicator state turns on', async () => {
      const t = setup();

      const started = t.start();
      t.pick();
      await started;

      expect(t.getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(recorders).toHaveLength(1);
      expect(recorders[0].start).toHaveBeenCalled();
      expect(recorders[0].stream.getVideoTracks()).toEqual([t.videoTrack]);
      expect(recorders[0].stream.getAudioTracks()).toHaveLength(1);
      expect(t.destinationGain.connect).toHaveBeenCalledWith(t.destination);
      expect(t.engine.getState()).toEqual({ isRecording: true, elapsedSeconds: 0, error: null });
    });

    it('while the picker is still open, nothing is recording', async () => {
      const t = setup();

      void t.start();
      await Promise.resolve();

      expect(t.getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(recorders).toHaveLength(0);
      expect(t.engine.getState().isRecording).toBe(false);
      expect(t.destinationGain.connect).not.toHaveBeenCalled();
    });
  });

  describe('cancelling the screen picker', () => {
    it('leaves no recording running and the engine ready to record again', async () => {
      const t = setup();

      const started = t.start();
      t.cancel(new DOMException('Permission denied', 'NotAllowedError'));
      await started;

      expect(recorders).toHaveLength(0);
      expect(t.engine.getState().isRecording).toBe(false);
      expect(t.destinationGain.connect).not.toHaveBeenCalled();

      // Ready again: the next attempt opens the picker and can record.
      const again = t.start();
      t.pick();
      await again;
      expect(t.engine.getState().isRecording).toBe(true);
    });

    // FINDING (spec 015 §4): a cancelled picker (NotAllowedError) is reported as an error,
    // "Screen capture permission is required to record…" (ScreenRecorderEngine.ts:113-117),
    // and useScreenRecorder shows any state.error (useScreenRecorder.ts:65). The spec says
    // cancelling the picker shows no error.
    it.fails('shows no error', async () => {
      const t = setup();

      const started = t.start();
      t.cancel(new DOMException('Permission denied', 'NotAllowedError'));
      await started;

      expect(t.engine.getState().error).toBeNull();
      expect(t.states.every((s) => s.error === null)).toBe(true);
    });

    // Pins today's behaviour, which the it.fails above records as a finding. When the finding is
    // fixed, this test and the it.fails both flip; update them together.
    it('today a cancel (NotAllowedError) is reported as "permission is required"', async () => {
      const t = setup();

      const started = t.start();
      t.cancel(new DOMException('Permission denied', 'NotAllowedError'));
      await started;

      expect(t.engine.getState().error).toMatch(/permission is required/);
      expect(t.engine.getState().error).not.toMatch(/Failed to start screen capture/);
    });

    it.each([
      ['a DOMException other than NotAllowedError', new DOMException('No source', 'NotFoundError'), /No source/],
      ['a plain Error', new Error('capture exploded'), /capture exploded/],
    ])(
      'a capture failure that is not a cancel (%s) reports "Failed to start screen capture"',
      async (_l, err, detail) => {
        const t = setup();

        const started = t.start();
        t.cancel(err);
        await started;

        expect(t.engine.getState()).toMatchObject({ isRecording: false });
        expect(t.engine.getState().error).toMatch(/^Failed to start screen capture: /);
        expect(t.engine.getState().error).toMatch(detail);
        expect(t.engine.getState().error).not.toMatch(/permission is required/);
        expect(recorders).toHaveLength(0);
      },
    );
  });

  describe('stopping', () => {
    it('stop produces a video Blob and stops the screen-sharing tracks', async () => {
      const t = setup();
      const started = t.start();
      t.pick();
      await started;

      const blob = await t.engine.stop();

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe(PREFERRED);
      expect(t.videoTrack.stop).toHaveBeenCalled();
      expect(t.destinationGain.disconnect).toHaveBeenCalledWith(t.destination);
      expect(t.engine.getState()).toEqual({ isRecording: false, elapsedSeconds: 0, error: null });
    });

    it('the sharing tracks are not stopped while recording is still running', async () => {
      const t = setup();
      const started = t.start();
      t.pick();
      await started;
      await vi.advanceTimersByTimeAsync(3000);

      expect(t.videoTrack.stop).not.toHaveBeenCalled();
      expect(t.engine.getState()).toMatchObject({ isRecording: true, elapsedSeconds: 3 });
    });
  });

  describe('the browser\'s own "Stop sharing"', () => {
    it('ending the video track ends the recording and the video is still offered', async () => {
      const t = setup();
      // Wired exactly as useScreenRecorder wires it: onExternalStop → engine.stop() → export.
      let exported: Promise<Blob> | undefined;
      t.onExternalStop.mockImplementation(() => {
        exported = t.engine.stop();
      });
      const started = t.start();
      t.pick();
      await started;

      t.videoTrack.dispatchEvent(new Event('ended'));

      expect(t.onExternalStop).toHaveBeenCalledTimes(1);
      const blob = await exported!;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
      expect(t.engine.getState().isRecording).toBe(false);
    });

    it('a track ending after recording already stopped does not trigger a second stop', async () => {
      const t = setup();
      const started = t.start();
      t.pick();
      await started;
      await t.engine.stop();

      t.videoTrack.dispatchEvent(new Event('ended'));

      expect(t.onExternalStop).not.toHaveBeenCalled();
    });
  });

  describe('video format fallback', () => {
    it('when the preferred format is unsupported, a supported fallback is used and recording works', async () => {
      supportedTypes = new Set([FALLBACK, 'video/webm']);
      const t = setup();

      const started = t.start();
      t.pick();
      await started;

      expect(FakeMediaRecorder.isTypeSupported).toHaveBeenCalledWith(PREFERRED);
      expect(recorders[0].mimeType).toBe(FALLBACK);
      expect(t.engine.getState()).toMatchObject({ isRecording: true, error: null });
    });

    it('when the preferred format is supported, it is used rather than a fallback', async () => {
      const t = setup();

      const started = t.start();
      t.pick();
      await started;

      expect(recorders[0].mimeType).toBe(PREFERRED);
    });

    it('with no usable format: an error is shown and nothing is left recording or sharing', async () => {
      supportedTypes = new Set();
      const t = setup();

      const started = t.start();
      t.pick();
      await started;

      expect(t.engine.getState()).toMatchObject({ isRecording: false });
      expect(t.engine.getState().error).toMatch(/does not support WebM/);
      expect(recorders).toHaveLength(0);
      expect(t.videoTrack.stop).toHaveBeenCalled();
      expect(t.destinationGain.disconnect).toHaveBeenCalledWith(t.destination);
      expect(vi.getTimerCount()).toBe(0); // no elapsed-time ticker left behind
    });
  });
});
