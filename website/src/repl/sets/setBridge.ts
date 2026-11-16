/**
 * The set bridge (spec 022, tech §2.4): what the set player may do to the REPL, and nothing more.
 * useReplContext builds one with its refs; useSetPlayer drives it.
 *
 * - `openItem`: open a track or a step exactly like a click in the library (save first, URL, load).
 * - `cue`: play the editor's code on the headphone preview. The speakers are never touched.
 * - `go`: stop the preview (letting go of its scratch platter), then a forced switch on the speakers
 *   through the normal Update path (runUpdate → trackSwitch.update → evaluateNewTrack), with the
 *   item's transition. Resolves `'switched'` once the new code is playing, `'failed'` when it didn't
 *   evaluate (the old track keeps playing).
 * - While an item is cued, the editor's own evaluate (Ctrl+Enter, Alt+Enter) goes to the preview,
 *   so an edit while cued is heard on the headphones and never replaces the speakers' track.
 * - Update while cued is the set's Go (`routeUpdate`).
 * - `manualGo` (spec 031): the crossfader's Go. The same preview stop and forced switch as `go`, but
 *   as a manual mix: it resolves when the fader completes it (`'switched'`) or brings it back
 *   (`'abandoned'`), not when the new code starts playing.
 * - Stopping the preview with its own button fires `onPreviewStopped` (the player cancels the cue).
 */
import type { TransitionOverride } from '../transitionSettings';
import type { UpdateOutcome } from '../trackSwitch';
import type { SwitchResult } from '../evaluateNewTrack';

export interface BridgePreviewEngine {
  isInitialized: boolean;
  evaluate: (code: string) => Promise<unknown>;
  stop: () => void;
}

export interface BridgeEditor {
  code: string;
  evaluate: (...args: unknown[]) => unknown;
}

export interface SetBridgeDeps {
  previewEngine: () => BridgePreviewEngine | null;
  isPreviewing: () => boolean;
  setPreviewing: (previewing: boolean) => void;
  /** Whether the speakers' scheduler runs. */
  isPlaying: () => boolean;
  editor: () => BridgeEditor | null;
  /**
   * runUpdate with `force: true` and the item's transition; reports the outcome and the result.
   * `manual` (spec 031): a crossfader mix (TrackTransitionController.beginManual).
   */
  runSwitch: (options: {
    force: true;
    transition: TransitionOverride | null;
    manual?: boolean;
  }) => Promise<{ outcome: UpdateOutcome; result: SwitchResult }>;
  scratch: { beforeEvaluate: () => void; previewStopping: (engine: BridgePreviewEngine) => void };
  /** The library's own open (assistantControl/openTrack.ts); false while the library isn't mounted. */
  canOpen: () => boolean;
  openTrack: (track: { id: string }) => Promise<void> | void;
  openStep: (target: { trackId: string; stepIndex: number }) => Promise<void> | void;
  /**
   * Whether a forced Go of the editor's code right now would be ignored (the same switch is already
   * in flight). Then the Go leaves the headphones and the cue alone.
   */
  goWouldBeIgnored?: () => boolean;
  /** Spec 031: Go during a manual mix hands it to the timed transition (handManualToTimed). */
  handOverManual?: () => boolean;
  /** Spec 031 review #6: a manual mix is in flight (Alt+Shift+N hands it over even with no set). */
  isManualMixing?: () => boolean;
}

/** What Update asks of the set player while an item may be cued. */
export interface SetGoHandler {
  isCued: () => boolean;
  go: () => Promise<unknown>;
}

/** `ignored`: the same switch is already running; the cue is kept (headphones still on). */
export type GoResult = 'switched' | 'failed' | 'ignored';
/** Spec 031: a crossfader Go. `abandoned`: the fader went back; the old track plays on. */
export type ManualGoResult = GoResult | 'abandoned' | 'cancelled';
/** What a manual Go resolves: how the mix ended, and the cued code it mixed (re-cued on abandon). */
export interface ManualGoOutcome {
  result: ManualGoResult;
  code?: string;
}
/** `no-library`: the library isn't mounted (zen mode); the set can't open a track. */
export type OpenResult = 'opened' | 'no-library' | 'failed';
/** `no-preview`: the headphone preview engine isn't ready. */
export type CueResult = 'playing' | 'no-preview' | 'failed';

