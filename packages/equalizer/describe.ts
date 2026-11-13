/**
 * A plain summary of EQ settings (spec 021): which regions are boosted or cut and by how much, the
 * cuts that are on, and the output level. Data only, so the website localises the words.
 */

/** The regions the summary speaks of, low to high. */
export type EqualizerRegion = 'sub' | 'bass' | 'lowMid' | 'mid' | 'presence' | 'air';

/** Regions in order, with the band frequencies (Hz) each one covers. */
export const EQUALIZER_REGIONS: readonly { region: EqualizerRegion; frequencies: readonly number[] }[] = [
  { region: 'sub', frequencies: [31, 62] },
  { region: 'bass', frequencies: [125] },
  { region: 'lowMid', frequencies: [250, 500] },
  { region: 'mid', frequencies: [1000, 2000] },
  { region: 'presence', frequencies: [4000] },
  { region: 'air', frequencies: [8000, 16000] },
];

/** A region whose mean gain changes by less than this (dB, before rounding) is not mentioned. */
export const DESCRIBE_REGION_THRESHOLD_DB = 2;

export interface DescribeSettingsInput {
  /** The bands with their centre frequency (Hz) and gain (dB). */
  bands: readonly { frequency: number; gain: number }[];
  /** The low cut; off when absent, null or not enabled. */
  lowCut?: { enabled: boolean; frequency: number } | null;
  /** The high cut; off when absent, null or not enabled. */
  highCut?: { enabled: boolean; frequency: number } | null;
  /** Output level (dB); absent means 0 dB. */
  outputGain?: number;
}

export interface SettingsDescription {
  /** Nothing to say: no region changed by 2 dB or more, both cuts off and the output at 0 dB. */
  flat: boolean;
  /** The regions whose mean gain changed by 2 dB or more, low to high, each shown rounded to 1 dB. */
  regions: { region: EqualizerRegion; dB: number }[];
  /** The low cut frequency (Hz), when on. */
  lowCut?: number;
  /** The high cut frequency (Hz), when on. */
  highCut?: number;
  /** The output level (dB), when not 0. */
  outputGain?: number;
}

/** Rounds half away from zero, so +3.5 and −3.5 give +4 and −4 (a cut reads as large as a boost). */
const roundDb = (db: number) => {
  const r = Math.sign(db) * Math.round(Math.abs(db));
  return r === 0 ? 0 : r;
};

/** The region a band belongs to: the standard band frequencies map exactly; others go by range. */
function regionOf(frequency: number): EqualizerRegion {
  const exact = EQUALIZER_REGIONS.find((r) => r.frequencies.includes(frequency));
  if (exact) return exact.region;
  if (frequency < 90) return 'sub';
  if (frequency < 180) return 'bass';
  if (frequency < 750) return 'lowMid';
  if (frequency < 3000) return 'mid';
  if (frequency < 6000) return 'presence';
  return 'air';
}

/**
 * Summarises EQ settings by region: each region's gain is the mean of its bands (sub 31 and 62 Hz,
 * bass 125 Hz, low mids 250 and 500 Hz, mids 1 and 2 kHz, presence 4 kHz, air 8 and 16 kHz) rounded
 * to the nearest dB for display; only regions whose mean is ±2 dB or more (before rounding) are listed. The cuts are listed when on and
 * the output level when not 0 dB. Returns data only; the caller turns it into words.
 * @param settings - Bands, cuts and output level (the shape `AudioEqualizer.getState()` and the saved settings use)
 * @returns The regions, cuts and output to mention, and whether there is nothing to mention
 * @example
 * describeSettings({ bands, lowCut: { enabled: true, frequency: 25 }, highCut: null, outputGain: -8 })
 * // → { flat: false, regions: [{ region: 'sub', dB: 15 }, …], lowCut: 25, outputGain: -8 }
 */
export function describeSettings(settings: DescribeSettingsInput): SettingsDescription {
  const sums = new Map<EqualizerRegion, { total: number; count: number }>();
  for (const band of settings.bands ?? []) {
    if (!Number.isFinite(band?.gain) || !Number.isFinite(band?.frequency)) continue;
    const region = regionOf(band.frequency);
    const entry = sums.get(region) ?? { total: 0, count: 0 };
    entry.total += band.gain;
    entry.count += 1;
    sums.set(region, entry);
  }

  const regions: SettingsDescription['regions'] = [];
  for (const { region } of EQUALIZER_REGIONS) {
    const entry = sums.get(region);
    if (!entry) continue;
    const mean = entry.total / entry.count;
    // The threshold applies to the real mean (functional spec §2.2: "changed by less than 2 dB are
    // not mentioned"), so 1.5 dB stays out; only the shown value is rounded.
    if (Math.abs(mean) >= DESCRIBE_REGION_THRESHOLD_DB) regions.push({ region, dB: roundDb(mean) });
  }

  const description: SettingsDescription = { flat: false, regions };
  if (settings.lowCut?.enabled && Number.isFinite(settings.lowCut.frequency)) {
    description.lowCut = settings.lowCut.frequency;
  }
  if (settings.highCut?.enabled && Number.isFinite(settings.highCut.frequency)) {
    description.highCut = settings.highCut.frequency;
  }
  const output = settings.outputGain ?? 0;
  if (Number.isFinite(output) && output !== 0) description.outputGain = output;

  description.flat =
    regions.length === 0 &&
    description.lowCut === undefined &&
    description.highCut === undefined &&
    description.outputGain === undefined;
  return description;
}
