/**
 * Spec 031 review #3: an abandoned manual mix puts the old track's pattern back without an evaluate,
 * but the new code's evaluate (when the mix began) already ran afterEval, which stamped the new code
 * as playing: the track id (trackSwitch), the EQ recommendation (spec 024), the document title, the
 * latest code and the repl's activeCode. `runRestoringAbandon` captures what played before the
 * switch and, on `'abandoned'`, puts all of it back.
 */
import type { SwitchResult } from './evaluateNewTrack';

export interface AbandonRestoreDeps {
  /** The track id playing now (trackSwitch.playingTrackId). */
  playingTrackId: () => string | null;
  /** The code playing now (the repl's activeCode). */
  playingCode: () => string | undefined;
  /** trackSwitch.restorePlaying. */
  restorePlayingTrack: (id: string | null) => void;
  /** Put back what afterEval stamped for `code`: EQ recommendation, title, latest code, activeCode. */
  restorePlayingCode: (code: string) => void;
}

/** Run a switch; if it ends `'abandoned'`, restore what played before it. */
export async function runRestoringAbandon(
  run: () => Promise<SwitchResult>,
  deps: AbandonRestoreDeps,
): Promise<SwitchResult> {
  const trackId = deps.playingTrackId();
  const code = deps.playingCode();
  const result = await run();
  if (result === 'abandoned') {
    deps.restorePlayingTrack(trackId);
    if (typeof code === 'string') deps.restorePlayingCode(code);
  }
  return result;
}
