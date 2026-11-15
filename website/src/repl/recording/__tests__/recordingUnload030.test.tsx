// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (review #1), recorders 013/014 Req 6.3
 * A recording survives "Stay": a cancelled beforeunload (the close guard asks while music plays, and
 * the recorders now ask while recording) neither stops the engine nor downloads. The emergency save runs
 * on pagehide, when the page really goes: a synchronous download of the chunks so far, engine untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockAudioContext } from '../../../../../packages/mixer/test/webAudioMock.mjs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  static last: FakeMediaRecorder | null = null;
  state = 'inactive';
  mimeType = 'audio/webm';
  stopCalls = 0;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown) {
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.stopCalls++;
    this.state = 'inactive';
    Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(['tail']) });
      this.onstop?.();
    });
  }
  /** A timeslice chunk, as the real recorder delivers every second. */
  chunk(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

let ac: any;
let destinationGain: any;
let downloads: { name: string; blob: Blob }[];
/** Every rendered hook's unmount, run after each test even when it failed (no leaked listeners). */
const mounted: (() => void)[] = [];

async function load() {
  vi.resetModules();
  vi.doMock('@strudel/webaudio', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: () => ac,
    getSuperdoughAudioController: () => ({ output: { destinationGain } }),
  }));
  const react = await import('react');
  const client = await import('react-dom/client');
  return { react, client };
}

/** Load the mocked modules first (load()), then import the hook, then render it here. */
async function renderHook<T>(useHook: () => T) {
  const react = await import('react');
  const client = await import('react-dom/client');
  const result: { current: T | null } = { current: null };
  function Probe() {
    result.current = useHook();
    return null;
  }
  const root = client.createRoot(document.createElement('div'));
  react.act(() => root.render(react.createElement(Probe)));
  let done = false;
  const unmount = () => {
    if (done) return;
    done = true;
    react.act(() => root.unmount());
  };
  mounted.push(unmount);
  return { result, react, unmount };
}

/** Dispatch a cancelable beforeunload; true when a listener cancelled it (the browser would ask). */
function beforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

const flush = async (react: any) =>
  react.act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

beforeEach(() => {
  ac = new MockAudioContext();
  destinationGain = ac.createGain();
  downloads = [];
  FakeMediaRecorder.last = null;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  const blobs = new Map<string, Blob>();
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${n++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobs.get(this.getAttribute('href') ?? '')! });
  });
});

afterEach(async () => {
  mounted.splice(0).forEach((unmount) => unmount());
  for (let i = 0; i < 5; i++) await Promise.resolve(); // let the engines' destroy() settle
  vi.doUnmock('@strudel/webaudio');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAudioRecorder on page leave', () => {
  async function recording() {
    await load();
    const { useAudioRecorder } = await import('../useAudioRecorder');
    const hook = await renderHook(() => useAudioRecorder(false));
    hook.react.act(() => hook.result.current!.handleRecordToggle());
    expect(hook.result.current!.isRecording).toBe(true);
    FakeMediaRecorder.last!.chunk('one');
    FakeMediaRecorder.last!.chunk('two');
    return hook;
  }

  it('a cancelled beforeunload ("Stay") asks, and neither stops the engine nor downloads', async () => {
    const { result, react, unmount } = await recording();
    expect(beforeUnload()).toBe(true); // the recorder asks while recording
    await flush(react);
    expect(FakeMediaRecorder.last!.stopCalls).toBe(0);
    expect(FakeMediaRecorder.last!.state).toBe('recording');
    expect(result.current!.isRecording).toBe(true);
    expect(downloads).toEqual([]);
    unmount();
  });

  it('pagehide downloads the recording so far, synchronously, without stopping the engine', async () => {
    const { react, unmount } = await recording();
    window.dispatchEvent(new Event('pagehide'));
    expect(downloads).toHaveLength(1); // synchronous: before any await
    expect(downloads[0].name).toMatch(/^strudel-recording-.*\.webm$/);
    expect(downloads[0].blob.size).toBe('onetwo'.length); // the two chunks so far, not the stop's tail
    await flush(react);
    expect(FakeMediaRecorder.last!.stopCalls).toBe(0);
    unmount();
  });

  it('not recording: beforeunload does not ask, pagehide saves nothing', async () => {
    await load();
    const { useAudioRecorder } = await import('../useAudioRecorder');
    const { unmount } = await renderHook(() => useAudioRecorder(false));
    expect(beforeUnload()).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(downloads).toEqual([]);
    unmount();
  });

  it('unmount removes the handlers', async () => {
    const { react, result, unmount } = await recording();
    const recorder = FakeMediaRecorder.last!;
    await react.act(async () => {
      result.current!.handleRecordToggle(); // stop
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    unmount();
    expect(beforeUnload()).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(downloads).toEqual([]);
    expect(recorder.stopCalls).toBe(1);
  });
});

describe('useScreenRecorder on page leave', () => {
  async function recording() {
    const video = Object.assign(new EventTarget(), { kind: 'video', stop: vi.fn() });
    const tabStream = { getVideoTracks: () => [video], getTracks: () => [video], getAudioTracks: () => [] };
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(async () => tabStream) } });
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(public tracks: unknown[]) {}
        getTracks() {
          return this.tracks;
        }
      },
    );
    await load();
    const { useScreenRecorder } = await import('../useScreenRecorder');
    const hook = await renderHook(() => useScreenRecorder(false));
    await hook.react.act(async () => {
      hook.result.current!.handleScreenRecordToggle();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(hook.result.current!.isScreenRecording).toBe(true);
    FakeMediaRecorder.last!.chunk('frame');
    return hook;
  }

  it('a cancelled beforeunload ("Stay") asks, and neither stops the engine nor downloads', async () => {
    const { result, react, unmount } = await recording();
    expect(beforeUnload()).toBe(true);
    await flush(react);
    expect(FakeMediaRecorder.last!.stopCalls).toBe(0);
    expect(result.current!.isScreenRecording).toBe(true);
    expect(downloads).toEqual([]);
    unmount();
  });

  it('pagehide downloads the recording so far, synchronously, without stopping the engine', async () => {
    const { react, unmount } = await recording();
    window.dispatchEvent(new Event('pagehide'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^strudel-screen-.*\.webm$/);
    expect(downloads[0].blob.size).toBe('frame'.length);
    await flush(react);
    expect(FakeMediaRecorder.last!.stopCalls).toBe(0);
    unmount();
  });
});

describe('installRecordingUnload', () => {
  it('a snapshot that throws or is empty downloads nothing and does not throw', async () => {
    const { installRecordingUnload } = await import('../recordingUnload');
    const download = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let snapshot: () => Blob | null = () => new Blob([]);
    const off = installRecordingUnload({
      isRecording: () => true,
      snapshot: () => snapshot(),
      filename: () => 'f',
      download,
    });
    window.dispatchEvent(new Event('pagehide'));
    snapshot = () => {
      throw new Error('boom');
    };
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    expect(download).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    off();
  });
});
