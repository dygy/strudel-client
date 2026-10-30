/**
 * Match loudness (spec 017 §2.3, tech §2.8): trim math and clamp, the stepped velocity trim,
 * the lazily created AnalyserNode tap and its disconnect, and the controller measuring the old
 * track before T and the new one after the end, then resetting on the next switch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { s, sequence } from '@strudel/core';
import {
  LoudnessMeter,
  MAX_BOOST_DB,
  MAX_CUT_DB,
  applyTrim,
  computeTrim,
  dbToGain,
  gainToDb,
  rms,
  rmsOver,
  trimFactorAt,
} from '../transitions/loudness.mjs';
import { TrackTransitionController } from '../TrackTransitionController.mjs';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

beforeEach(() => stubWebAudio());
afterEach(() => {
  vi.useRealTimers();
  unstubWebAudio();
});

describe('computeTrim', () => {
  it('brings the new level to the old one: twice as loud → half the gain', () => {
    expect(computeTrim(0.1, 0.2)).toBeCloseTo(0.5, 12);
    expect(computeTrim(0.2, 0.1)).toBeCloseTo(2, 12);
  });

  it('a new track 20 dB louder is turned down fully (within 3 dB of the old level)', () => {
    const trim = computeTrim(0.1, 0.1 * dbToGain(20));
    expect(gainToDb(trim)).toBeCloseTo(-20, 10);
    expect(Math.abs(gainToDb(0.1 * dbToGain(20) * trim) - gainToDb(0.1))).toBeLessThanOrEqual(3);
  });

  it('a new track 20 dB quieter is boosted by exactly +9 dB, no more (more would clip)', () => {
    expect(gainToDb(computeTrim(0.1, 0.1 * dbToGain(-20)))).toBeCloseTo(MAX_BOOST_DB, 10);
  });

  it('attenuation stops at −24 dB', () => {
    expect(MAX_CUT_DB).toBe(24);
    expect(gainToDb(computeTrim(0.001, 1))).toBeCloseTo(-MAX_CUT_DB, 10);
    expect(computeTrim(0.1, 0.12)).toBeCloseTo(0.1 / 0.12, 12); // inside the limits: exact
  });

  it('changes nothing when either side is silent or unmeasured', () => {
    expect(computeTrim(0, 0.3)).toBe(1);
    expect(computeTrim(0.3, 0)).toBe(1);
    expect(computeTrim(undefined, 0.3)).toBe(1);
    expect(computeTrim(0.3, undefined)).toBe(1);
  });

  it('dB helpers round-trip', () => {
    expect(gainToDb(dbToGain(-6))).toBeCloseTo(-6, 12);
  });
});

describe('rms / rmsOver', () => {
  it('rms of a constant block is its magnitude; of nothing, 0', () => {
    expect(rms(new Float32Array(8).fill(-0.5))).toBeCloseTo(0.5, 6);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('combines only the readings inside [from, to)', () => {
    const readings = [
      { at: 0.5, rms: 1 },
      { at: 1, rms: 0.3 },
      { at: 1.5, rms: 0.4 },
      { at: 2, rms: 1 },
    ];
    expect(rmsOver(readings, 1, 2)).toBeCloseTo(Math.sqrt((0.09 + 0.16) / 2), 12);
    expect(rmsOver(readings, 5, 6)).toBeUndefined();
  });
});

describe('the stepped trim', () => {
  const state = { start: 10, value: 0.5 };

  it('phases in over one cycle in 4 equal dB steps, then holds', () => {
    expect(trimFactorAt(state, 9.99)).toBe(1);
    expect(trimFactorAt(state, 10)).toBeCloseTo(0.5 ** 0.25, 12);
    expect(trimFactorAt(state, 10.3)).toBeCloseTo(0.5 ** 0.5, 12);
    expect(trimFactorAt(state, 10.5)).toBeCloseTo(0.5 ** 0.75, 12);
    expect(trimFactorAt(state, 10.75)).toBe(0.5);
    expect(trimFactorAt(state, 40)).toBe(0.5);
  });

  it('is no change while unmeasured', () => {
    expect(trimFactorAt({ start: null, value: 1 }, 50)).toBe(1);
    expect(trimFactorAt(null, 50)).toBe(1);
  });

  it('applyTrim reads the state at query time, so a later measurement applies without a new pattern', () => {
    const live = { start: null, value: 1 };
    const pat = applyTrim(s(sequence('x', 'x')).velocity(0.8), live);
    expect(pat.queryArc(20, 21).map((h) => h.value.velocity)).toEqual([0.8, 0.8]);
    live.start = 10;
    live.value = 0.5;
    expect(pat.queryArc(20, 21).map((h) => h.value.velocity)).toEqual([0.4, 0.4]);
  });
});

describe('LoudnessMeter', () => {
  function meterSetup() {
    const ctx = new MockAudioContext();
    const source = ctx.createGain();
    source.connect(ctx.destination);
    const created = vi.spyOn(ctx, 'createAnalyser');
    return { ctx, source, created, meter: new LoudnessMeter(ctx, source) };
  }

  it('creates no analyser until the first reading', () => {
    const { created } = meterSetup();
    expect(created).not.toHaveBeenCalled();
  });

  it('taps the source once, alongside its existing output', () => {
    const { meter, source, ctx, created } = meterSetup();
    meter.sample(0);
    meter.sample(1);
    expect(created).toHaveBeenCalledTimes(1);
    expect(source.connections).toEqual([ctx.destination, meter.analyser]);
  });

  it('readings are stamped and windowed', () => {
    const { meter } = meterSetup();
    meter.ensureAnalyser().level = 0.25;
    meter.sample(1);
    meter.ensureAnalyser().level = 0.5;
    meter.sample(2);
    expect(meter.rmsOver(0, 1.5)).toBeCloseTo(0.25, 6);
    expect(meter.rmsOver(1.5, 3)).toBeCloseTo(0.5, 6);
  });

  it('destroy disconnects only the analyser: the output keeps playing', () => {
    const { meter, source, ctx } = meterSetup();
    meter.sample(0);
    const analyser = meter.analyser;
    meter.destroy();
    expect(source.connections).toEqual([ctx.destination]);
    expect(source.connections).not.toContain(analyser);
    expect(meter.analyser).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('Match loudness through the controller', () => {
  const OLD = s(sequence('old', 'old', 'old', 'old'));
  const B = s(sequence('b', 'b', 'b', 'b'));
  const C = s(sequence('c', 'c', 'c', 'c'));

  function setup({ oldLevel = 0.1, newLevel = 0.2, matchLoudness = true } = {}) {
    vi.useFakeTimers({ now: 0 });
    const sch = {
      started: true,
      cps: 0.5,
      latency: 0,
      pattern: OLD,
      anchor: 9.5,
      anchorMs: 0,
      now() {
        return sch.anchor + ((Date.now() - sch.anchorMs) / 1000) * sch.cps;
      },
      setCps(v) {
        sch.anchor = sch.now();
        sch.anchorMs = Date.now();
        sch.cps = v;
      },
      async setPattern(p) {
        sch.pattern = p;
      },
    };
    const programs = { B: { pattern: B }, C: { pattern: C } };
    const repl = {
      scheduler: sch,
      state: { layers: [] },
      async setPattern(p) {
        await sch.setPattern(repl.editPattern(p));
      },
      evaluate: vi.fn(async (code) => {
        await repl.setPattern(programs[code].pattern);
      }),
    };
    const ctx = new MockAudioContext();
    const destinationGain = ctx.createGain();
    destinationGain.connect(ctx.destination);
    const analysers = [];
    const createAnalyser = ctx.createAnalyser.bind(ctx);
    let level = () => oldLevel;
    ctx.createAnalyser = () => {
      const node = createAnalyser();
      node.level = () => level();
      analysers.push(node);
      return node;
    };
    let settings = { type: 'crossfade', length: 2, snap: 0, matchLoudness };
    const controller = new TrackTransitionController({
      repl,
      audioContext: ctx,
      destinationGain,
      getSettings: () => settings,
      eventTarget: new EventTarget(),
    });
    repl.editPattern = controller.editPattern;
    return {
      sch,
      ctx,
      controller,
      destinationGain,
      analysers,
      setLevel: (fn) => (level = fn),
      setSettings: (next) => (settings = { ...settings, ...next }),
      newLevel,
      oldLevel,
    };
  }

  async function untilCycle(sch, cycle) {
    for (let guard = 0; sch.now() < cycle && guard < 100000; guard++) {
      await vi.advanceTimersByTimeAsync(10);
    }
  }

  /** Levels by cycle: the old track before T, a mix during the transition, the new track after the end. */
  const levels =
    (sch, { T, end }, oldLevel, newLevel) =>
    () =>
      sch.now() < T ? oldLevel : sch.now() < end ? (oldLevel + newLevel) / 2 : newLevel;

  it('a twice-as-loud new track is trimmed to half its velocity, phased in after the measurement', async () => {
    const t = setup({ oldLevel: 0.1, newLevel: 0.2 });
    t.setLevel(levels(t.sch, { T: 9.75, end: 11.75 }, 0.1, 0.2));
    const done = t.controller.switchTo('B');
    await untilCycle(t.sch, 11.8);
    await done;
    expect(t.controller.trimState.start).toBeNull(); // still measuring the new track
    await untilCycle(t.sch, 13);
    const { start, value } = t.controller.trimState;
    expect(value).toBeCloseTo(0.5, 6);
    expect(start).toBeGreaterThanOrEqual(12.75); // ~2 cycles after the transition ended (tech §2.8)
    const v = (from, to) => t.sch.pattern.queryArc(from, to).map((h) => h.value.velocity);
    expect(v(start - 0.25, start)).toEqual([undefined]); // untouched before
    expect(v(start, start + 0.25)[0]).toBeCloseTo(0.5 ** 0.25, 6); // gradual: first step
    expect(v(start + 1, start + 2).every((x) => Math.abs(x - 0.5) < 1e-9)).toBe(true);
  });

  it('a new track 20 dB louder ends up within 3 dB of the old level (spec 2.3)', async () => {
    const t = setup();
    const loud = 0.05 * dbToGain(20);
    t.setLevel(levels(t.sch, { T: 9.75, end: 11.75 }, 0.05, loud));
    const done = t.controller.switchTo('B');
    await untilCycle(t.sch, 13.5);
    await done;
    const trim = t.controller.trimState.value;
    expect(Math.abs(gainToDb(loud * trim) - gainToDb(0.05))).toBeLessThanOrEqual(3);
  });

  it('a new track 20 dB quieter is boosted by +9 dB only', async () => {
    const t = setup();
    t.setLevel(levels(t.sch, { T: 9.75, end: 11.75 }, 0.1, 0.1 * dbToGain(-20)));
    const done = t.controller.switchTo('B');
    await untilCycle(t.sch, 13.5);
    await done;
    expect(gainToDb(t.controller.trimState.value)).toBeCloseTo(9, 6);
  });

  it('with Match loudness off nothing is measured and no analyser is created', async () => {
    const t = setup({ matchLoudness: false });
    const done = t.controller.switchTo('B');
    await untilCycle(t.sch, 13.5);
    await done;
    expect(t.analysers).toEqual([]);
    expect(t.controller.trimState).toBeNull();
    expect(t.sch.pattern.queryArc(14, 15).every((h) => h.value.velocity === undefined)).toBe(true);
  });

  it('resets on the next switch: the next track is untrimmed, the outgoing one keeps its level', async () => {
    const t = setup();
    t.setLevel(levels(t.sch, { T: 9.75, end: 11.75 }, 0.1, 0.2));
    const first = t.controller.switchTo('B');
    await untilCycle(t.sch, 14);
    await first;
    expect(t.controller.trimState.value).toBeCloseTo(0.5, 6);

    t.setSettings({ matchLoudness: false });
    const second = t.controller.switchTo('C');
    await vi.advanceTimersByTimeAsync(1);
    const { T, end } = t.controller.getState();
    // B (now the old track) keeps its trim up to T: no level jump when the switch begins.
    const bBefore = t.sch.pattern.queryArc(T - 0.5, T).filter((h) => h.value.s === 'b');
    expect(bBefore.every((h) => Math.abs(h.value.velocity - 0.5) < 1e-9)).toBe(true);
    await untilCycle(t.sch, end + 0.1);
    await second;
    expect(t.controller.trimState).toBeNull();
    const after = t.sch.pattern.queryArc(end + 1, end + 2);
    expect(after.every((h) => h.value.s === 'c' && h.value.velocity === undefined)).toBe(true);
  });

  it('destroy disconnects the loudness tap and leaves the output connected', async () => {
    const t = setup();
    const done = t.controller.switchTo('B');
    await untilCycle(t.sch, 12);
    await done;
    const [analyser] = t.analysers;
    expect(t.destinationGain.connections).toContain(analyser);
    t.controller.destroy();
    expect(t.destinationGain.connections).not.toContain(analyser);
    expect(t.destinationGain.connections).toContain(t.ctx.destination);
  });

  it('repeated switches create one analyser, not one per switch', async () => {
    const t = setup();
    t.setLevel(() => 0.1);
    for (const code of ['B', 'C', 'B']) {
      const done = t.controller.switchTo(code);
      await untilCycle(t.sch, t.sch.now() + 4);
      await done;
    }
    expect(t.analysers.length).toBe(1);
    expect(t.destinationGain.connections.filter((c) => t.analysers.includes(c)).length).toBe(1);
  });
});
