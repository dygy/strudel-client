/**
 * The close-tab guard (spec 030 §2.5, tech §2.7): while the main output plays, closing the tab,
 * reloading or navigating away asks the browser's "Leave site?" question. While stopped, nothing asks.
 *
 * `isPlaying` reads the main scheduler only; the headphone preview is a separate scheduler and never
 * counts. A separate listener from the canvas cleanup and the emergency save: every `beforeunload`
 * listener runs, and cancelling the event doesn't stop the others.
 */

/** Install the guard on `win`. Returns the uninstall function. */
export function installCloseGuard(isPlaying: () => boolean, win: Window = window): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    let playing = false;
    try {
      playing = isPlaying();
    } catch (error: unknown) {
      console.warn('[performance] close guard could not read the scheduler', error);
    }
    if (!playing) return;
    event.preventDefault();
    // The legacy requirement (Chrome < 119, Safari): a non-undefined returnValue shows the prompt.
    event.returnValue = '';
  };
  win.addEventListener('beforeunload', onBeforeUnload);
  return () => win.removeEventListener('beforeunload', onBeforeUnload);
}
