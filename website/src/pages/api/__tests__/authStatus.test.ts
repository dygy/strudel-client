/**
 * A missing or expired session must answer 401 — the only status on which the client refreshes
 * the session and retries (secureApi.ts) — and a valid session must be accepted from the
 * `Authorization: Bearer` header the client sends, not only from the cookie.
 *
 * Regression (2026-10-10): the tree routes had their own cookie-only auth whose errors were
 * mapped to 401 only if the message contained "authorization", so every auth failure was a 500.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  fakeState,
  resetSupabaseFake,
  signIn,
  supabaseFake,
  useTestEnv,
} from './apiTestHelpers';

import { POST as treeMove } from '../tree/move';
import {
  GET as treeNodesGet,
  POST as treeNodesCreate,
  PUT as treeNodesUpdate,
  DELETE as treeNodesDelete,
} from '../tree/nodes';
import { GET as treeSearchGet, POST as treeSearch } from '../tree/search';
import { GET as treeStats } from '../tree/stats';
import { GET as treeValidate } from '../tree/validate';
import { POST as trackCreate } from '../tracks/create';
import { PUT as trackUpdate } from '../tracks/update';
import { DELETE as trackDelete } from '../tracks/delete';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session', email: 'someone@example.test' };
// JWT-shaped: api/_auth.ts only takes a cookie value that contains a dot.
const TOKEN = 'eyJ.test.token';

const handlers = [
  { name: 'POST tree/move', handler: treeMove, method: 'POST', body: { nodeId: 'n1', newParentId: null } },
  { name: 'GET tree/nodes', handler: treeNodesGet, method: 'GET' },
  { name: 'POST tree/nodes', handler: treeNodesCreate, method: 'POST', body: { name: 'A', type: 'folder' } },
  { name: 'PUT tree/nodes', handler: treeNodesUpdate, method: 'PUT', body: { nodeId: 'n1', name: 'B' } },
  { name: 'DELETE tree/nodes', handler: treeNodesDelete, method: 'DELETE', body: { nodeId: 'n1' } },
  { name: 'GET tree/search', handler: treeSearchGet, method: 'GET' },
  { name: 'POST tree/search', handler: treeSearch, method: 'POST', body: { query: 'beat' } },
  { name: 'GET tree/stats', handler: treeStats, method: 'GET' },
  { name: 'GET tree/validate', handler: treeValidate, method: 'GET' },
  { name: 'POST tracks/create', handler: trackCreate, method: 'POST', body: { name: 'Beat', code: 's("bd")' } },
  { name: 'PUT tracks/update', handler: trackUpdate, method: 'PUT', body: { trackId: 't1', updates: { code: 'x' } } },
  { name: 'DELETE tracks/delete', handler: trackDelete, method: 'DELETE', body: { trackId: 't1' } },
] as const;

type H = (typeof handlers)[number];
const url = 'http://test/api/route?query=beat';

function call(h: H, auth: { cookie?: string; bearer?: string }) {
  const ctx = apiContext({ url, method: h.method, token: auth.cookie, body: 'body' in h ? h.body : undefined });
  if (auth.bearer) ctx.request.headers.set('authorization', `Bearer ${auth.bearer}`);
  return h.handler(ctx);
}

let consoleSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  consoleSpies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe.each(handlers)('$name: session handling', (h) => {
  it('a signed-out request answers 401 and writes nothing', async () => {
    const res = await call(h, {});

    expect(res.status).toBe(401);
    expect(fakeState.inserts).toEqual([]);
    expect(fakeState.mutations).toEqual([]);
  });

  it('an expired or invalid session answers 401', async () => {
    signIn(TOKEN, USER);

    const res = await call(h, { cookie: 'eyJ.expired.token' });

    expect(res.status).toBe(401);
  });

  it('an invalid Authorization: Bearer token answers 401', async () => {
    signIn(TOKEN, USER);

    const res = await call(h, { bearer: 'eyJ.expired.token' });

    expect(res.status).toBe(401);
  });

  // The status is chosen by error type, not message text: a database failure whose message
  // happens to mention "token" or "Authentication" is a 500, not a 401 (which would make the
  // client refresh the session and retry for nothing).
  it('a non-auth failure after sign-in answers 500, whatever its message says', async () => {
    signIn(TOKEN, USER);
    const original = supabaseFake.from.getMockImplementation();
    supabaseFake.from.mockImplementation(() => {
      throw new Error('Authentication token column missing in query');
    });
    try {
      const res = await call(h, { cookie: TOKEN });

      expect(res.status).toBe(500);
    } finally {
      supabaseFake.from.mockImplementation(original!);
    }
  });

  // "Accepted" = the token was verified and the handler went on to query the database.
  // (The fake cannot complete every query, so the final status is not the signal here.)
  it('a valid session sent only as an Authorization: Bearer header is accepted', async () => {
    signIn(TOKEN, USER);

    const res = await call(h, { bearer: TOKEN });

    expect(res.status).not.toBe(401);
    expect(supabaseFake.auth.getUser).toHaveBeenCalledWith(TOKEN);
    expect(supabaseFake.from).toHaveBeenCalled();
  });

  it('a valid session cookie is still accepted', async () => {
    signIn(TOKEN, USER);

    const res = await call(h, { cookie: TOKEN });

    expect(res.status).not.toBe(401);
    expect(supabaseFake.auth.getUser).toHaveBeenCalledWith(TOKEN);
    expect(supabaseFake.from).toHaveBeenCalled();
  });
});
