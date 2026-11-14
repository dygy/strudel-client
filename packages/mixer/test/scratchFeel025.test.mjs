/**
 * @spec: 025-scratch-feel-controls (functional-spec §2.1, §2.2; tech §2.1, §2.2, §4)
 *
 * Physics: the snap grid (Off / ½ beat / Beat / Bar), sanitizeScratchFeel, and the release planner
 * parameterised by the chosen spin-up, with stretch bounds 0.5×–2× (0.2–0.8 s at the default).
 * DSP: the brake length follows `feel`, a brake already running keeps its length, the spin-up
 * follows `feel` (or the release's spinUpSeconds), and a plan already running keeps its length.
 * Worklet and deck: the `feel` message, spinUpSeconds on release, snapGrid and the boolean alias.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  SCRATCH_FEEL_DEFAULTS,
  SCRATCH_FEEL_RANGES,
  SCRATCH_SNAP_GRID,
  SCRATCH_SPINUP_MIN_SECONDS,
  SCRATCH_SPINUP_MAX_SECONDS,
  planScratchSpinUp,
  planScratchRelease,
  sanitizeScratchFeel,
  sanitizeScratchSnapGrid,
  scratchBeatSeconds,
  scratchSnapSeconds,
} from '../scratch/scratchPhysics.mjs';
import { ScratchDsp } from '../scratch/scratchDsp.mjs';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { loadScratchWorklet } from '../scratch/scratchWorklet.mjs';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

const SR = 48000;
const BLOCK = 128;
const CPS = 0.5; // one beat = 0.5 s, one bar = 2 s

describe('025 physics: the snap grid (2.1)', () => {
  it('steps in cycles: off 0, ½ beat 0.125, beat 0.25 (023), bar 1', () => {
    expect(SCRATCH_SNAP_GRID).toEqual({ off: 0, half: 0.125, beat: 0.25, bar: 1 });
    expect(scratchSnapSeconds('off', CPS)).toBe(0);
    expect(scratchSnapSeconds('half', CPS)).toBe(0.25);
    expect(scratchSnapSeconds('beat', CPS)).toBe(0.5);
    expect(scratchSnapSeconds('bar', CPS)).toBe(2);
    expect(scratchSnapSeconds('beat', CPS)).toBe(scratchBeatSeconds(CPS)); // 023 compatible
    expect(scratchSnapSeconds('bar', 0)).toBe(0); // unknown tempo: no rounding
    expect(scratchSnapSeconds('bar', NaN)).toBe(0);
  });

  it('maps 023 booleans and stored strings, and anything unknown to beat', () => {
    expect(sanitizeScratchSnapGrid(false)).toBe('off');
    expect(sanitizeScratchSnapGrid('false')).toBe('off');
    expect(sanitizeScratchSnapGrid(true)).toBe('beat');
    expect(sanitizeScratchSnapGrid('true')).toBe('beat');
    expect(sanitizeScratchSnapGrid(null)).toBe('beat');
    expect(sanitizeScratchSnapGrid(undefined)).toBe('beat');
    expect(sanitizeScratchSnapGrid('quarter')).toBe('beat');
    for (const g of ['off', 'half', 'beat', 'bar']) expect(sanitizeScratchSnapGrid(g)).toBe(g);
  });

  // Released from a hold (rate 0) with the default 0.4 s spin-up: the nominal lag is lag + 0.2 s.
  const planAt = (beats, grid) =>
    planScratchSpinUp({ lagSeconds: beats * 0.5 - 0.2, fromRate: 0, beatSeconds: scratchSnapSeconds(grid, CPS) });

  it('Bar: about 3.4 beats behind lands exactly 1 bar (4 beats) behind; about 1.6 beats lands on 0', () => {
    expect(planAt(3.4, 'bar').targetSeconds).toBeCloseTo(2, 12);
    expect(planAt(1.6, 'bar').targetSeconds).toBe(0);
  });

  it('½ beat: about 1.3 beats behind lands exactly 1.5 beats behind', () => {
    expect(planAt(1.3, 'half').targetSeconds).toBeCloseTo(0.75, 12);
  });

  it('negative pair: Beat rounds the same 1.3 to 1 beat and Off keeps it as it is', () => {
    expect(planAt(1.3, 'beat').targetSeconds).toBeCloseTo(0.5, 12);
    expect(planAt(1.3, 'off').targetSeconds).toBeCloseTo(0.65, 12);
  });
});

describe('025 physics: the feel (2.2)', () => {
  it('defaults and ranges', () => {
    expect(SCRATCH_FEEL_DEFAULTS).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    expect(SCRATCH_FEEL_RANGES).toEqual({ brakeSeconds: [0.02, 1], spinUpSeconds: [0.1, 2] });
  });

  it('sanitizeScratchFeel keeps in-range values, including the ends', () => {
    expect(sanitizeScratchFeel({ brakeSeconds: 0.5, spinUpSeconds: 1.5 })).toEqual({
      brakeSeconds: 0.5,
      spinUpSeconds: 1.5,
    });
    expect(sanitizeScratchFeel({ brakeSeconds: 0.02, spinUpSeconds: 2 })).toEqual({
      brakeSeconds: 0.02,
      spinUpSeconds: 2,
    });
    expect(sanitizeScratchFeel({ brakeSeconds: 1, spinUpSeconds: 0.1 })).toEqual({
      brakeSeconds: 1,
      spinUpSeconds: 0.1,
    });
  });

  it('each field falls back to its default when missing, out of range, NaN or not a number', () => {
    const d = SCRATCH_FEEL_DEFAULTS;
    expect(sanitizeScratchFeel(undefined)).toEqual(d);
    expect(sanitizeScratchFeel(null)).toEqual(d);
    expect(sanitizeScratchFeel('{"brakeSeconds":0.5}')).toEqual(d);
    expect(sanitizeScratchFeel({ brakeSeconds: 0.5 })).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 0.4 });
    expect(sanitizeScratchFeel({ brakeSeconds: 0.01, spinUpSeconds: 2.5 })).toEqual(d);
    expect(sanitizeScratchFeel({ brakeSeconds: NaN, spinUpSeconds: Infinity })).toEqual(d);
    expect(sanitizeScratchFeel({ brakeSeconds: '0.5', spinUpSeconds: -1 })).toEqual(d);
    expect(sanitizeScratchFeel({ brakeSeconds: 0.3, spinUpSeconds: 0 })).toEqual({
      brakeSeconds: 0.3,
      spinUpSeconds: 0.4,
    });
  });

  it('the defaults reproduce 023: stretch bounds exactly 0.2 and 0.8 s around 0.4 s', () => {
    const at = (lag, extra) => planScratchSpinUp({ lagSeconds: lag, fromRate: 0, beatSeconds: 0.5, ...extra });
    // Lag 0.6: nominal 0.8 → 1.0; exact 0.8 s, inside.
    expect(at(0.6).upSeconds).toBeCloseTo(0.8, 12);
    // Lag 0.54: nominal 0.74 → 0.5; exact −0.08 s → 0.2.
    expect(at(0.54).upSeconds).toBe(SCRATCH_SPINUP_MIN_SECONDS);
    // Lag 0.55: nominal 0.75 → 1.0; exact 0.9 s → 0.8.
    expect(at(0.55).upSeconds).toBe(SCRATCH_SPINUP_MAX_SECONDS);
    // Leaving spinUpSeconds out and passing 0.4 are the same plan.
    for (const lag of [0, 0.3, 0.54, 0.55, 1.234]) {
      expect(at(lag, { spinUpSeconds: 0.4 })).toEqual(at(lag));
      expect(planScratchRelease({ lagSeconds: lag, fromRate: 0.3, beatSeconds: 0.5, spinUpSeconds: 0.4 })).toEqual(
        planScratchRelease({ lagSeconds: lag, fromRate: 0.3, beatSeconds: 0.5 }),
      );
    }
  });

  it('spin-up 1.5 s: the nominal lag uses 1.5 s and the stretch bounds are 0.75–3 s', () => {
    const plan = (lagSeconds, beatSeconds, fromRate = 0) =>
      planScratchSpinUp({ lagSeconds, fromRate, beatSeconds, spinUpSeconds: 1.5 });
    // Snap off, from a hold: nominal = lag + 0.75, landed with exactly 1.5 s.
    const off = plan(1, 0);
    expect(off.nominalSeconds).toBeCloseTo(1.75, 12);
    expect(off.targetSeconds).toBeCloseTo(1.75, 12);
    expect(off.upSeconds).toBeCloseTo(1.5, 12);
    // Bar (2 s): nominal 1.75 → 2; exact 2·(2 − 1) = 2 s, inside.
    expect(plan(1, 2).targetSeconds).toBeCloseTo(2, 12);
    expect(plan(1, 2).upSeconds).toBeCloseTo(2, 12);
    // Upper bound: Bar from lag 0.4, nominal 1.15 → 2; exact 3.2 s → 3.
    expect(plan(0.4, 2).upSeconds).toBe(3);
    // Upper bound from a turning record: rate 0.5 at lag 1.1, nominal 1.475 → 2; exact 3.6 → 3.
    expect(plan(1.1, 2, 0.5).upSeconds).toBe(3);
    // Lower bound: a 1 s grid from lag 1.7, nominal 2.45 → 2; exact 0.6 s → 0.75.
    expect(plan(1.7, 1).upSeconds).toBe(0.75);
  });

  it('negative pair: the same releases with the default 0.4 s stretch within 0.2–0.8 instead', () => {
    // A 1 s grid from lag 1.7: nominal 1.9 → 2; exact 0.6 s is inside 0.2–0.8 (0.75 above).
    expect(planScratchSpinUp({ lagSeconds: 1.7, fromRate: 0, beatSeconds: 1 }).upSeconds).toBeCloseTo(0.6, 12);
    // Bar from lag 1.5: nominal 1.7 → 2; exact 1.0 → 0.8 (with 1.5 s: nominal 2.25 → 2, 1.0 inside).
    expect(planScratchSpinUp({ lagSeconds: 1.5, fromRate: 0, beatSeconds: 2 }).upSeconds).toBe(0.8);
    expect(
      planScratchSpinUp({ lagSeconds: 1.5, fromRate: 0, beatSeconds: 2, spinUpSeconds: 1.5 }).upSeconds,
    ).toBeCloseTo(1, 12);
  });

  it('an invalid spinUpSeconds plans with the default', () => {
    for (const bad of [0, -1, NaN, 5, '1.5', null]) {
      expect(planScratchSpinUp({ lagSeconds: 1, fromRate: 0, spinUpSeconds: bad })).toEqual(
        planScratchSpinUp({ lagSeconds: 1, fromRate: 0 }),
      );
    }
  });
});

/** Feed a constant signal and step the DSP one block at a time. */
function drive(dsp) {
  const inp = [new Float32Array(BLOCK).fill(0.25), new Float32Array(BLOCK).fill(0.25)];
  return (seconds) => {
    const blocks = Math.round((seconds * SR) / BLOCK);
    for (let b = 0; b < blocks; b++) dsp.process(inp, [new Float32Array(BLOCK), new Float32Array(BLOCK)], BLOCK);
  };
}

