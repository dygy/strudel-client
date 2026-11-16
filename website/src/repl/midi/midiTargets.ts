/**
 * The MIDI map's targets (spec 031 §2.1, tech §2.6): every live control a knob, fader or pad can
 * drive, bound to the action its on-screen control takes.
 *
 * - EQ bands, EQ on/off and A/B go through eqStore, the EQ panel's own state path: the slider moves,
 *   the value is saved into the active A/B slot, and a band set while the EQ is off is stored silently.
 * - Speakers volume (speakersVolume.ts) and headphones volume (the preview engine) ramp and persist.
 * - The crossfader is the crossfader runtime (crossfader.ts).
 * - Cue/Go is the set player's press (the set bar's button, Alt+Shift+N); Play/Stop and Update are the
 *   header's handlers; Performance mode is Alt+Shift+P's toggle.
 * - Next / Previous type steps the selected transition type through the list, wrapping.
 *
 * - Spec 032: the Master FX filter (CC 62–66 is the centre: off), Delay / Reverb / Beat-repeat / Brake
 *   (the hold kind: held while the pad or note is down, holder `midi:<targetId>`), Repeat length.
 *
 * The scratch jog and feel knobs keep their own Learn (specs 019, 029); they are not map targets.
 */
import type { AudioEqualizer } from '@strudel/equalizer';
import { EQ_GAIN_LIMIT } from '@strudel/equalizer';
import type { MidiMap, MidiMapTarget } from '@strudel/mixer';
import { activeEqSettings, setEqBand, toggleEq, toggleEqSlot } from '../eqStore';
import { getSpeakersVolume, setSpeakersVolume } from '../speakersVolume';
import { getHeadphonesVolume, setHeadphonesVolume, type HeadphonesVolumeEngine } from '../headphonesVolume';
import { TRANSITION_TYPE_OPTIONS, type TransitionType } from '../transitionSettings';
import type { Crossfader } from './crossfader';
import { masterFxRuntime, type MasterFxEffect, type MasterFxRuntime } from '../masterFx/masterFxRuntime';
import {
  MIDI_EQ_SOURCE,
  MIDI_TARGETS,
  MIDI_TARGET_IDS,
  midiEqBandSource,
  midiHolder,
  type MidiTargetMeta,
} from './midiTargetMeta';

export {
  EQ_BAND_COUNT,
  MIDI_EQ_SOURCE,
  MIDI_TARGETS,
  MIDI_TARGET_IDS,
  eqBandTargetId,
  midiEqBandSource,
  midiHolder,
  type MidiTargetGroup,
  type MidiTargetMeta,
} from './midiTargetMeta';

/** A band's gain (dB, ±24) as 0..1. */
export const bandGainToUnit = (db: number): number => (db + EQ_GAIN_LIMIT) / (2 * EQ_GAIN_LIMIT);

/** 0..1 as a band's gain, on the slider's 0.5 dB grid (CC 0 → −24, 127 → +24, 64 → 0). */
export const unitToBandGain = (v01: number): number => {
  const db = -EQ_GAIN_LIMIT + Math.min(1, Math.max(0, v01)) * 2 * EQ_GAIN_LIMIT;
  return Math.round(db * 2) / 2;
};

/** CC 62..66 (as 0..1) is the filter's centre detent: off. */
export const FILTER_DETENT: readonly [number, number] = [62 / 127, 66 / 127];

/** The filter knob (−100..100) as 0..1. */
export const filterToUnit = (position: number): number => (Math.max(-100, Math.min(100, position)) + 100) / 200;

/** 0..1 as the filter knob: CC 0 → −100, 127 → +100, 62–66 → 0 (off), whole steps. */
export const unitToFilter = (v01: number): number => {
  const v = Math.min(1, Math.max(0, Number.isFinite(v01) ? v01 : 0.5));
  if (v >= FILTER_DETENT[0] - 1e-9 && v <= FILTER_DETENT[1] + 1e-9) return 0;
  return Math.round(v * 200 - 100);
};

/** The type `direction` steps away from `current` in the list, wrapping at both ends. */
export function stepTransitionType(current: TransitionType, direction: 1 | -1): TransitionType {
  const list = TRANSITION_TYPE_OPTIONS;
  const index = list.indexOf(current);
  const from = index < 0 ? 0 : index;
  return list[(from + direction + list.length) % list.length];
}

