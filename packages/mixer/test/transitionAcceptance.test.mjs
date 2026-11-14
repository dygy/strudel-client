/**
 * Acceptance tests for spec 017 (track transition types), whole feature, through the REAL
 * @strudel/core repl + Cyclist + TrackTransitionController. Nothing is faked between them: the
 * repl calls the controller's editPattern on every setPattern, the Cyclist queries the combined
 * pattern on its own clock (fake timers), and `played` is what reached the output.
 *
 * The browser boundary is faked only where the repl has none: a MockAudioContext for Dip's master
 * gain, and (headphone preview) a fresh superdough module instance with two owners.
 *
 * @spec: 017-track-transition-types
 * @regression
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as core from '@strudel/core';
import { repl as createRepl, evalScope } from '@strudel/core';
import { TrackTransitionController } from '../TrackTransitionController.mjs';
import { BASS_SWAP_HZ } from '../transitions/envelopes.mjs';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

const MS_PER_CYCLE = 2000; // 0.5 cps, the default tempo
const ALL_TYPES = ['dip', 'cut', 'crossfade', 'filterSweep', 'bassSwap', 'echoOut', 'layeredIntro'];
const OVERLAPPING = ['crossfade', 'filterSweep', 'bassSwap', 'layeredIntro'];

/** Four notes per cycle, all named `name`. */
const quarters = (name) => `s(seq("${name}", "${name}", "${name}", "${name}"))`;
/** One note per cycle naming the track's own cycle: `<p>0` on its cycle 0, `<p>1` on cycle 1 ... */
const numbered = (p) => `s(cat(${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `"${p}${i}"`).join(', ')}))`;
const BROKEN = '(setcps(2), s(seq("n")).notAFunction())'; // runs setcps, then throws

const vel = (p) => p.velocity ?? 1;
const named = (played, prefix) => played.filter((p) => String(p.s).startsWith(prefix));
const cycles = (n) => vi.advanceTimersByTimeAsync(n * MS_PER_CYCLE);
const STILL = 'still switching';
/** The promise's value if it has settled by now, else STILL (a broken queue must fail, not hang). */
const settledNow = (promise) => Promise.race([promise, Promise.resolve(STILL)]);
/** The track cycle a note of a `numbered` track at absolute cycle `at` must name, given its origin. */
const ownCycle = (at, origin) => {
  const k = at - origin;
  return Number.isInteger(Math.round(k * 1e6) / 1e6) ? ((Math.round(k) % 8) + 8) % 8 : NaN;
};

function realSetup({ settings = {}, voices } = {}) {
  const played = [];
  const ctx = new MockAudioContext();
  ctx.currentTime = 100;
  const destinationGain = ctx.createGain();
  const target = new EventTarget();
  const events = [];
  for (const name of ['waiting', 'start', 'end', 'error']) {
    target.addEventListener(`track-transition-${name}`, (e) => events.push([name, e.detail]));
  }
  let current = { type: 'crossfade', length: 2, snap: 0, glide: false, matchLoudness: false, ...settings };
  let controller;
  const r = createRepl({
    getTime: () => Date.now() / 1000,
    defaultOutput: (hap, _deadline, _duration, cps) =>
      played.push({ ...hap.value, at: hap.whole.begin.valueOf(), cps }),
    editPattern: (pattern) => controller.editPattern(pattern),
  });
  controller = new TrackTransitionController({
    repl: r,
    audioContext: ctx,
    destinationGain,
    getSettings: () => current,
    eventTarget: target,
    voices: voices ?? { getActiveSoundIds: () => [], releaseSounds: () => 0 },
  });
  return {
    r,
    controller,
    played,
    events,
    gain: destinationGain.gain,
    setSettings: (next) => (current = { ...current, ...next }),
  };
}

/** Old track playing for 2.5 cycles, then a switch to `code`; returns the switch's T/origin/end. */
async function startSwitch(env, code, settings) {
  await env.r.evaluate(quarters('o'));
  await cycles(2.5);
  const done = env.controller.switchTo(code, settings);
  done.catch(() => {});
  await vi.advanceTimersByTimeAsync(1);
  const { T, end, origin } = env.controller.getState();
  return { done, T, end, origin };
}

