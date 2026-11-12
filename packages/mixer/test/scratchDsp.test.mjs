/**
 * Spec 019 tech §2.2 / §4: the pure scratch DSP, fed known signals block by block.
 */
import { describe, it, expect } from 'vitest';
import { ScratchDsp, SCRATCH_MAX_RATE } from '../scratch/scratchDsp.mjs';

const SR = 48000;
const BLOCK = 128;
const RAMP = Math.floor(0.01 * SR); // 480 samples = 10 ms

/** A deterministic signal source: fn(sampleIndex) → value, per channel (channel 1 = −value). */
function makeSource(fn) {
  let n = 0;
  return {
    get n() {
      return n;
    },
    next(frames = BLOCK) {
      const l = new Float32Array(frames);
      const r = new Float32Array(frames);
      for (let i = 0; i < frames; i++, n++) {
        l[i] = fn(n);
        r[i] = -fn(n);
      }
      return [l, r];
    },
  };
}

/** Run `blocks` blocks; returns the concatenated [left, right] output and the inputs. */
function run(dsp, src, blocks, onBlock) {
  const outL = [];
  const outR = [];
  const inL = [];
  for (let b = 0; b < blocks; b++) {
    onBlock?.(b);
    const input = src.next();
    const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    dsp.process(input, output, BLOCK);
    outL.push(...output[0]);
    outR.push(...output[1]);
    inL.push(...input[0]);
  }
  return { left: outL, right: outR, inLeft: inL };
}

const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length));
const sine = (f) => (n) => 0.5 * Math.sin((2 * Math.PI * f * n) / SR);
// A non-periodic signal so forwards and backwards are distinguishable: an up-chirp 200 → 1000 Hz
// over 1 s, repeating.
const chirp = (n) => {
  const t = (n % SR) / SR;
  return 0.5 * Math.sin(2 * Math.PI * (200 * t + 400 * t * t));
};
const blocksFor = (seconds) => Math.ceil((seconds * SR) / BLOCK);

describe('ScratchDsp: idle', () => {
  it('passes the input through bit-exact when nobody holds the platter', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource((n) => Math.sin(n * 0.37) * 0.8 + 1e-7 * n);
    for (let b = 0; b < 50; b++) {
      const input = src.next();
      const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      dsp.process(input, output, BLOCK);
      expect(Array.from(output[0])).toEqual(Array.from(input[0]));
      expect(Array.from(output[1])).toEqual(Array.from(input[1]));
    }
  });

  it('negative pair: moveBy / setMotor without a grab change nothing (still bit-exact)', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(330));
    run(dsp, src, 20);
    dsp.moveBy(-1);
    dsp.setMotor(-1);
    const { left, inLeft } = run(dsp, src, 20);
    expect(left).toEqual(inLeft);
    expect(dsp.grabbed).toBe(false);
    expect(dsp.mix).toBe(0);
  });

  it('negative pair: release without a grab is a no-op', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(330));
    run(dsp, src, 10);
    dsp.release();
    const { left, inLeft } = run(dsp, src, 20);
    expect(left).toEqual(inLeft);
    expect(dsp.mix).toBe(0);
    expect(dsp.frozen).toBe(false);
  });

  it('treats a missing input (nothing connected) as silence', () => {
    const dsp = new ScratchDsp(SR, 2);
    const output = [new Float32Array(BLOCK).fill(9), new Float32Array(BLOCK).fill(9)];
    dsp.process([], output, BLOCK);
    expect(Math.max(...output[0].map(Math.abs))).toBe(0);
  });
});

describe('ScratchDsp: grab ramp', () => {
  it('reaches mix 1 within 10 ms, one linear step per sample, never a bigger jump', () => {
    const dsp = new ScratchDsp(SR, 2);
    // Constant live input 1 and a held (still) platter: out = (1 − mix), so out reveals mix.
    const src = makeSource(() => 1);
    run(dsp, src, 10);
    dsp.grab();
    const { left } = run(dsp, src, 8);
    const mixes = left.map((v) => 1 - v);
    const firstFull = mixes.findIndex((m) => m >= 1 - 1e-6);
    expect(firstFull).toBeGreaterThan(0);
    expect(firstFull).toBeLessThanOrEqual(RAMP); // ≤ 480 samples = 10 ms
    for (let i = 1; i < mixes.length; i++) {
      expect(Math.abs(mixes[i] - mixes[i - 1])).toBeLessThanOrEqual(1 / RAMP + 1e-6);
    }
    // The first sample after the grab is one step in, not a jump.
    expect(mixes[0]).toBeCloseTo(1 / RAMP, 6);
  });

  it('a held still platter is silent (standstill RMS ≈ 0), not a DC hold', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(0.5));
    dsp.grab();
    run(dsp, src, blocksFor(0.02)); // past the 10 ms ramp
    const { left, right } = run(dsp, src, blocksFor(0.2));
    expect(rms(left)).toBeLessThan(1e-4);
    expect(rms(right)).toBeLessThan(1e-4);
  });
});

