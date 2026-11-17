/**
 * @spec: 033-loudness-meter (functional §2.2–2.4, tech §2.1, §4)
 * The pure loudness core on synthetic buffers: K-weighting against the BS.1770-4 table, the EBU
 * Tech 3341 / 3342 cases that can be synthesised (stereo 1 kHz sine, gating sequences, true-peak 45°
 * at fs/4, LRA steps), sample peak / RMS, the three over reasons each with its negative pair, the
 * 0.5 s event merge, float32 thresholds, reset, and mono counted as L = R.
 */
import { describe, it, expect } from 'vitest';
import {
  LoudnessMeterCore,
  kWeightingCoefficients,
  powerToLufs,
  TRUE_PEAK_FIR,
  LOUDNESS_HISTOGRAM,
} from '../meter/loudnessCore.mjs';

const SR = 48000;
const dbToLin = (db) => 10 ** (db / 20);

/**
 * Feed `core` a sequence of segments in 128-frame blocks (a render quantum), stereo L = R unless
 * `channels` is 1. A segment is `{ seconds, db | amp, freq = 1000, phase = 0 }`; `db: null` is silence.
 * `pre` (optional) builds the pre-limiter block from the post block.
 */
function feed(core, segments, { block = 128, sampleRate = SR, channels = 2, pre = null } = {}) {
  let t = 0;
  for (const { seconds, db, amp, freq = 1000, phase = 0, samples } of segments) {
    const A = amp ?? (db == null ? 0 : dbToLin(db));
    const total = Math.round(seconds * sampleRate);
    for (let i = 0; i < total; i += block) {
      const n = Math.min(block, total - i);
      const a = new Float32Array(n);
      for (let k = 0; k < n; k++)
        a[k] = samples ? samples(t + k) : A * Math.sin((2 * Math.PI * freq * (t + k)) / sampleRate + phase);
      t += n;
      const post = channels === 1 ? [a] : [a, a];
      core.process(post, pre ? pre(post) : null);
    }
  }
}

const meter = (sampleRate = SR) => new LoudnessMeterCore({ sampleRate });

describe('kWeightingCoefficients (BS.1770-4)', () => {
  it('reproduces the standard table at 48 kHz to 1e-6', () => {
    const { pre, rlb } = kWeightingCoefficients(48000);
    const close = (got, want) => got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(1e-6));
    close(pre.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    close(pre.a, [1, -1.69065929318241, 0.73248077421585]);
    close(rlb.b, [1, -2, 1]);
    close(rlb.a, [1, -1.99004745483398, 0.99007225036621]);
  });

  it('differs at other rates (derived, not a fixed table), and rejects a bad rate', () => {
    const at44 = kWeightingCoefficients(44100);
    expect(Math.abs(at44.pre.a[1] - -1.69065929318241)).toBeGreaterThan(1e-3);
    expect(() => kWeightingCoefficients(0)).toThrow(RangeError);
  });

  it.each([44100, 48000, 96000])('a −23 dBFS stereo 1 kHz sine reads −23.0 ± 0.1 LUFS at %i Hz', (rate) => {
    const core = meter(rate);
    feed(core, [{ seconds: 5, db: -23 }], { sampleRate: rate, block: 4096 });
    expect(core.integratedLoudness()).toBeCloseTo(-23, 0);
    expect(Math.abs(core.integratedLoudness() + 23)).toBeLessThan(0.1);
  });
});

describe('the Annex 2 true-peak FIR', () => {
  it('has 4 phases of 12 taps, the middle phases mirrored', () => {
    expect(TRUE_PEAK_FIR).toHaveLength(4);
    TRUE_PEAK_FIR.forEach((phase) => expect(phase).toHaveLength(12));
    expect([...TRUE_PEAK_FIR[2]].reverse()).toEqual([...TRUE_PEAK_FIR[1]]);
    expect([...TRUE_PEAK_FIR[3]].reverse()).toEqual([...TRUE_PEAK_FIR[0]]);
  });
});

