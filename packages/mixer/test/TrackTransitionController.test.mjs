/**
 * TrackTransitionController (spec 017, tech §2.2, §2.6, §2.8).
 *
 * A fake repl that honours the real contract (`setPattern` runs `editPattern`; `evaluate`
 * swallows code errors; `setcps` calls `scheduler.setCps` by method lookup), over a fake
 * Cyclist-shaped scheduler whose clock is the fake timers' Date.now(). The last block runs
 * against the real @strudel/core repl + Cyclist.
 *
 * Also ports every SmoothTransitionManager case (spec 015 §2.1): no stop on switch, order of
 * cleanup / prepare / evaluate / fade, failure safety, queue keeps the latest, sticky reset,
 * fades ramp and never jump, volume restored by a short ramp, AudioContext resumed.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import * as core from '@strudel/core';
import { s, sequence, cat, stack, repl as createRepl, evalScope } from '@strudel/core';
import {
  TrackTransitionController,
  RESTORE_RAMP,
  normalizeTransitionSettings,
  transitionStart,
  glideCps,
  SAFETY_MARGIN,
  TRANSITION_SNAPS,
  TRANSITION_TEMPOS,
} from '../TrackTransitionController.mjs';
import * as mixer from '../index.mjs';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

const OLD = s(sequence('old', 'old', 'old', 'old'));
const NEW = s(sequence('new', 'new', 'new', 'new'));
const CPS_120 = 120 / 60 / 4; // 0.5
const CPS_140 = 140 / 60 / 4;

const EVENTS = ['waiting', 'start', 'end', 'error'];

/** Cyclist-shaped: `now()` advances with Date.now() at `cps`; setCps keeps cycle continuity. */
function createFakeScheduler({ cycle = 9.5, cps = CPS_120, started = true } = {}) {
  const sch = {
    started,
    cps,
    latency: 0,
    pattern: undefined,
    anchorCycle: cycle,
    anchorMs: Date.now(),
    cpsLog: [], // [cycle, cps] for every applied change
    now() {
      return sch.started ? sch.anchorCycle + ((Date.now() - sch.anchorMs) / 1000) * sch.cps : 0;
    },
    setCps(value = 0.5) {
      const at = sch.now();
      sch.anchorCycle = at;
      sch.anchorMs = Date.now();
      sch.cps = value;
      sch.cpsLog.push([at, value]);
    },
    async setPattern(pattern, autostart = false) {
      sch.pattern = pattern;
      if (autostart && !sch.started) {
        sch.started = true;
        sch.anchorCycle = 0;
        sch.anchorMs = Date.now();
      }
    },
    stop() {
      sch.started = false;
    },
  };
  return sch;
}

/**
 * NeoCyclist-shaped: setCps only posts a message; the tempo changes when the clock worker
 * answers (here: on the next macrotask). Same now()/pattern/started surface.
 */
function createNeoScheduler(opts) {
  const sch = createFakeScheduler(opts);
  const apply = sch.setCps;
  sch.messages = [];
  sch.setCps = function setCps(value = 1) {
    sch.messages.push(['cpschange', value]);
    setTimeout(() => apply(value), 0);
  };
  return sch;
}

/**
 * The repl contract the controller relies on (packages/core/repl.mjs):
 * - setPattern(p) runs editPattern(p) and hands the result to the scheduler;
 * - evaluate never rejects for broken code: it records evalError and never calls setPattern;
 * - setcps → scheduler.setCps by method lookup; state.layers is set before setPattern.
 */
function createFakeRepl(scheduler, programs) {
  const repl = {
    scheduler,
    calls: [],
    state: { pattern: undefined, layers: [], evalError: undefined },
    editPattern: undefined,
    async setPattern(pattern, autostart = true) {
      repl.calls.push('setPattern');
      const edited = repl.editPattern?.(pattern) || pattern;
      await scheduler.setPattern(edited, autostart);
      return edited;
    },
    setCps(cps) {
      scheduler.setCps(cps);
    },
    evaluate: vi.fn(async (code) => {
      repl.calls.push(`evaluate:${code}`);
      await Promise.resolve();
      const program = programs[code];
      try {
        if (!program) {
          throw new Error(`SyntaxError in ${code}`);
        }
        if (program.cps !== undefined) {
          repl.setCps(program.cps); // setcps(...) in the new code
        }
        program.during?.();
        await new Promise((resolve) => setTimeout(resolve, program.loadMs ?? 0)); // samples() loading
        repl.state.layers = program.layers ?? [];
        repl.state.pattern = await repl.setPattern(program.pattern);
        repl.state.evalError = undefined;
      } catch (error) {
        repl.state.evalError = error; // swallowed, like the real repl
      }
    }),
  };
  return repl;
}

/**
 * superdough's active voices (fork additions getActiveSoundIds / releaseSounds), faked: `sounding`
 * is what superdough holds right now; releaseSounds records its calls.
 */
function createFakeVoices(ids = []) {
  const voices = {
    sounding: new Set(ids),
    getActiveSoundIds: vi.fn(() => [...voices.sounding]),
    releaseSounds: vi.fn((released) => released.filter((id) => voices.sounding.has(id)).length),
  };
  return voices;
}

function setup({
  programs = {},
  settings = {},
  cycle = 9.5,
  cps = CPS_120,
  playing = true,
  neo = false,
  voices = createFakeVoices(),
  getTrackShift,
} = {}) {
  const sch = (neo ? createNeoScheduler : createFakeScheduler)({ cycle, cps, started: playing });
  const repl = createFakeRepl(sch, { A: { pattern: NEW }, ...programs });
  const ctx = new MockAudioContext();
  ctx.currentTime = 100;
  const destinationGain = ctx.createGain();
  const target = new EventTarget();
  const events = [];
  for (const name of EVENTS) {
    target.addEventListener(`track-transition-${name}`, (e) => events.push([name, e.detail]));
  }
  let current = { type: 'crossfade', length: 2, snap: 0, glide: false, matchLoudness: false, ...settings };
  const cleanupCanvases = vi.fn(() => repl.calls.push('cleanup'));
  const controller = new TrackTransitionController({
    repl,
    audioContext: ctx,
    destinationGain,
    getSettings: () => current,
    cleanupCanvases,
    eventTarget: target,
    voices,
    getTrackShift,
  });
  repl.editPattern = controller.editPattern;
  if (playing) {
    sch.pattern = OLD;
    repl.state.pattern = OLD;
  }
  return {
    sch,
    repl,
    ctx,
    gain: destinationGain.gain,
    destinationGain,
    controller,
    voices,
    events,
    cleanupCanvases,
    setSettings: (next) => (current = { ...current, ...next }),
  };
}

/** Advance fake time in 10 ms steps until the scheduler reaches `cycle`. */
async function untilCycle(sch, cycle) {
  for (let guard = 0; sch.now() < cycle && guard < 200000; guard++) {
    await vi.advanceTimersByTimeAsync(10);
  }
}

/** Await something that needs fake time to pass (the fake evaluate loads on a timer). */
async function settle(promise) {
  await vi.advanceTimersByTimeAsync(1);
  return promise;
}

