/**
 * buildTransition (spec 017, tech §2.3): every type queried across [T-1, T+L+1], asserting
 * onsets, velocity, cutoff/hcutoff, orbit/delay, truncation, clip, layer entry and fallbacks.
 * Positive + negative pairs per behaviour.
 */

import { describe, it, expect } from 'vitest';
import { s, sequence, pure, stack } from '@strudel/core';
import { buildTransition, stripLocations, transitionTiming } from '../transitions/buildTransition.mjs';
import {
  BASS_SWAP_HZ,
  ECHO_MAX_FEEDBACK,
  ECHO_ORBIT,
  ECHO_SEND,
  echoFeedback,
  equalPowerIn,
  equalPowerOut,
  truncateHap,
} from '../transitions/envelopes.mjs';

const T = 8;
const L = 4;

/** 4 events per cycle, with a source location so highlighting can be checked. */
const track = (name) => s(sequence(name, name, name, name)).withLoc(10, 20);
const OLD = track('old');
const NEW = track('new');

const onsetHaps = (pat, from = T - 1, to = T + L + 1) =>
  pat
    .queryArc(from, to)
    .filter((h) => h.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
const at = (h) => h.whole.begin.valueOf();
const olds = (haps) => haps.filter((h) => h.value.s === 'old');
const news = (haps) => haps.filter((h) => h.value.s === 'new');
const vel = (h) => h.value.velocity ?? 1;
const build = (type, extra = {}) => buildTransition({ oldPat: OLD, newPat: NEW, T, length: L, type, ...extra });

describe('buildTransition: Cut', () => {
  const haps = onsetHaps(build('cut'));

  it('the new track starts exactly at T, from its own cycle 0', () => {
    expect(at(news(haps)[0])).toBe(T);
    expect(news(haps).every((h) => at(h) >= T)).toBe(true);
  });

  it('no old note starts at or after T, and the old track plays unchanged before it', () => {
    expect(olds(haps).length).toBe(4); // the last cycle before T
    expect(olds(haps).every((h) => at(h) < T)).toBe(true);
    expect(olds(haps).every((h) => h.value.velocity === undefined)).toBe(true);
  });

  it('nothing of the new track is heard before T (its negative cycles are dropped)', () => {
    expect(news(onsetHaps(build('cut'), T - 4, T))).toEqual([]);
  });

  it('applies no fade to the new track', () => {
    expect(news(haps).every((h) => h.value.velocity === undefined)).toBe(true);
  });
});

describe('buildTransition: Crossfade', () => {
  const haps = onsetHaps(build('crossfade'));
  const inWindow = (h) => at(h) >= T && at(h) < T + L;

  it('the old track gets quieter across the window, monotonically', () => {
    const v = olds(haps).filter(inWindow).map(vel);
    expect(v.length).toBe(16);
    expect(v.every((x) => x < 1)).toBe(true);
    v.slice(1).forEach((x, i) => expect(x).toBeLessThanOrEqual(v[i]));
  });

  it('the old track is untouched before T and gone from T+L on', () => {
    expect(
      olds(haps)
        .filter((h) => at(h) < T)
        .every((h) => h.value.velocity === undefined),
    ).toBe(true);
    expect(olds(haps).filter((h) => at(h) >= T + L)).toEqual([]);
  });

  it('the new track gets louder across the window, monotonically, and is full after it', () => {
    const v = news(haps).filter(inWindow).map(vel);
    expect(v.length).toBe(16);
    expect(v.every((x) => x > 0 && x < 1)).toBe(true);
    v.slice(1).forEach((x, i) => expect(x).toBeGreaterThanOrEqual(v[i]));
    expect(
      news(haps)
        .filter((h) => at(h) >= T + L)
        .every((h) => h.value.velocity === undefined),
    ).toBe(true);
  });

  it('is equal power: at every onset old² + new² = 1 (no dip in the middle)', () => {
    const o = olds(haps).filter(inWindow);
    const n = news(haps).filter(inWindow);
    o.forEach((h, i) => {
      expect(at(n[i])).toBe(at(h));
      expect(vel(h) ** 2 + vel(n[i]) ** 2).toBeCloseTo(1, 10);
    });
  });

  it("multiplies the user's own velocity instead of overwriting it, and leaves gain alone", () => {
    const quiet = s(sequence('old', 'old')).velocity(0.5).gain(0.8);
    const h = olds(onsetHaps(buildTransition({ oldPat: quiet, newPat: NEW, T, length: L, type: 'crossfade' })));
    const mid = h.find((x) => at(x) === T + 2);
    expect(mid.value.velocity).toBeCloseTo(0.5 * equalPowerOut(0.5 + 0.25 / L), 10);
    expect(mid.value.gain).toBe(0.8);
  });

  it('a long new note starting exactly at T is not silent for its whole length', () => {
    const pad = s(pure('new')).slow(4); // one 4-cycle note at the new track's cycle 0
    const h = news(onsetHaps(buildTransition({ oldPat: OLD, newPat: pad, T, length: L, type: 'crossfade' })));
    expect(at(h[0])).toBe(T);
    expect(vel(h[0])).toBeGreaterThan(0.5); // sampled at the middle of its span: sin(π/4)
    expect(vel(h[0])).toBeLessThan(1);
  });
});

describe('buildTransition: old notes are ended at the transition end', () => {
  const longOld = s(pure('old')).slow(8); // notes [0,8), [8,16), ...

  it('a note still sounding at T+L is cut there and carries clip, so samples are cut too', () => {
    const shiftedOld = longOld.late(2); // a note [10,18) sounds across T+L = 12
    const h = olds(onsetHaps(buildTransition({ oldPat: shiftedOld, newPat: NEW, T, length: L, type: 'crossfade' })));
    expect(h.length).toBe(1);
    expect(at(h[0])).toBe(10);
    expect(h[0].whole.end.valueOf()).toBe(T + L);
    expect(h[0].value.clip).toBe(1);
    expect(at(h[0]) + h[0].duration.valueOf()).toBe(T + L);
  });

  it('a note that ends before T+L is left as it was (no clip added)', () => {
    const h = olds(onsetHaps(build('crossfade')));
    expect(h.every((x) => x.value.clip === undefined)).toBe(true);
  });

  it("a user's clip > 1 or duration that would ring past the end is shortened to end there", () => {
    const longClip = s(sequence('old', 'old')).clip(4); // half-cycle notes held 2 cycles
    const h = olds(onsetHaps(buildTransition({ oldPat: longClip, newPat: NEW, T, length: L, type: 'crossfade' })));
    const last = h[h.length - 1]; // onset 11.5
    expect(at(last)).toBe(11.5);
    expect(at(last) + last.duration.valueOf()).toBeCloseTo(T + L, 10);
    const early = h.find((x) => at(x) === 9);
    expect(early.value.clip).toBe(4); // 9 + 0.5·4 = 11 ≤ 12: untouched
  });

  it('Cut ends a note sounding across T at T', () => {
    const h = olds(onsetHaps(buildTransition({ oldPat: longOld, newPat: NEW, T: 6, length: L, type: 'cut' }), 0, 20));
    expect(h.length).toBe(1);
    expect(h[0].whole.end.valueOf()).toBe(6);
    expect(h[0].value.clip).toBe(1);
  });

  it('truncateHap shortens a `duration` control to fit', () => {
    const [hap] = s(pure('x')).duration(3).queryArc(0, 1);
    const cut = truncateHap(hap, 0.5);
    expect(cut.duration.valueOf()).toBeCloseTo(0.5, 10);
    expect(truncateHap(hap, 5)).toBe(hap);
  });
});

describe('buildTransition: Dip window', () => {
  const haps = onsetHaps(build('dip'), T - 1, T + 2 * L + 1);

  it('the old track plays to T+L (the master fade silences it), the new one starts at T+L', () => {
    expect(Math.max(...olds(haps).map(at))).toBeLessThan(T + L);
    expect(olds(haps).some((h) => at(h) >= T)).toBe(true);
    expect(at(news(haps)[0])).toBe(T + L);
  });

  it('nothing of the new track before T+L, and no per-note fades (the fade is the master gain)', () => {
    expect(news(haps).filter((h) => at(h) < T + L)).toEqual([]);
    expect(haps.every((h) => h.value.velocity === undefined)).toBe(true);
  });

  it('timing: origin T+L, end T+2L', () => {
    expect(transitionTiming('dip', T, L)).toEqual({ origin: T + L, oldEnd: T + L, end: T + 2 * L });
    expect(transitionTiming('crossfade', T, L)).toEqual({ origin: T, oldEnd: T + L, end: T + L });
    expect(transitionTiming('cut', T, L)).toEqual({ origin: T, oldEnd: T, end: T });
  });
});

describe('buildTransition: highlighting', () => {
  const haps = onsetHaps(build('crossfade'));

  it("the old track's notes carry no source locations", () => {
    expect(olds(haps).every((h) => h.context.locations.length === 0)).toBe(true);
  });

  it("the new track's notes keep theirs", () => {
    expect(news(haps).every((h) => h.context.locations.length === 1)).toBe(true);
  });

  it('stripLocations keeps the rest of the context', () => {
    const [h] = stripLocations(OLD.withContext((c) => ({ ...c, color: 'red' }))).queryArc(0, 0.25);
    expect(h.context).toEqual({ color: 'red', locations: [] });
  });
});

describe('buildTransition: Filter sweep', () => {
  const haps = onsetHaps(build('filterSweep'));
  const inWindow = (h) => at(h) >= T && at(h) < T + L;

  it("the old track's high-pass rises monotonically, the new track's low-pass opens monotonically", () => {
    const hp = olds(haps)
      .filter(inWindow)
      .map((h) => h.value.hcutoff);
    const lp = news(haps)
      .filter(inWindow)
      .map((h) => h.value.cutoff);
    expect(hp.length).toBe(16);
    expect(lp.length).toBe(16);
    hp.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(hp[i]));
    lp.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(lp[i]));
    expect(hp[0]).toBeGreaterThanOrEqual(20);
    expect(hp[15]).toBeLessThanOrEqual(2000);
    expect(lp[0]).toBeGreaterThanOrEqual(300);
    expect(lp[15]).toBeLessThanOrEqual(20000);
  });

  it('it also crossfades: old quieter, new louder', () => {
    expect(
      olds(haps)
        .filter(inWindow)
        .every((h) => vel(h) < 1),
    ).toBe(true);
    expect(
      news(haps)
        .filter(inWindow)
        .every((h) => vel(h) < 1),
    ).toBe(true);
  });

  it('after the window the new track has no added filter, before T the old one has none', () => {
    expect(
      news(haps)
        .filter((h) => at(h) >= T + L)
        .every((h) => h.value.cutoff === undefined),
    ).toBe(true);
    expect(
      olds(haps)
        .filter((h) => at(h) < T)
        .every((h) => h.value.hcutoff === undefined),
    ).toBe(true);
  });

  it("respects the user's filters, set through the aliases hpf and lpf", () => {
    const oldHp = s(sequence('old', 'old', 'old', 'old')).hpf(1000);
    const newLp = s(sequence('new', 'new', 'new', 'new')).lpf(800);
    const h = onsetHaps(buildTransition({ oldPat: oldHp, newPat: newLp, T, length: L, type: 'filterSweep' }));
    const hp = olds(h)
      .filter(inWindow)
      .map((x) => x.value.hcutoff);
    const lp = news(h)
      .filter(inWindow)
      .map((x) => x.value.cutoff);
    expect(hp.every((x) => x >= 1000)).toBe(true); // never lowered below the user's
    expect(hp[hp.length - 1]).toBeGreaterThan(1000); // but still sweeps above it
    expect(lp.every((x) => x <= 800)).toBe(true); // never opened past the user's
    expect(lp[0]).toBeLessThan(800);
  });
});

