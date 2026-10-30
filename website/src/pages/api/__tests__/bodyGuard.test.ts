/**
 * Every API route that reads a JSON body refuses an unreadable one with 400 "Invalid data format"
 * (via `lib/apiBody.ts`) instead of throwing into a 500, and still checks sign-in first.
 * The import routes have their own, deeper tests in import.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiContext, clearTestEnv, fakeState, resetSupabaseFake, signIn, useTestEnv } from './apiTestHelpers';

import { POST as folderCreate } from '../folders/create';
import { PUT as folderUpdate } from '../folders/update';
import { POST as trackCreate } from '../tracks/create';
import { DELETE as trackDelete } from '../tracks/delete';
import { PUT as trackUpdate } from '../tracks/update';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session', email: 'someone@example.test' };
// JWT-shaped: api/_auth.ts only accepts a cookie value that contains a dot.
const TOKEN = 'eyJ.test.token';

// A well-formed body for each route, used only to show it is NOT refused as "Invalid data format".
const routes = [
  {
    name: 'POST folders/create',
    handler: folderCreate,
    method: 'POST',
    ok: { id: 'f1', name: 'Drums', path: 'Drums' },
  },
  {
    name: 'PUT folders/update',
    handler: folderUpdate,
    method: 'PUT',
    ok: { folderId: 'f1', updates: { name: 'Drums 2' } },
  },
  { name: 'POST tracks/create', handler: trackCreate, method: 'POST', ok: { name: 'Beat', code: 's("bd")' } },
  { name: 'DELETE tracks/delete', handler: trackDelete, method: 'DELETE', ok: { trackId: 't1' } },
  {
    name: 'PUT tracks/update',
    handler: trackUpdate,
    method: 'PUT',
    ok: { trackId: 't1', updates: { code: 's("bd")' } },
  },
] as const;

const url = 'http://test/api/route';
const call = (route: (typeof routes)[number], opts: { token?: string; rawBody?: string; body?: unknown }) =>
  route.handler(apiContext({ url, method: route.method, ...opts }));

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

describe.each(routes)('$name: an unreadable body', (route) => {
  it.each([
    ['unparseable JSON', '{"name": [ oops'],
    ['a JSON null', 'null'],
    ['a bare array', '[]'],
  ])(
    '%s from a signed-in user is refused with 400 "Invalid data format" and nothing is written',
    async (_l, rawBody) => {
      signIn(TOKEN, USER);

      const res = await call(route, { token: TOKEN, rawBody });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'Invalid data format' });
      expect(fakeState.inserts).toEqual([]);
      expect(fakeState.mutations).toEqual([]);
    },
  );

  it('from a signed-out caller is never answered as "Invalid data format" (sign-in is checked first)', async () => {
    const res = await call(route, { rawBody: 'null' });

    expect(res.status).not.toBe(400);
    expect(fakeState.inserts).toEqual([]);
    expect(fakeState.mutations).toEqual([]);
  });

  it('a well-formed body gets past validation (not a 400)', async () => {
    signIn(TOKEN, USER);

    const res = await call(route, { token: TOKEN, body: route.ok });

    const json = await res.json().catch(() => ({}));
    expect(json.error).not.toBe('Invalid data format');
    expect(res.status).not.toBe(400);
  });
});