export interface MidiTargetDeps {
  /** Every EQ the panel drives: the speakers' (main) and the headphones' (preview engine). */
  equalizers: () => AudioEqualizer[];
  /** The headphone preview engine, or null. */
  previewEngine: () => HeadphonesVolumeEngine | null;
  crossfader: Crossfader;
  /** The set player's press (Cue/Go); does nothing without a playing set. */
  cueGo: () => void;
  togglePlay: () => void;
  update: () => void;
  togglePerformance: () => void;
  /** The selected transition type, and its setter (settings.ts). */
  getTransitionType: () => TransitionType;
  setTransitionType: (type: TransitionType) => void;
  /** The target's name, shown when another Learn is refused because it holds the control. */
  label: (meta: MidiTargetMeta) => string;
  /** Spec 032: the Master FX runtime (default: the app's). */
  masterFx?: Pick<MasterFxRuntime, 'filter' | 'setFilter' | 'hold' | 'release' | 'stepRepeatLength'>;
}

/**
 * Spec 032 soft takeover for the Master FX filter (review 032 #2): every filter change that didn't come
 * from the filter's own MIDI control (the knob, All FX off from any path) makes that control pick up
 * again, so a CC near the old position can't jump the knob back. Returns the unsubscribe.
 */
export function watchFilterPickup(
  fx: Pick<MasterFxRuntime, 'subscribeFilter'>,
  map: Pick<MidiMap, 'notifyExternalChange'>,
): () => void {
  const own = midiHolder(MIDI_TARGET_IDS.masterFilter);
  return fx.subscribeFilter((_position, source) => {
    if (source !== own) map.notifyExternalChange(MIDI_TARGET_IDS.masterFilter);
  });
}

const HOLD_EFFECTS: Readonly<Record<string, MasterFxEffect>> = Object.freeze({
  [MIDI_TARGET_IDS.masterDelay]: 'delay',
  [MIDI_TARGET_IDS.masterReverb]: 'reverb',
  [MIDI_TARGET_IDS.masterRepeat]: 'repeat',
  [MIDI_TARGET_IDS.masterBrake]: 'brake',
});

/** The map's targets with their actions (fresh closures over `deps`). */
export function buildMidiTargets(deps: MidiTargetDeps): MidiMapTarget[] {
  const fx = deps.masterFx ?? masterFxRuntime;
  const action = (meta: MidiTargetMeta): Pick<MidiMapTarget, 'read' | 'write' | 'press' | 'down' | 'up'> => {
    if (meta.group === 'eq' && meta.labelParams) {
      const index = meta.labelParams.n - 1;
      return {
        read: () => bandGainToUnit(activeEqSettings().bands[index]?.gain ?? 0),
        write: (v) => {
          setEqBand(index, { gain: unitToBandGain(v) }, deps.equalizers(), midiEqBandSource(index));
        },
      };
    }
    const effect = HOLD_EFFECTS[meta.id];
    if (effect) {
      const holder = midiHolder(meta.id);
      return { down: () => void fx.hold(effect, holder), up: () => fx.release(effect, holder) };
    }
    switch (meta.id) {
      case MIDI_TARGET_IDS.masterFilter:
        return {
          read: () => filterToUnit(fx.filter.get()),
          write: (v) => fx.setFilter(unitToFilter(v), midiHolder(MIDI_TARGET_IDS.masterFilter)),
        };
      case MIDI_TARGET_IDS.masterRepeatLength:
        return { press: () => fx.stepRepeatLength() };
      case MIDI_TARGET_IDS.eqToggle:
        return { press: () => void toggleEq(deps.equalizers(), MIDI_EQ_SOURCE) };
      case MIDI_TARGET_IDS.eqAb:
        return { press: () => void toggleEqSlot(deps.equalizers(), MIDI_EQ_SOURCE) };
      case MIDI_TARGET_IDS.speakers:
        return { read: getSpeakersVolume, write: (v) => void setSpeakersVolume(v) };
      case MIDI_TARGET_IDS.headphones:
        return {
          read: () => getHeadphonesVolume(deps.previewEngine()),
          write: (v) => void setHeadphonesVolume(deps.previewEngine(), v),
        };
      case MIDI_TARGET_IDS.crossfader:
        return {
          read: () => deps.crossfader.getState().position,
          write: (v) => deps.crossfader.setPosition(v),
        };
      case MIDI_TARGET_IDS.cueGo:
        return { press: deps.cueGo };
      case MIDI_TARGET_IDS.playStop:
        return { press: deps.togglePlay };
      case MIDI_TARGET_IDS.update:
        return { press: deps.update };
      case MIDI_TARGET_IDS.nextType:
        return { press: () => deps.setTransitionType(stepTransitionType(deps.getTransitionType(), 1)) };
      case MIDI_TARGET_IDS.prevType:
        return { press: () => deps.setTransitionType(stepTransitionType(deps.getTransitionType(), -1)) };
      case MIDI_TARGET_IDS.performance:
        return { press: deps.togglePerformance };
      default:
        return {};
    }
  };
  return MIDI_TARGETS.map((meta) => ({ id: meta.id, kind: meta.kind, label: deps.label(meta), ...action(meta) }));
}
