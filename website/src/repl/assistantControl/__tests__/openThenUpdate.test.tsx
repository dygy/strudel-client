// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * @regression
 * Review blocker 1: `open_track`, then a queued `update_code`, with typing unsaved. The next command used
 * to run before React had rendered the new track, so the file manager still took track A for the open one
 * while the editor already held track B, and saved B's text over A. The real file manager hook, the real
 * library operation, real controls and handlers, in real React, over a fake server.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

const V1 = '2026-11-03T00:09:28.401191+00:00';
const USER = { id: 'user-1', email: 'u@example.test' };
const track = (id: string, name: string, code: string) => ({
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
  version: V1,
});
const ssrData = () => ({ tracks: [track('t1', 'one', 'code one'), track('t2', 'two', 'code two')], folders: [] });

function supabaseMock() {
  const select = () => {
    const builder = {
      eq: () => builder,
      maybeSingle: async () => ({ data: { updated_at: V1, code: 'code one', steps: [], name: 'one' }, error: null }),
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

const MOCKED = [
  '@src/hooks/useAuth',
  '@src/lib/supabase',
  '../../../lib/supabase',
  '@src/lib/authUtils',
  '../../../lib/authUtils',
  '@strudel/webaudio',
  '@src/i18n',
  '@src/settings',
  '@src/user_pattern_utils',
];

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the hooks under test are untyped here */
type Loose = any;
let useSupabaseFileManager: Loose;
let useFileManagerOperations: Loose;
let createCommandHandler: Loose;
let createTabControls: Loose;
let registerTrackSelect: Loose;
let trackVersions: Loose;
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('@src/hooks/useAuth', () => ({
    useAuth: () => ({ user: USER, isAuthenticated: true, loading: false, checkAuth: async () => true }),
  }));
  vi.doMock('@src/lib/supabase', supabaseMock);
  vi.doMock('../../../lib/supabase', supabaseMock);
  const session = async () => ({ success: true, session: { access_token: 'token' } });
  vi.doMock('@src/lib/authUtils', () => ({ ensureValidSession: session }));
  vi.doMock('../../../lib/authUtils', () => ({ ensureValidSession: session }));
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
  ({ useSupabaseFileManager } = await import('../../components/sidebar/hooks/useSupabaseFileManager'));
  ({ useFileManagerOperations } = await import('../../components/sidebar/hooks/useFileManagerOperations'));
  ({ createCommandHandler } = await import('../handlers'));
  ({ createTabControls } = await import('../tabControls'));
  ({ registerTrackSelect } = await import('../openTrack'));
  ({ trackVersions } = await import('../../trackVersion'));
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(() => {
  for (const id of MOCKED) vi.doUnmock(id);
  vi.resetModules();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What reached the server, by track. */
let saved: Array<{ trackId: string; code: string }>;
let editor: Loose;
let unmount: () => void;
let handle: (command: string, args: Record<string, unknown>) => Promise<Loose>;
let hook: Loose;

const flush = () =>
  React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(async () => {
  localStorage.clear();
  trackVersions.reset();
  saved = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const { trackId, updates } = JSON.parse(String(init.body));
      saved.push({ trackId, code: updates.code });
      return new Response(
        JSON.stringify({
          success: true,
          track: { id: trackId, code: updates.code, steps: [], updated_at: `${V1}-${saved.length}` },
        }),
        { status: 200 },
      );
    }),
  );
  for (const method of ['log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {});

  let editorTrack: string | null = null;
  editor = {
    code: '',
    setCode: (code: string) => {
      editor.code = code;
    },
    replaceCode: (code: string) => {
      editor.code = code;
    },
    evaluate: async () => {},
    repl: { scheduler: { started: false, cps: 0.5 }, state: {} },
  };
  const context = {
    editorRef: { current: editor },
    activeCode: '',
    handleUpdate: async ({ id, code }: { id: string; code: string }) => {
      editorTrack = id;
      editor.code = code;
    },
    setEditorTrackId: (id: string) => {
      editorTrack = id;
    },
    trackIds: () => ({ editor: editorTrack, playing: null }),
    isSwitching: () => false,
    runUpdate: async () => 'hot-swap',
    handleTogglePlay: async () => {},
  };
  const data = ssrData();
  const live = { context, fileManager: null as Loose, t: (key: string) => key };
  function Harness() {
    hook = useSupabaseFileManager(context, data, false);
    live.fileManager = hook;
    const operations = useFileManagerOperations({
      ...hook,
      context,
      t: live.t,
      deleteTrack: hook.deleteTrack,
      readOnly: false,
    });
    registerTrackSelect((opened: Loose) => operations.handleTrackSelect(opened));
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await React.act(async () => root.render(React.createElement(Harness)));
  await flush();
  unmount = () => React.act(() => root.unmount());
  handle = createCommandHandler(createTabControls({ live: () => live, enabled: () => true, phase: () => 'idle' }));

  await React.act(async () => hook.loadTrack(hook.tracks.t1));
  await flush();
});

afterEach(() => {
  unmount();
  registerTrackSelect(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const typed = 'typed in track one';

/** Outside `act`, so React renders when it really would: `act` would hold every render back until the end. */
async function sentTogether(update: Record<string, unknown>) {
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await Promise.all([handle('open_track', { trackId: 't2' }), handle('update_code', update)]);
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

describe('open_track, then a queued update_code, with typing unsaved', () => {
  it("leaves track one with its own text, and track two's text nowhere near it", async () => {
    editor.code = typed;
    // Sent together, as an assistant does: the second is queued before the first has finished.
    const [opened, updated] = await sentTogether({ code: 'new', trackId: 't2' });
    expect(opened).toMatchObject({ ok: true, result: { track: { id: 't2' } } });
    expect(updated).toMatchObject({ ok: true });
    expect(saved.filter((save) => save.trackId === 't1').map((save) => save.code)).toEqual([typed]);
    expect(saved.some((save) => save.code === 'code two' || save.code === 'new')).toBe(false);
    expect(editor.code).toBe('new');
  });

  it('with no typing: track one is not written at all', async () => {
    await sentTogether({ code: 'new', trackId: 't2' });
    expect(saved).toEqual([]);
    expect(editor.code).toBe('new');
  });

  it('an update naming the track it read is refused once another is open, and writes nothing', async () => {
    const [, updated] = await sentTogether({ code: 'new', trackId: 't1' });
    expect(updated).toEqual({ ok: false, code: 'track_changed', openTrackId: 't2' });
    expect(editor.code).toBe('code two');
    expect(saved).toEqual([]);
  });

  it('right after the library opens a track, the old track has nothing unsaved in it', async () => {
    await React.act(async () => {
      hook.loadTrack(hook.tracks.t2);
      // Before any render: the editor holds track two's text, and it must not read as an edit of track one.
      expect(hook.hasUnsavedEdits()).toBe(false);
    });
  });
});
