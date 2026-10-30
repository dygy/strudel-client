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
export { SmoothTransitionManager } from './SmoothTransitionManager.mjs';
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
