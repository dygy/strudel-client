/**
 * @spec: 018-strudel-mcp-server (functional 2.5, 2.6; tech 2.6)
 * The conflict controller: when a notice is raised and when it must not be, what happens to the text,
 * and that neither choice can reach audio (its only ways into the editor are setEditorCode and
 * showDraft). Findings from review/fix-018-save-protection.md are named where they're pinned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackConflictController,
  DRAFT_EXPIRY_MS,
  POLL_INTERVAL_MS,
  trackConflictStore,
  type LocalTrackInfo,
  type ServerRead,
  type TrackConflictDeps,
  type TrackDraft,
} from '../trackConflict';
import { createTrackVersions, VersionConflictError, type ServerTrack, type TrackVersions } from '../trackVersion';

const V1 = '2026-11-03T00:09:28.401191+00:00';
const V2 = '2026-11-03T00:09:29.000002+00:00';
const V3 = '2026-11-03T00:09:30.000003+00:00';
const USER = 'user-1';
const TAB = 'tab-1';
const OTHER_TAB = 'tab-2';

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

type Storage = ReturnType<typeof memoryStorage>;

interface World {
  versions: TrackVersions;
  storage: Storage;
  remote: ServerRead<ServerTrack>;
  editor: string;
  lastSaved: string;
  local: LocalTrackInfo;
  deps: TrackConflictDeps;
  setEditorCode: ReturnType<typeof vi.fn>;
  showDraft: ReturnType<typeof vi.fn>;
  saveCode: ReturnType<typeof vi.fn>;
  applySynced: ReturnType<typeof vi.fn>;
  recreate: ReturnType<typeof vi.fn>;
  removeLocal: ReturnType<typeof vi.fn>;
  aliveTabs: Set<string>;
  visible: boolean;
}

function makeWorld(storage: Storage = memoryStorage(), tabId = TAB): World {
  const versions = createTrackVersions();
  versions.set('t1', server('base', V1));
  const world: World = {
    versions,
    storage,
    remote: { status: 'found', value: server('base', V1) },
    editor: 'base',
    lastSaved: 'base',
    local: { name: 'Track', folder: 'f1', isMultitrack: false, steps: [], activeStep: 0 },
    visible: true,
    aliveTabs: new Set(),
    setEditorCode: vi.fn((_id: string, code: string) => {
      world.editor = code;
    }),
    showDraft: vi.fn((_id: string, draft: TrackDraft) => {
      world.editor = draft.code;
      if (draft.isMultitrack) world.local = { ...world.local, steps: draft.steps, activeStep: draft.stepIndex };
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
    tabId,
    versions,
    storage,
    sleep: async () => {},
    isTabAlive: async (id) => world.aliveTabs.has(id),
    isVisible: () => world.visible,
    readVersion: async () =>
      world.remote.status === 'found' ? { status: 'found', value: world.remote.value.version } : world.remote,
    readTrack: async () => world.remote,
    getEditorCode: () => world.editor,
    getLastSavedCode: () => world.lastSaved,
    getLocalTrack: (id) => (id === 't1' ? world.local : undefined),
    setEditorCode: world.setEditorCode,
    showDraft: world.showDraft,
    saveCode: world.saveCode,
    applySynced: world.applySynced,
    recreate: world.recreate,
    removeLocal: world.removeLocal,
  };
  return world;
}

const keyOf = (tabId = TAB) => `strudel-conflict-draft:t1:${tabId}`;
const draftOf = (world: World, tabId = TAB) => JSON.parse(world.storage.getItem(keyOf(tabId)) ?? 'null');
const draftCount = (world: World) => world.storage.length;
const notice = () => trackConflictStore.get();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let world: World;
let controller: ReturnType<typeof createTrackConflictController>;

function useWorld(next: World) {
  world = next;
  controller = createTrackConflictController(next.deps);
}

beforeEach(() => {
  trackConflictStore.set(null);
  useWorld(makeWorld());
});

afterEach(() => {
  controller.stopWatching();
  vi.useRealTimers();
  vi.restoreAllMocks();
  trackConflictStore.set(null);
});

async function open(id: string | null = 't1') {
  controller.trackOpened(id);
  await settle();
  await settle();
}

/** A new page in the same tab: same storage, a fresh controller, this code in the editor. */
async function reload(code: string, version: string, build: (w: World) => void = () => {}) {
  trackConflictStore.set(null);
  const next = makeWorld(world.storage);
  next.versions.set('t1', server(code, version));
  next.remote = { status: 'found', value: server(code, version) };
  next.editor = code;
  next.lastSaved = code;
  build(next);
  useWorld(next);
  await open();
}

