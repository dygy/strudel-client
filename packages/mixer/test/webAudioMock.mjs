/**
 * Web Audio boundary mock for @strudel/mixer tests.
 *
 * Covers everything packages/mixer/*.mjs and @strudel/equalizer call on the
 * AudioContext: createGain, createBiquadFilter (10-band EQ),
 * createMediaStreamDestination, currentTime/state/destination, resume/close,
 * plus HTMLAudioElement (srcObject, paused, play, pause, setSinkId),
 * navigator.mediaDevices.enumerateDevices and localStorage.
 *
 * Installed with vi.stubGlobal and removed with vi.unstubAllGlobals so it works
 * under the root config (isolate: false, node environment) without leaking
 * into other packages' test files, and under packages/mixer/vitest.config.js (jsdom).
 */
import { vi } from 'vitest';

/**
 * An AudioParam whose automation calls are recorded, in order, in `calls` as
 * `[method, ...args]` (e.g. `['linearRampToValueAtTime', 0, 2]`). A direct
 * `param.value = v` write is an instant jump and is recorded as `['value=', v]`.
 * `value` reads the last scheduled target so code that reads `param.value` keeps working.
 */
export function createAudioParam(initial) {
  let current = initial;
  return {
    calls: [],
    get value() {
      return current;
    },
    set value(v) {
      this.calls.push(['value=', v]);
      current = v;
    },
    setValueAtTime(v, t) {
      this.calls.push(['setValueAtTime', v, t]);
      current = v;
    },
    linearRampToValueAtTime(v, t) {
      this.calls.push(['linearRampToValueAtTime', v, t]);
      current = v;
    },
    exponentialRampToValueAtTime(v, t) {
      this.calls.push(['exponentialRampToValueAtTime', v, t]);
      current = v;
    },
    cancelScheduledValues(t) {
      this.calls.push(['cancelScheduledValues', t]);
    },
  };
}

function createNode(extra = {}) {
  return {
    connections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect() {
      this.connections = [];
    },
    ...extra,
  };
}

export class MockMediaStream {
  constructor() {
    this.id = Math.random().toString(36).slice(2);
  }
}

export class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = createNode({ channelCount: 2 });
  }

  createGain() {
    return createNode({ gain: createAudioParam(1) });
  }

  createBiquadFilter() {
    return createNode({
      type: 'lowpass',
      frequency: createAudioParam(350),
      gain: createAudioParam(0),
      Q: createAudioParam(1),
      getFrequencyResponse(freqs, mag, phase) {
        mag.fill(1);
        phase.fill(0);
      },
    });
  }

  createMediaStreamDestination() {
    return createNode({ stream: new MockMediaStream(), channelCount: 2 });
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

export class MockAudio {
  constructor() {
    this.srcObject = null;
    this.paused = true;
    this.sinkId = '';
  }

  setSinkId(deviceId) {
    this.sinkId = deviceId;
    return Promise.resolve();
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

export const MOCK_DEVICES = [
  { deviceId: 'default', kind: 'audiooutput', label: 'Default' },
  { deviceId: 'mic', kind: 'audioinput', label: 'Microphone' },
  { deviceId: 'device1', kind: 'audiooutput', label: 'Speakers' },
  { deviceId: 'device2', kind: 'audiooutput', label: 'Headphones' },
];

export function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

/** Install fresh Web Audio / device / storage mocks for one test. */
export function stubWebAudio() {
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('MediaStream', MockMediaStream);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('navigator', {
    mediaDevices: { enumerateDevices: () => Promise.resolve(MOCK_DEVICES.map((d) => ({ ...d }))) },
  });
  vi.stubGlobal('localStorage', createMemoryStorage());
}

/** Remove every global installed by stubWebAudio (and any other vi.stubGlobal). */
export function unstubWebAudio() {
  vi.unstubAllGlobals();
}
