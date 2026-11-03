const DEFAULT_SOUND = 'triangle'; // superdough's default for `s`

/**
 * Builds up the summary of a run, one event at a time.
 * @param {object} core the @strudel/core module
 * @returns {{add: function(*): void, sounds: function(): string[], noteRange: function(): (object|null)}} the collector
 */
export function createSummary({ noteToMidi, freqToMidi }) {
  const sounds = new Set();
  let low;
  let high;

  const addNote = (name, midi) => {
    if (!Number.isFinite(midi)) {
      return;
    }
    if (!low || midi < low.midi) {
      low = { name, midi };
    }
    if (!high || midi > high.midi) {
      high = { name, midi };
    }
  };

  return {
    add(value) {
      if (value === null || typeof value !== 'object') {
        return;
      }
      const sound = value.s ?? DEFAULT_SOUND;
      // the name superdough looks up
      sounds.add(value.bank && value.s ? `${value.bank}_${sound}` : String(sound));
      try {
        if (typeof value.note === 'string') {
          addNote(value.note, noteToMidi(value.note));
        } else if (typeof value.note === 'number') {
          addNote(String(value.note), value.note);
        } else if (typeof value.freq === 'number') {
          addNote(`${value.freq}Hz`, freqToMidi(value.freq));
        }
      } catch {
        // not a note the engine can read: the browser would log it and play nothing
      }
    },
    sounds: () => [...sounds].sort(),
    noteRange: () => (low ? { low: low.name, high: high.name, lowMidi: low.midi, highMidi: high.midi } : null),
  };
}
