/**
 * @spec: 023-vinyl-scratch-realism (tech §2.1, §4)
 *
 * The scratch DSP behaves like a record: the ring keeps recording while held, a forward push
 * after the grab is heard, the brake and the motor glide, the lag lands on the beat (snap) or
 * stays (snap off), lag 0 is caught up, and the hand-over to the shifted live input is coherent.
 */
import { describe, it, expect } from 'vitest';
import { ScratchDsp, SCRATCH_MIN_LAG_SAMPLES } from '../scratch/scratchDsp.mjs';
import {
  planScratchSpinUp,
  scratchBumpSeconds,
  SCRATCH_SPINUP_SECONDS,
  SCRATCH_MAX_CATCHUP_RATE,
} from '../scratch/scratchPhysics.mjs';

const SR = 48000;
const BLOCK = 128;
const blocksFor = (seconds) => Math.ceil((seconds * SR) / BLOCK);
const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length));

/** Feeds `fn(sampleIndex)` (both channels) and collects the left output. `fn` may change. */
function rig(dsp, fn) {
  const state = { n: 0, fn, out: [], inp: [], events: [] };
  state.run = (blocks, onBlock, frames = BLOCK) => {
    const start = state.out.length;
    for (let b = 0; b < blocks; b++) {
      onBlock?.(b);
      const l = new Float32Array(frames);
      const r = new Float32Array(frames);
      for (let i = 0; i < frames; i++, state.n++) {
        l[i] = state.fn(state.n);
        r[i] = l[i];
      }
      const o = [new Float32Array(frames), new Float32Array(frames)];
      dsp.process([l, r], o, frames);
      for (let i = 0; i < frames; i++) {
        state.out.push(o[0][i]);
        state.inp.push(l[i]);
      }
      const e = dsp.takeEvent?.();
      if (e) state.events.push({ type: e, id: dsp.eventId, lag: dsp.eventLagSeconds, at: state.n });
    }
    return state.out.slice(start);
  };
  /** One sample at a time, calling `each()` after every sample. */
  state.samples = (count, each) => {
    for (let i = 0; i < count; i++) {
      state.run(1, undefined, 1);
      each?.(i);
    }
  };
  return state;
}

const maxStep = (arr) => {
  let m = 0;
  for (let i = 1; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i] - arr[i - 1]));
  return m;
};
const sine =
  (f, a = 0.5) =>
  (n) =>
    a * Math.sin((2 * Math.PI * f * n) / SR);

describe('ScratchDsp 023: the sound follows the hand both ways (2.1)', () => {
  it('a forward push right after the grab is heard, played forwards and faster (the old frozen ring was silent)', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(1));
    dsp.grab();
    r.run(blocksFor(0.25)); // brake, then held still: silent
    expect(rms(r.run(blocksFor(0.05)))).toBeLessThan(1e-3);
    // Push forwards at about 2× for 60 ms (what a platter drag sends per frame).
    const pushed = r.run(blocksFor(0.06), () => dsp.moveBy((2 * BLOCK) / SR));
    const heard = pushed.slice(Math.round(0.015 * SR)); // after the 8 ms smoother has taken up
    expect(rms(heard)).toBeGreaterThan(0.2);
    let crossings = 0;
    for (let i = 1; i < heard.length; i++) if (heard[i - 1] < 0 !== heard[i] < 0) crossings++;
    // 220 Hz at ~2× ≈ 440 Hz: ~0.88 crossings per ms.
    expect(crossings / ((heard.length / SR) * 1000)).toBeGreaterThan(0.6);
  });

  it('holding the record still makes it fall behind live at exactly one sample per sample', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(0.5));
    dsp.grab();
    r.run(blocksFor(0.15)); // the brake is over
    const lag0 = dsp.lag;
    r.run(100);
    expect(dsp.lag - lag0).toBeCloseTo(100 * BLOCK, 9);
    expect(dsp.rate).toBe(0);
  });

  it('back and forth over a small arc is heard both ways, with no gap beyond the turnarounds', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(330));
    r.run(blocksFor(1));
    dsp.grab();
    r.run(blocksFor(0.3)); // lag ≈ 0.25 s: room to push forwards
    const per = blocksFor(0.04);
    const back = [];
    const forth = [];
    for (let k = 0; k < 4; k++) {
      back.push(rms(r.run(per, () => dsp.moveBy((-1.5 * BLOCK) / SR)).slice(Math.round(0.012 * SR))));
      forth.push(rms(r.run(per, () => dsp.moveBy((1.5 * BLOCK) / SR)).slice(Math.round(0.012 * SR))));
    }
    for (const v of [...back, ...forth]) expect(v).toBeGreaterThan(0.2);
  });

  it('negative pair: held still is silent', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(0.5));
    dsp.grab();
    r.run(blocksFor(0.3));
    expect(rms(r.run(blocksFor(0.2)))).toBeLessThan(1e-4);
  });
});

