/**
 * Switch the speakers to a DIFFERENT track's code (spec 017; spec 022 adds the per-switch override
 * and the result). Moved out of useReplContext unchanged in behaviour, so it can be tested without
 * rendering the REPL.
 *
 * The transition settings are read once, now, as the switch begins:
 * - Off, or nothing playing: the instant path. Restart (stop), reset, clean up, evaluate from cycle 0.
 * - any other type while playing: TrackTransitionController.switchTo. The old track keeps playing
 *   until the transition is done; a broken new track never replaces it. While a transition runs,
 *   every switch (also Off) goes to the controller, which queues the latest.
 *
 * `transition` (a set item's own type and length) decides the path too, so a Crossfade item works
 * while the global type is Off, and a Cut item while the global type is Crossfade. While the
 * controller is busy it is passed explicitly, so a queued Go keeps its item's transition.
 *
 * Resolves `'failed'` when the new code doesn't evaluate (the old track keeps playing), else `'ok'`.
 */
import {
  settingsForSwitch,
  switchPath,
  withTransitionOverride,
  type TransitionOverride,
  type TransitionSettings,
} from './transitionSettings';

export interface SwitchingRepl {
  scheduler?: { started?: boolean } | null;
  /** Resolves to the pattern, or to undefined when the code failed (the repl shows the error). */
  evaluate: (code: string) => Promise<unknown> | unknown;
  stop: () => void;
}

export interface SwitchingController {
  readonly busy: boolean;
  switchTo: (
    code: string,
    settings: TransitionSettings | undefined,
    options: { prepare?: () => Promise<void> },
  ) => Promise<unknown>;
}

export interface EvaluateNewTrackDeps {
  repl: SwitchingRepl | null | undefined;
  /** The global transition settings (settingsMap). */
  globalSettings: () => TransitionSettings;
  /** Whether a transition is in flight right now (the controller may not exist yet). */
  controllerBusy: () => boolean;
  /** The controller, created on first use. */
  getController: () => SwitchingController | null;
  flash: () => void;
  /** The reset before a transition's evaluate (keeps superdough's output and the tempo). */
  resetBeforeTransition: () => Promise<void>;
  cleanupCanvases: () => Promise<void>;
  /** Set while the instant path stops the scheduler, so onToggle(false) skips its own cleanup. */
  setRestarting: (restarting: boolean) => void;
}

export interface EvaluateNewTrackOptions {
  restart?: boolean;
  prepare?: () => Promise<void>;
  /** A set item's transition; null/undefined = the global one. */
  transition?: TransitionOverride | null;
  /**
   * A set's Go (spec 022 §2.5): if the new code fails, the old track must keep playing. The instant
   * path stops the speakers before it evaluates, so an Off switch while playing runs through the
   * controller as a Cut instead (no snap, glide or loudness match: the same hard switch as Off), and
   * a broken track never replaces the playing one. Plain switches (Update, the library) keep spec
   * 017's instant path.
   */
  keepOldOnFailure?: boolean;
}

export type SwitchResult = 'ok' | 'failed';

/** Off as a Cut through the controller: a hard switch that only happens once the new code evaluated. */
export const OFF_AS_CUT = Object.freeze({ type: 'cut', snap: 0, glide: false, matchLoudness: false } as const);

export async function evaluateNewTrack(
  deps: EvaluateNewTrackDeps,
  code: string,
  { restart = false, prepare, transition, keepOldOnFailure = false }: EvaluateNewTrackOptions = {},
): Promise<SwitchResult> {
  const { repl } = deps;
  if (!repl) return 'failed';
  let settings = withTransitionOverride(deps.globalSettings(), transition);
  const playing = Boolean(repl.scheduler?.started);
  const busy = deps.controllerBusy();
  const offAsCut = keepOldOnFailure && playing && settings.type === 'off';
  if (offAsCut) settings = { ...settings, ...OFF_AS_CUT };
  // The set's own settings are passed explicitly, so a queued Go keeps them.
  const explicit = Boolean(transition) || offAsCut;

  if (switchPath({ type: settings.type, playing, busy }) === 'transition') {
    const controller = deps.getController();
    if (controller) {
      deps.flash();
      try {
        await controller.switchTo(code, settingsForSwitch(settings, controller.busy, explicit), {
          prepare: prepare ? deps.resetBeforeTransition : undefined,
        });
        return 'ok';
      } catch (error: unknown) {
        if ((error as { evaluateFailed?: boolean } | null)?.evaluateFailed) {
          // The new track has an error: the repl shows it, the old track keeps playing untouched
          // and the notifier raised the toast. Evaluating it again would only fail again.
          console.warn('[TrackTransition] New track failed to evaluate; the old track keeps playing');
          return 'failed';
        }
        console.error('[TrackTransition] Transition failed, falling back to an instant switch:', error);
      }
    }
  }

  // Instant switch: restart first (onToggle's own cleanup is skipped; the awaited one below
  // runs instead), reset, clean up, then evaluate from cycle 0.
  const shouldRestart = restart && Boolean(repl.scheduler?.started);
  if (shouldRestart) {
    deps.setRestarting(true);
    try {
      repl.stop();
    } finally {
      deps.setRestarting(false);
    }
  }
  if (prepare) {
    await prepare();
  }
  await deps.cleanupCanvases();
  deps.flash();
  // The core repl catches an evaluation error itself (shows it, resolves undefined).
  const pattern = await repl.evaluate(code);
  return pattern ? 'ok' : 'failed';
}
