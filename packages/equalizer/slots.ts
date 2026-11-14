/**
 * A/B slots (spec 026): two complete EQ settings, A and B, one of them active.
 *
 * Stored under `strudel-eq-slots` as `{ active, A, B }`. The legacy key (`strudel-equalizer-settings`,
 * persistence.ts) keeps holding the active slot: saveEqualizerSlots writes it too, so the code that
 * reads only the legacy key (mainEqualizer at install, PreviewEngine) gets the active settings.
 * That is the only change to how settings are written.
 *
 * Pure apart from localStorage: switching, copying and editing return new slots; nothing here
 * touches an AudioEqualizer (the panel applies the active slot to both EQs).
 */
import {
  getDefaultSettings,
  loadEqualizerSettings,
  saveEqualizerSettings,
  validateEqualizerSettings,
  type EqualizerSettings,
} from './persistence.js';

/** A slot's name. */
export type EqualizerSlotName = 'A' | 'B';

/** Both slots and which one is active (the one heard and edited). */
export interface EqualizerSlots {
  active: EqualizerSlotName;
  A: EqualizerSettings;
  B: EqualizerSettings;
}

/** The localStorage key of the slots. */
export const EQ_SLOTS_STORAGE_KEY = 'strudel-eq-slots';

const SLOT_NAMES: readonly EqualizerSlotName[] = ['A', 'B'];

/** A deep copy of settings, so two slots never share band or cut objects. */
const cloneSettings = (settings: EqualizerSettings): EqualizerSettings => JSON.parse(JSON.stringify(settings));

/**
 * The other slot's name.
 * @param name - 'A' or 'B'
 * @returns 'B' for 'A', 'A' for 'B'
 */
export function otherEqualizerSlot(name: EqualizerSlotName): EqualizerSlotName {
  return name === 'A' ? 'B' : 'A';
}

/**
 * Slots that hold `settings` in both A and B, with A active: the start for a device with only
 * legacy settings (or none).
 * @param settings - The settings both slots start from
 */
export function createEqualizerSlots(settings: EqualizerSettings): EqualizerSlots {
  return { active: 'A', A: cloneSettings(settings), B: cloneSettings(settings) };
}

/**
 * Load the slots. Each slot is validated like saved settings (validateEqualizerSettings); a damaged
 * slot becomes a copy of the other one, or the defaults when both are damaged. With no slots saved
 * (or unreadable ones), the legacy settings fill both A and B, with A active (or the defaults when
 * there are none). Never returns null.
 *
 * A repair (a damaged slot, an unknown active slot, an unreadable record) or a migration from the
 * legacy settings is saved at once through saveEqualizerSlots, which also writes the active slot to
 * the legacy key: mainEqualizer and PreviewEngine read only that key at install, so every reader
 * hears the same settings from the first load, not only once the panel opens. With nothing saved at
 * all nothing is written. A storage that refuses the write is logged, not raised.
 * @returns The slots
 */
export function loadEqualizerSlots(): EqualizerSlots {
  let raw: unknown = null;
  let unreadable = false;
  try {
    const serialized = localStorage.getItem(EQ_SLOTS_STORAGE_KEY);
    raw = serialized ? JSON.parse(serialized) : null;
    unreadable = !!serialized && (!raw || typeof raw !== 'object');
  } catch (err) {
    console.warn('[Equalizer] Failed to load the A/B slots:', err);
    unreadable = true;
  }
  if (!raw || typeof raw !== 'object') {
    const legacy = loadEqualizerSettings();
    const slots = createEqualizerSlots(legacy ?? getDefaultSettings());
    if (legacy || unreadable) saveEqualizerSlots(slots);
    return slots;
  }
  const record = raw as Record<string, unknown>;
  const active: EqualizerSlotName = record.active === 'B' ? 'B' : 'A';
  const A = record.A === undefined ? null : validateEqualizerSettings(record.A);
  const B = record.B === undefined ? null : validateEqualizerSettings(record.B);
  const slots =
    !A && !B
      ? { ...createEqualizerSlots(getDefaultSettings()), active }
      : { active, A: A ?? cloneSettings(B!), B: B ?? cloneSettings(A!) };
  if (!A || !B || record.active !== active) saveEqualizerSlots(slots);
  return slots;
}

/**
 * Save the slots, and the active slot under the legacy key (so code that reads only
 * loadEqualizerSettings sees what is heard). A storage that throws is logged, not raised.
 * @param slots - Both slots and the active one
 */
export function saveEqualizerSlots(slots: EqualizerSlots): void {
  try {
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify(slots));
  } catch (err) {
    console.warn('[Equalizer] Failed to save the A/B slots:', err);
  }
  saveEqualizerSettings(slots[slots.active]);
}

/**
 * The slots with `name` active. The other slot keeps its settings unchanged.
 * @param slots - The slots now
 * @param name - The slot to make active
 */
export function switchEqualizerSlot(slots: EqualizerSlots, name: EqualizerSlotName): EqualizerSlots {
  if (!SLOT_NAMES.includes(name)) return slots;
  return { ...slots, active: name };
}

/**
 * The slots with the active slot replaced by `settings` (an edit only ever changes the active slot).
 * @param slots - The slots now
 * @param settings - The active slot's new settings
 */
export function updateActiveEqualizerSlot(slots: EqualizerSlots, settings: EqualizerSettings): EqualizerSlots {
  return { ...slots, [slots.active]: cloneSettings(settings) };
}

/**
 * Copy the active slot into the other one (Copy A→B while A is active, B→A while B is). The active
 * slot, and so the sound, does not change.
 * @param slots - The slots now
 */
export function copyActiveEqualizerSlot(slots: EqualizerSlots): EqualizerSlots {
  return { ...slots, [otherEqualizerSlot(slots.active)]: cloneSettings(slots[slots.active]) };
}
