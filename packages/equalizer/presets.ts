/**
 * Equalizer Presets
 *
 * Predefined equalizer configurations inspired by common audio profiles.
 * Each preset defines gain values for the 10 frequency bands; genre presets (specs 020 and 021) also
 * set the low cut, high cut and output level, and belong to one of four picker families.
 * Bands: 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz
 *
 * Content was rephrased for compliance with licensing restrictions.
 * Source inspiration: [Spotify equalizer presets](https://higherhz.com/best-spotify-equalizer-settings/)
 */

/**
 * `genre`: a sound designed for a music genre (bands, cuts and output level). `profile`: a listening
 * profile (bands, no cuts; the four that were more than 3 dB louder than Flat carry an output level, spec 026).
 */
export type EqualizerPresetGroup = 'profile' | 'genre';

/** The family a genre preset is listed under in the picker (spec 021). */
export type EqualizerPresetFamily = 'brazilianLatin' | 'phonkHipHop' | 'electronic' | 'liveOther';

/** The genre families in picker order: Brazilian & Latin; Phonk, Hip-Hop & Trap; Electronic & Club; Live & Other. */
export const EQUALIZER_PRESET_FAMILIES: readonly EqualizerPresetFamily[] = [
  'brazilianLatin',
  'phonkHipHop',
  'electronic',
  'liveOther',
];

