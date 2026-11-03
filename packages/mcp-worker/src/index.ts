import type { Env } from './env';
import { handleRequest } from './handler';

export { TabRelay } from './tabRelay';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      site: (siteRequest) => env.SITE.fetch(siteRequest),
      isRateLimited: env.MCP_RATE ? async (userId) => !(await env.MCP_RATE!.limit({ key: userId })).success : undefined,
      // Workers Logs parses an object into searchable fields. scripts/cpu-time.mjs reads `handler`.
      log: (entry) => console.log(entry),
    });
  },
} satisfies ExportedHandler<Env>;
