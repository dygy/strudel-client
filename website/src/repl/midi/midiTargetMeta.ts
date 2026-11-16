/**
 * The MIDI map's targets as data (spec 031 §2.1): id, group, kind and name key, in panel order. Pure,
 * so the panel and the scratch section can name a target without the REPL's wiring (midiTargets.ts).
 */
import type { MidiMapTargetKind } from '@strudel/mixer';
import type { SettingsTranslations } from '@src/i18n';

export type MidiTargetGroup = 'eq' | 'mixer' | 'masterFx' | 'set' | 'transport' | 'transition' | 'view';

/** What the panel lists for a target: its group, kind and name (a `settings:` key). */
export interface MidiTargetMeta {
  id: string;
  group: MidiTargetGroup;
  kind: MidiMapTargetKind;
  labelKey: keyof SettingsTranslations;
  /** `{{n}}` of a band's name. */
  labelParams?: { n: number };
}

export const EQ_BAND_COUNT = 10;
export const eqBandTargetId = (index: number): string => `eq.band.${index + 1}`;
/** eqStore's source for a MIDI write to band `index` (its own pickup isn't reset by it). */
export const midiEqBandSource = (index: number): string => `midi:${eqBandTargetId(index)}`;
export const MIDI_EQ_SOURCE = 'midi';
/** Spec 032: the Master FX holder a MIDI hold target uses (`midi:<targetId>`). */
export const midiHolder = (targetId: string): string => `midi:${targetId}`;

export const MIDI_TARGET_IDS = Object.freeze({
  eqToggle: 'eq.toggle',
  eqAb: 'eq.ab',
  speakers: 'mixer.speakers',
  headphones: 'mixer.headphones',
  crossfader: 'mixer.crossfader',
  // Spec 032: Master FX.
  masterFilter: 'masterFx.filter',
  masterDelay: 'masterFx.delay',
  masterReverb: 'masterFx.reverb',
  masterRepeat: 'masterFx.repeat',
  masterBrake: 'masterFx.brake',
  masterRepeatLength: 'masterFx.repeatLength',
  cueGo: 'set.cueGo',
  playStop: 'transport.playStop',
  update: 'transport.update',
  nextType: 'transition.next',
  prevType: 'transition.prev',
  performance: 'view.performance',
});

/** Every map target in panel order (§2.1). */
export const MIDI_TARGETS: readonly MidiTargetMeta[] = Object.freeze([
  ...Array.from(
    { length: EQ_BAND_COUNT },
    (_, index): MidiTargetMeta => ({
      id: eqBandTargetId(index),
      group: 'eq',
      kind: 'continuous',
      labelKey: 'midiTargetBand',
      labelParams: { n: index + 1 },
    }),
  ),
  { id: MIDI_TARGET_IDS.eqToggle, group: 'eq', kind: 'button', labelKey: 'midiTargetEqToggle' },
  { id: MIDI_TARGET_IDS.eqAb, group: 'eq', kind: 'button', labelKey: 'midiTargetEqAb' },
  { id: MIDI_TARGET_IDS.speakers, group: 'mixer', kind: 'continuous', labelKey: 'midiTargetSpeakers' },
  { id: MIDI_TARGET_IDS.headphones, group: 'mixer', kind: 'continuous', labelKey: 'midiTargetHeadphones' },
  { id: MIDI_TARGET_IDS.crossfader, group: 'mixer', kind: 'continuous', labelKey: 'midiTargetCrossfader' },
  // Spec 032 §2.7: the filter (centre detent), the four holds, and the repeat length.
  { id: MIDI_TARGET_IDS.masterFilter, group: 'masterFx', kind: 'continuous', labelKey: 'midiTargetMasterFilter' },
  { id: MIDI_TARGET_IDS.masterDelay, group: 'masterFx', kind: 'hold', labelKey: 'midiTargetMasterDelay' },
  { id: MIDI_TARGET_IDS.masterReverb, group: 'masterFx', kind: 'hold', labelKey: 'midiTargetMasterReverb' },
  { id: MIDI_TARGET_IDS.masterRepeat, group: 'masterFx', kind: 'hold', labelKey: 'midiTargetMasterRepeat' },
  { id: MIDI_TARGET_IDS.masterBrake, group: 'masterFx', kind: 'hold', labelKey: 'midiTargetMasterBrake' },
  {
    id: MIDI_TARGET_IDS.masterRepeatLength,
    group: 'masterFx',
    kind: 'button',
    labelKey: 'midiTargetMasterRepeatLength',
  },
  { id: MIDI_TARGET_IDS.cueGo, group: 'set', kind: 'button', labelKey: 'midiTargetCueGo' },
  { id: MIDI_TARGET_IDS.playStop, group: 'transport', kind: 'button', labelKey: 'midiTargetPlayStop' },
  { id: MIDI_TARGET_IDS.update, group: 'transport', kind: 'button', labelKey: 'midiTargetUpdate' },
  { id: MIDI_TARGET_IDS.nextType, group: 'transition', kind: 'button', labelKey: 'midiTargetNextType' },
  { id: MIDI_TARGET_IDS.prevType, group: 'transition', kind: 'button', labelKey: 'midiTargetPrevType' },
  { id: MIDI_TARGET_IDS.performance, group: 'view', kind: 'button', labelKey: 'midiTargetPerformance' },
]);