const steps = (a: string, b: string) => [
  { id: 's1', name: 'A', code: a },
  { id: 's2', name: 'B', code: b },
];
const multi = (a: string, b: string, version: string, activeStep = 0) =>
  server(activeStep ? b : a, version, { steps: steps(a, b), isMultitrack: true, activeStep });
const asMultitrack = (w: World, a: string, b: string, activeStep: number) => {
  w.local = { name: 'Track', folder: 'f1', isMultitrack: true, steps: steps(a, b), activeStep };
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
    expect(notice()).toMatchObject({ trackId: 't1', kind: 'changed' });
    expect(world.versions.isPaused('t1')).toBe(true);
  });

  it('finds out within 30 seconds of a change, by polling every 20', async () => {
    vi.useFakeTimers();
    controller.startWatching();
    controller.trackOpened('t1');
    await vi.advanceTimersByTimeAsync(0);
    world.remote = { status: 'found', value: server('changed', V2) };
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(30_000);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(notice()).not.toBeNull();
  });

  it('does not poll a hidden tab, and checks on its return', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    controller.startWatching(target as unknown as Document);
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
    await settle();
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

describe('a draft', () => {
  it('says whose it is and what it was typed against', async () => {
    await open();
    world.editor = 'typed by the user';
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    expect(draftOf(world)).toMatchObject({
      userId: USER,
      tabId: TAB,
      trackId: 't1',
      stepIndex: 0,
      code: 'typed by the user',
      steps: [],
      baseVersion: V1,
      createdAt: expect.any(Number),
      name: 'Track',
      folder: 'f1',
    });
  });

  it('nothing typed means no draft: a reload just shows the new version', async () => {
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    expect(draftOf(world)).toBeNull();
  });

  it('what is typed during the conflict reaches it', async () => {
    await open();
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    world.editor = 'typed after the notice';
    controller.flushDraft();
    expect(draftOf(world).code).toBe('typed after the notice');
  });

  it('a paused save writes it, not the server', async () => {
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
    controller.saveRefused('t1', 'changed', 'what was being saved');
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
  });

  it('a save built after it clears it, and one built before it does not', async () => {
    await open();
    controller.keepDraft('t1', 'typed');
    const afterDraft = Date.now() + 1;
    const beforeDraft = Date.now() - 1000;
    controller.textSaved('t1', 'older text', beforeDraft);
    expect(draftOf(world).code).toBe('typed');
    controller.textSaved('t1', 'something newer', afterDraft);
    expect(draftOf(world)).toBeNull();
  });
});

describe('text kept across a page exit', () => {
  beforeEach(async () => {
    await open();
    controller.keepDraft('t1', 'typed before leaving', { inEditor: true });
  });

  it('is cleared with no notice when the server already has it', async () => {
    await reload('typed before leaving', V2);
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
    expect(world.setEditorCode).not.toHaveBeenCalled();
  });

  it('a save that lands just after the reload is shown, with no notice and no write', async () => {
    await reload('base', V1, (next) => {
      next.deps.sleep = async () => {
        next.remote = { status: 'found', value: server('typed before leaving', V2) };
      };
    });
    await vi.waitFor(() => expect(world.setEditorCode).toHaveBeenCalledWith('t1', 'typed before leaving'));
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
    expect(world.saveCode).not.toHaveBeenCalled();
    expect(world.versions.get('t1')?.version).toBe(V2);
    expect(world.versions.isPaused('t1')).toBe(false);
  });

  it('that landed before the first look is no conflict either', async () => {
    await reload('base', V1, (next) => {
      next.remote = { status: 'found', value: server('typed before leaving', V2) };
    });
    await vi.waitFor(() => expect(world.setEditorCode).toHaveBeenCalled());
    expect(notice()).toBeNull();
  });

  it('never arrived: on screen, said to be unsaved, and saved by nobody until chosen', async () => {
    await reload('base', V1);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(notice()).toMatchObject({ kind: 'changed', draftOrigin: 'unsaved' });
    expect(world.editor).toBe('typed before leaving');
    expect(world.versions.isPaused('t1')).toBe(true);
    expect(world.saveCode).not.toHaveBeenCalled();
    await controller.keepMine();
    expect(world.saveCode).toHaveBeenCalledWith('t1', 'typed before leaving');
    expect(draftOf(world)).toBeNull();
  });

  it('Load the new version drops it, by choice', async () => {
    await reload('base', V1);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    await controller.loadNewVersion();
    expect(world.editor).toBe('base');
    expect(draftOf(world)).toBeNull();
    expect(notice()).toBeNull();
    expect(world.saveCode).not.toHaveBeenCalled();
  });

  it('another user on this browser is not offered it', async () => {
    const stored = draftOf(world);
    world.storage.setItem(keyOf(), JSON.stringify({ ...stored, userId: 'someone-else' }));
    await reload('base', V1);
    expect(notice()).toBeNull();
  });
});

describe('finding 8: the server moved past the base without the draft', () => {
  beforeEach(async () => {
    await open();
    controller.keepDraft('t1', 'old typing');
  });

  it('says so, instead of saying the text never arrived', async () => {
    await reload('much newer', V3);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(notice()).toMatchObject({ draftOrigin: 'moved' });
    expect(world.editor).toBe('old typing');
  });

  it('Keep mine waits for the choice: nothing is written before it', async () => {
    await reload('much newer', V3);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(world.saveCode).not.toHaveBeenCalled();
    expect(world.versions.isPaused('t1')).toBe(true);
  });
});

describe('finding 2: typing under a restored notice', () => {
  beforeEach(async () => {
    await open();
    controller.keepDraft('t1', 'draft text');
    await reload('base', V1);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
  });

  it('updates the draft', () => {
    world.editor = 'draft text plus ten minutes of typing';
    controller.flushDraft();
    expect(draftOf(world).code).toBe('draft text plus ten minutes of typing');
    controller.savePaused('t1', 'and a little more');
    expect(draftOf(world).code).toBe('and a little more');
  });

  it('and Keep mine saves what is on screen', async () => {
    world.editor = 'draft text plus ten minutes of typing';
    await controller.keepMine();
    expect(world.saveCode).toHaveBeenCalledWith('t1', 'draft text plus ten minutes of typing');
  });
});

describe('blocker 3 and finding 10: an action finishing after the user moved on', () => {
  async function gatedRead() {
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    const remote = world.remote;
    world.deps.readTrack = async () => {
      await gate;
      return remote;
    };
    return openGate;
  }

  beforeEach(async () => {
    await open();
    controller.saveRefused('t1', 'changed', 'typed');
    world.editor = 'typed';
  });

  it('Keep mine never puts track A into the editor holding track B', async () => {
    world.remote = { status: 'found', value: server('server A', V2) };
    const openGate = await gatedRead();
    const keeping = controller.keepMine();
    world.versions.setOpenTrack('t2');
    world.editor = 'text of B';
    openGate();
    await keeping;
    expect(world.editor).toBe('text of B');
    expect(world.setEditorCode).not.toHaveBeenCalled();
    expect(world.saveCode).toHaveBeenCalledWith('t1', 'typed');
  });

  it('Load the new version never does either', async () => {
    world.remote = { status: 'found', value: server('server A', V2) };
    const openGate = await gatedRead();
    const loading = controller.loadNewVersion();
    world.versions.setOpenTrack('t2');
    world.editor = 'text of B';
    openGate();
    await loading;
    expect(world.editor).toBe('text of B');
    expect(world.setEditorCode).not.toHaveBeenCalled();
    expect(world.applySynced).toHaveBeenCalledWith('t1', 'server A', expect.anything());
  });

  it('nor a save that lands after the move', async () => {
    world.remote = { status: 'found', value: multi('a', 'b', V2) };
    asMultitrack(world, 'a', 'b', 0);
    const openGate = await gatedRead();
    const loading = controller.loadNewVersion();
    world.local = { ...world.local, activeStep: 1 };
    openGate();
    await loading;
    expect(world.setEditorCode).not.toHaveBeenCalled();
  });

  it("finishing doesn't close a notice that belongs to the next track", async () => {
    world.remote = { status: 'found', value: server('server A', V2) };
    const openGate = await gatedRead();
    const keeping = controller.keepMine();
    const other = { trackId: 't2', trackName: 'B', kind: 'changed' as const, busy: false, failed: false };
    trackConflictStore.set(other);
    openGate();
    await keeping;
    expect(notice()).toEqual(other);
  });
});

describe('finding 5: other tabs', () => {
  const OTHERS_DRAFT = (extra: Partial<TrackDraft> = {}): TrackDraft => ({
    userId: USER,
    tabId: OTHER_TAB,
    trackId: 't1',
    stepIndex: 0,
    code: 'text from tab 2',
    steps: [],
    baseVersion: V1,
    createdAt: Date.now() - 60_000,
    name: 'Track',
    folder: 'f1',
    isMultitrack: false,
    ...extra,
  });

  it("this tab never adopts or clears a live tab's draft, even if the server holds that text", async () => {
    world.aliveTabs.add(OTHER_TAB);
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(OTHERS_DRAFT()));
    world.editor = 'typed in this tab';
    world.remote = { status: 'found', value: server('text from tab 2', V2) };
    await open();
    expect(world.setEditorCode).not.toHaveBeenCalled();
    expect(world.showDraft).not.toHaveBeenCalled();
    expect(world.editor).toBe('typed in this tab');
    expect(draftOf(world, OTHER_TAB)).not.toBeNull();
    // The save is still a real change from here: this tab's typing is protected as usual.
    expect(notice()).toMatchObject({ kind: 'changed' });
  });

  it("nor is it offered a live tab's draft", async () => {
    world.aliveTabs.add(OTHER_TAB);
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(OTHERS_DRAFT()));
    await open();
    expect(notice()).toBeNull();
    expect(world.editor).toBe('base');
  });

  it("two tabs' drafts don't overwrite each other", async () => {
    const second = makeWorld(world.storage, OTHER_TAB);
    const secondController = createTrackConflictController(second.deps);
    await open();
    controller.keepDraft('t1', 'from tab 1');
    secondController.keepDraft('t1', 'from tab 2');
    expect(draftOf(world, TAB).code).toBe('from tab 1');
    expect(draftOf(world, OTHER_TAB).code).toBe('from tab 2');
  });

  it("a closed tab's draft is offered here, on screen, and becomes this tab's", async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(OTHERS_DRAFT()));
    await open();
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(world.editor).toBe('text from tab 2');
    expect(draftOf(world, OTHER_TAB)).toBeNull();
    expect(draftOf(world, TAB).code).toBe('text from tab 2');
  });

  it("a closed tab's draft doesn't replace what's being typed here", async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(OTHERS_DRAFT()));
    world.editor = 'typing here';
    await open();
    expect(world.editor).toBe('typing here');
    expect(world.showDraft).not.toHaveBeenCalled();
    expect(draftOf(world, OTHER_TAB)).not.toBeNull();
  });

  it("a closed tab's draft that the server has is just removed, and doesn't move the editor", async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(OTHERS_DRAFT({ code: 'base' })));
    await open();
    expect(draftOf(world, OTHER_TAB)).toBeNull();
    expect(notice()).toBeNull();
    expect(world.setEditorCode).not.toHaveBeenCalled();
  });
});

