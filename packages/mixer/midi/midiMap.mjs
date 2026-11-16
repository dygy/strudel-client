/**
 * midiMap - bind any MIDI knob, fader or pad to an app target (spec 031 tech §2.3).
 *
 * The engine knows nothing about what a target does. The app registers targets as
 * `{ id, kind: 'continuous'|'button', read(): number, write(v01), press() }`:
 * - a **continuous** target takes an absolute CC (0..127 → 0..1 through `write`), with soft
 *   takeover: the control drives the target only once it reaches the target's current value
 *   (`read()`), so a fader sitting elsewhere never jumps the sound;
 * - a **button** target takes a note-on (velocity > 0) or a CC press (≥ 64 after < 64, or as the
 *   first message), once per press: a held button doesn't repeat.
 *
 * Bindings live in localStorage `strudel-midi-map` (`{ version: 1, bindings: { [targetId]: control } }`,
 * a control being `{ inputName, kind: 'cc'|'note', channel, number }`). A control is never bound
 * twice across the whole app: Learn refuses a control the jog, a feel knob or another target holds
 * (midiLearnShared's `midiControlHolder`), and only one Learn runs at a time (`claimMidiLearn`).
 *
 * `@strudel/midi` is imported lazily: only when Learn is pressed or stored bindings exist.
 *
 * @license AGPL-3.0-or-later
 */

import { createMidiInputs, midiErrorReason } from '../scratch/midiJog.mjs';
import {
  MIDI_MAP_STORAGE_KEY,
  MIDI_MAP_VERSION,
  claimMidiLearn,
  cleanMidiControl,
  midiControlHolder,
  parseMidiMap,
  sameMidiControl,
} from '../scratch/midiLearnShared.mjs';

export { MIDI_MAP_STORAGE_KEY, MIDI_MAP_VERSION, parseMidiMap };
/** Learn gives up after this long and keeps the previous binding. */
export const MIDI_MAP_LEARN_TIMEOUT_MS = 10000;
/** A continuous target is learned once one CC sends this many messages … */
export const MIDI_MAP_LEARN_MESSAGES = 3;
/** … within this window (the jog's rule, so a stray message doesn't bind). */
export const MIDI_MAP_LEARN_WINDOW_MS = 300;
/** Soft takeover: a control within this distance (of the 0..1 range) of the value picks it up. */
export const MIDI_MAP_PICKUP_TOLERANCE = 0.02;
/** The kinds of target. */
export const MIDI_MAP_TARGET_KINDS = Object.freeze(['continuous', 'button']);
/** The file name Export suggests. */
export const MIDI_MAP_EXPORT_FILENAME = 'strudel-midi-map.json';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * A CC value (0..127) as 0..1: 0 → 0, 127 → 1, linear. Out of range is clamped; junk gives 0.
 * @param {number} value
 * @returns {number}
 */
export function ccToUnit(value) {
  return Number.isFinite(value) ? clamp01(value / 127) : 0;
}

/**
 * One soft-takeover step (spec 031 §2.3). A control that has not picked up its target yet does so
 * when its value `v` comes within {@link MIDI_MAP_PICKUP_TOLERANCE} of the target's current value
 * `cur`, or crosses it: the sign of `v − cur` differs from that of the previous message's value
 * (`state.last`) against the same `cur`. Once picked, it stays picked.
 * @param {{picked: boolean, last: (number|null)}} state - Before this message.
 * @param {number} v - The control's value, 0..1.
 * @param {number} cur - The target's current value, 0..1.
 * @returns {{picked: boolean, last: number}} The state after it; `picked` means `v` drives the target.
 */
export function pickup(state, v, cur) {
  if (state?.picked || !Number.isFinite(cur)) return { picked: true, last: v };
  if (Math.abs(v - cur) <= MIDI_MAP_PICKUP_TOLERANCE + 1e-9) return { picked: true, last: v };
  const last = state?.last;
  if (Number.isFinite(last) && Math.sign(v - cur) !== Math.sign(last - cur)) return { picked: true, last: v };
  return { picked: false, last: v };
}

