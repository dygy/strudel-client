// The limits of a pattern run. Used by the host and by the code inside the sandbox.

export const DEFAULT_CYCLES = 4;
export const MAX_CYCLES = 64;
/** Events in an answer. */
export const MAX_EVENTS = 2_000;
/** Events counted for the summary. A fixed count, so that a cut-off answer stays deterministic. */
export const MAX_COUNTED_EVENTS = 20_000;
/** The answer as JSON, in characters. */
export const MAX_RESULT_CHARS = 8_000_000;

/** The spec promises a stop within 10 s, so the sandbox's own stop comes early enough to report it. */
export const TIME_LIMIT_MS = 9_000;
/** A native call (a regular expression, say) can't be interrupted: the worker is killed this long after. */
export const KILL_GRACE_MS = 500;
export const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
/** QuickJS's own stack limit. V8 needs a far larger one under it, or the wasm recursion overflows V8 first. */
export const QUICKJS_STACK_BYTES = 4 * 1024 * 1024;
export const WORKER_STACK_MB = 64;
