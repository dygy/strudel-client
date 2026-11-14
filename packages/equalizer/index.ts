export {
  AudioEqualizer,
  EQ_GAIN_LIMIT,
  EQ_Q_RANGE,
  LOW_CUT_RANGE,
  HIGH_CUT_RANGE,
  OUTPUT_GAIN_RANGE,
  DEFAULT_LOW_CUT_FREQUENCY,
  DEFAULT_HIGH_CUT_FREQUENCY,
  LOW_CUT_OFF_FREQUENCY,
  LIMITER,
  ANALYSER_TAP,
} from './AudioEqualizer.js';
export type { EqualizerState, BandUpdate, CutConfig, CutUpdate, AnalyserTap } from './AudioEqualizer.js';
export { EQUALIZER_PRESETS, EQUALIZER_PRESET_FAMILIES } from './presets.js';
export type { EqualizerPreset, EqualizerPresetGroup, EqualizerPresetFamily } from './presets.js';
export { describeSettings, EQUALIZER_REGIONS, DESCRIBE_REGION_THRESHOLD_DB } from './describe.js';
export type { EqualizerRegion, DescribeSettingsInput, SettingsDescription } from './describe.js';
export { generateLogFrequencies, frequencyToX, gainToY, formatFrequency } from './utils.js';
export {
  BUTTERWORTH_Q,
  BUTTERWORTH_Q_DB,
  bandType,
  biquadMagnitude,
  equalizerResponseDb,
  pinkNoiseLoudnessDb,
} from './response.js';
export type { CutSettings, ResponseSettings, ResponseFilterType } from './response.js';
export {
  parseEqProfile,
  resolveEqProfile,
  matchingPreset,
  sameEqSettings,
  EQ_PROFILE_VERSION,
  EQ_PROFILE_FREQUENCIES,
  EQ_PROFILE_TEXT_LIMIT,
} from './profile.js';
export type {
  EqProfile,
  EqProfileBand,
  EqProfileParseResult,
  ResolvedEqProfile,
  CurrentEqSettings,
} from './profile.js';
export {
  saveEqualizerSettings,
  loadEqualizerSettings,
  getDefaultSettings,
  applyEqualizerSettings,
  validateEqualizerSettings,
} from './persistence.js';
export type { EqualizerSettings, BandSettings } from './persistence.js';
export {
  EQ_SLOTS_STORAGE_KEY,
  loadEqualizerSlots,
  saveEqualizerSlots,
  createEqualizerSlots,
  switchEqualizerSlot,
  updateActiveEqualizerSlot,
  copyActiveEqualizerSlot,
  otherEqualizerSlot,
} from './slots.js';
export type { EqualizerSlots, EqualizerSlotName } from './slots.js';