beforeAll(async () => {
  await evalScope(core);
});
beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('spec 017 §2.5: when any transition ends, the new track plays from its own first cycle at the set volume', () => {
  it.each(ALL_TYPES)('%s', async (type) => {
    const env = realSetup();
    const { done, end, origin } = await startSwitch(env, numbered('n'), { type, length: 2 });
    await cycles(6);
    await done;
    const startedThroughout = env.r.scheduler.started;
    await cycles(4);
    env.r.stop();

    // the scheduler was never stopped: the old track was not cut by a restart
    expect(startedThroughout).toBe(true);
    // nothing of the old track starts at or after the end
    expect(named(env.played, 'o').filter((p) => p.at >= end - 1e-9)).toEqual([]);
    const neu = named(env.played, 'n');
    // its first note is its own cycle 0, at the transition's origin
    expect(neu[0]).toMatchObject({ s: 'n0', at: origin });
    // every note names its own cycle (counted from the origin), so nothing restarted or slipped
    expect(neu.every((p) => p.s === `n${ownCycle(p.at, origin)}`)).toBe(true);
    // after the end: the user's level and sound, no fade or filter left over
    const after = neu.filter((p) => p.at >= end);
    expect(after.length).toBeGreaterThanOrEqual(3);
    for (const p of after) {
      expect([p.velocity, p.cutoff, p.hcutoff, p.orbit, p.delay]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    }
    // the master volume is back where the user set it (Dip ramps it there; nothing else touches it)
    expect(env.gain.value).toBe(1);
    if (type !== 'dip') {
      expect(env.gain.calls).toEqual([]);
    }
  });

  it('negative: before its origin nothing of the new track is heard, for any type', async () => {
    for (const type of ALL_TYPES) {
      vi.setSystemTime(0);
      const env = realSetup();
      const { done, origin } = await startSwitch(env, numbered('n'), { type, length: 2 });
      await cycles(6);
      await done;
      env.r.stop();
      expect(named(env.played, 'n').filter((p) => p.at < origin)).toEqual([]);
      expect(named(env.played, 'o').filter((p) => p.at < origin - 1).length).toBeGreaterThan(0);
    }
  });
});

describe('spec 017 §2.5: overlapping types are heard continuously and on one beat', () => {
  it.each(OVERLAPPING)('%s: every quarter cycle of the transition has a clearly audible note', async (type) => {
    const env = realSetup();
    const { done, T, end } = await startSwitch(env, quarters('n'), { type, length: 2 });
    await cycles(6);
    await done;
    env.r.stop();

    for (let slot = T; slot < end - 1e-9; slot += 0.25) {
      const inSlot = env.played.filter((p) => p.at >= slot - 1e-9 && p.at < slot + 0.25 - 1e-9);
      const loudest = Math.max(0, ...inSlot.map(vel));
      expect({ slot, loudest: loudest >= 0.5 }).toEqual({ slot, loudest: true });
    }
    // both tracks on the same beat grid: every onset in the overlap is on a quarter
    const overlap = env.played.filter((p) => p.at >= T && p.at < end);
    expect(named(overlap, 'o').length).toBeGreaterThan(0);
    expect(named(overlap, 'n').length).toBeGreaterThan(0);
    expect(overlap.every((p) => Number.isInteger(Math.round(p.at * 4 * 1e6) / 1e6))).toBe(true);
  });

  it('negative: Dip is not an overlap (no new note while the old track is still heard)', async () => {
    const env = realSetup();
    const { done, T, origin } = await startSwitch(env, quarters('n'), { type: 'dip', length: 2 });
    await cycles(8);
    await done;
    env.r.stop();
    expect(origin).toBe(T + 2);
    expect(named(env.played, 'n').filter((p) => p.at < T + 2)).toEqual([]);
  });
});

describe('spec 017 §2.5: Layered intro through the real repl ($: layers)', () => {
  const fourLayers = `(${[0, 1, 2, 3].map((k) => `s(seq("l${k}", "l${k}")).p('$')`).join(', ')})`;

  it('four layers over 8 cycles: one more layer every 2 cycles until all four play', async () => {
    const env = realSetup();
    const { done, T } = await startSwitch(env, fourLayers, { type: 'layeredIntro', length: 8 });
    await cycles(12);
    await done;
    env.r.stop();
    const firstOnset = [0, 1, 2, 3].map((k) => Math.min(...named(env.played, `l${k}`).map((p) => p.at)));
    firstOnset.forEach((at, k) => {
      expect(at).toBeGreaterThanOrEqual(T + 2 * k);
      expect(at).toBeLessThan(T + 2 * k + 0.5 + 1e-9);
    });
  });

  it('negative: a single layer is not staggered, it sounds exactly like a crossfade', async () => {
    const single = realSetup();
    const a = await startSwitch(single, `s(seq("l0", "l0")).p('$')`, { type: 'layeredIntro', length: 4 });
    await cycles(8);
    await a.done;
    single.r.stop();

    vi.setSystemTime(0);
    const cross = realSetup();
    const b = await startSwitch(cross, `s(seq("l0", "l0"))`, { type: 'crossfade', length: 4 });
    await cycles(8);
    await b.done;
    cross.r.stop();

    expect(a.T).toBe(b.T);
    const shape = (env) => env.played.filter((p) => p.at < a.end + 1).map((p) => [p.s, p.at, vel(p)]);
    expect(shape(single)).toEqual(shape(cross));
  });
});

describe('spec 017 §2.6: Update on the playing track is never a transition', () => {
  it('after a crossfade, an edit is heard in place: no fade, no restart, no transition events', async () => {
    const env = realSetup();
    const { done, origin } = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(6);
    await done;
    const eventCount = env.events.length;
    const swapAt = env.r.scheduler.now();
    await env.r.evaluate(numbered('m')); // the editor's Update for the same track (runUpdate → evaluate)
    await cycles(5);
    env.r.stop();

    const m = named(env.played, 'm');
    expect(m.length).toBeGreaterThanOrEqual(4);
    // in place: each note is the edited track's own cycle counted from the same origin (no restart)
    expect(m.every((p) => p.s === `m${ownCycle(p.at, origin)}`)).toBe(true);
    expect(m.every((p) => p.velocity === undefined)).toBe(true);
    expect(named(env.played, 'n').filter((p) => p.at >= swapAt + 1)).toEqual([]);
    expect(env.events.length).toBe(eventCount);
    expect(env.controller.getState().phase).toBe('idle');
    expect(env.r.scheduler.cps).toBe(0.5);
  });

  it('during a crossfade, an edit of the incoming track keeps the blend and its end (no restart)', async () => {
    const env = realSetup();
    const { done, T, end, origin } = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 4 });
    await vi.advanceTimersByTimeAsync((T - env.r.scheduler.now() + 1) * MS_PER_CYCLE); // 1 cycle into it
    await env.r.evaluate(numbered('m'));
    expect(env.controller.getState()).toMatchObject({ phase: 'running', T, end, origin });
    await cycles(6);
    await done;
    env.r.stop();

    const m = named(env.played, 'm');
    expect(m.every((p) => p.s === `m${ownCycle(p.at, origin)}`)).toBe(true);
    // still blending until the unchanged end, then full level
    expect(m.filter((p) => p.at < end).every((p) => vel(p) < 1)).toBe(true);
    expect(m.filter((p) => p.at >= end).every((p) => p.velocity === undefined)).toBe(true);
    expect(named(env.played, 'o').filter((p) => p.at >= end)).toEqual([]);
    expect(env.events.filter(([n]) => n === 'start')).toHaveLength(1);
    expect(env.events.filter(([n]) => n === 'end')).toHaveLength(1);
  });

  it('negative: a stop + Update does restart from cycle 0 (so the in-place check above can tell)', async () => {
    const env = realSetup();
    const { done } = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(6);
    await done;
    env.r.stop();
    env.controller.stopped();
    env.played.length = 0;
    await env.r.evaluate(numbered('m'));
    await cycles(2);
    env.r.stop();
    expect(env.played[0]).toMatchObject({ s: 'm0', at: 0 });
  });
});

