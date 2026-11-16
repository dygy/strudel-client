/**
 * midiLearnShared - what the jog Learn (spec 019), the feel knob Learn (spec 029) and the MIDI map
 * (spec 031) share, with no dependency on any of them: the stored mappings of all three (so each
 * refuses a control another one holds), the control identity, and the one-Learn-at-a-time lock (so
 * one control is never learned twice).
 *
 * A control is `{ inputName, kind, channel, number }`: `kind` is `'cc'` or `'note'`, `number` the
 * CC or note number. The jog's and the feel knobs' stored mappings predate `kind` and name the CC
 * `controller`; they read as `kind: 'cc'`, `number = controller` (spec 031 tech §2.2).
 *
 * @license AGPL-3.0-or-later
 */

/** localStorage key of the learned feel knobs: `{ brake, spinUp }`, each a mapping or null. */
export const MIDI_FEEL_STORAGE_KEY = 'strudel-scratch-feel-midi';
/** localStorage key of the learned jog wheel (spec 019; re-exported by midiJog). */
export const MIDI_JOG_STORAGE_KEY = 'strudel:scratch:midi';
/** Relative CC encodings of the jog (spec 019; re-exported by midiJog). */
export const MIDI_JOG_ENCODINGS = Object.freeze(['twos-complement', 'binary-offset']);
/** localStorage key of the MIDI map (spec 031): `{ version: 1, bindings: { [targetId]: control } }`. */
export const MIDI_MAP_STORAGE_KEY = 'strudel-midi-map';
/** The MIDI map's stored and exported format version. */
export const MIDI_MAP_VERSION = 1;
/** The kinds of control a binding names. */
export const MIDI_CONTROL_KINDS = Object.freeze(['cc', 'note']);

function isFeelMapping(m) {
  return (
    !!m &&
    typeof m === 'object' &&
    typeof m.inputName === 'string' &&
    Number.isInteger(m.channel) &&
    m.channel >= 1 &&
    m.channel <= 16 &&
    Number.isInteger(m.controller) &&
    m.controller >= 0 &&
    m.controller <= 127
  );
}

/**
 * A valid feel knob mapping (a clean copy), or null.
 * @param {any} m
 * @returns {{inputName: string, channel: number, controller: number}|null}
 */
export const cleanFeelMapping = (m) =>
  isFeelMapping(m) ? { inputName: m.inputName, channel: m.channel, controller: m.controller } : null;

const kindOf = (m) => m.kind ?? 'cc';
const numberOf = (m) => m.number ?? m.controller;

/**
 * Whether two mappings name the same control (port, channel, kind and number). A mapping without
 * `kind` is a CC (the jog and feel knobs store `controller` for its number), so a stored 019/029
 * mapping and a map binding `{ kind: 'cc', number }` of the same CC are the same control; a note
 * and a CC with the same number are not.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export const sameMidiControl = (a, b) =>
  !!a &&
  !!b &&
  a.inputName === b.inputName &&
  a.channel === b.channel &&
  kindOf(a) === kindOf(b) &&
  numberOf(a) === numberOf(b);

/**
 * A valid control `{ inputName, kind, channel, number }` (a clean copy), or null. Accepts the old
 * CC form `{ inputName, channel, controller }` too (it reads as `kind: 'cc'`).
 * @param {any} m
 * @returns {{inputName: string, kind: string, channel: number, number: number}|null}
 */
export function cleanMidiControl(m) {
  if (!m || typeof m !== 'object' || typeof m.inputName !== 'string') return null;
  const kind = kindOf(m);
  const number = numberOf(m);
  if (!MIDI_CONTROL_KINDS.includes(kind)) return null;
  if (!Number.isInteger(m.channel) || m.channel < 1 || m.channel > 16) return null;
  if (!Number.isInteger(number) || number < 0 || number > 127) return null;
  return { inputName: m.inputName, kind, channel: m.channel, number };
}

/**
 * Parse the MIDI map's stored (or exported) form: a JSON string or an already parsed object. A
 * damaged binding is dropped and the others are kept; target ids this build doesn't know are kept
 * (a newer build may have them). Anything that is not a map gives no bindings.
 * @param {any} raw
 * @returns {{version: number, bindings: Object<string, {inputName: string, kind: string, channel: number, number: number}>}}
 */
export function parseMidiMap(raw) {
  const empty = { version: MIDI_MAP_VERSION, bindings: {} };
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return empty;
    }
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.bindings || typeof parsed.bindings !== 'object') {
    return empty;
  }
  if (Array.isArray(parsed.bindings)) return empty;
  const bindings = {};
  for (const [id, control] of Object.entries(parsed.bindings)) {
    const clean = id ? cleanMidiControl(control) : null;
    if (clean) bindings[id] = clean;
  }
  return { version: MIDI_MAP_VERSION, bindings };
}