describe('ScratchDsp: playback', () => {
  /** Best normalised correlation of y against x[K − m] (reverse) or x[K + m] (forward). */
  function bestCorrelation(y, x, reverse, kMin, kMax) {
    let best = -1;
    const ey = Math.sqrt(y.reduce((s, v) => s + v * v, 0));
    for (let k = kMin; k <= kMax; k++) {
      let dot = 0;
      let ex = 0;
      for (let m = 0; m < y.length; m++) {
        const xi = x[reverse ? k - m : k + m] ?? 0;
        dot += y[m] * xi;
        ex += xi * xi;
      }
      const c = dot / (ey * Math.sqrt(ex) || 1);
      if (c > best) best = c;
    }
    return best;
  }

  it('pulling back at normal speed reproduces the input reversed', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(chirp);
    const before = run(dsp, src, blocksFor(1.5)).inLeft;
    const grabAt = before.length; // the record holds samples [0, grabAt)
    dsp.grab();
    dsp.setMotor(-1);
    run(dsp, src, blocksFor(0.1)); // let the smoother and the velocity gain settle
    const { left } = run(dsp, src, blocksFor(0.1));
    // The read head has travelled ~0.1 s back (minus the smoother lag) when the window starts.
    const lo = grabAt - Math.round(0.12 * SR);
    const hi = grabAt - Math.round(0.08 * SR);
    const reverse = bestCorrelation(left, before, true, lo, hi);
    const forward = bestCorrelation(left, before, false, lo - 2 * left.length, hi);
    expect(reverse).toBeGreaterThan(0.98);
    expect(forward).toBeLessThan(0.5);
    // Same loudness as the source (velocity gain 1, DC blocker transparent at these frequencies).
    expect(rms(left)).toBeGreaterThan(0.33);
    expect(rms(left)).toBeLessThan(0.38);
  });

  it('per-block moveBy deltas (what the UI sends) give the same reversed audio', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(chirp);
    const before = run(dsp, src, blocksFor(1.5)).inLeft;
    const grabAt = before.length;
    dsp.grab();
    const move = () => dsp.moveBy(-BLOCK / SR);
    run(dsp, src, blocksFor(0.1), move);
    const { left } = run(dsp, src, blocksFor(0.1), move);
    const reverse = bestCorrelation(left, before, true, grabAt - Math.round(0.13 * SR), grabAt - Math.round(0.07 * SR));
    expect(reverse).toBeGreaterThan(0.97);
  });

  it('pushing forwards faster than normal plays faster (higher)', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(200));
    run(dsp, src, blocksFor(3));
    dsp.grab();
    dsp.setMotor(-1);
    run(dsp, src, blocksFor(1.5)); // go back 1.5 s so there is room to push forwards
    dsp.setMotor(2);
    run(dsp, src, blocksFor(0.05));
    const { left } = run(dsp, src, blocksFor(0.25));
    // Count zero crossings: 200 Hz at 2× ≈ 400 Hz → ≈ 200 crossings in 0.25 s.
    let crossings = 0;
    for (let i = 1; i < left.length; i++) if (left[i - 1] < 0 !== left[i] < 0) crossings++;
    expect(crossings).toBeGreaterThan(180);
    expect(crossings).toBeLessThan(220);
  });
});

describe('ScratchDsp: record edges', () => {
  it('pulling back past 8 s stops at the edge and goes silent', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(9)); // fill the whole ring
    dsp.grab();
    dsp.setMotor(-SCRATCH_MAX_RATE);
    run(dsp, src, blocksFor(1.1)); // 8 s at 8× = 1 s
    expect(dsp.posSeconds).toBeCloseTo(-8, 2);
    run(dsp, src, blocksFor(0.05)); // the stylus-velocity gain fades the stop (τ 5 ms)
    const { left } = run(dsp, src, blocksFor(0.2));
    expect(rms(left)).toBeLessThan(1e-3);
    // …and stays silent while still pulling back.
    dsp.moveBy(-5);
    expect(rms(run(dsp, src, blocksFor(0.2)).left)).toBeLessThan(1e-3);
    // Moving forwards again brings the sound back.
    dsp.setMotor(1);
    run(dsp, src, blocksFor(0.05));
    expect(rms(run(dsp, src, blocksFor(0.1)).left)).toBeGreaterThan(0.3);
  });

  it('pushing forwards past the grab point is silent', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(1));
    dsp.grab();
    dsp.moveBy(+2);
    dsp.setMotor(4);
    run(dsp, src, blocksFor(0.03));
    expect(dsp.posSeconds).toBe(0);
    expect(rms(run(dsp, src, blocksFor(0.2)).left)).toBeLessThan(1e-4);
  });
});