describe('025 DSP: the brake length follows feel (2.2)', () => {
  it('defaults: 0.1 s brake and 0.4 s spin-up, as in 023', () => {
    const dsp = new ScratchDsp(SR, 2);
    expect(dsp.brakeLen).toBe(Math.round(0.1 * SR));
    const run = drive(dsp);
    run(0.5);
    dsp.grab();
    run(0.5);
    dsp.release({ id: 1, beatSeconds: 0 });
    expect(dsp.planUp).toBeCloseTo(0.4, 12);
  });

  it('Brake 0.5 s: the grabbed record is at half speed after 0.25 s and stopped after 0.5 s', () => {
    const dsp = new ScratchDsp(SR, 2);
    const run = drive(dsp);
    dsp.setFeel({ brakeSeconds: 0.5, spinUpSeconds: 0.4 });
    run(0.5);
    dsp.grab();
    expect(dsp.brakeLen).toBe(0.5 * SR);
    run(0.25);
    expect(dsp.motor).toBeGreaterThan(0.45);
    expect(dsp.motor).toBeLessThan(0.55);
    run(0.15);
    expect(dsp.motor).toBeGreaterThan(0);
    run(0.11);
    expect(dsp.motor).toBe(0);
  });

  it('a brake already running keeps its length; the new brake applies from the next grab', () => {
    const dsp = new ScratchDsp(SR, 2);
    const run = drive(dsp);
    dsp.setFeel({ brakeSeconds: 0.5 });
    run(0.5);
    dsp.grab();
    run(0.1);
    dsp.setFeel({ brakeSeconds: 0.02 });
    expect(dsp.brakeLen).toBe(0.5 * SR);
    run(0.15); // 0.25 s into the 0.5 s brake
    expect(dsp.motor).toBeGreaterThan(0.45);
    expect(dsp.motor).toBeLessThan(0.55);
    // Let go, settle back to live, grab again: the 0.02 s brake.
    dsp.release({ id: 1, beatSeconds: 0 });
    run(4);
    expect(dsp.phase).toBe('live');
    dsp.grab();
    expect(dsp.brakeLen).toBe(Math.round(0.02 * SR));
    run(0.03);
    expect(dsp.motor).toBe(0);
  });

  it('negative pair: with the default 0.1 s brake the same grab has stopped by 0.25 s', () => {
    const dsp = new ScratchDsp(SR, 2);
    const run = drive(dsp);
    run(0.5);
    dsp.grab();
    run(0.25);
    expect(dsp.motor).toBe(0); // the default 0.1 s brake has finished
  });

  it('a 0.02 s brake is continuous: the rate never jumps by more than a raised cosine allows', () => {
    const dsp = new ScratchDsp(SR, 2);
    dsp.setFeel({ brakeSeconds: 0.02 });
    const run = drive(dsp);
    run(0.2);
    dsp.grab();
    const one = [new Float32Array(1).fill(0.25), new Float32Array(1).fill(0.25)];
    let prev = 1;
    let maxStep = 0;
    for (let i = 0; i < 0.03 * SR; i++) {
      dsp.process(one, [new Float32Array(1), new Float32Array(1)], 1);
      maxStep = Math.max(maxStep, Math.abs(dsp.motor - prev));
      prev = dsp.motor;
    }
    expect(dsp.motor).toBe(0);
    // Peak slope of 0.5 − 0.5cos(πt/T) is π/(2T) per second: π/(2·960) per sample.
    expect(maxStep).toBeLessThanOrEqual(Math.PI / (2 * 0.02 * SR) + 1e-9);
  });
});

