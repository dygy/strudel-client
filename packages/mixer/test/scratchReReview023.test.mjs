/**
 * @spec: 023-vinyl-scratch-realism (re-review fixes 1–4)
 *
 * 1. A restarted sample follows how far its envelope has run: a note that has decayed is not
 *    replayed (no ghost), and one mid-attack continues its ramp from where it is.
 * 2. A restarted synth fades in to its current envelope level and never goes above it (no bump
 *    to the peak and back down to the sustain).
 * 3. After a splice, the record's 8 s edge is where the ring's read reaches its end: silent there,
 *    and the rate reads 0.
 * 4. An Update during the spin-up: the shift starts when the record reaches its lag, and the
 *    worklet hands over only then, so the two timelines meet at the same position.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { note, sequence } from '@strudel/core';
import { ScratchDsp } from '../scratch/scratchDsp.mjs';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { ScratchController } from '../scratch/ScratchController.mjs';
import {
  PatternOffset,
  ScratchHandOver,
  SCRATCH_RESTART_KEY,
  SCRATCH_RESTART_SOUND,
  applyScratchRestartEnvelope,
  ensureScratchRestartSound,
  scratchEnvelopeLevel,
  scratchMidNoteValue,
  scratchPhaseDelay,
  scratchRestartEnvelope,
} from '../scratch/ScratchShift.mjs';
import { getADSRValues } from '../../superdough/helpers.mjs';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

const SR = 48000;
const BLOCK = 128;
const blocksFor = (seconds) => Math.ceil((seconds * SR) / BLOCK);
const rms = (arr) => Math.sqrt(arr.reduce((acc, v) => acc + v * v, 0) / Math.max(1, arr.length));

/** An AudioParam that records its automation and can tell its value at any time (linear ramps). */
function param() {
  const events = [];
  return {
    events,
    cancelScheduledValues(t) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].t >= t) events.splice(i, 1);
    },
    setValueAtTime(v, t) {
      events.push({ t, v, kind: 'set' });
    },
    linearRampToValueAtTime(v, t) {
      events.push({ t, v, kind: 'ramp' });
    },
    at(time) {
      let value = 0;
      let lastT = 0;
      for (const e of events) {
        if (e.t > time) {
          if (e.kind === 'ramp') return value + ((e.v - value) * (time - lastT)) / (e.t - lastT || 1);
          return value;
        }
        value = e.v;
        lastT = e.t;
      }
      return value;
    },
  };
}

const sampleDeps = (extra = {}) => ({
  getSound: () => ({ data: { type: 'sample', samples: ['x.wav'] } }),
  getSampleInfo: () => ({ playbackRate: 1, url: 'x.wav' }),
  getLoadedBuffer: () => ({ duration: extra.duration ?? 4 }),
  getDefaultValue: () => 'triangle',
});

