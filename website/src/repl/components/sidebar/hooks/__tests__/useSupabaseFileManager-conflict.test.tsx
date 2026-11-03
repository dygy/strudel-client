// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.5; tech 2.6)
 * The real file manager hook, real secureApi and real conflict controller, over a fake server: every
 * way a save starts ends at saveSpecificTrack, so this is where the promise is kept or broken.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import type { ReactNode } from 'react';

const V1 = '2026-11-03T00:09:28.401191+00:00';
const V2 = '2026-11-03T00:09:29.000002+00:00';
const V3 = '2026-11-03T00:09:30.000003+00:00';
const USER = { id: 'user-1', email: 'u@example.test' };
const DRAFT_KEY = 'strudel-conflict-draft:t1';

const track = (id: string, name: string, code: string, version = V1) => ({
  id,
  name,
  code,
  created: '2026-01-01T00:00:00Z',
  modified: '2026-01-01T00:00:00Z',
  folder: null,
  isMultitrack: false,
  steps: [],
  activeStep: 0,
  user_id: USER.id,
  version,
});
const ssrData = () => ({ tracks: [track('t1', 'one', 'code one'), track('t2', 'two', 'code two')], folders: [] });

/** The server's copy, read by the poll through the browser Supabase client. */
let remote: { updated_at: string; code: string; steps: unknown[]; name: string } | null;
/** Tracks created during a test, by id. */
let remoteOthers: Record<string, unknown>;

function supabaseMock() {
  const select = () => {
    let id = '';
    const builder = {
      eq: (column: string, value: string) => {
        if (column === 'id') id = value;
        return builder;
      },
      maybeSingle: async () => ({ data: id in remoteOthers ? remoteOthers[id] : remote, error: null }),
    };
    return builder;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }) },
      from: () => ({ select }),
    },
  };
}

