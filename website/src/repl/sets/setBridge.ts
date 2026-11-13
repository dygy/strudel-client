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
  /** runUpdate with `force: true` and the item's transition; reports the outcome and the result. */
  runSwitch: (options: {
    force: true;
    transition: TransitionOverride | null;
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
}

/** What Update asks of the set player while an item may be cued. */
export interface SetGoHandler {
  isCued: () => boolean;
  go: () => Promise<unknown>;
}

/** `ignored`: the same switch is already running; the cue is kept (headphones still on). */
export type GoResult = 'switched' | 'failed' | 'ignored';
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
      const code = deps.editor()?.code;
      if (deps.goWouldBeIgnored?.()) return Promise.resolve('ignored');
      bridge.removeRedirect();
      deps.scratch.beforeEvaluate();
      const wasPreviewing = deps.isPreviewing();
      stopPreview();
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
