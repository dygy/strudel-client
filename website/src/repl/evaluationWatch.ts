/**
 * Whether code is being evaluated right now, for assistant control only (spec 018). It watches the repl
 * from the outside: the same promise goes back to the caller, nothing waits, and no human path reads this.
 * A human's Update behaves as if this weren't here.
 */

/** After this long an evaluate that hasn't finished stops holding assistants back. Code can hang. */
export const STUCK_AFTER_MS = 20_000;

interface Evaluating {
  evaluate: (...args: never[]) => unknown;
}

export function createEvaluationWatch(now: () => number = Date.now) {
  const watched = new WeakSet<object>();
  const inFlight = new Set<{ startedAt: number; done: Promise<void> }>();

  return {
    /** Observes every evaluate of this repl, whoever starts it: Play, Update, a switch of any type. */
    watch(repl: Evaluating) {
      if (watched.has(repl)) return;
      watched.add(repl);
      const evaluate = repl.evaluate.bind(repl);
      repl.evaluate = ((...args: never[]) => {
        const result = evaluate(...args);
        const entry = { startedAt: now(), done: Promise.resolve() };
        const finished = () => {
          inFlight.delete(entry);
        };
        entry.done = Promise.resolve(result).then(finished, finished);
        inFlight.add(entry);
        return result;
      }) as Evaluating['evaluate'];
    },
    /** An evaluate has been going for less than the bound. */
    isLive: () => [...inFlight].some(({ startedAt }) => now() - startedAt < STUCK_AFTER_MS),
    /** An evaluate has outlasted the bound, and may never finish. */
    hasStuck: () => [...inFlight].some(({ startedAt }) => now() - startedAt >= STUCK_AFTER_MS),
    /** Resolves when those going now have finished. For a caller with its own limit on how long to wait. */
    settled: () => Promise.all([...inFlight].map(({ done }) => done)).then(() => undefined),
  };
}

export type EvaluationWatch = ReturnType<typeof createEvaluationWatch>;

/**
 * Should an assistant wait? A transition really under way counts however long it lasts. Anything else
 * that says it's busy (the moments before an evaluate, or one that never ended) stops counting once an
 * evaluate has outlasted the bound, so a hang unblocks assistants.
 */
export function isMusicChanging(
  watch: Pick<EvaluationWatch, 'isLive' | 'hasStuck'>,
  { transitionActive, switchUnderWay }: { transitionActive: boolean; switchUnderWay: boolean },
): boolean {
  return watch.isLive() || transitionActive || (switchUnderWay && !watch.hasStuck());
}
