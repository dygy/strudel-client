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

## Tools and what they read

Reads go to Supabase REST with the assistant's own token, so RLS applies. Writes go over the `SITE` service binding to the site's own routes, so its naming and path rules stay in one place. No service-role key anywhere.

`src/generated/` holds the function index, the names the check knows and the sound list. Regenerate after changing functions or sounds:

```sh
pnpm run build:mcp   # jsdoc to doc.json, then scripts/build-knowledge.mjs
```

The sound list comes from `website/public/*.json`, the inline lists in `website/src/repl/prebake.ts`, `packages/soundfonts/gm.mjs` and `packages/superdough`. It's what the site loads at start, not what a track loads for itself.

## The online check limit

`check_code` takes 768 bytes (`CHECK_MAX_BYTES`). Larger code gets `use_local_helper`. The cost is the first check in a new isolate, when acorn and the mini parser haven't been compiled yet:

| Worst input, fresh Node process, CPU of the call | 512 B | 768 B | 1 KB | 2 KB | 8 KB |
| --- | --- | --- | --- | --- | --- |
| Worst median of 10 fixtures, ms | 7.7 | 8.8 | 9.7 | 15.3 | 17.5 |
| Worst of 9 runs, ms | 9.1 | 9.6 | 10.8 | 16.6 | 19.7 |

Once an isolate has checked something, 8 KB takes 2 to 5 ms, with occasional spikes to about 12 ms. So raising the limit is a question of how the Workers platform treats a cold isolate, and of how its CPUs compare: these figures are from a Mac, not workerd. Measure with `scripts/cpu-time.mjs` on the deployed Worker before changing it.

## Live control of a tab

A tab with **Allow assistant control** on holds a WebSocket to `GET /mcp/tab`, on the site's own origin. The Worker authenticates the upgrade with the `sb-access-token` cookie the browser sends: the Origin must be the site, Supabase must accept the token, and a token with a `client_id` (an assistant's) is refused. Anything refused never reaches a Durable Object. This is the one place this Worker reads a cookie; `/mcp` never does.

The verified user id picks the user's `TabRelay`. The relay only trusts a socket until its token expires, plus a minute. When the session refreshes, the tab sends the new token over the socket (`{ "type": "token" }`), which extends that. A refused token closes the socket with `4401`.

Heartbeats are `ping` and `pong`, answered without waking the object. A command waits 5 s for its answer (10 s for `play`). The relay passes a command's arguments on as text, without parsing them.

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