describe('ScratchDsp 023: brake and motor (2.2)', () => {
  it('the grab brakes the record from rate 1 to 0 over ~0.1 s, smoothly and without a sample step', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    const steady = maxStep(r.run(blocksFor(0.5)));
    dsp.grab();
    const rates = [];
    const from = r.out.length;
    r.samples(Math.round(0.15 * SR), () => rates.push(dsp.rate));
    const stopAt = rates.findIndex((v) => v === 0);
    expect(stopAt / SR).toBeGreaterThan(0.09);
    expect(stopAt / SR).toBeLessThan(0.11);
    // Monotonic: the pitch slides down, never back up.
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThanOrEqual(rates[i - 1] + 1e-12);
    // Half way through the brake the record still turns at about half speed: a pitch drop, not a cut.
    expect(rates[Math.round(0.05 * SR)]).toBeGreaterThan(0.4);
    expect(rates[Math.round(0.05 * SR)]).toBeLessThan(0.6);
    // No click: the largest sample-to-sample step is no bigger than in the steady signal.
    expect(maxStep(r.out.slice(from - 1))).toBeLessThanOrEqual(steady * 1.05);
  });

  it('letting go spins the record up from 0 to rate 1 over ~0.4 s (snap off), without a sample step', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    const steady = maxStep(r.run(blocksFor(1)));
    dsp.grab();
    r.run(blocksFor(0.6));
    dsp.release({ id: 1, beatSeconds: 0 });
    const rates = [];
    const from = r.out.length;
    r.samples(Math.round(0.5 * SR), () => rates.push(dsp.rate));
    const fullAt = rates.findIndex((v) => v >= 1 - 1e-9);
    expect(fullAt / SR).toBeGreaterThan(0.38);
    expect(fullAt / SR).toBeLessThan(0.42);
    expect(rates[0]).toBeLessThan(0.001); // starts slow and low
    for (let i = 1; i < fullAt; i++) expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1] - 1e-12);
    expect(maxStep(r.out.slice(from - 1))).toBeLessThanOrEqual(steady * 1.05);
  });
});

