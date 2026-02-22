/**
 * Settings Persistence Layer
 * 
 * Handles saving and loading equalizer settings to/from localStorage.
 */

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
    
    return settings;
  } catch (err) {
    console.warn('[Equalizer] Failed to load settings:', err);
    return null;
  }
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
      { frequency: 16000, gain: 0, Q: 1.0 }
    ]
  };
}
