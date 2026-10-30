/**
 * Sidebar track rename and drag-move (useFileManagerOperations).
 * Regression (2026-10-30, "track rename only changes local state"): the rename never reached the
 * server (a reload brought the old name back), and neither rename nor move moved the open
 * track's URL, which the autosave guard resolves the open track from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Call the hook as a plain function: no renderer is needed for useCallback/useRef.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useCallback: <T>(fn: T) => fn, useRef: <T>(v: T) => ({ current: v }) };
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('@src/stores/toastStore', () => ({ toastActions: toast }));

const pattern = vi.hoisted(() => ({ value: 'test/taka?step=intro' }));
vi.mock('@src/user_pattern_utils', () => ({
  getActivePattern: () => pattern.value,
  setActivePattern: vi.fn((k: string) => {
    pattern.value = k;
  }),
}));

// isolate:false shares the module cache across files: a file that ran earlier (e.g. a render
// test of FileManagerRefactored) may already hold this hook bound to the real toast store and
// pattern utils, so the mocks above would not apply. Load fresh copies.
vi.resetModules();
const { useFileManagerOperations } = await import('../useFileManagerOperations');

const TEST = 'jxldrFutJzzdJcI0FcgSZ';
const BEATS = 'aB3dEfGhIjKlMnOpQrStU';

type Map<T> = Record<string, T>;
const apply = <T>(cur: Map<T>, u: Map<T> | ((p: Map<T>) => Map<T>)) => (typeof u === 'function' ? u(cur) : u);

let fetchMock: ReturnType<typeof vi.fn>;
const respond = (status: number, body: unknown = {}) =>
  (fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status })));

function setup(renameValue = '') {
  const state = {
    folders: {
      [TEST]: { id: TEST, name: 'test', path: 'test', created: '' },
      [BEATS]: { id: BEATS, name: 'My Beats', path: 'My Beats', created: '' },
    } as Map<any>,
    tracks: {
      taka: { id: 'taka', name: 'taka', code: 'x', created: '', modified: '', folder: TEST },
      sibling: { id: 'sibling', name: 'Groove', code: 'y', created: '', modified: '', folder: 'test' },
      beat: { id: 'beat', name: 'Taka', code: 'z', created: '', modified: '', folder: BEATS },
    } as Map<any>,
    renamingTrack: null as string | null,
    renameValue,
  };
  const props: any = {
    ...state,
    selectedTrack: 'taka',
    renamingFolder: null,
    renamingStep: null,
    setFolders: vi.fn((u) => (state.folders = apply(state.folders, u))),
    setTracks: vi.fn((u) => (state.tracks = apply(state.tracks, u))),
    setRenamingTrack: vi.fn((v) => (state.renamingTrack = v)),
    setRenameValue: vi.fn((v) => (state.renameValue = v)),
    t: (k: string) => k,
    context: {},
  };
  const ops = () => useFileManagerOperations({ ...props, ...state });
  return { state, ops };
}

const sentBody = (call = 0) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

beforeEach(() => {
  pattern.value = 'test/taka?step=intro';
  Object.values(toast).forEach((f) => f.mockClear());
  respond(200, { success: true });
  vi.stubGlobal('fetch', (...a: unknown[]) => fetchMock(...a));
  const location = { pathname: '/repl/test/taka', search: '?step=intro' };
  vi.stubGlobal('window', {
    location,
    history: {
      state: { trackId: 'taka' },
      replaceState: vi.fn((_s: unknown, _t: string, url: string) => {
        const [p, q] = url.split('?');
        location.pathname = p;
        location.search = q ? `?${q}` : '';
      }),
    },
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('track rename from the sidebar', () => {
  it('persists the new name through /api/tracks/update', async () => {
    const { state, ops } = setup(' Taka Two ');
    state.renamingTrack = 'taka';

    await ops().finishRename();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tracks/update');
    expect(sentBody()).toEqual({ trackId: 'taka', updates: { name: 'Taka Two' } });
    expect(state.tracks.taka.name).toBe('Taka Two');
    expect(toast.success).toHaveBeenCalledWith('files:trackRenamed');
  });

  it('moves the open track URL (keeping ?step=) so autosave still resolves it', async () => {
    const { state, ops } = setup('Taka Two');
    state.renamingTrack = 'taka';

    await ops().finishRename();

    expect(window.location.pathname).toBe('/repl/test/taka-two');
    expect(window.location.search).toBe('?step=intro');
    expect(pattern.value).toBe('test/taka-two?step=intro');
  });

  it('reverts the name and the URL when the server refuses', async () => {
    respond(409, { code: 'duplicate' });
    const { state, ops } = setup('Taka Two');
    state.renamingTrack = 'taka';

    await ops().finishRename();

    expect(state.tracks.taka.name).toBe('taka');
    expect(window.location.pathname).toBe('/repl/test/taka');
    expect(pattern.value).toBe('test/taka?step=intro');
    expect(toast.error).toHaveBeenCalledWith('files:errors.trackNameTaken');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    ['the same name in another case', 'groove'],
    ['a name with the same URL slug', 'Groove!!'],
  ])('refuses %s of a sibling (stored by path) without sending, keeping the input open', async (_l, name) => {
    const { state, ops } = setup(name);
    state.renamingTrack = 'taka';

    await ops().finishRename();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('files:errors.trackNameTaken');
    expect(state.renamingTrack).toBe('taka');
  });

  it('a second finish (blur after Enter) does not send a second update', async () => {
    const { state, ops } = setup('Live');
    state.renamingTrack = 'taka';
    const o = ops();

    await Promise.all([o.finishRename(), o.finishRename()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('track move from the sidebar (drag and drop)', () => {
  it('persists the folder id and moves the open track URL', async () => {
    const { state, ops } = setup();
    state.tracks.beat.name = 'other';

    await ops().handleMoveItem('taka', 'track', BEATS);

    expect(sentBody()).toEqual({ trackId: 'taka', updates: { folder: BEATS } });
    expect(state.tracks.taka.folder).toBe('My Beats');
    expect(window.location.pathname).toBe('/repl/my-beats/taka');
    expect(toast.success).toHaveBeenCalledWith('files:trackMoved');
  });

  it('refuses a move next to a same-named track without sending', async () => {
    const { ops } = setup();

    await ops().handleMoveItem('taka', 'track', BEATS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('files:errors.trackNameTaken');
  });

  it('reverts folder and URL when the server refuses', async () => {
    respond(500);
    const { state, ops } = setup();
    state.tracks.beat.name = 'other';

    await ops().handleMoveItem('taka', 'track', BEATS);

    expect(state.tracks.taka.folder).toBe(TEST);
    expect(window.location.pathname).toBe('/repl/test/taka');
    expect(toast.error).toHaveBeenCalledWith('files:errors.moveFailed');
  });

  it('dropping onto its own folder sends nothing', async () => {
    const { ops } = setup();

    await ops().handleMoveItem('taka', 'track', TEST);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
