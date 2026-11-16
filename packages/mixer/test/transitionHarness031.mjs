/**
 * A fake repl + Cyclist-shaped scheduler + superdough voices for TrackTransitionController tests
 * (spec 031), the same contract as TrackTransitionController.test.mjs: `setPattern` runs
 * `editPattern`; `evaluate` swallows code errors; `setcps` calls `scheduler.setCps` by method
 * lookup; the clock is the fake timers' Date.now(). Not a test file itself.
 *
 * @license AGPL-3.0-or-later
 */
import { vi } from 'vitest';
import { s, sequence } from '@strudel/core';
import { TrackTransitionController } from '../TrackTransitionController.mjs';
import { MockAudioContext } from './webAudioMock.mjs';

/** The playing track: four "old" events per cycle. */
export const OLD = s(sequence('old', 'old', 'old', 'old'));
/** The incoming track: four "new" events per cycle. */
export const NEW = s(sequence('new', 'new', 'new', 'new'));

/**
 * A Cyclist-shaped scheduler: `now()` advances with Date.now() at `cps`; setCps keeps continuity.
 * @param {object} [options]
 * @param {number} [options.cycle=9.5] - The cycle at creation.
 * @param {number} [options.cps=0.5]
 * @param {boolean} [options.started=true]
 * @returns {object}
 */
export function createFakeScheduler({ cycle = 9.5, cps = 0.5, started = true } = {}) {
  const sch = {
    started,
    cps,
    latency: 0,
    pattern: undefined,
    anchorCycle: cycle,
    anchorMs: Date.now(),
    cpsLog: [],
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
 * The repl contract the controller relies on (packages/core/repl.mjs).
 * @param {object} scheduler
 * @param {Object<string, object>} programs - code → `{ pattern, cps?, layers? }`; unknown code fails.
 * @returns {object}
 */
export function createFakeRepl(scheduler, programs) {
  const repl = {
    scheduler,
    state: { pattern: undefined, layers: [], evalError: undefined },
    editPattern: undefined,
    async setPattern(pattern, autostart = true) {
      const edited = repl.editPattern?.(pattern) || pattern;
      await scheduler.setPattern(edited, autostart);
      return edited;
    },
    setCps(cps) {
      scheduler.setCps(cps);
    },
    evaluate: vi.fn(async (code) => {
      await Promise.resolve();
      const program = programs[code];
      try {
        if (!program) {
          throw new Error(`SyntaxError in ${code}`);
        }
        if (program.cps !== undefined) {
          repl.setCps(program.cps);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        repl.state.layers = program.layers ?? [];
        repl.state.pattern = await repl.setPattern(program.pattern);
      } catch (error) {
        repl.state.evalError = error;
      }
    }),
  };
  return repl;
}

/**
 * superdough's active voices, faked: `sounding` maps each voice id to the side its hap was stamped
 * with (`_mixSide`: 'old', 'new', or undefined for an unstamped voice), as superdough's fork
 * addition records it. `getActiveSoundIds(side)` filters by side like `getActiveSoundIds(owner, side)`;
 * `start(id, side)` adds a voice; releaseSounds records its calls and ends the voices.
 * @param {Array<number|Array>} [ids] - Ids (unstamped) or `[id, side]` pairs.
 * @returns {object}
 */
export function createFakeVoices(ids = []) {
  const voices = {
    sounding: new Map(ids.map((entry) => (Array.isArray(entry) ? entry : [entry, undefined]))),
    start(id, side) {
      voices.sounding.set(id, side);
    },
    getActiveSoundIds: vi.fn((side) =>
      [...voices.sounding].filter(([, s]) => side === undefined || s === side).map(([id]) => id),
    ),
    releaseSounds: vi.fn((released) => {
      const n = released.filter((id) => voices.sounding.has(id)).length;
      released.forEach((id) => voices.sounding.delete(id));
      return n;
    }),
  };
  return voices;
}

/**
 * A controller over the fakes, playing OLD at `cycle`.
 * @param {object} [options]
 * @param {Object<string, object>} [options.programs]
 * @param {object} [options.settings]
 * @param {number} [options.cycle]
 * @param {number} [options.cps]
 * @param {boolean} [options.playing]
 * @param {object} [options.voices]
 * @returns {object}
 */
export function setupController({ programs = {}, settings = {}, cycle = 9.5, cps = 0.5, playing = true, voices } = {}) {
  const sch = createFakeScheduler({ cycle, cps, started: playing });
  const repl = createFakeRepl(sch, { A: { pattern: NEW }, ...programs });
  const ctx = new MockAudioContext();
  ctx.currentTime = 100;
  const destinationGain = ctx.createGain();
  const target = new EventTarget();
  const events = [];
  for (const name of ['waiting', 'start', 'end', 'error', 'manual']) {
    target.addEventListener(`track-transition-${name}`, (e) => events.push([name, e.detail]));
  }
  const fakeVoices = voices ?? createFakeVoices();
  const current = { type: 'crossfade', length: 2, snap: 0, tempo: 'jump', matchLoudness: false, ...settings };
  const controller = new TrackTransitionController({
    repl,
    audioContext: ctx,
    destinationGain,
    getSettings: () => current,
    eventTarget: target,
    voices: fakeVoices,
  });
  repl.editPattern = controller.editPattern;
  if (playing) {
    sch.pattern = OLD;
    repl.state.pattern = OLD;
  }
  return { sch, repl, ctx, destinationGain, controller, voices: fakeVoices, events };
}

/**
 * Advance fake time in 10 ms steps until the scheduler reaches `cycle`.
 * @param {object} sch
 * @param {number} cycle
 * @returns {Promise<void>}
 */
export async function untilCycle(sch, cycle) {
  for (let guard = 0; sch.now() < cycle && guard < 200000; guard++) {
    await vi.advanceTimersByTimeAsync(10);
  }
}

/**
 * The onset haps of `pat` in [from, to), by onset.
 * @param {object} pat
 * @param {number} from
 * @param {number} to
 * @returns {Array<object>}
 */
export const onsetHaps = (pat, from, to) =>
  pat
    .queryArc(from, to)
    .filter((h) => h.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