describe('re-review 1: restarted samples follow their envelope (no ghosts)', () => {
  it('n("0 3").s("bass").decay(0.1), 0.4 s into its note: it has died away, so it is not replayed', () => {
    // The sampler's defaults: with only a decay set, superdough's sustain is 0.001 (silent).
    expect(getADSRValues([undefined, 0.1, undefined, undefined])[2]).toBe(0.001);
    expect(scratchMidNoteValue({ s: 'bass', n: 0, decay: 0.1 }, 0.4, sampleDeps())).toBeNull();
    // Negative pair: 0.05 s in, it is still decaying: restarted, at its current level.
    const v = scratchMidNoteValue({ s: 'bass', n: 0, decay: 0.1 }, 0.05, sampleDeps());
    expect(v.s).toBe(SCRATCH_RESTART_SOUND);
    const [, [fade, level]] = v[SCRATCH_RESTART_KEY].points;
    expect(fade).toBe(0.01);
    expect(level).toBeCloseTo(scratchEnvelopeLevel([0.001, 0.1, 0.001], 0.06), 12);
  });

  it('a sample with attack(0.5), 0.2 s in: the ramp continues from 0.4, it does not jump to full after 10 ms', () => {
    const v = scratchMidNoteValue({ s: 'pad', attack: 0.5 }, 0.2, sampleDeps());
    const { points } = v[SCRATCH_RESTART_KEY];
    expect(points[1][0]).toBe(0.01);
    expect(points[1][1]).toBeCloseTo(0.42, 12); // (0.2 + 0.01) / 0.5
    expect(points[2][0]).toBeCloseTo(0.3, 12); // peak when the original reaches it
    expect(points[2][1]).toBe(1);
  });

  it('the restart sound triggers the original with a flat envelope and puts the curve on its voice', async () => {
    const registry = new Map();
    const voiceGain = param();
    const original = vi.fn(async () => ({ node: { gain: voiceGain } }));
    registry.set('pad', { onTrigger: original, data: { type: 'sample' } });
    const deps = {
      getSound: (s) => registry.get(s),
      registerSound: (key, onTrigger, data) => registry.set(key, { onTrigger, data }),
    };
    ensureScratchRestartSound(deps);
    ensureScratchRestartSound(deps); // once
    expect(registry.get(SCRATCH_RESTART_SOUND).data).toMatchObject({ prebake: true });
    const v = scratchMidNoteValue({ s: 'pad', attack: 0.5, gain: 0.7 }, 0.2, sampleDeps());
    await registry.get(SCRATCH_RESTART_SOUND).onTrigger(10, { ...v, duration: 2 }, () => {}, 0.5);
    const passed = original.mock.calls[0][1];
    expect(passed).toMatchObject({ s: 'pad', attack: 0.001, decay: 0.001, sustain: 1, gain: 0.7 });
    expect(passed[SCRATCH_RESTART_KEY]).toBeUndefined();
    expect(passed.release).toBeUndefined(); // so the sampler still holds it for its slice
    expect(voiceGain.at(10)).toBe(0);
    expect(voiceGain.at(10.01)).toBeCloseTo(0.42, 9);
    expect(voiceGain.at(10.3)).toBeCloseTo(1, 9);
  });
});

describe('re-review 2: a restarted synth never goes above the note it continues', () => {
  const cases = [
    { name: 'defaults, at the sustain', params: [undefined, undefined, undefined, undefined], elapsed: 3 },
    { name: 'mid-decay', params: [0.05, 1, 0.3, 0.2], elapsed: 0.4 },
    { name: 'mid-attack', params: [1, 0.5, 0.6, 0.1], elapsed: 0.3 },
    { name: 'just past the attack', params: [0.01, 0.2, 0.6, 0.1], elapsed: 0.02 },
  ];
  for (const { name, params, elapsed } of cases) {
    it(`${name}: the restarted level ≤ the original's level at every moment, and reaches it after the fade`, () => {
      const adsr = getADSRValues(params, 'linear', [0.001, 0.05, 0.6, 0.01]);
      const points = scratchRestartEnvelope(adsr, elapsed);
      const gain = param();
      applyScratchRestartEnvelope(gain, points, 0, 5, adsr[3]);
      for (let tau = 0; tau <= 3; tau += 0.001) {
        expect(gain.at(tau)).toBeLessThanOrEqual(scratchEnvelopeLevel(adsr, elapsed + tau) + 1e-9);
      }
      for (let tau = 0.011; tau <= 3; tau += 0.01) {
        expect(gain.at(tau)).toBeCloseTo(scratchEnvelopeLevel(adsr, elapsed + tau), 6);
      }
    });
  }

  it('negative pair: the old restart (attack 10 ms to peak 1, then decay to 0.6) went 4.4 dB above', () => {
    const adsr = getADSRValues([0.01, 0.001, 0.6, 0.01]);
    expect(20 * Math.log10(scratchEnvelopeLevel(adsr, 0.01) / 0.6)).toBeCloseTo(4.437, 3);
  });

  it('the hold and release end the note when the original would', () => {
    const gain = param();
    applyScratchRestartEnvelope(
      gain,
      [
        [0, 0],
        [0.01, 0.6],
      ],
      2,
      3,
      0.2,
    );
    expect(gain.at(2.5)).toBeCloseTo(0.6, 9);
    expect(gain.at(3)).toBeCloseTo(0.6, 9);
    expect(gain.at(3.1)).toBeCloseTo(0.3, 9);
    expect(gain.at(3.2)).toBeCloseTo(0, 9);
  });
});