describe('loudness (EBU Tech 3341)', () => {
  it('a stereo 1 kHz sine at −23 dBFS for 20 s: M, S and I at −23.0 ± 0.1', () => {
    const core = meter();
    feed(core, [{ seconds: 20, db: -23 }]);
    const s = core.snapshot();
    expect(Math.abs(s.m + 23)).toBeLessThan(0.1);
    expect(Math.abs(s.s + 23)).toBeLessThan(0.1);
    expect(Math.abs(s.i + 23)).toBeLessThan(0.1);
    expect(s.measuredSeconds).toBeCloseTo(20, 6);
  });

  it('negative: a −33 dBFS sine does not read −23 (the reading follows the level)', () => {
    const core = meter();
    feed(core, [{ seconds: 5, db: -33 }]);
    expect(Math.abs(core.snapshot().s + 33)).toBeLessThan(0.1);
  });

  it('sine then 20 s of silence: I unchanged (silence gated out), M and S become null', () => {
    const core = meter();
    feed(core, [{ seconds: 20, db: -23 }]);
    const before = core.snapshot().i;
    feed(core, [{ seconds: 20, db: null }]);
    const s = core.snapshot();
    expect(Math.abs(s.i + 23)).toBeLessThan(0.1);
    expect(Math.abs(s.i - before)).toBeLessThan(0.1);
    expect(s.m).toBeNull();
    expect(s.s).toBeNull();
  });

  it('−23 then −43 dBFS: the relative gate keeps I at −23 ± 0.5 (negative: ungated it would be ~−26)', () => {
    const core = meter();
    feed(core, [
      { seconds: 20, db: -23 },
      { seconds: 20, db: -43 },
    ]);
    const { i } = core.snapshot();
    expect(Math.abs(i + 23)).toBeLessThan(0.5);
    // The absolute-gated mean of the two halves is ~3 dB lower: the gate is what keeps I at −23.
    const ungated = powerToLufs((dbToLin(-23) ** 2 + dbToLin(-43) ** 2) / 2);
    expect(i - ungated).toBeGreaterThan(2.5);
  });

  it('silence alone gives null everywhere, never −Infinity', () => {
    const core = meter();
    feed(core, [{ seconds: 3, db: null }]);
    const s = core.snapshot();
    for (const key of ['m', 's', 'i', 'lra', 'tpMax', 'tpBlock']) expect(s[key]).toBeNull();
    expect(s.peakDb).toEqual([null, null]);
    expect(s.rmsDb).toEqual([null, null]);
    expect(powerToLufs(0)).toBeNull();
    expect(powerToLufs(dbToLin(-80) ** 2)).toBeNull(); // below the absolute gate
  });

  it('a level louder than +5 LUFS lands in the top histogram bin but I keeps its exact power', () => {
    expect(LOUDNESS_HISTOGRAM.bins).toBe(7500);
    const core = meter();
    // A stereo 1 kHz sine at amplitude 2 (+6 dBFS) reads about +6 LUFS, above the histogram's +5.
    feed(core, [{ seconds: 2, amp: 2 }]);
    expect(core.snapshot().i).toBeGreaterThan(5);
  });
});

describe('loudness range (EBU Tech 3342)', () => {
  it('20 s at −20 then 20 s at −30 dBFS: LRA = 10 ± 1', () => {
    const core = meter();
    feed(core, [
      { seconds: 20, db: -20 },
      { seconds: 20, db: -30 },
    ]);
    expect(Math.abs(core.snapshot().lra - 10)).toBeLessThan(1);
  });

  it('negative: a steady level has LRA ≈ 0, and LRA is null before 10 s measured', () => {
    const core = meter();
    feed(core, [{ seconds: 9.9, db: -20 }]);
    expect(core.snapshot().lra).toBeNull();
    feed(core, [{ seconds: 5, db: -20 }]);
    expect(core.snapshot().lra).toBeLessThan(0.1);
  });
});

describe('true peak (4× oversampling)', () => {
  // EBU Tech 3341 case 15-style: a full-scale sine at fs/4, phase-shifted 45°: every sample is
  // ±0.7071 (−3.01 dBFS) while the waveform peaks at 0 dBFS between samples.
  const quarterRate45 = { seconds: 1, amp: 1, freq: SR / 4, phase: Math.PI / 4 };

  it('fs/4 sine at 45° with sample peak −3.01 dBFS: TP 0.0 ± 0.5 dBTP', () => {
    const core = meter();
    feed(core, [quarterRate45]);
    const s = core.snapshot();
    expect(s.peakDb[0]).toBeCloseTo(-3.01, 1);
    expect(Math.abs(s.tpMax)).toBeLessThan(0.5);
    expect(Math.abs(s.tpBlock)).toBeLessThan(0.5);
  });

  it('negative: the same sine at 0° (samples hit the peak) reads its sample peak, no overshoot', () => {
    const core = meter();
    // fs/4 at 0° has samples 0, A, 0, −A: the true peak is the sample peak.
    feed(core, [{ seconds: 1, amp: 0.5, freq: SR / 4, phase: 0 }]);
    const s = core.snapshot();
    expect(Math.abs(s.tpMax - 20 * Math.log10(0.5))).toBeLessThan(0.3);
  });

  it('tpMax holds since reset; tpBlock covers only the last 100 ms', () => {
    const core = meter();
    feed(core, [{ seconds: 1, db: -6 }]);
    feed(core, [{ seconds: 1, db: -30 }]);
    const s = core.snapshot();
    expect(Math.abs(s.tpMax + 6)).toBeLessThan(0.2);
    expect(Math.abs(s.tpBlock + 30)).toBeLessThan(0.2);
  });
});

