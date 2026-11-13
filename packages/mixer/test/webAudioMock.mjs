/**
 * Web Audio boundary mock for @strudel/mixer tests.
 *
 * Covers everything packages/mixer/*.mjs and @strudel/equalizer call on the
 * AudioContext: createGain, createBiquadFilter (10-band EQ and the cuts), createDynamicsCompressor
 * (the EQ limiter: `reduction` is settable), createDelay, createWaveShaper, createChannelSplitter,
 * createChannelMerger, createAnalyser (loudness tap),
 * createMediaStreamDestination, audioWorklet.addModule + AudioWorkletNode (spec 019 scratch),
 * currentTime/state/destination, resume/close, the node
 * constructors superdough's output uses (stubWebAudioNodeConstructors),
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
    // An exponential approach; `value` reads its target (where it settles).
    setTargetAtTime(v, t, timeConstant) {
      this.calls.push(['setTargetAtTime', v, t, timeConstant]);
      current = v;
    },
    cancelScheduledValues(t) {
      this.calls.push(['cancelScheduledValues', t]);
    },
  };
}

/**
 * A node. `connections` lists its targets; `connect(target, output, input)` also records the
 * channel indices in `routes` (for splitters and mergers). `disconnected` counts disconnect() calls.
 */
function createNode(extra = {}) {
  return {
    connections: [],
    routes: [],
    disconnected: 0,
    connect(target, output = 0, input = 0) {
      this.connections.push(target);
      this.routes.push({ target, output, input });
      return target;
    },
    // disconnect() drops every connection; disconnect(target) only that one (as in Web Audio).
    disconnect(target) {
      this.disconnected++;
      this.connections = target === undefined ? [] : this.connections.filter((c) => c !== target);
      this.routes = target === undefined ? [] : this.routes.filter((r) => r.target !== target);
    },
    ...extra,
  };
}

export class MockMediaStream {
  constructor() {
    this.id = Math.random().toString(36).slice(2);
  }
}

/**
 * A MessagePort stand-in: `posted` records every postMessage in order; `reply(data)` delivers a
 * message to `onmessage` as the worklet would; `closed` flips on close().
 */
export class MockMessagePort {
  constructor() {
    this.posted = [];
    this.onmessage = null;
    this.closed = false;
  }
  postMessage(data) {
    this.posted.push(data);
  }
  reply(data) {
    this.onmessage?.({ data });
  }
  close() {
    this.closed = true;
  }
}

/** AudioWorkletNode: records its constructor arguments and has a {@link MockMessagePort}. */
export class MockAudioWorkletNode {
  constructor(context, name, options = {}) {
    this.context = context;
    this.name = name;
    this.options = options;
    this.port = new MockMessagePort();
    this.connections = [];
    this.disconnected = 0;
    context?.workletNodes?.push(this);
  }
  connect(target) {
    this.connections.push(target);
    return target;
  }
  disconnect(target) {
    this.disconnected++;
    this.connections = target === undefined ? [] : this.connections.filter((c) => c !== target);
  }
}

export class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = createNode({ channelCount: 2, maxChannelCount: 2 });
    /** Every node created through a create* method on this context, in creation order. */
    this.createdNodes = [];
    /** Every AudioWorkletNode created on this context. */
    this.workletNodes = [];
    /** `addModule` URLs, in call order. */
    this.addedModules = [];
    const ctx = this;
    this.audioWorklet = {
      addModule(url) {
        ctx.addedModules.push(url);
        return Promise.resolve();
      },
    };
  }

  /** @private Record a node in `createdNodes`. */
  _track(node) {
    this.createdNodes.push(node);
    return node;
  }

  createGain() {
    return this._track(createNode({ kind: 'Gain', gain: createAudioParam(1) }));
  }

  createBiquadFilter() {
    return this._track(
      createNode({
        kind: 'BiquadFilter',
        type: 'lowpass',
        frequency: createAudioParam(350),
        gain: createAudioParam(0),
        Q: createAudioParam(1),
        getFrequencyResponse(freqs, mag, phase) {
          mag.fill(1);
          phase.fill(0);
        },
      }),
    );
  }

  /** A DynamicsCompressorNode: its params record automation; set `reduction` to fake limiting. */
  createDynamicsCompressor() {
    return this._track(
      createNode({
        kind: 'DynamicsCompressor',
        channelCount: 2,
        channelCountMode: 'clamped-max',
        threshold: createAudioParam(-24),
        knee: createAudioParam(30),
        ratio: createAudioParam(12),
        attack: createAudioParam(0.003),
        release: createAudioParam(0.25),
        reduction: 0,
      }),
    );
  }

  createDelay(maxDelayTime = 1) {
    return this._track(createNode({ kind: 'Delay', maxDelayTime, delayTime: createAudioParam(0) }));
  }

  createWaveShaper() {
    return this._track(createNode({ kind: 'WaveShaper', curve: null, oversample: 'none' }));
  }

  createChannelSplitter(numberOfOutputs = 6) {
    return this._track(
      createNode({
        kind: 'ChannelSplitter',
        numberOfOutputs,
        channelCount: numberOfOutputs,
        channelCountMode: 'explicit',
      }),
    );
  }

  createChannelMerger(numberOfInputs = 6) {
    return this._track(
      createNode({ kind: 'ChannelMerger', numberOfInputs, channelCount: 1, channelCountMode: 'explicit' }),
    );
  }

  /**
   * An AnalyserNode whose time-domain data is a constant `level` (set it on the node or pass a
   * function of the context time), so RMS readings are predictable: rms === |level|.
   */
  createAnalyser() {
    const ctx = this;
    return createNode({
      fftSize: 2048,
      level: 0,
      getFloatTimeDomainData(array) {
        const level = typeof this.level === 'function' ? this.level(ctx.currentTime) : this.level;
        array.fill(level);
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
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);
  vi.stubGlobal('MediaStream', MockMediaStream);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('navigator', {
    mediaDevices: { enumerateDevices: () => Promise.resolve(MOCK_DEVICES.map((d) => ({ ...d }))) },
  });
  vi.stubGlobal('localStorage', createMemoryStorage());
}

/**
 * Install the Web Audio node constructors superdough's output uses (`new GainNode(ac)`,
 * `new ChannelMergerNode(ac, …)`, `new StereoPannerNode(ac)`, `new ChannelSplitterNode(ac, …)`),
 * built on the mock context. Call after stubWebAudio; removed by unstubWebAudio.
 */
export function stubWebAudioNodeConstructors() {
  const gain = function (ac, options = {}) {
    const node = Object.assign(ac.createGain(), { kind: 'GainNode', options });
    if (options.gain !== undefined) node.gain = createAudioParam(options.gain);
    return node;
  };
  const plain = (kind) =>
    function (_ac, options = {}) {
      return createNode({ kind, options, channelCount: 2 });
    };
  vi.stubGlobal('GainNode', gain);
  vi.stubGlobal('ChannelMergerNode', plain('ChannelMergerNode'));
  vi.stubGlobal('StereoPannerNode', plain('StereoPannerNode'));
  vi.stubGlobal('ChannelSplitterNode', plain('ChannelSplitterNode'));
}

/** Remove every global installed by stubWebAudio (and any other vi.stubGlobal). */
export function unstubWebAudio() {
  vi.unstubAllGlobals();
}
