/**
 * DELETE /api/tracks/delete runs as the signed-in user (RLS), not with the service-role key,
 * which belongs to /api/admin/* only. A delete RLS refuses deletes zero rows without an error;
 * that must not be reported as success, or the track comes back on the next load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  createClientMock,
  fakeState,
  resetSupabaseFake,
  signIn,
  useTestEnv,
} from './apiTestHelpers';
import { DELETE as trackDelete } from '../tracks/delete';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.test.token';

const del = (body: unknown) =>
  trackDelete(apiContext({ url: 'http://test/api/tracks/delete', method: 'DELETE', token: TOKEN, body }));

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.tracks = [
    { id: 't1', name: 'mine', user_id: USER.id },
    { id: 't-other', name: 'theirs', user_id: 'user-other' },
  ];
  createClientMock.mockClear();
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('tracks/delete', () => {
  it("deletes with a client carrying the user's token, never the service-role key", async () => {
    const res = await del({ trackId: 't1' });

    expect(res.status).toBe(200);
    const calls = createClientMock.mock.calls as unknown as Array<[string, string, any]>;
    expect(calls.some(([, key]) => key === 'test-service')).toBe(false);
    expect(calls.some(([, , options]) => options?.global?.headers?.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('answers 404, not success, when no row was deleted (not found, or refused by RLS)', async () => {
    expect((await del({ trackId: 'missing' })).status).toBe(404);
    expect((await del({ trackId: 't-other' })).status).toBe(404);
  });

  it('refuses a missing track id with 400', async () => {
    expect((await del({})).status).toBe(400);
  });
});
