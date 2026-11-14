/**
 * @spec: 020-eq-strong-control (functional §2.4, tech §2.2)
 * @spec: 021-eq-genre-presets-transparency (functional §2.1, tech §2.1, §4)
 * Presets are full settings with a group. 59 genre presets (12 from spec 020, 47 from spec 021) set
 * bands, cuts and output level, each within range and as loud as Flat (pink noise, ±3 dB), and each
 * belongs to one of four families, in the spec's order; the 22 listening profiles use no cuts. The
 * 34 presets from spec 020 keep their keys and values, so saved selections still load and sound the same.
 * @spec: 026-eq-listening-tools (functional §2.4, tech §2.4)
 * Every one of the 81 presets plays within ±3 dB of Flat: the four loud profiles got an output level,
 * their bands unchanged, and saved settings from them load exactly as saved (values, not the key).
 */
import { describe, it, expect, vi } from 'vitest';
import { EQUALIZER_PRESETS, EQUALIZER_PRESET_FAMILIES } from '../presets';
import { EQ_GAIN_LIMIT, HIGH_CUT_RANGE, LOW_CUT_RANGE, OUTPUT_GAIN_RANGE } from '../AudioEqualizer';
import { pinkNoiseLoudnessDb } from '../response';
import { getDefaultSettings, loadEqualizerSettings, saveEqualizerSettings } from '../persistence';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { createMemoryStorage } from '../../mixer/test/webAudioMock.mjs';

/** The genre presets by family, in picker order (functional spec §2.1, tech §2.1 keys). */
const FAMILIES: Record<string, string[]> = {
  brazilianLatin: [
    'brazilianFunk',
    'automotivo',
    'montagem',
    'funkAgressivo',
    'mandelao',
    'bruxaria',
    'mandelaoSlowed',
    'funkCariocaOldSchool',
    'baileFunk',
    'reggaeton',
    'dembow',
    'cumbia',
    'afroHouse',
    'amapiano',
  ],
  phonkHipHop: [
    'phonk',
    'driftPhonk',
    'trap',
    'brazilianPhonk',
    'housePhonk',
    'memphis',
    'boomBap',
    'lofiHipHop',
    'ukDrill',
    'nyDrill',
    'rage',
    'plugg',
    'cloudRap',
    'jerseyClub',
  ],
  electronic: [
    'electro',
    'techno',
    'drumAndBass',
    'dubstep',
    'house',
    'deepHouse',
    'techHouse',
    'minimal',
    'hardTechno',
    'trance',
    'psytrance',
    'hardstyle',
    'gabber',
    'ukGarage',
    'jungle',
    'breakbeat',
    'synthwave',
    'hyperpop',
    'futureBass',
    'riddim',
  ],
  liveOther: [
    // `rock` is a listening profile: the genre preset takes the `Genre` suffix (tech §2.1).
    'rockGenre',
    'metal',
    'punk',
    'usFunk',
    'disco',
    'soul',
    'reggae',
    'dub',
    'ambient',
    'chillout',
    'lofi',
  ],
};
const GENRES = Object.values(FAMILIES).flat();