describe('spec 017 §2.6: nothing playing starts the track straight away', () => {
  it('positive: no transition, no fade, its own tempo, from cycle 0', async () => {
    const env = realSetup();
    const pending = env.controller.switchTo(`(setcps(1), ${numbered('n')})`, { type: 'crossfade', length: 4 });
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(3000);
    const result = await settledNow(pending);
    env.r.stop();
    expect(result).toEqual({ immediate: true });
    expect(env.played[0]).toMatchObject({ s: 'n0', at: 0 });
    expect(env.played.every((p) => p.velocity === undefined && p.cps === 1)).toBe(true);
    expect(env.events).toEqual([]);
    expect(env.gain.calls).toEqual([]);
  });

  it('negative: the same request while a track plays is a transition, not an immediate start', async () => {
    const env = realSetup();
    const { done, T } = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(6);
    const result = await done;
    env.r.stop();
    expect(result).not.toHaveProperty('immediate');
    expect(T).toBeGreaterThan(2.5);
    expect(env.events.map(([n]) => n)).toContain('start');
    expect(vel(named(env.played, 'n')[0])).toBeLessThan(1);
  });
});

describe('spec 017 §2.3: Snap through the real scheduler', () => {
  it('Snap "next 4 cycles", Update in the middle of cycle 9: old unchanged until 12, transition starts there', async () => {
    const env = realSetup();
    await env.r.evaluate(quarters('o'));
    await cycles(9.5);
    const done = env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 2, snap: 4 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState()).toMatchObject({ phase: 'waiting', T: 12 });
    expect(env.events.map(([n]) => n)).toEqual(['waiting']);
    await cycles(6);
    await done;
    env.r.stop();
    expect(
      named(env.played, 'o')
        .filter((p) => p.at < 12)
        .every((p) => p.velocity === undefined),
    ).toBe(true);
    expect(named(env.played, 'n')[0]).toMatchObject({ s: 'n0', at: 12 });
    expect(env.events.map(([n]) => n)).toEqual(['waiting', 'start', 'end']);
  });

  it('negative: with Snap off the same Update does not wait for cycle 12', async () => {
    const env = realSetup();
    await env.r.evaluate(quarters('o'));
    await cycles(9.5);
    const done = env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 2, snap: 0 });
    await vi.advanceTimersByTimeAsync(1);
    const { T } = env.controller.getState();
    await cycles(4);
    await done;
    env.r.stop();
    expect(T).toBeLessThan(10.5);
    expect(named(env.played, 'n')[0].at).toBe(T);
  });
});

describe('spec 017 §2.6: another switch while a transition runs', () => {
  it('to C during A→B: B finishes, then B→C begins right after; C never cuts into A→B', async () => {
    const env = realSetup();
    const first = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(0.75);
    expect(env.controller.getState().phase).toBe('running');
    const second = env.controller.switchTo(numbered('c'), { type: 'crossfade', length: 2 });
    second.catch(() => {});
    await cycles(10);
    expect(await settledNow(first.done)).toMatchObject({ T: first.T, end: first.end });
    const result = await settledNow(second);
    env.r.stop();

    const starts = env.events.filter(([n]) => n === 'start').map(([, d]) => d);
    expect(starts).toHaveLength(2);
    const T2 = starts[1].T;
    expect(T2).toBeGreaterThanOrEqual(first.end);
    expect(T2).toBeLessThanOrEqual(first.end + 0.5); // "right after"
    expect(result).toMatchObject({ T: T2 });
    // A gone by B's end; B at full level between its end and C's start; C only from T2
    expect(named(env.played, 'o').filter((p) => p.at >= first.end)).toEqual([]);
    expect(named(env.played, 'c').filter((p) => p.at < T2)).toEqual([]);
    expect(
      named(env.played, 'n')
        .filter((p) => p.at >= first.end && p.at < T2)
        .every((p) => vel(p) === 1),
    ).toBe(true);
    expect(named(env.played, 'c')[0]).toMatchObject({ s: 'c0', at: T2 });
  });

  it('Update again for B during A→B: ignored, the transition carries on unchanged', async () => {
    const env = realSetup();
    const first = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(0.75);
    const pressedAgain = env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 2 });
    pressedAgain.catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(await settledNow(pressedAgain)).toEqual({ ignored: true });
    expect(env.controller.getState()).toMatchObject({ phase: 'running', T: first.T, end: first.end, queued: false });
    await cycles(6);
    expect(await settledNow(first.done)).toMatchObject({ T: first.T, end: first.end });
    env.r.stop();
    expect(env.events.map(([n]) => n).filter((n) => n !== 'waiting')).toEqual(['start', 'end']);
    expect(env.events.at(-1)[1]).toMatchObject({ T: first.T, end: first.end });
    const n = named(env.played, 'n');
    expect(n.every((p) => p.s === `n${ownCycle(p.at, first.origin)}`)).toBe(true);
  });

  it('negative: a different track pressed during the transition is NOT ignored', async () => {
    const env = realSetup();
    const first = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(0.75);
    const second = env.controller.switchTo(numbered('c'), { type: 'crossfade', length: 2 });
    second.catch(() => {});
    expect(env.controller.getState().queued).toBe(true);
    await cycles(10);
    expect(await settledNow(second)).toMatchObject({ type: 'crossfade' });
    env.r.stop();
  });
});

