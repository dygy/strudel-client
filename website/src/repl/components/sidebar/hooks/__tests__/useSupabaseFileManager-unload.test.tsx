// @vitest-environment jsdom
/**
 * The real file manager hook, operations, secureApi and conflict controller over a fake server.
 *
 * Regressions (data loss): page exits saved nothing on any real URL (`globalSaveManager` looked tracks
 * up by a URL slug), and multitrack saves wrote `code` alone, so step edits and step operations were
 * gone after a reload.
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

const plain = (id: string, name: string, code: string, folder: string | null = null) => ({
  id,
  name,
  code,
  created: '2026-01-01T00:00:00Z',
  modified: '2026-01-01T00:00:00Z',
  folder,
  isMultitrack: false,
  steps: [] as unknown[],
  activeStep: 0,
  user_id: USER.id,
  version: V1,
});
const STEPS = [
  { id: 's1', name: 'Alpha', code: 'alpha', created: 'x', modified: 'x' },
  { id: 's2', name: 'Beta', code: 'beta', created: 'x', modified: 'x' },
];
const multi = (extra = {}) => ({
  ...plain('m1', 'multi', 'alpha'),
  isMultitrack: true,
  steps: STEPS,
  activeStep: 0,
  ...extra,
});

let remote: Record<string, unknown> | null = null;
let settings: Record<string, unknown> = {};
const autosave = { enabled: false, interval: 100000 };
const autoFormatOnSave = vi.fn(async (code: string) => ({ success: true, formattedCode: `formatted ${code}` }));
let activePattern: string | null = null;

function supabaseMock() {
  const builder = { eq: () => builder, maybeSingle: async () => ({ data: remote, error: null }) };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }) },
      from: () => ({ select: () => builder }),
    },
  };
}

let useSupabaseFileManager: typeof import('../useSupabaseFileManager').useSupabaseFileManager;
let useFileManagerOperations: typeof import('../useFileManagerOperations').useFileManagerOperations;
let trackVersions: typeof import('../../../../trackVersion').trackVersions;
let trackConflictStore: typeof import('../../../../trackConflict').trackConflictStore;
let globalSaveManager: typeof import('../../../../globalSaveManager').globalSaveManager;
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;

const MOCKED = [
  '@src/hooks/useAuth',
  '@src/lib/supabase',
  '../../../../../lib/supabase',
  '@src/lib/authUtils',
  '../../../../../lib/authUtils',
  '@strudel/webaudio',
  '@strudel/codemirror',
  '@src/i18n',
  '@src/settings',
  '@src/user_pattern_utils',
];

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('@src/hooks/useAuth', () => ({
    useAuth: () => ({ user: USER, isAuthenticated: true, loading: false, checkAuth: async () => true }),
  }));
  vi.doMock('@src/lib/supabase', supabaseMock);
  vi.doMock('../../../../../lib/supabase', supabaseMock);
  const session = async () => ({ success: true, session: { access_token: 'token' } });
  vi.doMock('@src/lib/authUtils', () => ({ ensureValidSession: session }));
  vi.doMock('../../../../../lib/authUtils', () => ({ ensureValidSession: session }));
  vi.doMock('@strudel/webaudio', () => ({ preloadTrackSamples: async () => {} }));
  vi.doMock('@strudel/codemirror', () => ({ autoFormatOnSave }));
  // Like i18next before the locale has loaded: the key, unless a default was given.
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  vi.doMock('@src/i18n', () => ({ useTranslation: () => ({ t }) }));
  vi.doMock('@src/settings', () => ({
    useSettings: () => ({ isAutosaveEnabled: autosave.enabled, autosaveInterval: autosave.interval }),
    settingsMap: { get: () => settings },
  }));
  vi.doMock('@src/user_pattern_utils', () => ({
    useActivePattern: () => activePattern,
    getActivePattern: () => activePattern,
    setActivePattern: (pattern: string) => {
      activePattern = pattern;
    },
  }));
  ({ useSupabaseFileManager } = await import('../useSupabaseFileManager'));
  ({ useFileManagerOperations } = await import('../useFileManagerOperations'));
  ({ trackVersions } = await import('../../../../trackVersion'));
  ({ trackConflictStore } = await import('../../../../trackConflict'));
  ({ globalSaveManager } = await import('../../../../globalSaveManager'));
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(() => {
  MOCKED.forEach((id) => vi.doUnmock(id));
  vi.resetModules();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fetchMock: ReturnType<typeof vi.fn>;
let editor: { code: string; setCode: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> };
let handleUpdate: ReturnType<typeof vi.fn>;
let hook: ReturnType<typeof import('../useSupabaseFileManager').useSupabaseFileManager>;
let ops: ReturnType<typeof import('../useFileManagerOperations').useFileManagerOperations>;
let unmount: () => void = () => {};

const row = (fields: Record<string, unknown>, updated_at = V2) => ({ id: 'x', updated_at, ...fields });
const ok = (track: unknown) => new Response(JSON.stringify({ success: true, track }), { status: 200 });
const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
const lastSent = () => sent()[sent().length - 1];
const draftOf = (id: string) => {
  const key = Object.keys(localStorage).find((k) => k.startsWith(`strudel-conflict-draft:${id}:`));
  return key ? JSON.parse(localStorage.getItem(key)!) : null;
};

async function flush() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(tracks: unknown[], readOnly = false) {
  const data = { tracks, folders: [] };
  const context = { editorRef: { current: editor }, activeCode: '', handleUpdate };
  function Harness(): ReactNode {
    hook = useSupabaseFileManager(context as never, data as never, readOnly);
    ops = useFileManagerOperations({ ...hook, context, t: (key: string) => key } as never);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await React.act(async () => root.render(React.createElement(Harness)));
  await flush();
  unmount = () => React.act(() => root.unmount());
  globalSaveManager.register(() => hook);
}

async function open(id: string) {
  await React.act(async () => hook.loadTrack(hook.tracks[id]));
  await flush();
}

async function save(id: string) {
  let result = false;
  await React.act(async () => {
    result = await hook.saveSpecificTrack(id, false);
  });
  return result;
}

beforeEach(() => {
  localStorage.clear();
  trackVersions.reset();
  trackConflictStore.set(null);
  remote = null;
  settings = {};
  autosave.enabled = false;
  autosave.interval = 100000;
  activePattern = null;
  autoFormatOnSave.mockClear();
  fetchMock = vi.fn(async () => ok(row({ code: 'any' })));
  vi.stubGlobal('fetch', fetchMock);
  editor = { code: '', setCode: vi.fn(), evaluate: vi.fn() };
  editor.setCode.mockImplementation((code: string) => {
    editor.code = code;
  });
  handleUpdate = vi.fn(async ({ code }: { code: string }) => {
    editor.code = code;
  });
  for (const method of ['log', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  globalSaveManager.unregister();
  unmount();
  unmount = () => {};
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('leaving the page with typed text', () => {
  describe.each([
    ['/repl/my-track', null],
    ['/repl/folder/my-track', 'folder'],
    ['/repl/folder/sub/my-track', 'folder/sub'],
  ])('at %s', (url, folder) => {
    beforeEach(async () => {
      window.history.replaceState(null, '', url);
      remote = { updated_at: V1, code: 'saved', steps: [], name: 'my track' };
      await mount([plain('uuid-1', 'my track', 'saved', folder)]);
      await open('uuid-1');
      editor.code = 'saved + typed';
    });

    it('sees the unsaved text, though the URL holds a slug and the track an id', () => {
      expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
    });

    it('sends it, before the handler returns, with keepalive and the version', () => {
      fetchMock.mockClear();
      window.dispatchEvent(new Event('pagehide'));
      expect(fetchMock).toHaveBeenCalledOnce();
      expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
      expect(lastSent()).toMatchObject({ trackId: 'uuid-1', expectedVersion: V1, updates: { code: 'saved + typed' } });
    });

    it('and keeps a draft, in case the request never arrives', () => {
      window.dispatchEvent(new Event('pagehide'));
      expect(draftOf('uuid-1')).toMatchObject({ code: 'saved + typed', trackId: 'uuid-1', baseVersion: V1 });
    });
  });

  describe('on a track in the editor', () => {
    beforeEach(async () => {
      remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
      await mount([plain('t1', 'one', 'saved')]);
      await open('t1');
      fetchMock.mockClear();
    });

    it('uses the newest state: a track opened after registering is the one saved', async () => {
      await React.act(async () => hook.createTrack('two', 'second'));
      fetchMock.mockClear();
      const created = Object.keys(hook.tracks).find((id) => id !== 't1')!;
      remote = { updated_at: V2, code: 'any', steps: [], name: 'two' };
      await open(created);
      editor.code = 'second + typed';
      globalSaveManager.protectUnsavedWork();
      expect(lastSent().trackId).toBe(created);
    });

    it('writes nothing when nothing was typed', () => {
      expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
      globalSaveManager.protectUnsavedWork();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(draftOf('t1')).toBeNull();
    });

    it('writes nothing for empty text', () => {
      editor.code = '   ';
      globalSaveManager.protectUnsavedWork();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never imports the formatter, which could not finish', async () => {
      settings = { isPrettierEnabled: true, prettierAutoFormatOnSave: true };
      editor.code = 'typed';
      globalSaveManager.protectUnsavedWork();
      await flush();
      expect(autoFormatOnSave).not.toHaveBeenCalled();
      expect(lastSent().updates.code).toBe('typed');
    });

    it('over the keepalive limit: nothing sent, the draft holds it, and the page may go', () => {
      editor.code = 'x'.repeat(70 * 1024);
      expect(globalSaveManager.protectUnsavedWork()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(draftOf('t1').code).toHaveLength(70 * 1024);
    });

    it('with a save in flight: nothing sent, since its version would be stale, and the draft holds it', async () => {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      editor.code = 'typed';
      void hook.saveSpecificTrack('t1', false);
      await flush();
      fetchMock.mockClear();
      editor.code = 'typed more';
      expect(globalSaveManager.protectUnsavedWork()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(draftOf('t1').code).toBe('typed more');
    });

    it('a stale version still stops the write: the server says 409 and nothing is overwritten', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'x', code: 'version_conflict', current: { version: V2, code: 'theirs', steps: [] } }),
          { status: 409 },
        ),
      );
      editor.code = 'typed';
      globalSaveManager.protectUnsavedWork();
      await flush();
      expect(lastSent().expectedVersion).toBe(V1);
      expect(trackConflictStore.get()).toMatchObject({ trackId: 't1', kind: 'changed' });
      expect(draftOf('t1').code).toBe('typed');
    });

    it('if the page stays (a hidden tab), normal saving carries on from the new version', async () => {
      fetchMock.mockResolvedValue(ok(row({ code: 'typed', steps: [] })));
      editor.code = 'typed';
      globalSaveManager.protectUnsavedWork();
      await flush();
      expect(draftOf('t1')).toBeNull();
      expect(trackVersions.get('t1')?.version).toBe(V2);
      expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
      fetchMock.mockClear();
      globalSaveManager.protectUnsavedWork();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a later ordinary save clears that draft', async () => {
      fetchMock.mockResolvedValue(ok(row({ code: 'typed', steps: [] })));
      editor.code = 'typed';
      globalSaveManager.protectUnsavedWork();
      await flush();
      editor.code = 'typed more';
      fetchMock.mockResolvedValue(ok(row({ code: 'typed more', steps: [] }, V3)));
      await save('t1');
      expect(draftOf('t1')).toBeNull();
    });

    it('the event trio of one exit sends one request', () => {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      editor.code = 'typed';
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
      window.dispatchEvent(new Event('pagehide'));
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('during a conflict sends nothing and keeps the text', async () => {
      trackVersions.pause('t1');
      editor.code = 'typed';
      globalSaveManager.protectUnsavedWork();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(draftOf('t1').code).toBe('typed');
    });
  });

  it('a track opened by the page load, not by loadTrack, is protected once the editor holds it', async () => {
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'saved')]);
    await React.act(async () => hook.setSelectedTrack('t1'));
    editor.code = 'saved';
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    fetchMock.mockClear();
    expect(hook.hasUnsavedEdits()).toBe(false);
    editor.code = 'saved + typed';
    expect(hook.hasUnsavedEdits()).toBe(true);
    globalSaveManager.protectUnsavedWork();
    expect(lastSent().updates.code).toBe('saved + typed');
  });

  it('pressing the track already open keeps what was typed', async () => {
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'saved')]);
    await open('t1');
    handleUpdate.mockClear();
    editor.code = 'saved + typed';
    await React.act(async () => ops.handleTrackSelect(hook.tracks.t1));
    expect(handleUpdate).not.toHaveBeenCalled();
    expect(editor.code).toBe('saved + typed');
  });

  it('a track selected but not loaded into the editor yet is not written over', async () => {
    await mount([plain('t1', 'one', 'real code')]);
    await React.act(async () => hook.setSelectedTrack('t1'));
    editor.code = 'whatever the editor started with';
    fetchMock.mockClear();
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    globalSaveManager.protectUnsavedWork();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the admin's read-only view never saves or stores anything", async () => {
    await mount([plain('t1', 'one', 'saved')], true);
    await open('t1');
    editor.code = 'typed in read-only';
    fetchMock.mockClear();
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(draftOf('t1')).toBeNull();
  });
});

describe('a multitrack', () => {
  beforeEach(async () => {
    remote = { updated_at: V1, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'multi' };
    await mount([multi(), plain('t2', 'other', 'other code')]);
    await open('m1');
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ok(row({ code: 'x', steps: STEPS }, V2)));
  });

  const stepCodes = (body: { updates: { steps: Array<{ code: string }> } }) => body.updates.steps.map((s) => s.code);
  const answerWith = () =>
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { updates } = JSON.parse(String(init.body));
      return ok(row({ code: updates.code, steps: updates.steps, active_step: updates.activeStep }, V2));
    });

  it('a save stores the edit in its step, with code and active_step: Cmd+S and autosave', async () => {
    editor.code = 'alpha edited';
    await expect(save('m1')).resolves.toBe(true);
    expect(lastSent().updates).toMatchObject({ code: 'alpha edited', activeStep: 0, isMultitrack: true });
    expect(stepCodes(lastSent())).toEqual(['alpha edited', 'beta']);
    expect(lastSent().expectedVersion).toBe(V1);
    expect(hook.tracks.m1.steps[0].code).toBe('alpha edited');
  });

  it('a step edit is in a page-exit save too', () => {
    editor.code = 'alpha edited';
    globalSaveManager.protectUnsavedWork();
    expect(stepCodes(lastSent())).toEqual(['alpha edited', 'beta']);
    expect(lastSent().updates.activeStep).toBe(0);
  });

  it('switching step sends the text being left and the new active step, and evaluates nothing', async () => {
    answerWith();
    editor.code = 'alpha edited';
    await React.act(async () => ops.switchToStep('m1', 1));
    await flush();
    expect(lastSent().updates).toMatchObject({ code: 'beta', activeStep: 1 });
    expect(stepCodes(lastSent())).toEqual(['alpha edited', 'beta']);
    expect(editor.code).toBe('beta');
    expect(handleUpdate.mock.calls[handleUpdate.mock.calls.length - 1][1]).toBe(false);
    expect(editor.evaluate).not.toHaveBeenCalled();
    expect(trackConflictStore.get()).toBeNull();
  });

  it('a save in flight when the step changes: the second names its version, and neither text is lost', async () => {
    let answerFirst: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    fetchMock.mockImplementationOnce(async () => ok(row({ code: 'beta', steps: STEPS }, V3)));

    editor.code = 'alpha edited';
    let inFlight: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      inFlight = hook.saveSpecificTrack('m1', false);
    });
    await flush();
    await React.act(async () => ops.switchToStep('m1', 1));
    expect(fetchMock).toHaveBeenCalledOnce();

    await React.act(async () => {
      answerFirst(ok(row({ code: 'alpha edited', steps: STEPS }, V2)));
      await inFlight;
    });
    await flush();

    const [first, second] = sent();
    expect(first.expectedVersion).toBe(V1);
    expect(second.expectedVersion).toBe(V2);
    expect(stepCodes(second)).toEqual(['alpha edited', 'beta']);
    expect(second.updates.activeStep).toBe(1);
    // The answer to the first save must not put step A's text back as the current step's.
    expect(hook.tracks.m1).toMatchObject({ activeStep: 1, code: 'beta' });
    expect(hook.tracks.m1.steps[0].code).toBe('alpha edited');
    expect(hook.getTrackAutosaveContext('m1').lastSavedCode).toBe('beta');

    // And the next edit goes into step B.
    editor.code = 'beta edited';
    fetchMock.mockImplementationOnce(async () => ok(row({ code: 'beta edited', steps: STEPS }, V3)));
    await expect(save('m1')).resolves.toBe(true);
    expect(stepCodes(lastSent())).toEqual(['alpha edited', 'beta edited']);
  });

  it('text typed while a save is in flight survives that save answering after a step switch', async () => {
    let answerFirst: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    fetchMock.mockImplementationOnce(async () => ok(row({ code: 'beta', steps: STEPS }, V3)));

    editor.code = 'T1';
    let inFlight: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      inFlight = hook.saveSpecificTrack('m1', false);
    });
    await flush();
    editor.code = 'T2';
    await React.act(async () => ops.switchToStep('m1', 1));

    await React.act(async () => {
      answerFirst(ok(row({ code: 'T1', steps: STEPS }, V2)));
      await inFlight;
    });
    await flush();

    expect(hook.tracks.m1.steps[0].code).toBe('T2');
    expect(stepCodes(lastSent())).toEqual(['T2', 'beta']);
  });

  it('a step switch during auto-format drops that save, not the text: the switch carried it', async () => {
    settings = { isPrettierEnabled: true, prettierAutoFormatOnSave: true };
    let finishFormat: (value: { success: boolean; formattedCode: string }) => void = () => {};
    autoFormatOnSave.mockImplementationOnce(() => new Promise((resolve) => (finishFormat = resolve)));
    answerWith();
    editor.code = 'alpha edited';
    let saving: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      saving = hook.saveSpecificTrack('m1', false);
    });
    await flush();
    await React.act(async () => ops.switchToStep('m1', 1));
    await flush();
    await React.act(async () => {
      finishFormat({ success: true, formattedCode: 'alpha edited' });
      await saving;
    });
    await flush();
    expect(sent()).toHaveLength(1);
    expect(stepCodes(lastSent())).toEqual(['alpha edited', 'beta']);
    expect(lastSent().updates.activeStep).toBe(1);
  });

  it('adding a step persists it, with the text in the editor', async () => {
    answerWith();
    editor.code = 'alpha edited';
    await React.act(async () => ops.addStep('m1'));
    await flush();
    expect(stepCodes(lastSent())).toEqual(['alpha edited', 'beta', '// New step\n']);
    expect(editor.code).toBe('alpha edited');
  });

  it('renaming a step persists it', async () => {
    answerWith();
    await React.act(async () => hook.setRenamingStep({ trackId: 'm1', stepIndex: 1 }));
    await React.act(async () => hook.setRenameValue('Bravo'));
    await flush();
    await React.act(async () => ops.finishRenameStep());
    await flush();
    expect(lastSent().updates.steps.map((s: { name: string }) => s.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('deleting another step keeps the text and shifts the active index', async () => {
    answerWith();
    await React.act(async () => ops.switchToStep('m1', 1));
    await flush();
    editor.code = 'beta edited';
    await React.act(async () => ops.deleteStep('m1', 0));
    await flush();
    expect(lastSent().updates).toMatchObject({ code: 'beta edited', activeStep: 0 });
    expect(stepCodes(lastSent())).toEqual(['beta edited']);
  });

  it('deleting the open step puts the next one in the editor, so its text is not saved over it', async () => {
    answerWith();
    editor.code = 'alpha edited';
    await React.act(async () => ops.deleteStep('m1', 0));
    await flush();
    expect(editor.code).toBe('beta');
    expect(lastSent().updates).toMatchObject({ code: 'beta', activeStep: 0 });
    expect(stepCodes(lastSent())).toEqual(['beta']);
    fetchMock.mockClear();
    await expect(save('m1')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converting a track to a multitrack persists it', async () => {
    answerWith();
    await open('t2');
    await React.act(async () => ops.convertToMultitrack(hook.tracks.t2));
    await flush();
    expect(lastSent().trackId).toBe('t2');
    expect(lastSent().updates).toMatchObject({ isMultitrack: true, activeStep: 0, code: 'other code' });
    expect(stepCodes(lastSent())).toEqual(['other code']);
  });

  it('a step change that failed is sent again by the next save, even with no new typing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'down' }), { status: 500 }));
    await React.act(async () => ops.addStep('m1'));
    await flush();
    answerWith();
    fetchMock.mockClear();
    await expect(save('m1')).resolves.toBe(true);
    expect(stepCodes(lastSent())).toEqual(['alpha', 'beta', '// New step\n']);
    expect(hook.hasUnsavedEdits()).toBe(false);
  });

  it('step operations are refused while a conflict is open, so nothing changes under the choice', async () => {
    trackVersions.pause('m1');
    await React.act(async () => ops.switchToStep('m1', 1));
    await React.act(async () => ops.addStep('m1'));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.tracks.m1).toMatchObject({ activeStep: 0 });
    expect(hook.tracks.m1.steps).toHaveLength(2);
  });

  it('a step change refused by the version check raises the notice and keeps the text', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: 'x',
            code: 'version_conflict',
            current: { version: V2, code: 'alpha', steps: [{ id: 's1', name: 'Alpha', code: 'theirs' }] },
          }),
          { status: 409 },
        ),
    );
    editor.code = 'alpha edited';
    await React.act(async () => ops.addStep('m1'));
    await flush();
    expect(trackConflictStore.get()).toMatchObject({ trackId: 'm1', kind: 'changed' });
  });

  it('Keep mine on a multitrack sends the steps with the text in place', async () => {
    trackConflictStore.set({
      trackId: 'm1',
      trackName: 'multi',
      kind: 'changed',
      restored: false,
      busy: false,
      failed: false,
    });
    trackVersions.pause('m1');
    remote = { updated_at: V3, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'multi' };
    answerWith();
    editor.code = 'alpha kept';
    await React.act(async () => hook.trackConflict!.keepMine());
    await flush();
    expect(lastSent().expectedVersion).toBe(V3);
    expect(lastSent().updates.code).toBe('alpha kept');
    expect(stepCodes(lastSent())).toEqual(['alpha kept', 'beta']);
    expect(hook.tracks.m1.code).toBe('alpha kept');
  });

  it('Load the new version on a multitrack stays on the step, and shows its server text', async () => {
    await React.act(async () => ops.switchToStep('m1', 1));
    await flush();
    trackConflictStore.set({
      trackId: 'm1',
      trackName: 'multi',
      kind: 'changed',
      restored: false,
      busy: false,
      failed: false,
    });
    trackVersions.pause('m1');
    fetchMock.mockClear();
    const theirs = [STEPS[0], { ...STEPS[1], code: 'beta from elsewhere' }];
    remote = { updated_at: V3, code: 'alpha', steps: theirs, is_multitrack: true, active_step: 0, name: 'multi' };
    await React.act(async () => hook.trackConflict!.loadNewVersion());
    await flush();
    expect(editor.code).toBe('beta from elsewhere');
    expect(hook.tracks.m1).toMatchObject({ activeStep: 1, code: 'beta from elsewhere' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(editor.evaluate).not.toHaveBeenCalled();
  });
});

describe('rows that disagree, as on prod', () => {
  const legacy = (code: string) => multi({ activeStep: 1, code });

  it('active_step 1 with code equal to step 0: loads step 1, loses nothing, writes nothing', async () => {
    remote = { updated_at: V1, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 1, name: 'multi' };
    await mount([legacy('alpha')]);
    await open('m1');
    await flush();
    expect(editor.code).toBe('beta');
    expect(hook.tracks.m1.steps.map((s) => s.code)).toEqual(['alpha', 'beta']);
    fetchMock.mockClear();
    expect(hook.hasUnsavedEdits()).toBe(false);
    globalSaveManager.protectUnsavedWork();
    await expect(save('m1')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackConflictStore.get()).toBeNull();
  });

  it('code matching no step: shown as its own step, stored with the next real save, and no write before that', async () => {
    remote = { updated_at: V1, code: 'old edits', steps: STEPS, is_multitrack: true, active_step: 1, name: 'multi' };
    await mount([legacy('old edits')]);
    await open('m1');
    await flush();
    expect(hook.tracks.m1.steps.map((s) => s.code)).toEqual(['alpha', 'beta', 'old edits']);
    expect(hook.tracks.m1.steps[2].name).toBe('Recovered edits');
    fetchMock.mockClear();
    globalSaveManager.protectUnsavedWork();
    await expect(save('m1')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => ok(row({ code: 'beta edited', steps: STEPS }, V2)));
    editor.code = 'beta edited';
    await expect(save('m1')).resolves.toBe(true);
    expect(lastSent().updates.steps.map((s: { code: string }) => s.code)).toEqual([
      'alpha',
      'beta edited',
      'old edits',
    ]);
    expect(trackConflictStore.get()).toBeNull();
  });

  it('the page load opens the step the URL names, locally, with no write', async () => {
    remote = { updated_at: V1, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'multi' };
    const data = { tracks: [multi()], folders: [], targetTrackId: 'm1', targetStepName: 'beta' };
    const context = { editorRef: { current: editor }, activeCode: '', handleUpdate };
    function Harness(): ReactNode {
      hook = useSupabaseFileManager(context as never, data as never, false);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await React.act(async () => root.render(React.createElement(Harness)));
    await flush();
    unmount = () => React.act(() => root.unmount());
    expect(hook.tracks.m1).toMatchObject({ activeStep: 1, code: 'beta' });
    fetchMock.mockClear();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a plain track is untouched by all this: it sends code alone', async () => {
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'saved')]);
    await open('t1');
    fetchMock.mockClear();
    editor.code = 'typed';
    await expect(save('t1')).resolves.toBe(true);
    expect(Object.keys(lastSent().updates).sort()).toEqual(['code', 'modified']);
  });
});

describe('findings from the review of this work', () => {
  beforeEach(() => {
    remote = { updated_at: V1, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'multi' };
  });

  const answerWith = () =>
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { updates } = JSON.parse(String(init.body));
      return ok(row({ code: updates.code, steps: updates.steps, active_step: updates.activeStep }, V2));
    });
  const stepCodes = (body: { updates: { steps: Array<{ code: string }> } }) => body.updates.steps.map((s) => s.code);

  it('blocker 1: Keep mine on a restored draft writes to the step the draft belongs to, not the one the URL opened', async () => {
    // The last page typed in Beta. This page opened on Alpha.
    const draftSteps = [STEPS[0], { ...STEPS[1], code: 'beta typed before reload' }];
    localStorage.setItem(
      'strudel-conflict-draft:m1:tab-reload',
      JSON.stringify({
        userId: USER.id,
        tabId: 'tab-reload',
        trackId: 'm1',
        stepIndex: 1,
        code: 'beta typed before reload',
        steps: draftSteps,
        baseVersion: V1,
        createdAt: Date.now() - 60_000,
        name: 'multi',
        folder: null,
        isMultitrack: true,
      }),
    );
    sessionStorage.setItem('strudel-tab-id', 'tab-reload');
    await mount([multi()]);
    await open('m1');
    await vi.waitFor(() => expect(trackConflictStore.get()).toMatchObject({ draftOrigin: 'unsaved' }));
    await flush();
    expect(editor.code).toBe('beta typed before reload');
    expect(hook.tracks.m1.activeStep).toBe(1);

    answerWith();
    fetchMock.mockClear();
    remote = { updated_at: V1, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'multi' };
    await React.act(async () => hook.trackConflict!.keepMine());
    await flush();
    expect(stepCodes(lastSent())).toEqual(['alpha', 'beta typed before reload']);
    expect(lastSent().updates.activeStep).toBe(1);
    sessionStorage.removeItem('strudel-tab-id');
  });

  it('finding 4: Keep mine on a deleted multitrack recreates it with the typed text in its step', async () => {
    await mount([multi({ activeStep: 1, code: 'beta' })]);
    await open('m1');
    editor.code = 'beta typed';
    remote = null;
    await React.act(async () => hook.trackConflict!.check());
    expect(trackConflictStore.get()?.kind).toBe('deleted');
    fetchMock.mockClear();
    const created = { ...multi(), id: 'm2', version: V2 };
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ success: true, track: created }), { status: 201 }),
    );
    remote = { updated_at: V2, code: 'beta typed', steps: STEPS, is_multitrack: true, active_step: 1, name: 'multi' };
    const readsGone = remote;
    remote = null;
    await React.act(async () => {
      const keeping = hook.trackConflict!.keepMine();
      await flush();
      remote = readsGone;
      await keeping;
    });
    expect(lastSent()).toMatchObject({ code: 'beta typed', activeStep: 1 });
    expect(lastSent().steps.map((s: { code: string }) => s.code)).toEqual(['alpha', 'beta typed']);
  });

  it('finding 10: auto-format finishing after a step switch leaves the editor alone', async () => {
    settings = { isPrettierEnabled: true, prettierAutoFormatOnSave: true };
    let finishFormat: (value: { success: boolean; formattedCode: string }) => void = () => {};
    autoFormatOnSave.mockImplementationOnce(() => new Promise((resolve) => (finishFormat = resolve)));
    await mount([multi()]);
    await open('m1');
    answerWith();
    editor.code = 'alpha edited';
    let saving: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      saving = hook.saveSpecificTrack('m1', false);
    });
    await flush();
    await React.act(async () => ops.switchToStep('m1', 1));
    await flush();
    editor.setCode.mockClear();
    await React.act(async () => {
      finishFormat({ success: true, formattedCode: 'alpha FORMATTED' });
      await saving;
    });
    await flush();
    expect(editor.setCode).not.toHaveBeenCalled();
    expect(editor.code).toBe('beta');
  });

  it('finding 10: nor does it replace what was typed during the format', async () => {
    settings = { isPrettierEnabled: true, prettierAutoFormatOnSave: true };
    let finishFormat: (value: { success: boolean; formattedCode: string }) => void = () => {};
    autoFormatOnSave.mockImplementationOnce(() => new Promise((resolve) => (finishFormat = resolve)));
    await mount([plain('t1', 'one', 'saved')]);
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await open('t1');
    answerWith();
    editor.code = 'typed';
    let saving: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      saving = hook.saveSpecificTrack('t1', false);
    });
    await flush();
    editor.code = 'typed and typing';
    editor.setCode.mockClear();
    await React.act(async () => {
      finishFormat({ success: true, formattedCode: 'FORMATTED' });
      await saving;
    });
    expect(editor.setCode).not.toHaveBeenCalled();
    expect(editor.code).toBe('typed and typing');
  });

  it('finding 12: a save-before-switch that fails keeps the text in a draft, offered on the way back', async () => {
    remote = { updated_at: V1, code: 'one code', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'one code'), plain('t2', 'two', 'two code')]);
    await open('t1');
    editor.code = 'typed in one';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'down' }), { status: 500 }));
    await React.act(async () => ops.handleTrackSelect(hook.tracks.t2));
    await flush();
    expect(hook.selectedTrack).toBe('t2');
    expect(draftOf('t1')).toMatchObject({ code: 'typed in one' });

    fetchMock.mockImplementation(async () => ok(row({ code: 'any', steps: [] })));
    await React.act(async () => ops.handleTrackSelect(hook.tracks.t1));
    await vi.waitFor(() => expect(trackConflictStore.get()).toMatchObject({ trackId: 't1', draftOrigin: 'unsaved' }));
    await flush();
    expect(editor.code).toBe('typed in one');
  });

  it('retry flag: a save built before a step change does not mark that change as saved', async () => {
    await mount([multi()]);
    await open('m1');
    let answerFirst: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'down' }), { status: 500 }));
    editor.code = 'alpha edited';
    let inFlight: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => {
      inFlight = hook.saveSpecificTrack('m1', false);
    });
    await flush();
    await React.act(async () => ops.addStep('m1'));
    await React.act(async () => {
      answerFirst(ok(row({ code: 'alpha edited', steps: STEPS }, V2)));
      await inFlight;
    });
    await flush();
    expect(hook.hasUnsavedEdits()).toBe(true);
  });

  it('autosave arrives though the check runs every 2 s, at any interval over that (the default is 30 s)', async () => {
    autosave.enabled = true;
    autosave.interval = 2500;
    window.history.replaceState(null, '', '/repl/one');
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'saved')]);
    await open('t1');
    fetchMock.mockClear();
    answerWith();
    editor.code = 'typed';
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5500));
    });
    expect(sent()).toHaveLength(1);
    expect(lastSent().updates.code).toBe('typed');
  }, 9000);

  it('a fallback load seeds the baseline and reconciles, like every other load', async () => {
    const tree = {
      id: 'root',
      children: [{ ...multi({ activeStep: 1, code: 'old edits' }), type: 'track', version: V1 }],
    };
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(tree), { status: 200 }));
    await mount([]);
    await React.act(async () => {
      await hook.loadDataFromSupabase();
    });
    await flush();
    expect(trackVersions.get('m1')?.version).toBe(V1);
    expect(hook.tracks.m1.code).toBe('beta');
    expect(hook.tracks.m1.steps.map((s) => s.code)).toEqual(['alpha', 'beta', 'old edits']);
  });

  it('Load the new version on a row converted elsewhere makes it a multitrack here too', async () => {
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'saved')]);
    await open('t1');
    trackConflictStore.set({ trackId: 't1', trackName: 'one', kind: 'changed', busy: false, failed: false });
    trackVersions.pause('t1');
    remote = { updated_at: V2, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'one' };
    await React.act(async () => hook.trackConflict!.loadNewVersion());
    await flush();
    expect(hook.tracks.t1).toMatchObject({ isMultitrack: true, code: 'alpha' });
    expect(hook.tracks.t1.steps).toHaveLength(2);
  });

  describe('step clicks', () => {
    beforeEach(async () => {
      await mount([multi()]);
      await open('m1');
      fetchMock.mockClear();
    });

    it('with nothing typed writes nothing, so the library order and other tabs are untouched', async () => {
      const modified = hook.tracks.m1.modified;
      await React.act(async () => ops.switchToStep('m1', 1));
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(hook.tracks.m1).toMatchObject({ activeStep: 1, code: 'beta', modified });
      expect(hook.hasUnsavedEdits()).toBe(false);
    });

    it('the next real save records the step as active', async () => {
      await React.act(async () => ops.switchToStep('m1', 1));
      await flush();
      answerWith();
      editor.code = 'beta edited';
      await save('m1');
      expect(lastSent().updates).toMatchObject({ activeStep: 1, code: 'beta edited' });
    });
  });

  describe('a session ending', () => {
    beforeEach(async () => {
      remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
      await mount([plain('t1', 'one', 'saved')]);
      await open('t1');
      fetchMock.mockClear();
      editor.code = 'typed';
    });

    it('a save that lands removes the draft: a shared browser keeps no copy', async () => {
      answerWith();
      globalSaveManager.protectUnsavedWork();
      await React.act(async () => globalSaveManager.unloadSaveSettled());
      await flush();
      expect(lastSent().updates.code).toBe('typed');
      expect(draftOf('t1')).toBeNull();
    });

    it('one refused (the session is already over) leaves the draft: it is the only copy', async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 }));
      globalSaveManager.protectUnsavedWork();
      await React.act(async () => globalSaveManager.unloadSaveSettled());
      await flush();
      expect(draftOf('t1')).toMatchObject({ code: 'typed', userId: USER.id });
    });

    it('a page on its way out leaves the draft even when its save lands, for the page after it', async () => {
      answerWith();
      window.dispatchEvent(new Event('pagehide'));
      await flush();
      expect(lastSent().updates.code).toBe('typed');
      expect(draftOf('t1')).toMatchObject({ code: 'typed' });
      window.dispatchEvent(new Event('pageshow'));
    });
  });
});

describe('re-review', () => {
  const answerWith = () =>
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { updates } = JSON.parse(String(init.body));
      return ok(row({ code: updates.code, steps: updates.steps ?? [], active_step: updates.activeStep }, V2));
    });

  describe('major 1: an older draft and a newer save', () => {
    beforeEach(async () => {
      remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
      await mount([plain('t1', 'one', 'saved')]);
      await open('t1');
      fetchMock.mockClear();
    });

    it('the save removes it, though its text differs', async () => {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      // Too large to send, so the draft is all that's kept of T1.
      editor.code = `${'x'.repeat(70 * 1024)}T1`;
      globalSaveManager.protectUnsavedWork();
      expect(draftOf('t1')).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 2));
      answerWith();
      editor.code = 'T2';
      await save('t1');
      expect(draftOf('t1')).toBeNull();
    });

    it('so it never comes back over the newer text', async () => {
      editor.code = `${'x'.repeat(70 * 1024)}T1`;
      globalSaveManager.protectUnsavedWork();
      await new Promise((resolve) => setTimeout(resolve, 2));
      answerWith();
      editor.code = 'T2';
      await save('t1');
      remote = { updated_at: V2, code: 'T2', steps: [], name: 'one' };
      await React.act(async () => hook.trackConflict!.check());
      await flush();
      expect(trackConflictStore.get()).toBeNull();
      expect(editor.code).toBe('T2');
    });
  });

  describe("major 3: this tab's own save in flight", () => {
    it('moves the draft written meanwhile onto its new version, keeping the newer text', async () => {
      remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
      await mount([plain('t1', 'one', 'saved')]);
      await open('t1');
      let answer: (response: Response) => void = () => {};
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
      editor.code = 'T1';
      let inFlight: Promise<boolean> = Promise.resolve(false);
      await React.act(async () => {
        inFlight = hook.saveSpecificTrack('t1', false);
      });
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 2));
      editor.code = 'T2 newest';
      globalSaveManager.protectUnsavedWork();
      expect(draftOf('t1')).toMatchObject({ code: 'T2 newest', baseVersion: V1 });
      await React.act(async () => {
        answer(ok(row({ code: 'T1', steps: [] }, V2)));
        await inFlight;
      });
      expect(draftOf('t1')).toMatchObject({ code: 'T2 newest', baseVersion: V2 });
    });
  });

  it('major 2: a restored draft stays on screen, with activePattern on its step, reached as a page load does', async () => {
    const draftSteps = [STEPS[0], { ...STEPS[1], code: 'beta typed' }];
    localStorage.setItem(
      'strudel-conflict-draft:m1:tab-m2',
      JSON.stringify({
        userId: USER.id,
        tabId: 'tab-m2',
        trackId: 'm1',
        stepIndex: 1,
        code: 'beta typed',
        steps: draftSteps,
        baseVersion: V1,
        createdAt: Date.now() - 60_000,
        name: 'multi',
        folder: null,
        isMultitrack: true,
      }),
    );
    sessionStorage.setItem('strudel-tab-id', 'tab-m2');
    window.history.replaceState(null, '', '/repl/multi?step=alpha');
    remote = { updated_at: V1, code: 'alpha', steps: STEPS, is_multitrack: true, active_step: 0, name: 'multi' };
    await mount([multi()]);
    // ReplEditor.tsx: the page load selects the track without loadTrack, and puts its text in the editor.
    await React.act(async () => {
      activePattern = 'multi?step=alpha';
      hook.setSelectedTrack('m1');
      editor.code = 'alpha';
    });
    await vi.waitFor(() => expect(trackConflictStore.get()).toMatchObject({ draftOrigin: 'unsaved' }));
    await flush();
    await flush();
    expect(activePattern).toBe('multi?step=beta');
    expect(editor.code).toBe('beta typed');
    expect(hook.tracks.m1).toMatchObject({ activeStep: 1, code: 'beta typed' });
    sessionStorage.removeItem('strudel-tab-id');
  });

  describe('an empty editor', () => {
    it('never falls back to the stale activeCode: autosave writes nothing', async () => {
      window.history.replaceState(null, '', '/repl/a');
      autosave.enabled = true;
      autosave.interval = 30;
      remote = { updated_at: V1, name: 'a', folder: null, code: 'current', steps: [] };
      const data = { tracks: [plain('a', 'a', 'current')], folders: [] };
      const context = { editorRef: { current: editor }, activeCode: 'old evaluated text', handleUpdate };
      function Harness(): ReactNode {
        hook = useSupabaseFileManager(context as never, data as never, false);
        return null;
      }
      const root = createRoot(document.createElement('div'));
      await React.act(async () => root.render(React.createElement(Harness)));
      await flush();
      unmount = () => React.act(() => root.unmount());
      await open('a');
      await flush();
      fetchMock.mockClear();
      editor.code = '';
      await React.act(async () => {
        hook.scheduleTrackAutosave('a');
        await new Promise((resolve) => setTimeout(resolve, 120));
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(hook.hasUnsavedEdits()).toBe(false);
      globalSaveManager.protectUnsavedWork();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('a deleted track whose name was taken saves under a free name, so the notice can be left', async () => {
    remote = { updated_at: V1, code: 'one code', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'one code'), plain('t2', 'taken', 'x')]);
    await open('t1');
    await React.act(async () => {
      hook.setTracks((prev) => ({ ...prev, t2: { ...prev.t2, name: 'one' }, t1: { ...prev.t1, name: 'one' } }));
    });
    editor.code = 'typed';
    remote = null;
    await React.act(async () => hook.trackConflict!.check());
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(async () => {
      remote = { updated_at: V2, code: 'typed', steps: [], name: 'one 2' };
      return new Response(JSON.stringify({ success: true, track: { ...plain('t3', 'one 2', 'typed'), version: V2 } }), {
        status: 201,
      });
    });
    await React.act(async () => hook.trackConflict!.keepMine());
    expect(lastSent().name).toBe('one 2');
    expect(trackConflictStore.get()).toBeNull();
  });

  it('an expired draft is removed and the user is told, by name', async () => {
    const warning = vi.fn();
    const { toastActions } = await import('@src/stores/toastStore');
    vi.spyOn(toastActions, 'warning').mockImplementation(warning);
    localStorage.setItem(
      'strudel-conflict-draft:t1:old-tab',
      JSON.stringify({
        userId: USER.id,
        tabId: 'old-tab',
        trackId: 't1',
        stepIndex: 0,
        code: 'very old',
        steps: [],
        baseVersion: V1,
        createdAt: Date.now() - 31 * 24 * 3600 * 1000,
        name: 'one',
        folder: null,
        isMultitrack: false,
      }),
    );
    remote = { updated_at: V1, code: 'saved', steps: [], name: 'one' };
    await mount([plain('t1', 'one', 'saved')]);
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith('files:trackConflict.draftExpired'));
    expect(draftOf('t1')).toBeNull();
  });
});