/** The 34 presets as spec 020 shipped them (saved selections reference these keys and sounds). */
const SPEC_020_PRESETS: Record<string, Record<string, unknown>> = {
  flat: { name: 'Flat', group: 'profile', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  acoustic: { name: 'Acoustic', group: 'profile', gains: [4, 3, 2, 1, 1, 1, 2, 3, 4, 3] },
  bassBoost: { name: 'Bass Boost', group: 'profile', gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  bassReducer: { name: 'Bass Reducer', group: 'profile', gains: [-6, -4, -2, 0, 1, 2, 2, 2, 2, 2] },
  classical: { name: 'Classical', group: 'profile', gains: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4] },
  dance: { name: 'Dance', group: 'profile', gains: [6, 4, 2, 0, 0, -1, 0, 2, 4, 5] },
  deep: { name: 'Deep', group: 'profile', gains: [6, 5, 3, 1, 0, 0, -1, -1, 2, 3] },
  electronic: { name: 'Electronic', group: 'profile', gains: [5, 4, 2, 0, -1, 0, 1, 2, 4, 5] },
  hipHop: { name: 'Hip-Hop', group: 'profile', gains: [7, 5, 2, 1, -1, -1, 0, 1, 2, 3] },
  jazz: { name: 'Jazz', group: 'profile', gains: [4, 3, 1, 2, -1, -1, 0, 1, 3, 4] },
  latin: { name: 'Latin', group: 'profile', gains: [3, 2, 0, 0, 0, 0, 1, 2, 3, 4] },
  loudness: { name: 'Loudness', group: 'profile', gains: [6, 4, 0, 0, -1, 0, 0, 2, 4, 6] },
  lounge: { name: 'Lounge', group: 'profile', gains: [3, 2, 0, 1, 2, 2, 1, 0, 1, 2] },
  piano: { name: 'Piano', group: 'profile', gains: [2, 1, 0, 2, 3, 2, 3, 4, 3, 2] },
  pop: { name: 'Pop', group: 'profile', gains: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1] },
  rnb: { name: 'R&B', group: 'profile', gains: [7, 6, 3, 1, -1, -1, 1, 2, 3, 5] },
  rock: { name: 'Rock', group: 'profile', gains: [5, 3, -2, -3, -1, 1, 3, 4, 5, 5] },
  smallSpeakers: { name: 'Small Speakers', group: 'profile', gains: [3, 2, 2, 1, 0, 0, 1, 2, 2, 1] },
  spokenWord: { name: 'Spoken Word', group: 'profile', gains: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1] },
  trebleBoost: { name: 'Treble Boost', group: 'profile', gains: [0, 0, 0, 0, 0, 0, 2, 4, 6, 8] },
  trebleReducer: { name: 'Treble Reducer', group: 'profile', gains: [0, 0, 0, 0, 0, 0, -2, -3, -4, -5] },
  vocal: { name: 'Vocal Boost', group: 'profile', gains: [-2, -2, -1, 1, 3, 4, 3, 1, -1, -2] },
  brazilianFunk: {
    name: 'Brazilian Funk',
    group: 'genre',
    gains: [10, 9, 4, 0, -3, -1, 2, 4, 4, 3],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
  automotivo: {
    name: 'Automotivo',
    group: 'genre',
    gains: [18, 15, 3, -5, -6, -3, 2, 6, 7, 5],
    lowCut: 25,
    highCut: null,
    outputGain: -9,
  },
  montagem: {
    name: 'Montagem',
    group: 'genre',
    gains: [16, 14, 2, -5, -6, -2, 3, 6, 6, 4],
    lowCut: 28,
    highCut: null,
    outputGain: -7.5,
  },
  funkAgressivo: {
    name: 'Funk Agressivo',
    group: 'genre',
    gains: [12, 10, 3, -2, -2, 2, 5, 6, 4, 2],
    lowCut: null,
    highCut: null,
    outputGain: -6.5,
  },
  mandelao: {
    name: 'Mandelão',
    group: 'genre',
    gains: [14, 12, 6, -2, -4, -2, 1, 3, 2, 0],
    lowCut: null,
    highCut: 15000,
    outputGain: -7.5,
  },
  phonk: {
    name: 'Phonk',
    group: 'genre',
    gains: [12, 10, 3, -2, -3, 0, 4, 5, 1, -2],
    lowCut: null,
    highCut: 13000,
    outputGain: -6,
  },
  driftPhonk: {
    name: 'Drift Phonk',
    group: 'genre',
    gains: [16, 13, 4, -3, -4, 1, 6, 7, 2, -2],
    lowCut: 25,
    highCut: 14000,
    outputGain: -8,
  },
  electro: {
    name: 'Electro',
    group: 'genre',
    gains: [6, 7, 3, -1, -2, 0, 2, 4, 5, 5],
    lowCut: null,
    highCut: null,
    outputGain: -4.5,
  },
  techno: {
    name: 'Techno',
    group: 'genre',
    gains: [5, 8, 6, 0, -3, -2, 0, 2, 4, 3],
    lowCut: 30,
    highCut: null,
    outputGain: -4,
  },
  drumAndBass: {
    name: 'Drum & Bass',
    group: 'genre',
    gains: [8, 6, 0, -3, -2, 1, 4, 5, 4, 4],
    lowCut: 30,
    highCut: null,
    outputGain: -3.5,
  },
  dubstep: {
    name: 'Dubstep',
    group: 'genre',
    gains: [12, 10, 4, 0, 2, 3, 2, 3, 2, 1],
    lowCut: 25,
    highCut: null,
    outputGain: -6,
  },
  trap: {
    name: 'Trap',
    group: 'genre',
    gains: [12, 9, 2, -2, -3, 0, 2, 3, 5, 6],
    lowCut: null,
    highCut: null,
    outputGain: -5.5,
  },
};

