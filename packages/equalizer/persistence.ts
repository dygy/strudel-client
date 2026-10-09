/**
 * Settings Persistence Layer
 *
 * Handles saving and loading equalizer settings to/from localStorage.
 */

import { EQUALIZER_PRESETS } from './presets';

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
}

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

    const settings = JSON.parse(serialized) as EqualizerSettings;

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

    // An unknown preset name would leave the preset menu showing a preset that is not applied.
    const preset =
      typeof settings.preset === 'string' && settings.preset in EQUALIZER_PRESETS ? settings.preset : 'custom';
    return { ...settings, preset };
  } catch (err) {
    console.warn('[Equalizer] Failed to load settings:', err);
    return null;
  }
}

const isNumberIn = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Ranges match what the UI can produce and the audio graph accepts (AudioEqualizer clamps
// gain to ±12 dB and Q to 0.5–4). An out-of-range value would be clamped in the audio but
// kept by the panel, so the sliders, the curve and what is heard would disagree.
function isValidBand(band: unknown): band is BandSettings {
  if (!band || typeof band !== 'object') return false;
  const { frequency, gain, Q } = band as Record<string, unknown>;
  return isNumberIn(frequency, 1, 24000) && isNumberIn(gain, -12, 12) && isNumberIn(Q, 0.5, 4);
}

/**
 * Get default equalizer settings (Flat preset)
 * @returns Default settings
 */
export function getDefaultSettings(): EqualizerSettings {
  return {
    isEnabled: true,
    preset: 'flat',
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