describe('025 DSP: the spin-up follows feel (2.2)', () => {
  function held(dsp, seconds = 1) {
    const run = drive(dsp);
    run(0.5);
    dsp.grab();
    run(seconds);
    return run;
  }

  it('Spin-up 1.5 s, snap off: normal speed after 1.5 s, half speed at 0.75 s', () => {
    const dsp = new ScratchDsp(SR, 2);
    dsp.setFeel({ spinUpSeconds: 1.5 });
    const run = held(dsp);
    dsp.release({ id: 1, beatSeconds: 0 });
    expect(dsp.planUp).toBeCloseTo(1.5, 9);
    expect(dsp.upLen).toBe(1.5 * SR);
    run(0.75);
    expect(dsp.motor).toBeGreaterThan(0.45);
    expect(dsp.motor).toBeLessThan(0.55);
    run(0.7);
    expect(dsp.motor).toBeLessThan(1);
    run(0.1);
    expect(dsp.phase).not.toBe('spinUp');
  });

  it("the release's spinUpSeconds wins over the deck feel (the main thread's number)", () => {
    const dsp = new ScratchDsp(SR, 2);
    held(dsp);
    dsp.release({ id: 1, beatSeconds: 0, spinUpSeconds: 1.5 });
    expect(dsp.planUp).toBeCloseTo(1.5, 9);
  });

  it('a plan already running keeps its length when the feel changes', () => {
    const dsp = new ScratchDsp(SR, 2);
    dsp.setFeel({ spinUpSeconds: 1.5 });
    const run = held(dsp);
    dsp.release({ id: 1, beatSeconds: 0 });
    run(0.25);
    dsp.setFeel({ spinUpSeconds: 0.1 });
    expect(dsp.upLen).toBe(1.5 * SR);
    run(0.5); // 0.75 s in
    expect(dsp.motor).toBeGreaterThan(0.45);
    expect(dsp.motor).toBeLessThan(0.55);
  });

  it('negative pair: with the default feel the same release is at full speed by 0.75 s', () => {
    const dsp = new ScratchDsp(SR, 2);
    const run = held(dsp);
    dsp.release({ id: 1, beatSeconds: 0 });
    run(0.75);
    expect(dsp.motor).toBeCloseTo(1, 6);
  });

  it('setFeel ignores invalid fields (defaults)', () => {
    const dsp = new ScratchDsp(SR, 2);
    dsp.setFeel({ brakeSeconds: 7, spinUpSeconds: NaN });
    expect(dsp.brakeSeconds).toBe(0.1);
    expect(dsp.spinUpSeconds).toBe(0.4);
  });
});