/**
 * Spec 026: the four listening profiles that were more than 3 dB louder than Flat (acoustic +3.24,
 * bassBoost +3.71, piano +3.47, rnb +3.62) and the output level that brings each within ±3 dB: the
 * smallest 0.5 dB step that does it. Their bands are the spec 020 ones (checked below).
 */
const LOUDNESS_MATCHED_026: Record<string, number> = { acoustic: -0.5, bassBoost: -1, piano: -0.5, rnb: -1 };

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const entries = Object.entries(EQUALIZER_PRESETS);
const genres = entries.filter(([, p]) => p.group === 'genre');
const profiles = entries.filter(([, p]) => p.group === 'profile');

/** A preset as EQ settings (Q 1, as a fresh EQ has). */
const asSettings = (key: string) => {
  const p = EQUALIZER_PRESETS[key];
  return {
    bands: FREQUENCIES.map((frequency, i) => ({ frequency, gain: p.gains[i], Q: 1 })),
    lowCut: p.lowCut != null ? { enabled: true, frequency: p.lowCut } : null,
    highCut: p.highCut != null ? { enabled: true, frequency: p.highCut } : null,
    outputGain: p.outputGain ?? 0,
  };
};

describe('EQ presets (spec 020)', () => {
  it('has exactly the 59 genre presets, by these keys, in family order', () => {
    expect(GENRES).toHaveLength(59);
    expect(genres.map(([key]) => key)).toEqual(GENRES);
  });

  it('keeps the 22 listening profiles, flat included, with no cuts; only the four loud ones have an output level', () => {
    expect(profiles).toHaveLength(22);
    expect(EQUALIZER_PRESETS.flat.group).toBe('profile');
    profiles.forEach(([key, p]) => {
      expect(p.lowCut ?? null).toBeNull();
      expect(p.highCut ?? null).toBeNull();
      if (!(key in LOUDNESS_MATCHED_026)) expect([key, p.outputGain ?? 0]).toEqual([key, 0]);
    });
  });

  it('every preset has a group, a name and 10 finite gains', () => {
    entries.forEach(([, p]) => {
      expect(['profile', 'genre']).toContain(p.group);
      expect(p.name).toEqual(expect.any(String));
      expect(p.gains).toHaveLength(10);
      p.gains.forEach((g) => expect(Number.isFinite(g)).toBe(true));
    });
  });

  it.each(GENRES)('%s is within every range the EQ and the saved-settings loader accept', (key) => {
    const p = EQUALIZER_PRESETS[key];
    p.gains.forEach((g) => expect(Math.abs(g)).toBeLessThanOrEqual(EQ_GAIN_LIMIT));
    if (p.lowCut != null) {
      expect(p.lowCut).toBeGreaterThanOrEqual(LOW_CUT_RANGE.min);
      expect(p.lowCut).toBeLessThanOrEqual(LOW_CUT_RANGE.max);
    }
    if (p.highCut != null) {
      expect(p.highCut).toBeGreaterThanOrEqual(HIGH_CUT_RANGE.min);
      expect(p.highCut).toBeLessThanOrEqual(HIGH_CUT_RANGE.max);
    }
    expect(p.outputGain).toEqual(expect.any(Number));
    expect(p.outputGain!).toBeGreaterThanOrEqual(OUTPUT_GAIN_RANGE.min);
    expect(p.outputGain!).toBeLessThanOrEqual(OUTPUT_GAIN_RANGE.max);
  });

  // Spec 026 restores spec 021 AC 2.1.4 to its full scope: every preset, profiles included.
  it.each(entries.map(([key]) => key))('%s plays as loud as Flat (pink noise, within ±3 dB)', (key) => {
    const loudness = pinkNoiseLoudnessDb(asSettings(key));
    expect(Math.abs(loudness)).toBeLessThanOrEqual(3);
  });

  it('the loudness check is not trivial: a genre curve without its output level is louder than Flat', () => {
    const raw = { ...asSettings('automotivo'), outputGain: 0 };
    expect(pinkNoiseLoudnessDb(raw)).toBeGreaterThan(3);
  });

  it('the genres the owner plays are strong: a sub boost of at least +10 dB', () => {
    ['brazilianFunk', 'automotivo', 'montagem', 'phonk', 'driftPhonk'].forEach((key) =>
      expect(Math.max(...EQUALIZER_PRESETS[key].gains.slice(0, 2))).toBeGreaterThanOrEqual(10),
    );
    expect(EQUALIZER_PRESETS.phonk.highCut).toBeGreaterThanOrEqual(12000);
    expect(EQUALIZER_PRESETS.phonk.highCut).toBeLessThanOrEqual(14000);
    expect(EQUALIZER_PRESETS.drumAndBass.lowCut).toBe(30);
  });
});

