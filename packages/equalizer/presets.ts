/**
 * Equalizer Presets
 * 
 * Predefined equalizer configurations inspired by common audio profiles.
 * Each preset defines gain values for the 10 frequency bands.
 * Bands: 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz
 * 
 * Content was rephrased for compliance with licensing restrictions.
 * Source inspiration: [Spotify equalizer presets](https://higherhz.com/best-spotify-equalizer-settings/)
 */

export interface EqualizerPreset {
  name: string;
  gains: number[];
}

export const EQUALIZER_PRESETS: Record<string, EqualizerPreset> = {
  flat: {
    name: 'Flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  acoustic: {
    name: 'Acoustic',
    gains: [4, 3, 2, 1, 1, 1, 2, 3, 4, 3]
  },
  bassBoost: {
    name: 'Bass Boost',
    gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0]
  },
  bassReducer: {
    name: 'Bass Reducer',
    gains: [-6, -4, -2, 0, 1, 2, 2, 2, 2, 2]
  },
  classical: {
    name: 'Classical',
    gains: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4]
  },
  dance: {
    name: 'Dance',
    gains: [6, 4, 2, 0, 0, -1, 0, 2, 4, 5]
  },
  deep: {
    name: 'Deep',
    gains: [6, 5, 3, 1, 0, 0, -1, -1, 2, 3]
  },
  electronic: {
    name: 'Electronic',
    gains: [5, 4, 2, 0, -1, 0, 1, 2, 4, 5]
  },
  hipHop: {
    name: 'Hip-Hop',
    gains: [7, 5, 2, 1, -1, -1, 0, 1, 2, 3]
  },
  jazz: {
    name: 'Jazz',
    gains: [4, 3, 1, 2, -1, -1, 0, 1, 3, 4]
  },
  latin: {
    name: 'Latin',
    gains: [3, 2, 0, 0, 0, 0, 1, 2, 3, 4]
  },
  loudness: {
    name: 'Loudness',
    gains: [6, 4, 0, 0, -1, 0, 0, 2, 4, 6]
  },
  lounge: {
    name: 'Lounge',
    gains: [3, 2, 0, 1, 2, 2, 1, 0, 1, 2]
  },
  piano: {
    name: 'Piano',
    gains: [2, 1, 0, 2, 3, 2, 3, 4, 3, 2]
  },
  pop: {
    name: 'Pop',
    gains: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1]
  },
  rnb: {
    name: 'R&B',
    gains: [7, 6, 3, 1, -1, -1, 1, 2, 3, 5]
  },
  rock: {
    name: 'Rock',
    gains: [5, 3, -2, -3, -1, 1, 3, 4, 5, 5]
  },
  smallSpeakers: {
    name: 'Small Speakers',
    gains: [3, 2, 2, 1, 0, 0, 1, 2, 2, 1]
  },
  spokenWord: {
    name: 'Spoken Word',
    gains: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1]
  },
  trebleBoost: {
    name: 'Treble Boost',
    gains: [0, 0, 0, 0, 0, 0, 2, 4, 6, 8]
  },
  trebleReducer: {
    name: 'Treble Reducer',
    gains: [0, 0, 0, 0, 0, 0, -2, -3, -4, -5]
  },
  vocal: {
    name: 'Vocal Boost',
    gains: [-2, -2, -1, 1, 3, 4, 3, 1, -1, -2]
  }
};