describe('ScratchDsp 023: the lag (2.3, 2.4)', () => {
  /** Hold for `holdSeconds` from the grab, release with `beatSeconds`, run to the event. */
  function holdAndRelease(holdSeconds, beatSeconds, fn = sine(220)) {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, fn);
    r.run(blocksFor(2));
    dsp.grab();
    r.samples(Math.round(holdSeconds * SR));
    const lagAtRelease = dsp.lag;
    dsp.release({ id: 3, beatSeconds });
    let lastResidual = 0;
    let prevLag = dsp.lag;
    let maxRate = 0;
    r.samples(Math.round(3 * SR), () => {
      if (dsp.phase === 'spinUp') maxRate = Math.max(maxRate, dsp.rate);
      // Away from the settle point, Δlag is exactly 1 − rate; at it, the landing correction.
      lastResidual = dsp.lag - prevLag - (1 - dsp.rate);
      if (dsp.phase === 'spinUp' || r.events.length === 0) prevLag = dsp.lag;
    });
    return { dsp, r, lagAtRelease, lastResidual, maxRate };
  }

  it('snap on: a ~1.8-beat hold lands exactly 2 beats behind (within 1 sample), as an event', () => {
    const beat = 0.5; // 0.25 cycle at cps 0.5
    // Held 1.8 beats in record terms: the brake keeps it moving for its first 0.05 s.
    const { dsp, r, maxRate } = holdAndRelease(1.8 * beat - 0.15, beat);
    const settled = r.events.filter((e) => e.type === 'lagSettled');
    expect(settled).toHaveLength(1);
    expect(settled[0].id).toBe(3);
    expect(Math.abs(settled[0].lag - 2 * beat) * SR).toBeLessThan(1);
    expect(dsp.phase).toBe('settled');
    expect(Math.abs(dsp.lag - 2 * beat * SR)).toBeLessThan(1);
    expect(maxRate).toBeLessThanOrEqual(1.1 + 1e-9);
  });

  it('snap off: the same hold keeps its own lag, off the grid', () => {
    const beat = 0.5;
    const { dsp, r, lagAtRelease } = holdAndRelease(1.8 * beat - 0.15, 0);
    const settled = r.events.filter((e) => e.type === 'lagSettled');
    expect(settled).toHaveLength(1);
    // The spin-up from standstill adds half its length (0.2 s) to the lag.
    const expected = lagAtRelease / SR + SCRATCH_SPINUP_SECONDS / 2;
    expect(Math.abs(settled[0].lag - expected) * SR).toBeLessThan(1);
    expect(Math.abs(settled[0].lag / beat - Math.round(settled[0].lag / beat))).toBeGreaterThan(0.1);
    expect(dsp.phase).toBe('settled');
  });

  it('the landing is integrated, not jumped: the final correction is under one sample', () => {
    const { lastResidual } = holdAndRelease(0.77, 0.5);
    expect(Math.abs(lastResidual)).toBeLessThan(1);
  });

  it('lag 0 (snap rounds down): the motor catches up (rate ≤ 1.5), no lagSettled, then live bit-exact', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(1));
    dsp.grab();
    dsp.moveBy(0.03); // a tiny scratch: lag stays small
    r.run(blocksFor(0.03));
    let maxRate = 0;
    dsp.release({ id: 8, beatSeconds: 2 }); // a slow beat: rounds to 0
    r.samples(Math.round(2.5 * SR), () => (maxRate = Math.max(maxRate, dsp.rate)));
    expect(maxRate).toBeGreaterThan(1.01);
    expect(maxRate).toBeLessThanOrEqual(SCRATCH_MAX_CATCHUP_RATE + 1e-9);
    expect(r.events.map((e) => e.type)).toEqual(['idle']);
    expect(dsp.phase).toBe('live');
    const tail = r.run(4);
    expect(tail).toEqual(r.inp.slice(-tail.length));
  });

  it('negative pair: release without a grab plans nothing and reports nothing', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(0.5));
    dsp.release({ id: 1, beatSeconds: 0.5 });
    r.run(blocksFor(1));
    expect(r.events).toEqual([]);
    expect(dsp.phase).toBe('live');
  });

  it('holding past the 8 s reach: silent at the edge, and the target lag is clamped inside the ring', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(9));
    dsp.grab();
    r.run(blocksFor(8.5));
    expect(dsp.lag).toBe(dsp.maxLag);
    expect(rms(r.run(blocksFor(0.2)))).toBeLessThan(1e-3);
    dsp.release({ id: 2, beatSeconds: 0.5 });
    r.run(blocksFor(6));
    const settled = r.events.find((e) => e.type === 'lagSettled');
    expect(settled.lag).toBeLessThanOrEqual(7.5);
    expect(settled.lag % 0.5).toBeCloseTo(0, 9);
  });
});