describe('spec 017 §2.4: changing the type during a transition applies to the next switch', () => {
  it('Crossfade A→B, Bass swap picked mid-way, then B→C: the first is a crossfade, the second a bass swap', async () => {
    const env = realSetup({ settings: { type: 'crossfade', length: 2 } });
    const first = await startSwitch(env, numbered('n'));
    await cycles(0.75);
    env.setSettings({ type: 'bassSwap' }); // the picker
    await cycles(4);
    await first.done;
    const second = env.controller.switchTo(numbered('c'));
    await vi.advanceTimersByTimeAsync(1);
    const s2 = env.controller.getState();
    await cycles(6);
    await second;
    env.r.stop();

    // first switch: crossfade to its end (no bass-swap high-pass on either track)
    const firstWindow = env.played.filter((p) => p.at >= first.T && p.at < first.end);
    expect(firstWindow.length).toBeGreaterThan(0);
    expect(firstWindow.every((p) => p.hcutoff === undefined)).toBe(true);
    expect(named(firstWindow, 'n').every((p) => vel(p) < 1)).toBe(true);
    // second switch: bass swap (the new track has no low end in its first half)
    expect(s2.type).toBe('bassSwap');
    const cFirstHalf = named(env.played, 'c').filter((p) => p.at < s2.T + 1);
    expect(cFirstHalf.length).toBeGreaterThan(0);
    expect(cFirstHalf.every((p) => p.hcutoff === BASS_SWAP_HZ)).toBe(true);
  });
});

describe('spec 017 §2.6: a new track with an error leaves the old one playing', () => {
  it.each(ALL_TYPES)('%s: same notes, same volume, same tempo; the error is reported', async (type) => {
    const env = realSetup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await env.r.evaluate(quarters('o'));
    await cycles(2.5);
    const before = env.played.length;
    const err = await env.controller.switchTo(BROKEN, { type, length: 2 }).catch((e) => e);
    await cycles(6);
    env.r.stop();

    expect(err.evaluateFailed).toBe(true);
    expect(env.played.length).toBeGreaterThan(before + 16);
    expect(env.played.every((p) => p.s === 'o' && p.velocity === undefined && p.cps === 0.5)).toBe(true);
    expect(env.r.scheduler.cps).toBe(0.5);
    expect(env.gain.calls).toEqual([]);
    expect(env.events).toEqual([['error', expect.objectContaining({ evaluateFailed: true })]]);
    expect(env.controller.busy).toBe(false);
  });

  it('negative: a working Dip does move the master volume (so the check above can see a change)', async () => {
    const env = realSetup();
    const { done } = await startSwitch(env, numbered('n'), { type: 'dip', length: 2 });
    await cycles(8);
    await done;
    env.r.stop();
    expect(env.gain.calls.some(([m, v]) => m === 'linearRampToValueAtTime' && v === 0)).toBe(true);
  });
});

describe('spec 017 §2.6: headphone preview is not affected by a transition on the speakers', () => {
  let sd;
  let main;
  let preview;

  beforeEach(async () => {
    stubWebAudio();
    // superdough builds its output with node constructors; the mock context's createGain stands in.
    const gainNode = function (ac) {
      return ac.createGain();
    };
    vi.stubGlobal('GainNode', gainNode);
    vi.stubGlobal('ChannelMergerNode', gainNode);
    // A fresh superdough instance, so its cached AudioContext and voices never leak to other files.
    vi.resetModules();
    sd = await import('superdough');
    main = sd.getSuperdoughAudioController(); // the main engine (getActiveSoundIds' default owner)
    main.getOrbit = () => ({});
    preview = { getOrbit: () => ({}), duck() {} }; // PreviewEngine's own controller
    sd.registerSound('accvoice', () => {
      const node = sd.getAudioContext().createGain();
      return { node, stop: vi.fn() };
    });
  });
  afterEach(() => {
    sd.releaseSounds([...sd.getActiveSoundIds(main), ...sd.getActiveSoundIds(preview)], 0, 0);
    unstubWebAudio();
  });

  /** Start one held voice through `owner` and return its handle (superdough's own registration). */
  async function voice(owner) {
    const t = sd.getAudioContext().currentTime + 1;
    const before = new Set([...sd.getActiveSoundIds(main), ...sd.getActiveSoundIds(preview)]);
    await sd.superdough({ s: 'accvoice' }, t, 16, 0.5, 0, owner).catch(() => {}); // the rest of the chain needs a real context
    const id = sd.getActiveSoundIds(owner).find((i) => !before.has(i));
    expect(id).toBeDefined();
    return id;
  }

  it('Crossfade on the speakers releases the main engine’s held notes, never the preview’s', async () => {
    const mainId = await voice(main);
    const previewId = await voice(preview);
    expect(sd.getActiveSoundIds()).toEqual([mainId]);

    const released = [];
    const env = realSetup({
      voices: {
        getActiveSoundIds: () => sd.getActiveSoundIds(),
        releaseSounds: (ids, end, start) => {
          released.push(...ids);
          return sd.releaseSounds(ids, end, start);
        },
      },
    });
    const { done } = await startSwitch(env, numbered('n'), { type: 'crossfade', length: 2 });
    await cycles(6);
    await done;
    env.r.stop();

    expect(released).toEqual([mainId]);
    expect(sd.getActiveSoundIds(main)).toEqual([]);
    expect(sd.getActiveSoundIds(preview)).toEqual([previewId]);
  });

  it('negative: before any switch, nothing is released on either engine', async () => {
    const mainId = await voice(main);
    const previewId = await voice(preview);
    const env = realSetup({
      voices: { getActiveSoundIds: () => sd.getActiveSoundIds(), releaseSounds: sd.releaseSounds },
    });
    await env.r.evaluate(quarters('o'));
    await cycles(3);
    env.r.stop();
    expect(sd.getActiveSoundIds(main)).toEqual([mainId]);
    expect(sd.getActiveSoundIds(preview)).toEqual([previewId]);
  });
});

// ---------------------------------------------------------------------------
// Spec 027 (tempo and phrase sync), through the same real repl + Cyclist. `played[].cps` is the
// tempo each note was scheduled at (what is heard); `cpsLog` is every tempo change that reached
// the Cyclist's own setCps, with the cycle it happened at (sampled per controller tick).
// @spec: 027-tempo-phrase-sync

