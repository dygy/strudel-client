/**
 * superdough fork fix: `.dough()` (the dsp worklet) used to connect straight to ac.destination, so it
 * skipped destinationGain and the output insert (the main EQ, its limiter and its 6 ms look-ahead
 * delay) and the recorders' pre-EQ tap. Now it plays into destinationGain through
 * SuperdoughOutput.connectDirectInput, which survives reset() (resetGlobalEffects rebuilds the gain)
 * and touches only its own edges; with no controller on the context it falls back to the destination.
 *
 * Self-contained Web Audio mock, as in preGainInsert.test.mjs: nodes record their connections, and
 * disconnect(target) throws when not connected, as in Web Audio.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function makeNode(kind, extra = {}) {
  return {
    kind,
    connections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect(target) {
      if (target === undefined) {
        this.connections = [];
        return;
      }
      if (!this.connections.includes(target)) {
        throw new Error('InvalidAccessError: not connected');
      }
      this.connections = this.connections.filter((c) => c !== target);
    },
    ...extra,
  };
}

function makeContext() {
  return {
    state: 'suspended',
    currentTime: 0,
    destination: makeNode('destination', { channelCount: 2, maxChannelCount: 2 }),
    audioWorklet: { addModule: vi.fn(async () => {}) },
  };
}

function stubNodeConstructors() {
  const ctor = (kind) =>
    function (_ac, options = {}) {
      return makeNode(kind, { options, channelCount: 2 });
    };
  vi.stubGlobal('GainNode', ctor('GainNode'));
  vi.stubGlobal('ChannelMergerNode', ctor('ChannelMergerNode'));
  vi.stubGlobal('StereoPannerNode', ctor('StereoPannerNode'));
  vi.stubGlobal('ChannelSplitterNode', ctor('ChannelSplitterNode'));
  vi.stubGlobal('AudioWorkletNode', function (_ac, name) {
    return makeNode('AudioWorkletNode', { name, port: { postMessage: vi.fn() } });
  });
}

describe('SuperdoughOutput.connectDirectInput (fork: .dough() through the output chain)', () => {
  let ac;
  let controller;
  let source;
  const gain = () => controller.output.destinationGain;

  beforeEach(async () => {
    stubNodeConstructors();
    const { SuperdoughAudioController } = await import('../superdoughoutput.mjs');
    ac = makeContext();
    controller = new SuperdoughAudioController(ac);
    source = makeNode('dough');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('plays the node into destinationGain, so it reaches the output insert (the main EQ)', () => {
    const eqInput = makeNode('eq');
    controller.setOutputInsert(eqInput);
    controller.connectDirectInput(source);
    expect(source.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([eqInput]);
  });

  it('survives reset(): re-attached to the new destinationGain, nothing left on the old one', () => {
    controller.connectDirectInput(source);
    const old = gain();
    controller.reset();
    expect(gain()).not.toBe(old);
    expect(source.connections).toEqual([gain()]);
  });

  it('disconnectDirectInput removes only its own edge, and a later reset() does not re-attach it', () => {
    const other = makeNode('analyser');
    controller.connectDirectInput(source);
    source.connect(other);
    controller.disconnectDirectInput(source);
    expect(source.connections).toEqual([other]);
    controller.reset();
    expect(source.connections).toEqual([other]);
  });

  it('connecting the same node twice makes one edge', () => {
    controller.connectDirectInput(source);
    controller.connectDirectInput(source);
    expect(source.connections).toEqual([gain()]);
  });
});

describe('dough(): the dsp worklet plays into superdough destinationGain, not ac.destination', () => {
  let ac;

  beforeEach(() => {
    stubNodeConstructors();
    ac = makeContext();
    vi.stubGlobal('AudioContext', function () {
      return ac;
    });
    vi.stubGlobal('btoa', (s) => Buffer.from(s, 'binary').toString('base64'));
  });
  afterEach(() => {
    vi.doUnmock('../audioContext.mjs');
    vi.unstubAllGlobals();
  });

  /** Fresh modules: the context and the controller are module state (isolate: false). */
  async function load() {
    vi.resetModules();
    vi.doMock('../audioContext.mjs', () => ({
      getAudioContext: () => ac,
      setDefaultAudioContext: () => ac,
      getAudioContextCurrentTime: () => 0,
    }));
    const superdough = await import('../superdough.mjs');
    const dsp = await import('../dspworklet.mjs');
    return { ...superdough, ...dsp };
  }

  it('routes through destinationGain (so the main EQ insert and the pre-EQ recording tap hear it)', async () => {
    const { dough, getSuperdoughAudioController } = await load();
    const controller = getSuperdoughAudioController();
    await dough('const dsp = () => 0;');
    const node = [...controller.output.directInputs][0];
    expect(node?.kind).toBe('AudioWorkletNode');
    expect(node.connections).toEqual([controller.output.destinationGain]);
    expect(node.connections).not.toContain(ac.destination);

    controller.reset(); // resetGlobalEffects()
    expect(node.connections).toEqual([controller.output.destinationGain]);
  });

  it('a new dough() replaces the old worklet: the old one is detached and not re-attached on reset', async () => {
    const { dough, getSuperdoughAudioController } = await load();
    const controller = getSuperdoughAudioController();
    await dough('const dsp = () => 0;');
    const first = [...controller.output.directInputs][0];
    await dough('const dsp = () => 0.1;');
    expect(first.connections).toEqual([]);
    controller.reset();
    expect(first.connections).toEqual([]);
    expect(controller.output.directInputs.size).toBe(1);
  });
});
