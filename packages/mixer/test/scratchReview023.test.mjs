/**
 * @spec: 023-vinyl-scratch-realism (review fixes 1–5)
 *
 * 1. Long notes sound after the hand-over: the shifted timeline's notes that sound at the shift
 *    time (onset before it) are restarted mid-note, samples at the right offset.
 * 2. The release plan the worklet runs (stretched spin-up + snap correction) is sent once, and
 *    `scratchReleaseRate(plan)` is the sound's own rate curve (the platter draws that).
 * 3. The correction's depth grows with the error (no octave dip for a small one).
 * 4. Update / Ctrl+Enter during the spin-up keeps the scratch (planned lag applied at once, quick
 *    hand-over); a track switch still drops it; a stop still resets.
 * 5a. NeoCyclist (sync mode): the hand-over time comes from the scheduler's first query of the
 *    shifted pattern, not a guess.
 * 5b. A grab right after the record settled takes effect at once and a forward push is heard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { note, s as sound, sequence } from '@strudel/core';
import { ScratchDsp } from '../scratch/scratchDsp.mjs';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { ScratchController } from '../scratch/ScratchController.mjs';
import {
  PatternOffset,
  ScratchHandOver,
  SCRATCH_HANDOVER_MARGIN_SECONDS,
  SCRATCH_RESTART_KEY,
  SCRATCH_RESTART_SOUND,
  scratchMidNoteValue,
  scratchSoundingNotes,
} from '../scratch/ScratchShift.mjs';
import {
  planScratchRelease,
  scratchBumpDepth,
  scratchBumpSeconds,
  scratchReleaseRate,
} from '../scratch/scratchPhysics.mjs';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';
import { getADSRValues } from '../../superdough/helpers.mjs';

const SR = 48000;
const BLOCK = 128;
const blocksFor = (seconds) => Math.ceil((seconds * SR) / BLOCK);
const rms = (arr) => Math.sqrt(arr.reduce((acc, v) => acc + v * v, 0) / Math.max(1, arr.length));
const sine =
  (f, a = 0.5) =>
  (n) =>
    a * Math.sin((2 * Math.PI * f * n) / SR);

function rig(dsp, fn) {
  const st = { fn, out: [], events: [] };
  st.run = (blocks, onBlock) => {
    const start = st.out.length;
    for (let b = 0; b < blocks; b++) {
      onBlock?.(b);
      const l = new Float32Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) l[i] = st.fn(dsp.n + i);
      const o = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      dsp.process([l, l], o, BLOCK);
      for (let i = 0; i < BLOCK; i++) st.out.push(o[0][i]);
      const e = dsp.takeEvent();
      if (e) st.events.push({ type: e, id: dsp.eventId, lag: dsp.eventLagSeconds, at: dsp.n });
    }
    return st.out.slice(start);
  };
  st.samples = (count, each) => {
    for (let i = 0; i < count; i++) {
      const l = new Float32Array([st.fn(dsp.n)]);
      const o = [new Float32Array(1), new Float32Array(1)];
      dsp.process([l, l], o, 1);
      st.out.push(o[0][0]);
      const e = dsp.takeEvent();
      if (e) st.events.push({ type: e, id: dsp.eventId, lag: dsp.eventLagSeconds, at: dsp.n });
      each?.(i);
    }
  };
  return st;
}

const fakeController = () => {
  const c = { insert: null };
  c.setPreGainInsert = (node) => (c.insert = node);
  c.getPreGainInsert = () => c.insert;
  return c;
};

describe('review 1: long notes are restarted mid-note after the shift', () => {
  it('finds the notes that sound at the shift cycle with an onset before it (a slow(4) pad), not the ones starting there', () => {
    const pad = note('c2').s('sawtooth').slow(4); // one note per 4 cycles
    const kick = sound(sequence('bd', 'bd', 'bd', 'bd'));
    const pattern = pad.stack(kick);
    const found = scratchSoundingNotes(pattern, 1.5, 0.5);
    expect(found).toHaveLength(1);
    expect(found[0].value).toMatchObject({ note: 'c2', s: 'sawtooth' });
    expect(found[0].elapsed).toBeCloseTo(3, 12); // 1.5 cycles at 0.5 cps
    expect(found[0].remaining).toBeCloseTo(5, 12); // 2.5 cycles left
    // At a beat boundary the kick has its onset there (the scheduler plays it): not restarted.
    expect(scratchSoundingNotes(kick, 1.25, 0.5)).toEqual([]);
  });

  const deps = (type, extra = {}) => ({
    getADSRValues,
    getSound: () => ({ data: { type, samples: ['x.wav'] } }),
    getSampleInfo: () => ({ playbackRate: extra.rate ?? 1, url: 'x.wav' }),
    getLoadedBuffer: () => (extra.duration ? { duration: extra.duration } : undefined),
    getDefaultValue: () => 'triangle',
  });

  const plan = (v) => v[SCRATCH_RESTART_KEY];

  it('a synth plays through the restart sound, fading in to where its envelope is, then following it', () => {
    // No envelope given: superdough's synth defaults (sustain 0.6). 3 s in it is at its sustain.
    const v = scratchMidNoteValue({ s: 'sawtooth', note: 'c2' }, 3, deps('synth'));
    expect(v.s).toBe(SCRATCH_RESTART_SOUND);
    expect(plan(v)).toMatchObject({ s: 'sawtooth', releaseSeconds: 0.01 });
    expect(plan(v).points).toEqual([
      [0, 0],
      [0.01, 0.6],
    ]);
    // Mid-attack: the ramp continues from the current level (0.5 s of 2 s: 0.25).
    // (It starts δ later, in phase with the original oscillator: the curve is for elapsed + δ.)
    const pad = plan(scratchMidNoteValue({ s: 'sawtooth', attack: 2, decay: 1, sustain: 0.5 }, 0.5, deps('synth')));
    const d = pad.delaySeconds;
    expect(d).toBeGreaterThan(0);
    expect(pad.points[1][1]).toBeCloseTo((0.5 + d + 0.01) / 2, 12);
    expect(pad.points[2][0]).toBeCloseTo(1.5 - d, 12); // reaches the peak when the original would
    expect(pad.points[3][0]).toBeCloseTo(2.5 - d, 12);
    // A pluck that has decayed to superdough's default sustain is silent by now: not restarted.
    expect(scratchMidNoteValue({ s: 'sawtooth', decay: 0.2 }, 1, deps('synth'))).toBeNull();
  });

  it('a loopAt sample (unit c) starts where it has got to: begin + elapsed · rate', () => {
    // loopAt(2) at cps 0.5: speed 0.25, unit c → a quarter of the buffer per second.
    const v = scratchMidNoteValue({ s: 'break', speed: 0.25, unit: 'c' }, 1.5, deps('sample', { rate: 0.25 }));
    expect(v.begin).toBeCloseTo(0.375, 12);
    expect(plan(v)).toMatchObject({ s: 'break' });
    expect(plan(v).points[1]).toEqual([0.01, 1]); // the sampler's default envelope: full level
    // Held for the rest of its slice, as the sampler holds it: (1 − 0.375) / 0.25 s.
    expect(plan(v).holdSeconds).toBeCloseTo(2.5, 12);
  });

  it('a plain sample needs its buffer length: begin + elapsed · rate / length; past its end it is not restarted', () => {
    const v = scratchMidNoteValue({ s: 'pad', begin: 0.1 }, 1, deps('sample', { rate: 1, duration: 4 }));
    expect(v.begin).toBeCloseTo(0.35, 12);
    expect(scratchMidNoteValue({ s: 'pad' }, 5, deps('sample', { rate: 1, duration: 4 }))).toBeNull();
    // Not loaded, reversed, looped or an unknown sound: left alone.
    expect(scratchMidNoteValue({ s: 'pad' }, 1, deps('sample'))).toBeNull();
    expect(scratchMidNoteValue({ s: 'pad', speed: -1 }, 1, deps('sample', { duration: 4 }))).toBeNull();
    expect(scratchMidNoteValue({ s: 'pad', loop: 1 }, 1, deps('sample', { duration: 4 }))).toBeNull();
    expect(scratchMidNoteValue({ s: 'gm_piano' }, 1, deps('soundfont'))).toBeNull();
  });

  describe('on the deck', () => {
    let ac;
    beforeEach(() => {
      stubWebAudio();
      ac = new AudioContext();
      ac.currentTime = 20;
    });
    afterEach(() => unstubWebAudio());

    async function setup(pattern, voiceIds = ['old-1']) {
      const deck = new ScratchDeck(ac, fakeController());
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
      repl.setPattern(pattern);
      const trigger = vi.fn();
      const voices = { getActiveSoundIds: () => voiceIds, releaseSounds: vi.fn() };
      new ScratchHandOver(deck, {
        getRepl: () => repl,
        offset,
        voices,
        trigger,
        midNoteValue: (v) => ({ ...v, attack: 0.01 }),
      });
      return { deck, node, trigger, voices, offset };
    }

    it('the pad sounding at the shift time is triggered at that time, with what is left of it', async () => {
      const { deck, node, trigger } = await setup(note('c2').s('sawtooth').slow(4));
      deck.grab();
      deck.release();
      node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 }); // 0.5 cycle
      // Shift time: (41 − 40) / 0.5 + 18 + 0.1 = 20.1 s; the pad (shifted to start at 0.5 + 40 =
      // 40.5) has 3.5 cycles = 7 s left at cycle 41.
      expect(trigger).toHaveBeenCalledTimes(1);
      const [value, t, duration, cps, cycle] = trigger.mock.calls[0];
      expect(value).toMatchObject({ note: 'c2', s: 'sawtooth', attack: 0.01 });
      expect(t).toBeCloseTo(20.1, 9);
      expect(duration).toBeCloseTo(7, 9);
      expect(cps).toBe(0.5);
      expect(cycle).toBe(41);
      // …before the hand-over, which starts just after it.
      expect(node.port.posted.at(-1)).toMatchObject({ type: 'handOver', shiftAt: 20.1 });
    });

    it('negative pairs: notes with an onset at the shift are left to the scheduler; nothing plays through superdough here → nothing restarted', async () => {
      const a = await setup(sound(sequence('bd', 'bd', 'bd', 'bd')));
      a.deck.grab();
      a.deck.release();
      a.node.port.reply({ type: 'lagSettled', id: a.deck.releaseId, lagSeconds: 0.5 }); // shift by a beat
      expect(a.trigger).not.toHaveBeenCalled();
      const b = await setup(note('c2').s('sawtooth').slow(4), []); // e.g. OSC output: no superdough voices
      b.deck.grab();
      b.deck.release();
      b.node.port.reply({ type: 'lagSettled', id: b.deck.releaseId, lagSeconds: 1 });
      expect(b.trigger).not.toHaveBeenCalled();
    });
  });
});

describe('review 2: one release plan for the sound and the picture', () => {
  it('the worklet posts the plan once at release, and scratchReleaseRate(plan) is the record rate it then runs', async () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(1));
    dsp.grab();
    r.run(blocksFor(0.62)); // lag ≈ 0.57 s: the spin-up stretches to 0.8 s, then a correction
    dsp.release({ id: 1, beatSeconds: 0.5 });
    const releasedAt = dsp.n;
    const plan = {
      upSeconds: dsp.planUp,
      fromRate: dsp.planFrom,
      bumpSeconds: dsp.planBumpSeconds,
      bumpDepth: dsp.planDepth,
      targetSeconds: dsp.planTarget,
    };
    expect(plan.upSeconds).toBeCloseTo(0.8, 9); // stretched, not the nominal 0.4
    expect(plan.bumpSeconds).toBeGreaterThan(0);
    let worst = 0;
    let fullAt = -1;
    r.samples(Math.round(2 * SR), (i) => {
      if (dsp.phase !== 'spinUp') return;
      const t = i / SR;
      worst = Math.max(worst, Math.abs(dsp.rate - scratchReleaseRate(t, plan)));
    });
    // The curve is back at 1 for good after its last sample away from 1.
    for (let i = 0; i < 2 * SR; i++) if (Math.abs(scratchReleaseRate(i / SR, plan) - 1) > 1e-6) fullAt = (i + 1) / SR;
    expect(worst).toBeLessThan(0.002);
    const settled = r.events.find((e) => e.type === 'lagSettled');
    // The picture reaches full speed when the sound settles (within a few ms), not at 0.4 s.
    expect(Math.abs((settled.at - releasedAt) / SR - fullAt)).toBeLessThan(0.005);
    expect(fullAt).toBeGreaterThan(1);
  });

  it('ScratchDeck keeps the plan for the latest release only and tells its listeners', async () => {
    stubWebAudio();
    const ac = new AudioContext();
    const deck = new ScratchDeck(ac, fakeController());
    await deck.attach();
    const node = ac.workletNodes.at(-1);
    const plans = [];
    deck.onPlan((p) => plans.push(p));
    deck.grab();
    deck.release();
    node.port.reply({ type: 'plan', id: deck.releaseId - 1, upSeconds: 0.4 }); // stale
    node.port.reply({ type: 'plan', id: deck.releaseId, upSeconds: 0.6, bumpSeconds: 0, bumpDepth: 0 });
    expect(plans).toHaveLength(1);
    expect(deck.plan.upSeconds).toBe(0.6);
    unstubWebAudio();
  });
});

describe('review 3: the correction is gentle, its depth proportional to the error', () => {
  it('depth grows with the error and stays ≤ 0.15 for a typical one (≤ 50 ms); the limit only for big errors', () => {
    const depth = (e) => scratchBumpDepth(e, scratchBumpSeconds(e));
    expect(depth(0.02) / depth(0.01)).toBeCloseTo(2, 9);
    expect(depth(0.04) / depth(0.01)).toBeCloseTo(4, 9);
    expect(depth(0.05)).toBeLessThanOrEqual(0.15);
    expect(depth(-0.02) / depth(-0.01)).toBeCloseTo(2, 9);
    expect(depth(0.5)).toBeCloseTo(0.5, 9); // big: rate ≥ 0.5, longer
  });

  it('a release that must fall 30 ms further behind never dips toward half speed (old: rate 0.5)', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(1));
    dsp.grab();
    r.run(blocksFor(0.62));
    dsp.release({ id: 1, beatSeconds: 0.5 });
    const plan = planScratchRelease({ lagSeconds: dsp.lag / SR, fromRate: 0, beatSeconds: 0.5 });
    expect(plan.bumpDepth).toBeGreaterThan(0); // falls further behind
    let minRate = 1;
    let t = 0;
    r.samples(Math.round(2 * SR), () => {
      t++;
      if (dsp.phase === 'spinUp' && t > dsp.upLen) minRate = Math.min(minRate, dsp.rate);
    });
    expect(minRate).toBeGreaterThan(0.85);
    expect(r.events.find((e) => e.type === 'lagSettled').lag).toBeCloseTo(1, 9);
  });
});

describe('review 4: Update during the spin-up keeps the scratch', () => {
  let ac;
  beforeEach(() => {
    stubWebAudio();
    ac = new AudioContext();
    ac.currentTime = 20;
  });
  afterEach(() => unstubWebAudio());

  async function spinningUp({ busy = () => false } = {}) {
    const deck = new ScratchDeck(ac, fakeController());
    await deck.attach();
    const node = ac.workletNodes.at(-1);
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl, isBusy: busy });
    repl = {
      scheduler: {
        started: true,
        cps: 0.5,
        latency: 0.1,
        lastEnd: 40.25,
        num_cycles_at_cps_change: 40,
        seconds_at_cps_change: 20,
        num_ticks_since_cps_change: 3,
        pattern: null,
      },
      setPattern: vi.fn((p) => {
        repl.scheduler.pattern = offset.editPattern(p);
        return Promise.resolve();
      }),
    };
    const kick = sequence('bd', 'sd', 'hh', 'cp');
    repl.setPattern(kick);
    new ScratchHandOver(deck, {
      getRepl: () => repl,
      offset,
      voices: { getActiveSoundIds: () => [], releaseSounds: vi.fn() },
    });
    const scratch = new ScratchController();
    scratch.setDeck('main', deck);
    scratch.grab('pointer');
    scratch.release('pointer');
    const id = deck.releaseId;
    node.port.reply({ type: 'plan', id, targetSeconds: 1, upSeconds: 0.4, fromRate: 0, bumpSeconds: 0, bumpDepth: 0 });
    return { deck, node, repl, offset, scratch, id, kick };
  }

  it('Update (releaseAll with commitPending): the planned 2 beats are applied now, with a quick hand-over', async () => {
    const t = await spinningUp();
    expect(t.deck.phase).toBe('releasing');
    t.scratch.releaseAll({ commitPending: true });
    expect(t.offset.cycles).toBe(0.5);
    const msg = t.node.port.posted.at(-1);
    expect(msg).toMatchObject({ type: 'handOver', id: t.id });
    expect(msg.at).toBeCloseTo(20.605, 9);
    expect(t.node.port.posted.some((m) => m.type === 'abort')).toBe(false);
    // The Update's evaluate (same code) keeps the shift.
    t.repl.setPattern(t.kick);
    expect(t.offset.cycles).toBe(0.5);
    // The worklet settling later is ignored: nothing is applied twice.
    t.node.port.reply({ type: 'lagSettled', id: t.id, lagSeconds: 1 });
    expect(t.offset.cycles).toBe(0.5);
    expect(t.node.port.posted.filter((m) => m.type === 'handOver')).toHaveLength(1);
  });

  it('a track switch drops it: the switch evaluates while busy, so the new track starts at its cycle 0', async () => {
    let busy = false;
    const t = await spinningUp({ busy: () => busy });
    t.scratch.releaseAll({ commitPending: true }); // runUpdate → beforeUpdate, before the switch is known
    busy = true; // the switch's evaluate
    const next = sequence('a', 'b');
    t.repl.setPattern(next);
    expect(t.offset.cycles).toBe(0);
    expect(t.repl.scheduler.pattern).toBe(next);
  });

  it('a stop (releaseAll without commit) still drops it and the offset stays 0', async () => {
    const t = await spinningUp();
    t.scratch.releaseAll();
    expect(t.node.port.posted.at(-1)).toEqual({ type: 'abort' });
    expect(t.offset.cycles).toBe(0);
  });

  it('negative pairs: no plan yet → cancelled; a record still held at Update is let go and cancelled', async () => {
    const t = await spinningUp();
    t.scratch.grab('pointer');
    t.scratch.release('pointer'); // a new release, its plan not in yet
    t.scratch.releaseAll({ commitPending: true });
    expect(t.node.port.posted.at(-1)).toEqual({ type: 'abort' });
    expect(t.offset.cycles).toBe(0);
    t.scratch.grab('pointer');
    t.scratch.releaseAll({ commitPending: true });
    expect(t.node.port.posted.slice(-2).map((m) => m.type)).toEqual(['release', 'abort']);
    expect(t.offset.cycles).toBe(0);
  });

  it('the worklet: a hand-over sent during the spin-up waits until the record has landed on its lag', () => {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, sine(220));
    r.run(blocksFor(1));
    dsp.grab();
    r.run(blocksFor(0.9));
    dsp.release({ id: 6, beatSeconds: 0.5 });
    r.run(blocksFor(0.1));
    expect(dsp.phase).toBe('spinUp');
    dsp.handOver(6, dsp.n + Math.round(0.05 * SR)); // asks for a hand-over before the landing
    let handOverLag = null;
    r.samples(Math.round(2.5 * SR), () => {
      if (handOverLag === null && dsp.phase === 'handOver') handOverLag = dsp.lag;
    });
    expect(handOverLag).toBe(dsp.targetLag); // at the planned lag, rate 1: no flam
    expect(r.events.map((e) => e.type)).toEqual(['idle']); // and no second lag report
  });
});

describe('review 5a: NeoCyclist (sync mode) hands over when the shifted pattern is queried', () => {
  let ac;
  beforeEach(() => {
    stubWebAudio();
    ac = new AudioContext();
    ac.currentTime = 30;
  });
  afterEach(() => unstubWebAudio());

  async function neo() {
    const deck = new ScratchDeck(ac, fakeController());
    await deck.attach();
    const node = ac.workletNodes.at(-1);
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    // NeoCyclist's shape: no lastEnd / num_cycles_at_cps_change; a `cycle` per tick.
    const scheduler = {
      started: true,
      cps: 0.5,
      latency: 0.1,
      cycle: 15,
      time_at_last_tick_message: 29.98,
      pattern: null,
    };
    repl = {
      scheduler,
      setPattern: (p) => {
        scheduler.pattern = offset.editPattern(p);
        return Promise.resolve();
      },
    };
    repl.setPattern(note('c2').s('sawtooth').slow(4));
    const voices = { getActiveSoundIds: () => ['v'], releaseSounds: vi.fn() };
    const trigger = vi.fn();
    new ScratchHandOver(deck, { getRepl: () => repl, offset, voices, trigger, midNoteValue: (v) => v });
    deck.grab();
    deck.release();
    node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 });
    /** The scheduler's next tick: it takes its cycle, then queries [begin, end). */
    const tick = (cycle, begin, end) => {
      scheduler.cycle = cycle;
      scheduler.pattern.queryArc(begin, end, { _cps: 0.5, cyclist: 'neocyclist' });
    };
    return { deck, node, offset, voices, trigger, tick, scheduler };
  }

  it('no guessed hand-over: it is sent at the first scheduler query, at that cycle’s trigger time', async () => {
    const t = await neo();
    expect(t.offset.cycles).toBe(0.5); // shifted at once
    expect(t.node.port.posted.some((m) => m.type === 'handOver')).toBe(false);
    expect(t.voices.releaseSounds).not.toHaveBeenCalled();
    expect(t.deck.phase).toBe('settled');
    // The drawer's query (no cyclist control) is not the scheduler's.
    t.scheduler.pattern.queryArc(14.8, 15.2, {});
    expect(t.node.port.posted.some((m) => m.type === 'handOver')).toBe(false);
    ac.currentTime = 30.05;
    t.tick(15.05, 15.1, 15.15);
    // (15.1 − 15.05) / 0.5 + 30.05 + 0.1 latency = 30.25 s.
    const msg = t.node.port.posted.at(-1);
    expect(msg.type).toBe('handOver');
    expect(msg.shiftAt).toBeCloseTo(30.25, 9);
    // The crossfade starts once the restarted pad has faded in (10 ms, +1 ms), not before.
    expect(msg.at).toBeCloseTo(30.25 + 0.011, 9);
    expect(msg.at).toBeGreaterThan(30.25 + SCRATCH_HANDOVER_MARGIN_SECONDS);
    const [, end, start] = t.voices.releaseSounds.mock.calls[0];
    expect(end).toBeCloseTo(30.25, 9);
    expect(start).toBeCloseTo(30.22, 9);
    expect(t.trigger.mock.calls[0][1]).toBeCloseTo(30.25, 9); // the pad restarts at the same time
    // Once only.
    t.tick(15.15, 15.15, 15.2);
    expect(t.node.port.posted.filter((m) => m.type === 'handOver')).toHaveLength(1);
  });

  it('negative pair: stopped before the query (abort) → no hand-over, nothing released', async () => {
    const t = await neo();
    t.deck.abort();
    t.tick(15.05, 15.1, 15.15);
    expect(t.node.port.posted.some((m) => m.type === 'handOver')).toBe(false);
    expect(t.voices.releaseSounds).not.toHaveBeenCalled();
  });
});