describe('025 worklet: feel message and spinUpSeconds on release', () => {
  let Processor;
  beforeAll(async () => {
    let url;
    await loadScratchWorklet({ audioWorklet: { addModule: (u) => ((url = u), Promise.resolve()) } });
    const source = Buffer.from(url.replace(/^data:text\/javascript;base64,/, ''), 'base64').toString('utf8');
    const registered = {};
    class AudioWorkletProcessor {
      constructor() {
        this.port = { posted: [], onmessage: null, postMessage: (m) => this.port.posted.push(m) };
      }
    }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
      AudioWorkletProcessor,
      (name, cls) => (registered[name] = cls),
      SR,
    );
    Processor = registered['scratch-processor'];
  });
  const block = () => [new Float32Array(BLOCK).fill(0.5), new Float32Array(BLOCK).fill(0.5)];

  it('feel sets the next brake and spin-up; the plan event carries the chosen spin-up', () => {
    const p = new Processor({ outputChannelCount: [2] });
    const send = (data) => p.port.onmessage({ data });
    for (let i = 0; i < 100; i++) p.process([block()], [block()]);
    send({ type: 'feel', brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    send({ type: 'grab' });
    expect(p.dsp.brakeLen).toBe(0.5 * SR);
    for (let i = 0; i < 400; i++) p.process([block()], [block()]);
    send({ type: 'release', id: 3, beatSeconds: 0 });
    expect(p.port.posted.at(-1)).toMatchObject({ type: 'plan', id: 3 });
    expect(p.port.posted.at(-1).upSeconds).toBeCloseTo(1.5, 9);
  });

  it('release spinUpSeconds is used for that release', () => {
    const p = new Processor({ outputChannelCount: [2] });
    const send = (data) => p.port.onmessage({ data });
    for (let i = 0; i < 100; i++) p.process([block()], [block()]);
    send({ type: 'grab' });
    for (let i = 0; i < 400; i++) p.process([block()], [block()]);
    send({ type: 'release', id: 4, beatSeconds: 0, spinUpSeconds: 1.2 });
    expect(p.port.posted.at(-1).upSeconds).toBeCloseTo(1.2, 9);
  });

  it('negative pair: without feel the 023 defaults apply', () => {
    const p = new Processor({ outputChannelCount: [2] });
    const send = (data) => p.port.onmessage({ data });
    for (let i = 0; i < 100; i++) p.process([block()], [block()]);
    send({ type: 'grab' });
    expect(p.dsp.brakeLen).toBe(0.1 * SR);
    for (let i = 0; i < 400; i++) p.process([block()], [block()]);
    send({ type: 'release', id: 5, beatSeconds: 0 });
    expect(p.port.posted.at(-1).upSeconds).toBeCloseTo(0.4, 9);
  });
});

describe('025 ScratchDeck: setFeel, snapGrid and the boolean alias', () => {
  let ac;
  const controller = () => ({
    insert: null,
    setPreGainInsert(n) {
      this.insert = n;
    },
  });
  beforeEach(() => {
    stubWebAudio();
    ac = new AudioContext();
  });
  afterEach(() => unstubWebAudio());

  async function attached() {
    const deck = new ScratchDeck(ac, controller());
    await deck.attach();
    deck.setTempoSource(() => CPS);
    return { deck, node: ac.workletNodes.at(-1) };
  }

  it('defaults: Beat and the 023 feel, and the release message is 023’s', async () => {
    const { deck, node } = await attached();
    expect(deck.snapGrid).toBe('beat');
    expect(deck.snap).toBe(true);
    expect(deck.feel).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    expect(node.port.posted).toEqual([]);
    deck.grab();
    deck.release();
    expect(node.port.posted.at(-1)).toEqual({ type: 'release', id: 1, beatSeconds: 0.5 });
  });

  it('snapGrid sets the step sent on release: off 0, half 0.25 s, bar 2 s', async () => {
    const { deck, node } = await attached();
    const releaseWith = (grid) => {
      deck.snapGrid = grid;
      deck.grab();
      deck.release();
      return node.port.posted.at(-1).beatSeconds;
    };
    expect(releaseWith('bar')).toBe(2);
    expect(releaseWith('half')).toBe(0.25);
    expect(releaseWith('off')).toBe(0);
    expect(releaseWith('beat')).toBe(0.5);
    expect(releaseWith('nonsense')).toBe(0.5);
    expect(deck.snapGrid).toBe('beat');
  });

  it('the deprecated boolean snap maps true to beat and false to off', async () => {
    const { deck } = await attached();
    deck.snapGrid = 'bar';
    expect(deck.snap).toBe(true);
    deck.snap = false;
    expect(deck.snapGrid).toBe('off');
    expect(deck.snap).toBe(false);
    deck.snap = true;
    expect(deck.snapGrid).toBe('beat');
  });

  it('setFeel posts feel (once per change) and the release carries the chosen spin-up', async () => {
    const { deck, node } = await attached();
    expect(deck.setFeel({ brakeSeconds: 0.5, spinUpSeconds: 1.5 })).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(node.port.posted).toEqual([{ type: 'feel', brakeSeconds: 0.5, spinUpSeconds: 1.5 }]);
    deck.setFeel({ brakeSeconds: 0.5 });
    expect(node.port.posted).toHaveLength(1); // no change
    deck.grab();
    deck.release();
    expect(node.port.posted.at(-1)).toEqual({ type: 'release', id: 1, beatSeconds: 0.5, spinUpSeconds: 1.5 });
    deck.setFeel({ spinUpSeconds: 99 }); // invalid: default
    expect(deck.feel).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 0.4 });
    expect(node.port.posted.at(-1)).toEqual({ type: 'feel', brakeSeconds: 0.5, spinUpSeconds: 0.4 });
  });

  it('a feel set before attach reaches the worklet when it attaches', async () => {
    const deck = new ScratchDeck(ac, controller());
    deck.setFeel({ brakeSeconds: 0.25 });
    await deck.attach();
    expect(ac.workletNodes.at(-1).port.posted).toEqual([{ type: 'feel', brakeSeconds: 0.25, spinUpSeconds: 0.4 }]);
  });

  it('negative pair: setFeel with the defaults on a fresh deck posts nothing', async () => {
    const { deck, node } = await attached();
    deck.setFeel({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    deck.setFeel(null);
    expect(node.port.posted).toEqual([]);
  });
});
