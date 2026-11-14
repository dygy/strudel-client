/**
 * Named user presets (spec 028): the user's own EQ settings, kept on this device under a name.
 *
 * Stored under `strudel-eq-user-presets` as a JSON array of `{ name, settings }`. Each entry's
 * settings are validated like saved settings (validateEqualizerSettings); a damaged entry is skipped
 * and the rest still load. Names are trimmed, 1–40 characters, unique ignoring case; at most 50.
 *
 * Pure apart from localStorage: nothing here touches an AudioEqualizer (the panel applies a picked
 * preset to the active A/B slot with its usual glide).
 */
import {
  USER_PRESET_PREFIX,
  isUserPresetValue,
  validateEqualizerSettings,
  type EqualizerSettings,
} from './persistence.js';

export { USER_PRESET_PREFIX, isUserPresetValue };

/** The localStorage key of the user presets. */
export const USER_PRESETS_STORAGE_KEY = 'strudel-eq-user-presets';
/** The most user presets kept. */
export const USER_PRESET_LIMIT = 50;
/** The longest name, in characters, after trimming. */
export const USER_PRESET_NAME_MAX = 40;

/** A user preset: its name and full settings (bands, cuts, output and on/off). */
export interface UserPreset {
  name: string;
  settings: EqualizerSettings;
}

/** Why a change was refused: a bad name, a name in use, the limit reached, or no such preset. */
export type UserPresetError = 'invalid' | 'taken' | 'full' | 'missing';

/** The result of a change: the presets after it (sorted by name), or why it was refused. */
export type UserPresetResult = { ok: true; presets: UserPreset[] } | { ok: false; reason: UserPresetError };

/** Options of saveUserPreset and renameUserPreset. */
export interface UserPresetWriteOptions {
  /** Replace a preset that already has the name (asked for by the panel first). */
  overwrite?: boolean;
}

const length = (text: string) => [...text].length;
const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const byName = (a: UserPreset, b: UserPreset) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const clone = (settings: EqualizerSettings): EqualizerSettings => JSON.parse(JSON.stringify(settings));

/** A stored preset's settings carry its picker value as their preset name. */
const withName = (name: string, settings: EqualizerSettings): UserPreset => ({
  name,
  settings: { ...clone(settings), preset: userPresetValue(name) },
});

/**
 * Check a preset name: trimmed, 1–40 characters.
 * @param name - The name as typed
 * @returns The trimmed name, or null when it is empty, too long or not a string
 */
export function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length > 0 && length(trimmed) <= USER_PRESET_NAME_MAX ? trimmed : null;
}

/**
 * The picker value of a user preset, e.g. 'user:Phonk car' (it cannot collide with a built-in key).
 * @param name - The preset's name
 */
export function userPresetValue(name: string): string {
  return `${USER_PRESET_PREFIX}${name}`;
}

/**
 * The name in a user preset's picker value, or null for any other value.
 * @param value - A picker value, e.g. 'user:Phonk car' or 'phonk'
 */
export function userPresetName(value: unknown): string | null {
  return isUserPresetValue(value) ? value.slice(USER_PRESET_PREFIX.length) : null;
}

/**
 * Load the user presets, sorted by name. A damaged entry (a bad name, damaged settings, a name
 * already used by an earlier entry) is skipped; past 50 the rest are ignored. Never throws.
 * @returns The presets
 */
export function loadUserPresets(): UserPreset[] {
  let raw: unknown;
  try {
    const serialized = localStorage.getItem(USER_PRESETS_STORAGE_KEY);
    raw = serialized ? JSON.parse(serialized) : [];
  } catch (err) {
    console.warn('[Equalizer] Failed to load the user presets:', err);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const presets: UserPreset[] = [];
  for (const entry of raw) {
    if (presets.length >= USER_PRESET_LIMIT) break;
    if (!entry || typeof entry !== 'object') continue;
    const name = validateName((entry as Record<string, unknown>).name);
    if (!name || presets.some((p) => sameName(p.name, name))) continue;
    const settings = validateEqualizerSettings((entry as Record<string, unknown>).settings);
    if (!settings) continue;
    presets.push(withName(name, settings));
  }
  return presets.sort(byName);
}

function store(presets: UserPreset[]): UserPreset[] {
  const sorted = [...presets].sort(byName);
  try {
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(sorted));
  } catch (err) {
    // The change still holds for this session.
    console.warn('[Equalizer] Failed to save the user presets:', err);
  }
  return sorted;
}

/**
 * Save `settings` under `name`. A name in use is refused unless `overwrite` is set; a new preset
 * past the limit of 50 is refused.
 * @param name - The name as typed (trimmed here)
 * @param settings - The full settings to keep (the active slot's)
 * @param options - `{ overwrite: true }` replaces a preset with the same name
 * @returns The presets after the save, or why it was refused
 */
export function saveUserPreset(
  name: string,
  settings: EqualizerSettings,
  { overwrite = false }: UserPresetWriteOptions = {},
): UserPresetResult {
  const valid = validateName(name);
  const clean = validateEqualizerSettings(settings);
  if (!valid || !clean) return { ok: false, reason: 'invalid' };
  const presets = loadUserPresets();
  const existing = presets.findIndex((p) => sameName(p.name, valid));
  if (existing >= 0 && !overwrite) return { ok: false, reason: 'taken' };
  if (existing < 0 && presets.length >= USER_PRESET_LIMIT) return { ok: false, reason: 'full' };
  const next = presets.filter((_, i) => i !== existing);
  next.push(withName(valid, clean));
  return { ok: true, presets: store(next) };
}

/**
 * Rename a preset. Its settings are kept. A new name used by another preset is refused unless
 * `overwrite` is set (that preset is then replaced); a change of case only is always allowed.
 * @param from - The current name
 * @param to - The new name as typed (trimmed here)
 * @param options - `{ overwrite: true }` replaces another preset with the new name
 * @returns The presets after the rename, or why it was refused
 */
export function renameUserPreset(
  from: string,
  to: string,
  { overwrite = false }: UserPresetWriteOptions = {},
): UserPresetResult {
  const valid = validateName(to);
  if (!valid) return { ok: false, reason: 'invalid' };
  const presets = loadUserPresets();
  const source = presets.find((p) => p.name === from);
  if (!source) return { ok: false, reason: 'missing' };
  const clash = presets.find((p) => p !== source && sameName(p.name, valid));
  if (clash && !overwrite) return { ok: false, reason: 'taken' };
  const next = presets.filter((p) => p !== source && p !== clash);
  next.push(withName(valid, source.settings));
  return { ok: true, presets: store(next) };
}

/**
 * Delete a preset (the panel asks first).
 * @param name - The preset's name
 * @returns The presets after the delete, or 'missing'
 */
export function deleteUserPreset(name: string): UserPresetResult {
  const presets = loadUserPresets();
  const next = presets.filter((p) => p.name !== name);
  if (next.length === presets.length) return { ok: false, reason: 'missing' };
  return { ok: true, presets: store(next) };
}
