/**
 * midiJog - a learned MIDI jog wheel drives the scratch platter (spec 019, tech §2.5).
 *
 * `@strudel/midi` (and the WebMidi bundle behind it) is imported lazily: only when Learn is
 * pressed or a stored mapping exists.
 *
 * @license AGPL-3.0-or-later
 */

import { SCRATCH_SECONDS_PER_TURN } from './ScratchDeck.mjs';

/** localStorage key of the learned mapping. */
export const MIDI_JOG_STORAGE_KEY = 'strudel:scratch:midi';
/** Seconds of audio one jog tick moves (≈ 128 ticks per platter turn). */
export const MIDI_JOG_SECONDS_PER_TICK = SCRATCH_SECONDS_PER_TURN / 128;
/** The jog lets go this long after its last message. */
export const MIDI_JOG_RELEASE_MS = 250;
/** Learn gives up after this long and keeps the previous mapping. */
export const MIDI_JOG_LEARN_TIMEOUT_MS = 10000;
/** Learn assigns a control once it sends this many messages … */
export const MIDI_JOG_LEARN_MESSAGES = 3;
/** … within this window. */
export const MIDI_JOG_LEARN_WINDOW_MS = 300;
/** Relative CC encodings: 1..63 = +, 65..127 = − (default), or 64 = zero. */
export const MIDI_JOG_ENCODINGS = Object.freeze(['twos-complement', 'binary-offset']);

/**
 * Decode one relative-CC value into signed jog ticks.
 * - `'twos-complement'` (default): 1..63 → +1..+63, 65..127 → −63..−1, 64 → −64, 0 → 0.
 * - `'binary-offset'`: value − 64 (64 = no movement).
 * Anything that is not an integer 0..127 decodes to 0.
 * @param {number} value - The CC data byte.
 * @param {'twos-complement'|'binary-offset'} [encoding='twos-complement']
 * @returns {number}
 */
export function decodeRelativeCC(value, encoding = 'twos-complement') {
  if (!Number.isInteger(value) || value < 0 || value > 127) return 0;
  if (encoding === 'binary-offset') return value - 64;
  return value < 64 ? value : value - 128;
}

/**
 * Guess the encoding from values seen while learning: a jog turned slowly sends values near 0
 * / 128 in two's complement and near 64 in binary offset.
 * @param {number[]} values
 * @returns {'twos-complement'|'binary-offset'}
 */
export function detectRelativeEncoding(values) {
  const valid = (values ?? []).filter((v) => Number.isInteger(v) && v >= 0 && v <= 127);
  if (!valid.length) return 'twos-complement';
  const nearMiddle = valid.filter((v) => Math.abs(v - 64) < 32).length;
  return nearMiddle * 2 > valid.length ? 'binary-offset' : 'twos-complement';
}

function isMapping(m) {
  return (
    m &&
    typeof m === 'object' &&
    typeof m.inputName === 'string' &&
    Number.isInteger(m.channel) &&
    m.channel >= 1 &&
    m.channel <= 16 &&
    Number.isInteger(m.controller) &&
    m.controller >= 0 &&
    m.controller <= 127 &&
    MIDI_JOG_ENCODINGS.includes(m.encoding)
  );
}

function readMapping(storage) {
  try {
    const raw = storage?.getItem(MIDI_JOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isMapping(parsed)
      ? {
          inputName: parsed.inputName,
          channel: parsed.channel,
          controller: parsed.controller,
          encoding: parsed.encoding,
        }
      : null;
  } catch {
    return null;
  }
}

function writeMapping(storage, mapping) {
  try {
    if (mapping) storage?.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(mapping));
    else storage?.removeItem(MIDI_JOG_STORAGE_KEY);
  } catch {
    /* storage full or blocked: the mapping lasts for this page only */
  }
}

