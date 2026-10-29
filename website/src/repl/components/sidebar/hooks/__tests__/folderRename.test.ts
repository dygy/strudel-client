/**
 * Sidebar folder rename wiring (useFileManagerOperations).
 * Regression (2026-10-29, "can't rename folder"): the tree passes the folder PATH, the hook looked it
 * up in the id-keyed folders map, so the input opened empty and Enter did nothing — and even a hit
 * only changed local state (re-keyed by path) without calling /api/folders/update.
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

import { useFileManagerOperations } from '../useFileManagerOperations';
import { setActivePattern } from '@src/user_pattern_utils';

const TEST = 'jxldrFutJzzdJcI0FcgSZ';
const BEATS = 'aB3dEfGhIjKlMnOpQrStU';

type Map<T> = Record<string, T>;
const apply = <T>(cur: Map<T>, u: Map<T> | ((p: Map<T>) => Map<T>)) => (typeof u === 'function' ? u(cur) : u);

function setup(
  renameValue: string,
  updateFolder = vi.fn(async (id: string, u: { name?: string }) => ({ id, name: u.name!, path: u.name! })),
) {
  const state = {
    folders: {
      [TEST]: { id: TEST, name: 'test', path: 'test', created: '' },
      [BEATS]: { id: BEATS, name: 'My Beats', path: 'My Beats', created: '' },
    } as Map<any>,
    tracks: {
      taka: { id: 'taka', name: 'taka', code: 'x', created: '', modified: '', folder: TEST },
      legacy: { id: 'legacy', name: 'old', code: 'y', created: '', modified: '', folder: 'test' },
    } as Map<any>,
    renamingFolder: null as string | null,
    renameValue,
  };
  const props: any = {
    ...state,
    selectedTrack: 'taka',
    renamingTrack: null,
    renamingStep: null,
    setFolders: vi.fn((u) => (state.folders = apply(state.folders, u))),
    setTracks: vi.fn((u) => (state.tracks = apply(state.tracks, u))),
    setRenamingFolder: vi.fn((v) => (state.renamingFolder = v)),
    setRenameValue: vi.fn((v) => (state.renameValue = v)),
    t: (k: string) => k,
    updateFolder,
    context: {},
  };
  const ops = () => useFileManagerOperations({ ...props, ...state });
  return { state, props, ops, updateFolder };
}

beforeEach(() => {
  pattern.value = 'test/taka?step=intro';
  vi.mocked(setActivePattern).mockClear();
  Object.values(toast).forEach((f) => f.mockClear());
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

describe('folder rename from the sidebar', () => {
  it('opening rename by the tree path pre-fills the current name', () => {
    const { state, ops } = setup('');
    ops().handleFolderRename('test');
    expect(state.renamingFolder).toBe('test');
    expect(state.renameValue).toBe('test');
  });

  it('Enter persists through updateFolder by folder id and keeps the map id-keyed', async () => {
    const { state, ops, updateFolder } = setup('Live Set');
    state.renamingFolder = 'test';

    await ops().finishRenameFolder();

    expect(updateFolder).toHaveBeenCalledWith(TEST, { name: 'Live Set' });
    expect(Object.keys(state.folders).sort()).toEqual([BEATS, TEST].sort());
    expect(state.folders[TEST]).toMatchObject({ name: 'Live Set', path: 'Live Set' });
    expect(state.tracks.legacy.folder).toBe('Live Set');
    expect(state.tracks.taka.folder).toBe(TEST);
    expect(toast.success).toHaveBeenCalledWith('files:folderRenamed');
  });

  it('moves the open track URL (keeping ?step=) so the autosave URL guard still resolves it', async () => {
    const { state, ops } = setup('Live Set');
    state.renamingFolder = 'test';

    await ops().finishRenameFolder();

    expect(window.history.replaceState).toHaveBeenCalledWith({ trackId: 'taka' }, '', '/repl/live-set/taka?step=intro');
    expect(setActivePattern).toHaveBeenCalledWith('live-set/taka?step=intro');
  });

  it('a second finish (blur after Enter) does not send a second update', async () => {
    const { state, ops, updateFolder } = setup('Live');
    state.renamingFolder = 'test';
    const o = ops();
    await Promise.all([o.finishRenameFolder(), o.finishRenameFolder()]);
    expect(updateFolder).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['', 'files:errors.folderNameEmpty'],
    ['a/b', 'files:errors.folderNameSlash'],
    ['my beats', 'files:errors.folderNameTaken'],
  ])('refuses %j with a toast and sends nothing', async (name, key) => {
    const { state, ops, updateFolder } = setup(name);
    state.renamingFolder = 'test';

    await ops().finishRenameFolder();

    expect(toast.error).toHaveBeenCalledWith(key);
    expect(updateFolder).not.toHaveBeenCalled();
    expect(state.folders[TEST].name).toBe('test');
  });

  it('reverts folders, tracks and URL when the server refuses', async () => {
    const { state, ops } = setup(
      'Live',
      vi.fn(async () => null),
    );
    state.renamingFolder = 'test';

    await ops().finishRenameFolder();

    expect(state.folders[TEST]).toMatchObject({ name: 'test', path: 'test' });
    expect(state.tracks.legacy.folder).toBe('test');
    expect(window.location.pathname).toBe('/repl/test/taka');
    expect(pattern.value).toBe('test/taka?step=intro');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('on an incomplete server rollback, reloads from the server instead of reverting locally', async () => {
    const { state, ops, props } = setup(
      'Live',
      vi.fn(async () => ({ rollbackIncomplete: true as const })),
    );
    props.refreshFromSupabase = vi.fn(async () => {});
    state.renamingFolder = 'test';
    const before = state.folders;

    await ops().finishRenameFolder();

    expect(props.refreshFromSupabase).toHaveBeenCalledTimes(1);
    expect(props.setFolders).toHaveBeenCalledTimes(1); // the optimistic apply only, no local revert
    expect(state.folders).not.toBe(before);
    expect(window.location.pathname).toBe('/repl/test/taka');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
