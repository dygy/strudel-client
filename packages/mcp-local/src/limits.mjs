// The limits of a pattern run. Used by the host and by the code inside the sandbox.

export const DEFAULT_CYCLES = 4;
export const MAX_CYCLES = 64;
/** Events in an answer. */
export const MAX_EVENTS = 2_000;
/** Events counted for the summary. A fixed count, so that a cut-off answer stays deterministic. */
export const MAX_COUNTED_EVENTS = 20_000;
/** The answer as JSON, in characters. */
export const MAX_RESULT_CHARS = 8_000_000;

/** The spec promises a stop within 10 s. This leaves room to report it, even on a busy machine. */
export const TIME_LIMIT_MS = 8_000;
/** A check only parses, however large the code, and an MCP client's default timeout is 60 s. */
export const CHECK_TIME_LIMIT_MS = 50_000;
/** A native call (a regular expression, say) can't be interrupted: the worker is killed this long after. */
export const KILL_GRACE_MS = 500;
/** What the worker tells the main thread when the engine has loaded and the code is about to start. */
export const READY_MESSAGE = 'ready';
export const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
/** QuickJS's own stack limit. V8 needs a far larger one under it, or the wasm recursion overflows V8 first. */
export const QUICKJS_STACK_BYTES = 4 * 1024 * 1024;
export const WORKER_STACK_MB = 64;