describe('ScratchDsp 023: the hand-over is coherent (2.3)', () => {
  // A deterministic "pattern": a 1 s bar of four clicks (decaying bursts, a different pitch on
  // each beat) over a low tone, so a shift by whole beats is still told apart.
  const pattern = (seconds) => {
    const t = ((seconds % 1) + 1) % 1;
    const beat = Math.floor(t / 0.25);
    const beatPos = t - beat * 0.25;
    const click = Math.exp(-beatPos * 60) * Math.sin(2 * Math.PI * (800 + 400 * beat) * beatPos);
    return 0.3 * click + 0.2 * Math.sin(2 * Math.PI * 55 * seconds);
  };

  function settleWithLag() {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, (n) => pattern(n / SR));
    r.run(blocksFor(2));
    dsp.grab();
    r.run(blocksFor(0.6)); // → 3 beats behind (0.75 s): not a whole bar
    dsp.release({ id: 4, beatSeconds: 0.25 });
    for (let i = 0; i < blocksFor(3) && !r.events.length; i++) r.run(1);
    const e = r.events[0];
    expect(e.type).toBe('lagSettled');
    expect(e.lag).toBeCloseTo(0.75, 9);
    return { dsp, r, D: e.lag };
  }

  it('crossfades from the record to the shifted live input with no step (RMS step < 0.5 dB, max error tiny)', () => {
    const { dsp, r, D } = settleWithLag();
    // The main thread shifts the pattern by D; the shifted audio reaches the input at sample S.
    const S = r.n + blocksFor(0.15) * BLOCK;
    r.fn = (n) => (n >= S ? pattern(n / SR - D) : pattern(n / SR));
    dsp.handOver(4, S + Math.round(0.005 * SR));
    r.run(blocksFor(0.15));
    const from = r.out.length;
    r.run(blocksFor(0.1));
    const out = r.out.slice(from);
    const ref = out.map((_, i) => pattern((r.n - out.length + i) / SR - D));
    let maxErr = 0;
    for (let i = 0; i < out.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - ref[i]));
    // The record path's 10 Hz DC blocker is the only difference (a few % on the 55 Hz tone).
    expect(maxErr).toBeLessThan(0.05);
    // RMS over 10 ms windows: within 0.5 dB of the reference everywhere around the switch.
    const W = Math.round(0.01 * SR);
    for (let w = 0; w + W <= out.length; w += W) {
      const db = 20 * Math.log10(rms(out.slice(w, w + W)) / rms(ref.slice(w, w + W)));
      expect(Math.abs(db)).toBeLessThan(0.5);
    }
    expect(r.events.map((e) => e.type)).toEqual(['lagSettled', 'idle']);
    expect(dsp.phase).toBe('live');
    // After the hand-over the output is the live input, bit-exact.
    const tail = r.run(3);
    expect(tail).toEqual(r.inp.slice(-tail.length));
  });

  it('negative pair: without the shift (live input not moved) the same hand-over is not coherent', () => {
    const { dsp, r, D } = settleWithLag();
    const S = r.n + blocksFor(0.15) * BLOCK;
    dsp.handOver(4, S);
    r.run(blocksFor(0.15));
    const from = r.out.length;
    r.run(blocksFor(0.1));
    const out = r.out.slice(from);
    let maxErr = 0;
    for (let i = 0; i < out.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(out[i] - pattern((r.n - out.length + i) / SR - D)));
    }
    expect(maxErr).toBeGreaterThan(0.1);
  });

  it('a grab during the 20 ms hand-over crossfade waits for it, then starts from live', () => {
    const { dsp, r } = settleWithLag();
    dsp.handOver(4, r.n);
    r.run(1); // the crossfade has begun
    expect(dsp.phase).toBe('handOver');
    dsp.grab();
    expect(dsp.phase).toBe('handOver');
    expect(dsp.grabbed).toBe(true);
    r.run(blocksFor(0.05));
    expect(dsp.phase).toBe('held');
    expect(dsp.lag).toBeLessThan(0.1 * SR); // started at "now", not 3 beats back
  });

  it('a grab of a settled record with no hand-over scheduled starts at once (the main thread ignores that lag)', () => {
    const { dsp } = settleWithLag();
    const lag = dsp.lag;
    dsp.grab();
    expect(dsp.phase).toBe('held');
    expect(dsp.lag).toBe(lag);
  });

  it('negative pair: a settled record with no hand-over goes back to live by itself after 3 s', () => {
    const { dsp, r } = settleWithLag();
    r.run(blocksFor(2.9));
    expect(dsp.phase).toBe('settled');
    r.run(blocksFor(0.2));
    expect(dsp.phase).toBe('live');
  });
});

describe('scratchPhysics 023', () => {
  it('plans: snap rounds the nominal end lag to the beat; tiny lags become 0; the spin-up stretches within [0.2, 0.8] s', () => {
    expect(planScratchSpinUp({ lagSeconds: 0.9, fromRate: 0, beatSeconds: 0.5 })).toMatchObject({
      targetSeconds: 1,
      upSeconds: 0.2,
    });
    const longer = planScratchSpinUp({ lagSeconds: 1.2, fromRate: 0, beatSeconds: 0.5 });
    expect(longer.targetSeconds).toBe(1.5);
    expect(longer.upSeconds).toBeCloseTo(0.6, 12);
    expect(planScratchSpinUp({ lagSeconds: 0.9, fromRate: 0, beatSeconds: 0 }).targetSeconds).toBeCloseTo(1.1, 12);
    expect(planScratchSpinUp({ lagSeconds: 0.01, fromRate: 0.95, beatSeconds: 0 }).targetSeconds).toBe(0);
    expect(
      planScratchSpinUp({ lagSeconds: 7.9, fromRate: 0, beatSeconds: 0.5, maxLagSeconds: 7.4 }).targetSeconds,
    ).toBe(7);
  });

  it('bump lengths keep the rate within the limits', () => {
    expect(scratchBumpSeconds(0.1)).toBeCloseTo(0.7, 12); // slow down: at least 0.7 s (review 3)
    expect(scratchBumpSeconds(0.3)).toBeCloseTo(1.2, 12); // a big error: rate ≥ 0.5, longer
    expect(scratchBumpSeconds(-0.05)).toBeCloseTo(1, 12); // speed up to ≤ 1.1
    expect(scratchBumpSeconds(-0.3, true)).toBeCloseTo(1.2, 12); // catch up to 0 at ≤ 1.5
    expect(scratchBumpSeconds(-0.3)).toBeCloseTo(1.5, 12); // long: allowed up to 1.4×
    expect(SCRATCH_MIN_LAG_SAMPLES).toBe(2);
  });
});