describe('controls: the aliases resolve to the names superdough reads', () => {
  const [h] = s(pure('x')).lpf(500).hpf(100).ctf(400).queryArc(0, 1);

  it('lpf/ctf write cutoff, hpf writes hcutoff', () => {
    expect(h.value).toMatchObject({ cutoff: 400, hcutoff: 100 });
  });

  it('no lpf/hpf keys reach the output', () => {
    expect(h.value).not.toHaveProperty('lpf');
    expect(h.value).not.toHaveProperty('hpf');
  });
});

describe('buildTransition: Bass swap', () => {
  const haps = onsetHaps(build('bassSwap'));
  const mid = T + L / 2;

  it('the old track keeps its low end and level until T+L/2, then loses both', () => {
    const before = olds(haps).filter((h) => at(h) < mid);
    const after = olds(haps).filter((h) => at(h) >= mid);
    expect(before.every((h) => h.value.hcutoff === undefined && h.value.velocity === undefined)).toBe(true);
    expect(after.length).toBe(8);
    expect(after.every((h) => h.value.hcutoff === BASS_SWAP_HZ && vel(h) < 1)).toBe(true);
  });

  it('the new track has no low end until T+L/2, then its own', () => {
    const before = news(haps).filter((h) => at(h) < mid);
    const after = news(haps).filter((h) => at(h) >= mid);
    expect(before.length).toBe(8);
    expect(before.every((h) => h.value.hcutoff === BASS_SWAP_HZ)).toBe(true);
    expect(after.every((h) => h.value.hcutoff === undefined)).toBe(true);
  });

  it('the swap lands at exactly T+L/2 (the first old note with a high-pass, the first new one without)', () => {
    expect(at(olds(haps).find((h) => h.value.hcutoff !== undefined))).toBe(mid);
    expect(at(news(haps).find((h) => h.value.hcutoff === undefined))).toBe(mid);
  });

  it('the new track comes in gradually over the first half, never at full level at once', () => {
    const v = news(haps)
      .filter((h) => at(h) < mid)
      .map(vel);
    expect(v[0]).toBeLessThan(0.5);
    v.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(v[i]));
  });

  it("keeps a user's higher high-pass", () => {
    const thin = s(sequence('new', 'new')).hpf(600);
    const h = news(onsetHaps(buildTransition({ oldPat: OLD, newPat: thin, T, length: L, type: 'bassSwap' })));
    expect(h.every((x) => x.value.hcutoff === 600)).toBe(true);
  });
});

