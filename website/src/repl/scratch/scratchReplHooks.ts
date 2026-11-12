/**
 * Where the REPL lets go of the platter (spec 019 2.6, review findings #3 and #7).
 *
 * - `replOptions` wraps the main repl's options (StrudelMirror passes them to the core repl): its
 *   beforeEval runs on every evaluate (Play, Ctrl+Enter, Update, Shuffle, a transition's evaluate,
 *   the assistant's start) and its onToggle on every start and stop. Those two are the choke points.
 * - `beforeUpdate`: an Update or a track switch may wait for a snapped boundary before it
 *   evaluates, so it lets go when it begins.
 * - `beforeEvaluate`: Update stops the headphone preview first; let go before that.
 * - `previewStopping`: the headphone preview is stopped (its own repl, not the main one).
 *
 * useReplContext calls each of these; `scratchReplWiring.test.ts` checks both the behaviour and
 * that every call is in place.
 */

export interface ScratchReleaser {
  releaseAll(): void;
}

export interface ReleasingReplOptions {
  beforeEval?: (...args: never[]) => unknown;
  onToggle?: (playing: boolean) => void;
}

export function createScratchReplHooks(runtime: ScratchReleaser) {
  return {
    /** The main repl's options, with beforeEval and onToggle letting go of the platter first. */
    replOptions<T extends ReleasingReplOptions>(options: T): T {
      const { beforeEval, onToggle } = options;
      return {
        ...options,
        beforeEval: (...args: never[]) => {
          runtime.releaseAll();
          return beforeEval?.(...args);
        },
        onToggle: (playing: boolean) => {
          runtime.releaseAll();
          onToggle?.(playing);
        },
      };
    },
    beforeUpdate(): void {
      runtime.releaseAll();
    },
    beforeEvaluate(): void {
      runtime.releaseAll();
    },
    previewStopping(engine: { scratchDeck?: { release(): void } | null } | null | undefined): void {
      engine?.scratchDeck?.release();
    },
  };
}

export type ScratchReplHooks = ReturnType<typeof createScratchReplHooks>;