const CPS_120 = 0.5;
const CPS_140 = 140 / 60 / 4;
const CPS_150 = 150 / 60 / 4;
const CPS_90 = 90 / 60 / 4;
/** A `numbered` track whose code sets its own tempo. */
const at = (cps, p) => `(setcps(${cps}), ${numbered(p)})`;
/** Notes queried before a tempo change at `c` may already be scheduled: judge from `c + EDGE`. */
const EDGE = 0.25;

/** Record every tempo change the Cyclist applies (the controller's wrappers call through to it). */
function logCps(env) {
  const sch = env.r.scheduler;
  const log = [];
  const original = sch.setCps;
  sch.setCps = function (cps) {
    log.push([sch.now(), cps ?? CPS_120]);
    return original.call(sch, cps);
  };
  return log;
}

/** Advance the fake clock until the scheduler reaches cycle `c` (whatever the tempo). */
async function untilCycle(env, c) {
  const sch = env.r.scheduler;
  for (let i = 0; i < 400 && sch.now() < c - 1e-9; i++) {
    await vi.advanceTimersByTimeAsync(Math.max(1, Math.ceil(((c - sch.now()) / sch.cps) * 1000)));
  }
}

const between = (list, from, to) => list.filter((p) => p.at >= from - 1e-9 && p.at < to - 1e-9);
const cpsOf = (list) => [...new Set(list.map((p) => p.cps))];