let useSupabaseFileManager: typeof import('../useSupabaseFileManager').useSupabaseFileManager;
let trackVersions: typeof import('../../../../trackVersion').trackVersions;
let trackConflictStore: typeof import('../../../../trackConflict').trackConflictStore;
let toastActions: typeof import('@src/stores/toastStore').toastActions;
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('@src/hooks/useAuth', () => ({
    useAuth: () => ({
      user: USER,
      isAuthenticated: true,
      loading: false,
      checkAuth: async () => true,
    }),
  }));
  vi.doMock('@src/lib/supabase', supabaseMock);
  vi.doMock('../../../../../lib/supabase', supabaseMock);
  const session = async () => ({ success: true, session: { access_token: 'token' } });
  vi.doMock('@src/lib/authUtils', () => ({ ensureValidSession: session }));
  vi.doMock('../../../../../lib/authUtils', () => ({ ensureValidSession: session }));
  // loadTrack imports this without waiting. Left in flight across the resetModules in afterAll, it
  // stalls the next file's imports for a minute (vitest's RPC timeout), so it never starts here.
  vi.doMock('@strudel/webaudio', () => ({ preloadTrackSamples: async () => {} }));
  vi.doMock('@src/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
  vi.doMock('@src/settings', () => ({
    useSettings: () => ({ isAutosaveEnabled: false, autosaveInterval: 100000 }),
    settingsMap: { get: () => ({}) },
  }));
  vi.doMock('@src/user_pattern_utils', () => ({
    useActivePattern: () => null,
    getActivePattern: () => null,
    setActivePattern: () => {},
  }));
  ({ useSupabaseFileManager } = await import('../useSupabaseFileManager'));
  ({ trackVersions } = await import('../../../../trackVersion'));
  ({ trackConflictStore } = await import('../../../../trackConflict'));
  ({ toastActions } = await import('@src/stores/toastStore'));
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(() => {
  for (const id of [
    '@src/hooks/useAuth',
    '@src/lib/supabase',
    '../../../../../lib/supabase',
    '@src/lib/authUtils',
    '../../../../../lib/authUtils',
    '@strudel/webaudio',
    '@src/i18n',
    '@src/settings',
    '@src/user_pattern_utils',
  ]) {
    vi.doUnmock(id);
  }
  vi.resetModules();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fetchMock: ReturnType<typeof vi.fn>;
let editor: { code: string; setCode: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> };
let handleUpdate: ReturnType<typeof vi.fn>;
let hook: ReturnType<typeof import('../useSupabaseFileManager').useSupabaseFileManager>;
let unmount: () => void;

const ok = (row: unknown) => new Response(JSON.stringify({ success: true, track: row }), { status: 200 });
const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

async function flush() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  const data = ssrData();
  const context = { editorRef: { current: editor }, activeCode: '', handleUpdate };
  function Harness(): ReactNode {
    hook = useSupabaseFileManager(context as never, data, false);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  await flush();
  unmount = () => React.act(() => root.unmount());
}

async function openTrack(id: 't1' | 't2' = 't1') {
  await React.act(async () => hook.loadTrack(hook.tracks[id]));
  editor.code = hook.tracks[id].code;
  await flush();
}

async function save(id: 't1' | 't2' = 't1', toast = false): Promise<boolean> {
  let result = false;
  await React.act(async () => {
    result = await hook.saveSpecificTrack(id, toast);
  });
  return result;
}

beforeEach(async () => {
  localStorage.clear();
  trackVersions.reset();
  trackConflictStore.set(null);
  remote = { updated_at: V1, code: 'code one', steps: [], name: 'one' };
  remoteOthers = {};
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  editor = { code: '', setCode: vi.fn(), evaluate: vi.fn() };
  editor.setCode.mockImplementation((code: string) => {
    editor.code = code;
  });
  handleUpdate = vi.fn(async ({ code }: { code: string }) => {
    editor.code = code;
  });
  for (const method of ['log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  await mount();
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('saving', () => {
  it('names the version from the page data, and the next save names the one it got back', async () => {
    await openTrack();
    editor.code = 'typed';
    fetchMock.mockResolvedValueOnce(ok({ id: 't1', code: 'typed', steps: [], updated_at: V2 }));
    await expect(save()).resolves.toBe(true);
    expect(sent()[0].expectedVersion).toBe(V1);

    editor.code = 'typed more';
    fetchMock.mockResolvedValueOnce(ok({ id: 't1', code: 'typed more', steps: [], updated_at: V3 }));
    await expect(save()).resolves.toBe(true);
    expect(sent()[1].expectedVersion).toBe(V2);
    expect(trackConflictStore.get()).toBeNull();
  });

  it('a poll right after a save agrees with it: no notice', async () => {
    await openTrack();
    editor.code = 'typed';
    fetchMock.mockResolvedValueOnce(ok({ id: 't1', code: 'typed', steps: [], updated_at: V2 }));
    await save();
    remote = { updated_at: V2, code: 'typed', steps: [], name: 'one' };
    await React.act(async () => hook.trackConflict!.check());
    expect(trackConflictStore.get()).toBeNull();
  });

  it('a poll that sees only a rename raises nothing, however much was typed', async () => {
    await openTrack();
    editor.code = 'typing, not saved yet';
    remote = { updated_at: V2, code: 'code one', steps: [], name: 'renamed elsewhere' };
    await React.act(async () => hook.trackConflict!.check());
    expect(trackConflictStore.get()).toBeNull();
    expect(trackVersions.get('t1')?.version).toBe(V2);
  });
});

describe('opening a track', () => {
  it('that changed since the page loaded raises the notice: the page data is the baseline', async () => {
    remote = { updated_at: V2, code: 'changed before I opened it', steps: [], name: 'one' };
    await openTrack();
    expect(trackConflictStore.get()).toMatchObject({ trackId: 't1', kind: 'changed' });
  });
});

describe('a save the server refuses', () => {
  beforeEach(async () => {
    await openTrack();
    editor.code = 'typed';
    const toast = vi.spyOn(toastActions, 'error');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'x', code: 'version_conflict', current: { version: V2, code: 'theirs', steps: [] } }),
        { status: 409 },
      ),
    );
    await expect(save('t1', true)).resolves.toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('raises the notice instead of an error toast, and keeps the text', () => {
    expect(trackConflictStore.get()).toMatchObject({ trackId: 't1', kind: 'changed' });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).code).toBe('typed');
  });

  it('then every save path stops: nothing leaves the tab, and the text keeps reaching the draft', async () => {
    fetchMock.mockClear();
    editor.code = 'typed further';
    await expect(save()).resolves.toBe(false);
    await expect(hook.saveCurrentTrack(false)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).code).toBe('typed further');
  });

  it('Load the new version only changes the editor: no evaluate, no reset, no save', async () => {
    fetchMock.mockClear();
    handleUpdate.mockClear();
    remote = { updated_at: V2, code: 'theirs', steps: [], name: 'one' };
    await React.act(async () => hook.trackConflict!.loadNewVersion());
    expect(handleUpdate.mock.calls).toEqual([[{ id: 't1', code: 'theirs' }, false]]);
    expect(editor.evaluate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(editor.code).toBe('theirs');
    expect(trackConflictStore.get()).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    // And autosave doesn't take the new text for typing.
    await expect(save()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Keep mine saves the text on the current version, and normal saving resumes', async () => {
    fetchMock.mockClear();
    remote = { updated_at: V3, code: 'theirs', steps: [], name: 'one' };
    fetchMock.mockResolvedValueOnce(
      ok({ id: 't1', code: 'typed', steps: [], updated_at: '2026-11-03T00:10:00.000001+00:00' }),
    );
    await React.act(async () => hook.trackConflict!.keepMine());
    expect(sent()[0]).toMatchObject({ updates: { code: 'typed' }, expectedVersion: V3 });
    expect(trackConflictStore.get()).toBeNull();
    expect(editor.evaluate).not.toHaveBeenCalled();
    expect(Object.keys(hook.tracks).sort()).toEqual(['t1', 't2']);
    expect(hook.tracks.t1).toMatchObject({ name: 'one', code: 'typed' });

    editor.code = 'typed again';
    fetchMock.mockResolvedValueOnce(
      ok({ id: 't1', code: 'typed again', steps: [], updated_at: '2026-11-03T00:10:01.000001+00:00' }),
    );
    await expect(save()).resolves.toBe(true);
  });
});

describe('a track that was deleted', () => {
  it('a 404 on save raises the deleted notice and keeps the text', async () => {
    await openTrack();
    editor.code = 'typed';
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Track not found' }), { status: 404 }));
    await expect(save()).resolves.toBe(false);
    expect(trackConflictStore.get()).toMatchObject({ kind: 'deleted' });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).code).toBe('typed');
  });

  it('Keep mine creates it again, in place of the old one', async () => {
    await openTrack();
    editor.code = 'typed';
    remote = null;
    await React.act(async () => hook.trackConflict!.check());
    expect(trackConflictStore.get()?.kind).toBe('deleted');

    const created = { ...track('t1-new', 'one', 'typed', V3) };
    remoteOthers['t1-new'] = { updated_at: V3, code: 'typed', steps: [], name: 'one' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, track: created }), { status: 201 }));
    await React.act(async () => hook.trackConflict!.keepMine());
    expect(sent()[0]).toMatchObject({ name: 'one', code: 'typed' });
    expect(hook.tracks.t1).toBeUndefined();
    expect(hook.tracks['t1-new']).toBeDefined();
    expect(hook.selectedTrack).toBe('t1-new');
    expect(trackConflictStore.get()).toBeNull();
    expect(editor.evaluate).not.toHaveBeenCalled();
  });

  it('with no session is not read as deleted', async () => {
    await openTrack();
    const { supabase } = await import('@src/lib/supabase');
    const getSession = vi
      .spyOn(supabase.auth, 'getSession')
      .mockResolvedValue({ data: { session: null }, error: null } as never);
    remote = null;
    await React.act(async () => hook.trackConflict!.check());
    expect(trackConflictStore.get()).toBeNull();
    getSession.mockRestore();
  });
});

