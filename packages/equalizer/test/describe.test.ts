/**
 * @spec: 021-eq-genre-presets-transparency (functional §2.2, tech §2.2)
 * describeSettings summarises EQ settings as data: each region's mean gain rounded to 1 dB, only
 * regions at ±2 dB or more, the cuts when on, the output when not 0 dB, and `flat` when there is
 * nothing to say.
 */
import { describe, it, expect } from 'vitest';
import { describeSettings, EQUALIZER_PRESETS } from '../index';

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const bandsOf = (gains: number[]) => FREQUENCIES.map((frequency, i) => ({ frequency, gain: gains[i], Q: 1 }));
const presetSettings = (key: string) => {
  const p = EQUALIZER_PRESETS[key];
  return {
    bands: bandsOf(p.gains),
    lowCut: p.lowCut != null ? { enabled: true, frequency: p.lowCut } : { enabled: false, frequency: 80 },
    highCut: p.highCut != null ? { enabled: true, frequency: p.highCut } : { enabled: false, frequency: 12000 },
    outputGain: p.outputGain ?? 0,
  };
};

describe('describeSettings (spec 021)', () => {
  it('flat settings: nothing to say', () => {
    expect(describeSettings({ bands: bandsOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) })).toEqual({ flat: true, regions: [] });
    expect(describeSettings(presetSettings('flat'))).toEqual({ flat: true, regions: [] });
  });

  it('a region is the mean of its bands: sub 31+62, bass 125, low mids 250+500, mids 1k+2k, presence 4k, air 8k+16k', () => {
    const d = describeSettings({ bands: bandsOf([10, 6, -5, -2, -6, 3, 5, 9, 4, 8]) });
    expect(d.regions).toEqual([
      { region: 'sub', dB: 8 },
      { region: 'bass', dB: -5 },
      { region: 'lowMid', dB: -4 },
      { region: 'mid', dB: 4 },
      { region: 'presence', dB: 9 },
      { region: 'air', dB: 6 },
    ]);
    expect(d.flat).toBe(false);
  });

  it('regions whose mean is under 2 dB are left out, even when they would round to 2 (functional §2.2)', () => {
    const d = describeSettings({ bands: bandsOf([1, 2, 1.4, 2, 2, -2, -1, -1.6, 0, 0]) });
    // sub 1.5 (out), bass 1.4 (out), lowMid 2 (in), mid −1.5 (out), presence −1.6 (out), air 0 (out)
    expect(d.regions).toEqual([{ region: 'lowMid', dB: 2 }]);
  });

  it('the 2 dB boundary: a mean of exactly ±2.0 dB is included, 1.99 dB is not', () => {
    const d = describeSettings({ bands: bandsOf([2, 2, -2, 1.99, 1.99, 0, 0, 0, 0, 0]) });
    expect(d.regions).toEqual([
      { region: 'sub', dB: 2 },
      { region: 'bass', dB: -2 },
    ]);
    expect(describeSettings({ bands: bandsOf([1.5, 1.5, 0, 0, 0, 0, 0, 0, 0, 0]) })).toEqual({
      flat: true,
      regions: [],
    });
  });

  it('halves round away from zero, so a cut reads as large as the same boost', () => {
    const d = describeSettings({ bands: bandsOf([3, 4, 0, -3, -4, 0, 0, 0, 0, 0]) });
    expect(d.regions).toEqual([
      { region: 'sub', dB: 4 },
      { region: 'lowMid', dB: -4 },
    ]);
  });

  it('only small changes everywhere still reads as flat', () => {
    expect(describeSettings({ bands: bandsOf([1, 1, 1, -1, -1, 1, 1, 1, -1, -1]), outputGain: 0 }).flat).toBe(true);
  });

  it('the cuts are listed only when on, and the output only when not 0 dB', () => {
    const off = describeSettings({
      bands: bandsOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      lowCut: { enabled: false, frequency: 80 },
      highCut: null,
      outputGain: 0,
    });
    expect(off).toEqual({ flat: true, regions: [] });

    const on = describeSettings({
      bands: bandsOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      lowCut: { enabled: true, frequency: 40 },
      highCut: { enabled: true, frequency: 9000 },
      outputGain: -2.5,
    });
    expect(on).toEqual({ flat: false, regions: [], lowCut: 40, highCut: 9000, outputGain: -2.5 });

    expect(describeSettings({ bands: [], highCut: { enabled: true, frequency: 12000 } }).flat).toBe(false);
    expect(describeSettings({ bands: [], outputGain: 3 })).toEqual({ flat: false, regions: [], outputGain: 3 });
  });

  it('Drift Phonk reads: sub boost, scooped low mids, presence lift, low cut 25 Hz, high cut 14 kHz, output −8 dB', () => {
    const d = describeSettings(presetSettings('driftPhonk'));
    expect(d.regions.find((r) => r.region === 'sub')!.dB).toBeGreaterThanOrEqual(10);
    expect(d.regions.find((r) => r.region === 'lowMid')!.dB).toBeLessThan(0);
    expect(d.regions.find((r) => r.region === 'presence')!.dB).toBeGreaterThan(0);
    expect([d.lowCut, d.highCut, d.outputGain]).toEqual([25, 14000, -8]);
  });

  it('ignores non-finite values instead of reporting NaN', () => {
    const d = describeSettings({
      bands: [
        { frequency: 31, gain: NaN },
        { frequency: 62, gain: 6 },
      ],
      outputGain: NaN,
    });
    expect(d).toEqual({ flat: false, regions: [{ region: 'sub', dB: 6 }] });
  });

  it('every genre preset has something to say', () => {
    Object.entries(EQUALIZER_PRESETS)
      .filter(([, p]) => p.group === 'genre')
      .forEach(([key]) => expect([key, describeSettings(presetSettings(key)).flat]).toEqual([key, false]));
  });
});
