/**
 * @spec: 018-strudel-mcp-server (functional 2.5, 2.6; tech 2.6)
 * The conflict controller: when a notice is raised and when it must not be, what happens to the text,
 * and that neither choice can reach audio (its only way into the editor is setEditorCode).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackConflictController,
  POLL_INTERVAL_MS,
  trackConflictStore,
  type ServerRead,
  type TrackConflictDeps,
} from '../trackConflict';
import { createTrackVersions, VersionConflictError, type ServerTrack, type TrackVersions } from '../trackVersion';

const V1 = '2026-11-03T00:09:28.401191+00:00';
const V2 = '2026-11-03T00:09:29.000002+00:00';
const V3 = '2026-11-03T00:09:30.000003+00:00';
const USER = 'user-1';
const KEY = 'strudel-conflict-draft:t1';

const server = (code: string, version: string, extra: Partial<ServerTrack> = {}): ServerTrack => ({
  version,
  code,
  steps: [],
  ...extra,
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

interface World {
  versions: TrackVersions;
  storage: ReturnType<typeof memoryStorage>;
  remote: ServerRead<ServerTrack>;
  editor: string;
  lastSaved: string;
  deps: TrackConflictDeps;
  setEditorCode: ReturnType<typeof vi.fn>;
  saveCode: ReturnType<typeof vi.fn>;
  applySynced: ReturnType<typeof vi.fn>;
  recreate: ReturnType<typeof vi.fn>;
  removeLocal: ReturnType<typeof vi.fn>;
  visible: boolean;
}

function makeWorld(): World {
  const versions = createTrackVersions();
  versions.set('t1', server('base', V1));
  const world: World = {
    versions,
    storage: memoryStorage(),
    remote: { status: 'found', value: server('base', V1) },
    editor: 'base',
    lastSaved: 'base',
    visible: true,
    setEditorCode: vi.fn((_id: string, code: string) => {
      world.editor = code;
    }),
    saveCode: vi.fn(async () => {}),
    applySynced: vi.fn((_id: string, code: string) => {
      world.lastSaved = code;
    }),
    recreate: vi.fn(async () => true),
    removeLocal: vi.fn(),
    deps: {} as TrackConflictDeps,
  };
  world.deps = {
    userId: USER,
    versions,
    storage: world.storage,
    isVisible: () => world.visible,
    readVersion: async () =>
      world.remote.status === 'found' ? { status: 'found', value: world.remote.value.version } : world.remote,
    readTrack: async () => world.remote,
    getEditorCode: () => world.editor,
    getLastSavedCode: () => world.lastSaved,
    getLocalTrack: (id) =>
      id === 't1' ? { name: 'Track', folder: 'f1', isMultitrack: false, steps: [], activeStep: 0 } : undefined,
    setEditorCode: world.setEditorCode,
    saveCode: world.saveCode,
    applySynced: world.applySynced,
    recreate: world.recreate,
    removeLocal: world.removeLocal,
  };
  return world;
}

const draftOf = (world: World) => JSON.parse(world.storage.getItem(KEY) ?? 'null');
const notice = () => trackConflictStore.get();

let world: World;
let controller: ReturnType<typeof createTrackConflictController>;

beforeEach(() => {
  trackConflictStore.set(null);
  world = makeWorld();
  controller = createTrackConflictController(world.deps);
});

afterEach(() => {
  controller.stopWatching();
  vi.useRealTimers();
  trackConflictStore.set(null);
});

const open = async () => {
  controller.trackOpened('t1');
  await vi.waitFor(() => {});
};

describe('detection', () => {
  it('raises nothing while nothing changed: normal typing has no notice', async () => {
    world.editor = 'typing...';
    await open();
    await controller.check();
    expect(notice()).toBeNull();
    expect(world.versions.isPaused('t1')).toBe(false);
  });

  it('raises the notice and pauses saving when the content changed elsewhere', async () => {
    await open();
    world.remote = { status: 'found', value: server('assistant code', V2) };
    await controller.check();
    expect(notice()).toMatchObject({ trackId: 't1', kind: 'changed', restored: false });
    expect(world.versions.isPaused('t1')).toBe(true);
  });

  it('finds out within 30 seconds of a change, by polling every 20', async () => {
    vi.useFakeTimers();
    controller.startWatching();
    await controller.trackOpened('t1');
    world.remote = { status: 'found', value: server('changed', V2) };
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(30_000);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(notice()).not.toBeNull();
  });

  it('does not poll a hidden tab, and checks on its return', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    controller.startWatching(target as unknown as Window);
    controller.trackOpened('t1');
    await vi.advanceTimersByTimeAsync(0);
    world.visible = false;
    const read = vi.spyOn(world.deps, 'readVersion');
    world.remote = { status: 'found', value: server('changed', V2) };
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(read).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
    world.visible = true;
    target.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(notice()).not.toBeNull();
  });

  it('stops polling when it stops watching', async () => {
    vi.useFakeTimers();
    controller.startWatching();
    controller.trackOpened('t1');
    await vi.advanceTimersByTimeAsync(0);
    controller.stopWatching();
    const read = vi.spyOn(world.deps, 'readVersion');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(read).not.toHaveBeenCalled();
  });

  it('adopts a new version silently when only the version moved (folder move, rename)', async () => {
    await open();
    world.editor = 'typing...';
    world.remote = { status: 'found', value: server('base', V2, { folder: 'moved', name: 'renamed' }) };
    await controller.check();
    expect(notice()).toBeNull();
    expect(world.versions.get('t1')?.version).toBe(V2);
    expect(world.versions.isPaused('t1')).toBe(false);
  });

  it('a failed read decides nothing', async () => {
    await open();
    world.remote = { status: 'unknown' };
    await controller.check();
    expect(notice()).toBeNull();
    expect(world.versions.get('t1')?.version).toBe(V1);
  });

  it('a first look at a track with no baseline takes it, with no notice', async () => {
    world.versions.forget('t1');
    world.remote = { status: 'found', value: server('anything', V2) };
    await open();
    expect(notice()).toBeNull();
    expect(world.versions.get('t1')?.version).toBe(V2);
  });

  it('a conflict on a track the user has left does not appear over the next one', async () => {
    await open();
    let release: (read: ServerRead<string>) => void = () => {};
    world.deps.readVersion = () => new Promise((resolve) => (release = resolve));
    const check = controller.check();
    world.versions.setOpenTrack('t2');
    release({ status: 'found', value: V2 });
    await check;
    expect(notice()).toBeNull();
  });
});

describe('its own save is never read as a conflict', () => {
  it('skips the read while a save is in flight', async () => {
    await open();
    const read = vi.spyOn(world.deps, 'readVersion');
    let finish: () => void = () => {};
    const save = world.versions.serialize('t1', () => new Promise<void>((resolve) => (finish = resolve)));
    await controller.check();
    expect(read).not.toHaveBeenCalled();
    finish();
    await save;
  });

  it('discards a read that a save started during, even if that read saw the new version', async () => {
    await open();
    let release: (read: ServerRead<string>) => void = () => {};
    world.deps.readVersion = () => new Promise((resolve) => (release = resolve));
    const check = controller.check();

    // The save lands on the server and the read sees its version, before the answer reaches the tab.
    let finish: () => void = () => {};
    const save = world.versions.serialize('t1', () => new Promise<void>((resolve) => (finish = resolve)));
    world.remote = { status: 'found', value: server('my own save', V2) };
    release({ status: 'found', value: V2 });
    await check;
    expect(notice()).toBeNull();

    world.versions.set('t1', server('my own save', V2));
    finish();
    await save;
  });

  it('discards a read that a whole save fitted inside', async () => {
    await open();
    let release: (read: ServerRead<ServerTrack>) => void = () => {};
    world.remote = { status: 'found', value: server('base', V2) };
    world.deps.readTrack = () => new Promise((resolve) => (release = resolve));
    const check = controller.check();
    await vi.waitFor(() => {});
    await world.versions.serialize('t1', async () => world.versions.set('t1', server('my own save', V2)));
    release({ status: 'found', value: server('my own save', V2) });
    await check;
    expect(notice()).toBeNull();
  });

  it('and the next poll agrees with the save that finished', async () => {
    await open();
    await world.versions.serialize('t1', async () => world.versions.set('t1', server('mine', V2)));
    world.remote = { status: 'found', value: server('mine', V2) };
    await controller.check();
    expect(notice()).toBeNull();
  });
});

describe('the text', () => {
  it('goes to a draft when the conflict is raised, if anything was typed', async () => {
    await open();
    world.editor = 'typed by the user';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    expect(draftOf(world)).toMatchObject({ userId: USER, code: 'typed by the user', name: 'Track', folder: 'f1' });
  });

  it('nothing typed means no draft: a reload just shows the new version', async () => {
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    expect(draftOf(world)).toBeNull();
  });

  it('what is typed during the conflict reaches the draft', async () => {
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    world.editor = 'typed after the notice';
    controller.flushDraft();
    expect(draftOf(world).code).toBe('typed after the notice');
  });

  it('a paused save writes the draft, not the server', async () => {
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    controller.savePaused('t1', 'autosave tried this');
    expect(draftOf(world).code).toBe('autosave tried this');
    expect(world.saveCode).not.toHaveBeenCalled();
  });

  it('a refused save keeps the text it was writing, not what the editor holds by then', async () => {
    await open();
    world.editor = 'already the next track';
    controller.saveConflicted('t1', 'what was being saved');
    expect(draftOf(world).code).toBe('what was being saved');
    expect(notice()?.kind).toBe('changed');
  });

  it('survives storage failing: saving stays paused, so the tab still holds it', async () => {
    await open();
    world.storage.setItem = () => {
      throw new Error('quota');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world.editor = 'typed';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    expect(notice()).not.toBeNull();
    expect(world.versions.isPaused('t1')).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('a reload during a conflict', () => {
  /** A new page: same storage, a fresh controller, and the server's code in the editor. */
  async function reload(serverCode: string, version: string) {
    trackConflictStore.set(null);
    const fresh = makeWorld();
    fresh.storage = world.storage;
    fresh.deps.storage = world.storage;
    fresh.versions.set('t1', server(serverCode, version));
    fresh.remote = { status: 'found', value: server(serverCode, version) };
    fresh.editor = serverCode;
    fresh.lastSaved = serverCode;
    world = fresh;
    controller = createTrackConflictController(fresh.deps);
    await open();
  }

  beforeEach(async () => {
    await open();
    world.editor = 'typed before reload';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
  });

  it('offers the text again, with autosave paused', async () => {
    await reload('theirs', V2);
    expect(notice()).toMatchObject({ trackId: 't1', kind: 'changed', restored: true });
    expect(world.versions.isPaused('t1')).toBe(true);
    expect(draftOf(world).code).toBe('typed before reload');
  });

  it('Keep mine puts the draft back and saves it', async () => {
    await reload('theirs', V2);
    await controller.keepMine();
    expect(world.saveCode).toHaveBeenCalledWith('t1', 'typed before reload');
    expect(world.setEditorCode).toHaveBeenCalledWith('t1', 'typed before reload');
    expect(draftOf(world)).toBeNull();
    expect(notice()).toBeNull();
  });

  it('Load the new version drops the draft, by choice', async () => {
    await reload('theirs', V2);
    await controller.loadNewVersion();
    expect(draftOf(world)).toBeNull();
    expect(notice()).toBeNull();
    expect(world.saveCode).not.toHaveBeenCalled();
  });

  it('a draft equal to what the server now holds asks nothing', async () => {
    await reload('typed before reload', V3);
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
    expect(world.versions.isPaused('t1')).toBe(false);
  });

  it('another user on this browser is not offered it', async () => {
    const stored = draftOf(world);
    world.storage.setItem(KEY, JSON.stringify({ ...stored, userId: 'someone-else' }));
    await reload('theirs', V2);
    expect(notice()).toBeNull();
  });
});

