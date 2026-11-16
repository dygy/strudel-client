/**
 * @spec: 032-master-fx (functional §2.4, tech §2.2 "Beat-repeat worklet", tech §4)
 * The pure roll core on plain Float32Arrays: idle copy exactness, first pass live, wrap equality,
 * slip on release, length change at the wrap, clamping, crossfades (no step beyond the program's own).
 *
 * Most cases run at 1 kHz with a ramp input (sample value = its absolute frame number), so "the
 * output is slice frame k" reads straight off the output.
 */
import { describe, it, expect } from 'vitest';
import {
  createRollState,
  processBlock,
  rollStart,
  rollLength,
  rollStop,
  rollActive,
  BEAT_REPEAT_MIN_LENGTH_FRAMES,
} from '../masterfx/beatRepeatCore.mjs';

const SR = 1000;
const BLOCK = 128;

/** Run `frames` frames of `signal(frame, channel)` through the core, block by block; returns per-channel output. */
function run(state, frames, signal = (f) => f, channels = state.channels, onBlock) {
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let done = 0; done < frames; done += BLOCK) {
    const n = Math.min(BLOCK, frames - done);
    onBlock?.(state.frame);
    const input = Array.from({ length: channels }, (_, c) => {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = signal(state.frame + i, c);
      return a;
    });
    const output = Array.from({ length: channels }, () => new Float32Array(n));
    processBlock(state, input, output);
    for (let c = 0; c < channels; c++) out[c].set(output[c], done);
  }
  return out;
}

const small = (opts = {}) => createRollState({ channels: 2, sampleRate: SR, ...opts }); // fade = 3 frames

describe('beat-repeat core: idle', () => {
  it('copies the input exactly, every channel, with no latency (and keeps the frame counter)', () => {
    const state = createRollState({ channels: 3, sampleRate: 48000 });
    const signal = (f, c) => Math.sin(f * 0.01 + c) * 0.7 + 1e-7 * c;
    const out = run(state, 1000, signal, 3);
    for (let c = 0; c < 3; c++) {
      for (let f = 0; f < 1000; f++) expect(out[c][f]).toBe(Math.fround(signal(f, c)));
    }
    expect(state.frame).toBe(1000);
    expect(rollActive(state)).toBe(false);
  });

  it('no input (disconnected) gives silence, not an error', () => {
    const state = small();
    const output = [new Float32Array(BLOCK).fill(9), new Float32Array(BLOCK).fill(9)];
    processBlock(state, [], output);
    expect([...output[0], ...output[1]].every((v) => v === 0)).toBe(true);
  });

  it('negative: while a roll loops, the output is not the input', () => {
    const state = small();
    run(state, 1000);
    rollStart(state, 1000, 200);
    const out = run(state, 600);
    let same = 0;
    for (let i = 300; i < 600; i++) if (out[0][i] === 1000 + i) same++;
    expect(same).toBe(0);
  });
});

