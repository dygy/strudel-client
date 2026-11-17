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
// Spec 032: Master FX (filter, delay/reverb throws, beat-repeat) for superdough's master insert.
export {
  MasterFx,
  makeReverbImpulse,
  MASTER_FX_SEND_RAMP_SECONDS,
  MASTER_FX_FILTER_FADE_SECONDS,
  MASTER_FX_CUTOFF_TAU,
  MASTER_FX_DELAY_TIME_TAU,
  MASTER_FX_LEVEL_RAMP_SECONDS,
  MASTER_FX_REVERB_SWAP_SECONDS,
  MASTER_FX_REVERB_DEBOUNCE_MS,
  MASTER_FX_STOP_FADE_SECONDS,
  MASTER_FX_STOP_RESTORE_MS,
  MASTER_FX_MAX_DELAY_SECONDS,
  MASTER_FX_WORKLET_SWAP_SECONDS,
  MASTER_FX_WORKLET_SETTLE_SECONDS,
  MASTER_FX_DEFAULT_CPS,
} from './masterfx/MasterFx.mjs';
export {
  filterParams,
  clampFilterPosition,
  MASTER_FX_FILTER_MIN,
  MASTER_FX_FILTER_MAX,
  MASTER_FX_FILTER_DEAD_ZONE,
  MASTER_FX_LP_OPEN_HZ,
  MASTER_FX_LP_CLOSED_HZ,
  MASTER_FX_HP_OPEN_HZ,
  MASTER_FX_HP_CLOSED_HZ,
  MASTER_FX_Q_FLAT,
  MASTER_FX_Q_RANGE,
} from './masterfx/filterCurve.mjs';
export {
  MASTER_FX_DELAY_FRACTIONS,
  MASTER_FX_REPEAT_LENGTHS,
  MASTER_FX_RANGES,
  MASTER_FX_DEFAULTS,
  MASTER_FX_STORAGE_KEY,
  sanitizeMasterFxSettings,
  nextRepeatLength,
} from './masterfx/masterFxSettings.mjs';
export { loadBeatRepeatWorklet, BEAT_REPEAT_PROCESSOR } from './masterfx/beatRepeatLoader.mjs';
export {
  createRollState,
  processBlock as processRollBlock,
  rollStart,
  rollLength,
  rollStop,
  rollActive,
  BEAT_REPEAT_RING_SECONDS,
  BEAT_REPEAT_FADE_SECONDS,
  BEAT_REPEAT_MIN_LENGTH_FRAMES,
} from './masterfx/beatRepeatCore.mjs';
// Spec 033: the loudness meter (LUFS M/S/I, LRA, true peak, peak/RMS, over events) in the
// `loudness-meter-processor` AudioWorklet. `LufsMeter`, because `LoudnessMeter` above is spec 017's.
export { LufsMeter, LUFS_METER_NODE_OPTIONS, LUFS_METER_INPUTS } from './meter/LoudnessMeter.mjs';
export { loadLoudnessWorklet, LOUDNESS_PROCESSOR } from './meter/loudnessLoader.mjs';
export {
  LoudnessMeterCore,
  kWeightingCoefficients,
  powerToLufs,
  TRUE_PEAK_FIR,
  LOUDNESS_SUBBLOCK_SECONDS,
  LOUDNESS_MOMENTARY_BLOCKS,
  LOUDNESS_SHORT_TERM_BLOCKS,
  LOUDNESS_ABSOLUTE_GATE,
  LOUDNESS_RELATIVE_GATE,
  LOUDNESS_LRA_RELATIVE_GATE,
  LOUDNESS_LRA_MIN_SECONDS,
  LOUDNESS_HISTOGRAM,
  LOUDNESS_PEAK_WINDOW_SECONDS,
  LOUDNESS_OVER_MERGE_SECONDS,
  LOUDNESS_TRUE_PEAK_LIMIT_DBTP,
  LOUDNESS_LIMITER_CEILING_DBFS,
  LOUDNESS_OVER_REASONS,
} from './meter/loudnessCore.mjs';
