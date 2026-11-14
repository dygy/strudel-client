/**
 * midiLearnShared - what the jog Learn (spec 019) and the feel knob Learn (spec 029) share, with
 * no dependency on either: the stored feel knobs (so the jog can refuse their controls) and the
 * one-Learn-at-a-time lock (so one CC is never learned twice).
 *
 * @license AGPL-3.0-or-later
 */

/** localStorage key of the learned feel knobs: `{ brake, spinUp }`, each a mapping or null. */
export const MIDI_FEEL_STORAGE_KEY = 'strudel-scratch-feel-midi';

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

/**
 * Whether two mappings name the same control (port, channel and CC number).
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export const sameMidiControl = (a, b) =>
  !!a && !!b && a.inputName === b.inputName && a.channel === b.channel && a.controller === b.controller;

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
