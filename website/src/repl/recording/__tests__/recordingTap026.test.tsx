// @vitest-environment jsdom
/**
 * @spec: 026-eq-listening-tools (functional §2.3, tech §2.3)
 * Record as heard: off (the default) records destinationGain, pre-EQ, as spec 008 chose; on records
 * the main EQ's final output; on without a main EQ (audio not started) falls back to destinationGain.
 * Both engines take any AudioNode, connect it to their stream destination and remove exactly that
 * connection on stop. Both hooks pick the tap when a recording starts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../packages/mixer/test/webAudioMock.mjs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(['x']) });
      this.onstop?.();
    });
  }
}

let ac: any;
let destinationGain: any;

/** Fresh modules with @strudel/webaudio pointing at the mock context (isolate:false: see memory note). */
async function load() {
  vi.resetModules();
  vi.doMock('@strudel/webaudio', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: () => ac,
    getSuperdoughAudioController: () => ({ output: { destinationGain } }),
  }));
  const tap = await import('../recordingTap');
  const mainEq = await import('../../mainEqualizer');
  return { ...tap, ...mainEq };
}

/** The stream destination a node was connected to by a recorder. */
const streamTargets = (node: any) => node.connections.filter((n: any) => n.stream);

beforeEach(() => {
  localStorage.clear();
  ac = new MockAudioContext();
  destinationGain = ac.createGain();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(async () => {
  const { destroyMainEqualizer } = await import('../../mainEqualizer');
  destroyMainEqualizer();
  vi.doUnmock('@strudel/webaudio');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('selectRecordingTap (spec 026)', () => {
  it('off by default: destinationGain, even with the main EQ installed', async () => {
    const { selectRecordingTap, loadRecordPostEq, initMainEqualizer } = await load();
    initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    expect(loadRecordPostEq()).toBe(false);
    expect(selectRecordingTap(destinationGain)).toBe(destinationGain);
  });

  it('on: the main EQ output', async () => {
    const { selectRecordingTap, saveRecordPostEq, initMainEqualizer, getMainEqualizerOutputTap } = await load();
    const eq = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    saveRecordPostEq(true);
    expect(getMainEqualizerOutputTap()).toBe(eq.getOutput());
    expect(selectRecordingTap(destinationGain)).toBe(eq.getOutput());
  });

  it('on but the main EQ is not installed: falls back to destinationGain', async () => {
    const { selectRecordingTap, saveRecordPostEq, getMainEqualizerOutputTap } = await load();
    saveRecordPostEq(true);
    expect(getMainEqualizerOutputTap()).toBeNull();
    expect(selectRecordingTap(destinationGain)).toBe(destinationGain);
  });

  it('no destinationGain (audio not started): null', async () => {
    const { selectRecordingTap } = await load();
    expect(selectRecordingTap(undefined, true, ac.createGain())).toBeNull();
  });
});

describe('the engines take any AudioNode and disconnect exactly their connection (spec 026)', () => {
  it('AudioRecorderEngine: connects the EQ output, and removes that connection on stop', async () => {
    const { AudioRecorderEngine } = await import('../AudioRecorderEngine');
    const { AudioEqualizer } = await import('@strudel/equalizer');
    const eq = new AudioEqualizer(ac);
    const output = eq.getOutput() as any;
    output.connect(ac.destination);
    const engine = new AudioRecorderEngine(ac);

    engine.start(output);
    expect(streamTargets(output)).toHaveLength(1);
    expect(output.connections).toContain(ac.destination);

    await engine.stop();
    expect(streamTargets(output)).toEqual([]);
    expect(output.connections).toEqual([ac.destination]); // the speakers keep their feed
  });

  it('ScreenRecorderEngine: connects the EQ output, and removes that connection on stop', async () => {
    const { ScreenRecorderEngine } = await import('../ScreenRecorderEngine');
    const { AudioEqualizer } = await import('@strudel/equalizer');
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
    const eq = new AudioEqualizer(ac);
    const output = eq.getOutput() as any;
    output.connect(ac.destination);
    const engine = new ScreenRecorderEngine(ac);

    await engine.start(output);
    expect(streamTargets(output)).toHaveLength(1);

    await engine.stop();
    expect(streamTargets(output)).toEqual([]);
    expect(output.connections).toEqual([ac.destination]);
  });
});

describe('the hooks pick the tap when a recording starts (spec 026)', () => {
  async function renderHook<T>(useHook: () => T, react: any, client: any) {
    const result: { current: T | null } = { current: null };
    function Probe() {
      result.current = useHook();
      return null;
    }
    const container = document.createElement('div');
    const root = client.createRoot(container);
    react.act(() => root.render(react.createElement(Probe)));
    return { result, unmount: () => react.act(() => root.unmount()) };
  }

  it('useAudioRecorder: option off records destinationGain; on records the main EQ output', async () => {
    const { initMainEqualizer, saveRecordPostEq } = await load();
    const react = await import('react');
    const client = await import('react-dom/client');
    const { useAudioRecorder } = await import('../useAudioRecorder');
    const eq = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    const output = eq.getOutput() as any;
    const { result, unmount } = await renderHook(() => useAudioRecorder(false), react, client);

    react.act(() => result.current!.handleRecordToggle());
    expect(streamTargets(destinationGain)).toHaveLength(1);
    expect(streamTargets(output)).toEqual([]);
    await react.act(async () => {
      result.current!.handleRecordToggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(streamTargets(destinationGain)).toEqual([]);

    saveRecordPostEq(true);
    react.act(() => result.current!.handleRecordToggle());
    expect(streamTargets(output)).toHaveLength(1);
    expect(streamTargets(destinationGain)).toEqual([]);
    unmount();
  });

  it('useScreenRecorder: option on records the main EQ output; without the EQ, destinationGain', async () => {
    const { initMainEqualizer, saveRecordPostEq, destroyMainEqualizer } = await load();
    const react = await import('react');
    const client = await import('react-dom/client');
    const { ScreenRecorderEngine } = await import('../ScreenRecorderEngine');
    const start = vi.spyOn(ScreenRecorderEngine.prototype, 'start').mockResolvedValue(undefined);
    const { useScreenRecorder } = await import('../useScreenRecorder');
    saveRecordPostEq(true);
    const eq = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    const { result, unmount } = await renderHook(() => useScreenRecorder(false), react, client);

    react.act(() => result.current!.handleScreenRecordToggle());
    expect(start).toHaveBeenLastCalledWith(eq.getOutput());

    unmount();
    destroyMainEqualizer();
    const again = await renderHook(() => useScreenRecorder(false), react, client);
    react.act(() => again.result.current!.handleScreenRecordToggle());
    expect(start).toHaveBeenLastCalledWith(destinationGain);
    again.unmount();
  });
});