describe('sample peak and RMS (300 ms)', () => {
  it('a stereo 1 kHz sine at −20 dBFS: RMS −23 ± 0.5, peak −20 ± 0.5 on both channels', () => {
    const core = meter();
    feed(core, [{ seconds: 1, db: -20 }]);
    const { peakDb, rmsDb } = core.snapshot();
    for (const c of [0, 1]) {
      expect(Math.abs(peakDb[c] + 20)).toBeLessThan(0.5);
      expect(Math.abs(rmsDb[c] + 23.01)).toBeLessThan(0.5);
    }
  });

  it('negative: 400 ms after a loud burst the 300 ms window has forgotten it', () => {
    const core = meter();
    feed(core, [
      { seconds: 0.5, db: -3 },
      { seconds: 0.4, db: -40 },
    ]);
    const { peakDb } = core.snapshot();
    expect(Math.abs(peakDb[0] + 40)).toBeLessThan(0.5);
  });

  it('channels are measured separately', () => {
    const core = meter();
    const l = new Float32Array(4800).fill(0.5);
    const r = new Float32Array(4800).fill(0.25);
    core.process([l, r]);
    const { peakDb } = core.snapshot();
    expect(peakDb[0]).toBeCloseTo(20 * Math.log10(0.5), 5);
    expect(peakDb[1]).toBeCloseTo(20 * Math.log10(0.25), 5);
  });
});

describe('over events (functional §2.4)', () => {
  /** A block of `n` samples at `value` (float32), stereo. */
  const dc = (value, n = 128) => {
    const a = new Float32Array(n).fill(value);
    return [a, a];
  };
  /** Feed `seconds` of a constant post level and an optional constant pre-limiter level. */
  const hold = (core, seconds, post, pre = undefined) => {
    const blocks = Math.round((seconds * SR) / 128);
    for (let i = 0; i < blocks; i++) core.process(dc(post), pre === undefined ? null : dc(pre));
  };

  it('truePeak: a true peak of −0.5 dBTP with sample peaks below −1 dBFS counts', () => {
    // fs/4 at 45° scaled so the samples sit at −3.51 dBFS and the waveform peaks at −0.5 dBTP.
    const core = meter();
    feed(core, [{ seconds: 0.2, amp: dbToLin(-0.5), freq: SR / 4, phase: Math.PI / 4 }]);
    const s = core.snapshot();
    expect(s.peakDb[0]).toBeLessThan(-1);
    expect(s.events.truePeak).toBe(1);
  });

  it('negative: a mix peaking at −3 dBTP counts nothing', () => {
    const core = meter();
    feed(core, [{ seconds: 2, db: -3 }]);
    expect(core.snapshot().events).toEqual({ truePeak: 0, limiter: 0, clip: 0 });
  });

  it('limiter: a pre-limiter sample at exactly −0.3 dBFS (float32) counts', () => {
    const core = meter();
    const ceiling = Math.fround(dbToLin(-0.3));
    // The float32 sample is just under the double-precision ceiling: the comparison must be float32.
    expect(ceiling).toBeLessThan(dbToLin(-0.3));
    hold(core, 0.1, 0.5, ceiling);
    expect(core.snapshot().events.limiter).toBe(1);
  });

  it('negative: a pre-limiter level one float32 step under −0.3 dBFS counts nothing', () => {
    const core = meter();
    const ceiling = Math.fround(dbToLin(-0.3));
    const under = ceiling - 2 ** -24; // the next float32 down
    expect(Math.fround(under)).toBeLessThan(ceiling);
    hold(core, 0.5, 0.5, Math.fround(under));
    expect(core.snapshot().events.limiter).toBe(0);
  });

  it('clip: a post-EQ sample at 0 dBFS counts while there is no pre-limiter input', () => {
    const core = meter();
    hold(core, 0.1, 1.0);
    const s = core.snapshot();
    expect(s.events.clip).toBe(1);
    expect(s.preLimiter).toBe(false);
  });

  it('negative: post-EQ at 0 dBFS is not "clip" while a pre-limiter input is present (the EQ limits)', () => {
    const core = meter();
    hold(core, 0.1, 1.0, 0.5);
    const s = core.snapshot();
    expect(s.events.clip).toBe(0);
    expect(s.preLimiter).toBe(true);
  });

  it('negative: a post-EQ level just under 0 dBFS is not clip', () => {
    const core = meter();
    hold(core, 0.2, Math.fround(1 - 2 ** -24));
    expect(core.snapshot().events.clip).toBe(0);
  });

  it('an event that lasts counts once; a gap of 0.5 s or more starts a new one', () => {
    const core = meter();
    hold(core, 1, 0.5, 0.99); // one long overload
    expect(core.snapshot().events.limiter).toBe(1);
    hold(core, 0.3, 0.5, 0.5); // a 0.3 s gap: the same event
    hold(core, 0.2, 0.5, 0.99);
    expect(core.snapshot().events.limiter).toBe(1);
    hold(core, 0.6, 0.5, 0.5); // a 0.6 s gap: a new event
    hold(core, 0.1, 0.5, 0.99);
    expect(core.snapshot().events.limiter).toBe(2);
  });
});

