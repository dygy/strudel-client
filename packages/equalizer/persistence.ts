/**
 * Settings Persistence Layer
 *
 * Handles saving and loading equalizer settings to/from localStorage.
 */

import { EQUALIZER_PRESETS } from './presets';
import {
  DEFAULT_HIGH_CUT_FREQUENCY,
  DEFAULT_LOW_CUT_FREQUENCY,
  EQ_GAIN_LIMIT,
  EQ_Q_RANGE,
  HIGH_CUT_RANGE,
  LOW_CUT_RANGE,
  OUTPUT_GAIN_RANGE,
  type CutUpdate,
} from './AudioEqualizer.js';
import type { CutSettings } from './response.js';

const STORAGE_KEY = 'strudel-equalizer-settings';

/**
 * Band settings interface
 */
export interface BandSettings {
  frequency: number;
  gain: number;
  Q: number;
}

/**
 * Equalizer settings interface
 */
export interface EqualizerSettings {
  isEnabled: boolean;
  preset: string;
  bands: BandSettings[];
  /** Spec 020. Optional: saves from before it have none and load with the cut off at 80 Hz. */
  lowCut?: CutSettings;
  /** Spec 020. Optional: saves from before it have none and load with the cut off at 12 kHz. */
  highCut?: CutSettings;
  /** Spec 020, dB (−24…+6). Optional: saves from before it load with 0 dB. */
  outputGain?: number;
}

/** The defaults a save without the spec 020 fields gets: both cuts off, output 0 dB. */
const defaultStripSettings = () => ({
  lowCut: { enabled: false, frequency: DEFAULT_LOW_CUT_FREQUENCY },
  highCut: { enabled: false, frequency: DEFAULT_HIGH_CUT_FREQUENCY },
  outputGain: 0,
});

/**
 * Save equalizer settings to localStorage
 * @param settings - Settings object with isEnabled, preset, and bands
 */
export function saveEqualizerSettings(settings: EqualizerSettings): void {
  try {
    const serialized = JSON.stringify(settings);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (err) {
    console.warn('[Equalizer] Failed to save settings:', err);
  }
}

/**
 * Load equalizer settings from localStorage
 * @returns Settings object or null if not found/corrupted
 */
export function loadEqualizerSettings(): EqualizerSettings | null {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) return null;
    return validateEqualizerSettings(JSON.parse(serialized));
  } catch (err) {
    console.warn('[Equalizer] Failed to load settings:', err);
    return null;
  }
}

/**
 * Validate settings read from storage (the rules loadEqualizerSettings applies; the A/B slots of
 * spec 026 use them for each slot). Returns a clean copy, or null when they are damaged: 10 bands
 * with a finite frequency (1–24000 Hz), gain (±24 dB) and Q (0.5–4), a boolean on/off, and the
 * spec 020 fields either absent (an older save: both cuts off, output 0 dB) or in range. An unknown
 * preset name becomes 'custom'.
 * @param raw - Parsed JSON
 * @returns The settings, or null
 */
export function validateEqualizerSettings(raw: unknown): EqualizerSettings | null {
  const settings = raw as EqualizerSettings;

  // Validate settings structure
  if (!settings || typeof settings !== 'object') {
    console.warn('[Equalizer] Invalid settings format, using defaults');
    return null;
  }

  // Validate bands array
  if (!Array.isArray(settings.bands) || settings.bands.length !== 10) {
    console.warn('[Equalizer] Invalid bands configuration, using defaults');
    return null;
  }

  // Validate every band: the panel reads band.gain / band.Q and hands them to the
  // audio graph, where a missing band throws and a non-finite value is rejected.
  if (!settings.bands.every(isValidBand) || typeof settings.isEnabled !== 'boolean') {
    console.warn('[Equalizer] Damaged band settings, using defaults');
    return null;
  }

  // Spec 020 fields: absent is fine (an older save), present but invalid means damaged.
  const defaults = defaultStripSettings();
  const lowCut = settings.lowCut === undefined ? defaults.lowCut : settings.lowCut;
  const highCut = settings.highCut === undefined ? defaults.highCut : settings.highCut;
  const outputGain = settings.outputGain === undefined ? defaults.outputGain : settings.outputGain;
  if (
    !isValidCut(lowCut, LOW_CUT_RANGE) ||
    !isValidCut(highCut, HIGH_CUT_RANGE) ||
    !isNumberIn(outputGain, OUTPUT_GAIN_RANGE.min, OUTPUT_GAIN_RANGE.max)
  ) {
    console.warn('[Equalizer] Damaged cut or output settings, using defaults');
    return null;
  }

  // An unknown preset name would leave the preset menu showing a preset that is not applied.
  const preset =
    typeof settings.preset === 'string' && settings.preset in EQUALIZER_PRESETS ? settings.preset : 'custom';
  return {
    ...settings,
    preset,
    lowCut: { enabled: lowCut.enabled, frequency: lowCut.frequency },
    highCut: { enabled: highCut.enabled, frequency: highCut.frequency },
    outputGain,
  };
}