/**
 * One button step: does this message press the button? A note-on with velocity > 0, or a CC at
 * ≥ 64, presses it unless it is already held; a note-off (or note-on velocity 0) or a CC below 64
 * lets go. A CC never seen counts as let go, so the first ≥ 64 presses.
 * @param {{held: boolean}} state - Before this message.
 * @param {{kind: string, on: (boolean|undefined), velocity: (number|undefined), value: (number|undefined)}} msg -
 *   `{ kind: 'note', on, velocity }` or `{ kind: 'cc', value }`.
 * @returns {{press: boolean, state: {held: boolean}}}
 */
export function buttonEdge(state, msg) {
  const held = !!state?.held;
  const down = msg?.kind === 'note' ? !!msg.on && msg.velocity > 0 : msg?.kind === 'cc' && msg.value >= 64;
  return { press: down && !held, state: { held: down } };
}

/**
 * @typedef {object} MidiControl
 * @property {string} inputName - MIDI input port name.
 * @property {string} kind - `'cc'` or `'note'`.
 * @property {number} channel - 1..16.
 * @property {number} number - CC or note number, 0..127.
 */

/**
 * @typedef {object} MidiMapTarget
 * @property {string} id - Stable id (stored in the bindings).
 * @property {string} kind - `'continuous'` or `'button'`.
 * @property {function(): number} [read] - Continuous: the current value, 0..1 (soft takeover).
 * @property {function(number): void} [write] - Continuous: set the value, 0..1.
 * @property {function(): void} [press] - Button: act once.
 * @property {string} [label] - Shown when another Learn is refused because this target holds the control.
 */

/**
 * @typedef {object} MidiMapLearnResult
 * @property {boolean} ok
 * @property {MidiControl} [control] - When ok.
 * @property {string} [reason] - When not ok: `'timeout'`, `'cancelled'`, `'conflict'`, `'unsupported'`,
 *   `'denied'` or `'failed'` (MIDI could not start for another reason).
 * @property {{owner: string, label: string}} [holder] - With `'conflict'`: who holds the control
 *   (`owner` is `'jog'`, `'feel:brake'`, `'feel:spinUp'` or `'map:<targetId>'`).
 */

/**
 * @typedef {object} MidiMapState
 * @property {string} status - `'unsupported'` (no Web MIDI), `'idle'` (not asked yet), `'denied'`,
 *   `'failed'` or `'ready'`.
 * @property {Array<string>} inputs - Connected input names (while ready).
 * @property {string|null} learning - The target being learned.
 * @property {Object<string, MidiControl>} bindings - By target id (unknown ids included).
 * @property {Array<string>} awaitingPickup - Bound continuous targets whose control hasn't picked up
 *   ("Move to pick up").
 * @property {object|null} lastLearn - `{ targetId, ...MidiMapLearnResult }` of the last finished
 *   Learn, or null (cleared when a Learn starts).
 */

/**
 * @typedef {object} MidiMap
 * @property {function(string): Promise<MidiMapLearnResult>} learn - Arm a target: the next control
 *   moved is bound to it. Pressed again for the target being learned, it cancels.
 * @property {function(): void} cancelLearn - Stop a Learn (Esc); the previous binding stays.
 * @property {function(string): void} clear - Remove one binding.
 * @property {function(): void} clearAll - Remove every binding of the map (not the jog's or the feel knobs').
 * @property {function(): Object<string, MidiControl>} bindings - A copy, by target id.
 * @property {function(): string} exportJson - The bindings as `strudel-midi-map.json` content.
 * @property {function(string): {ok: boolean, error: (string|undefined)}} importJson - Replace the
 *   bindings with a file's; an invalid file changes nothing.
 * @property {function(): {status: string, inputs: Array<string>}} status
 * @property {function(): MidiMapState} getState
 * @property {function(Array<MidiMapTarget>): void} setTargets - Replace the registered targets
 *   (fresh closures); pickup state of kept ids is kept.
 * @property {function(string): void} notifyExternalChange - The target changed on screen: its
 *   control must pick it up again.
 * @property {function(string): boolean} isPickedUp
 * @property {function(function(MidiMapState): void): function(): void} subscribe - Called on every
 *   state change; returns the unsubscribe.
 * @property {Promise<void>} ready - Settles once stored bindings listen (or MIDI failed).
 * @property {function(): void} destroy
 */

