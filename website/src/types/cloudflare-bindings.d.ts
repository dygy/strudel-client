// The Cloudflare binding types that packages/mcp-worker/src/env.ts names.
// Website tests import mcp-worker sources, so the website program type-checks them too, but it can't
// load @cloudflare/workers-types: its globals (Request, Response, ...) clash with the DOM lib.
// These cover only what the worker calls. packages/mcp-worker's own tsconfig checks against the real types.

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
