// @vitest-environment jsdom
/**
 * @spec: 026-eq-listening-tools (functional §2.3: "Changing it during a recording applies to the next
 * recording")
 * Record as heard is read when a recording starts. Turning it on or off while a recording runs leaves
 * that recording on the tap it started with, and the next recording takes the new setting.
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
  const react = await import('react');
  const client = await import('react-dom/client');
  const { useAudioRecorder } = await import('../useAudioRecorder');
  return { ...tap, ...mainEq, react, client, useAudioRecorder };
}

/** The stream destinations a node is connected to by a recorder. */
const streamTargets = (node: any) => node.connections.filter((n: any) => n.stream);

/** A mounted useAudioRecorder with start/stop helpers. */
async function recorder() {
  const t = await load();
  const eq = t.initMainEqualizer(ac, { setOutputInsert: vi.fn() });
  const output = eq.getOutput() as any;
  const result: { current: any } = { current: null };
  function Probe() {
    result.current = t.useAudioRecorder(false);
    return null;
  }
  const root = t.client.createRoot(document.createElement('div'));
  t.react.act(() => root.render(t.react.createElement(Probe)));
  const start = () => t.react.act(() => result.current.handleRecordToggle());
  const stop = () =>
    t.react.act(async () => {
      result.current.handleRecordToggle();
      await Promise.resolve();
      await Promise.resolve();
    });
  return { ...t, output, start, stop, unmount: () => t.react.act(() => root.unmount()) };
}

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

describe('Record as heard changed during a recording (spec 026 §2.3)', () => {
  it('turned on mid-recording: the next recording is after the EQ', async () => {
    const r = await recorder();
    r.start();
    r.saveRecordPostEq(true);
    await r.stop();
    expect(streamTargets(destinationGain)).toEqual([]);

    r.start();
    expect(streamTargets(r.output)).toHaveLength(1);
    expect(streamTargets(destinationGain)).toEqual([]);
    await r.stop();
    r.unmount();
  });

  it('turned off mid-recording: the next recording is before the EQ again', async () => {
    const r = await recorder();
    r.saveRecordPostEq(true);
    r.start();
    r.saveRecordPostEq(false);
    await r.stop();

    r.start();
    expect(streamTargets(destinationGain)).toHaveLength(1);
    expect(streamTargets(r.output)).toEqual([]);
    await r.stop();
    r.unmount();
  });

  it('negative pair: the recording in progress keeps the tap it started with, in both directions', async () => {
    const r = await recorder();
    r.start();
    r.saveRecordPostEq(true);
    expect(streamTargets(destinationGain)).toHaveLength(1);
    expect(streamTargets(r.output)).toEqual([]);
    await r.stop();

    r.start();
    r.saveRecordPostEq(false);
    expect(streamTargets(r.output)).toHaveLength(1);
    expect(streamTargets(destinationGain)).toEqual([]);
    await r.stop();
    r.unmount();
  });
});
