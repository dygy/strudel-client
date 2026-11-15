/**
 * The performance view's key (spec 030 §2.1, tech §2.4): Alt+Shift+P opens and closes the view
 * anywhere in the REPL, the code editor included.
 *
 * - Matched by `event.code` (`KeyP`): on macOS, Option+Shift+P gives `event.key === '∏'`.
 * - Capture phase on `document`, with preventDefault and stopPropagation, so no character reaches
 *   CodeMirror.
 * - A held key auto-repeats: only the first keydown counts.
 * - Never inert: the view works signed out and in the read-only admin view.
 *
 * Modelled on sets/setShortcut.ts; installed once from ReplEditor.
 */

/** Whether `event` is the performance key (Alt+Shift+P, no Ctrl or Cmd). */
export function isPerformanceKey(
  event: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return event.code === 'KeyP' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey;
}

/** Install the key on `doc`. Returns the uninstall function. */
export function installPerformanceShortcut(onPress: () => void, doc: Document = document): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isPerformanceKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    onPress();
  };
  doc.addEventListener('keydown', onKeyDown, true);
  return () => doc.removeEventListener('keydown', onKeyDown, true);
}