export interface EqualizerPreset {
  name: string;
  group: EqualizerPresetGroup;
  /** The picker family; set on every genre preset, absent on profiles. */
  family?: EqualizerPresetFamily;
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
    // Spec 026: loudness-matched to Flat (pink noise, within ±3 dB); the bands are unchanged.
    outputGain: -0.5,
  },
  bassBoost: {
    name: 'Bass Boost',
    group: 'profile',
    gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
    // Spec 026: loudness-matched to Flat (pink noise, within ±3 dB); the bands are unchanged.
    outputGain: -1,
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
    // Spec 026: loudness-matched to Flat (pink noise, within ±3 dB); the bands are unchanged.
    outputGain: -0.5,
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
    // Spec 026: loudness-matched to Flat (pink noise, within ±3 dB); the bands are unchanged.
    outputGain: -1,
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

  // Genre presets, in four families (spec 020: 12; spec 021: 47 more). Each one's outputGain matches
  // its pink-noise loudness to Flat (pinkNoiseLoudnessDb, enforced within ±3 dB by
  // test/presets.test.ts). Within a family, the picker lists them in this order.

  // Brazilian & Latin
  brazilianFunk: {
    // Baile funk: tamborzão sub and kick, MC vocal presence, bright percussion.
    name: 'Brazilian Funk',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [10, 9, 4, 0, -3, -1, 2, 4, 4, 3],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
  automotivo: {
    // Car-sound funk: huge distorted sub, scooped low mids, hard synth stabs on top.
    name: 'Automotivo',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [18, 15, 3, -5, -6, -3, 2, 6, 7, 5],
    lowCut: 25,
    highCut: null,
    outputGain: -9,
  },
  montagem: {
    // Montagem: vocal chops over a heavy sub, scooped mids, sharp high leads.
    name: 'Montagem',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [16, 14, 2, -5, -6, -2, 3, 6, 6, 4],
    lowCut: 28,
    highCut: null,
    outputGain: -7.5,
  },
  funkAgressivo: {
    // Aggressive funk: big low end with a forward, biting upper mid.
    name: 'Funk Agressivo',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [12, 10, 3, -2, -2, 2, 5, 6, 4, 2],
    lowCut: null,
    highCut: null,
    outputGain: -6.5,
  },
  mandelao: {
    // Mandelão (São Paulo): raw, heavy bass and low mids, rolled-off top.
    name: 'Mandelão',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [14, 12, 6, -2, -4, -2, 1, 3, 2, 0],
    lowCut: null,
    highCut: 15000,
    outputGain: -7.5,
  },
  bruxaria: {
    // Distorted sub, dark eerie chants, screams that need bite; the top is darkened.
    name: 'Bruxaria',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [15, 13, 4, -3, -4, 0, 3, 5, 2, -1],
    lowCut: 28,
    highCut: 15000,
    outputGain: -7,
  },
  mandelaoSlowed: {
    // A sub that drags, low mids kept, a muffled top for the dragged-down feel.
    name: 'Mandelão Slowed',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [16, 14, 7, -1, -3, -3, -1, 1, -1, -3],
    lowCut: 25,
    highCut: 11000,
    outputGain: -9,
  },
  funkCariocaOldSchool: {
    // Miami-bass 808 and volt-mix drums, MC vocals forward, a soft vinyl top.
    name: 'Funk Carioca (old school)',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [8, 8, 5, 1, -1, 1, 3, 3, 1, -1],
    lowCut: null,
    highCut: 15000,
    outputGain: -5,
  },
  baileFunk: {
    // Tamborzão percussion and atabaque snap, kick and sub up front.
    name: 'Baile Funk',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [9, 8, 3, -1, -2, 1, 4, 5, 4, 2],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
  reggaeton: {
    // The dembow kick and snare drive it; clean sub, vocals in front, crisp hats.
    name: 'Reggaeton',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [8, 7, 3, -1, -2, 1, 3, 3, 3, 2],
    lowCut: 30,
    highCut: null,
    outputGain: -3.5,
  },
  dembow: {
    // Fast kick, cracking snare, hard synth stabs, bright and aggressive.
    name: 'Dembow',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [7, 8, 4, -2, -3, 1, 4, 5, 4, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -4.5,
  },
  cumbia: {
    // Güira scrape, accordion and bass lines in the mids; no sub needed.
    name: 'Cumbia',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [0, 2, 3, 1, 0, 2, 3, 3, 3, 2],
    lowCut: 35,
    highCut: null,
    outputGain: -3,
  },
  afroHouse: {
    // Deep kick, tribal congas and shakers, warm bass with air on the percussion.
    name: 'Afro House',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [6, 6, 3, 1, -1, 0, 2, 3, 3, 2],
    lowCut: 30,
    highCut: null,
    outputGain: -3.5,
  },
  amapiano: {
    // The log drum lives in the sub and bass; airy shakers and pads on top.
    name: 'Amapiano',
    group: 'genre',
    family: 'brazilianLatin',
    gains: [10, 12, 6, -2, -3, -1, 1, 3, 5, 6],
    lowCut: 25,
    highCut: null,
    outputGain: -7,
  },

  // Phonk, Hip-Hop & Trap
  phonk: {
    // Memphis phonk: big 808 sub, cowbell presence at 2–4 kHz, lo-fi high cut.
    name: 'Phonk',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [12, 10, 3, -2, -3, 0, 4, 5, 1, -2],
    lowCut: null,
    highCut: 13000,
    outputGain: -6,
  },
  driftPhonk: {
    // Drift phonk: heavier, tighter sub and louder cowbells, still with the lo-fi edge.
    name: 'Drift Phonk',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [16, 13, 4, -3, -4, 1, 6, 7, 2, -2],
    lowCut: 25,
    highCut: 14000,
    outputGain: -8,
  },
  trap: {
    // Trap: long 808 subs, room for vocals, crisp hi-hat rolls.
    name: 'Trap',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [12, 9, 2, -2, -3, 0, 2, 3, 5, 6],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
  brazilianPhonk: {
    // Distorted funk sub and cowbell melodies, a hard presence lift.
    name: 'Brazilian Phonk',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [16, 14, 4, -3, -4, 1, 5, 7, 3, 0],
    lowCut: 25,
    highCut: 16000,
    outputGain: -8.5,
  },
  housePhonk: {
    // Four-on-the-floor kick and bass, cowbells cutting through the mix.
    name: 'House Phonk',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [10, 12, 6, -2, -3, 0, 4, 5, 3, 1],
    lowCut: 30,
    highCut: null,
    outputGain: -7,
  },
  memphis: {
    // Tape-dubbed 808s and dark samples; the high cut gives the cassette feel.
    name: 'Memphis',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [9, 8, 4, 1, -1, 0, 2, 2, -2, -6],
    lowCut: null,
    highCut: 9000,
    outputGain: -4.5,
  },
  boomBap: {
    // Kick and snare punch over warm samples, a little vinyl dullness on top.
    name: 'Boom Bap',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [4, 5, 5, 2, 0, 1, 3, 3, 1, -1],
    lowCut: null,
    highCut: 15000,
    outputGain: -4,
  },
  lofiHipHop: {
    // Soft, warm and dusty; highs rolled off for a relaxed, worn-tape sound.
    name: 'Lo-fi Hip-Hop',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [3, 3, 3, 2, 0, -1, -1, -1, -3, -5],
    lowCut: 30,
    highCut: 10000,
    outputGain: -0.5,
  },
  ukDrill: {
    // Sliding 808 sub, dark scooped mids, sharp hi-hat patterns on top.
    name: 'UK Drill',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [12, 10, 2, -3, -3, -1, 1, 3, 5, 4],
    lowCut: 25,
    highCut: null,
    outputGain: -5,
  },
  nyDrill: {
    // Harder, distorted 808 slides and punchier drums than UK drill.
    name: 'NY Drill',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [13, 12, 4, -3, -3, 0, 3, 4, 4, 3],
    lowCut: 28,
    highCut: null,
    outputGain: -6.5,
  },
  rage: {
    // Blown-out 808s and distorted synth leads, loud and bright.
    name: 'Rage',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [14, 12, 3, -3, -2, 2, 4, 5, 6, 5],
    lowCut: 25,
    highCut: null,
    outputGain: -7.5,
  },
  plugg: {
    // Soft, round 808s and sparkly bell melodies; the mids stay out of the way.
    name: 'Plugg',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [9, 8, 2, -1, -1, 0, 1, 2, 4, 4],
    lowCut: null,
    highCut: null,
    outputGain: -4.5,
  },
  cloudRap: {
    // Hazy reverb-washed pads over a deep sub; the air band carries the dreaminess.
    name: 'Cloud Rap',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [8, 6, 1, -1, -2, -2, 0, 1, 4, 6],
    lowCut: null,
    highCut: null,
    outputGain: -3,
  },
  jerseyClub: {
    // Kick triplets, bed-squeak samples and vocal chops that need snap.
    name: 'Jersey Club',
    group: 'genre',
    family: 'phonkHipHop',
    gains: [8, 9, 4, -1, -2, 1, 4, 5, 4, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -5.5,
  },

  // Electronic & Club
  electro: {
    // Electro: punchy 808 kick, snappy claps, bright synths.
    name: 'Electro',
    group: 'genre',
    family: 'electronic',
    gains: [6, 7, 3, -1, -2, 0, 2, 4, 5, 5],
    lowCut: null,
    highCut: null,
    outputGain: -4.5,
  },
  techno: {
    // Techno: kick punch at 60–125 Hz, darker mids, crisp hats; rumble removed.
    name: 'Techno',
    group: 'genre',
    family: 'electronic',
    gains: [5, 8, 6, 0, -3, -2, 0, 2, 4, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  drumAndBass: {
    // Drum & bass: clean sub with the rumble cut, scooped low mids, snare snap and air.
    name: 'Drum & Bass',
    group: 'genre',
    family: 'electronic',
    gains: [8, 6, 0, -3, -2, 1, 4, 5, 4, 4],
    lowCut: 30,
    highCut: null,
    outputGain: -3.5,
  },
  dubstep: {
    // Dubstep: massive sub, growling mid bass, cracking snare.
    name: 'Dubstep',
    group: 'genre',
    family: 'electronic',
    gains: [12, 10, 4, 0, 2, 3, 2, 3, 2, 1],
    lowCut: 25,
    highCut: null,
    outputGain: -6,
  },
  house: {
    // Steady kick and warm bassline, open hats with a little shine.
    name: 'House',
    group: 'genre',
    family: 'electronic',
    gains: [5, 6, 3, 0, -1, 0, 1, 2, 3, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -3,
  },
  deepHouse: {
    // Round, warm bass and soft chords; the top stays smooth.
    name: 'Deep House',
    group: 'genre',
    family: 'electronic',
    gains: [6, 6, 4, 2, 0, -1, -1, -1, 1, 1],
    lowCut: null,
    highCut: null,
    outputGain: -3.5,
  },
  techHouse: {
    // Tight punchy kick, rolling bass groove, crisp percussion.
    name: 'Tech House',
    group: 'genre',
    family: 'electronic',
    gains: [5, 7, 5, -1, -2, 0, 1, 3, 4, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  minimal: {
    // Small, precise sounds; a light lift on the kick and the clicks.
    name: 'Minimal',
    group: 'genre',
    family: 'electronic',
    gains: [3, 4, 2, 0, -1, 0, 1, 2, 3, 2],
    lowCut: 30,
    highCut: null,
    outputGain: -2,
  },
  hardTechno: {
    // A pounding, distorted kick at 60–125 Hz and industrial percussion.
    name: 'Hard Techno',
    group: 'genre',
    family: 'electronic',
    gains: [8, 10, 7, 0, -3, -1, 2, 4, 4, 2],
    lowCut: 30,
    highCut: null,
    outputGain: -6,
  },
  trance: {
    // Driving bass and wide supersaw leads that need air on top.
    name: 'Trance',
    group: 'genre',
    family: 'electronic',
    gains: [4, 5, 3, -1, -2, 0, 2, 3, 5, 6],
    lowCut: 30,
    highCut: null,
    outputGain: -3,
  },
  psytrance: {
    // The rolling bassline sits at 60–125 Hz; squelchy, psychedelic highs.
    name: 'Psytrance',
    group: 'genre',
    family: 'electronic',
    gains: [5, 8, 8, -1, -3, 0, 2, 3, 5, 4],
    lowCut: 35,
    highCut: null,
    outputGain: -5,
  },
  hardstyle: {
    // The distorted kick punches at 60–120 Hz; harsh, screeching mids.
    name: 'Hardstyle',
    group: 'genre',
    family: 'electronic',
    gains: [6, 11, 10, 1, -1, 3, 4, 4, 2, 1],
    lowCut: 35,
    highCut: null,
    outputGain: -8,
  },
  gabber: {
    // A brutally distorted kick from the sub into the low mids, harsh and raw on top.
    name: 'Gabber',
    group: 'genre',
    family: 'electronic',
    gains: [5, 10, 11, 4, 2, 4, 5, 3, 1, -1],
    lowCut: 40,
    highCut: 16000,
    outputGain: -9,
  },
  ukGarage: {
    // Shuffled hats in the air band, a warm sub under swung beats.
    name: 'UK Garage',
    group: 'genre',
    family: 'electronic',
    gains: [8, 7, 2, 0, -1, -1, 1, 2, 5, 6],
    lowCut: 25,
    highCut: null,
    outputGain: -3.5,
  },
  jungle: {
    // Deep sub bass under chopped breakbeats with cracking snares.
    name: 'Jungle',
    group: 'genre',
    family: 'electronic',
    gains: [10, 8, 0, -2, -1, 1, 3, 4, 3, 2],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  breakbeat: {
    // Punchy breaks, snare body in the mids, a solid kick.
    name: 'Breakbeat',
    group: 'genre',
    family: 'electronic',
    gains: [5, 6, 4, 0, -1, 1, 3, 4, 3, 2],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  synthwave: {
    // Warm analog synths and gated snares, with a slightly soft retro top.
    name: 'Synthwave',
    group: 'genre',
    family: 'electronic',
    gains: [4, 4, 3, 1, 0, 1, 2, 3, 2, 0],
    lowCut: null,
    highCut: 16000,
    outputGain: -3,
  },
  hyperpop: {
    // Maximal and bright, pitched vocals and distorted bass, lots of air.
    name: 'Hyperpop',
    group: 'genre',
    family: 'electronic',
    gains: [8, 7, 2, -2, -2, 0, 3, 5, 7, 7],
    lowCut: 30,
    highCut: null,
    outputGain: -4.5,
  },
  futureBass: {
    // Sidechained supersaw chords over a deep sub, sparkly highs.
    name: 'Future Bass',
    group: 'genre',
    family: 'electronic',
    gains: [8, 7, 2, -1, -2, 0, 2, 3, 5, 6],
    lowCut: 30,
    highCut: null,
    outputGain: -3.5,
  },
  riddim: {
    // Heavy sub and repetitive, metallic mid-bass wobbles.
    name: 'Riddim',
    group: 'genre',
    family: 'electronic',
    gains: [12, 10, 5, 1, 3, 4, 2, 2, 1, 0],
    lowCut: 30,
    highCut: null,
    outputGain: -6.5,
  },

  // Live & Other
  rockGenre: {
    // Guitars and vocals in the presence range, a punchy kick, no rumble.
    name: 'Rock',
    group: 'genre',
    family: 'liveOther',
    gains: [3, 4, 2, -1, -1, 1, 3, 4, 3, 2],
    lowCut: 35,
    highCut: null,
    outputGain: -2.5,
  },
  metal: {
    // Scooped mids, a tight kick and an aggressive guitar presence.
    name: 'Metal',
    group: 'genre',
    family: 'liveOther',
    gains: [4, 5, 3, -2, -5, -4, 1, 6, 5, 3],
    lowCut: 40,
    highCut: null,
    outputGain: -3,
  },
  punk: {
    // Raw, mid-forward guitars and snare; a lean low end, nothing polished.
    name: 'Punk',
    group: 'genre',
    family: 'liveOther',
    gains: [0, 1, 3, 1, 1, 3, 4, 4, 2, 0],
    lowCut: 50,
    highCut: null,
    outputGain: -3,
  },
  usFunk: {
    // Slap bass and tight drums, horns and guitar chops in the upper mids.
    name: 'Funk (US)',
    group: 'genre',
    family: 'liveOther',
    gains: [3, 5, 5, 2, 0, 1, 3, 3, 2, 1],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  disco: {
    // Four-on-the-floor kick, octave bass, strings and open hats with shine.
    name: 'Disco',
    group: 'genre',
    family: 'liveOther',
    gains: [4, 5, 3, 0, -1, 0, 1, 2, 4, 4],
    lowCut: 30,
    highCut: null,
    outputGain: -2.5,
  },
  soul: {
    // Warm vocals and analog band, full low mids, a gentle top.
    name: 'Soul',
    group: 'genre',
    family: 'liveOther',
    gains: [3, 3, 3, 2, 1, 2, 2, 1, 0, -1],
    lowCut: null,
    highCut: 15000,
    outputGain: -2.5,
  },
  reggae: {
    // Deep bass and one-drop drums lead; highs are rolled off and warm.
    name: 'Reggae',
    group: 'genre',
    family: 'liveOther',
    gains: [7, 8, 5, 1, -1, 0, 1, 1, -1, -3],
    lowCut: null,
    highCut: 14000,
    outputGain: -4.5,
  },
  dub: {
    // The bass is everything; the echoes sit low, the top is rolled off.
    name: 'Dub',
    group: 'genre',
    family: 'liveOther',
    gains: [10, 11, 6, 1, -2, -2, -1, 0, -2, -4],
    lowCut: null,
    highCut: 10000,
    outputGain: -6,
  },
  ambient: {
    // Gentle and wide; small changes so long textures stay natural.
    name: 'Ambient',
    group: 'genre',
    family: 'liveOther',
    gains: [2, 2, 1, 0, -1, -1, 0, 1, 2, 2],
    lowCut: null,
    highCut: null,
    outputGain: -1,
  },
  chillout: {
    // Soft, warm low end and a smooth, relaxed top.
    name: 'Chillout',
    group: 'genre',
    family: 'liveOther',
    gains: [3, 3, 2, 1, 0, -1, -1, 0, 1, 1],
    lowCut: null,
    highCut: null,
    outputGain: -1.5,
  },
  lofi: {
    // Tape and cassette character; the high cut and low cut narrow the band.
    name: 'Lo-fi',
    group: 'genre',
    family: 'liveOther',
    gains: [3, 3, 3, 2, 1, 0, -1, -2, -4, -6],
    lowCut: 40,
    highCut: 8000,
    outputGain: -0.5,
  },
};
