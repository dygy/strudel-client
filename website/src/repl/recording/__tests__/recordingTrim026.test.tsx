// @vitest-environment jsdom
/**
 * @spec: 026-eq-listening-tools (functional AC 2.3.2, amended 2026-11-14)
 * Record as heard: the EQ output peaks just under 0 dBFS and the WebM/Opus encoder overshoots it
 * (+0.15 dBFS measured), so the recording path gets a fixed −1 dB trim GainNode of its own. The
 * speakers chain is unchanged, the trim is made with the tap and disconnected when the recording
 * stops, and the pre-EQ (option off) recording is untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

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

const streamTargets = (node: any) => node.connections.filter((n: any) => n.stream);
const gainNodes = (node: any) => node.connections.filter((n: any) => n.kind === 'Gain');

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

describe('openRecordingTap: −1 dB trim on the Record as heard path only (spec 026 AC 2.3.2)', () => {
  it('the trim gain is −1 dB (about 0.891)', async () => {
    const { RECORD_POST_EQ_TRIM_GAIN } = await load();
    expect(RECORD_POST_EQ_TRIM_GAIN).toBeCloseTo(0.891, 3);
  });

  it('on: records a trim node at about 0.891 fed by the EQ output; the speakers edge is unchanged', async () => {
    const { openRecordingTap, initMainEqualizer } = await load();
    const eq = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    const output = eq.getOutput() as any;
    const speakersBefore = [...output.connections];

    const tap = openRecordingTap(ac, destinationGain, true)!;
    expect(tap.node).not.toBe(output);
    expect((tap.node as any).gain.value).toBeCloseTo(0.891, 3);
    // Set before it is connected, never as an instant `.value =` write.
    expect((tap.node as any).gain.calls.some(([m]: [string]) => m === 'value=')).toBe(false);
    expect(output.connections).toEqual([...speakersBefore, tap.node]);
    expect(output.connections).toContain(ac.destination);

    tap.close();
    expect(output.connections).toEqual(speakersBefore);
    expect((tap.node as any).connections).toEqual([]);
    tap.close(); // idempotent
    expect(output.connections).toEqual(speakersBefore);
  });

  it('off: destinationGain as it is, no trim made', async () => {
    const { openRecordingTap, initMainEqualizer } = await load();
    initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    const before = ac.createdNodes.length;
    const tap = openRecordingTap(ac, destinationGain, false)!;
    expect(tap.node).toBe(destinationGain);
    expect(ac.createdNodes.length).toBe(before);
    tap.close();
  });

  it('no destinationGain: null', async () => {
    const { openRecordingTap } = await load();
    expect(openRecordingTap(ac, undefined, true, ac.createGain())).toBeNull();
  });
});

describe('the audio recorder hook records through the trim and removes it on stop', () => {
  it('Record as heard on: stream fed by the trim; after stop nothing is left on the EQ output', async () => {
    const { initMainEqualizer, saveRecordPostEq } = await load();
    const react = await import('react');
    const client = await import('react-dom/client');
    const { useAudioRecorder } = await import('../useAudioRecorder');
    saveRecordPostEq(true);
    const eq = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    const output = eq.getOutput() as any;
    const speakersBefore = [...output.connections];

    const result: { current: any } = { current: null };
    function Probe() {
      result.current = useAudioRecorder(false);
      return null;
    }
    const root = client.createRoot(document.createElement('div'));
    react.act(() => root.render(react.createElement(Probe)));

    react.act(() => result.current.handleRecordToggle());
    const [trim] = gainNodes(output);
    expect(trim.gain.value).toBeCloseTo(0.891, 3);
    expect(streamTargets(trim)).toHaveLength(1);
    expect(streamTargets(output)).toEqual([]);

    await react.act(async () => {
      result.current.handleRecordToggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(output.connections).toEqual(speakersBefore);
    expect(trim.connections).toEqual([]);
    react.act(() => root.unmount());
  });
});
