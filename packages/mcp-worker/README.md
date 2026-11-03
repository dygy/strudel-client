# strudel-mcp

The remote MCP server for Strudel, at `https://strudel.dygy.app/mcp` (spec 018). A separate Worker on two path routes in front of the `strudel-client` custom domain.

Workers Free allows 10 ms of CPU per request, and going over is an uncatchable error. So: no MCP SDK, zod or supabase-js in the bundle. `@modelcontextprotocol/sdk` is a dev dependency for the conformance test only.

## Local run

```sh
cd packages/mcp-worker
npx wrangler dev --local-upstream localhost:8787   # without it, request.url says strudel.dygy.app
npx wrangler deploy --dry-run --outdir dist        # bundle size, deploys nothing
```

Point it at a fake auth server with `--var PUBLIC_SUPABASE_URL:http://localhost:<port>`.

The WebSocket spike at `/mcp/tab` requires an `Origin` equal to the server's own origin:

```js
// In the browser console on https://strudel.dygy.app
const ws = new WebSocket('wss://strudel.dygy.app/mcp/tab');
ws.onmessage = (e) => console.log('echo:', e.data);
ws.onopen = () => ws.send('hello');
```

## Reading CPU time per handler

Each request writes one log line with `handler`, `outcome` and `ms`. `ms` is wall time. The CPU time is on the invocation log of the same request, in `$workers.cpuTimeMs`.

**Script.** Needs an API token with the `Workers Observability Write` permission, which is what Cloudflare's query endpoint asks for, even for reads.

```sh
cd packages/mcp-worker
CLOUDFLARE_API_TOKEN=... node scripts/cpu-time.mjs --hours=1
```

It prints count, p50, p95 and max per handler, and how many requests went over 10 ms. Requests with no handler line (the metadata document, the socket) are listed by path. Workers Logs samples by `head_sampling_rate`, which is 1 here, so every request is counted.

**By hand.**

1. Cloudflare dashboard: Workers & Pages → `strudel-mcp` → Observability → Events.
2. Filter `handler` for the handler you want, for example `tools/call:whoami`, and copy a row's `$metadata.requestId`.
3. Clear that filter, filter by the request id, and open the invocation row. Read `$workers.cpuTimeMs`.

For a whole-Worker number without per-handler detail, use the query builder: visualization `P99`, field `$workers.cpuTimeMs`.
