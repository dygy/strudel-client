/**
 * The listening-EQ recommendation of the code the speakers are playing (spec 024).
 *
 * useReplContext calls `playingCodeEvaluated(code)` from the main repl's afterEval (an evaluate that
 * succeeded: Play, Update, Ctrl+Enter, any track switch) and `playingStopped()` from onToggle(false),
 * the same two places trackSwitch labels what is playing. So the EQ panel shows what is playing, not
 * the editor buffer mid-edit, and a failed evaluate keeps the playing track's recommendation, as the
 * music does. Nothing here touches the EQ: Apply in the panel does.
 */
import { parseEqProfile, type EqProfile } from '@strudel/equalizer';

let profile: EqProfile | null = null;
/** The profile line last read (null: none), so an unchanged line keeps the same object and warns once. */
let heldLine: string | null = null;
const listeners = new Set<() => void>();

const set = (next: EqProfile | null, line: string | null) => {
  heldLine = line;
  if (next === profile) return;
  profile = next;
  listeners.forEach((listener) => listener());
};

/** The main repl now plays `code`: read its `// @eq-profile` line. Never throws. */
export function playingCodeEvaluated(code: string): void {
  try {
    const result = parseEqProfile(code);
    if (result.line !== null && result.line === heldLine) return; // the same line: same profile, warned already
    if (result.warning) console.warn(`[EQ profile] ${result.warning}`);
    set(result.profile, result.line);
  } catch (err) {
    console.warn('[EQ profile] could not read the profile line:', err);
    set(null, null);
  }
}

/** Nothing plays on the speakers any more. */
export function playingStopped(): void {
  set(null, null);
}

/** The playing code's recommendation, or null. The same object until it changes. */
export function getPlayingEqProfile(): EqProfile | null {
  return profile;
}

/** Call `listener` whenever the playing recommendation changes. Returns the unsubscribe. */
export function subscribePlayingEqProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget the recommendation without notifying (tests). */
export function resetPlayingEqProfile(): void {
  profile = null;
  heldLine = null;
}