describe('review 5b: a grab right after settling takes effect at once', () => {
  /** A record settled 0.75 s (3 beats) behind; the main thread shifts the input at S. */
  function settledAndShifted(pattern) {
    const dsp = new ScratchDsp(SR, 2);
    const r = rig(dsp, (n) => pattern(n / SR));
    r.run(blocksFor(2));
    dsp.grab();
    r.run(blocksFor(0.6));
    dsp.release({ id: 4, beatSeconds: 0.25 });
    for (let i = 0; i < blocksFor(3) && !r.events.length; i++) r.run(1);
    const D = r.events[0].lag;
    const S = dsp.n + Math.round(0.1 * SR); // the shifted audio arrives 0.1 s from now
    r.fn = (n) => (n >= S ? pattern(n / SR - D) : pattern(n / SR));
    dsp.handOver(4, S + 240, S);
    return { dsp, r, D, S };
  }

  it('the grab brakes the record at once (not queued) and a forward push within 0.15 s is heard, faster', () => {
    const { dsp, r } = settledAndShifted((t) => 0.5 * Math.sin(2 * Math.PI * 220 * t));
    r.run(blocksFor(0.02));
    dsp.grab();
    expect(dsp.phase).toBe('held');
    expect(dsp.grabQueued).toBe(false);
    // Push forwards at 2× from 30 ms after settling, for 60 ms (crossing the shift time).
    const pushed = r.run(blocksFor(0.06), () => dsp.moveBy((2 * BLOCK) / SR));
    const heard = pushed.slice(Math.round(0.02 * SR));
    expect(rms(heard)).toBeGreaterThan(0.2);
    let crossings = 0;
    for (let i = 1; i < heard.length; i++) if (heard[i - 1] < 0 !== heard[i] < 0) crossings++;
    // Faster than the record's own speed (1×, 0.44 crossings/ms): the push is heard.
    expect(crossings / ((heard.length / SR) * 1000)).toBeGreaterThan(0.6);
  });

  // A 1 s bar of four differently pitched clicks over a tone: any jump or repeat shows.
  const bar = (sec) => {
    const t = ((sec % 1) + 1) % 1;
    const beat = Math.floor(t / 0.25);
    const pos = t - beat * 0.25;
    return (
      0.3 * Math.exp(-pos * 60) * Math.sin(2 * Math.PI * (800 + 400 * beat) * pos) +
      0.2 * Math.sin(2 * Math.PI * 55 * sec)
    );
  };

  /** Grab before the shift time, hold across it, then pull back past it and compare the content. */
  function pullBackAcross() {
    const { dsp, r, D, S } = settledAndShifted(bar);
    dsp.grab();
    r.run(blocksFor(0.2)); // held still; the shifted input starts at S meanwhile
    expect(dsp.n).toBeGreaterThan(S);
    dsp.setMotor(-1); // pull back: more than D before the shift point, into the ring's old part
    r.run(blocksFor(0.9));
    let maxErr = 0;
    r.samples(Math.round(0.2 * SR), () => {
      // Content (old timeline) being read: "now" in old-timeline terms (n − D) minus the lag.
      const content = (dsp.n - 1 - D * SR - dsp.lag) / SR;
      maxErr = Math.max(maxErr, Math.abs(r.out.at(-1) - bar(content)));
    });
    return { maxErr, contentBehindShift: (S - (dsp.n - D * SR - dsp.lag)) / SR, D };
  }

  it('held across the shift and pulled back past it, the record stays one piece of the old timeline', () => {
    const { maxErr, contentBehindShift, D } = pullBackAcross();
    expect(contentBehindShift).toBeGreaterThan(D); // where an unmapped read would hit the wrong copy
    expect(maxErr).toBeLessThan(0.05); // the 10 Hz DC blocker on the 55 Hz tone is the residue
  });
});
