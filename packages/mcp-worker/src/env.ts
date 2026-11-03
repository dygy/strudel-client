export interface Env {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  TAB_RELAY: DurableObjectNamespace;
  /** Spike only: the echo has no sign-in, so prod leaves this unset. Slice 8 replaces it. */
  TAB_ECHO_ENABLED?: string;
}

/** What the handlers need from the outside world, so tests can run them without a network. */
export interface Deps {
  fetch: typeof fetch;
  log: (entry: LogEntry) => void;
}

/** One line per request. Tool name, outcome and duration only: never code, tokens or emails. */
export interface LogEntry {
  handler: string;
  outcome: string;
  ms: number;
}