describe('re-review: drafts and other tabs', () => {
  const stored = (extra: Partial<TrackDraft>): TrackDraft => ({
    userId: USER,
    tabId: OTHER_TAB,
    trackId: 't1',
    stepIndex: 0,
    code: 'text',
    steps: [],
    baseVersion: V1,
    createdAt: Date.now() - 60_000,
    name: 'Track',
    folder: 'f1',
    isMultitrack: false,
    ...extra,
  });

  it("a sibling doesn't take a draft written moments ago: that tab may only be reloading", async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ createdAt: Date.now() })));
    await open();
    expect(notice()).toBeNull();
    expect(world.editor).toBe('base');
    expect(draftOf(world, OTHER_TAB)).not.toBeNull();
  });

  it('a choice ends the draft on screen, not those of other closed tabs', async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ code: 'first' })));
    world.storage.setItem(
      keyOf('tab-3'),
      JSON.stringify(stored({ tabId: 'tab-3', code: 'second', createdAt: 5 + Date.now() - 90_000 })),
    );
    await open();
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    await controller.loadNewVersion();
    expect(draftOf(world, 'tab-3')).toMatchObject({ code: 'second' });
  });

  it('a query that fails counts as closed, without breaking the check', async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ code: 'base' })));
    await open();
    expect(notice()).toBeNull();
  });

  it('the sweep removes what the server already holds, and says nothing', async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ code: 'base' })));
    await expect(controller.sweepDrafts()).resolves.toEqual([]);
    expect(draftCount(world)).toBe(0);
  });

  it('the sweep keeps what the server does not hold, however many there are', async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ code: 'only copy' })));
    await expect(controller.sweepDrafts()).resolves.toEqual([]);
    expect(draftOf(world, OTHER_TAB)).not.toBeNull();
  });

  it('after 30 days an only copy goes, and is reported so the user can be told', async () => {
    const old = stored({ code: 'only copy', createdAt: Date.now() - DRAFT_EXPIRY_MS - 1 });
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(old));
    await expect(controller.sweepDrafts()).resolves.toEqual([old]);
    expect(draftCount(world)).toBe(0);
  });

  it("an expired draft the server holds goes quietly: it wasn't anyone's only copy", async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ code: 'base', createdAt: 1 })));
    await expect(controller.sweepDrafts()).resolves.toEqual([]);
    expect(draftCount(world)).toBe(0);
  });

  it("a live tab's draft isn't swept, however old", async () => {
    world.aliveTabs.add(OTHER_TAB);
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ code: 'base', createdAt: 1 })));
    await controller.sweepDrafts();
    expect(draftOf(world, OTHER_TAB)).not.toBeNull();
  });

  it("another user's draft isn't swept", async () => {
    world.storage.setItem(keyOf(OTHER_TAB), JSON.stringify(stored({ userId: 'someone-else', createdAt: 1 })));
    await controller.sweepDrafts();
    expect(draftCount(world)).toBe(1);
  });

  it('discarding a deleted track ends only the draft on screen', async () => {
    world.storage.setItem(keyOf('tab-3'), JSON.stringify(stored({ tabId: 'tab-3', trackId: 't1', code: 'other' })));
    world.aliveTabs.add('tab-3');
    await open();
    world.editor = 'typed';
    world.remote = { status: 'gone' };
    await controller.check();
    controller.discard();
    expect(draftOf(world)).toBeNull();
    expect(draftOf(world, 'tab-3')).not.toBeNull();
  });
});