describe('buildTransition: Echo-out', () => {
  const haps = onsetHaps(build('echoOut'), T - 3, T + L + 1);
  const echoed = (h) => h.value.orbit === ECHO_ORBIT;

  it('old notes in the cycle before T go to the echo orbit with a delay send and decaying feedback', () => {
    const last = olds(haps).filter((h) => at(h) >= T - 1);
    expect(last.length).toBe(4);
    for (const h of last) {
      expect(h.value).toMatchObject({ orbit: ECHO_ORBIT, delay: ECHO_SEND, delaysync: 0.25 });
      expect(h.value.delayfeedback).toBeCloseTo(Math.pow(10, -3 / 16), 10); // 16 repeats → −60 dB
    }
  });

  it('earlier old notes play unchanged, and no old note starts at or after T', () => {
    expect(
      olds(haps)
        .filter((h) => at(h) < T - 1)
        .some(echoed),
    ).toBe(false);
    expect(olds(haps).filter((h) => at(h) >= T)).toEqual([]);
  });

  it('the new track starts at T at full level', () => {
    expect(at(news(haps)[0])).toBe(T);
    expect(news(haps).every((h) => h.value.velocity === undefined && !echoed(h))).toBe(true);
  });

  it('the feedback is capped for long transitions and follows a user delaytime', () => {
    expect(echoFeedback(16, 0.25)).toBe(ECHO_MAX_FEEDBACK);
    expect(echoFeedback(1, 0.25)).toBeCloseTo(0.001 ** (1 / 4), 10);
    const timed = s(sequence('old', 'old')).delaytime(1); // 1 s at 0.5 cps = half a cycle per repeat
    const h = olds(
      onsetHaps(buildTransition({ oldPat: timed, newPat: NEW, T, length: L, type: 'echoOut', cps: 0.5 })),
    ).filter(echoed);
    expect(h[0].value.delayfeedback).toBeCloseTo(echoFeedback(L, 0.5), 10);
    expect(h[0].value).not.toHaveProperty('delaysync');
  });

  it('echoFrom limits the echo to notes from the switch press on', () => {
    const h = olds(onsetHaps(build('echoOut', { echoFrom: T - 0.5 }), T - 3, T + L + 1));
    expect(h.filter(echoed).map(at)).toEqual([T - 0.5, T - 0.25]);
  });
});

