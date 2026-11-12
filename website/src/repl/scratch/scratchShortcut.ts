/**
 * The scratch shortcut (spec 019 2.4, tech §2.6): hold Alt+Shift+← to pull the record back,
 * Alt+Shift+→ to push it forwards, at normal speed. Letting go of the arrow, Alt or Shift, or the
 * window losing focus, lets go of the record.
 *
 * Not handled while focus is in the code editor or a text field, so the editor's word selection
 * (Alt+Shift+←/→ on macOS) keeps working there (owner decision, 2026-11-12).
 *
 * The listeners are installed once, not inside the REPL's per-render keydown effect, because the
 * held key has to survive re-renders.
 */

/** The keys hold the record as the 'key' source: a pointer let go elsewhere doesn't drop it. */
export interface ScratchShortcutTarget {
  grab(source: 'key'): unknown;
  setMotor(rate: number, source: 'key'): void;
  release(source: 'key'): void;
}

const DIRECTION: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** Focus is where typing happens: the code editor, an input, a textarea or other editable text. */
export function isTypingTarget(element: Element | null | undefined): boolean {
  if (!element || typeof (element as HTMLElement).closest !== 'function') return false;
  if (element.closest('.cm-editor')) return true;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean((element as HTMLElement).isContentEditable);
}

/** Installs the shortcut on `doc` and `win`. Returns the uninstall function. */
export function installScratchShortcut(
  target: ScratchShortcutTarget,
  { doc = document, win = window }: { doc?: Document; win?: Window } = {},
): () => void {
  // The arrow being held, or null.
  let held: string | null = null;

  const letGo = () => {
    if (held === null) return;
    held = null;
    target.release('key');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const direction = DIRECTION[event.key];
    if (direction === undefined) return;
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (held === null && (isTypingTarget(doc.activeElement) || isTypingTarget(event.target as Element | null))) {
      return;
    }
    event.preventDefault();
    // Auto-repeat: one grab per press.
    if (event.repeat || held === event.key) return;
    if (held === null) target.grab('key');
    held = event.key;
    target.setMotor(direction, 'key');
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (held === null) return;
    if (event.key === held || event.key === 'Alt' || event.key === 'Shift') letGo();
  };

  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', letGo);

  return () => {
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keyup', onKeyUp);
    win.removeEventListener('blur', letGo);
    letGo();
  };
}