describe('re-review 2: a restarted stock-waveform synth starts in phase with the note it continues', () => {
  it('δ < one period, so that f·(elapsed + δ) is a whole number of cycles', () => {
    const f = 220;
    for (const elapsed of [0.1234, 1.5, 3.00001, 2.7182]) {
      const d = scratchPhaseDelay({ note: 'a3' }, 'sawtooth', elapsed, () => f);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1 / f);
      const cycles = f * (elapsed + d);
      expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-6);
    }
  });

  it('negative pairs: a moving pitch (vibrato, pitch envelope, FM, detune, partials, noise) or another synth: no delay', () => {
    const f = () => 220;
    for (const k of ['vib', 'penv', 'fmi', 'detune', 'n', 'noise']) {
      expect(scratchPhaseDelay({ note: 'a3', [k]: 2 }, 'sine', 0.1234, f)).toBe(0);
    }
    expect(scratchPhaseDelay({ note: 'a3' }, 'supersaw', 0.1234, f)).toBe(0);
    expect(scratchPhaseDelay({ note: 'a3' }, 'sine', 0.1234, () => NaN)).toBe(0);
  });

  it('on the deck: the restart starts δ late, holds δ less, and the crossfade waits for its fade-in (capped by the lag)', async () => {
    stubWebAudio();
    const ac = new AudioContext();
    ac.currentTime = 20;
    const deck = new ScratchDeck(ac, { setPreGainInsert() {}, getPreGainInsert() {} });
    await deck.attach();
    const node = ac.workletNodes.at(-1);
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    repl = {
      scheduler: {
        started: true,
        cps: 0.5,
        latency: 0.1,
        lastEnd: 41,
        num_cycles_at_cps_change: 40,
        seconds_at_cps_change: 18,
        num_ticks_since_cps_change: 3,
        pattern: null,
      },
      setPattern: (p) => {
        repl.scheduler.pattern = offset.editPattern(p);
        return Promise.resolve();
      },
    };
    repl.setPattern(note('c2').s('sawtooth').slow(4));
    const trigger = vi.fn();
    new ScratchHandOver(deck, {
      getRepl: () => repl,
      offset,
      voices: { getActiveSoundIds: () => ['old'], releaseSounds: vi.fn() },
      trigger,
      midNoteValue: (v) => ({ ...v, [SCRATCH_RESTART_KEY]: { delaySeconds: 0.012 } }),
      ensureSound: () => {},
    });
    deck.grab();
    deck.release();
    node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 });
    const [, t, duration] = trigger.mock.calls[0];
    expect(t).toBeCloseTo(20.1 + 0.012, 9);
    expect(duration).toBeCloseTo(7 - 0.012, 9);
    expect(node.port.posted.at(-1).at).toBeCloseTo(20.1 + 0.012 + 0.01 + 0.001, 9);
    unstubWebAudio();
  });
});