describe('leaving a conflicted track', () => {
  it('the notice goes with it, saving stays paused, and it comes back on returning', async () => {
    await open();
    world.editor = 'typed';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();

    world.editor = 'another track';
    controller.trackOpened('t2');
    expect(notice()).toBeNull();
    expect(world.versions.isPaused('t1')).toBe(true);
    expect(draftOf(world).code).toBe('typed');

    controller.trackOpened('t1');
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(notice()).toMatchObject({ trackId: 't1', restored: true });
  });

  it('the track switch race: a save refused after the switch keeps its text and shows nothing on the new track', async () => {
    await open();
    controller.trackOpened('t2');
    controller.saveConflicted('t1', 'text of the track I left');
    expect(notice()).toBeNull();
    expect(draftOf(world).code).toBe('text of the track I left');
    expect(world.versions.isPaused('t1')).toBe(true);
    expect(world.versions.isPaused('t2')).toBe(false);
  });

  it('resumes saving if the server went back to what the tab holds', async () => {
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    controller.trackOpened('t2');
    world.remote = { status: 'found', value: server('base', V3) };
    controller.trackOpened('t1');
    await vi.waitFor(() => expect(world.versions.isPaused('t1')).toBe(false));
    expect(notice()).toBeNull();
  });
});

describe('Load the new version', () => {
  beforeEach(async () => {
    await open();
    world.editor = 'typed';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
  });

  it('changes the editor and local state, saves nothing, and resumes', async () => {
    await controller.loadNewVersion();
    expect(world.setEditorCode.mock.calls).toEqual([['t1', 'theirs']]);
    expect(world.applySynced).toHaveBeenCalledWith('t1', 'theirs', expect.objectContaining({ version: V2 }));
    expect(world.saveCode).not.toHaveBeenCalled();
    expect(world.versions.get('t1')?.version).toBe(V2);
    expect(world.versions.isPaused('t1')).toBe(false);
    expect(notice()).toBeNull();
  });

  it('marks local state synced before the editor changes, so autosave never sees it as typing', async () => {
    await controller.loadNewVersion();
    expect(world.applySynced.mock.invocationCallOrder[0]).toBeLessThan(world.setEditorCode.mock.invocationCallOrder[0]);
  });

  it('takes the latest version, not the one that raised the notice', async () => {
    world.remote = { status: 'found', value: server('even newer', V3) };
    await controller.loadNewVersion();
    expect(world.editor).toBe('even newer');
  });

  it('on a failed read keeps the notice and the text', async () => {
    world.remote = { status: 'unknown' };
    await controller.loadNewVersion();
    expect(notice()).toMatchObject({ failed: true, busy: false });
    expect(world.editor).toBe('typed');
    expect(draftOf(world).code).toBe('typed');
  });

  it('turns into the deleted notice if the track went meanwhile', async () => {
    world.remote = { status: 'gone' };
    await controller.loadNewVersion();
    expect(notice()?.kind).toBe('deleted');
    expect(draftOf(world).code).toBe('typed');
  });

  it("a multitrack whose steps changed loads the active step's code", async () => {
    const steps = [
      { id: 's1', name: 'A', code: 'step a' },
      { id: 's2', name: 'B', code: 'step b' },
    ];
    world.remote = { status: 'found', value: server('base', V3, { steps, isMultitrack: true, activeStep: 1 }) };
    await controller.loadNewVersion();
    expect(world.editor).toBe('step b');
  });
});

