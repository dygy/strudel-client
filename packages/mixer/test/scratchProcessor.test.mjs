/**
 * Spec 019 tech §2.3: the bundled `scratch-processor` worklet. The test evaluates the exact
 * data: URL that ScratchDeck hands to audioWorklet.addModule, inside a fake worklet scope that
 * offers only `AudioWorkletProcessor`, `registerProcessor` and `sampleRate`, so it also proves
 * the bundle is self-contained (no imports, no DOM).
 */
import { describe, it, expect, beforeAll } from 'vitest';
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
    expect(p.port.posted.at(-1)).toEqual({ type: 'debug', id: 1, mix: 1, grabbed: true, pos: 0 });

    send({ type: 'move', delta: -0.1 });
    send({ type: 'motor', rate: -1 });
    for (let i = 0; i < 40; i++) p.process([block(0.5)], [block(0)]);
    send({ type: 'debug', id: 2 });
    expect(p.port.posted.at(-1).pos).toBeLessThan(-0.1);

    send({ type: 'release' });
    for (let i = 0; i < 4; i++) p.process([block(0.5)], [block(0)]);
    send({ type: 'debug', id: 3 });
    expect(p.port.posted.at(-1)).toMatchObject({ id: 3, mix: 0, grabbed: false });
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