describe('EQ genre families (spec 021)', () => {
  it('the families are, in picker order, Brazilian & Latin, Phonk/Hip-Hop/Trap, Electronic & Club, Live & Other', () => {
    expect([...EQUALIZER_PRESET_FAMILIES]).toEqual(['brazilianLatin', 'phonkHipHop', 'electronic', 'liveOther']);
  });

  it.each(Object.entries(FAMILIES))('%s holds exactly its presets, in the spec order', (family, keys) => {
    const members = genres.filter(([, p]) => p.family === family).map(([key]) => key);
    expect(members).toEqual(keys);
  });

  it('every genre preset has a family and no profile has one', () => {
    genres.forEach(([key, p]) => expect([key, EQUALIZER_PRESET_FAMILIES.includes(p.family!)]).toEqual([key, true]));
    profiles.forEach(([key, p]) => expect([key, p.family]).toEqual([key, undefined]));
  });

  it('adds 47 genre presets, 81 presets in all, with unique keys and names unique within each group', () => {
    expect(GENRES.filter((key) => !(key in SPEC_020_PRESETS))).toHaveLength(47);
    expect(entries).toHaveLength(81);
    expect(new Set(GENRES).size).toBe(GENRES.length);
    for (const group of ['genre', 'profile']) {
      const names = entries.filter(([, p]) => p.group === group).map(([, p]) => p.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('no new genre key reuses a profile key (the rock genre preset is `rockGenre`; `rock` stays the profile)', () => {
    const profileKeys = new Set(profiles.map(([key]) => key));
    expect(GENRES.filter((key) => profileKeys.has(key))).toEqual([]);
    expect(EQUALIZER_PRESETS.rock.group).toBe('profile');
    expect(EQUALIZER_PRESETS.rockGenre.group).toBe('genre');
  });

  it.each(Object.keys(SPEC_020_PRESETS))('%s keeps its spec 020 key and values', (key) => {
    const p = EQUALIZER_PRESETS[key];
    const expected = SPEC_020_PRESETS[key];
    expect({
      name: p.name,
      group: p.group,
      gains: p.gains,
      ...(p.group === 'genre' ? { lowCut: p.lowCut, highCut: p.highCut, outputGain: p.outputGain } : {}),
    }).toEqual(expected);
  });

  it('every genre preset moves the sound (at least one band ±2 dB or a cut), so none is a disguised Flat', () => {
    genres.forEach(([key, p]) => {
      const moves = p.gains.some((g) => Math.abs(g) >= 2) || p.lowCut != null || p.highCut != null;
      expect([key, moves]).toEqual([key, true]);
    });
  });

  it('the genre characters the owner asked for are in the values', () => {
    const P = EQUALIZER_PRESETS;
    // Amapiano: log-drum sub and bass, airy shakers.
    expect(Math.min(P.amapiano.gains[0], P.amapiano.gains[1])).toBeGreaterThanOrEqual(10);
    expect(P.amapiano.gains[9]).toBeGreaterThan(0);
    // Hardstyle / Gabber: kick punch at 60–120 Hz, harsh mids.
    for (const key of ['hardstyle', 'gabber']) {
      expect(Math.min(P[key].gains[1], P[key].gains[2])).toBeGreaterThanOrEqual(10);
      expect(P[key].gains[5] + P[key].gains[6]).toBeGreaterThan(0);
    }
    // Dub / Reggae: deep bass, rolled-off highs.
    for (const key of ['dub', 'reggae']) {
      expect(P[key].gains[1]).toBeGreaterThanOrEqual(8);
      expect(P[key].highCut).not.toBeNull();
      expect(P[key].gains[9]).toBeLessThan(0);
    }
    // Ambient: gentle (no band past ±3 dB, no cuts).
    P.ambient.gains.forEach((g) => expect(Math.abs(g)).toBeLessThanOrEqual(3));
    expect([P.ambient.lowCut, P.ambient.highCut]).toEqual([null, null]);
    // Metal: scooped mids, aggressive presence.
    expect(P.metal.gains[4]).toBeLessThanOrEqual(-4);
    expect(P.metal.gains[7]).toBeGreaterThanOrEqual(5);
    // Memphis / Lo-fi: a high cut for the tape feel.
    for (const key of ['memphis', 'lofi', 'lofiHipHop']) expect(P[key].highCut).toBeLessThanOrEqual(10000);
    // UK Garage: hats in the air band, warm sub.
    expect(P.ukGarage.gains[8] + P.ukGarage.gains[9]).toBeGreaterThanOrEqual(10);
    expect(P.ukGarage.gains[0]).toBeGreaterThanOrEqual(6);
  });
});

describe('EQ profiles loudness-matched (spec 026)', () => {
  it.each(Object.entries(LOUDNESS_MATCHED_026))(
    '%s gets output %s dB, the smallest 0.5 dB step within ±3 dB of Flat',
    (key, output) => {
      expect(EQUALIZER_PRESETS[key].outputGain).toBe(output);
      expect(Math.abs(pinkNoiseLoudnessDb(asSettings(key)))).toBeLessThanOrEqual(3);
      // Half a dB less would not do: the change is the smallest one.
      expect(pinkNoiseLoudnessDb({ ...asSettings(key), outputGain: output + 0.5 })).toBeGreaterThan(3);
    },
  );

  it.each(Object.keys(LOUDNESS_MATCHED_026))('%s keeps its bands and has no cuts', (key) => {
    expect(EQUALIZER_PRESETS[key].gains).toEqual(SPEC_020_PRESETS[key].gains);
    expect([EQUALIZER_PRESETS[key].lowCut ?? null, EQUALIZER_PRESETS[key].highCut ?? null]).toEqual([null, null]);
  });

  it('saved settings that came from one of them load exactly as saved, never re-derived from the preset key', () => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    const saved = {
      ...getDefaultSettings(),
      preset: 'bassBoost',
      bands: getDefaultSettings().bands.map((b, i) => ({ ...b, gain: EQUALIZER_PRESETS.bassBoost.gains[i] })),
      outputGain: 0, // saved before spec 026, when Bass Boost had no output level
    };
    saveEqualizerSettings(saved);
    const loaded = loadEqualizerSettings()!;
    expect(loaded.preset).toBe('bassBoost');
    expect(loaded.outputGain).toBe(0);
    expect(loaded.bands).toEqual(saved.bands);
    vi.unstubAllGlobals();
  });
});