describe('the track switch race', () => {
  it('a save refused after the switch keeps its text, and the next track saves normally', async () => {
    await openTrack('t1');
    editor.code = 'typed in one';
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    let inFlight: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      inFlight = hook.saveSpecificTrack('t1', false);
    });
    await flush();

    await openTrack('t2');
    await React.act(async () => {
      answer(
        new Response(
          JSON.stringify({ error: 'x', code: 'version_conflict', current: { version: V2, code: 'theirs', steps: [] } }),
          { status: 409 },
        ),
      );
      await inFlight;
    });

    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).code).toBe('typed in one');
    expect(trackConflictStore.get()).toBeNull();
    expect(trackVersions.isPaused('t1')).toBe(true);

    editor.code = 'typed in two';
    fetchMock.mockResolvedValueOnce(ok({ id: 't2', code: 'typed in two', steps: [], updated_at: V3 }));
    await expect(save('t2')).resolves.toBe(true);
  });
});

describe('the read-only view', () => {
  it('does not watch: its reads would find nothing, and it never saves', async () => {
    unmount();
    const data = ssrData();
    const context = { editorRef: { current: editor }, activeCode: '', handleUpdate };
    function Harness(): ReactNode {
      hook = useSupabaseFileManager(context as never, data, true);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await React.act(async () => root.render(React.createElement(Harness)));
    await flush();
    unmount = () => React.act(() => root.unmount());
    expect(hook.trackConflict).toBeNull();
  });
});