describe('finding 7: a page that hid and came back', () => {
  it('raises nothing about its own text, which is still in its editor', async () => {
    await open();
    world.editor = 'typed';
    controller.keepDraft('t1', 'typed', { inEditor: true });
    await controller.check();
    expect(notice()).toBeNull();
    expect(world.versions.isPaused('t1')).toBe(false);
    expect(world.showDraft).not.toHaveBeenCalled();
    expect(world.editor).toBe('typed');
    expect(draftOf(world).code).toBe('typed');
  });

  it('not even after undoing back to the saved text, when the draft is older than the editor', async () => {
    await open();
    controller.keepDraft('t1', 'typed', { inEditor: true });
    world.editor = 'base';
    await controller.check();
    expect(notice()).toBeNull();
    expect(world.showDraft).not.toHaveBeenCalled();
    expect(world.editor).toBe('base');
  });

  it('but a real change elsewhere still does', async () => {
    await open();
    world.editor = 'typed';
    controller.keepDraft('t1', 'typed', { inEditor: true });
    world.remote = { status: 'found', value: server('theirs', V2) };
    await controller.check();
    expect(notice()).toMatchObject({ kind: 'changed' });
  });
});

describe('finding 9: a draft with typing in a step that is not active', () => {
  it('survives the active step matching the server', async () => {
    await open();
    asMultitrack(world, 'a', 'b', 0);
    world.versions.set('t1', multi('a', 'b', V1));
    controller.keepDraft('t1', 'typed in b', { stepIndex: 1 });
    expect(draftOf(world)).toMatchObject({ stepIndex: 1, code: 'typed in b' });
    expect(draftOf(world).steps.map((s: { code: string }) => s.code)).toEqual(['a', 'typed in b']);

    await reload('a', V1, (next) => {
      asMultitrack(next, 'a', 'b', 0);
      next.versions.set('t1', multi('a', 'b', V1));
      next.remote = { status: 'found', value: multi('a', 'b', V1) };
    });
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(world.showDraft).toHaveBeenCalled();
    expect(world.editor).toBe('typed in b');
    expect(world.local.activeStep).toBe(1);
  });

  it('and is recognised when every step matches, whichever is active on the server', async () => {
    await open();
    asMultitrack(world, 'a', 'b', 1);
    world.versions.set('t1', multi('a', 'b', V1, 1));
    controller.keepDraft('t1', 'b2', { stepIndex: 1 });
    await reload('a', V2, (next) => {
      asMultitrack(next, 'a', 'b2', 0);
      next.versions.set('t1', multi('a', 'b2', V2));
      next.remote = { status: 'found', value: multi('a', 'b2', V2) };
    });
    expect(notice()).toBeNull();
    expect(draftOf(world)).toBeNull();
  });
});