const isNumberIn = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Ranges match what the UI can produce and the audio graph accepts (AudioEqualizer clamps
// gain to ±24 dB, Q to 0.5–4, the cuts to 20–1000 / 1000–20000 Hz and the output to −24…+6 dB).
// An out-of-range value would be clamped in the audio but kept by the panel, so the sliders,
// the curve and what is heard would disagree.
function isValidBand(band: unknown): band is BandSettings {
  if (!band || typeof band !== 'object') return false;
  const { frequency, gain, Q } = band as Record<string, unknown>;
  return (
    isNumberIn(frequency, 1, 24000) &&
    isNumberIn(gain, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT) &&
    isNumberIn(Q, EQ_Q_RANGE.min, EQ_Q_RANGE.max)
  );
}

function isValidCut(cut: unknown, range: { min: number; max: number }): cut is CutSettings {
  if (!cut || typeof cut !== 'object') return false;
  const { enabled, frequency } = cut as Record<string, unknown>;
  return typeof enabled === 'boolean' && isNumberIn(frequency, range.min, range.max);
}

/** The part of AudioEqualizer that saved settings are applied to. */
interface SettingsTarget {
  setEnabled(enabled: boolean): void;
  setBand(index: number, update: { gain?: number; Q?: number }): void;
  setLowCut(update: CutUpdate): void;
  setHighCut(update: CutUpdate): void;
  setOutputGain(db: number): void;
}

/**
 * Apply saved settings to an equalizer: on/off first, then every band, the cuts and the output
 * level, so an EQ saved as off stays silent (each setter only stores a value while the EQ is off).
 * Settings without the spec 020 fields get both cuts off and output 0 dB.
 * @param equalizer - An AudioEqualizer (main or preview)
 * @param settings - Settings from loadEqualizerSettings / getDefaultSettings
 */
export function applyEqualizerSettings(
  equalizer: SettingsTarget,
  settings: Pick<EqualizerSettings, 'isEnabled' | 'bands' | 'lowCut' | 'highCut' | 'outputGain'>,
): void {
  const defaults = defaultStripSettings();
  equalizer.setEnabled(settings.isEnabled);
  settings.bands.forEach((band, index) => {
    equalizer.setBand(index, { gain: band.gain, Q: band.Q });
  });
  equalizer.setLowCut({ ...(settings.lowCut ?? defaults.lowCut) });
  equalizer.setHighCut({ ...(settings.highCut ?? defaults.highCut) });
  equalizer.setOutputGain(settings.outputGain ?? defaults.outputGain);
}

/**
 * Get default equalizer settings (Flat preset: bands at 0 dB, both cuts off, output 0 dB)
 * @returns Default settings
 */
export function getDefaultSettings(): EqualizerSettings {
  return {
    isEnabled: true,
    preset: 'flat',
    ...defaultStripSettings(),
    bands: [
      { frequency: 31, gain: 0, Q: 1.0 },
      { frequency: 62, gain: 0, Q: 1.0 },
      { frequency: 125, gain: 0, Q: 1.0 },
      { frequency: 250, gain: 0, Q: 1.0 },
      { frequency: 500, gain: 0, Q: 1.0 },
      { frequency: 1000, gain: 0, Q: 1.0 },
      { frequency: 2000, gain: 0, Q: 1.0 },
      { frequency: 4000, gain: 0, Q: 1.0 },
      { frequency: 8000, gain: 0, Q: 1.0 },
      { frequency: 16000, gain: 0, Q: 1.0 },
    ],
  };
}