/** Extract `{ channel, controller, value }` from a webmidi `midimessage` event, or null if not a CC. */
function parseControlChange(e) {
  const status = e?.message?.statusByte ?? e?.statusByte ?? e?.data?.[0];
  const bytes = e?.message?.dataBytes ?? e?.dataBytes ?? (e?.data ? [e.data[1], e.data[2]] : null);
  if (!Number.isInteger(status) || (status & 0xf0) !== 0xb0 || !bytes) return null;
  return { channel: (status & 0x0f) + 1, controller: bytes[0], value: bytes[1] };
}

/**
 * @typedef {object} MidiJogMapping
 * @property {string} inputName - MIDI input port name.
 * @property {number} channel - 1..16.
 * @property {number} controller - CC number 0..127.
 * @property {'twos-complement'|'binary-offset'} encoding
 */

/**
 * @typedef {object} MidiJog
 * @property {() => Promise<MidiJogMapping|null>} learn - Wait for a turned control; resolves the
 *   new mapping, or null on timeout (previous mapping kept) or when MIDI is unavailable.
 * @property {() => void} forget - Remove the mapping (and its stored copy).
 * @property {MidiJogMapping|null} mapping
 * @property {'off'|'ready'|'learning'|'unavailable'} state
 * @property {'unsupported'|'denied'|'failed'|undefined} reason - Why MIDI is unavailable (a code
 *   for the UI to translate); set only in state `'unavailable'`.
 * @property {string|undefined} detail - The underlying error message, for logs.
 * @property {(event: 'change', fn: (jog: MidiJog) => void) => () => void} on - Subscribe; returns unsubscribe.
 * @property {Promise<void>} ready - Settles once a stored mapping is listening (or failed).
 * @property {() => void} destroy - Stop listening.
 */

/**
 * Connect a learned MIDI jog wheel to a {@link ScratchController}. Any message from the mapped
 * control grabs the selected deck, moves it, and arms `autoRelease(250)`, all as source `'midi'`.
 * @param {import('./ScratchController.mjs').ScratchController} controller
 * @param {object} [options] - Injection points (tests).
 * @param {() => Promise<{enableWebMidi: Function, WebMidi: any}>} [options.loadMidi] - Defaults to `import('@strudel/midi')`.
 * @param {Storage} [options.storage] - Defaults to `localStorage`.
 * @param {() => number} [options.now] - Clock in ms for the Learn window; defaults to `performance.now`.
 * @returns {MidiJog}
 */
