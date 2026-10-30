import i18n from '../i18n/i18n';
import { toastActions } from '../stores/toastStore';

/**
 * SmoothTransitionManager (packages/mixer) reports a failed transition by dispatching this
 * window event and restores the volume. Two cases: the transition itself failed and the REPL
 * fell back to an instant switch, or (`detail.evaluateFailed`) the new track's code failed to
 * evaluate after the old track was stopped, so nothing is playing. This turns the event into
 * something the user can see.
 */
export const SMOOTH_TRANSITION_ERROR_EVENT = 'smooth-transition-transition-error';

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
      // The new track's code is broken: the old track was stopped and nothing is playing.
      console.warn('[SmoothTransition] the new track failed to evaluate:', detail?.error);
      warn(
        translate('settings:smoothTransitionNewTrackFailed'),
        undefined,
        undefined,
        'smooth-transition-new-track-error',
      );
      return;
    }
    console.warn('[SmoothTransition] transition failed, switched without a fade:', detail?.error);
    warn(translate('settings:smoothTransitionFailed'), undefined, undefined, 'smooth-transition-error');
  };

  window.addEventListener(SMOOTH_TRANSITION_ERROR_EVENT, onError);
  return () => window.removeEventListener(SMOOTH_TRANSITION_ERROR_EVENT, onError);
}