describe('Keep mine', () => {
  beforeEach(async () => {
    await open();
    world.editor = 'typed';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
  });

  it('saves the tab text on top of the current version', async () => {
    let versionAtSave: string | undefined;
    world.saveCode.mockImplementation(async () => {
      versionAtSave = world.versions.get('t1')?.version;
      expect(world.versions.isPaused('t1')).toBe(false);
    });
    world.remote = { status: 'found', value: server('newest', V3) };
    await controller.keepMine();
    expect(world.saveCode).toHaveBeenCalledWith('t1', 'typed');
    expect(versionAtSave).toBe(V3);
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
    expect(world.lastSaved).toBe('typed');
  });

  it('saves even with nothing typed: it is what "mine" means', async () => {
    trackConflictStore.set(null);
    world = makeWorld();
    controller = createTrackConflictController(world.deps);
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    await controller.keepMine();
    expect(world.saveCode).toHaveBeenCalledWith('t1', 'base');
  });

  it('never replaces an editor that already holds the text', async () => {
    await controller.keepMine();
    expect(world.setEditorCode).not.toHaveBeenCalled();
  });

  it('if the save fails, the notice stays, the draft stays and saving stays paused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world.saveCode.mockRejectedValue(new Error('offline'));
    await controller.keepMine();
    expect(notice()).toMatchObject({ failed: true, busy: false });
    expect(draftOf(world).code).toBe('typed');
    expect(world.versions.isPaused('t1')).toBe(true);
    vi.restoreAllMocks();
  });

  it('if yet another change lands first, the notice stays without an error', async () => {
    world.saveCode.mockRejectedValue(new VersionConflictError('t1', server('other', V3)));
    await controller.keepMine();
    expect(notice()).toMatchObject({ failed: false, busy: false });
    expect(draftOf(world).code).toBe('typed');
  });

  it('a double press sends one save', async () => {
    await Promise.all([controller.keepMine(), controller.keepMine()]);
    expect(world.saveCode).toHaveBeenCalledTimes(1);
  });
});

