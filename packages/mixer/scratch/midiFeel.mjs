/**
 * midiFeel - MIDI Learn for the Brake and Spin-up sliders (spec 029, after spec 025).
 *
 * A learned knob (an absolute control change) moves its slider across the whole range on a
 * logarithmic curve: CC value 0 is the minimum, 127 the maximum, and the short times get more of
 * the knob. The value goes through the runtime's `setFeel`, like a slider move, so it is stored and
 * applies from the next grab or release (spec 025).
 *
 * The Web MIDI set-up is shared with the jog (midiJog's `createMidiInputs`), and `@strudel/midi` is
 * imported lazily: only when Learn is pressed or a stored mapping exists.
 *
 * @license AGPL-3.0-or-later
 */

import { createMidiInputs, midiErrorReason, readMidiJogMapping } from './midiJog.mjs';
import { SCRATCH_FEEL_RANGES } from './scratchPhysics.mjs';
import {
  MIDI_FEEL_STORAGE_KEY,
  claimMidiLearn,
  readMidiFeelMappings,
  sameMidiControl as sameControl,
} from './midiLearnShared.mjs';

export { MIDI_FEEL_STORAGE_KEY, readMidiFeelMappings };
/** Learn gives up after this long and keeps the previous mapping. */
export const MIDI_FEEL_LEARN_TIMEOUT_MS = 10000;
/** The sliders a knob can be learned for. */
export const MIDI_FEEL_TARGETS = Object.freeze(['brake', 'spinUp']);
/** Each slider's feel field (spec 025). */
export const MIDI_FEEL_KEYS = Object.freeze({ brake: 'brakeSeconds', spinUp: 'spinUpSeconds' });

/**
 * Map a CC value (0..127) onto `[min, max]` logarithmically: 0 → min, 127 → max, and in between
 * min · (max / min)^(value / 127), rounded to the millisecond and kept inside the range. A value
 * outside 0..127 is clamped; one that is not a number gives min.
 * @param {number} value - The CC data byte.
 * @param {readonly [number, number]} range - `[min, max]`, both > 0.
 * @returns {number}
 * @example ccToFeel(0, [0.02, 1]) // 0.02
 * @example ccToFeel(127, [0.02, 1]) // 1
 */
export function ccToFeel(value, range) {
  const [min, max] = range;
  const v = Number.isFinite(value) ? Math.min(127, Math.max(0, value)) : 0;
  const seconds = min * Math.pow(max / min, v / 127);
  return Math.min(max, Math.max(min, Math.round(seconds * 1000) / 1000));
}