describe('ScratchDsp: release', () => {
  it('ramps back to live within 10 ms with no step bigger than one increment', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(() => 1);
    run(dsp, src, 10);
    dsp.grab();
    run(dsp, src, 10); // fully on the (still, silent) scratch
    dsp.release();
    const { left } = run(dsp, src, 8);
    const firstLive = left.findIndex((v) => v >= 1 - 1e-6);
    expect(firstLive).toBeGreaterThan(0);
    expect(firstLive).toBeLessThanOrEqual(RAMP);
    for (let i = 1; i < left.length; i++) {
      expect(Math.abs(left[i] - left[i - 1])).toBeLessThanOrEqual(1 / RAMP + 1e-6);
    }
  });

  it('live is continuous through the release ramp and bit-exact after it', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(440));
    run(dsp, src, blocksFor(1));
    dsp.grab();
    dsp.setMotor(-1);
    run(dsp, src, blocksFor(0.3));
    dsp.release();
    const { left, inLeft } = run(dsp, src, 8);
    // Max slope of a 0.5-amplitude 440 Hz sine per sample, plus the scratch's own, plus one step.
    const maxSlope = 2 * Math.PI * 440 * 0.5 * (2 / SR) + 1 / RAMP;
    for (let i = 1; i < left.length; i++) {
      expect(Math.abs(left[i] - left[i - 1])).toBeLessThanOrEqual(maxSlope + 1e-3);
    }
    // Past the ramp the output is the live input again, bit-exact.
    expect(left.slice(RAMP + 1)).toEqual(inLeft.slice(RAMP + 1));
    const after = run(dsp, src, 5);
    expect(after.left).toEqual(after.inLeft);
    expect(dsp.active).toBe(false);
  });

  it('writing resumes at once on release, so the next grab hears the newest audio', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(1));
    dsp.grab();
    run(dsp, src, 5);
    const idx = dsp.writeIndex;
    dsp.release();
    run(dsp, src, 4);
    expect(dsp.writeIndex).toBe((idx + 4 * BLOCK) % dsp.length);
  });
});

describe('ScratchDsp: guards', () => {
  it('ignores NaN and ±Infinity in moveBy and setMotor', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(1));
    dsp.grab();
    dsp.moveBy(-0.2);
    const target = dsp.targetPos;
    dsp.moveBy(NaN);
    dsp.moveBy(Infinity);
    dsp.moveBy(-Infinity);
    dsp.moveBy('1');
    expect(dsp.targetPos).toBe(target);
    dsp.setMotor(0.5);
    dsp.setMotor(NaN);
    dsp.setMotor(-Infinity);
    expect(dsp.motorRate).toBe(0.5);
    const { left } = run(dsp, src, 20);
    expect(left.every(Number.isFinite)).toBe(true);
  });

  it('clamps the motor and the read-head speed to 8×', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(9));
    dsp.grab();
    dsp.setMotor(-1000);
    expect(dsp.motorRate).toBe(-SCRATCH_MAX_RATE);
    dsp.setMotor(0);
    dsp.moveBy(-7); // a huge jump becomes at most 8 samples per sample
    let prev = dsp.pos;
    for (let b = 0; b < 20; b++) {
      run(dsp, src, 1);
      expect(prev - dsp.pos).toBeLessThanOrEqual(SCRATCH_MAX_RATE * BLOCK + 1e-6);
      prev = dsp.pos;
    }
    expect(run(dsp, src, 20).left.every(Number.isFinite)).toBe(true);
  });

  it('a re-grab during the release ramp keeps the read head on the same recorded sample', () => {
    const dsp = new ScratchDsp(SR, 2);
    const src = makeSource(sine(220));
    run(dsp, src, blocksFor(1));
    dsp.grab();
    dsp.setMotor(-1);
    run(dsp, src, blocksFor(0.2));
    dsp.release();
    run(dsp, src, 1);
    const absBefore = dsp.grabIndex - 2 + dsp.pos;
    const written = dsp.writtenSinceRelease;
    dsp.grab();
    expect(dsp.grabIndex - 2 + dsp.pos).toBeCloseTo(absBefore, 6);
    expect(written).toBe(BLOCK);
  });
});