describe('reset and channels', () => {
  it('reset() clears I, TP, LRA, peaks, events and the measured time; measuring continues', () => {
    const core = meter();
    feed(core, [{ seconds: 12, db: -10 }]);
    feed(core, [{ seconds: 0.1, amp: 1 }]); // clip
    const before = core.snapshot();
    expect(before.i).not.toBeNull();
    expect(before.lra).not.toBeNull();
    expect(before.events.clip).toBe(1);

    core.reset();
    const after = core.snapshot();
    for (const key of ['m', 's', 'i', 'lra', 'tpMax', 'tpBlock']) expect(after[key]).toBeNull();
    expect(after.events).toEqual({ truePeak: 0, limiter: 0, clip: 0 });
    expect(after.measuredSeconds).toBe(0);

    feed(core, [{ seconds: 2, db: -23 }]);
    expect(Math.abs(core.snapshot().i + 23)).toBeLessThan(0.1);
  });

  it('a mono input counts as L = R (negative: one silent channel reads 3 dB lower)', () => {
    const mono = meter();
    feed(mono, [{ seconds: 3, db: -23 }], { channels: 1 });
    const stereo = meter();
    feed(stereo, [{ seconds: 3, db: -23 }]);
    expect(Math.abs(mono.snapshot().s - stereo.snapshot().s)).toBeLessThan(1e-9);

    const oneSided = meter();
    const silent = new Float32Array(128);
    let t = 0;
    for (let i = 0; i < (3 * SR) / 128; i++) {
      const a = new Float32Array(128);
      for (let k = 0; k < 128; k++, t++) a[k] = dbToLin(-23) * Math.sin((2 * Math.PI * 1000 * t) / SR);
      oneSided.process([a, silent]);
    }
    expect(Math.abs(oneSided.snapshot().s - (stereo.snapshot().s - 3.01))).toBeLessThan(0.05);
  });

  it('an absent input with a frame count is measured as silence (time still passes)', () => {
    const core = meter();
    core.process([], null, 128);
    core.process(null, null, 4800);
    const s = core.snapshot();
    expect(s.measuredSeconds).toBeCloseTo(4928 / SR, 9);
    expect(s.m).toBeNull();
  });

  it('the snapshot is plain structured-cloneable data', () => {
    const core = meter();
    feed(core, [{ seconds: 1, db: -20 }]);
    const s = core.snapshot();
    expect(structuredClone(s)).toEqual(s);
  });
});

describe('reset and the true-peak history', () => {
  it('a loud signal before reset does not leak into tpMax after it (the FIR history holds 11 old samples)', () => {
    const core = new LoudnessMeterCore({ sampleRate: SR });
    feed(core, [{ seconds: 0.5, db: -3 }]);
    core.reset();
    core.process([new Float32Array(128), new Float32Array(128)]);
    expect(core.snapshot().tpMax).toBeNull();
  });
});