describe('re-review 3: the 8 s edge after a splice', () => {
  it('pulled back to the ring’s oldest audio across a splice: silent, rate 0 (not playing on at 1×)', () => {
    const dsp = new ScratchDsp(SR, 2, 2); // a 2 s ring, so the edge is near
    const tone = (n) => 0.5 * Math.sin((2 * Math.PI * 220 * n) / SR);
    let fn = tone;
    const run = (blocks, each) => {
      const out = [];
      for (let b = 0; b < blocks; b++) {
        const l = new Float32Array(BLOCK);
        for (let i = 0; i < BLOCK; i++) l[i] = fn(dsp.n + i);
        const o = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
        dsp.process([l, l], o, BLOCK);
        out.push(...o[0]);
        dsp.takeEvent();
        each?.();
      }
      return out;
    };
    run(blocksFor(2.5));
    dsp.grab();
    run(blocksFor(0.6));
    dsp.release({ id: 1, beatSeconds: 0.25 });
    for (let i = 0; i < blocksFor(3) && dsp.phase !== 'settled'; i++) run(1);
    const D = dsp.lag;
    const S = dsp.n + Math.round(0.05 * SR);
    fn = (n) => (n >= S ? tone(n - D) : tone(n));
    dsp.handOver(1, S + 240, S);
    dsp.grab(); // straight after settling: spliced
    run(blocksFor(0.2)); // across the splice
    dsp.setMotor(-8);
    run(blocksFor(0.5)); // pulled back far past the shift point, to the ring's end
    expect(dsp.readLag(dsp.lag)).toBeCloseTo(dsp.maxLag, 6);
    let rates = [];
    const out = run(blocksFor(0.2), () => rates.push(dsp.rate));
    expect(rates.every((r) => r === 0)).toBe(true);
    expect(rms(out.slice(Math.round(0.05 * SR)))).toBeLessThan(1e-3);
    // Moving forwards again brings the sound back.
    dsp.setMotor(1);
    run(blocksFor(0.1));
    expect(rms(run(blocksFor(0.1)))).toBeGreaterThan(0.2);
  });
});

