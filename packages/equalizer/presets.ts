/**
 * Equalizer Presets
 *
 * Predefined equalizer configurations inspired by common audio profiles.
 * Each preset defines gain values for the 10 frequency bands; genre presets (spec 020) also set
 * the low cut, high cut and output level.
 * Bands: 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz
 *
 * Content was rephrased for compliance with licensing restrictions.
 * Source inspiration: [Spotify equalizer presets](https://higherhz.com/best-spotify-equalizer-settings/)
 */

/** `genre`: a sound designed for a music genre (bands, cuts and output level). `profile`: a listening profile (bands only). */
export type EqualizerPresetGroup = 'profile' | 'genre';

export interface EqualizerPreset {
  name: string;
  group: EqualizerPresetGroup;
  /** Gain (dB) of the 10 bands, 31 Hz … 16 kHz. */
  gains: number[];
  /** Low cut frequency (Hz, 20–1000), or null/absent for off. */
  lowCut?: number | null;
  /** High cut frequency (Hz, 1000–20000), or null/absent for off. */
  highCut?: number | null;
  /** Output level (dB, −24…+6); absent means 0 dB. */
  outputGain?: number;
}

export const EQUALIZER_PRESETS: Record<string, EqualizerPreset> = {
  flat: {
    name: 'Flat',
    group: 'profile',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  acoustic: {
    name: 'Acoustic',
    group: 'profile',
    gains: [4, 3, 2, 1, 1, 1, 2, 3, 4, 3],
  },
  bassBoost: {
    name: 'Bass Boost',
    group: 'profile',
    gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  },
  bassReducer: {
    name: 'Bass Reducer',
    group: 'profile',
    gains: [-6, -4, -2, 0, 1, 2, 2, 2, 2, 2],
  },
  classical: {
    name: 'Classical',
    group: 'profile',
    gains: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
  },
  dance: {
    name: 'Dance',
    group: 'profile',
    gains: [6, 4, 2, 0, 0, -1, 0, 2, 4, 5],
  },
  deep: {
    name: 'Deep',
    group: 'profile',
    gains: [6, 5, 3, 1, 0, 0, -1, -1, 2, 3],
  },
  electronic: {
    name: 'Electronic',
    group: 'profile',
    gains: [5, 4, 2, 0, -1, 0, 1, 2, 4, 5],
  },
  hipHop: {
    name: 'Hip-Hop',
    group: 'profile',
    gains: [7, 5, 2, 1, -1, -1, 0, 1, 2, 3],
  },
  jazz: {
    name: 'Jazz',
    group: 'profile',
    gains: [4, 3, 1, 2, -1, -1, 0, 1, 3, 4],
  },
  latin: {
    name: 'Latin',
    group: 'profile',
    gains: [3, 2, 0, 0, 0, 0, 1, 2, 3, 4],
  },
  loudness: {
    name: 'Loudness',
    group: 'profile',
    gains: [6, 4, 0, 0, -1, 0, 0, 2, 4, 6],
  },
  lounge: {
    name: 'Lounge',
    group: 'profile',
    gains: [3, 2, 0, 1, 2, 2, 1, 0, 1, 2],
  },
  piano: {
    name: 'Piano',
    group: 'profile',
    gains: [2, 1, 0, 2, 3, 2, 3, 4, 3, 2],
  },
  pop: {
    name: 'Pop',
    group: 'profile',
    gains: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1],
  },
  rnb: {
    name: 'R&B',
    group: 'profile',
    gains: [7, 6, 3, 1, -1, -1, 1, 2, 3, 5],
  },
  rock: {
    name: 'Rock',
    group: 'profile',
    gains: [5, 3, -2, -3, -1, 1, 3, 4, 5, 5],
  },
  smallSpeakers: {
    name: 'Small Speakers',
    group: 'profile',
    gains: [3, 2, 2, 1, 0, 0, 1, 2, 2, 1],
  },
  spokenWord: {
    name: 'Spoken Word',
    group: 'profile',
    gains: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1],
  },
  trebleBoost: {
    name: 'Treble Boost',
    group: 'profile',
    gains: [0, 0, 0, 0, 0, 0, 2, 4, 6, 8],
  },
  trebleReducer: {
    name: 'Treble Reducer',
    group: 'profile',
    gains: [0, 0, 0, 0, 0, 0, -2, -3, -4, -5],
  },
  vocal: {
    name: 'Vocal Boost',
    group: 'profile',
    gains: [-2, -2, -1, 1, 3, 4, 3, 1, -1, -2],
  },

  // Genre presets (spec 020). Each one's outputGain matches its pink-noise loudness to Flat
  // (pinkNoiseLoudnessDb, enforced within ±3 dB by test/presets.test.ts).
  brazilianFunk: {
    // Baile funk: tamborzão sub and kick, MC vocal presence, bright percussion.
    name: 'Brazilian Funk',
    group: 'genre',
    gains: [10, 9, 4, 0, -3, -1, 2, 4, 4, 3],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
  automotivo: {
    // Car-sound funk: huge distorted sub, scooped low mids, hard synth stabs on top.
    name: 'Automotivo',
    group: 'genre',
    gains: [18, 15, 3, -5, -6, -3, 2, 6, 7, 5],
    lowCut: 25,
    highCut: null,
    outputGain: -9,
  },
  montagem: {
    // Montagem: vocal chops over a heavy sub, scooped mids, sharp high leads.
    name: 'Montagem',
    group: 'genre',
    gains: [16, 14, 2, -5, -6, -2, 3, 6, 6, 4],
    lowCut: 28,
    highCut: null,
    outputGain: -7.5,
  },
  funkAgressivo: {
    // Aggressive funk: big low end with a forward, biting upper mid.
    name: 'Funk Agressivo',
    group: 'genre',
    gains: [12, 10, 3, -2, -2, 2, 5, 6, 4, 2],
    lowCut: null,
    highCut: null,
    outputGain: -6.5,
  },
  mandelao: {
    // Mandelão (São Paulo): raw, heavy bass and low mids, rolled-off top.
    name: 'Mandelão',
    group: 'genre',
    gains: [14, 12, 6, -2, -4, -2, 1, 3, 2, 0],
    lowCut: null,
    highCut: 15000,
    outputGain: -7.5,
  },
  phonk: {
    // Memphis phonk: big 808 sub, cowbell presence at 2–4 kHz, lo-fi high cut.
    name: 'Phonk',
    group: 'genre',
    gains: [12, 10, 3, -2, -3, 0, 4, 5, 1, -2],
    lowCut: null,
    highCut: 13000,
    outputGain: -6,
  },
  driftPhonk: {
    // Drift phonk: heavier, tighter sub and louder cowbells, still with the lo-fi edge.
    name: 'Drift Phonk',
    group: 'genre',
    gains: [16, 13, 4, -3, -4, 1, 6, 7, 2, -2],
    lowCut: 25,
    highCut: 14000,
    outputGain: -8,
  },
  electro: {
    // Electro: punchy 808 kick, snappy claps, bright synths.
    name: 'Electro',
    group: 'genre',
    gains: [6, 7, 3, -1, -2, 0, 2, 4, 5, 5],
    lowCut: null,
    highCut: null,
    outputGain: -4.5,
  },
  techno: {
    // Techno: kick punch at 60–125 Hz, darker mids, crisp hats; rumble removed.
    name: 'Techno',
    group: 'genre',
    gains: [5, 8, 6, 0, -3, -2, 0, 2, 4, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  drumAndBass: {
    // Drum & bass: clean sub with the rumble cut, scooped low mids, snare snap and air.
    name: 'Drum & Bass',
    group: 'genre',
    gains: [8, 6, 0, -3, -2, 1, 4, 5, 4, 4],
    lowCut: 30,
    highCut: null,
    outputGain: -3.5,
  },
  dubstep: {
    // Dubstep: massive sub, growling mid bass, cracking snare.
    name: 'Dubstep',
    group: 'genre',
    gains: [12, 10, 4, 0, 2, 3, 2, 3, 2, 1],
    lowCut: 25,
    highCut: null,
    outputGain: -6,
  },
  trap: {
    // Trap: long 808 subs, room for vocals, crisp hi-hat rolls.
    name: 'Trap',
    group: 'genre',
    gains: [12, 9, 2, -2, -3, 0, 2, 3, 5, 6],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
};