describe('spec 027 §2.1: Snap counts phrases from the playing track’s own cycle 0', () => {
  it('origin at scheduler cycle 6 (an earlier transition), Snap 8, Update at 9: begins at 14, the track’s cycle 8', async () => {
    const env = realSetup();
    await env.r.evaluate(quarters('o'));
    await untilCycle(env, 5.5);
    const first = env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 2, snap: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState().origin).toBe(6);
    await untilCycle(env, 9);
    await first;
    const second = env.controller.switchTo(numbered('c'), { type: 'crossfade', length: 2, snap: 8 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState()).toMatchObject({ phase: 'waiting', T: 14 });
    await untilCycle(env, 17);
    await second;
    env.r.stop();
    expect(named(env.played, 'c')[0]).toMatchObject({ s: 'c0', at: 14 });
    // 14 is the playing track's own cycle 8: its note at 13 is its cycle 7 (n7), at full level
    const n13 = named(env.played, 'n').find((p) => p.at === 13);
    expect([n13.s, n13.velocity]).toEqual(['n7', undefined]);
  });

  it('negative: a track playing since Play (origin 0) with the same Update at 9 waits for scheduler cycle 16', async () => {
    const env = realSetup();
    await env.r.evaluate(numbered('n'));
    await untilCycle(env, 9);
    const done = env.controller.switchTo(numbered('c'), { type: 'crossfade', length: 2, snap: 8 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState()).toMatchObject({ phase: 'waiting', T: 16 });
    await untilCycle(env, 18.5);
    await done;
    env.r.stop();
    expect(named(env.played, 'c')[0]).toMatchObject({ s: 'c0', at: 16 });
    expect(named(env.played, 'c').filter((p) => p.at < 16)).toEqual([]);
  });

  it('Snap 16, a track played since Play, Update at its cycle 20: begins at its cycle 32', async () => {
    const env = realSetup();
    await env.r.evaluate(numbered('o'));
    await untilCycle(env, 20);
    const done = env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 2, snap: 16 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState()).toMatchObject({ phase: 'waiting', T: 32 });
    await untilCycle(env, 34.5);
    await done;
    env.r.stop();
    expect(named(env.played, 'n')[0]).toMatchObject({ s: 'n0', at: 32 });
    // not at the 4- or 8-cycle boundaries on the way (24, 28): the old track is untouched until 32
    expect(named(env.played, 'n').filter((p) => p.at < 32)).toEqual([]);
    expect(between(named(env.played, 'o'), 20, 32).every((p) => p.velocity === undefined)).toBe(true);
  });

  it('negative: Snap 8 at the same moment begins at 24, so Snap 16 is a different, longer phrase', async () => {
    const env = realSetup();
    await env.r.evaluate(numbered('o'));
    await untilCycle(env, 20);
    env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 2, snap: 8 }).catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState()).toMatchObject({ phase: 'waiting', T: 24 });
    env.r.stop();
    env.controller.stopped();
  });

  it('after a Dip, Snap 4 counts from where the Dip’s new track started (its audio), not the Dip’s start', async () => {
    const env = realSetup();
    const first = await startSwitch(env, numbered('n'), { type: 'dip', length: 2 });
    expect(first).toMatchObject({ T: 2.75, origin: 4.75 }); // fade down 2.75→4.75, the new track from 4.75
    await untilCycle(env, 8);
    await first.done;
    const second = env.controller.switchTo(numbered('c'), { type: 'crossfade', length: 2, snap: 4 });
    await vi.advanceTimersByTimeAsync(1);
    const { T } = env.controller.getState();
    await untilCycle(env, 11.5);
    await second;
    env.r.stop();
    expect(named(env.played, 'n')[0]).toMatchObject({ s: 'n0', at: 4.75 });
    expect(T).toBe(8.75); // the track's own cycle 4
    expect(named(env.played, 'c')[0]).toMatchObject({ s: 'c0', at: 8.75 });
  });

  it('negative: the same Snap 4 switch is neither at the Dip’s start + 8 (10.75) nor at scheduler cycle 12', async () => {
    const env = realSetup();
    const first = await startSwitch(env, numbered('n'), { type: 'dip', length: 2 });
    await untilCycle(env, 8);
    await first.done;
    const second = env.controller.switchTo(numbered('c'), { type: 'crossfade', length: 2, snap: 4 });
    await vi.advanceTimersByTimeAsync(1);
    await untilCycle(env, 13);
    await second;
    env.r.stop();
    const firstC = named(env.played, 'c')[0].at;
    expect([10.75, 12]).not.toContain(firstC);
    expect(named(env.played, 'c').filter((p) => p.at < 8.75)).toEqual([]);
  });

  it('Cut, Snap off, the track’s cycle 0 at 2.5, Update at 4.1: the new track starts at 4.5 (its own cycle 2)', async () => {
    const env = realSetup();
    await env.r.evaluate(quarters('o'));
    await untilCycle(env, 2.2);
    const first = env.controller.switchTo(numbered('n'), { type: 'crossfade', length: 1, snap: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState().origin).toBe(2.5);
    await untilCycle(env, 4.1);
    await first;
    const second = env.controller.switchTo(numbered('c'), { type: 'cut', snap: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(env.controller.getState().T).toBe(4.5);
    await untilCycle(env, 6);
    await second;
    env.r.stop();
    expect(named(env.played, 'c')[0]).toMatchObject({ s: 'c0', at: 4.5 });
    expect(named(env.played, 'n').filter((p) => p.at >= 4.5)).toEqual([]);
  });

  it('negative: Cut from a track playing since Play, Update at 4.1, starts at scheduler cycle 5 (not 4.5)', async () => {
    const env = realSetup();
    await env.r.evaluate(numbered('n'));
    await untilCycle(env, 4.1);
    const done = env.controller.switchTo(numbered('c'), { type: 'cut', snap: 0 });
    await vi.advanceTimersByTimeAsync(1);
    await untilCycle(env, 6);
    await done;
    env.r.stop();
    expect(named(env.played, 'c')[0]).toMatchObject({ s: 'c0', at: 5 });
  });
});

describe('spec 027 §2.2: the Tempo choice, heard through the real Cyclist (120 → 140 BPM)', () => {
  it('Jump, Crossfade L4: both tracks heard at 140 from the start of the transition (017 kept)', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T, end } = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 4, tempo: 'jump' });
    await untilCycle(env, end + 2);
    await done;
    env.r.stop();
    expect(log.map(([, v]) => v)).toEqual([CPS_140]);
    expect(log[0][0]).toBeGreaterThanOrEqual(T - 1e-9);
    expect(log[0][0]).toBeLessThan(T + 0.1);
    expect(cpsOf(between(named(env.played, 'o'), T + EDGE, end))).toEqual([CPS_140]);
    expect(cpsOf(between(named(env.played, 'n'), T + EDGE, end + 2))).toEqual([CPS_140]);
    expect(cpsOf(between(env.played, 0, T - EDGE))).toEqual([CPS_120]);
  });

  it('Glide during, Crossfade L4: the tempo rises steadily from 120 to 140 over the 4 cycles (017 kept)', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T, end } = await startSwitch(env, at(CPS_140, 'n'), {
      type: 'crossfade',
      length: 4,
      tempo: 'glide',
    });
    await untilCycle(env, end + 2);
    await done;
    env.r.stop();
    const values = log.map(([, v]) => v);
    values.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(values[i]));
    expect(log[0][0]).toBeGreaterThanOrEqual(T - 1e-9);
    expect(values.at(-1)).toBe(CPS_140);
    expect(log.at(-1)[0]).toBeLessThan(end + 0.1);
    // heard: never falling, between 120 and 140 inside, 140 after
    const heard = between(env.played, T, end + 2).map((p) => p.cps);
    heard.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(heard[i]));
    expect(heard.some((v) => v > CPS_120 && v < CPS_140)).toBe(true);
    expect(cpsOf(between(env.played, end + EDGE, end + 2))).toEqual([CPS_140]);
  });

  it('Match then glide, Crossfade L4: 120 until the transition ends, then up to 140 over the next 4 cycles, and stays', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T, end } = await startSwitch(env, at(CPS_140, 'n'), {
      type: 'crossfade',
      length: 4,
      tempo: 'match',
    });
    await untilCycle(env, end + 4 + 4);
    await done;
    env.r.stop();
    // during the transition: both tracks at 120, the old one never changes tempo
    expect(cpsOf(named(env.played, 'o'))).toEqual([CPS_120]);
    expect(cpsOf(between(named(env.played, 'n'), T, end))).toEqual([CPS_120]);
    // after it: a steady rise over [end, end+4], then 140 and no more changes
    expect(log[0][0]).toBeGreaterThanOrEqual(end - 1e-9);
    const values = log.map(([, v]) => v);
    values.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(values[i]));
    expect(values.at(-1)).toBe(CPS_140);
    expect(log.at(-1)[0]).toBeLessThan(end + 4 + 0.1);
    expect(between(named(env.played, 'n'), end + 1, end + 3).every((p) => p.cps > CPS_120 && p.cps < CPS_140)).toBe(
      true,
    );
    expect(cpsOf(between(named(env.played, 'n'), end + 4 + EDGE, end + 8))).toEqual([CPS_140]);
  });

  it('negative: under Jump the old track IS heard at 140 inside the transition (so the Match check can tell)', async () => {
    const env = realSetup();
    const { done, T, end } = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 4, tempo: 'jump' });
    await untilCycle(env, end + 1);
    await done;
    env.r.stop();
    expect(cpsOf(between(named(env.played, 'o'), T + EDGE, end))).toEqual([CPS_140]);
  });

  it('Match then glide with Cut and Length 8: the new track starts at 120 and reaches 140 8 cycles later', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'match' });
    expect(T).toBe(3);
    await untilCycle(env, T + 10);
    await done;
    env.r.stop();
    const n = named(env.played, 'n');
    expect(n[0]).toMatchObject({ s: 'n0', at: 3 });
    expect(n[0].cps).toBeLessThan(CPS_120 + (CPS_140 - CPS_120) / 64); // 120 (at most the slide's first step)
    expect(log[0][0]).toBeGreaterThanOrEqual(T - 1e-9);
    expect(between(n, T + 7, T + 8).every((p) => p.cps < CPS_140)).toBe(true);
    expect(log.at(-1)).toEqual([expect.any(Number), CPS_140]);
    expect(log.at(-1)[0]).toBeGreaterThan(T + 7.9);
    expect(log.at(-1)[0]).toBeLessThan(T + 8.1);
    expect(cpsOf(between(n, T + 8 + EDGE, T + 10))).toEqual([CPS_140]);
  });

  it('negative: Cut with Jump is at 140 from the start (no slide)', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'jump' });
    await untilCycle(env, T + 3);
    await done;
    env.r.stop();
    expect(log.map(([, v]) => v)).toEqual([CPS_140]);
    expect(cpsOf(between(named(env.played, 'n'), T + EDGE, T + 3))).toEqual([CPS_140]);
  });

  it('Keep set tempo: 120 → 140 → 90 is all heard at 120', async () => {
    const env = realSetup();
    const log = logCps(env);
    const first = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 1, tempo: 'keep' });
    await untilCycle(env, first.end + 1);
    await first.done;
    const second = env.controller.switchTo(at(CPS_90, 'c'), { type: 'crossfade', length: 1, tempo: 'keep' });
    await vi.advanceTimersByTimeAsync(1);
    const { end } = env.controller.getState();
    await untilCycle(env, end + 3);
    await second;
    env.r.stop();
    expect(named(env.played, 'c').length).toBeGreaterThanOrEqual(3);
    expect(cpsOf(env.played)).toEqual([CPS_120]);
    expect(log).toEqual([]);
  });

  it('negative: the same two switches under Jump end at 90', async () => {
    const env = realSetup();
    const first = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 1, tempo: 'jump' });
    await untilCycle(env, first.end + 1);
    await first.done;
    const second = env.controller.switchTo(at(CPS_90, 'c'), { type: 'crossfade', length: 1, tempo: 'jump' });
    await vi.advanceTimersByTimeAsync(1);
    const { end } = env.controller.getState();
    await untilCycle(env, end + 3);
    await second;
    env.r.stop();
    expect(cpsOf(between(named(env.played, 'c'), end, end + 3))).toEqual([CPS_90]);
  });

  it('Keep set tempo: a hot swap with only a note changed (code still 140) stays at 120; a change to 150 applies at once', async () => {
    const env = realSetup();
    const { done, end } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', tempo: 'keep' });
    await untilCycle(env, end + 1);
    await done;
    await env.r.evaluate(at(CPS_140, 'm')); // the editor's Update for the same track
    const swap = env.r.scheduler.now();
    await untilCycle(env, swap + 2);
    expect(cpsOf(between(named(env.played, 'm'), swap, swap + 2))).toEqual([CPS_120]);
    await env.r.evaluate(at(CPS_150, 'k'));
    const change = env.r.scheduler.now();
    expect(env.r.scheduler.cps).toBe(CPS_150);
    await untilCycle(env, change + 2);
    env.r.stop();
    expect(cpsOf(between(named(env.played, 'k'), change + EDGE, change + 2))).toEqual([CPS_150]);
    expect(env.controller.getState().tempoHold).toBe(null);
  });

  it('negative: without a hold (Jump), the same note-only hot swap plays at its own 140', async () => {
    const env = realSetup();
    const { done, end } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', tempo: 'jump' });
    await untilCycle(env, end + 1);
    await done;
    await env.r.evaluate(at(CPS_140, 'm'));
    const swap = env.r.scheduler.now();
    await untilCycle(env, swap + 2);
    env.r.stop();
    expect(cpsOf(between(named(env.played, 'm'), swap, swap + 2))).toEqual([CPS_140]);
  });

  it('a slide after the transition: a hot swap that sets a tempo applies at once and the slide stops', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'match' });
    await untilCycle(env, T + 3);
    await done;
    expect(env.controller.getState().tempoHold).toBe('glide');
    await env.r.evaluate(at(0.9, 'm'));
    const swap = env.r.scheduler.now();
    const count = log.length;
    expect(log.at(-1)[1]).toBe(0.9);
    await untilCycle(env, T + 12);
    env.r.stop();
    expect(log.length).toBe(count); // the slide never comes back to fight it
    expect(cpsOf(between(named(env.played, 'm'), swap + EDGE, T + 12))).toEqual([0.9]);
  });

  it('negative: a hot swap that sets no tempo leaves the slide running to 140', async () => {
    const env = realSetup();
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'match' });
    await untilCycle(env, T + 3);
    await done;
    await env.r.evaluate(numbered('m'));
    expect(env.controller.getState().tempoHold).toBe('glide');
    await untilCycle(env, T + 10);
    env.r.stop();
    expect(env.r.scheduler.cps).toBe(CPS_140);
  });

  it('a switch during a slide starts from the tempo the slide reached (Match again: everything heard at it)', async () => {
    const env = realSetup();
    const log = logCps(env);
    const first = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'match' });
    await untilCycle(env, first.T + 4);
    await first.done;
    const reached = env.r.scheduler.cps;
    expect(reached).toBeGreaterThan(CPS_120);
    expect(reached).toBeLessThan(CPS_140);
    const second = env.controller.switchTo(at(0.9, 'c'), { type: 'crossfade', length: 2, tempo: 'match' });
    await vi.advanceTimersByTimeAsync(1);
    const reachedAtArm = env.r.scheduler.cps;
    const count = log.length;
    const { T, end } = env.controller.getState();
    await untilCycle(env, end + 3);
    await second;
    env.r.stop();
    expect(reachedAtArm).toBeCloseTo(reached, 2); // at most one more slide step before the arm
    expect(log.filter(([c]) => c < end - 1e-9).length).toBe(count); // frozen from the arm to the end
    expect(cpsOf(between(named(env.played, 'n'), T, end))).toEqual([reachedAtArm]);
    expect(cpsOf(between(named(env.played, 'c'), T, end))).toEqual([reachedAtArm]);
    expect(log.at(-1)[1]).toBeGreaterThan(reachedAtArm); // then its own slide from there toward 0.9
  });

  it('negative: without a second switch the same slide keeps moving past that tempo', async () => {
    const env = realSetup();
    const first = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'match' });
    await untilCycle(env, first.T + 4);
    await first.done;
    const reached = env.r.scheduler.cps;
    await untilCycle(env, first.T + 6);
    env.r.stop();
    expect(env.r.scheduler.cps).toBeGreaterThan(reached);
  });

  it.each(['match', 'keep'])('%s: Stop, then Play, plays the track at its own tempo', async (tempo) => {
    const env = realSetup();
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo });
    await untilCycle(env, T + 2);
    await done;
    expect(env.r.scheduler.cps).toBeLessThan(CPS_140);
    env.r.stop();
    env.controller.stopped(); // the REPL's Stop
    env.played.length = 0;
    await env.r.evaluate(at(CPS_140, 'p')); // Play
    await untilCycle(env, 10);
    env.r.stop();
    expect(env.played[0]).toMatchObject({ s: 'p0', at: 0 });
    expect(cpsOf(env.played)).toEqual([CPS_140]);
  });

  it('Match: after Stop mid-slide nothing moves the tempo any more; a track with no tempo plays steady', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', length: 8, tempo: 'match' });
    await untilCycle(env, T + 2);
    await done;
    env.r.stop();
    env.controller.stopped();
    const atStop = env.r.scheduler.cps;
    const count = log.length;
    await vi.advanceTimersByTimeAsync(4000); // stopped for a while
    env.played.length = 0;
    await env.r.evaluate(numbered('p')); // Play, code without setcps
    await untilCycle(env, 10);
    env.r.stop();
    expect(log.length).toBe(count);
    expect(cpsOf(env.played)).toEqual([atStop]);
  });

  it('negative: without Stop, re-running the same 140 code under Keep stays at the held 120', async () => {
    const env = realSetup();
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'cut', tempo: 'keep' });
    await untilCycle(env, T + 2);
    await done;
    env.played.length = 0;
    await env.r.evaluate(at(CPS_140, 'p'));
    await untilCycle(env, T + 6);
    env.r.stop();
    expect(cpsOf(env.played)).toEqual([CPS_120]);
  });
});