export function createSetBridge(deps: SetBridgeDeps) {
  const previewStopped = new Set<() => void>();
  const evaluated = new Set<(code: string) => void>();
  let goHandler: SetGoHandler | null = null;
  // The editor-evaluate redirect while cued: the wrapped editor and its own evaluate.
  let redirect: {
    editor: BridgeEditor;
    original: BridgeEditor['evaluate'];
    active: boolean;
    remove: () => void;
  } | null = null;

  const previewCode = async (code: string): Promise<CueResult> => {
    const engine = deps.previewEngine();
    if (!engine || !engine.isInitialized) return 'no-preview';
    if (!code) return 'failed';
    // A code error is shown by the preview's repl and keeps the cue: the user fixes it on the
    // headphones and Goes, or cancels.
    await engine.evaluate(code);
    deps.setPreviewing(true);
    return 'playing';
  };

  const stopPreview = () => {
    const engine = deps.previewEngine();
    if (engine && deps.isPreviewing()) {
      deps.scratch.previewStopping(engine);
      engine.stop();
      deps.setPreviewing(false);
    }
  };

  /**
   * What `go` and `manualGo` both do first: refuse a Go that would be ignored, let go of the redirect
   * and the platter, and stop the headphones. Null when ignored.
   */
  const startGo = (): { code: string | undefined; wasPreviewing: boolean } | null => {
    const code = deps.editor()?.code;
    if (deps.goWouldBeIgnored?.()) return null;
    bridge.removeRedirect();
    deps.scratch.beforeEvaluate();
    const wasPreviewing = deps.isPreviewing();
    stopPreview();
    return { code, wasPreviewing };
  };

  const bridge = {
    /** Open `track` (or its step `stepIndex`) as a library click does. */
    async openItem(track: { id: string }, stepIndex?: number): Promise<OpenResult> {
      if (!deps.canOpen()) return 'no-library';
      try {
        if (stepIndex === undefined) await deps.openTrack(track);
        else await deps.openStep({ trackId: track.id, stepIndex });
        return 'opened';
      } catch (error: unknown) {
        console.warn('[sets] could not open the item:', error);
        return 'failed';
      }
    },

    /** Play `code` (default: the editor's) on the headphones. The speakers are untouched. */
    async cue(code?: string): Promise<CueResult> {
      try {
        return await previewCode(code ?? deps.editor()?.code ?? '');
      } catch (error: unknown) {
        console.warn('[sets] could not start the headphone preview:', error);
        return 'failed';
      }
    },

    /** Stop the headphones for the set itself (select, end): no cancel event. */
    stopPreview,

    /**
     * Mix the editor's code onto the speakers with `transition` (null = the global one). When the same
     * switch is already in flight it is `'ignored'` and the headphones and the cue are left as they are.
     */
    go(transition: TransitionOverride | null): Promise<GoResult> {
      const start = startGo();
      if (!start) return Promise.resolve('ignored');
      const { code, wasPreviewing } = start;
      return new Promise<GoResult>((resolve) => {
        let done = false;
        const finish = (result: GoResult) => {
          if (done) return;
          done = true;
          evaluated.delete(onEvaluated);
          resolve(result);
        };
        // A transition resolves only when it has ended (up to 16 cycles); the set moves on as soon
        // as the new code plays.
        const onEvaluated = (playing: string) => {
          if (playing === code) finish('switched');
        };
        evaluated.add(onEvaluated);
        deps
          .runSwitch({ force: true, transition })
          .then(async ({ outcome, result }) => {
            if (outcome === 'ignored') {
              // Nothing changed on the speakers: put the cue back on the headphones.
              if (wasPreviewing && code) await previewCode(code).catch(() => 'failed');
              finish('ignored');
              return;
            }
            finish(outcome === 'switch' && result === 'ok' ? 'switched' : 'failed');
          })
          .catch((error: unknown) => {
            console.error('[sets] Go failed:', error);
            finish('failed');
          });
      });
    },

    /**
     * Spec 031: the crossfader's Go of the editor's (cued) code: `go`'s preview stop and forced switch,
     * as a manual mix. Resolves once the mix ends: `'switched'` (completed, also after a hand-over to
     * the timed path), `'abandoned'` (the fader went back), `'cancelled'` (Stop ended it), `'failed'`,
     * or `'ignored'` (another switch in flight; the cue goes back on the headphones as for `go`).
     * `code` is the cued code captured as the Go began (review #4: an abandon re-cues exactly it).
     */
    async manualGo(transition: TransitionOverride | null): Promise<ManualGoOutcome> {
      const start = startGo();
      if (!start) return { result: 'ignored' };
      const { code, wasPreviewing } = start;
      const ended = (result: ManualGoResult): ManualGoOutcome => ({ result, code });
      try {
        const { outcome, result } = await deps.runSwitch({ force: true, transition, manual: true });
        if (outcome === 'ignored' || (outcome === 'switch' && result === 'ignored')) {
          if (wasPreviewing && code) await previewCode(code).catch(() => 'failed');
          return ended('ignored');
        }
        if (outcome !== 'switch') return ended('failed');
        if (result === 'ok') return ended('switched');
        if (result === 'abandoned' || result === 'cancelled') return ended(result);
        return ended('failed');
      } catch (error: unknown) {
        console.error('[sets] manual Go failed:', error);
        return ended('failed');
      }
    },

    /** Spec 031: Go during a manual mix: hand it to the timed transition. False when none runs. */
    handOverManual(): boolean {
      return deps.handOverManual?.() ?? false;
    },

    /** Spec 031: whether a manual mix is in flight right now. */
    isManualMixing(): boolean {
      return deps.isManualMixing?.() ?? false;
    },

    isPreviewing: () => deps.isPreviewing(),
    isPlaying: () => deps.isPlaying(),

    /** Subscribe to the preview being stopped with its own button. Returns the unsubscribe. */
    onPreviewStopped(listener: () => void): () => void {
      previewStopped.add(listener);
      return () => previewStopped.delete(listener);
    },

    /** The REPL: the user stopped the preview with its button. */
    previewStoppedByUser() {
      for (const listener of [...previewStopped]) listener();
    },

    /** The REPL: the main repl now plays `code` (afterEval). */
    evaluated(code: string) {
      for (const listener of [...evaluated]) listener(code);
    },

    /** The set player registers what Update does while cued. */
    setGoHandler(handler: SetGoHandler | null) {
      goHandler = handler;
    },

    /** The REPL's Update: true when it was the set's Go (the caller then does nothing else). */
    routeUpdate(): boolean {
      if (!goHandler?.isCued()) return false;
      void goHandler.go();
      return true;
    },

    /**
     * While cued: the editor's evaluate (Ctrl+Enter) plays on the headphones. Wraps the instance,
     * like trackSwitch.attachEditor. Returns the function that removes it (also `removeRedirect`).
     */
    redirectEditorToPreview(): () => void {
      bridge.removeRedirect();
      const editor = deps.editor();
      if (!editor) return () => {};
      const original = editor.evaluate;
      const state = { editor, original, active: true, remove: () => {} };
      const redirected = (...args: unknown[]) => {
        if (!state.active) return original.apply(editor, args);
        return previewCode(editor.code).catch((error: unknown) => {
          console.warn('[sets] could not play the edit on the headphones:', error);
          return false;
        });
      };
      state.remove = () => {
        state.active = false;
        // Something wrapped it after us: leave theirs in place, ours now passes through.
        if (editor.evaluate === redirected) editor.evaluate = original;
        if (redirect === state) redirect = null;
      };
      editor.evaluate = redirected;
      redirect = state;
      return state.remove;
    },

    /** Remove the redirect, if any (Go, cancel, end, unmount). */
    removeRedirect() {
      redirect?.remove();
    },

    /** Whether the editor's evaluate goes to the headphones right now. */
    isRedirected: () => redirect !== null && redirect.active,

    /** Play on the speakers past the redirect (the Play button always means the speakers). */
    evaluateOnSpeakers(): unknown {
      if (redirect?.active) return redirect.original.apply(redirect.editor, []);
      return deps.editor()?.evaluate();
    },
  };
  return bridge;
}

export type SetBridge = ReturnType<typeof createSetBridge>;
