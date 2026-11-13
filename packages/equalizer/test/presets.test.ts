/**
 * @spec: 020-eq-strong-control (functional §2.4, tech §2.2)
 * Presets are full settings with a group. 12 genre presets set bands, cuts and output level, each
 * within range and as loud as Flat (pink noise, ±3 dB); the 22 listening profiles use no cuts.
 */
import { describe, it, expect } from 'vitest';
import { EQUALIZER_PRESETS } from '../presets';
import { EQ_GAIN_LIMIT, HIGH_CUT_RANGE, LOW_CUT_RANGE, OUTPUT_GAIN_RANGE } from '../AudioEqualizer';
import { pinkNoiseLoudnessDb } from '../response';

const GENRES = [
  'brazilianFunk',
  'automotivo',
  'montagem',
  'funkAgressivo',
  'mandelao',
  'phonk',
  'driftPhonk',
  'electro',
  'techno',
  'drumAndBass',
  'dubstep',
  'trap',
];
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
  it('has exactly the 12 genre presets, by these keys', () => {
    expect(genres.map(([key]) => key)).toEqual(GENRES);
  });

  it('keeps the 22 listening profiles, flat included, with no cuts or output level', () => {
    expect(profiles).toHaveLength(22);
    expect(EQUALIZER_PRESETS.flat.group).toBe('profile');
    profiles.forEach(([, p]) => {
      expect(p.lowCut ?? null).toBeNull();
      expect(p.highCut ?? null).toBeNull();
      expect(p.outputGain ?? 0).toBe(0);
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

  it.each(GENRES)('%s plays as loud as Flat (pink noise, within ±3 dB)', (key) => {
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
