// Globals the engine reads while it loads and logs. Plain JS with no host behind it: `console`
// discards everything, and `performance` only lets the logger debounce repeated messages.
const noop = () => {};
globalThis.console = { log: noop, warn: noop, error: noop, info: noop, debug: noop, assert: noop };
globalThis.performance = { now: () => Date.now() };