describe('draft adoption stays on the step the user is on', () => {
  it('shows that step from the new row', async () => {
    await open();
    asMultitrack(world, 'a', 'b', 0);
    world.versions.set('t1', multi('a', 'b', V1));
    controller.keepDraft('t1', 'a2', { stepIndex: 0 });
    await reload('b', V1, (next) => {
      asMultitrack(next, 'a', 'b', 1);
      next.versions.set('t1', multi('a', 'b', V1, 1));
      next.remote = { status: 'found', value: multi('a2', 'b', V2, 0) };
    });
    await vi.waitFor(() => expect(world.applySynced).toHaveBeenCalled());
    expect(world.applySynced).toHaveBeenCalledWith('t1', 'b', expect.anything());
    expect(world.editor).toBe('b');
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

    world.editor = 'base';
    controller.trackOpened('t1');
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(world.editor).toBe('typed');
  });

  it('the track switch race: a save refused after the switch keeps its text and shows nothing on the new track', async () => {
    await open();
    controller.trackOpened('t2');
    controller.saveRefused('t1', 'changed', 'text of the track I left');
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

  it("a multitrack loads the active step's code", async () => {
    world.remote = { status: 'found', value: multi('step a', 'step b', V3, 1) };
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
  });

  it('saves even with nothing typed: it is what "mine" means', async () => {
    trackConflictStore.set(null);
    useWorld(makeWorld());
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

  it('finding 4: on a multitrack the text is in its step, typed after the notice included', async () => {
    trackConflictStore.set(null);
    useWorld(makeWorld());
    asMultitrack(world, 'a', 'b', 1);
    await open();
    world.editor = 'typed in b';
    world.remote = { status: 'gone' };
    await controller.check();
    world.editor = 'typed in b, and more';
    await controller.keepMine();
    const draft = world.recreate.mock.calls[0][1] as TrackDraft;
    expect(draft.stepIndex).toBe(1);
    expect(draft.steps.map((s) => s.code)).toEqual(['a', 'typed in b, and more']);
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
    await next.offerOrphanDrafts(new Set(['other']));
    expect(notice()).toMatchObject({ trackId: 't1', kind: 'deleted', trackName: 'Track' });
    await next.keepMine();
    expect(world.recreate).toHaveBeenCalledWith('t1', expect.objectContaining({ code: 'typed' }), false);
  });

  it('a draft for a track that still exists is not an orphan', async () => {
    trackConflictStore.set(null);
    await createTrackConflictController(world.deps).offerOrphanDrafts(new Set(['t1']));
    expect(notice()).toBeNull();
  });

  it("another user's orphan draft is not offered", async () => {
    trackConflictStore.set(null);
    await createTrackConflictController({ ...world.deps, userId: 'someone-else' }).offerOrphanDrafts(new Set());
    expect(notice()).toBeNull();
  });

  it("a live tab's orphan draft is not offered here", async () => {
    trackConflictStore.set(null);
    world.aliveTabs.add(TAB);
    await createTrackConflictController({ ...world.deps, tabId: OTHER_TAB }).offerOrphanDrafts(new Set());
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
    expect(draftCount(world)).toBe(0);
  });
});

describe('hasOpenConflict', () => {
  it('is about the open track: an orphan notice says nothing about the editor', async () => {
    await open();
    expect(controller.hasOpenConflict()).toBe(false);
    trackConflictStore.set({ trackId: 'orphan', trackName: '', kind: 'deleted', busy: false, failed: false });
    expect(controller.hasOpenConflict()).toBe(false);
    trackConflictStore.set({ trackId: 't1', trackName: '', kind: 'changed', busy: false, failed: false });
    expect(controller.hasOpenConflict()).toBe(true);
  });
});

describe('a multitrack', () => {
  it('another tab switching step changes no content: no notice, though code and version moved', async () => {
    asMultitrack(world, 'aa', 'bb', 0);
    world.versions.set('t1', multi('aa', 'bb', V1));
    world.remote = { status: 'found', value: multi('aa', 'bb', V1) };
    await open();
    world.remote = { status: 'found', value: multi('aa', 'bb', V2, 1) };
    await controller.check();
    expect(notice()).toBeNull();
    expect(world.versions.get('t1')?.version).toBe(V2);
  });

  it('a step edited elsewhere is a conflict', async () => {
    asMultitrack(world, 'aa', 'bb', 0);
    world.versions.set('t1', multi('aa', 'bb', V1));
    world.remote = { status: 'found', value: multi('aa', 'bb', V1) };
    await open();
    world.remote = { status: 'found', value: multi('aa', 'other', V2) };
    await controller.check();
    expect(notice()).toMatchObject({ kind: 'changed' });
  });

  it("an old tab's code-only save, during a rollout, is a conflict too", async () => {
    asMultitrack(world, 'aa', 'bb', 0);
    world.versions.set('t1', multi('aa', 'bb', V1));
    world.remote = { status: 'found', value: multi('aa', 'bb', V1) };
    await open();
    world.remote = { status: 'found', value: { ...multi('aa', 'bb', V2), code: 'old tab typed this' } };
    await controller.check();
    expect(notice()).toMatchObject({ kind: 'changed' });
  });
});