export function createMidiJog(controller, options = {}) {
  const loadMidi = options.loadMidi ?? (() => import('@strudel/midi'));
  const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const listeners = new Set();
  const bound = new Map(); // input → midimessage listener
  let WebMidi = null;
  let midiPromise = null;
  let learning = null; // { resolve, timer, seen: Map }
  let learnPromise = null;
  let destroyed = false;

  const jog = {
    mapping: readMapping(storage),
    state: 'off',
    reason: undefined,
    detail: undefined,
    ready: Promise.resolve(),
    learn,
    forget,
    on(event, fn) {
      if (event !== 'change' || typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy,
  };

  function emit() {
    for (const fn of [...listeners]) {
      try {
        fn(jog);
      } catch (err) {
        console.error('[midiJog] change listener failed:', err);
      }
    }
  }

  function setState(state, err) {
    jog.state = state;
    jog.reason = state === 'unavailable' ? midiErrorReason(err) : undefined;
    jog.detail = state === 'unavailable' ? String(err?.message ?? err ?? '') : undefined;
    emit();
  }

  function ensureMidi() {
    if (!midiPromise) {
      midiPromise = (async () => {
        if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
          throw new MidiUnsupportedError('This browser does not support Web MIDI.');
        }
        const midi = await loadMidi();
        await midi.enableWebMidi();
        WebMidi = midi.WebMidi;
        if (destroyed) return;
        bindInputs();
        WebMidi.addListener?.('connected', bindInputs);
      })().catch((err) => {
        midiPromise = null;
        throw err;
      });
    }
    return midiPromise;
  }

  function bindInputs() {
    if (!WebMidi || destroyed) return;
    for (const input of WebMidi.inputs ?? []) {
      if (bound.has(input)) continue;
      const fn = (e) => onMessage(input, e);
      input.addListener('midimessage', fn);
      bound.set(input, fn);
    }
  }

  function onMessage(input, e) {
    const cc = parseControlChange(e);
    if (!cc) return;
    if (learning) {
      learnMessage(input.name, cc);
      return;
    }
    const m = jog.mapping;
    if (!m || jog.state !== 'ready') return;
    if (input.name !== m.inputName || cc.channel !== m.channel || cc.controller !== m.controller) return;
    const ticks = decodeRelativeCC(cc.value, m.encoding);
    if (ticks === 0) return;
    // The jog holds the record as its own source: its idle release never drops a pointer or key hold.
    controller.grab('midi');
    controller.moveBy(ticks * MIDI_JOG_SECONDS_PER_TICK, 'midi');
    controller.autoRelease(MIDI_JOG_RELEASE_MS, 'midi');
  }

  function learnMessage(inputName, cc) {
    const key = `${inputName}\u0000${cc.channel}\u0000${cc.controller}`;
    const t = now();
    let entry = learning.seen.get(key);
    if (!entry) {
      entry = { times: [], values: [] };
      learning.seen.set(key, entry);
    }
    entry.times.push(t);
    entry.values.push(cc.value);
    while (entry.times.length && t - entry.times[0] > MIDI_JOG_LEARN_WINDOW_MS) {
      entry.times.shift();
    }
    if (entry.times.length >= MIDI_JOG_LEARN_MESSAGES) {
      finishLearn({
        inputName,
        channel: cc.channel,
        controller: cc.controller,
        encoding: detectRelativeEncoding(entry.values),
      });
    }
  }

  function finishLearn(mapping) {
    const pending = learning;
    learning = null;
    learnPromise = null;
    clearTimeout(pending.timer);
    if (mapping) {
      jog.mapping = mapping;
      writeMapping(storage, mapping);
    }
    setState(jog.mapping ? 'ready' : 'off');
    pending.resolve(mapping);
  }

  function learn() {
    if (destroyed) return Promise.resolve(null);
    if (learnPromise) return learnPromise;
    learnPromise = (async () => {
      try {
        await ensureMidi();
      } catch (err) {
        learnPromise = null;
        setState('unavailable', err);
        return null;
      }
      if (destroyed) {
        learnPromise = null;
        return null;
      }
      return new Promise((resolve) => {
        learning = {
          resolve,
          seen: new Map(),
          timer: setTimeout(() => finishLearn(null), MIDI_JOG_LEARN_TIMEOUT_MS),
        };
        setState('learning');
      });
    })();
    return learnPromise;
  }

  function forget() {
    if (learning) finishLearn(null);
    jog.mapping = null;
    writeMapping(storage, null);
    if (jog.state !== 'unavailable') setState('off');
  }

  function destroy() {
    if (destroyed) return;
    if (learning) finishLearn(null);
    destroyed = true;
    for (const [input, fn] of bound) {
      try {
        input.removeListener('midimessage', fn);
      } catch {
        /* port gone */
      }
    }
    bound.clear();
    WebMidi?.removeListener?.('connected', bindInputs);
    listeners.clear();
  }

  if (jog.mapping) {
    jog.ready = ensureMidi().then(
      () => {
        if (!destroyed && !learning) setState('ready');
      },
      (err) => {
        if (!destroyed) setState('unavailable', err);
      },
    );
  }

  return jog;
}

class MidiUnsupportedError extends Error {}

/** Map a MIDI start-up failure to a reason code the UI translates. */
function midiErrorReason(err) {
  if (err instanceof MidiUnsupportedError) return 'unsupported';
  const name = err?.name ?? '';
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'denied';
  return 'failed';
}