describe('spec 027 §2.2: every tempo change during a slide is a small step (≥ 16 per cycle)', () => {
  /** The slide's changes: at least 16 per cycle, never more than 1/16 cycle apart, each a small part of the way. */
  function expectSmallSteps(log, { from, to, start, L }) {
    const slide = log.filter(([c]) => c >= start - 1e-9 && c <= start + L + 0.1);
    expect(slide.length).toBeGreaterThanOrEqual(16 * L);
    const points = [[start, from], ...slide];
    for (let i = 1; i < points.length; i++) {
      expect(points[i][0] - points[i - 1][0]).toBeLessThanOrEqual(1 / 16 + 0.03); // tick jitter
      expect(Math.abs(points[i][1] - points[i - 1][1])).toBeLessThanOrEqual(Math.abs(to - from) / (16 * L) + 1e-9);
    }
  }

  it('Match then glide (Crossfade L4, and Cut L8): the slide after the transition', async () => {
    for (const [type, length] of [
      ['crossfade', 4],
      ['cut', 8],
    ]) {
      vi.setSystemTime(0);
      const env = realSetup();
      const log = logCps(env);
      const { done, end } = await startSwitch(env, at(CPS_140, 'n'), { type, length, tempo: 'match' });
      await untilCycle(env, end + length + 1);
      await done;
      env.r.stop();
      expectSmallSteps(log, { from: CPS_120, to: CPS_140, start: end, L: length });
    }
  });

  it('Glide during (Crossfade L4): the glide over the overlap', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 4, tempo: 'glide' });
    await untilCycle(env, T + 5);
    await done;
    env.r.stop();
    expectSmallSteps(log, { from: CPS_120, to: CPS_140, start: T, L: 4 });
  });

  it('negative: Jump is one change straight to 140 (so the step check can tell a jump)', async () => {
    const env = realSetup();
    const log = logCps(env);
    const { done, T } = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 4, tempo: 'jump' });
    await untilCycle(env, T + 5);
    await done;
    env.r.stop();
    expect(log.map(([, v]) => v)).toEqual([CPS_140]);
    expect(() => expectSmallSteps(log, { from: CPS_120, to: CPS_140, start: T, L: 4 })).toThrow();
  });
});