describe('beat-repeat core: roll', () => {
  it('first pass is live; then the slice repeats, each repeat equal to the first (outside the crossfades)', () => {
    const state = small();
    run(state, 2000);
    rollStart(state, 2000, 500); // pressed on the line
    const out = run(state, 2000)[0];
    for (let i = 0; i < 500; i++) expect(out[i]).toBe(2000 + i); // live first pass
    for (let i = 500; i < 2000; i++) {
      const k = (i - 500) % 500;
      if (k >= 3) expect(out[i]).toBe(2000 + k); // the slice, phase-locked to the line
    }
    expect(rollActive(state)).toBe(true);
  });

  it('a press after the line plays live to the end of the slice, then repeats from the line', () => {
    const state = small();
    run(state, 3100);
    rollStart(state, 3000, 500); // pressed 100 ms after the line
    const out = run(state, 1200)[0];
    for (let i = 0; i < 400; i++) expect(out[i]).toBe(3100 + i); // unchanged until 0.4 s after the press
    for (let i = 403; i < 900; i++) expect(out[i]).toBe(3000 + (i - 400)); // then from the line
  });

  it('a press later than one slice after the line loops at once, phase-locked, crossfading from live', () => {
    const state = small();
    run(state, 1700);
    rollStart(state, 1000, 300); // 700 frames after the line: 2 passes + 100
    const out = run(state, 400)[0];
    expect(out[0]).toBe(1700); // the crossfade starts at live (gain 1 on live at pos 0)
    for (let i = 3; i < 200; i++) expect(out[i]).toBe(1000 + ((700 + i) % 300));
  });

  it('release: after the 3-frame crossfade the output is the live input where the track is now (the slip)', () => {
    const state = small();
    run(state, 1000);
    rollStart(state, 1000, 200);
    run(state, 1000); // looping
    rollStop(state);
    const out = run(state, 300)[0];
    for (let i = 3; i < 300; i++) expect(out[i]).toBe(2000 + i);
    expect(rollActive(state)).toBe(false);
  });

  it('release during the first pass changes nothing (the output is live already)', () => {
    const state = small();
    run(state, 1000);
    rollStart(state, 1000, 500);
    run(state, 100);
    rollStop(state);
    const out = run(state, 600)[0];
    for (let i = 0; i < 600; i++) expect(out[i]).toBe(1100 + i);
  });

  it('a length change applies at the next wrap, not mid-pass', () => {
    const state = small();
    run(state, 1000);
    rollStart(state, 1000, 400);
    const out = run(state, 1600, undefined, 2, (frame) => {
      if (frame === 1000 + 512) rollLength(state, 200); // during the second pass (pos 112 of 400)
    })[0];
    // Second pass (frames 400..799 after the press) still plays the 400-frame slice.
    for (let i = 403; i < 800; i++) expect(out[i]).toBe(1000 + (i - 400));
    // From the third pass on, 200 frames.
    for (let i = 803; i < 1000; i++) expect(out[i]).toBe(1000 + (i - 800));
    for (let i = 1003; i < 1200; i++) expect(out[i]).toBe(1000 + (i - 1000));
  });

  it('a held roll outlasts the 8 s ring: the slice is kept (copied as it is heard)', () => {
    const state = small({ ringSeconds: 2 }); // 2000-frame ring, slices up to 1000 frames
    run(state, 500);
    rollStart(state, 400, 300); // part of the slice is before the press
    const out = run(state, 6000)[0];
    for (let i = 5000; i < 6000; i++) {
      const k = (100 + i - 300) % 300; // offset from the line
      if ((i + 100) % 300 >= 3) expect(out[i]).toBe(400 + k);
    }
  });

  it('a new roll during a roll crossfades from the old loop, then plays the new one', () => {
    const state = small();
    run(state, 1000);
    rollStart(state, 1000, 200);
    run(state, 600);
    rollStart(state, 1600, 150);
    const out = run(state, 400)[0];
    expect(out[0]).not.toBe(1600); // the crossfade starts at the old loop
    for (let i = 3; i < 150; i++) expect(out[i]).toBe(1600 + i); // new first pass: live
    for (let i = 153; i < 300; i++) expect(out[i]).toBe(1600 + (i - 150));
  });
});

describe('beat-repeat core: clamping and junk', () => {
  it('a start in the future is treated as now', () => {
    const state = small();
    run(state, 1000);
    rollStart(state, 5000, 200);
    expect(state.voice.start).toBe(1000);
  });

  it('a start older than the ring allows is clamped to the oldest usable frame', () => {
    const state = small();
    run(state, 9000);
    rollStart(state, 0, 200);
    expect(state.voice.start).toBe(9000 - (state.size - state.cap - BEAT_REPEAT_MIN_LENGTH_FRAMES));
  });

  it('lengths are kept between the minimum and half the ring; junk changes nothing', () => {
    const state = small();
    run(state, 1000);
    expect(rollStart(state, 1000, NaN)).toBe(false);
    expect(state.voice).toBeNull();
    rollStart(state, 1000, 5);
    expect(state.voice.len).toBe(BEAT_REPEAT_MIN_LENGTH_FRAMES);
    rollStart(state, 1000, 1e9);
    expect(state.voice.len).toBe(state.size / 2);
    expect(rollLength(state, 'x')).toBe(false);
  });
});

describe('beat-repeat core: crossfades (48 kHz, 3 ms)', () => {
  const sine = (f) => Math.sin((2 * Math.PI * 440 * f) / 48000);
  const maxStep = (a, from = 1) => {
    let m = 0;
    for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
    return m;
  };
  const inputStep = (2 * Math.PI * 440) / 48000;
  // A slice whose end and head are half a period apart, starting on a peak: a hard wrap jumps by ~2.
  const LEN = 12000 + 55;
  const START = 48000 + 27;

  it('press, wraps and release step no more than ~the program itself', () => {
    const state = createRollState({ channels: 1, sampleRate: 48000 });
    run(state, START, sine, 1);
    rollStart(state, START, LEN);
    const looping = run(state, 4 * LEN, sine, 1)[0];
    rollStop(state);
    const after = run(state, 2000, sine, 1)[0];
    const all = new Float32Array([...looping, ...after]);
    expect(maxStep(all)).toBeLessThan(1.6 * inputStep);
  });

  it('negative: with a 1-frame "crossfade" the wrap jumps far beyond the program', () => {
    const state = createRollState({ channels: 1, sampleRate: 48000, fadeSeconds: 1 / 48000 });
    run(state, START, sine, 1);
    rollStart(state, START, LEN);
    const looping = run(state, 2 * LEN, sine, 1)[0];
    expect(maxStep(looping)).toBeGreaterThan(10 * inputStep);
  });
});
