/**
 * @spec: 031-midi-mapping (functional §2.5, tech §2.5)
 * Manual mix: buildTransition's `progressAt` (the progress source, the default path unchanged, the
 * type mapping, layered entry by progress, the old track's end) and TrackTransitionController's
 * beginManual / setManualProgress / handManualToTimed: complete, abandon (the old pattern, its origin
 * and tempo back, the new voices released), hand-over continuity, tempo per mode, a failed evaluate,
 * state and events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { s, sequence, stack } from '@strudel/core';
import { buildTransition, MIX_SIDE_CONTROL } from '../transitions/buildTransition.mjs';
import { equalPowerIn, equalPowerOut, ECHO_ORBIT } from '../transitions/envelopes.mjs';
import {
  HANDOVER_RELEASE_DELAY,
  MANUAL_ABANDON_AT,
  MANUAL_COMPLETE_AT,
  MANUAL_RELEASE,
} from '../TrackTransitionController.mjs';
import * as mixer from '../index.mjs';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';
import { NEW, OLD, createFakeVoices, onsetHaps, setupController, untilCycle } from './transitionHarness031.mjs';

const velocityOf = (h) => (typeof h.value.velocity === 'number' ? h.value.velocity : 1);
const named = (haps, name) => haps.filter((h) => h.value.s === name);
const eventNames = (events) => events.map(([n]) => n);

// ---------------------------------------------------------------------------------------------
describe('buildTransition progressAt (tech §2.5)', () => {
  const T = 10;
  const base = { oldPat: OLD, newPat: NEW, T, length: 4, cps: 0.5 };

  it('every envelope reads progressAt instead of the clock: p = 0.3 everywhere after T', () => {
    const pat = buildTransition({ ...base, type: 'crossfade', progressAt: (t) => (t < T ? 0 : 0.3) });
    const haps = onsetHaps(pat, 12, 13); // well inside [T, T+L] on the clock, but the clock is ignored
    expect(named(haps, 'new').map(velocityOf)).toEqual(Array(4).fill(equalPowerIn(0.3)));
    expect(named(haps, 'old').map(velocityOf)).toEqual(Array(4).fill(equalPowerOut(0.3)));
  });

  it('stamps every event with its side (_mixSide); the timed path stamps nothing', () => {
    const pat = buildTransition({ ...base, type: 'filterSweep', progressAt: () => 0.5 });
    const haps = onsetHaps(pat, 9, 13);
    expect(named(haps, 'old').every((h) => h.value[MIX_SIDE_CONTROL] === 'old')).toBe(true);
    expect(named(haps, 'new').every((h) => h.value[MIX_SIDE_CONTROL] === 'new')).toBe(true);
    expect(named(haps, 'new').length).toBeGreaterThan(0);
    const timed = onsetHaps(buildTransition({ ...base, type: 'filterSweep' }), 9, 13);
    expect(timed.every((h) => !(MIX_SIDE_CONTROL in h.value))).toBe(true);
  });

  it('the overlap has no end on the clock: both tracks still play long after T + L', () => {
    const pat = buildTransition({ ...base, type: 'crossfade', progressAt: () => 0.5 });
    const haps = onsetHaps(pat, 40, 41);
    expect(named(haps, 'old')).toHaveLength(4);
    expect(named(haps, 'new')).toHaveLength(4);
  });

  it('before T the old track plays untouched and the new one is absent (fromOrigin)', () => {
    const pat = buildTransition({ ...base, type: 'crossfade', progressAt: (t) => (t < T ? 0 : 0.9) });
    const haps = onsetHaps(pat, 9, 10);
    expect(haps.map((h) => h.value.s)).toEqual(['old', 'old', 'old', 'old']);
    expect(haps.every((h) => h.value.velocity === undefined)).toBe(true);
  });

  it('oldEnd ends the old track (the hand-over), the new one plays on', () => {
    const pat = buildTransition({ ...base, type: 'crossfade', progressAt: () => 0.5, oldEnd: 11 });
    expect(named(onsetHaps(pat, 11, 12), 'old')).toEqual([]);
    expect(named(onsetHaps(pat, 10, 11), 'old')).toHaveLength(4);
    expect(named(onsetHaps(pat, 11, 12), 'new')).toHaveLength(4);
  });

  it('without progressAt nothing changes (same events, same controls as before)', () => {
    const a = onsetHaps(buildTransition({ ...base, type: 'crossfade' }), 9, 15).map((h) => [
      h.value,
      h.whole.begin.valueOf(),
    ]);
    const b = onsetHaps(buildTransition({ ...base, type: 'crossfade', progressAt: undefined }), 9, 15).map((h) => [
      h.value,
      h.whole.begin.valueOf(),
    ]);
    expect(b).toEqual(a);
    // The timed path still ends the old track at T + L.
    expect(named(onsetHaps(buildTransition({ ...base, type: 'crossfade' }), 14, 15), 'old')).toEqual([]);
  });

  it('Cut and Dip have no in-between: with progressAt they mix as Crossfade', () => {
    for (const type of ['cut', 'dip']) {
      const haps = onsetHaps(buildTransition({ ...base, type, progressAt: () => 0.5 }), 11, 12);
      expect(named(haps, 'new').map(velocityOf)).toEqual(Array(4).fill(equalPowerIn(0.5)));
      expect(named(haps, 'old').map(velocityOf)).toEqual(Array(4).fill(equalPowerOut(0.5)));
    }
  });

  it('Echo-out keeps its echo on the old track (once the fader moved), fading with p; the new one comes in', () => {
    const at0 = onsetHaps(buildTransition({ ...base, type: 'echoOut', progressAt: () => 0 }), 11, 12);
    expect(named(at0, 'old').every((h) => h.value.orbit === undefined)).toBe(true);
    const haps = onsetHaps(buildTransition({ ...base, type: 'echoOut', progressAt: () => 0.4 }), 11, 12);
    const old = named(haps, 'old');
    expect(old.every((h) => h.value.orbit === ECHO_ORBIT && h.value.delay > 0)).toBe(true);
    expect(old.map(velocityOf)).toEqual(Array(4).fill(equalPowerOut(0.4)));
    expect(named(haps, 'new').map(velocityOf)).toEqual(Array(4).fill(equalPowerIn(0.4)));
  });

  it('Layered intro: layer k of n enters once the progress reaches k/n', () => {
    const layers = ['a', 'b', 'c', 'd'].map((x) => ({ id: x, pattern: s(sequence(x, x, x, x)) }));
    const newPat = stack(...layers.map((l) => l.pattern));
    const at = (p) =>
      new Set(
        onsetHaps(buildTransition({ ...base, newPat, layers, type: 'layeredIntro', progressAt: () => p }), 11, 12)
          .map((h) => h.value.s)
          .filter((x) => x !== 'old'),
      );
    expect(at(0.1)).toEqual(new Set(['a']));
    expect(at(0.5)).toEqual(new Set(['a', 'b', 'c']));
    expect(at(0.75)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});

// ---------------------------------------------------------------------------------------------
describe('TrackTransitionController manual mix (tech §2.5)', () => {
  beforeEach(() => {
    stubWebAudio();
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubWebAudio();
  });

  const settle = async (promise) => {
    await vi.advanceTimersByTimeAsync(1);
    return promise;
  };
  /** Begin, and wait for the new code to have evaluated (the hook ran). `done` settles at the end. */
  async function begin(t, settings, code = 'A') {
    const done = t.controller.beginManual(code, settings);
    await vi.advanceTimersByTimeAsync(1);
    return { done };
  }

  it('exports the thresholds: complete at 0.98, abandon at 0.02', () => {
    expect(MANUAL_COMPLETE_AT).toBe(0.98);
    expect(MANUAL_ABANDON_AT).toBe(0.02);
    expect(mixer.MANUAL_COMPLETE_AT).toBe(0.98);
  });

  it('the new track starts at the phrase start T (Snap 4) and follows the fader: 0.3 → velocities of 0.3', async () => {
    const t = setupController({ settings: { snap: 4 } });
    await begin(t);
    expect(t.events[0]).toEqual(['waiting', expect.objectContaining({ T: 12 })]);
    expect(t.controller.getState()).toMatchObject({ phase: 'waiting', manual: { p: 0 }, end: null });
    t.controller.setManualProgress(0.3);
    const haps = onsetHaps(t.sch.pattern, 12, 13);
    expect(named(haps, 'new').map(velocityOf)).toEqual(Array(4).fill(equalPowerIn(0.3)));
    expect(named(haps, 'old').map(velocityOf)).toEqual(Array(4).fill(equalPowerOut(0.3)));
    // Before T only the old track, untouched.
    expect(onsetHaps(t.sch.pattern, 11, 12).map((h) => h.value.s)).toEqual(['old', 'old', 'old', 'old']);
    expect(t.events).toContainEqual(['manual', expect.objectContaining({ p: 0.3 })]);
    expect(t.controller.getState().manual).toEqual({ p: 0.3, left: true });
  });

  it('no end on the clock: long after T + L it is still mixing at the fader’s progress', async () => {
    const t = setupController();
    const { done } = await begin(t);
    t.controller.setManualProgress(0.5);
    await untilCycle(t.sch, 20);
    expect(t.controller.getState()).toMatchObject({ phase: 'running', manual: { p: 0.5 } });
    expect(named(onsetHaps(t.sch.pattern, 21, 22), 'old')).toHaveLength(4);
    let settled = false;
    done.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
  });

  it('complete: ≥ 0.98 makes the new track the playing one; the old pattern is dropped', async () => {
    const voices = createFakeVoices([1, 2]); // the old track's held voices before T
    const t = setupController({ voices });
    const { done } = await begin(t);
    await untilCycle(t.sch, 10);
    t.controller.setManualProgress(0.5);
    voices.start(3, 'new');
    t.controller.setManualProgress(MANUAL_COMPLETE_AT);
    const result = await done;
    expect(result).toMatchObject({ type: 'crossfade', T: 9.75, manual: true });
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', manual: null, origin: 9.75 });
    expect(onsetHaps(t.sch.pattern, 12, 13).map((h) => h.value.s)).toEqual(['new', 'new', 'new', 'new']);
    expect(onsetHaps(t.sch.pattern, 12, 13).every((h) => h.value.velocity === undefined)).toBe(true);
    // The old track's voices from before the mix fade out now; the new track's play on.
    expect(voices.releaseSounds).toHaveBeenCalledWith([1, 2], expect.any(Number), expect.any(Number));
    expect(voices.releaseSounds.mock.calls.flatMap(([ids]) => ids)).not.toContain(3);
    expect(t.events.at(-1)).toEqual(['end', expect.objectContaining({ manual: true })]);
  });

  it('complete requested before T waits for T (the new track is not dropped in before its start)', async () => {
    const t = setupController({ settings: { snap: 4 } });
    const { done } = await begin(t);
    t.controller.setManualProgress(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.controller.getState().phase).toBe('waiting');
    await untilCycle(t.sch, 12.1);
    await expect(done).resolves.toMatchObject({ manual: true, T: 12 });
  });

  it('abandon: back to ≤ 0.02 restores the old pattern (same object), its origin and its tempo; new voices fade', async () => {
    const voices = createFakeVoices([1]);
    const t = setupController({
      voices,
      settings: { type: 'cut', tempo: 'glide' },
      programs: { A: { pattern: NEW }, B: { pattern: s(sequence('b', 'b')), cps: 0.7 } },
    });
    // A first (timed) switch gives the playing track an origin.
    const first = t.controller.switchTo('A');
    await untilCycle(t.sch, 10.1);
    await first;
    const playing = t.sch.pattern;
    const origin = t.controller.origin;
    const cps = t.sch.cps;
    const setCps = t.sch.setCps;
    expect(origin).toBe(10);
    voices.start(1); // an old-track voice sounding when the manual mix begins (unstamped)
    voices.releaseSounds.mockClear(); // (the Cut above released its own old voices)

    const { done } = await begin(t, { type: 'crossfade', length: 2, tempo: 'glide' }, 'B');
    await untilCycle(t.sch, 11);
    t.controller.setManualProgress(0.5);
    await vi.advanceTimersByTimeAsync(50);
    expect(t.sch.cps).not.toBe(cps); // the glide followed the fader
    voices.start(7, 'new'); // started by the new track after T
    t.controller.setManualProgress(0.01);
    const result = await done;

    expect(result).toEqual({ abandoned: true, type: 'crossfade', T: expect.any(Number) });
    expect(t.sch.pattern).toBe(playing);
    expect(t.controller.origin).toBe(origin);
    expect(t.sch.cps).toBe(cps);
    expect(t.sch.setCps).toBe(setCps); // the controller's wrapper is gone
    expect(voices.releaseSounds).toHaveBeenCalledWith([7], expect.any(Number), expect.any(Number));
    expect(voices.releaseSounds.mock.calls.flatMap(([ids]) => ids)).not.toContain(1);
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', manual: null });
    expect(t.events.at(-1)).toEqual(['end', expect.objectContaining({ abandoned: true })]);
    // Hot-swapping the old track afterwards keeps its position (origin restored, no double shift).
    expect(t.controller.editPattern(NEW)).not.toBe(NEW);
    expect(onsetHaps(t.controller.editPattern(NEW), 12, 12.25).map((h) => h.whole.begin.valueOf())).toEqual([12]);
  });

  // Review 031 #1: abandon released every voice not sounding before T − SAFETY_MARGIN, so the old
  // track's notes started during the mix, and those already scheduled for the lookahead, were cut.
  it('abandon keeps the old track’s voices started during the mix and in the lookahead; releases only the new ones', async () => {
    const voices = createFakeVoices([1]); // an old note sounding before the mix (unstamped)
    const t = setupController({ voices });
    const { done } = await begin(t);
    await untilCycle(t.sch, 10.5);
    t.controller.setManualProgress(0.4);
    voices.start(5, 'old'); // an old-track pad started during the mix
    voices.start(7, 'new'); // a new-track note
    voices.start(8, 'new');
    voices.start(6, 'old'); // the next old hit, already handed to superdough for the lookahead
    t.controller.setManualProgress(0);
    await expect(done).resolves.toMatchObject({ abandoned: true });
    const released = voices.releaseSounds.mock.calls.flatMap(([ids]) => ids);
    expect(released.sort()).toEqual([7, 8]);
    expect([...voices.sounding.keys()].sort()).toEqual([1, 5, 6]); // the old track plays alone, all of it
  });

  // Review 031 #2: only the voices from before T were released, so old notes started during the
  // mix (old haps have no end while it runs) rang on under the new track.
  it('complete releases the old track’s voices started during the mix (and before it), never the new ones', async () => {
    const voices = createFakeVoices([1]);
    const t = setupController({ voices });
    const { done } = await begin(t);
    await untilCycle(t.sch, 10.5);
    t.controller.setManualProgress(0.5);
    voices.start(5, 'old'); // a long old pad started at p = 0.5
    voices.start(7, 'new');
    t.controller.setManualProgress(1);
    await expect(done).resolves.toMatchObject({ manual: true });
    const calls = voices.releaseSounds.mock.calls;
    expect(calls).toHaveLength(1);
    const [ids, end, start] = calls[0];
    expect(ids.sort()).toEqual([1, 5]);
    expect(end - start).toBeCloseTo(MANUAL_RELEASE, 9);
    expect([...voices.sounding.keys()]).toEqual([7]);
  });

  it('hand-over fades the old track’s sounding voices by the end of the remaining length, not the new ones', async () => {
    const voices = createFakeVoices([1]);
    const t = setupController({ voices, settings: { length: 4 } });
    const { done } = await begin(t);
    await untilCycle(t.sch, 10.5);
    t.controller.setManualProgress(0.5);
    voices.start(5, 'old');
    voices.start(7, 'new');
    const ctxNow = t.ctx.currentTime;
    t.controller.handManualToTimed();
    const calls = voices.releaseSounds.mock.calls;
    expect(calls).toHaveLength(1);
    const [ids, end, start] = calls[0];
    expect(ids.sort()).toEqual([1, 5]);
    // Remaining 2 cycles at 0.5 cps = 4 s; the fade begins after the lookahead's voices have started.
    expect(end).toBeCloseTo(ctxNow + 4, 9);
    expect(start).toBeCloseTo(ctxNow + HANDOVER_RELEASE_DELAY, 9);
    expect(voices.sounding.has(7)).toBe(true);
    await untilCycle(t.sch, 13);
    await done;
  });

  it('a fader that never left the playing end does not abandon (≤ 0.02 only counts after leaving)', async () => {
    const t = setupController();
    await begin(t);
    t.controller.setManualProgress(0.01);
    await untilCycle(t.sch, 10.5);
    expect(t.controller.getState()).toMatchObject({ phase: 'running', manual: { p: 0.01, left: false } });
  });

  it('abandon before T releases nothing and leaves the old track exactly as it was', async () => {
    const voices = createFakeVoices([1]);
    const t = setupController({ voices, settings: { snap: 8 } });
    const { done } = await begin(t);
    t.controller.setManualProgress(0.4);
    voices.start(2, 'old'); // an old note started while waiting
    t.controller.setManualProgress(0);
    await expect(done).resolves.toMatchObject({ abandoned: true });
    expect(t.sch.pattern).toBe(OLD);
    expect(voices.releaseSounds).not.toHaveBeenCalled();
  });

  it('the fader moved (and came back) while the code evaluated: abandoned as soon as it is armed', async () => {
    const t = setupController();
    const done = t.controller.beginManual('A');
    expect(t.controller.setManualProgress(0.5)).toBe(true);
    t.controller.setManualProgress(0);
    await expect(settle(done)).resolves.toMatchObject({ abandoned: true });
    expect(t.sch.pattern).toBe(OLD);
  });

  it('Off, Cut and Dip mix as Crossfade; Echo-out stays Echo-out', async () => {
    for (const [type, expected] of [
      ['off', 'crossfade'],
      ['cut', 'crossfade'],
      ['dip', 'crossfade'],
      ['echoOut', 'echoOut'],
      ['filterSweep', 'filterSweep'],
    ]) {
      const t = setupController({ settings: { type } });
      await begin(t);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.controller.getState().type).toBe(expected);
      expect(t.destinationGain.gain.calls).toEqual([]); // a Dip's fade never runs in a manual mix
      t.controller.destroy();
    }
  });

  it('hand-over (Go mid-mix): the level heard now is unchanged, then the clock takes it to the end', async () => {
    const t = setupController({ settings: { length: 4 } });
    const { done } = await begin(t);
    await untilCycle(t.sch, 10.5);
    t.controller.setManualProgress(0.5);
    const now = t.sch.now();
    expect(t.controller.handManualToTimed()).toBe(true);
    const state = t.controller.getState();
    expect(state.manual).toBeNull();
    expect(state.end).toBeCloseTo(now + 0.5 * 4, 9); // T' = now − p·L, end = T' + L

    // The envelope continues from p = 0.5 at `now`: a new event sampled at m hears progress 0.5 + (m − now)/L.
    const pat = t.sch.pattern;
    const next = named(onsetHaps(pat, now, now + 1), 'new');
    for (const h of next) {
      const m = h.whole.begin.valueOf() + 0.125;
      expect(velocityOf(h)).toBeCloseTo(equalPowerIn(0.5 + (m - now) / 4), 9);
    }
    // And the old track now ends at T' + L.
    expect(named(onsetHaps(pat, state.end, state.end + 1), 'old')).toEqual([]);
    expect(t.controller.setManualProgress(0.9)).toBe(false); // the fader no longer drives it
    await untilCycle(t.sch, state.end + 0.1);
    await expect(done).resolves.toMatchObject({ manual: true });
  });

  it('hand-over continuity, pure: the same event hears the same level before and after the hand-over', () => {
    const p = 0.37;
    const L = 4;
    const T = 10;
    // 1/8-cycle events: the one at 11 is sampled at its middle, 11 + 1/16 = `now`.
    const now = 11 + 1 / 16;
    const newPat = s(sequence('n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'));
    const eventAtNow = (pat) => named(onsetHaps(pat, 11, 11.1), 'n')[0];
    const manual = buildTransition({ oldPat: OLD, newPat, T, length: L, type: 'crossfade', progressAt: () => p });
    const windowStart = now - p * L;
    const timed = buildTransition({
      oldPat: OLD,
      newPat,
      T,
      length: L,
      type: 'crossfade',
      progressAt: (t) => Math.min(1, Math.max(0, (t - windowStart) / L)),
      oldEnd: windowStart + L,
    });
    expect(velocityOf(eventAtNow(manual))).toBeCloseTo(equalPowerIn(p), 12);
    expect(velocityOf(eventAtNow(timed))).toBeCloseTo(velocityOf(eventAtNow(manual)), 12);
  });

  describe('tempo per mode while manual', () => {
    const programs = { A: { pattern: NEW, cps: 0.7 } };

    it('glide follows the fader: cps = old + p·(new − old)', async () => {
      const t = setupController({ programs, settings: { tempo: 'glide' } });
      await begin(t);
      await untilCycle(t.sch, 10);
      t.controller.setManualProgress(0.5);
      await vi.advanceTimersByTimeAsync(60);
      expect(t.sch.cps).toBeCloseTo(0.6, 9);
      t.controller.setManualProgress(0.25);
      await vi.advanceTimersByTimeAsync(60);
      expect(t.sch.cps).toBeCloseTo(0.55, 9);
    });

    it('jump: the new tempo from T, whatever the fader', async () => {
      const t = setupController({ programs, settings: { tempo: 'jump', snap: 4 } });
      await begin(t);
      t.controller.setManualProgress(0.1);
      await untilCycle(t.sch, 11.9);
      expect(t.sch.cps).toBe(0.5);
      await untilCycle(t.sch, 12.1);
      expect(t.sch.cps).toBe(0.7);
    });

    it('keep holds the old tempo through the mix and after it; match glides after completion', async () => {
      const keep = setupController({ programs, settings: { tempo: 'keep' } });
      const { done: keepDone } = await begin(keep);
      await untilCycle(keep.sch, 10.5);
      keep.controller.setManualProgress(0.6);
      await vi.advanceTimersByTimeAsync(60);
      expect(keep.sch.cps).toBe(0.5);
      keep.controller.setManualProgress(1);
      await keepDone;
      expect(keep.sch.cps).toBe(0.5);
      expect(keep.controller.getState().tempoHold).toBe('keep');

      const match = setupController({ programs, settings: { tempo: 'match', length: 1 } });
      const { done: matchDone } = await begin(match);
      await untilCycle(match.sch, 10.5);
      match.controller.setManualProgress(1);
      await matchDone;
      expect(match.controller.getState().tempoHold).toBe('glide');
      await untilCycle(match.sch, 12);
      expect(match.sch.cps).toBe(0.7);
    });
  });

  it('a failed evaluate keeps the old track: rejects with evaluateFailed, nothing armed', async () => {
    const t = setupController();
    const err = await settle(t.controller.beginManual('broken(').catch((e) => e));
    expect(err.evaluateFailed).toBe(true);
    expect(t.sch.pattern).toBe(OLD);
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', manual: null });
    expect(t.controller.setManualProgress(0.5)).toBe(false);
  });

  it('is never queued: while another switch is in flight it is ignored', async () => {
    const t = setupController();
    t.controller.switchTo('A');
    await expect(t.controller.beginManual('A')).resolves.toEqual({ ignored: true, busy: true });
  });

  it('with nothing playing the track just starts', async () => {
    const t = setupController({ playing: false });
    await expect(settle(t.controller.beginManual('A'))).resolves.toEqual({ immediate: true });
  });

  it('setManualProgress / handManualToTimed without a manual mix do nothing', () => {
    const t = setupController();
    expect(t.controller.setManualProgress(0.5)).toBe(false);
    expect(t.controller.handManualToTimed()).toBe(false);
    expect(eventNames(t.events)).toEqual([]);
  });
});
