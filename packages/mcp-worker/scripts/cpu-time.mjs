#!/usr/bin/env node
/**
 * CPU time per handler for strudel-mcp, from Workers Logs. Workers Free stops a request at 10 ms of
 * CPU, so this is the number that decides what stays online (tech spec 2.1). See README.md.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/cpu-time.mjs [--hours=1]
 *   node scripts/cpu-time.mjs --file=events.json      # a saved query response
 *
 * Read-only in effect, although Cloudflare's query endpoint requires the "Workers Observability
 * Write" permission. The two parts of a row arrive as separate events with the same request id:
 * `$workers.cpuTimeMs` on the invocation log, `handler` on this Worker's own log line.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '503e92d7d95838d80c33802d3274f284';
const SERVICE = 'strudel-mcp';
const PAGE_SIZE = 2000;
const MAX_PAGES = 10;
const CPU_LIMIT_MS = 10;

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

const requestIdOf = (event) => event.$workers?.requestId ?? event.$metadata?.requestId;

/** Requests with no log line of their own (the metadata document, the socket) go by their path. */
function pathOf(event) {
  const url = event.$workers?.event?.request?.url;
  try {
    return url ? new URL(url).pathname : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Joins invocation logs and handler logs by request id. Returns one row per handler. */
export function summarize(events) {
  const requests = new Map();
  for (const event of events) {
    const id = requestIdOf(event);
    if (!id) continue;
    const request = requests.get(id) ?? {};
    if (typeof event.$workers?.cpuTimeMs === 'number') {
      request.cpuMs = event.$workers.cpuTimeMs;
      request.path = pathOf(event);
    }
    const handler = event.source?.handler;
    if (typeof handler === 'string') request.handler = handler;
    requests.set(id, request);
  }

  const byHandler = new Map();
  for (const { cpuMs, handler, path } of requests.values()) {
    if (cpuMs === undefined) continue;
    const name = handler ?? path;
    byHandler.set(name, [...(byHandler.get(name) ?? []), cpuMs]);
  }

  return [...byHandler.entries()]
    .map(([handler, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        handler,
        count: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1],
        overLimit: sorted.filter((ms) => ms > CPU_LIMIT_MS).length,
      };
    })
    .sort((a, b) => b.max - a.max);
}

export function formatTable(rows) {
  const header = ['handler', 'count', 'p50 ms', 'p95 ms', 'max ms', `over ${CPU_LIMIT_MS} ms`];
  const body = rows.map((r) => [r.handler, r.count, r.p50, r.p95, r.max, r.overLimit].map(String));
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  return [header, ...body]
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

const eventsIn = (response) => response?.result?.events?.events ?? [];

async function queryEvents(token, hours) {
  const to = Date.now();
  const events = [];
  let offset;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/observability/telemetry/query`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          queryId: 'strudel-mcp-cpu-time',
          timeframe: { from: to - hours * 3600_000, to },
          view: 'events',
          limit: PAGE_SIZE,
          ...(offset ? { offset } : {}),
          parameters: {
            datasets: ['cloudflare-workers'],
            filters: [{ key: '$metadata.service', operation: 'includes', type: 'string', value: SERVICE }],
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`Query failed with ${response.status}: ${await response.text()}`);
    const batch = eventsIn(await response.json());
    events.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset = batch[batch.length - 1].$metadata?.id;
    if (!offset) break;
  }
  return events;
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const file = option('file');
  let events;
  if (file) {
    events = eventsIn(JSON.parse(readFileSync(file, 'utf8')));
  } else {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN (permission: Workers Observability Write), or use --file=');
    events = await queryEvents(token, Number(option('hours') ?? 1));
  }
  const rows = summarize(events);
  console.log(rows.length ? formatTable(rows) : 'No strudel-mcp events in this period.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
