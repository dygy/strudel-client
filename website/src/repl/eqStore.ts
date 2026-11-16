/**
 * The EQ panel's state path (spec 031 tech §2.6): the A/B slots (spec 026) and the setters the EQ
 * panel's band sliders, on/off button and A/B buttons use, lifted out of EqualizerUI so a MIDI
 * control goes exactly where the slider goes, whether the panel is mounted or not:
 * - the value is stored into the active slot and saved (and through it the key the EQs load at start);
 * - each EQ gets it through its own setter, which keeps "EQ off stays silent": setBand always stores
 *   the value and only applies it while the EQ is on;
 * - every listener (the mounted panel, the MIDI map's pickup reset) hears the change with its source.
 *
 * The slots are read from localStorage on first use and again whenever the panel mounts.
 */
import {
  type AudioEqualizer,
  type EqualizerSettings,
  type EqualizerSlotName,
  type EqualizerSlots,
  EQ_GAIN_LIMIT,
  EQ_Q_RANGE,
  getDefaultSettings,
  loadEqualizerSlots,
  saveEqualizerSlots,
  switchEqualizerSlot,
  updateActiveEqualizerSlot,
} from '@strudel/equalizer';

/** One band's change: its gain (dB) and/or Q. */
export interface EqBandUpdate {
  gain?: number;
  Q?: number;
}

/** Who made a change: the panel instance's token, or a MIDI source such as `midi:eq.band.3`. */
export type EqChangeSource = string;
export type EqSlotsListener = (slots: EqualizerSlots, source: EqChangeSource, previous: EqualizerSlots) => void;

let slots: EqualizerSlots | null = null;
const listeners = new Set<EqSlotsListener>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Keeps a band update inside the range the audio graph accepts and the saved-settings loader
 * validates (an out-of-range save would make the EQ start flat). Non-finite values are dropped.
 */
export function clampBandUpdate({ gain, Q }: EqBandUpdate): EqBandUpdate {
  const next: EqBandUpdate = {};
  if (gain !== undefined && Number.isFinite(gain)) next.gain = clamp(gain, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT);
  if (Q !== undefined && Number.isFinite(Q)) next.Q = clamp(Q, EQ_Q_RANGE.min, EQ_Q_RANGE.max);
  return next;
}

/** The slots, read from storage on first use. */
export function getEqSlots(): EqualizerSlots {
  if (!slots) slots = loadEqualizerSlots();
  return slots;
}

/** Read the slots from storage again (the panel does on mount). No listener is called. */
export function reloadEqSlots(): EqualizerSlots {
  slots = loadEqualizerSlots();
  return slots;
}

/** The active slot's settings, with the spec 020 fields defaulted when an old save lacks them. */
export function activeEqSettings(): EqualizerSettings {
  const current = getEqSlots();
  const settings = current[current.active];
  const fallback = getDefaultSettings();
  return {
    ...settings,
    lowCut: settings.lowCut ?? fallback.lowCut,
    highCut: settings.highCut ?? fallback.highCut,
    outputGain: settings.outputGain ?? 0,
  };
}

/** Save `next` as the slots and tell every listener. */
export function replaceEqSlots(next: EqualizerSlots, source: EqChangeSource): void {
  const previous = getEqSlots();
  slots = next;
  saveEqualizerSlots(next);
  for (const listener of [...listeners]) {
    try {
      listener(next, source, previous);
    } catch (error: unknown) {
      console.warn('[eqStore] listener failed:', error);
    }
  }
}

/** Save `settings` into the active slot only (an edit never touches the other slot). */
export function persistActiveEqSettings(settings: EqualizerSettings, source: EqChangeSource): void {
  replaceEqSlots(updateActiveEqualizerSlot(getEqSlots(), settings), source);
}

/**
 * The one band setter (the panel's sliders, desktop and compact, and MIDI): clamps the update, sets
 * it on every EQ (stored always, heard only while on), makes the preset Custom and saves. Returns
 * the new active settings, or null when nothing changed (no such band, nothing valid).
 */
export function setEqBand(
  index: number,
  update: EqBandUpdate,
  equalizers: readonly AudioEqualizer[],
  source: EqChangeSource,
): EqualizerSettings | null {
  const current = activeEqSettings();
  if (!Number.isInteger(index) || index < 0 || index >= current.bands.length) return null;
  const next = clampBandUpdate(update);
  if (next.gain === undefined && next.Q === undefined) return null;
  const bands = [...current.bands];
  bands[index] = { ...bands[index], ...next };
  equalizers.forEach((eq) => eq.setBand(index, next));
  const settings = { ...current, bands, preset: 'custom' };
  persistActiveEqSettings(settings, source);
  return settings;
}

/** The EQ on or off (the panel's button): every EQ, saved into the active slot. */
export function setEqEnabled(
  on: boolean,
  equalizers: readonly AudioEqualizer[],
  source: EqChangeSource,
): EqualizerSettings {
  const settings = { ...activeEqSettings(), isEnabled: on };
  equalizers.forEach((eq) => eq.setEnabled(on));
  persistActiveEqSettings(settings, source);
  return settings;
}

/** Flip the EQ on/off. */
export function toggleEq(equalizers: readonly AudioEqualizer[], source: EqChangeSource): EqualizerSettings {
  return setEqEnabled(!getEqSlots()[getEqSlots().active].isEnabled, equalizers, source);
}

/**
 * Apply whole settings through the setters, which glide: no click. Switching on: the values first
 * (stored silently while off), then on, so the switch-on crossfade brings the new curve in.
 * Switching off: off first, then the values (stored, not heard).
 */
export function glideEqualizersTo(settings: EqualizerSettings, equalizers: readonly AudioEqualizer[]): void {
  const fallback = getDefaultSettings();
  equalizers.forEach((eq) => {
    if (!settings.isEnabled) eq.setEnabled(false);
    settings.bands.forEach((band, index) => eq.setBand(index, { gain: band.gain, Q: band.Q }));
    eq.setLowCut({ ...(settings.lowCut ?? fallback.lowCut!) });
    eq.setHighCut({ ...(settings.highCut ?? fallback.highCut!) });
    eq.setOutputGain(settings.outputGain ?? 0);
    if (settings.isEnabled) eq.setEnabled(true);
  });
}

/**
 * Spec 026 A/B: make `slot` the active one, gliding every EQ to its settings, and save. Returns its
 * settings, or null when it already was active.
 */
export function switchEqSlot(
  slot: EqualizerSlotName,
  equalizers: readonly AudioEqualizer[],
  source: EqChangeSource,
): EqualizerSettings | null {
  const current = getEqSlots();
  if (slot === current.active) return null;
  const next = switchEqualizerSlot(current, slot);
  if (next === current) return null;
  glideEqualizersTo(next[slot], equalizers);
  replaceEqSlots(next, source);
  return next[slot];
}

/** A ↔ B. */
export function toggleEqSlot(equalizers: readonly AudioEqualizer[], source: EqChangeSource): EqualizerSettings | null {
  return switchEqSlot(getEqSlots().active === 'A' ? 'B' : 'A', equalizers, source);
}

/** Hear every change to the slots. Returns the unsubscribe. */
export function subscribeEqSlots(listener: EqSlotsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget the cached slots and the listeners (module state survives isolate:false). */
export function resetEqStoreForTests(): void {
  slots = null;
  listeners.clear();
}