describe('a deleted track', () => {
  beforeEach(async () => {
    await open();
    world.editor = 'typed';
    world.remote = { status: 'gone' };
    await controller.check();
  });

  it('raises the notice and keeps the text, with enough to save it again', () => {
    expect(notice()).toMatchObject({ kind: 'deleted', trackName: 'Track' });
    expect(world.versions.isPaused('t1')).toBe(true);
    expect(draftOf(world)).toMatchObject({ code: 'typed', name: 'Track', folder: 'f1' });
  });

  it('Keep mine saves the text as a track again', async () => {
    await controller.keepMine();
    expect(world.recreate).toHaveBeenCalledWith('t1', expect.objectContaining({ code: 'typed', name: 'Track' }), true);
    expect(world.saveCode).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
  });

  it('if that fails, the notice and the text stay', async () => {
    world.recreate.mockResolvedValue(false);
    await controller.keepMine();
    expect(notice()).toMatchObject({ failed: true });
    expect(draftOf(world).code).toBe('typed');
  });

  it('Discard is the only thing that drops it', () => {
    controller.discard();
    expect(world.removeLocal).toHaveBeenCalledWith('t1');
    expect(draftOf(world)).toBeNull();
    expect(notice()).toBeNull();
  });

  it('after a reload the track is not in the library, and its draft is still offered', async () => {
    trackConflictStore.set(null);
    world.versions.setOpenTrack('other');
    const next = createTrackConflictController({ ...world.deps, getLocalTrack: () => undefined });
    next.offerOrphanDrafts(new Set(['other']));
    expect(notice()).toMatchObject({ trackId: 't1', kind: 'deleted', restored: true, trackName: 'Track' });
    await next.keepMine();
    expect(world.recreate).toHaveBeenCalledWith('t1', expect.objectContaining({ code: 'typed' }), false);
  });

  it('a draft for a track that still exists is not an orphan', () => {
    trackConflictStore.set(null);
    createTrackConflictController(world.deps).offerOrphanDrafts(new Set(['t1']));
    expect(notice()).toBeNull();
  });

  it("another user's orphan draft is not offered", () => {
    trackConflictStore.set(null);
    createTrackConflictController({ ...world.deps, userId: 'someone-else' }).offerOrphanDrafts(new Set());
    expect(notice()).toBeNull();
  });
});

describe('deleting in this tab', () => {
  it('drops the draft and the notice: the user chose that', async () => {
    await open();
    world.editor = 'typed';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    controller.trackDeletedHere('t1');
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
  });
});

describe('hasOpenConflict', () => {
  it('is about the open track: an orphan notice says nothing about the editor', async () => {
    await open();
    expect(controller.hasOpenConflict()).toBe(false);
    trackConflictStore.set({
      trackId: 'orphan',
      trackName: '',
      kind: 'deleted',
      restored: true,
      busy: false,
      failed: false,
    });
    expect(controller.hasOpenConflict()).toBe(false);
    trackConflictStore.set({
      trackId: 't1',
      trackName: '',
      kind: 'changed',
      restored: false,
      busy: false,
      failed: false,
    });
    expect(controller.hasOpenConflict()).toBe(true);
  });
});