describe('spec 027 §2.3: tempo changes keep cycle continuity (no note dropped or doubled)', () => {
  /** Exactly one note on each of the track's first `count` cycles, each naming its own cycle, and nothing between. */
  function expectOneNotePerCycle(notes, prefix, origin, count) {
    for (let k = 0; k < count; k++) {
      const c = origin + k;
      const here = notes.filter((p) => Math.abs(p.at - c) < 1e-6);
      expect({ c, s: here.map((p) => p.s) }).toEqual({ c, s: [`${prefix}${k % 8}`] });
    }
    expect(notes.filter((p) => p.at >= origin - 1e-6 && p.at < origin + count - 1e-6)).toHaveLength(count);
  }

  it.each(['match', 'keep', 'glide'])(
    '%s: the new track’s cycles through the transition and after it',
    async (tempo) => {
      const env = realSetup();
      const { done, origin, end } = await startSwitch(env, at(CPS_140, 'n'), { type: 'crossfade', length: 4, tempo });
      await untilCycle(env, end + 4 + 3);
      await done;
      env.r.stop();
      expect(end - origin).toBe(4);
      expectOneNotePerCycle(named(env.played, 'n'), 'n', origin, 4 + 4 + 2); // the transition, the slide, after
    },
  );

  it('negative: a doubled or dropped note is caught by the same check', () => {
    const good = [0, 1, 2, 3].map((c) => ({ s: `n${c}`, at: c }));
    expect(() => expectOneNotePerCycle(good, 'n', 0, 4)).not.toThrow();
    expect(() => expectOneNotePerCycle([...good, { s: 'n2', at: 2 }], 'n', 0, 4)).toThrow();
    expect(() =>
      expectOneNotePerCycle(
        good.filter((p) => p.at !== 1),
        'n',
        0,
        4,
      ),
    ).toThrow();
    expect(() => expectOneNotePerCycle([...good, { s: 'n1', at: 1.5 }], 'n', 0, 4)).toThrow();
  });
});
