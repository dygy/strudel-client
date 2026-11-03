/**
 * @spec: 018-strudel-mcp-server (functional 2.4)
 * @regression
 * "When an assistant creates a track in a folder, then after a reload it appears in that folder and its
 * web address opens it." Every other Worker test uses a stand-in for the site's routes. This one goes
 * through the real create route, with the token an assistant has, and opens the address it gets back
 * with the functions the site's page and the sidebar use.
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createTrackRoute } from '../tracks/create';
import { clearTestEnv, fakeState, insertedInto, resetSupabaseFake, signIn, useTestEnv } from './apiTestHelpers';
import { findTrackByFolderAndSlug, parseTrackUrlPath } from '../../../lib/slugUtils';
import { runQuery } from '../../../../../packages/mcp-worker/test/fakePostgrest.mjs';
import {
  assistantToken,
  MCP_URL,
  post,
  rpcBody,
  USER,
  withToken,
  worker,
} from '../../../../../packages/mcp-worker/test/helpers';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const token = assistantToken();
const ID_A = 'V1StGXR8_Z5jdHi6B-myA';
const ID_B = 'V1StGXR8_Z5jdHi6B-myB';

const assistant = () =>
  worker(
    (url) => {
      if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(USER));
      const { pathname, searchParams } = new URL(url);
      const rows = fakeState.tables[pathname.endsWith('/tracks') ? 'tracks' : 'folders'] ?? [];
      return new Response(JSON.stringify(runQuery(rows, searchParams)));
    },
    {},
    { site: (request) => createTrackRoute({ request } as never) as Promise<Response> },
  );

const create = async (args: Record<string, unknown>) => {
  const response = await assistant().fetch(
    MCP_URL,
    post(rpcBody('tools/call', { name: 'create_track', arguments: args }), withToken(token)),
  );
  const { result } = (await response.json()) as {
    result: { isError?: boolean; structuredContent: { webAddress: string }; content: Array<{ text: string }> };
  };
  expect(result.isError, result.content[0].text).toBeUndefined();
  return result.structuredContent;
};

/** What a reload finds: the rows in the database. */
const reload = () => {
  fakeState.tables.tracks = [...(fakeState.tables.tracks ?? []), ...insertedInto('tracks')];
  fakeState.inserts = [];
  return fakeState.tables.tracks as Array<{ id: string; name: string; folder: string | null; code: string }>;
};

/** What opening an address finds, the way `pages/repl/[...trackPath].astro` looks it up. */
const open = (webAddress: string) => {
  const parsed = parseTrackUrlPath(new URL(webAddress).pathname)!;
  const folders = fakeState.tables.folders as Array<{ id: string; path: string }>;
  return findTrackByFolderAndSlug(fakeState.tables.tracks as never[], parsed.folderPath, parsed.trackSlug, folders) as {
    id: string;
    code: string;
  } | null;
};

const folder = (id: string, path: string) => ({
  id,
  path,
  name: path.split('/').pop(),
  parent: null,
  user_id: USER.id,
  updated_at: 'v',
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  resetSupabaseFake();
  useTestEnv();
  signIn(token, USER);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fakeState.tables.tracks = [];
  fakeState.tables.folders = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearTestEnv();
});

describe('an assistant creates a track in a folder', () => {
  it.each([
    ['one word', 'Live'],
    ['words and capitals', 'Live Sets'],
    ['a nested folder', 'Live Sets/Night'],
    ['letters that are not Latin', 'Сеты'],
    ['a folder called Untitled', 'Untitled'],
    ['a folder with no letters or digits', '♪♪♪'],
    ['such a folder inside another', 'Live/♪♪♪'],
  ])('after a reload it is in that folder, and its address opens it: %s', async (_label, path) => {
    fakeState.tables.folders = [folder(ID_A, path)];
    const { webAddress } = await create({ name: 'My Song', code: 's("bd")', folder: ID_A });
    const rows = reload();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'My Song', folder: ID_A, code: 's("bd")', user_id: USER.id });
    expect(open(webAddress)?.id).toBe(rows[0].id);
  });

  it('at the top level, its address opens it too', async () => {
    const { webAddress } = await create({ name: 'My Song', code: 's("bd")' });
    expect(reload()[0].folder).toBeNull();
    expect(open(webAddress)?.code).toBe('s("bd")');
  });

  it('the address opens this one, not one of the same name in another folder', async () => {
    fakeState.tables.folders = [folder(ID_A, 'Live'), folder(ID_B, 'Studio')];
    const first = await create({ name: 'My Song', code: 'first', folder: ID_A });
    reload();
    const second = await create({ name: 'My Song', code: 'second', folder: ID_B });
    reload();
    expect(open(first.webAddress)?.code).toBe('first');
    expect(open(second.webAddress)?.code).toBe('second');
  });

  it("an address nobody created opens nothing, and someone else's folder gets no track", async () => {
    fakeState.tables.folders = [folder(ID_A, 'Live')];
    const { webAddress } = await create({ name: 'My Song', code: 's("bd")', folder: ID_A });
    reload();
    expect(open(webAddress.replace('my-song', 'other-song'))).toBeNull();
    expect(open(webAddress.replace('/live/', '/studio/'))).toBeNull();

    fakeState.tables.folders = [{ ...folder(ID_B, 'Theirs'), user_id: 'someone-else' }];
    const response = await assistant().fetch(
      MCP_URL,
      post(
        rpcBody('tools/call', { name: 'create_track', arguments: { name: 'Mine', folder: ID_B, code: '' } }),
        withToken(token),
      ),
    );
    const { result } = (await response.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    // The fake database has no RLS of its own: the Worker's user filter on folders is what's under test.
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ code: 'not_found', message: 'Folder not found' });
    expect(insertedInto('tracks')).toEqual([]);
  });
});