function writeMappings(storage, mappings) {
  try {
    if (!mappings.brake && !mappings.spinUp) storage?.removeItem(MIDI_FEEL_STORAGE_KEY);
    else storage?.setItem(MIDI_FEEL_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    /* storage full or blocked: the mapping lasts for this page only */
  }
}

/**
 * Who already uses a control: the jog wheel, or the other slider. Learning the same slider's own
 * control again is not a conflict.
 * @param {MidiFeelMapping} mapping - The control just turned.
 * @param {object} used
 * @param {'brake'|'spinUp'} used.target - The slider being learned.
 * @param {{brake: MidiFeelMapping|null, spinUp: MidiFeelMapping|null}} used.mappings
 * @param {{inputName: string, channel: number, controller: number}|null} [used.jog]
 * @returns {'jog'|'brake'|'spinUp'|null}
 */
export function midiFeelConflict(mapping, { target, mappings, jog }) {
  if (sameControl(mapping, jog)) return 'jog';
  const other = target === 'brake' ? 'spinUp' : 'brake';
  if (sameControl(mapping, mappings?.[other])) return other;
  return null;
}

/**
 * @typedef {object} MidiFeelMapping
 * @property {string} inputName - MIDI input port name.
 * @property {number} channel - 1..16.
 * @property {number} controller - CC number 0..127.
 */

/**
 * @typedef {{status: 'learned', mapping: MidiFeelMapping}
 *   | {status: 'timeout'} | {status: 'cancelled'} | {status: 'unavailable'}
 *   | {status: 'conflict', controller: number, with: 'jog'|'brake'|'spinUp'}} MidiFeelLearnResult
 */

/**
 * @typedef {object} MidiFeel
 * @property {(target: 'brake'|'spinUp') => Promise<MidiFeelLearnResult>} learn - Wait up to 10 s for
 *   a control change and make it the slider's knob. Pressed again for the slider being learned, it
 *   cancels; for the other slider, it cancels that Learn and starts this one. A timeout, a cancel or
 *   a conflict keeps the previous mapping.
 * @property {() => void} cancel - Stop a Learn (Esc); the previous mapping is kept.
 * @property {(target: 'brake'|'spinUp') => void} forget - Remove a slider's knob (and its stored copy).
 * @property {{brake: MidiFeelMapping|null, spinUp: MidiFeelMapping|null}} mappings
 * @property {'off'|'ready'|'learning'|'unavailable'} state
 * @property {'brake'|'spinUp'|null} learning - The slider being learned.
 * @property {'unsupported'|'denied'|'failed'|undefined} reason - Set only in state 'unavailable'.
 * @property {string|undefined} detail
 * @property {(event: 'change', fn: (feel: MidiFeel) => void) => () => void} on
 * @property {Promise<void>} ready - Settles once stored mappings are listening (or failed).
 * @property {() => void} destroy
 */

/**
 * Connect learned knobs to the Brake and Spin-up sliders. A message from a learned control calls
 * `target.setFeel({ brakeSeconds })` or `({ spinUpSeconds })` with {@link ccToFeel}.
 * @param {{setFeel: (feel: object) => void}} target - The scratch runtime.
 * @param {object} [options] - Injection points (tests).
 * @param {() => Promise<{enableWebMidi: Function, WebMidi: any}>} [options.loadMidi] - Defaults to `import('@strudel/midi')`.
 * @param {Storage} [options.storage] - Defaults to `localStorage`.
 * @param {() => object|null} [options.getJogMapping] - The jog's mapping; defaults to the stored one.
 * @returns {MidiFeel}
 */
export function createMidiFeel(target, options = {}) {
  const loadMidi = options.loadMidi ?? (() => import('@strudel/midi'));
  const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const getJogMapping = options.getJogMapping ?? (() => readMidiJogMapping(storage));
  const listeners = new Set();
  const inputs = createMidiInputs({ loadMidi, onControlChange: onMessage });
  let pending = null; // { target, resolve, timer, release }
  let destroyed = false;

  const feel = {
    mappings: readMidiFeelMappings(storage),
    state: 'off',
    learning: null,
    reason: undefined,
    detail: undefined,
    ready: Promise.resolve(),
    learn,
    cancel,
    forget,
    on(event, fn) {
      if (event !== 'change' || typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy,
  };

  const hasMapping = () => !!(feel.mappings.brake || feel.mappings.spinUp);

  function emit() {
    for (const fn of [...listeners]) {
      try {
        fn(feel);
      } catch (err) {
        console.error('[midiFeel] change listener failed:', err);
      }
    }
  }

  function setState(state, err) {
    feel.state = state;
    feel.learning = state === 'learning' && pending ? pending.target : null;
    feel.reason = state === 'unavailable' ? midiErrorReason(err) : undefined;
    feel.detail = state === 'unavailable' ? String(err?.message ?? err ?? '') : undefined;
    emit();
  }

  function onMessage(inputName, cc) {
    if (!Number.isInteger(cc.value) || cc.value < 0 || cc.value > 127) return;
    const control = { inputName, channel: cc.channel, controller: cc.controller };
    if (pending) {
      learnMessage(control, cc.value);
      return;
    }
    if (feel.state !== 'ready') return;
    for (const name of MIDI_FEEL_TARGETS) {
      if (sameControl(control, feel.mappings[name])) apply(name, cc.value);
    }
  }

  function apply(name, value) {
    const key = MIDI_FEEL_KEYS[name];
    try {
      target.setFeel({ [key]: ccToFeel(value, SCRATCH_FEEL_RANGES[key]) });
    } catch (err) {
      console.warn('[midiFeel] could not set the feel:', err);
    }
  }

  function learnMessage(control, value) {
    const name = pending.target;
    const conflict = midiFeelConflict(control, { target: name, mappings: feel.mappings, jog: getJogMapping() });
    if (conflict) {
      finish({ status: 'conflict', controller: control.controller, with: conflict });
      return;
    }
    feel.mappings = { ...feel.mappings, [name]: control };
    writeMappings(storage, feel.mappings);
    finish({ status: 'learned', mapping: control });
    // The first move is a real move: the slider follows the knob at once.
    apply(name, value);
  }

  function finish(result) {
    const done = pending;
    if (!done) return;
    pending = null;
    clearTimeout(done.timer);
    done.release();
    setState(hasMapping() ? 'ready' : 'off');
    done.resolve(result);
  }

  async function learn(name) {
    if (destroyed || !MIDI_FEEL_TARGETS.includes(name)) return { status: 'cancelled' };
    if (pending) {
      const same = pending.target === name;
      finish({ status: 'cancelled' });
      if (same) return { status: 'cancelled' };
    }
    try {
      await inputs.ensure();
    } catch (err) {
      setState('unavailable', err);
      return { status: 'unavailable' };
    }
    if (destroyed) return { status: 'cancelled' };
    // Another Learn started while MIDI was starting: it replaces this one.
    if (pending) finish({ status: 'cancelled' });
    return new Promise((resolve) => {
      // One Learn at a time on the page: a jog Learn in progress is cancelled (spec 029 review).
      const release = claimMidiLearn(() => finish({ status: 'cancelled' }), storage);
      pending = {
        target: name,
        resolve,
        release,
        timer: setTimeout(() => finish({ status: 'timeout' }), MIDI_FEEL_LEARN_TIMEOUT_MS),
      };
      setState('learning');
    });
  }

  function cancel() {
    finish({ status: 'cancelled' });
  }

  function forget(name) {
    if (!MIDI_FEEL_TARGETS.includes(name)) return;
    if (pending?.target === name) finish({ status: 'cancelled' });
    feel.mappings = { ...feel.mappings, [name]: null };
    writeMappings(storage, feel.mappings);
    if (feel.state !== 'unavailable' && feel.state !== 'learning') setState(hasMapping() ? feel.state : 'off');
    else emit();
  }

  function destroy() {
    if (destroyed) return;
    finish({ status: 'cancelled' });
    destroyed = true;
    inputs.destroy();
    listeners.clear();
  }

  if (hasMapping()) {
    feel.ready = inputs.ensure().then(
      () => {
        if (!destroyed && !pending) setState('ready');
      },
      (err) => {
        if (!destroyed) setState('unavailable', err);
      },
    );
  }

  return feel;
}