/**
 * Create the MIDI map (spec 031). Stored bindings start listening at once (MIDI is requested
 * then); without any, MIDI is requested on the first Learn.
 * @param {object} [options] - Injection points (the app passes `targets`; tests the rest).
 * @param {Array<MidiMapTarget>} [options.targets]
 * @param {Storage|null} [options.storage] - Defaults to `localStorage`.
 * @param {function(): Promise<{enableWebMidi: Function, WebMidi: any}>} [options.loadMidi] - Defaults to `import('@strudel/midi')`.
 * @param {function(): number} [options.now] - Clock in ms for the Learn window.
 * @param {{subscribe: Function}} [options.hub] - A {@link createSharedMidiInputs} hub to listen through
 *   instead of an own set of input listeners.
 * @returns {MidiMap}
 */
export function createMidiMap(options = {}) {
  const loadMidi = options.loadMidi ?? (() => import('@strudel/midi'));
  const storage =
    options.storage !== undefined ? options.storage : typeof localStorage !== 'undefined' ? localStorage : null;
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const handlers = { onControlChange, onNote, onInputsChange };
  const inputs = options.hub ? options.hub.subscribe(handlers) : createMidiInputs({ loadMidi, ...handlers });
  const listeners = new Set();
  const targets = new Map();
  const pickState = new Map(); // targetId → { picked, last }
  const buttonState = new Map(); // targetId → { held }
  let bindings = readBindings();
  let status = midiSupported() ? 'idle' : 'unsupported';
  let detail;
  let inputNames = [];
  let pending = null; // { id, kind, resolve, release, timer, seen }
  let lastLearn = null;
  let destroyed = false;
  let starting = null;

  setTargets(options.targets ?? []);

  function midiSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  function readBindings() {
    try {
      return parseMidiMap(storage?.getItem(MIDI_MAP_STORAGE_KEY) ?? null).bindings;
    } catch {
      return {};
    }
  }

  function writeBindings() {
    try {
      if (Object.keys(bindings).length === 0) storage?.removeItem(MIDI_MAP_STORAGE_KEY);
      else storage?.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: MIDI_MAP_VERSION, bindings }));
    } catch {
      /* storage full or blocked: the bindings last for this page only */
    }
  }

  function getState() {
    const awaitingPickup = Object.keys(bindings).filter(
      (id) => targets.get(id)?.kind === 'continuous' && !pickState.get(id)?.picked,
    );
    return {
      status,
      inputs: status === 'ready' ? [...inputNames] : [],
      learning: pending?.id ?? null,
      bindings: copyBindings(),
      awaitingPickup,
      lastLearn,
      ...(detail ? { detail } : {}),
    };
  }

  function copyBindings() {
    const copy = {};
    for (const [id, control] of Object.entries(bindings)) copy[id] = { ...control };
    return copy;
  }

  function emit() {
    if (destroyed) return;
    const state = getState();
    for (const fn of [...listeners]) {
      try {
        fn(state);
      } catch (err) {
        console.error('[midiMap] listener failed:', err);
      }
    }
  }

  function start() {
    if (status === 'unsupported') return Promise.reject(Object.assign(new Error('No Web MIDI'), { unsupported: true }));
    if (!starting) {
      starting = inputs.ensure().then(
        () => {
          starting = null;
          if (destroyed) return;
          status = 'ready';
          detail = undefined;
          inputNames = inputs.inputNames();
          emit();
        },
        (err) => {
          starting = null;
          if (!destroyed) {
            status = midiErrorReason(err);
            detail = String(err?.message ?? err ?? '');
            emit();
          }
          throw err;
        },
      );
    }
    return starting;
  }

  function onInputsChange(names) {
    inputNames = [...names];
    if (status === 'ready') emit();
  }

  function onControlChange(inputName, cc) {
    if (destroyed || !Number.isInteger(cc?.value)) return;
    const control = { inputName, kind: 'cc', channel: cc.channel, number: cc.controller };
    const msg = { kind: 'cc', value: cc.value };
    if (pending) learnMessage(control, msg);
    else dispatch(control, msg);
  }

  function onNote(inputName, note) {
    if (destroyed || !note) return;
    const control = { inputName, kind: 'note', channel: note.channel, number: note.note };
    const msg = { kind: 'note', on: note.on, velocity: note.velocity };
    if (pending) learnMessage(control, msg);
    else dispatch(control, msg);
  }

  function dispatch(control, msg) {
    for (const [id, bound] of Object.entries(bindings)) {
      if (!sameMidiControl(control, bound)) continue;
      const target = targets.get(id);
      if (!target) continue; // a target this build doesn't know (kept for a newer one)
      if (target.kind === 'continuous') driveContinuous(id, target, msg);
      else if (target.kind === 'button') driveButton(id, target, msg);
    }
  }

  function driveContinuous(id, target, msg) {
    if (msg.kind !== 'cc') return;
    const v = ccToUnit(msg.value);
    let cur;
    try {
      cur = typeof target.read === 'function' ? Number(target.read()) : NaN;
    } catch (err) {
      console.warn('[midiMap] read failed:', err);
      return;
    }
    const before = pickState.get(id) ?? { picked: false, last: null };
    const after = pickup(before, v, cur);
    pickState.set(id, after);
    if (after.picked) {
      try {
        target.write?.(v);
      } catch (err) {
        console.warn('[midiMap] write failed:', err);
      }
    }
    if (after.picked !== before.picked) emit();
  }

  function driveButton(id, target, msg) {
    const { press, state } = buttonEdge(buttonState.get(id), msg);
    buttonState.set(id, state);
    if (!press) return;
    try {
      target.press?.();
    } catch (err) {
      console.warn('[midiMap] press failed:', err);
    }
  }

  function learnMessage(control, msg) {
    const p = pending;
    let candidate = null;
    if (p.kind === 'continuous') {
      if (msg.kind !== 'cc') return;
      const key = `${control.inputName}\u0000${control.channel}\u0000${control.number}`;
      const t = now();
      const times = p.seen.get(key) ?? [];
      times.push(t);
      while (times.length && t - times[0] > MIDI_MAP_LEARN_WINDOW_MS) times.shift();
      p.seen.set(key, times);
      if (times.length >= MIDI_MAP_LEARN_MESSAGES) candidate = control;
    } else {
      const key = `${control.kind}\u0000${control.inputName}\u0000${control.channel}\u0000${control.number}`;
      const { press, state } = buttonEdge(p.seen.get(key), msg);
      p.seen.set(key, state);
      if (press) candidate = control;
    }
    if (!candidate) return;
    const holder = holderOf(candidate, p.id);
    if (holder) {
      finishLearn({ ok: false, reason: 'conflict', holder });
      return;
    }
    const clean = cleanMidiControl(candidate);
    if (!clean) return;
    bindings = { ...bindings, [p.id]: clean };
    writeBindings();
    pickState.delete(p.id);
    // The press that bound a button is not a press of the target; its release is still to come.
    if (p.kind === 'button') buttonState.set(p.id, { held: true });
    else buttonState.delete(p.id);
    finishLearn({ ok: true, control: { ...clean } });
  }

  function labelOf(owner) {
    if (!owner.startsWith('map:')) return undefined;
    const target = targets.get(owner.slice(4));
    return typeof target?.label === 'string' ? target.label : undefined;
  }

  /** Who else holds `control`: another target of this map (in memory), or anyone in storage. */
  function holderOf(control, targetId) {
    for (const [id, bound] of Object.entries(bindings)) {
      if (id !== targetId && sameMidiControl(control, bound)) {
        const owner = `map:${id}`;
        return { owner, label: labelOf(owner) ?? id };
      }
    }
    return midiControlHolder(control, { storage, exclude: `map:${targetId}`, labelOf });
  }

  function finishLearn(result) {
    const p = pending;
    if (!p) return;
    pending = null;
    clearTimeout(p.timer);
    p.release();
    lastLearn = { targetId: p.id, ...result };
    emit();
    p.resolve(result);
  }

  async function learn(targetId) {
    const target = targets.get(targetId);
    if (destroyed || !target || !MIDI_MAP_TARGET_KINDS.includes(target.kind)) return { ok: false, reason: 'cancelled' };
    if (pending) {
      const same = pending.id === targetId;
      finishLearn({ ok: false, reason: 'cancelled' });
      if (same) return { ok: false, reason: 'cancelled' };
    }
    try {
      await start();
    } catch (err) {
      const reason = err?.unsupported ? 'unsupported' : midiErrorReason(err);
      lastLearn = { targetId, ok: false, reason };
      emit();
      return { ok: false, reason };
    }
    if (destroyed) return { ok: false, reason: 'cancelled' };
    // Another Learn started while MIDI was starting: it is replaced by this one.
    if (pending) finishLearn({ ok: false, reason: 'cancelled' });
    return new Promise((resolve) => {
      // One Learn at a time on the page, the jog's and the feel knobs' included.
      const release = claimMidiLearn(() => finishLearn({ ok: false, reason: 'cancelled' }), storage);
      lastLearn = null;
      pending = {
        id: targetId,
        kind: target.kind,
        resolve,
        release,
        seen: new Map(),
        timer: setTimeout(() => finishLearn({ ok: false, reason: 'timeout' }), MIDI_MAP_LEARN_TIMEOUT_MS),
      };
      emit();
    });
  }

  function cancelLearn() {
    finishLearn({ ok: false, reason: 'cancelled' });
  }

  function clear(targetId) {
    if (pending?.id === targetId) finishLearn({ ok: false, reason: 'cancelled' });
    if (!(targetId in bindings)) return;
    const next = { ...bindings };
    delete next[targetId];
    bindings = next;
    pickState.delete(targetId);
    buttonState.delete(targetId);
    writeBindings();
    emit();
  }

  function clearAll() {
    if (pending) finishLearn({ ok: false, reason: 'cancelled' });
    bindings = {};
    pickState.clear();
    buttonState.clear();
    writeBindings();
    emit();
  }

  function exportJson() {
    return JSON.stringify({ version: MIDI_MAP_VERSION, bindings: copyBindings() }, null, 2);
  }

  /**
   * Strict, unlike the stored copy: one damaged binding makes the whole file invalid, so nothing is
   * imported half. Error codes: `'not-json'`, `'not-a-map'`, `'unsupported-version'`,
   * `'invalid-binding'`, `'duplicate-control'`, `'conflict'` (a control the jog or a feel knob holds).
   */
  function importJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text));
    } catch {
      return { ok: false, error: 'not-json' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'not-a-map' };
    if (!parsed.bindings || typeof parsed.bindings !== 'object' || Array.isArray(parsed.bindings)) {
      return { ok: false, error: 'not-a-map' };
    }
    if (parsed.version !== MIDI_MAP_VERSION) return { ok: false, error: 'unsupported-version' };
    const next = {};
    for (const [id, control] of Object.entries(parsed.bindings)) {
      const clean = id ? cleanMidiControl(control) : null;
      if (!clean) return { ok: false, error: 'invalid-binding', detail: id };
      if (Object.values(next).some((other) => sameMidiControl(other, clean))) {
        return { ok: false, error: 'duplicate-control', detail: id };
      }
      // The jog and feel knobs keep their controls; the map's own old bindings are being replaced.
      const holder = midiControlHolder(clean, { storage, labelOf });
      if (holder && !holder.owner.startsWith('map:')) return { ok: false, error: 'conflict', detail: id, holder };
      next[id] = clean;
    }
    if (pending) finishLearn({ ok: false, reason: 'cancelled' });
    bindings = next;
    pickState.clear();
    buttonState.clear();
    writeBindings();
    emit();
    if (Object.keys(bindings).length && status === 'idle') listenForBindings();
    return { ok: true };
  }

  function setTargets(list) {
    targets.clear();
    for (const target of list ?? []) {
      if (target && typeof target.id === 'string' && target.id) targets.set(target.id, target);
    }
  }

  function notifyExternalChange(targetId) {
    const state = pickState.get(targetId);
    pickState.set(targetId, { picked: false, last: null });
    if (state?.picked && targetId in bindings) emit();
  }

  function isPickedUp(targetId) {
    return !!pickState.get(targetId)?.picked;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function destroy() {
    if (destroyed) return;
    if (pending) finishLearn({ ok: false, reason: 'cancelled' });
    destroyed = true;
    inputs.destroy();
    listeners.clear();
  }

  function listenForBindings() {
    return start().catch(() => {
      /* reported through status */
    });
  }

  const map = {
    learn,
    cancelLearn,
    clear,
    clearAll,
    bindings: copyBindings,
    exportJson,
    importJson,
    status: () => ({ status, inputs: status === 'ready' ? [...inputNames] : [] }),
    getState,
    setTargets,
    notifyExternalChange,
    isPickedUp,
    subscribe,
    ready: Promise.resolve(),
    destroy,
  };
  if (Object.keys(bindings).length && status !== 'unsupported') map.ready = listenForBindings();
  return map;
}
