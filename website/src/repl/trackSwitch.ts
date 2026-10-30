/**
 * What Update / Ctrl+U should do with the code in the editor.
 *
 * - `'hot-swap'`: the editor holds the track that is playing (or nothing is playing, or the
 *   editor's track is unknown). Swap the code into the running scheduler in place: no fade,
 *   no canvas or Hydra cleanup, no stop. The cycle position and tempo carry on (spec 009
 *   Requirement 0).
 * - `'switch'`: something is playing and the editor holds a DIFFERENT track (picked in the
 *   library, then Update). Fade the old track out (when smooth transitions are on), restart
 *   the clock at cycle 0 while silent, evaluate the new track, fade it in.
 */
export type UpdateAction = 'hot-swap' | 'switch';

export interface UpdateActionInput {
  /** Whether the main (speakers) scheduler is running right now. */
  isPlaying: boolean;
  /** Id of the track whose code the main scheduler is playing, if known. */
  playingTrackId: string | null | undefined;
  /** Id of the track loaded in the editor (handleUpdate's patternData.id), if known. */
  editorTrackId: string | null | undefined;
}

export function getUpdateAction({ isPlaying, playingTrackId, editorTrackId }: UpdateActionInput): UpdateAction {
  // Unknown editor track: we can't tell it is a different track, so never break the groove.
  if (!isPlaying || !editorTrackId) {
    return 'hot-swap';
  }
  return editorTrackId === playingTrackId ? 'hot-swap' : 'switch';
}

/** What `update()` did: hot-swapped in place, switched tracks, or ignored a repeat. */
export type UpdateOutcome = 'hot-swap' | 'switch' | 'ignored';

export interface UpdateRequest {
  /**
   * The caller loads a track and wants it reset (handleUpdate(…, true): PatternsTab, strict
   * file manager). With nothing playing that is a switch (reset, then evaluate) rather than
   * a plain evaluate. With the same track playing it is still an in-place hot-swap.
   */
  reset?: boolean;
  /** Whether the main (speakers) scheduler is running right now. */
  isPlaying: boolean;
  /** The editor's code, read at the moment of the Update. */
  code: string | undefined;
  /** Evaluate the editor's code in place (editor.evaluate()). */
  hotSwap: () => Promise<void> | void;
  /** Switch to `code`: fade/restart/evaluate. Resolves when the switch has finished. */
  switchTrack: (code: string, options: { reset: boolean }) => Promise<void> | void;
}

/** The subset of StrudelMirror this controller wraps. */
export interface EvaluatingEditor {
  code: string;
  evaluate: (...args: any[]) => Promise<unknown> | unknown;
}

/**
 * Bookkeeping for Update / Ctrl+U on the main repl: which track is playing, which is in the
 * editor, and whether a switch is in flight.
 *
 * - The id of a playing track is captured when its evaluate STARTS (an evaluate can take
 *   seconds: fade down, transpile, samples(), setPattern) and stamped when it lands
 *   (`afterEval`). Picking another track meanwhile doesn't relabel what's playing.
 * - While a switch to track X is in flight, further Updates for X are ignored (a double
 *   press or a held Ctrl+U must not fade X out and restart it again). Updates for another
 *   track still switch (the transition manager queues them).
 * - `stopped()` clears the playing track.
 *
 * useReplContext owns one instance and calls it from handleUpdate, handleEvaluate,
 * handleShuffle, afterEval and onToggle.
 */
export function createTrackSwitchController() {
  let editorTrackId: string | null = null;
  let playingTrackId: string | null = null;
  // code -> id of the track it belonged to when its evaluate started
  const startedEvaluations = new Map<string, string | null>();
  let switchesInFlight = 0;
  let switchTarget: string | null = null;

  const evaluationStarted = (code: string | undefined, trackId: string | null = editorTrackId) => {
    if (typeof code === 'string') {
      startedEvaluations.set(code, trackId);
    }
  };

  const controller = {
    get editorTrackId() {
      return editorTrackId;
    },
    get playingTrackId() {
      return playingTrackId;
    },
    get switchTarget() {
      return switchesInFlight > 0 ? switchTarget : null;
    },

    /** The editor now holds track `id` (handleUpdate, the library, shuffle). */
    setEditorTrack(id: string | null | undefined) {
      editorTrackId = id || null;
    },

    /** An evaluate of `code` starts now, for `trackId` (default: the editor's track). */
    evaluationStarted,

    /**
     * Route every editor.evaluate() (Play, Ctrl+Enter, Update) through `evaluationStarted`, so
     * the track id is captured when the evaluate starts. Wraps the instance, not the class.
     */
    attachEditor(editor: EvaluatingEditor) {
      const evaluate = editor.evaluate.bind(editor);
      editor.evaluate = (...args: any[]) => {
        evaluationStarted(editor.code);
        return evaluate(...args);
      };
    },

    /** afterEval: the main repl now plays `code`. */
    evaluated(code: string) {
      if (startedEvaluations.has(code)) {
        playingTrackId = startedEvaluations.get(code) ?? null;
        startedEvaluations.delete(code);
      } else {
        // An evaluate nobody announced (should not happen): best guess is the editor's track.
        playingTrackId = editorTrackId;
      }
    },

    /** onToggle(false): nothing is playing on the speakers any more. */
    stopped() {
      playingTrackId = null;
    },

    /** Decide what Update does right now, without doing it. */
    decide(isPlaying: boolean, reset = false): UpdateOutcome {
      if (switchesInFlight > 0) {
        // The scheduler may be stopped mid-switch, so `isPlaying` is not meaningful here.
        return editorTrackId !== null && editorTrackId === switchTarget ? 'ignored' : 'switch';
      }
      const action = getUpdateAction({ isPlaying, playingTrackId, editorTrackId });
      if (action === 'hot-swap' && reset && !isPlaying) {
        return 'switch'; // loading a track with nothing playing: reset, then evaluate
      }
      return action;
    },

    /** Update / Ctrl+U / handleUpdate(…, true): hot-swap, switch, or ignore a repeat. */
    async update({ reset = false, isPlaying, code, hotSwap, switchTrack }: UpdateRequest): Promise<UpdateOutcome> {
      const outcome = controller.decide(isPlaying, reset);
      if (outcome === 'ignored') {
        return outcome;
      }
      if (outcome === 'hot-swap' || !code) {
        await hotSwap();
        return 'hot-swap';
      }
      const target = editorTrackId;
      evaluationStarted(code, target);
      switchesInFlight++;
      switchTarget = target;
      try {
        await switchTrack(code, { reset });
      } finally {
        switchesInFlight = Math.max(0, switchesInFlight - 1);
        if (switchesInFlight === 0) {
          switchTarget = null;
        }
      }
      return 'switch';
    },
  };
  return controller;
}

export type TrackSwitchController = ReturnType<typeof createTrackSwitchController>;
