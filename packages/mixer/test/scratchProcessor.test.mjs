/**
 * Spec 019 tech §2.3: the bundled `scratch-processor` worklet. The test evaluates the exact
 * data: URL that ScratchDeck hands to audioWorklet.addModule, inside a fake worklet scope that
 * offers only `AudioWorkletProcessor`, `registerProcessor` and `sampleRate`, so it also proves
 * the bundle is self-contained (no imports, no DOM).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadScratchWorklet } from '../scratch/scratchWorklet.mjs';

let Processor;

/** Evaluate the bundled worklet source in a scope with only the worklet globals. */
async function loadBundledProcessor() {
  let url;
  await loadScratchWorklet({
    audioWorklet: {
      addModule(u) {
        url = u;
        return Promise.resolve();
      },
    },
  });
  const source = Buffer.from(url.replace(/^data:text\/javascript;base64,/, ''), 'base64').toString('utf8');
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
  const registerProcessor = (name, cls) => (registered[name] = cls);
  // Shadow the browser-ish globals the worklet scope does not have.
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'window', 'document', 'navigator', source)(
    AudioWorkletProcessor,
    registerProcessor,
    48000,
    undefined,
    undefined,
    undefined,
  );
  return { registered, source };
}

describe('scratch-processor (bundled)', () => {
  beforeAll(async () => {
    const { registered, source } = await loadBundledProcessor();
    expect(source).not.toMatch(/\bimport\s*[{*(]|\brequire\(/);
    Processor = registered['scratch-processor'];
  });

  it('registers scratch-processor', () => {
    expect(typeof Processor).toBe('function');
  });

  function block(value, n = 128) {
    return [new Float32Array(n).fill(value), new Float32Array(n).fill(value)];
  }

  it('passes audio through and returns true from process()', () => {
    const p = new Processor({ outputChannelCount: [2], processorOptions: { bufferSeconds: 8 } });
    const input = [new Float32Array(128).map((_, i) => Math.sin(i)), new Float32Array(128).map((_, i) => Math.cos(i))];
    const output = block(0);
    expect(p.process([input], [output])).toBe(true);
    expect(Array.from(output[0])).toEqual(Array.from(input[0]));
    expect(Array.from(output[1])).toEqual(Array.from(input[1]));
  });

  it('handles grab / move / motor / release and answers debug', () => {
    const p = new Processor({ outputChannelCount: [2], processorOptions: { bufferSeconds: 8 } });
    for (let i = 0; i < 100; i++) p.process([block(0.5)], [block(0)]);
    const send = (data) => p.port.onmessage({ data });

    send({ type: 'grab' });
    for (let i = 0; i < 4; i++) p.process([block(0.5)], [block(0)]); // 512 samples > 480-sample ramp
    send({ type: 'debug', id: 1 });
    // Spec 023: the ring keeps recording, so the braking record falls behind "now" at once.
    expect(p.port.posted.at(-1)).toMatchObject({ type: 'debug', id: 1, mix: 1, grabbed: true, phase: 'held' });
    expect(p.port.posted.at(-1).pos).toBeLessThan(0);
    expect(p.port.posted.at(-1).lag).toBeCloseTo(-p.port.posted.at(-1).pos, 9);

    send({ type: 'move', delta: -0.1 });
    send({ type: 'motor', rate: -1 });
    for (let i = 0; i < 40; i++) p.process([block(0.5)], [block(0)]);
    send({ type: 'debug', id: 2 });
    expect(p.port.posted.at(-1).pos).toBeLessThan(-0.1);

    send({ type: 'release', id: 7, beatSeconds: 0 });
    for (let i = 0; i < 4; i++) p.process([block(0.5)], [block(0)]);
    send({ type: 'debug', id: 3 });
    // Spec 023: let go, the record spins up; it is still what is heard.
    expect(p.port.posted.at(-1)).toMatchObject({ id: 3, mix: 1, grabbed: false, phase: 'spinUp' });
  });

  describe('spec 023 events and clock', () => {
    afterEach(() => vi.unstubAllGlobals());

    function settle(p, value = 0.5) {
      const send = (data) => p.port.onmessage({ data });
      for (let i = 0; i < 400; i++) p.process([block(value)], [block(0)]);
      send({ type: 'grab' });
      for (let i = 0; i < 300; i++) p.process([block(value)], [block(0)]); // held ~0.8 s
      send({ type: 'release', id: 5, beatSeconds: 0 });
      for (let i = 0; i < 1000 && !p.port.posted.some((m) => m.type === 'lagSettled'); i++) {
        p.process([block(value)], [block(0)]);
      }
      return send;
    }

    it('posts lagSettled once, with the release id and the lag, then idle after handOver', () => {
      const p = new Processor({ outputChannelCount: [2] });
      const send = settle(p);
      const settled = p.port.posted.filter((m) => m.type === 'lagSettled');
      expect(settled).toHaveLength(1);
      expect(settled[0].id).toBe(5);
      expect(settled[0].lagSeconds).toBeGreaterThan(0.8);
      send({ type: 'handOver', id: 5, at: 0 }); // no currentFrame: starts now
      for (let i = 0; i < 10; i++) p.process([block(0.5)], [block(0)]); // > 20 ms
      expect(p.port.posted.filter((m) => m.type === 'idle')).toEqual([{ type: 'idle', id: 5 }]);
      const out = block(0);
      const input = [new Float32Array(128).map((_, i) => Math.sin(i)), new Float32Array(128).fill(0.25)];
      p.process([input], [out]);
      expect(Array.from(out[0])).toEqual(Array.from(input[0])); // live again, bit-exact
    });

    it('negative pair: a handOver for another release id is ignored (no idle)', () => {
      const p = new Processor({ outputChannelCount: [2] });
      const send = settle(p);
      send({ type: 'handOver', id: 4, at: 0 });
      for (let i = 0; i < 10; i++) p.process([block(0.5)], [block(0)]);
      expect(p.port.posted.some((m) => m.type === 'idle')).toBe(false);
      send({ type: 'debug', id: 9 });
      expect(p.port.posted.at(-1).phase).toBe('settled');
    });

    it('converts the hand-over context time to the sample where it starts (currentFrame)', () => {
      vi.stubGlobal('currentFrame', 1_000_000);
      const p = new Processor({ outputChannelCount: [2] });
      // currentFrame follows the processed samples, as in a real worklet scope.
      const step = () => {
        p.process([block(0.5)], [block(0)]);
        globalThis.currentFrame += 128;
      };
      const send = (data) => p.port.onmessage({ data });
      for (let i = 0; i < 400; i++) step();
      send({ type: 'grab' });
      for (let i = 0; i < 300; i++) step();
      send({ type: 'release', id: 2, beatSeconds: 0 });
      for (let i = 0; i < 1000 && !p.port.posted.some((m) => m.type === 'lagSettled'); i++) step();
      const at = (globalThis.currentFrame + 4800) / 48000; // 0.1 s from now
      send({ type: 'handOver', id: 2, at });
      for (let i = 0; i < 30; i++) step(); // 80 ms: not yet
      send({ type: 'debug', id: 1 });
      expect(p.port.posted.at(-1)).toMatchObject({ phase: 'settled', mix: 1 });
      for (let i = 0; i < 20; i++) step(); // past 0.1 s + 20 ms
      expect(p.port.posted.some((m) => m.type === 'idle')).toBe(true);
    });

    it('review 2: posts the release plan once, at the release, for that release id', () => {
      const p = new Processor({ outputChannelCount: [2] });
      const send = (data) => p.port.onmessage({ data });
      for (let i = 0; i < 400; i++) p.process([block(0.5)], [block(0)]);
      send({ type: 'grab' });
      for (let i = 0; i < 230; i++) p.process([block(0.5)], [block(0)]); // ~0.6 s held
      send({ type: 'release', id: 9, beatSeconds: 0.5 });
      const plans = p.port.posted.filter((m) => m.type === 'plan');
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ id: 9, targetSeconds: 1, fromRate: 0 });
      expect(plans[0].upSeconds).toBeGreaterThan(0.4); // stretched to land on the beat
      send({ type: 'release', id: 10 }); // not held: no plan
      expect(p.port.posted.filter((m) => m.type === 'plan')).toHaveLength(1);
    });

    it('abort goes back to live from a spin-up, and no lagSettled follows', () => {
      const p = new Processor({ outputChannelCount: [2] });
      const send = (data) => p.port.onmessage({ data });
      for (let i = 0; i < 100; i++) p.process([block(0.5)], [block(0)]);
      send({ type: 'grab' });
      for (let i = 0; i < 100; i++) p.process([block(0.5)], [block(0)]);
      send({ type: 'release', id: 1, beatSeconds: 0 });
      p.process([block(0.5)], [block(0)]);
      send({ type: 'abort' });
      for (let i = 0; i < 1200; i++) p.process([block(0.5)], [block(0)]);
      expect(p.port.posted.some((m) => m.type === 'lagSettled')).toBe(false);
      expect(p.port.posted.filter((m) => m.type === 'idle')).toHaveLength(1);
    });
  });

  it('ignores junk messages and an empty output', () => {
    const p = new Processor({ outputChannelCount: [2] });
    expect(() => {
      p.port.onmessage({ data: null });
      p.port.onmessage({ data: 'grab' });
      p.port.onmessage({ data: { type: 'nope' } });
      p.port.onmessage({ data: { type: 'move', delta: NaN } });
    }).not.toThrow();
    expect(p.process([[]], [[]])).toBe(true);
    expect(p.port.posted).toEqual([]);
  });
});
