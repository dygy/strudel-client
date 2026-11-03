export interface Env {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  TAB_RELAY: DurableObjectNamespace;
  /** The site's Worker: writes go through its routes. */
  SITE: Fetcher;
  /** 120 a minute, per user (wrangler.jsonc). */
  MCP_RATE?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** 300 a minute, per address, before any token is looked at. */
  MCP_IP_RATE?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

/** What the handlers need from the outside world, so tests can run them without a network. */
export interface Deps {
  fetch: typeof fetch;
  /** The site's Worker. */
  site: (request: Request) => Promise<Response>;
  /** True when this user is over the limit. Absent where no limit applies. */
  isRateLimited?: (userId: string) => Promise<boolean>;
  /** True when this address is over its limit. */
  isIpRateLimited?: (address: string) => Promise<boolean>;
  log: (entry: LogEntry) => void;
}

/** One line per request. Tool name, outcome and duration only: never code, tokens or emails. */
export interface LogEntry {
  handler: string;
  outcome: string;
  ms: number;
}
