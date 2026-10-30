import i18n from '../i18n/i18n';
import { toastActions } from '../stores/toastStore';

/**
 * TrackTransitionController (packages/mixer) reports a failed track switch with this window
 * event. Two cases:
 * - `detail.evaluateFailed`: the new track's code is broken. The old track was never touched
 *   and keeps playing (spec 017 §2.6); the editor shows the code error.
 * - anything else (e.g. the audio output stuck suspended): the REPL falls back to an instant
 *   switch without a transition.
 * This turns the event into something the user can see.
 */
export const SMOOTH_TRANSITION_ERROR_EVENT = 'track-transition-error';

export interface SmoothTransitionNotifierDeps {
  translate?: (key: string) => string;
  warn?: (title: string, message?: string, duration?: number, customId?: string) => void;
}

/** Start showing a warning for failed transitions. Returns a function that stops it. */
export function listenForSmoothTransitionErrors(deps: SmoothTransitionNotifierDeps = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const translate = deps.translate ?? ((key: string) => i18n.t(key));
  const warn = deps.warn ?? toastActions.warning;

  const onError = (event: Event) => {
    const detail = (event as CustomEvent<{ error?: string; evaluateFailed?: boolean }>).detail;
    if (detail?.evaluateFailed) {
      console.warn('[TrackTransition] the new track failed to evaluate; the old one keeps playing:', detail?.error);
      warn(translate('settings:transitionNewTrackFailed'), undefined, undefined, 'smooth-transition-new-track-error');
      return;
    }
    console.warn('[TrackTransition] transition failed, switched without one:', detail?.error);
    warn(translate('settings:smoothTransitionFailed'), undefined, undefined, 'smooth-transition-error');
  };

  window.addEventListener(SMOOTH_TRANSITION_ERROR_EVENT, onError);
  return () => window.removeEventListener(SMOOTH_TRANSITION_ERROR_EVENT, onError);
}