describe('buildTransition: Layered intro', () => {
  const layer = (name) => ({ id: name, pattern: s(sequence(name, name)) });
  const layers = ['a', 'b', 'c', 'd'].map(layer);
  const newPat = stack(...layers.map((l) => l.pattern));
  const L8 = 8;
  const haps = onsetHaps(
    buildTransition({ oldPat: OLD, newPat, layers, T, length: L8, type: 'layeredIntro' }),
    T - 1,
    T + L8 + 1,
  );
  const first = (name) => Math.min(...haps.filter((h) => h.value.s === name).map(at));

  it('4 layers over 8 cycles enter at T+0, T+2, T+4, T+6, in $: order', () => {
    expect(['a', 'b', 'c', 'd'].map(first)).toEqual([T, T + 2, T + 4, T + 6]);
  });

  it('a layer is silent before its entry, and plays at its own level once in', () => {
    expect(haps.filter((h) => h.value.s === 'd' && at(h) < T + 6)).toEqual([]);
    expect(
      haps.filter((h) => ['a', 'b', 'c', 'd'].includes(h.value.s)).every((h) => h.value.velocity === undefined),
    ).toBe(true);
  });

  it('the old track fades out like a crossfade', () => {
    const o = olds(haps).filter((h) => at(h) >= T);
    expect(o.every((h) => vel(h) < 1)).toBe(true);
    expect(o.filter((h) => at(h) >= T + L8)).toEqual([]);
  });

  it('a single layer sounds like a crossfade', () => {
    const one = [layer('new')];
    const h = news(
      onsetHaps(
        buildTransition({ oldPat: OLD, newPat: one[0].pattern, layers: one, T, length: L, type: 'layeredIntro' }),
      ),
    );
    const crossfaded = news(
      onsetHaps(buildTransition({ oldPat: OLD, newPat: one[0].pattern, T, length: L, type: 'crossfade' })),
    );
    expect(h.map(at)).toEqual(crossfaded.map(at));
    expect(h.map(vel)).toEqual(crossfaded.map(vel));
    expect(vel(h[1])).toBeLessThan(1);
  });

  it('without usable layers (all()/each() present) it falls back to a crossfade of the whole pattern', () => {
    const h = news(onsetHaps(build('layeredIntro', { layers: undefined })));
    expect(at(h[0])).toBe(T);
    expect(h.filter((x) => at(x) < T + L).every((x) => vel(x) < 1)).toBe(true);
  });
});

describe('buildTransition: arguments', () => {
  it('rejects Off and unknown types (Off never builds a transition pattern)', () => {
    expect(() => build('off')).toThrow(/unsupported/);
    expect(() => build('wobble')).toThrow(/unsupported/);
  });

  it('accepts every other type', () => {
    for (const type of ['dip', 'cut', 'crossfade', 'filterSweep', 'bassSwap', 'echoOut', 'layeredIntro']) {
      expect(() => build(type)).not.toThrow();
    }
  });

  it('envelope endpoints', () => {
    expect(equalPowerOut(0)).toBe(1);
    expect(equalPowerOut(1)).toBeCloseTo(0, 12);
    expect(equalPowerIn(0)).toBe(0);
    expect(equalPowerIn(1)).toBe(1);
  });
});
