/**
 * @strudel/mixer - DJ-style audio mixer with preview stream
 *
 * This package provides dual-stream audio mixing capabilities for Strudel,
 * enabling live coders to preview code changes on a separate audio output
 * before pushing them live.
 *
 * @module @strudel/mixer
 * @license AGPL-3.0-or-later
 */

export { AudioMixer } from './AudioMixer.mjs';
export { AudioStream } from './AudioStream.mjs';
export { TransitionMixer } from './TransitionMixer.mjs';
export { ErrorNotifier } from './ErrorNotifier.mjs';
export { KeyboardShortcutManager } from './KeyboardShortcutManager.mjs';
export { PreviewEngine } from './PreviewEngine.mjs';
export {
  TrackTransitionController,
  normalizeTransitionSettings,
  transitionStart,
  glideCps,
  DEFAULT_TRANSITION_SETTINGS,
  TRANSITION_LENGTHS,
  TRANSITION_SNAPS,
} from './TrackTransitionController.mjs';
export {
  buildTransition,
  transitionTiming,
  stripLocations,
  isOverlapping,
  TRANSITION_TYPES,
  OVERLAPPING_TYPES,
} from './transitions/buildTransition.mjs';
export { LoudnessMeter, computeTrim, applyTrim, trimFactorAt } from './transitions/loudness.mjs';
// Vinyl scratch control (spec 019): the DSP runs in the `scratch-processor` AudioWorklet.
export {
  ScratchDeck,
  SCRATCH_SECONDS_PER_TURN,
  SCRATCH_WHEEL_SECONDS_PER_NOTCH,
  SCRATCH_BUFFER_SECONDS,
  SCRATCH_MAX_MOTOR_RATE,
} from './scratch/ScratchDeck.mjs';
export { ScratchController, SCRATCH_DECKS, SCRATCH_SOURCES } from './scratch/ScratchController.mjs';
export {
  createMidiJog,
  decodeRelativeCC,
  detectRelativeEncoding,
  MIDI_JOG_STORAGE_KEY,
  MIDI_JOG_SECONDS_PER_TICK,
  MIDI_JOG_RELEASE_MS,
  MIDI_JOG_LEARN_TIMEOUT_MS,
  MIDI_JOG_ENCODINGS,
} from './scratch/midiJog.mjs';
export { loadScratchWorklet } from './scratch/scratchWorklet.mjs';
// Spec 023: the record's physics (shared by the worklet and the platter) and the track shift.
export {
  SCRATCH_BRAKE_SECONDS,
  SCRATCH_SPINUP_SECONDS,
  SCRATCH_HANDOVER_SECONDS,
  SCRATCH_SNAP_BEAT_CYCLES,
  SCRATCH_MIN_SHIFT_SECONDS,
  scratchSmoothStep,
  scratchBrakeRate,
  scratchSpinUpRate,
  scratchBeatSeconds,
  planScratchSpinUp,
  planScratchRelease,
  scratchReleaseRate,
  scratchBumpSeconds,
  scratchBumpDepth,
} from './scratch/scratchPhysics.mjs';
export {
  PatternOffset,
  ScratchHandOver,
  scratchShiftTime,
  scratchShiftArrival,
  scratchQueryTime,
  scratchMidNoteValue,
  scratchSoundingNotes,
} from './scratch/ScratchShift.mjs';