const onsetHaps = (pat, from, to) =>
  pat
    .queryArc(from, to)
    .filter((h) => h.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
const at = (h) => h.whole.begin.valueOf();
const names = (pat, from, to) => onsetHaps(pat, from, to).map((h) => h.value.s);
const eventNames = (events) => events.map(([n]) => n);
/** Instant changes to `target`: setValueAtTime(target) or a direct `.value = target` write. */
const jumpsTo = (calls, target) => calls.filter(([m, v]) => (m === 'setValueAtTime' || m === 'value=') && v === target);

beforeEach(() => {
  stubWebAudio();
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  unstubWebAudio();
});

// ---------------------------------------------------------------------------
describe('editPattern hook when no switch is running', () => {
  it('returns the very same pattern object while the origin is 0 (plain playback untouched)', () => {
    const { controller } = setup();
    expect(controller.editPattern(NEW)).toBe(NEW);
  });

  it('after a switch it shifts by the origin instead (the track keeps its own cycle 0)', async () => {
    const { controller, sch } = setup({ settings: { type: 'cut' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.1);
    await done;
    expect(controller.origin).toBe(10);
    const edited = controller.editPattern(NEW);
    expect(edited).not.toBe(NEW);
    expect(onsetHaps(edited, 10, 10.25).map(at)).toEqual([10]);
  });

  it('a hot-swap of the playing track after a switch keeps its position (origin preserved)', async () => {
    const counting = s(cat('c0', 'c1', 'c2', 'c3'));
    const edited = s(cat('d0', 'd1', 'd2', 'd3'));
    const { controller, sch, repl } = setup({
      programs: { A: { pattern: counting }, A2: { pattern: edited } },
      settings: { type: 'cut' },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.1);
    await done;
    expect(names(sch.pattern, 10, 12)).toEqual(['c0', 'c1']);

    await settle(repl.evaluate('A2')); // Update on the same track: not a switch
    expect(names(sch.pattern, 11, 13)).toEqual(['d1', 'd2']); // cycle 11 is the track's cycle 1
  });

  it('stopped() resets the origin: the next start is at cycle 0, passed through untouched', async () => {
    const { controller, sch } = setup({ settings: { type: 'cut' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.1);
    await done;
    controller.stopped();
    expect(controller.origin).toBe(0);
    expect(controller.editPattern(NEW)).toBe(NEW);
  });
});

// ---------------------------------------------------------------------------
describe('transition start T', () => {
  it('per snap value, from the middle of cycle 9', () => {
    expect(transitionStart(9.5, { type: 'crossfade', snap: 0 })).toBe(9.75);
    expect(transitionStart(9.5, { type: 'crossfade', snap: 1 })).toBe(10);
    expect(transitionStart(9.5, { type: 'crossfade', snap: 4 })).toBe(12);
    expect(transitionStart(9.5, { type: 'crossfade', snap: 8 })).toBe(16);
  });

  it('Cut and Echo-out wait for at least the next cycle boundary even with snap off', () => {
    expect(transitionStart(9.5, { type: 'cut', snap: 0 })).toBe(10);
    expect(transitionStart(9.5, { type: 'echoOut', snap: 0 })).toBe(10);
    expect(transitionStart(9.5, { type: 'cut', snap: 4 })).toBe(12);
  });

  it('never closer than the safety margin: a boundary too close is skipped', () => {
    expect(transitionStart(9.8, { type: 'cut', snap: 0 })).toBe(11);
    expect(transitionStart(9.8, { type: 'crossfade', snap: 0 })).toBe(10.25);
  });

  it('without a snap, T is on the beat grid so both tracks share beats', () => {
    const T = transitionStart(9.3127, { type: 'crossfade', snap: 0 });
    expect(T * 4).toBe(Math.round(T * 4));
    expect(T).toBeGreaterThanOrEqual(9.3127 + 0.25);
  });

  it('Snap 4 from the middle of cycle 9: the old track plays unchanged until cycle 12', async () => {
    const { controller, sch, events } = setup({ settings: { type: 'crossfade', snap: 4 } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(events[0]).toEqual(['waiting', expect.objectContaining({ T: 12 })]);
    const before = onsetHaps(sch.pattern, 10, 12);
    expect(before.every((h) => h.value.s === 'old' && h.value.velocity === undefined)).toBe(true);
    expect(names(sch.pattern, 12, 12.25)).toEqual(['old', 'new']);
    expect(eventNames(events)).not.toContain('start');
    await untilCycle(sch, 12.05);
    expect(eventNames(events)).toContain('start');
  });
});

// ---------------------------------------------------------------------------
describe('the new code’s tempo is captured, not applied, during evaluate', () => {
  it('setcps in the new code does not change the old track’s tempo while it evaluates', async () => {
    let cpsDuring;
    const { controller, sch } = setup({
      programs: { A: { pattern: NEW, cps: 0.7, loadMs: 500, during: () => (cpsDuring = sch.cps) } },
      settings: { type: 'crossfade', snap: 4 },
    });
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(250);
    expect(sch.cps).toBe(CPS_120); // mid samples() loading
    expect(cpsDuring).toBe(CPS_120);
    expect(sch.cpsLog).toEqual([]);
    await untilCycle(sch, 16.5);
    await done;
    expect(sch.cps).toBe(0.7);
  });

  it('the captured tempo is applied at T, not before', async () => {
    const { controller, sch } = setup({ programs: { A: { pattern: NEW, cps: 0.7 } }, settings: { snap: 4 } });
    controller.switchTo('A');
    await untilCycle(sch, 11.9);
    expect(sch.cps).toBe(CPS_120);
    await untilCycle(sch, 12.1);
    expect(sch.cps).toBe(0.7);
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(12);
  });

  it("prepare's tempo reset is captured too (the old track keeps its tempo during the overlap)", async () => {
    const { controller, sch, repl } = setup({ cps: 0.6, settings: { snap: 4 } });
    const prepare = vi.fn(async () => repl.setCps(0.5)); // resetEditor resets cps to 0.5
    controller.switchTo('A', undefined, { prepare });
    await vi.advanceTimersByTimeAsync(5);
    expect(prepare).toHaveBeenCalled();
    expect(sch.cps).toBe(0.6);
  });

  it('a new track without setcps runs at the default 0.5 from T', async () => {
    const { controller, sch } = setup({ cps: 0.8, settings: { type: 'cut' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.2);
    await done;
    expect(sch.cps).toBe(0.5);
  });

  it('the scheduler’s own setCps is put back when the transition ends, and after a failure', async () => {
    const { controller, sch } = setup();
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(sch.setCps).not.toBe(original); // held by the transition's tempo plan
    await untilCycle(sch, 12);
    await done;
    expect(sch.setCps).toBe(original);
    await controller.switchTo('broken(').catch(() => {});
    expect(sch.setCps).toBe(original);
  });

  it('with nothing playing, the code starts at once and its setcps applies directly', async () => {
    const { controller, sch, events } = setup({ playing: false, programs: { A: { pattern: NEW, cps: 0.7 } } });
    const result = await settle(controller.switchTo('A'));
    expect(result).toEqual({ immediate: true });
    expect(sch.started).toBe(true);
    expect(sch.cps).toBe(0.7);
    expect(sch.pattern).toBe(NEW); // no transition, no shift
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('a new track whose code fails', () => {
  it('leaves the old pattern, tempo and volume untouched and reports evaluateFailed', async () => {
    const { controller, sch, gain, events } = setup({ cps: 0.6, settings: { type: 'dip' } });
    const err = await controller.switchTo('broken(').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('The new track failed to evaluate'); // detected, not a crash further on
    expect(err.evaluateFailed).toBe(true);
    expect(sch.pattern).toBe(OLD);
    expect(sch.cps).toBe(0.6);
    expect(sch.cpsLog).toEqual([]);
    expect(gain.calls).toEqual([]);
    expect(events).toEqual([['error', expect.objectContaining({ evaluateFailed: true })]]);
    expect(controller.getState()).toMatchObject({ phase: 'idle', origin: 0 });
  });

  it('a working switch afterwards is not blocked (nothing left armed or busy)', async () => {
    const { controller, sch } = setup();
    await controller.switchTo('broken(').catch(() => {});
    expect(controller.busy).toBe(false);
    const done = controller.switchTo('A');
    await untilCycle(sch, 12);
    await expect(done).resolves.toMatchObject({ type: 'crossfade' });
  });

  it('an evaluate that rejects is handled the same way, with its own message', async () => {
    const { controller, repl, sch, gain } = setup();
    repl.evaluate.mockImplementationOnce(async () => {
      throw new Error('syntax error');
    });
    const err = await controller.switchTo('A').catch((e) => e);
    expect(err.message).toBe('syntax error');
    expect(err.evaluateFailed).toBe(true);
    expect(sch.pattern).toBe(OLD);
    expect(gain.calls).toEqual([]);
    expect(controller.getState().phase).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
describe('a switch never stops the scheduler, and keeps the order of its steps (ported)', () => {
  it('the old track keeps playing: no stop, the clock runs on', async () => {
    const { controller, sch, repl } = setup();
    repl.stop = vi.fn();
    const done = controller.switchTo('A');
    await untilCycle(sch, 12);
    await done;
    expect(repl.stop).not.toHaveBeenCalled();
    expect(sch.started).toBe(true);
    expect(sch.now()).toBeGreaterThan(11.75);
  });

  it('cleans up the old visuals, runs prepare, evaluates; a Dip ramps only after the new pattern is in', async () => {
    const { controller, sch, repl, gain } = setup({ settings: { type: 'dip', length: 1 } });
    const prepare = vi.fn(async () => repl.calls.push('prepare'));
    const origCancel = gain.cancelScheduledValues.bind(gain);
    gain.cancelScheduledValues = (t) => {
      repl.calls.push('ramp');
      origCancel(t);
    };
    const done = controller.switchTo('A', undefined, { prepare });
    await untilCycle(sch, 12);
    await done;
    expect(repl.calls.slice(0, 5)).toEqual(['cleanup', 'prepare', 'evaluate:A', 'setPattern', 'ramp']);
  });

  it('the new track starts from its own cycle 0 at T', async () => {
    const counting = s(cat('c0', 'c1', 'c2', 'c3'));
    const { controller, sch } = setup({ programs: { A: { pattern: counting } }, settings: { snap: 4 } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(names(sch.pattern, 12, 14).filter((n) => n !== 'old')).toEqual(['c0', 'c1']);
  });

  it('a prepare that throws is logged and ignored', async () => {
    const { controller, sch } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const done = controller.switchTo('A', undefined, {
      prepare: async () => {
        throw new Error('nope');
      },
    });
    await untilCycle(sch, 12);
    await expect(done).resolves.toBeDefined();
    warn.mockRestore();
  });

  it('a suspended AudioContext is resumed before the switch', async () => {
    const { controller, ctx, sch } = setup();
    ctx.state = 'suspended';
    const resume = vi.spyOn(ctx, 'resume');
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    await untilCycle(sch, 12);
    await done;
  });
});

// ---------------------------------------------------------------------------
describe('the end of a transition', () => {
  it('at T+L the scheduler gets the new pattern alone (the old one is no longer queried)', async () => {
    const { controller, sch, events } = setup({ settings: { type: 'crossfade', length: 2 } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 11.5);
    expect(names(sch.pattern, 11, 11.75)).toContain('old'); // still the combined pattern
    await untilCycle(sch, 11.85);
    const result = await done;
    expect(result).toMatchObject({ type: 'crossfade', T: 9.75, end: 11.75 });
    expect(eventNames(events)).toEqual(['waiting', 'start', 'end']);
    // The scheduler's pattern is now the new track shifted to its origin: no old part, no envelope.
    const haps = onsetHaps(sch.pattern, 9.75, 10.25);
    expect(haps.map((h) => h.value.s)).toEqual(['new', 'new']);
    expect(haps.every((h) => h.value.velocity === undefined)).toBe(true);
  });

  it('a hot-swap of the incoming track during the transition keeps the blend', async () => {
    const edited = s(sequence('edit', 'edit'));
    const { controller, sch, repl } = setup({
      programs: { A2: { pattern: edited } },
      settings: { type: 'crossfade', length: 4 },
    });
    controller.switchTo('A');
    await untilCycle(sch, 10.5);
    await settle(repl.evaluate('A2'));
    const haps = onsetHaps(sch.pattern, 11, 12);
    expect(haps.some((h) => h.value.s === 'old' && h.value.velocity < 1)).toBe(true);
    expect(haps.some((h) => h.value.s === 'edit' && h.value.velocity < 1)).toBe(true);
    expect(haps.some((h) => h.value.s === 'new')).toBe(false);
  });

  it('stopped() during a transition cancels it and resolves the switch', async () => {
    const { controller, sch } = setup({ settings: { length: 4 } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.5);
    controller.stopped();
    await expect(done).resolves.toMatchObject({ cancelled: true });
    expect(controller.getState().phase).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
describe('queue (ported): the latest request wins, a running transition is never interrupted', () => {
  it('two more switches during a transition: only the last one plays, after the first ends', async () => {
    const { controller, sch, repl, events } = setup({ programs: { B: { pattern: NEW }, C: { pattern: NEW } } });
    const first = controller.switchTo('A');
    await untilCycle(sch, 10.5);
    const b = controller.switchTo('B');
    const c = controller.switchTo('C');
    await expect(b).resolves.toEqual({ superseded: true });
    expect(repl.evaluate.mock.calls.map(([code]) => code)).toEqual(['A']); // nothing evaluated mid-transition
    await untilCycle(sch, 15);
    await first;
    await c;
    expect(repl.evaluate.mock.calls.map(([code]) => code)).toEqual(['A', 'C']);
    const ends = events.filter(([n]) => n === 'end');
    const secondWaiting = events.filter(([n]) => n === 'waiting')[1];
    expect(secondWaiting[1].T).toBeGreaterThanOrEqual(ends[0][1].end);
  });

  it('pressing Update again for the track being switched to does nothing (and drops a queued pick)', async () => {
    const { controller, sch, repl } = setup({ programs: { C: { pattern: NEW } } });
    const first = controller.switchTo('A');
    await untilCycle(sch, 10.5);
    const c = controller.switchTo('C');
    await expect(controller.switchTo('A')).resolves.toEqual({ ignored: true });
    await expect(c).resolves.toEqual({ superseded: true });
    await untilCycle(sch, 15);
    await first;
    expect(repl.evaluate.mock.calls.map(([code]) => code)).toEqual(['A']);
  });

  it('a queued reset (prepare) is kept when a later request replaces the code', async () => {
    const { controller, sch, repl } = setup({ programs: { B: { pattern: NEW }, C: { pattern: NEW } } });
    const prepare = vi.fn(async () => repl.calls.push('prepare'));
    controller.switchTo('A');
    await untilCycle(sch, 10.5);
    controller.switchTo('B', undefined, { prepare });
    const c = controller.switchTo('C');
    expect(prepare).not.toHaveBeenCalled();
    await untilCycle(sch, 15);
    await c;
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(repl.calls.indexOf('prepare')).toBeLessThan(repl.calls.indexOf('evaluate:C'));
  });

  it('a switch uses the settings in force when it begins; changing them mid-transition does not alter it', async () => {
    const { controller, sch, setSettings } = setup({ programs: { B: { pattern: NEW } } });
    controller.switchTo('A');
    await untilCycle(sch, 10.2);
    setSettings({ type: 'bassSwap' });
    // The running crossfade is unchanged: no high-pass anywhere in it.
    expect(onsetHaps(sch.pattern, 9.75, 11.75).every((h) => h.value.hcutoff === undefined)).toBe(true);
    const b = controller.switchTo('B');
    await untilCycle(sch, 16);
    await b;
    const startB = controller.getState();
    expect(startB.phase).toBe('idle');
  });

  it('the queued switch is a bass swap when the setting changed before it began', async () => {
    const { controller, sch, setSettings, events } = setup({ programs: { B: { pattern: NEW } } });
    controller.switchTo('A');
    await untilCycle(sch, 10.2);
    controller.switchTo('B');
    setSettings({ type: 'bassSwap' }); // after queueing, before it begins
    await untilCycle(sch, 12.6);
    const types = events.filter(([n]) => n === 'start').map(([, d]) => d.type);
    expect(types).toEqual(['crossfade', 'bassSwap']);
  });
});

// ---------------------------------------------------------------------------
describe('Dip: master fades ramp, never jump (ported)', () => {
  it('holds, ramps to silence over L cycles at the old tempo, then up over L cycles at the new one', async () => {
    const { controller, sch, gain } = setup({
      programs: { A: { pattern: NEW, cps: 1 } },
      settings: { type: 'dip', length: 2 },
    });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    // now ≈ 9.5, T = 9.75: 0.5 s to T at 0.5 cps; 2 cycles = 4 s down; 2 cycles at 1 cps = 2 s up.
    const [cancel, anchor, hold, down, up] = gain.calls;
    expect(cancel).toEqual(['cancelScheduledValues', 100]);
    expect(anchor).toEqual(['setValueAtTime', 1, 100]);
    expect(hold[0]).toBe('linearRampToValueAtTime');
    expect(hold[1]).toBe(1);
    expect(hold[2]).toBeCloseTo(100.5, 2);
    expect(down[1]).toBe(0);
    expect(down[2]).toBeCloseTo(104.5, 2);
    expect(up[1]).toBe(1);
    expect(up[2]).toBeCloseTo(106.5, 2);
  });

  it('never sets a level in one step: the only setValueAtTime anchors the current level', async () => {
    const { controller, sch, gain } = setup({ settings: { type: 'dip', length: 1 } });
    gain.linearRampToValueAtTime(0.8, 50); // the level is 0.8 now
    gain.calls.length = 0;
    const done = controller.switchTo('A');
    await untilCycle(sch, 12);
    await done;
    expect(gain.calls.filter(([m]) => m === 'value=')).toEqual([]);
    expect(gain.calls.filter(([m]) => m === 'setValueAtTime')).toEqual([['setValueAtTime', 0.8, 100]]);
    expect(jumpsTo(gain.calls, 0)).toEqual([]);
    expect(jumpsTo(gain.calls, 1)).toEqual([]);
  });

  it('uses the configured length for both ramps', async () => {
    const { controller, gain } = setup({ settings: { type: 'dip', length: 4 } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    const ramps = gain.calls.filter(([m]) => m === 'linearRampToValueAtTime');
    expect(ramps.length).toBe(3); // hold, down, up
    expect(ramps[1][2] - ramps[0][2]).toBeCloseTo(4 / CPS_120, 6);
    expect(ramps[2][2] - ramps[1][2]).toBeCloseTo(4 / 0.5, 6);
  });

  it('the new tempo is set only at the silent moment T+L, and the new track starts there', async () => {
    const { controller, sch } = setup({
      programs: { A: { pattern: NEW, cps: 1 } },
      settings: { type: 'dip', length: 1 },
    });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(names(sch.pattern, 9.75, 10.75).every((n) => n === 'old')).toBe(true);
    expect(names(sch.pattern, 10.75, 11)).toEqual(['new']);
    await untilCycle(sch, 10.7);
    expect(sch.cps).toBe(CPS_120);
    await untilCycle(sch, 10.85);
    expect(sch.cps).toBe(1);
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(10.75);
  });

  it('stopping during a Dip brings the volume back with a short ramp, not a jump (ported restore)', async () => {
    const { controller, sch, gain, ctx } = setup({ settings: { type: 'dip', length: 2 } });
    controller.switchTo('A');
    await untilCycle(sch, 10.5); // fading down
    ctx.currentTime = 102;
    controller.stopped();
    expect(gain.calls.slice(-3)).toEqual([
      ['cancelScheduledValues', 102],
      ['setValueAtTime', expect.any(Number), 102],
      ['linearRampToValueAtTime', 1, 102 + RESTORE_RAMP],
    ]);
    expect(RESTORE_RAMP).toBeLessThanOrEqual(0.1);
  });

  it('a switch with nothing to restore leaves the volume alone on stop', () => {
    const { controller, gain } = setup();
    controller.stopped();
    expect(gain.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('tempo plan', () => {
  it('glide 120 → 140 BPM: rises monotonically in ~16 steps per cycle and ends exactly on the new tempo', async () => {
    const { controller, sch } = setup({
      programs: { A: { pattern: NEW, cps: CPS_140 } },
      settings: { type: 'crossfade', length: 4, glide: true },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 14);
    await done;
    const values = sch.cpsLog.map(([, v]) => v);
    expect(values.length).toBeGreaterThanOrEqual(32);
    expect(values.length).toBeLessThanOrEqual(65);
    values.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(values[i]));
    expect(values[0]).toBeGreaterThan(CPS_120);
    expect(values[values.length - 1]).toBe(CPS_140);
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(9.75); // not before T
  });

  it('glide off: one change, straight to the new tempo at T', async () => {
    const { controller, sch } = setup({
      programs: { A: { pattern: NEW, cps: CPS_140 } },
      settings: { type: 'crossfade', length: 4, glide: false },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 14);
    await done;
    expect(sch.cpsLog.map(([, v]) => v)).toEqual([CPS_140]);
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(9.75);
    expect(sch.cpsLog[0][0]).toBeLessThan(9.85);
  });

  it.each(['dip', 'cut'])('%s ignores glide: one change to the new tempo', async (type) => {
    const { controller, sch } = setup({
      programs: { A: { pattern: NEW, cps: CPS_140 } },
      settings: { type, length: 1, glide: true },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 13);
    await done;
    expect(sch.cpsLog.map(([, v]) => v)).toEqual([CPS_140]);
  });

  it('glideCps: linear in steps, old before T, new from T+L', () => {
    const plan = { T: 10, L: 4, oldCps: 0.5, newCps: 0.75 };
    expect(glideCps(9.9, plan)).toBe(0.5);
    expect(glideCps(12, plan)).toBeCloseTo(0.625, 10);
    expect(glideCps(12.03, plan)).toBeCloseTo(0.625, 10); // inside one 1/16-cycle step
    expect(glideCps(14, plan)).toBe(0.75);
    expect(glideCps(20, plan)).toBe(0.75);
  });

  it('works with a NeoCyclist-shaped scheduler (setCps is a message, applied later)', async () => {
    const { controller, sch } = setup({
      neo: true,
      programs: { A: { pattern: NEW, cps: 0.7, loadMs: 100 } },
      settings: { type: 'crossfade', length: 1 },
    });
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(50);
    expect(sch.messages).toEqual([]); // captured during evaluate
    await untilCycle(sch, 11.5);
    await expect(done).resolves.toMatchObject({ type: 'crossfade' });
    expect(sch.messages).toEqual([['cpschange', 0.7]]);
    expect(sch.cps).toBe(0.7);
    expect(names(sch.pattern, 10, 10.25)).toEqual(['new']);
  });
});

// ---------------------------------------------------------------------------
describe('layered intro through the controller', () => {
  const layer = (id) => ({ id, pattern: s(sequence(id, id)) });
  const layers = ['a', 'b'].map(layer);
  const stacked = stack(...layers.map((l) => l.pattern));

  it('uses the repl’s state.layers: the second layer is silent until T + L/2', async () => {
    const { controller, sch } = setup({
      programs: { A: { pattern: stacked, layers } },
      settings: { type: 'layeredIntro', length: 4, snap: 4 },
    });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(names(sch.pattern, 12, 14)).not.toContain('b');
    expect(names(sch.pattern, 14, 14.5)).toContain('b');
  });

  it('with all()/each() in the code the layers are not used: crossfade of the whole pattern', async () => {
    const { controller, sch } = setup({
      programs: { 'all(x => x)': { pattern: stacked, layers } },
      settings: { type: 'layeredIntro', length: 4, snap: 4 },
    });
    controller.switchTo('all(x => x)');
    await vi.advanceTimersByTimeAsync(1);
    const b = onsetHaps(sch.pattern, 12, 14).filter((h) => h.value.s === 'b');
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((h) => h.value.velocity < 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('settings', () => {
  it('fills defaults and rejects unknown values', () => {
    expect(normalizeTransitionSettings(undefined)).toEqual({
      type: 'dip',
      length: 4,
      snap: 0,
      tempo: 'jump',
      matchLoudness: false,
    });
    expect(normalizeTransitionSettings({ type: 'wobble', length: 'abc', snap: 3 })).toMatchObject({
      type: 'dip',
      length: 4,
      snap: 0,
    });
  });

  it('a length outside the offered ones becomes the nearest offered length', () => {
    expect(normalizeTransitionSettings({ length: 30 }).length).toBe(16);
    expect(normalizeTransitionSettings({ length: 0.1 }).length).toBe(1);
    expect(normalizeTransitionSettings({ length: 3 }).length).toBe(2); // tie → shorter
    expect(normalizeTransitionSettings({ length: 8 }).length).toBe(8);
  });

  it('explicit settings override getSettings()', async () => {
    const { controller, sch, events } = setup({ settings: { type: 'crossfade' } });
    controller.switchTo('A', { type: 'cut' });
    await untilCycle(sch, 10.2);
    expect(events.find(([n]) => n === 'start')[1].type).toBe('cut');
  });

  it('Off (e.g. a queued switch that begins after Off was picked) cuts at once, unsnapped', async () => {
    const { controller, sch } = setup({ settings: { type: 'off' } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(names(sch.pattern, 9.75, 10)).toEqual(['new']);
    expect(names(sch.pattern, 9.5, 9.75)).toEqual(['old']);
  });
});

// ---------------------------------------------------------------------------
describe('re-evaluating the incoming track during a transition (Ctrl+Enter, not a switch)', () => {
  const CPS_70 = 70 / 60; // setcpm(70)

  it('crossfade with glide: a setcpm(70) mid-transition becomes the target, and the transition ends at 70', async () => {
    const { controller, sch, repl } = setup({
      programs: { A: { pattern: NEW, cps: CPS_140 }, A2: { pattern: NEW, cps: CPS_70 } },
      settings: { type: 'crossfade', length: 4, glide: true },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 11.75); // halfway through [9.75, 13.75]
    const before = sch.cps;
    expect(before).toBeGreaterThan(CPS_120);
    expect(before).toBeLessThan(CPS_140);
    await settle(repl.evaluate('A2'));
    expect(sch.cps).toBe(before); // not applied in one step: the glide carries on from here
    await untilCycle(sch, 12.75);
    expect(sch.cps).toBeGreaterThan(before);
    expect(sch.cps).toBeLessThan(CPS_70);
    await untilCycle(sch, 14);
    await done;
    expect(sch.cps).toBe(CPS_70);
    const afterRetarget = sch.cpsLog.filter(([at]) => at >= 11.75).map(([, v]) => v);
    afterRetarget.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(afterRetarget[i]));
    await untilCycle(sch, 15);
    expect(sch.cps).toBe(CPS_70); // nothing overwrites it after the end
  });

  it('while the switch waits for T (glide off): the old tempo holds until T, then 70', async () => {
    const { controller, sch, repl } = setup({
      programs: { A: { pattern: NEW, cps: CPS_140 }, A2: { pattern: NEW, cps: CPS_70 } },
      settings: { type: 'crossfade', length: 2, snap: 4 },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.5);
    await settle(repl.evaluate('A2'));
    expect(sch.cps).toBe(CPS_120); // the old track does not jump tempo before T
    await untilCycle(sch, 11.95);
    expect(sch.cps).toBe(CPS_120);
    await untilCycle(sch, 12.1);
    expect(sch.cps).toBe(CPS_70);
    await untilCycle(sch, 14.2);
    await done;
    expect(sch.cps).toBe(CPS_70);
    expect(sch.cpsLog.map(([, v]) => v)).toEqual([CPS_70]);
  });

  it('a re-evaluate without setcps keeps the planned tempo', async () => {
    const { controller, sch, repl } = setup({
      programs: { A: { pattern: NEW, cps: CPS_140 }, A2: { pattern: NEW } },
      settings: { type: 'crossfade', length: 2 },
    });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.5);
    await settle(repl.evaluate('A2'));
    await untilCycle(sch, 12);
    await done;
    expect(sch.cps).toBe(CPS_140);
  });
});

// ---------------------------------------------------------------------------
describe('Stop while a switch is evaluating', () => {
  /** Stop as the website does it: onToggle(false) → controller.stopped(), then setCps(0.5). */
  function stop(controller, repl, sch) {
    sch.stop();
    controller.stopped();
    repl.setCps(0.5);
  }

  it('the new track starts like a fresh track at its own setcps (not the old tempo)', async () => {
    const { controller, sch, repl } = setup({
      cps: 0.8,
      programs: { A: { pattern: NEW, cps: 0.7, loadMs: 200 } },
    });
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(50); // setcps(0.7) recorded, samples still loading
    stop(controller, repl, sch);
    await vi.advanceTimersByTimeAsync(300);
    await expect(done).resolves.toEqual({ immediate: true });
    expect(sch.cps).toBe(0.7);
    expect(sch.pattern).toBe(NEW); // from cycle 0, no transition
  });

  it('a new track without setcps starts at the reset tempo 0.5', async () => {
    const { controller, sch, repl } = setup({ cps: 0.8, programs: { A: { pattern: NEW, loadMs: 200 } } });
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(50);
    stop(controller, repl, sch);
    await vi.advanceTimersByTimeAsync(300);
    await done;
    expect(sch.cps).toBe(0.5);
  });

  it('a Stop during prepare: no transition is built after it (the new track starts on its own)', async () => {
    const { controller, sch, repl, events } = setup();
    let release;
    const prepare = () => new Promise((resolve) => (release = resolve));
    const done = controller.switchTo('A', undefined, { prepare });
    await vi.advanceTimersByTimeAsync(1);
    stop(controller, repl, sch);
    release();
    await settle(done);
    await expect(done).resolves.toEqual({ immediate: true });
    expect(sch.pattern).toBe(NEW);
    expect(controller.getState()).toMatchObject({ phase: 'idle', origin: 0 });
    expect(eventNames(events)).not.toContain('waiting');
  });
});

// ---------------------------------------------------------------------------
describe('old voices already handed to superdough are released (spec 2.5: nothing old after the end)', () => {
  /** The scheduler hands the new pattern's first notes to superdough as soon as it gets it. */
  function startsNewVoicesOnSetPattern(sch, voices) {
    const setPattern = sch.setPattern;
    sch.setPattern = async (pattern, autostart) => {
      await setPattern(pattern, autostart);
      voices.sounding.add('new-1');
    };
  }

  it('snapshots the voices at the switch and releases only those, not the new track’s', async () => {
    const voices = createFakeVoices(['pad', 'hat']);
    const { controller, sch } = setup({ voices });
    startsNewVoicesOnSetPattern(sch, voices);
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(voices.releaseSounds).toHaveBeenCalledTimes(1);
    expect(voices.releaseSounds.mock.calls[0][0]).toEqual(['pad', 'hat']);
  });

  it('Crossfade: the fade starts at T and the voices are silent by T+L (AudioContext seconds)', async () => {
    const voices = createFakeVoices(['pad']);
    const { controller } = setup({ voices, settings: { type: 'crossfade', length: 2 } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    // now ≈ 9.5, T = 9.75 at 0.5 cps → T is 0.5 s ahead of currentTime 100; 2 cycles = 4 s.
    const [, end, start] = voices.releaseSounds.mock.calls[0];
    expect(start).toBeCloseTo(100.5, 2);
    expect(end).toBeCloseTo(104.5, 2);
  });

  it('a faster new tempo makes T+L sooner: the release ends by then', async () => {
    const voices = createFakeVoices(['pad']);
    const { controller } = setup({
      voices,
      programs: { A: { pattern: NEW, cps: 1 } },
      settings: { type: 'crossfade', length: 2 },
    });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    const [, end, start] = voices.releaseSounds.mock.calls[0];
    expect(end - start).toBeCloseTo(2, 6); // 2 cycles at 1 cps
  });

  it('Dip: silent by the end of the fade-down, whatever the new tempo', async () => {
    const voices = createFakeVoices(['pad']);
    const { controller, gain } = setup({
      voices,
      programs: { A: { pattern: NEW, cps: 1 } },
      settings: { type: 'dip', length: 2 },
    });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    const [, end, start] = voices.releaseSounds.mock.calls[0];
    const silent = gain.calls.find(([m, v]) => m === 'linearRampToValueAtTime' && v === 0)[2];
    expect(end).toBeCloseTo(silent, 6);
    expect(end - start).toBeCloseTo(4, 6);
  });

  it.each(['cut', 'echoOut'])('%s: a short ramp (~30 ms) at T, never a jump', async (type) => {
    const voices = createFakeVoices(['pad']);
    const { controller } = setup({ voices, settings: { type } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    const [, end, start] = voices.releaseSounds.mock.calls[0];
    expect(start).toBeCloseTo(101, 2); // T = 10: 0.5 cycles = 1 s ahead
    expect(end - start).toBeCloseTo(0.03, 6);
  });

  it('a new track that fails releases nothing (the old track keeps playing in full)', async () => {
    const voices = createFakeVoices(['pad']);
    const { controller } = setup({ voices });
    await controller.switchTo('broken(').catch(() => {});
    expect(voices.releaseSounds).not.toHaveBeenCalled();
  });

  it('starting with nothing playing releases nothing', async () => {
    const voices = createFakeVoices(['preview-voice']);
    const { controller } = setup({ voices, playing: false });
    await settle(controller.switchTo('A'));
    expect(voices.releaseSounds).not.toHaveBeenCalled();
  });

  it('a voice list or release that throws does not break the switch', async () => {
    const voices = createFakeVoices(['pad']);
    voices.releaseSounds.mockImplementation(() => {
      throw new Error('gone');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controller, sch } = setup({ voices });
    const done = controller.switchTo('A');
    await untilCycle(sch, 12);
    await expect(done).resolves.toMatchObject({ type: 'crossfade' });
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe('setOutput: following a replaced master output (superdough resetGlobalEffects)', () => {
  it('a Dip after the output was replaced ramps the new destinationGain, not the dead one', async () => {
    const { controller, ctx, gain: oldGain } = setup({ settings: { type: 'dip' } });
    const fresh = ctx.createGain();

    expect(controller.setOutput({ destinationGain: fresh })).toBe(true);
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(10);

    expect(fresh.gain.calls.some(([m]) => m === 'linearRampToValueAtTime')).toBe(true);
    expect(oldGain.calls.some(([m]) => m === 'linearRampToValueAtTime')).toBe(false);
  });

  it('the loudness tap on the old output is disconnected', () => {
    const { controller, destinationGain } = setup();
    controller._sampleLoudness(); // creates the tap on the current output
    const analyser = controller.meter.analyser;
    expect(destinationGain.connections).toContain(analyser);

    controller.setOutput({ destinationGain: new MockAudioContext().createGain() });

    expect(controller.meter).toBeNull();
    expect(destinationGain.connections).not.toContain(analyser);
  });

  it('does nothing when the output is unchanged, or while a switch is in flight', async () => {
    const { controller, ctx, destinationGain } = setup({ settings: { type: 'dip' } });
    expect(controller.setOutput({ audioContext: ctx, destinationGain })).toBe(false);

    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.busy).toBe(true);
    expect(controller.setOutput({ destinationGain: ctx.createGain() })).toBe(false);
    expect(controller.destinationGain).toBe(destinationGain);
  });
});

// ---------------------------------------------------------------------------
// Spec 027 §2.1: Snap boundaries count from the playing track's own cycle 0.
describe('spec 027: phrase origin', () => {
  /** Spec 017's formula, for the "origin 0 is unchanged" check. */
  const start017 = (now, { type, snap = 0 }) => {
    const base = now + SAFETY_MARGIN;
    const size = Math.max(snap || 0, type === 'cut' || type === 'echoOut' ? 1 : 0);
    if (size > 0) return (Math.floor(base / size) + 1) * size;
    const grid = type === 'off' ? 1 / 16 : 1 / 4;
    return Math.ceil(base / grid - 1e-9) * grid;
  };

  it('Snap offers 16 cycles, and a saved 16 survives normalize', () => {
    expect(TRANSITION_SNAPS).toEqual([0, 1, 4, 8, 16]);
    expect(normalizeTransitionSettings({ snap: 16 }).snap).toBe(16);
    expect(normalizeTransitionSettings({ snap: 2 }).snap).toBe(0);
    expect(normalizeTransitionSettings({ snap: 'abc' }).snap).toBe(0);
  });

  it('origin 6, Snap 8, Update at 9: T is 14 (the track’s cycle 8), not 16', () => {
    expect(transitionStart(9, { type: 'crossfade', snap: 8 }, 6)).toBe(14);
    expect(transitionStart(9, { type: 'crossfade', snap: 8 })).toBe(16); // negative: from scheduler cycle 0
  });

  it('Snap 16 at the track’s cycle 20 (origin 0): T is 32', () => {
    expect(transitionStart(20, { type: 'crossfade', snap: 16 }, 0)).toBe(32);
  });

  it('Cut with Snap off counts the track’s own cycles from a fractional origin', () => {
    // The track's cycle 1.6 at scheduler 4.1: its next cycle (2) is scheduler 4.5.
    expect(transitionStart(4.1, { type: 'cut', snap: 0 }, 2.5)).toBe(4.5);
    expect(transitionStart(4.1, { type: 'cut', snap: 0 }, 0)).toBe(5); // negative: global cycles
  });

  it('a boundary inside the safety margin is skipped, counted from the origin', () => {
    expect(transitionStart(14.6, { type: 'crossfade', snap: 4 }, 10.75)).toBe(18.75);
  });

  it('origin 0 gives exactly spec 017’s T for every type and snap', () => {
    for (const type of ['crossfade', 'cut', 'echoOut', 'dip', 'off']) {
      for (const snap of [0, 1, 4, 8]) {
        for (let now = 0; now < 40; now += 0.0731) {
          expect(transitionStart(now, { type, snap }, 0)).toBe(start017(now, { type, snap }));
        }
      }
    }
  });

  it('without a snap the beat grid stays global (the origin is ignored)', () => {
    expect(transitionStart(9.5, { type: 'crossfade', snap: 0 }, 6.3)).toBe(9.75);
    expect(transitionStart(9.5, { type: 'off', snap: 0 }, 6.3)).toBe(transitionStart(9.5, { type: 'off', snap: 0 }));
  });

  it('after a Dip, the next Snap 4 switch counts from where the Dip’s new track began', async () => {
    const { controller, sch, events } = setup({
      programs: { B: { pattern: OLD } },
      settings: { type: 'dip', length: 1 },
    });
    const first = controller.switchTo('A');
    await untilCycle(sch, 11.8); // T 9.75, silent (the new track's cycle 0) at 10.75, end 11.75
    await first;
    expect(controller.origin).toBe(10.75);
    controller.switchTo('B', { type: 'crossfade', length: 1, snap: 4 });
    await vi.advanceTimersByTimeAsync(1);
    const waiting = events.filter(([n]) => n === 'waiting').pop();
    expect(waiting[1].T).toBe(14.75); // the track's cycle 4, not scheduler cycle 16
  });

  it('the speakers’ scratch shift (getTrackShift) moves the phrase origin, read before evaluate', async () => {
    let shift = 1.5;
    const { controller, sch, events } = setup({
      // The scratch offset drops the shift once the switch is busy (PatternOffset.editPattern).
      programs: { B: { pattern: OLD, during: () => (shift = 0) } },
      settings: { type: 'cut' },
      getTrackShift: () => shift,
    });
    shift = 0;
    const first = controller.switchTo('A');
    await untilCycle(sch, 10.1);
    await first;
    expect(controller.origin).toBe(10);
    shift = 1.5; // scratched 1.5 cycles late: the track's cycle 0 is at 11.5
    controller.switchTo('B', { type: 'crossfade', length: 1, snap: 4 });
    await vi.advanceTimersByTimeAsync(1);
    expect(events.filter(([n]) => n === 'waiting').pop()[1].T).toBe(11.5);
  });

  it('negative pair: with no shift the same switch waits for the track’s cycle 4', async () => {
    const { controller, sch, events } = setup({
      programs: { B: { pattern: OLD } },
      settings: { type: 'cut' },
      getTrackShift: () => 0,
    });
    const first = controller.switchTo('A');
    await untilCycle(sch, 10.1);
    await first;
    controller.switchTo('B', { type: 'crossfade', length: 1, snap: 4 });
    await vi.advanceTimersByTimeAsync(1);
    expect(events.filter(([n]) => n === 'waiting').pop()[1].T).toBe(14);
  });

  describe('a pending scratch shift (an Update during a spin-up) moves the origin only from its atCycle', () => {
    async function afterCut(shift) {
      const ctx = setup({
        programs: { B: { pattern: OLD } },
        settings: { type: 'cut' },
        getTrackShift: () => shift.value,
      });
      shift.value = 0;
      const first = ctx.controller.switchTo('A');
      await untilCycle(ctx.sch, 10.1);
      await first; // origin 10, now ≈ 10.1
      return ctx;
    }
    const waitingT = async ({ controller, events }) => {
      controller.switchTo('B', { type: 'crossfade', length: 1, snap: 4 });
      await vi.advanceTimersByTimeAsync(1);
      return events.filter(([n]) => n === 'waiting').pop()[1].T;
    };

    it('T before atCycle counts from the settled shift', async () => {
      const shift = {};
      const ctx = await afterCut(shift);
      shift.value = { cycles: 0, pending: { cycles: 1.5, atCycle: 20 } };
      expect(await waitingT(ctx)).toBe(14); // the track's cycle 4; not 11.5 or 15.5
    });

    it('T after atCycle counts from the full shift', async () => {
      const shift = {};
      const ctx = await afterCut(shift);
      shift.value = { cycles: 0, pending: { cycles: 1.5, atCycle: 10.2 } };
      expect(await waitingT(ctx)).toBe(11.5);
    });

    it('a full-shift boundary before atCycle is skipped: the first one at or after it', async () => {
      const shift = {};
      const ctx = await afterCut(shift);
      shift.value = { cycles: 0, pending: { cycles: 1.5, atCycle: 12 } };
      expect(await waitingT(ctx)).toBe(15.5); // 11.5 is before the shift applies
    });

    it('settled and pending parts add up; a malformed pending part is ignored; a number still works', async () => {
      for (const [value, T] of [
        [{ cycles: 1.5, pending: { cycles: 1, atCycle: 10.2 } }, 12.5],
        [{ cycles: 1.5, pending: { cycles: 'x', atCycle: 10.2 } }, 11.5],
        [{ cycles: 1.5, pending: null }, 11.5],
        [1.5, 11.5],
      ]) {
        const shift = {};
        const ctx = await afterCut(shift);
        shift.value = value;
        expect(await waitingT(ctx)).toBe(T);
      }
    });
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
    ['returns NaN', () => NaN],
    ['returns a string', () => 'x'],
  ])('a getTrackShift that %s counts as 0 and warns', async (_label, getTrackShift) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controller, events } = setup({ settings: { type: 'crossfade', snap: 4 }, getTrackShift });
    controller.origin = 6;
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    expect(events[0][1].T).toBe(10); // origin 6 + 4
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Spec 027 §2.2: the Tempo choice.
describe('spec 027: tempo settings', () => {
  it('TRANSITION_TEMPOS and the default, exported from the package', () => {
    expect(TRANSITION_TEMPOS).toEqual(['jump', 'glide', 'match', 'keep']);
    expect(mixer.TRANSITION_TEMPOS).toBe(TRANSITION_TEMPOS);
    expect(mixer.DEFAULT_TRANSITION_SETTINGS.tempo).toBe('jump');
    expect(mixer.DEFAULT_TRANSITION_SETTINGS).not.toHaveProperty('glide');
  });

  it.each(TRANSITION_TEMPOS)('tempo %s is kept', (tempo) => {
    expect(normalizeTransitionSettings({ tempo }).tempo).toBe(tempo);
  });

  it('legacy glide: true becomes glide; false, missing or garbage becomes jump; no glide field', () => {
    expect(normalizeTransitionSettings({ glide: true }).tempo).toBe('glide');
    expect(normalizeTransitionSettings({ glide: false }).tempo).toBe('jump');
    expect(normalizeTransitionSettings({ glide: 'true' }).tempo).toBe('jump');
    expect(normalizeTransitionSettings({ tempo: 'fast' }).tempo).toBe('jump');
    expect(normalizeTransitionSettings({ tempo: 'fast', glide: true }).tempo).toBe('glide');
    expect(normalizeTransitionSettings({}).tempo).toBe('jump');
    expect(normalizeTransitionSettings({ glide: true })).not.toHaveProperty('glide');
  });

  it('a valid tempo wins over legacy glide', () => {
    expect(normalizeTransitionSettings({ tempo: 'keep', glide: true }).tempo).toBe('keep');
    expect(normalizeTransitionSettings({ tempo: 'jump', glide: true }).tempo).toBe('jump');
  });
});

describe('spec 027: tempo plans', () => {
  const CPS_90 = 90 / 60 / 4;
  const CPS_150 = 150 / 60 / 4;
  const programs = {
    A: { pattern: NEW, cps: CPS_140 },
    A150: { pattern: NEW, cps: CPS_150 },
    B: { pattern: OLD, cps: CPS_90 },
    C: { pattern: OLD, cps: 0.9 },
    N: { pattern: NEW }, // no setcps
  };
  const values = (sch) => sch.cpsLog.map(([, v]) => v);

  it('jump (tempo: jump): one change, straight to the new tempo at T (017 kept)', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'crossfade', length: 4, tempo: 'jump' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 14);
    await done;
    expect(values(sch)).toEqual([CPS_140]);
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(9.75);
    expect(sch.cpsLog[0][0]).toBeLessThan(9.85);
    expect(controller.getState().tempoHold).toBe(null);
  });

  it('glide during (tempo: glide): rises over the overlap and ends on the new tempo (017 kept)', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'crossfade', length: 4, tempo: 'glide' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 14);
    await done;
    const v = values(sch);
    expect(v.length).toBeGreaterThanOrEqual(32);
    v.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(v[i]));
    expect(v[v.length - 1]).toBe(CPS_140);
    expect(sch.cpsLog[v.length - 1][0]).toBeLessThanOrEqual(13.85); // done by T+L
    expect(controller.getState().tempoHold).toBe(null);
  });

  it('match, crossfade L4, 120 → 140: 120 until the end, then steps up to 140 over 4 cycles, and stays', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'crossfade', length: 4, tempo: 'match' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 13.7); // T 9.75, end 13.75
    expect(values(sch)).toEqual([]); // the old track never changes tempo
    await untilCycle(sch, 13.8);
    await done;
    expect(controller.getState().tempoHold).toBe('glide');
    await untilCycle(sch, 15.75);
    expect(sch.cps).toBeGreaterThan(CPS_120);
    expect(sch.cps).toBeLessThan(CPS_140);
    await untilCycle(sch, 17.9);
    const v = values(sch);
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(13.75);
    expect(v.length).toBeGreaterThanOrEqual(32); // stepped, never one jump
    v.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(v[i]));
    expect(v[v.length - 1]).toBe(CPS_140);
    expect(sch.cpsLog[v.length - 1][0]).toBeLessThanOrEqual(17.85);
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original); // after a glide hold ends
    await untilCycle(sch, 20);
    expect(values(sch).length).toBe(v.length); // and stays
  });

  it('match with Cut and Length 8: starts at 120, reaches 140 8 cycles later', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'cut', length: 8, tempo: 'match' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.5); // T = 10
    await done;
    // The new track starts at 120; the slide's first step (1/128 of the way: 16 per cycle) is not before T.
    expect(sch.cpsLog[0][0]).toBeGreaterThanOrEqual(10);
    expect(sch.cpsLog[0][1]).toBeCloseTo(CPS_120 + (CPS_140 - CPS_120) / 128, 10);
    expect(names(sch.pattern, 10.5, 11)).toEqual(['new', 'new']);
    await untilCycle(sch, 14);
    expect(sch.cps).toBeGreaterThan(CPS_120);
    expect(sch.cps).toBeLessThan(CPS_140);
    await untilCycle(sch, 17.85);
    expect(sch.cps).toBeLessThan(CPS_140);
    await untilCycle(sch, 18.1);
    expect(sch.cps).toBe(CPS_140);
  });

  it('match with Dip: the new tempo is not set at T+L; the fade-up runs at the old tempo; then the slide', async () => {
    const { controller, sch, gain } = setup({ programs, settings: { type: 'dip', length: 1, tempo: 'match' } });
    const done = controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    const ramps = gain.calls.filter(([m]) => m === 'linearRampToValueAtTime');
    expect(ramps[2][2] - ramps[1][2]).toBeCloseTo(1 / CPS_120, 6); // up over 1 cycle at 120
    await untilCycle(sch, 11.7); // silent at 10.75, end 11.75
    expect(values(sch)).toEqual([]);
    await untilCycle(sch, 11.8);
    await done;
    await untilCycle(sch, 12.85);
    expect(sch.cps).toBe(CPS_140);
  });

  it('negative pair: jump with Dip still sets the new tempo at T+L and fades up at it', async () => {
    const { controller, sch, gain } = setup({ programs, settings: { type: 'dip', length: 1, tempo: 'jump' } });
    controller.switchTo('A');
    await vi.advanceTimersByTimeAsync(1);
    const ramps = gain.calls.filter(([m]) => m === 'linearRampToValueAtTime');
    expect(ramps[2][2] - ramps[1][2]).toBeCloseTo(1 / CPS_140, 6);
    await untilCycle(sch, 10.85);
    expect(sch.cps).toBe(CPS_140);
  });

  it('dip and cut play glide as jump: one change, no hold', async () => {
    for (const type of ['dip', 'cut']) {
      const { controller, sch } = setup({ programs, settings: { type, length: 1, tempo: 'glide' } });
      const done = controller.switchTo('A');
      await untilCycle(sch, 13);
      await done;
      expect(values(sch)).toEqual([CPS_140]);
      expect(controller.getState().tempoHold).toBe(null);
    }
  });

  it('Off has no tempo modifier: match jumps at once and leaves no hold', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'off', tempo: 'match' } });
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.5);
    await done;
    expect(sch.cps).toBe(CPS_140);
    expect(controller.getState().tempoHold).toBe(null);
  });

  it('keep: 120 → 140 → 90 is all heard at 120', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'crossfade', length: 1, tempo: 'keep' } });
    const original = sch.setCps;
    const first = controller.switchTo('A');
    await untilCycle(sch, 11);
    await first;
    expect(controller.getState().tempoHold).toBe('keep');
    const second = controller.switchTo('B');
    await untilCycle(sch, 12.5);
    await second;
    await untilCycle(sch, 15);
    expect(values(sch)).toEqual([]);
    expect(sch.cps).toBe(CPS_120);
    expect(controller.getState().tempoHold).toBe('keep');
    controller.stopped();
    expect(sch.setCps).toBe(original); // after Stop
  });

  it('keep: a hot swap still setting the track’s own tempo is ignored; a new tempo applies at once', async () => {
    const { controller, sch, repl } = setup({ programs, settings: { type: 'crossfade', length: 1, tempo: 'keep' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 11);
    await done;
    await settle(repl.evaluate('A')); // only a note changed: its code still says 140
    expect(sch.cps).toBe(CPS_120);
    expect(controller.getState().tempoHold).toBe('keep');
    await settle(repl.evaluate('A150')); // the tempo changed on purpose
    expect(sch.cps).toBe(CPS_150);
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
  });

  it('keep: a track whose code sets no tempo keeps the set tempo on hot swaps', async () => {
    const { controller, sch, repl } = setup({ cps: 0.6, programs, settings: { type: 'cut', tempo: 'keep' } });
    const done = controller.switchTo('N');
    await untilCycle(sch, 10.2);
    await done;
    await settle(repl.evaluate('N'));
    expect(sch.cps).toBe(0.6);
    expect(controller.getState().tempoHold).toBe('keep');
  });

  it('negative pair: under jump, a track whose code sets no tempo runs at the default', async () => {
    const { controller, sch } = setup({ cps: 0.6, programs, settings: { type: 'cut', tempo: 'jump' } });
    const done = controller.switchTo('N');
    await untilCycle(sch, 10.2);
    await done;
    expect(sch.cps).toBe(0.5);
  });

  it('a slide after the transition: a hot swap’s setcps applies at once and the slide stops', async () => {
    const { controller, sch, repl } = setup({ programs, settings: { type: 'cut', length: 8, tempo: 'match' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 12);
    await done;
    expect(controller.getState().tempoHold).toBe('glide');
    await settle(repl.evaluate('C'));
    expect(sch.cps).toBe(0.9);
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
    const count = sch.cpsLog.length;
    await untilCycle(sch, 20);
    expect(sch.cpsLog.length).toBe(count); // never fought over
  });

  it('a switch during a slide starts from the tempo the slide reached; setCps is the original afterwards', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'cut', length: 8, tempo: 'match' } });
    const original = sch.setCps;
    const first = controller.switchTo('A');
    await untilCycle(sch, 14);
    await first;
    const reached = sch.cps;
    expect(reached).toBeGreaterThan(CPS_120);
    expect(reached).toBeLessThan(CPS_140);
    const second = controller.switchTo('C', { type: 'crossfade', length: 1, tempo: 'jump' });
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().tempoHold).toBe(null);
    expect(controller.active.oldCps).toBe(reached);
    const cpsAtArm = sch.cps;
    await untilCycle(sch, controller.active.T - 0.05);
    expect(sch.cps).toBe(cpsAtArm); // the slide no longer moves the tempo
    await untilCycle(sch, controller.active.end + 0.1);
    await second;
    expect(sch.cps).toBe(0.9);
    expect(sch.setCps).toBe(original);
  });

  it('a switch during a keep hold starts from the held tempo; setCps is the original afterwards', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'cut', tempo: 'keep' } });
    const original = sch.setCps;
    const first = controller.switchTo('A');
    await untilCycle(sch, 10.2);
    await first;
    const second = controller.switchTo('B', { type: 'cut', tempo: 'jump' });
    await untilCycle(sch, 11.2);
    await second;
    expect(sch.cps).toBe(CPS_90);
    expect(sch.setCps).toBe(original);
  });

  it('Stop during a slide ends it: no more tempo changes, setCps is the original, Play is at the track’s own tempo', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'cut', length: 8, tempo: 'match' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 12);
    await done;
    controller.stopped();
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
    sch.setCps(0.5); // onToggle(false)'s tempo reset reaches the clock
    const count = sch.cpsLog.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(sch.cpsLog.length).toBe(count);
    expect(sch.cps).toBe(0.5);
  });

  it('destroy during a hold restores setCps', async () => {
    for (const tempo of ['match', 'keep']) {
      const { controller, sch } = setup({ programs, settings: { type: 'cut', length: 8, tempo } });
      const original = sch.setCps;
      const done = controller.switchTo('A');
      await untilCycle(sch, 10.5);
      await done;
      expect(sch.setCps).not.toBe(original);
      controller.destroy();
      expect(sch.setCps).toBe(original);
      expect(controller.tempoHold).toBe(null);
    }
  });

  it('a failed switch during a keep hold keeps it (spec 027 §2.2): the same tempo is still ignored', async () => {
    const { controller, sch, repl } = setup({ programs, settings: { type: 'cut', tempo: 'keep' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.2);
    await done;
    const err = await settle(controller.switchTo('broken(').catch((e) => e));
    expect(err.evaluateFailed).toBe(true);
    expect(controller.getState().tempoHold).toBe('keep');
    expect(sch.cps).toBe(CPS_120);
    await settle(repl.evaluate('A')); // the playing track's hot swap, its code still says 140
    expect(sch.cps).toBe(CPS_120);
    expect(sch.cpsLog).toEqual([]);
    await settle(repl.evaluate('A150')); // a new tempo still ends it
    expect(sch.cps).toBe(CPS_150);
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
  });

  it('a failed switch mid-slide: the slide continues to 140, never a step bigger than a glide step', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'cut', length: 8, tempo: 'match' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 14); // T 10: the slide runs over [10, 18]
    await done;
    await settle(controller.switchTo('broken(').catch(() => {}));
    expect(controller.getState().tempoHold).toBe('glide');
    await untilCycle(sch, 18.2);
    const v = [CPS_120, ...values(sch)];
    const step = (CPS_140 - CPS_120) / (8 * 16);
    v.slice(1).forEach((x, i) => {
      expect(x).toBeGreaterThan(v[i]);
      expect(x - v[i]).toBeLessThanOrEqual(step * 1.05);
    });
    expect(v[v.length - 1]).toBe(CPS_140);
    expect(sch.cpsLog[sch.cpsLog.length - 1][0]).toBeLessThanOrEqual(18.1);
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
  });

  it('negative pair: a failed switch after the slide’s end lands on the target, with no hold left', async () => {
    const { controller, sch, repl } = setup({ programs, settings: { type: 'cut', length: 1, tempo: 'match' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.5); // T 10: the slide runs over [10, 11]
    await done;
    repl.evaluate.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 2000)); // 1+ cycles: the slide would have ended
      throw new Error('broken');
    });
    const failed = controller.switchTo('slow').catch((e) => e);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await failed).evaluateFailed).toBe(true);
    expect(sch.cps).toBe(CPS_140);
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
  });

  it('a failed switch with another switch queued: the queued one starts from the restored hold', async () => {
    const { controller, sch } = setup({ programs, settings: { type: 'cut', tempo: 'keep' } });
    const original = sch.setCps;
    const first = controller.switchTo('A');
    await untilCycle(sch, 10.2);
    await first;
    const failed = controller.switchTo('broken(').catch((e) => e);
    const queued = controller.switchTo('B', { type: 'cut', tempo: 'jump' });
    await vi.advanceTimersByTimeAsync(1);
    expect((await failed).evaluateFailed).toBe(true);
    expect(controller.getState().tempoHold).toBe(null); // ended again by the queued switch
    expect(controller.active.oldCps).toBe(CPS_120);
    await untilCycle(sch, 11.2);
    await queued;
    expect(sch.cps).toBe(CPS_90);
    expect(sch.setCps).toBe(original);
  });

  it('negative pair: a Stop while the failing switch evaluates does not bring the hold back', async () => {
    const { controller, sch, repl } = setup({ programs, settings: { type: 'cut', tempo: 'keep' } });
    const original = sch.setCps;
    const done = controller.switchTo('A');
    await untilCycle(sch, 10.2);
    await done;
    repl.evaluate.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 500));
      throw new Error('broken');
    });
    const failed = controller.switchTo('slow').catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    sch.stop();
    controller.stopped();
    await vi.advanceTimersByTimeAsync(500);
    await failed;
    expect(controller.getState().tempoHold).toBe(null);
    expect(sch.setCps).toBe(original);
  });
});

describe('real @strudel/core repl + Cyclist', () => {
  beforeAll(async () => {
    await evalScope(core);
  });

  function realSetup() {
    const played = [];
    let controller;
    const r = createRepl({
      getTime: () => Date.now() / 1000,
      defaultOutput: (hap, _deadline, _duration, cps) =>
        played.push({ s: hap.value.s, at: hap.whole.begin.valueOf(), velocity: hap.value.velocity, cps }),
      editPattern: (pattern) => controller.editPattern(pattern),
    });
    controller = new TrackTransitionController({ repl: r });
    return { r, controller, played };
  }

  it('crossfade: setcps captured, both tracks on one grid, old gone at T+L, new from its cycle 0', async () => {
    const { r, controller, played } = realSetup();
    await r.evaluate('s(seq("o", "o"))');
    await vi.advanceTimersByTimeAsync(5000); // a few cycles at 0.5 cps
    const done = controller.switchTo('(setcps(1), s(seq("n", "n", "n", "n")))', { type: 'crossfade', length: 1 });
    await vi.advanceTimersByTimeAsync(1);
    const { T, end } = controller.getState();
    expect(r.scheduler.cps).toBe(0.5); // captured, not applied
    await vi.advanceTimersByTimeAsync(4000);
    await done;
    r.stop();

    const old = played.filter((p) => p.s === 'o');
    const neu = played.filter((p) => p.s === 'n');
    expect(old.filter((p) => p.at >= end)).toEqual([]);
    expect(old.filter((p) => p.at >= T).every((p) => p.velocity < 1)).toBe(true);
    expect(Math.min(...neu.map((p) => p.at))).toBe(T);
    expect(neu.filter((p) => p.at < end).every((p) => p.velocity < 1)).toBe(true);
    expect(neu.filter((p) => p.at >= end + 0.5).every((p) => p.velocity === undefined && p.cps === 1)).toBe(true);
    expect(old.filter((p) => p.at < T - 0.5).every((p) => p.cps === 0.5)).toBe(true);
  });

  it('broken new code: the old track keeps playing at its tempo', async () => {
    const { r, controller, played } = realSetup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await r.evaluate('s(seq("o", "o"))');
    await vi.advanceTimersByTimeAsync(2000);
    const err = await controller.switchTo('(setcps(2), s(seq("n"', { type: 'crossfade', length: 1 }).catch((e) => e);
    const count = played.length;
    await vi.advanceTimersByTimeAsync(3000);
    r.stop();
    errorSpy.mockRestore();
    expect(err.evaluateFailed).toBe(true);
    expect(r.scheduler.cps).toBe(0.5);
    expect(played.length).toBeGreaterThan(count);
    expect(played.every((p) => p.s === 'o')).toBe(true);
  });
});