describe('re-review 4: an Update during the spin-up shifts the track from the landing on', () => {
  it('PatternOffset: a pending shift plays the track unshifted until its cycle, shifted from it (notes crossing it cut)', () => {
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    let now = 10;
    repl = {
      scheduler: { started: true, now: () => now, pattern: null },
      setPattern: (p) => {
        repl.scheduler.pattern = offset.editPattern(p);
        return Promise.resolve();
      },
    };
    const kick = sequence('bd', 'sd', 'hh', 'cp');
    repl.setPattern(kick);
    expect(offset.shift(0.5, { atCycle: 12 })).toBe(true);
    expect(offset.cycles).toBe(0);
    expect(offset.total).toBe(0.5);
    const values = (b, e) =>
      repl.scheduler.pattern
        .queryArc(b, e)
        .filter((h) => h.hasOnset())
        .map((h) => [h.whole.begin.valueOf(), h.value]);
    expect(values(11, 12)).toEqual([
      [11, 'bd'],
      [11.25, 'sd'],
      [11.5, 'hh'],
      [11.75, 'cp'],
    ]);
    expect(values(12, 13)).toEqual([
      [12, 'hh'],
      [12.25, 'cp'],
      [12.5, 'bd'],
      [12.75, 'sd'],
    ]);
    // A same-track Update before the start keeps the pending shift; long after it, it folds in.
    repl.setPattern(kick);
    expect(offset.pending).toEqual({ atCycle: 12, cycles: 0.5 });
    now = 13.5;
    repl.setPattern(kick);
    expect(offset.pending).toBeNull();
    expect(offset.cycles).toBe(0.5);
    expect(values(14, 14.3)).toEqual([
      [14, 'hh'],
      [14.25, 'cp'],
    ]);
    // Stop resets it all.
    offset.shift(0.25, { atCycle: 20 });
    offset.reset();
    expect(offset.total).toBe(0);
  });

  it('a note crossing the pending start is cut there (the old timeline ends where the new begins)', () => {
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    repl = {
      scheduler: { started: true, now: () => 0, pattern: null },
      setPattern: (p) => {
        repl.scheduler.pattern = offset.editPattern(p);
        return Promise.resolve();
      },
    };
    repl.setPattern(note('c2').slow(4));
    offset.shift(0.5, { atCycle: 2 });
    const before = repl.scheduler.pattern.queryArc(0, 2).filter((h) => h.hasOnset());
    expect(before).toHaveLength(1);
    expect(before[0].whole.end.valueOf()).toBe(2);
  });

  describe('on the deck', () => {
    let ac;
    beforeEach(() => {
      stubWebAudio();
      ac = new AudioContext();
      ac.currentTime = 20;
    });
    afterEach(() => unstubWebAudio());

    async function updateDuringSpinUp({ upSeconds = 0.2, bumpSeconds = 0.7, startTime = 19.95 } = {}) {
      const deck = new ScratchDeck(ac, { setPreGainInsert() {}, getPreGainInsert() {} });
      await deck.attach();
      const node = ac.workletNodes.at(-1);
      let repl;
      const offset = new PatternOffset({ getRepl: () => repl });
      repl = {
        scheduler: {
          started: true,
          cps: 0.5,
          latency: 0.1,
          lastEnd: 40.25,
          num_cycles_at_cps_change: 40,
          seconds_at_cps_change: 20,
          num_ticks_since_cps_change: 3,
          now: () => 40.1,
          pattern: null,
        },
        setPattern: (p) => {
          repl.scheduler.pattern = offset.editPattern(p);
          return Promise.resolve();
        },
      };
      repl.setPattern(note('c2').s('sawtooth').slow(4));
      const voices = { getActiveSoundIds: () => ['old'], releaseSounds: vi.fn() };
      const trigger = vi.fn();
      new ScratchHandOver(deck, {
        getRepl: () => repl,
        offset,
        voices,
        trigger,
        midNoteValue: (v) => v,
        ensureSound: () => {},
      });
      const scratch = new ScratchController();
      scratch.setDeck('main', deck);
      scratch.grab('pointer');
      scratch.release('pointer');
      node.port.reply({
        type: 'plan',
        id: deck.releaseId,
        targetSeconds: 1,
        upSeconds,
        fromRate: 0,
        bumpSeconds,
        bumpDepth: -0.07,
        startTime,
      });
      scratch.releaseAll({ commitPending: true }); // the Update, 0.05 s after the release
      return { deck, node, offset, voices, trigger };
    }

    it('the shift, the stale voices, the restarts and the hand-over all wait for the landing (19.95 + 0.9 s)', async () => {
      const t = await updateDuringSpinUp();
      const settleAt = 19.95 + 0.9;
      // Arrival of the next query: (40.25 − 40) / 0.5 + 20 + 0.1 = 20.6 s, at cycle 40.25.
      const cycle = 40.25 + (settleAt - 20.6) * 0.5;
      expect(t.offset.pending.cycles).toBe(0.5);
      expect(t.offset.pending.atCycle).toBeCloseTo(cycle, 9);
      // The unshifted track's notes end 30 ms before (their release done before live is heard).
      expect(t.offset.pending.endCycle).toBeCloseTo(cycle - 0.03 * 0.5, 9);
      const msg = t.node.port.posted.at(-1);
      expect(msg.type).toBe('handOver');
      expect(msg.shiftAt).toBeCloseTo(settleAt, 9);
      const [, end] = t.voices.releaseSounds.mock.calls[0];
      expect(end).toBeCloseTo(settleAt, 9);
      expect(t.trigger.mock.calls[0][1]).toBeCloseTo(settleAt, 9);
      expect(t.trigger.mock.calls[0][4]).toBeCloseTo(cycle, 9);
    });

    it('negative pair: a spin-up that lands before the shift could arrive shifts at the next query as before', async () => {
      const t = await updateDuringSpinUp({ upSeconds: 0.2, bumpSeconds: 0, startTime: 20 }); // lands at 20.2 < 20.6
      expect(t.offset.pending).toBeNull();
      expect(t.offset.cycles).toBe(0.5);
      expect(t.node.port.posted.at(-1).shiftAt).toBeCloseTo(20.6, 9);
    });
  });
});
