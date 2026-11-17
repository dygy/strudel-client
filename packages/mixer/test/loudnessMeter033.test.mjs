/**
 * @spec: 033-loudness-meter (functional §2.1, §2.3, tech §2.1, §3 "Audio continuity", §4)
 * LufsMeter on the Web Audio mock: the node options (2 explicit stereo inputs, no outputs), attach
 * edges and re-attach (only changed edges move), destroy removing only its own edges (the speakers
 * edge survives), reset/dispose messages, snapshots; the loader (once per context, a failed load is
 * retried); and the bundled `loudness-meter-processor` evaluated in a scope with only worklet
 * globals (snapshot every 100 ms, reset, dispose → false, absent input 1 → clip on input 0).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { LufsMeter, LUFS_METER_NODE_OPTIONS } from '../meter/LoudnessMeter.mjs';
import { loadLoudnessWorklet, LOUDNESS_PROCESSOR } from '../meter/loudnessLoader.mjs';
import * as mixer from '../index.mjs';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

/** Routes from `source` into `target`, as [output, input] pairs. */
const edgesInto = (source, target) => source.routes.filter((r) => r.target === target).map((r) => [r.output, r.input]);

describe('LufsMeter', () => {
  let ac;
  let meter;

  beforeEach(async () => {
    stubWebAudio();
    ac = new MockAudioContext();
    meter = await LufsMeter.create(ac);
  });
  afterEach(() => {
    meter?.destroy();
    unstubWebAudio();
  });

  it('is exported from @strudel/mixer, and the spec 017 LoudnessMeter is still the old one', () => {
    expect(mixer.LufsMeter).toBe(LufsMeter);
    expect(mixer.LoudnessMeter).not.toBe(LufsMeter);
    expect(typeof mixer.computeTrim).toBe('function');
  });

  it('makes one loudness-meter-processor node: 2 explicit stereo inputs (speakers), no outputs', () => {
    expect(ac.workletNodes).toHaveLength(1);
    const node = ac.workletNodes[0];
    expect(node.name).toBe(LOUDNESS_PROCESSOR);
    expect(node.options).toEqual({
      numberOfInputs: 2,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    expect(node.options).toEqual({ ...LUFS_METER_NODE_OPTIONS });
    expect(ac.addedModules[0]).toMatch(/^data:text\/javascript;base64,/);
  });

  it('attach connects postEq → input 0 and preLimiter → input 1, from output 0', () => {
    const postEq = ac.createGain();
    const preLimiter = ac.createGain();
    meter.attach({ postEq, preLimiter });
    expect(edgesInto(postEq, meter.node)).toEqual([[0, 0]]);
    expect(edgesInto(preLimiter, meter.node)).toEqual([[0, 1]]);
    expect(meter.getSources()).toEqual({ postEq, preLimiter });
  });

  it('re-attach moves only the edges that changed; unchanged edges are not touched', () => {
    const postEq = ac.createGain();
    const preLimiter = ac.createGain();
    meter.attach({ postEq, preLimiter });
    const disconnectsBefore = postEq.disconnected;

    // The EQ switched off: the pre-limiter edge goes, the post-EQ edge stays as it was.
    meter.attach({ postEq, preLimiter: null });
    expect(edgesInto(postEq, meter.node)).toEqual([[0, 0]]);
    expect(postEq.disconnected).toBe(disconnectsBefore);
    expect(edgesInto(preLimiter, meter.node)).toEqual([]);

    // The EQ went away: the meter follows destinationGain.
    const destinationGain = ac.createGain();
    meter.attach({ postEq: destinationGain });
    expect(edgesInto(postEq, meter.node)).toEqual([]);
    expect(edgesInto(destinationGain, meter.node)).toEqual([[0, 0]]);
    expect(meter.getSources()).toEqual({ postEq: destinationGain, preLimiter: null });
  });

  it('N re-attaches leave exactly one edge per input (no edge growth)', () => {
    const a = ac.createGain();
    const b = ac.createGain();
    const pre = ac.createGain();
    for (let i = 0; i < 20; i++) meter.attach({ postEq: i % 2 ? a : b, preLimiter: i % 3 ? pre : null });
    const total = [a, b, pre].reduce((n, src) => n + edgesInto(src, meter.node).length, 0);
    expect(total).toBe(meter.edges.length);
    expect(total).toBeLessThanOrEqual(2);
  });

  it('destroy removes only its own edges: the EQ output → speakers volume edge survives', () => {
    const eqOutput = ac.createGain();
    const speakersVolume = ac.createGain();
    const limiterInput = ac.createGain();
    const limiterStage = ac.createDynamicsCompressor();
    eqOutput.connect(speakersVolume);
    limiterInput.connect(limiterStage);
    meter.attach({ postEq: eqOutput, preLimiter: limiterInput });

    meter.destroy();
    expect(eqOutput.connections).toEqual([speakersVolume]);
    expect(limiterInput.connections).toEqual([limiterStage]);
    expect(edgesInto(eqOutput, meter.node)).toEqual([]);
    expect(edgesInto(limiterInput, meter.node)).toEqual([]);
    expect(meter.node.port.posted.at(-1)).toEqual({ type: 'dispose' });
    expect(meter.node.port.closed).toBe(true);
    expect(meter.attach({ postEq: eqOutput })).toBe(false); // destroyed: nothing reconnects
    expect(edgesInto(eqOutput, meter.node)).toEqual([]);
    meter.destroy(); // idempotent
    expect(meter.node.port.posted.filter((m) => m.type === 'dispose')).toHaveLength(1);
  });

  it('negative: a bare disconnect() would have cut the speakers edge (what destroy must not do)', () => {
    const eqOutput = ac.createGain();
    const speakersVolume = ac.createGain();
    eqOutput.connect(speakersVolume);
    eqOutput.connect(meter.node, 0, 0);
    eqOutput.disconnect();
    expect(eqOutput.connections).toEqual([]);
  });

  it('a source whose edge was already removed by its owner does not break destroy', () => {
    const postEq = ac.createGain();
    meter.attach({ postEq });
    postEq.disconnect(); // e.g. the EQ was destroyed first
    expect(() => meter.destroy()).not.toThrow();
  });

  it('reset posts { type: "reset" } and clears the latest snapshot', () => {
    meter.node.port.reply({ type: 'snapshot', snapshot: { m: -20 } });
    expect(meter.getSnapshot()).toEqual({ m: -20 });
    meter.reset();
    expect(meter.node.port.posted.at(-1)).toEqual({ type: 'reset' });
    expect(meter.getSnapshot()).toBeNull();
  });

  it('onSnapshot delivers snapshots until unsubscribed; a throwing listener does not stop the others', () => {
    const got = [];
    const off = meter.onSnapshot((s) => got.push(s));
    meter.onSnapshot(() => {
      throw new Error('boom');
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      meter.node.port.reply({ type: 'snapshot', snapshot: { s: -14 } });
      off();
      meter.node.port.reply({ type: 'snapshot', snapshot: { s: -9 } });
    } finally {
      console.warn = warn;
    }
    expect(got).toEqual([{ s: -14 }]);
    expect(meter.getSnapshot()).toEqual({ s: -9 });
  });

  it('after destroy no snapshot is delivered', () => {
    const got = [];
    meter.onSnapshot((s) => got.push(s));
    const port = meter.node.port;
    const handler = port.onmessage;
    meter.destroy();
    expect(port.onmessage).toBeNull();
    handler?.({ data: { type: 'snapshot', snapshot: {} } });
    expect(got).toEqual([]);
  });
});

describe('loadLoudnessWorklet', () => {
  afterEach(() => unstubWebAudio());

  it('adds the module once per context', async () => {
    const ac = new MockAudioContext();
    const other = new MockAudioContext();
    await Promise.all([loadLoudnessWorklet(ac), loadLoudnessWorklet(ac), loadLoudnessWorklet(other)]);
    await loadLoudnessWorklet(ac);
    expect(ac.addedModules).toHaveLength(1);
    expect(other.addedModules).toHaveLength(1);
  });

  it('does not cache a failed load: the next call retries', async () => {
    const ac = new MockAudioContext();
    let calls = 0;
    ac.audioWorklet.addModule = () => (++calls === 1 ? Promise.reject(new Error('net')) : Promise.resolve());
    await expect(loadLoudnessWorklet(ac)).rejects.toThrow('net');
    await expect(loadLoudnessWorklet(ac)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('rejects without an AudioWorklet; LufsMeter.create rejects too', async () => {
    await expect(loadLoudnessWorklet({})).rejects.toThrow(/not supported/);
    stubWebAudio();
    await expect(LufsMeter.create({})).rejects.toThrow(/not supported/);
  });
});

describe('loudness-meter-processor (bundled)', () => {
  let Processor;
  const SR = 48000;

  beforeAll(async () => {
    let url;
    await loadLoudnessWorklet({ audioWorklet: { addModule: (u) => ((url = u), Promise.resolve()) } });
    const source = Buffer.from(url.replace(/^data:text\/javascript;base64,/, ''), 'base64').toString('utf8');
    expect(source).not.toMatch(/\bimport\s*[{*(]|\brequire\(/);
    const registered = {};
    class AudioWorkletProcessor {
      constructor() {
        this.port = {
          posted: [],
          onmessage: null,
          postMessage(m) {
            this.posted.push(m);
          },
        };
      }
    }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'window', 'document', 'navigator', source)(
      AudioWorkletProcessor,
      (name, cls) => (registered[name] = cls),
      SR,
      undefined,
      undefined,
      undefined,
    );
    Processor = registered[LOUDNESS_PROCESSOR];
  });

  const stereo = (value, n = 128) => {
    const a = new Float32Array(n).fill(value);
    return [a, new Float32Array(a)];
  };
  const sine = (db, start, n = 128) => {
    const a = new Float32Array(n);
    for (let k = 0; k < n; k++) a[k] = 10 ** (db / 20) * Math.sin((2 * Math.PI * 1000 * (start + k)) / SR);
    return [a, new Float32Array(a)];
  };
  const snapshots = (p) => p.port.posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);

  it('registers and returns true while running (no outputs needed)', () => {
    expect(typeof Processor).toBe('function');
    const p = new Processor({});
    expect(p.process([stereo(0), []], [])).toBe(true);
  });

  it('posts a snapshot every 100 ms of audio (4800 frames at 48 kHz), with real readings', () => {
    const p = new Processor({});
    const blocks = Math.ceil((2 * SR) / 128);
    for (let i = 0; i < blocks; i++) p.process([sine(-23, i * 128), []], []);
    const got = snapshots(p);
    expect(got.length).toBe(Math.floor((blocks * 128) / 4800));
    expect(Math.abs(got.at(-1).s + 23)).toBeLessThan(0.1);
  });

  it('negative: fewer than 4800 frames post nothing', () => {
    const p = new Processor({});
    for (let i = 0; i < 37; i++) p.process([stereo(0.1), []], []); // 4736 frames
    expect(snapshots(p)).toEqual([]);
  });

  it('absent input 1: a post-EQ sample at 0 dBFS is "clip"; present input 1: it is not', () => {
    const absent = new Processor({});
    for (let i = 0; i < 38; i++) absent.process([stereo(1), []], []);
    expect(snapshots(absent).at(-1).events.clip).toBe(1);
    expect(snapshots(absent).at(-1).preLimiter).toBe(false);

    const present = new Processor({});
    for (let i = 0; i < 38; i++) present.process([stereo(1), stereo(0.99)], []);
    const s = snapshots(present).at(-1);
    expect(s.events.clip).toBe(0);
    expect(s.events.limiter).toBe(1);
    expect(s.preLimiter).toBe(true);
  });

  it('both inputs absent: time passes as silence (128-frame quanta)', () => {
    const p = new Processor({});
    for (let i = 0; i < 38; i++) p.process([[], []], []);
    const s = snapshots(p).at(-1);
    expect(s.measuredSeconds).toBeCloseTo((38 * 128) / SR, 9);
    expect(s.m).toBeNull();
  });

  it('{ type: "reset" } clears the measurement; { type: "dispose" } makes process return false', () => {
    const p = new Processor({});
    for (let i = 0; i < 100; i++) p.process([sine(-10, i * 128), []], []);
    p.port.onmessage({ data: { type: 'reset' } });
    for (let i = 0; i < 38; i++) p.process([stereo(0), []], []);
    const s = snapshots(p).at(-1);
    expect(s.i).toBeNull();
    expect(s.tpMax).toBeNull();
    expect(s.measuredSeconds).toBeCloseTo((38 * 128) / SR, 9);

    p.port.onmessage({ data: { type: 'dispose' } });
    expect(p.process([stereo(0), []], [])).toBe(false);
  });
});
