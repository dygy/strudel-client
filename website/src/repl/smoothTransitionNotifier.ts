import i18n from '../i18n/i18n';
import { toastActions } from '../stores/toastStore';

/**
 * SmoothTransitionManager (packages/mixer) reports a failed transition by dispatching this
 * window event; it restores the volume and the REPL falls back to an instant switch. This
 * turns the event into something the user can see.
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
    const detail = (event as CustomEvent<{ error?: string }>).detail;
    console.warn('[SmoothTransition] transition failed, switched without a fade:', detail?.error);
    warn(translate('settings:smoothTransitionFailed'), undefined, undefined, 'smooth-transition-error');
  };

  window.addEventListener(SMOOTH_TRANSITION_ERROR_EVENT, onError);
  return () => window.removeEventListener(SMOOTH_TRANSITION_ERROR_EVENT, onError);
}