/**
 * The MIDI map's stored bindings (spec 031), damaged entries dropped.
 * @param {Storage|null|undefined} storage
 * @returns {Object<string, {inputName: string, kind: string, channel: number, number: number}>}
 */
export function readMidiMapBindings(storage) {
  try {
    return parseMidiMap(storage?.getItem(MIDI_MAP_STORAGE_KEY) ?? null).bindings;
  } catch {
    return {};
  }
}

/** The stored jog control (the jog's own validation: an unknown encoding is no mapping), or null. */
function readJogControl(storage) {
  try {
    const raw = storage?.getItem(MIDI_JOG_STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return isFeelMapping(m) && MIDI_JOG_ENCODINGS.includes(m.encoding) ? cleanFeelMapping(m) : null;
  } catch {
    return null;
  }
}

/** English default labels of the scratch holders; the UI translates by `owner`. */
const HOLDER_LABELS = Object.freeze({ jog: 'Jog', 'feel:brake': 'Brake', 'feel:spinUp': 'Spin-up' });

/**
 * Who holds a control across the whole app (spec 031 tech §2.2): the jog wheel, a feel knob, or a
 * MIDI map target. All three are read from `storage` (the page's localStorage). `owner` is
 * `'jog'`, `'feel:brake'`, `'feel:spinUp'` or `'map:<targetId>'`; `label` is an English default
 * (the target id for a map target unless `labelOf` names it). `exclude` skips one owner: the one
 * being learned, whose own control is not a conflict.
 * @param {any} control - The control just moved.
 * @param {object} [options]
 * @param {Storage|null} [options.storage]
 * @param {string} [options.exclude] - An owner that doesn't count.
 * @param {function(string): (string|undefined)} [options.labelOf] - A label for an owner.
 * @returns {{owner: string, label: string}|null}
 */
export function midiControlHolder(control, { storage, exclude, labelOf } = {}) {
  if (!cleanMidiControl(control)) return null;
  const label = (owner, fallback) => {
    let named;
    try {
      named = labelOf?.(owner);
    } catch {
      named = undefined;
    }
    return typeof named === 'string' && named ? named : fallback;
  };
  const held = (owner, fallback) => ({ owner, label: label(owner, fallback) });
  if (exclude !== 'jog' && sameMidiControl(control, readJogControl(storage))) return held('jog', HOLDER_LABELS.jog);
  const feel = readMidiFeelMappings(storage);
  for (const name of ['brake', 'spinUp']) {
    const owner = `feel:${name}`;
    if (exclude !== owner && sameMidiControl(control, feel[name])) return held(owner, HOLDER_LABELS[owner]);
  }
  for (const [id, bound] of Object.entries(readMidiMapBindings(storage))) {
    const owner = `map:${id}`;
    if (exclude !== owner && sameMidiControl(control, bound)) return held(owner, id);
  }
  return null;
}

/**
 * Read the learned feel knobs. A damaged entry is dropped; the other one is kept.
 * @param {Storage|null|undefined} storage
 * @returns {{brake: {inputName: string, channel: number, controller: number}|null, spinUp: {inputName: string, channel: number, controller: number}|null}}
 */
export function readMidiFeelMappings(storage) {
  const empty = { brake: null, spinUp: null };
  try {
    const raw = storage?.getItem(MIDI_FEEL_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    return { brake: cleanFeelMapping(parsed.brake), spinUp: cleanFeelMapping(parsed.spinUp) };
  } catch {
    return empty;
  }
}

const NO_STORAGE = {};
const holders = new WeakMap(); // scope (the storage the mappings live in) → { cancel }

/**
 * Take the one MIDI Learn of a device: a Learn already running (the jog's or a feel knob's) on the
 * same storage is cancelled first. Scoped by the storage both read their mappings from (the page's
 * localStorage), so independent set-ups (tests) never cancel each other. Returns a release
 * function; releasing after another Learn took over does nothing.
 * @param {() => void} cancel - Stops this Learn when another one starts.
 * @param {object|null} [scope] - The storage the mappings live in.
 * @returns {() => void}
 */
export function claimMidiLearn(cancel, scope) {
  const key = scope && typeof scope === 'object' ? scope : NO_STORAGE;
  const previous = holders.get(key);
  const mine = { cancel };
  holders.set(key, mine);
  if (previous) {
    try {
      previous.cancel();
    } catch (err) {
      console.warn('[midi] cancelling the other Learn failed:', err);
    }
  }
  return () => {
    if (holders.get(key) === mine) holders.delete(key);
  };
}
