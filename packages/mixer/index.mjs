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

export { PreviewEngine } from './PreviewEngine.mjs';
export {
  TrackTransitionController,
  normalizeTransitionSettings,
  transitionStart,
  glideCps,
  DEFAULT_TRANSITION_SETTINGS,
  TRANSITION_LENGTHS,
  TRANSITION_SNAPS,
  TRANSITION_TEMPOS,
  MANUAL_COMPLETE_AT,
  MANUAL_ABANDON_AT,
  MANUAL_RELEASE,
  HANDOVER_RELEASE_DELAY,
} from './TrackTransitionController.mjs';
export {
  buildTransition,
  transitionTiming,
  stripLocations,
  isOverlapping,
  TRANSITION_TYPES,
  OVERLAPPING_TYPES,
  MIX_SIDE_CONTROL,
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
// Spec 029: MIDI Learn for the Brake and Spin-up sliders.
export {
  createMidiFeel,
  ccToFeel,
  midiFeelConflict,
  readMidiFeelMappings,
  MIDI_FEEL_STORAGE_KEY,
  MIDI_FEEL_LEARN_TIMEOUT_MS,
  MIDI_FEEL_TARGETS,
  MIDI_FEEL_KEYS,
} from './scratch/midiFeel.mjs';
export { loadScratchWorklet } from './scratch/scratchWorklet.mjs';
// Spec 031: MIDI mapping for everything (note input, the shared control registry, the map engine).
export { createSharedMidiInputs, parseNote, parseControlChange } from './scratch/midiJog.mjs';
export {
  claimMidiLearn,
  sameMidiControl,
  cleanMidiControl,
  midiControlHolder,
  readMidiMapBindings,
  MIDI_CONTROL_KINDS,
} from './scratch/midiLearnShared.mjs';
export {
  createMidiMap,
  ccToUnit,
  pickup,
  buttonEdge,
  parseMidiMap,
  MIDI_MAP_STORAGE_KEY,
  MIDI_MAP_VERSION,
  MIDI_MAP_LEARN_TIMEOUT_MS,
  MIDI_MAP_LEARN_MESSAGES,
  MIDI_MAP_LEARN_WINDOW_MS,
  MIDI_MAP_PICKUP_TOLERANCE,
  MIDI_MAP_TARGET_KINDS,
  MIDI_MAP_EXPORT_FILENAME,
} from './midi/midiMap.mjs';
// Spec 031: speakers and headphones volume.
export {
  volumeGain,
  clampVolume,
  setVolume,
  createVolumeNode,
  readVolume,
  writeVolume,
  VOLUME_RAMP_SECONDS,
  SPEAKERS_VOLUME_STORAGE_KEY,
  HEADPHONES_VOLUME_STORAGE_KEY,
} from './volume.mjs';
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
  // Spec 025: the snap grid and the feel (brake, spin-up).
  SCRATCH_SNAP_GRID,
  SCRATCH_SNAP_GRIDS,
  SCRATCH_SNAP_GRID_DEFAULT,
  SCRATCH_FEEL_DEFAULTS,
  SCRATCH_FEEL_RANGES,
  SCRATCH_SPINUP_STRETCH_MIN,
  SCRATCH_SPINUP_STRETCH_MAX,
  sanitizeScratchFeel,
  sanitizeScratchSnapGrid,
  scratchSnapSeconds,
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
