/**
 * The set's next key (spec 022 §2.3, tech §2.3): Alt+Shift+N does what the set bar's Cue/Go button
 * does, anywhere in the REPL, the code editor included.
 *
 * - Matched by `event.code` (`KeyN`): on macOS, Option+Shift+N gives `event.key === '˜'`.
 * - Capture phase on `document`, with preventDefault and stopPropagation, so no character reaches
 *   CodeMirror (unlike the scratch keys, it works while typing in the editor).
 * - A held key auto-repeats: only the first keydown counts.
 * - Inert while `enabled()` is false (signed out, read-only, no set playing): the event is left alone.
 *
 * Installed once, like installScratchShortcut, so a re-render never doubles it.
 */

/** Whether `event` is the set's next key (Alt+Shift+N, no Ctrl or Cmd). */
export function isSetNextKey(
  event: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return event.code === 'KeyN' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey;
}

export interface SetShortcutOptions {
  /** Read on every keydown. False: the key does nothing and the event is not touched. */
  enabled: () => boolean;
  doc?: Document;
}

/** Install the next key on `doc`. Returns the uninstall function. */
export function installSetShortcut(onPress: () => void, { enabled, doc = document }: SetShortcutOptions): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isSetNextKey(event) || !enabled()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    onPress();
  };
  doc.addEventListener('keydown', onKeyDown, true);
  return () => doc.removeEventListener('keydown', onKeyDown, true);
}
