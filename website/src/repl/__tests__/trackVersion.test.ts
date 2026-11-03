/**
 * @spec: 018-strudel-mcp-server (functional 2.4, 2.5; tech 2.6)
 * secureApi.updateTrack and the per-track baseline: what each save names, and how it moves. The
 * server is a fake with the real route's answers, including a real-format version.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as VersionModule from '../trackVersion';
import type * as ApiModule from '@src/lib/secureApi';

const V1 = '2026-11-03T00:09:28.401191+00:00';
const V2 = '2026-11-03T00:09:29.000002+00:00';
const V3 = '2026-11-03T00:09:30.000003+00:00';

let versionMod: typeof VersionModule;
let api: typeof ApiModule;
let fetchMock: ReturnType<typeof vi.fn>;

const row = (code: string, updated_at: string, extra: Record<string, unknown> = {}) => ({
  id: 't1',
  code,
  steps: [],
  updated_at,
  ...extra,
});
const ok = (track: unknown) => new Response(JSON.stringify({ success: true, track }), { status: 200 });
const conflict = (current: Record<string, unknown>) =>
  new Response(JSON.stringify({ error: 'changed', code: 'version_conflict', current }), { status: 409 });
const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('@src/lib/authUtils', () => ({
    ensureValidSession: async () => ({ success: true, session: { access_token: 'token' } }),
  }));
  vi.doMock('../../lib/authUtils', () => ({
    ensureValidSession: async () => ({ success: true, session: { access_token: 'token' } }),
  }));
  api = await import('@src/lib/secureApi');
  versionMod = await import('../trackVersion');
});

afterAll(() => {
  vi.doUnmock('@src/lib/authUtils');
  vi.doUnmock('../../lib/authUtils');
  vi.resetModules();
});

beforeEach(() => {
  versionMod.trackVersions.reset();
  versionMod.trackVersions.seed([row('a', V1)]);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('a save', () => {
  it('names the version this tab read, exactly as it came', async () => {
    fetchMock.mockResolvedValueOnce(ok(row('b', V2)));
    await api.secureApi.updateTrack('t1', { code: 'b' });
    expect(sentBodies()[0]).toEqual({ trackId: 't1', updates: { code: 'b' }, expectedVersion: V1 });
  });

  it('moves the baseline to the version the server returned', async () => {
    fetchMock.mockResolvedValueOnce(ok(row('b', V2))).mockResolvedValueOnce(ok(row('c', V3)));
    await api.secureApi.updateTrack('t1', { code: 'b' });
    expect(versionMod.trackVersions.get('t1')).toMatchObject({ version: V2, code: 'b' });
    await api.secureApi.updateTrack('t1', { code: 'c' });
    expect(sentBodies()[1].expectedVersion).toBe(V2);
    expect(versionMod.trackVersions.get('t1')).toMatchObject({ version: V3, code: 'c' });
  });

  it('with no known version sends none, as a tab did before this feature', async () => {
    versionMod.trackVersions.forget('t1');
    fetchMock.mockResolvedValueOnce(ok(row('b', V2)));
    await api.secureApi.updateTrack('t1', { code: 'b' });
    expect(sentBodies()[0]).not.toHaveProperty('expectedVersion');
  });

  it('an unrelated failure keeps its message and leaves the baseline', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Failed to update track' }), { status: 500 }));
    await expect(api.secureApi.updateTrack('t1', { code: 'b' })).rejects.toThrow('Failed to update track');
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
  });

  it('a name clash stays what it was, not a version conflict', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'taken', code: 'duplicate' }), { status: 409 }),
    );
    const error = await api.secureApi.updateTrack('t1', { name: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).not.toBeInstanceOf(versionMod.VersionConflictError);
  });

  it('a deleted track comes back as a 404 ApiError', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Track not found' }), { status: 404 }));
    await expect(api.secureApi.updateTrack('t1', { code: 'b' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('two saves in flight', () => {
  it("the second waits for the first and names its version: a tab's own save is never a conflict", async () => {
    let answerFirst: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    fetchMock.mockResolvedValueOnce(ok(row('c', V3)));

    const first = api.secureApi.updateTrack('t1', { code: 'b' });
    const second = api.secureApi.updateTrack('t1', { code: 'c' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Nothing else leaves the tab while the first is out.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answerFirst(ok(row('b', V2)));
    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeDefined();
    expect(sentBodies().map((body) => body.expectedVersion)).toEqual([V1, V2]);
    expect(versionMod.trackVersions.get('t1')).toMatchObject({ version: V3, code: 'c' });
  });

  it('a failed first save does not block the second', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(ok(row('c', V2)));
    const first = api.secureApi.updateTrack('t1', { code: 'b' });
    const second = api.secureApi.updateTrack('t1', { code: 'c' });
    await expect(first).rejects.toThrow('offline');
    await expect(second).resolves.toBeDefined();
    expect(sentBodies()[1].expectedVersion).toBe(V1);
  });

  it('saves of different tracks do not wait for each other', async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    fetchMock.mockResolvedValueOnce(ok({ ...row('x', V2), id: 't2' }));
    void api.secureApi.updateTrack('t1', { code: 'b' });
    await expect(api.secureApi.updateTrack('t2', { code: 'x' })).resolves.toBeDefined();
  });

  it('reports the activity a poll compares, start and end', async () => {
    const before = versionMod.trackVersions.activity('t1');
    fetchMock.mockResolvedValueOnce(ok(row('b', V2)));
    const save = api.secureApi.updateTrack('t1', { code: 'b' });
    expect(versionMod.trackVersions.isBusy('t1')).toBe(true);
    expect(versionMod.trackVersions.activity('t1')).not.toBe(before);
    await save;
    expect(versionMod.trackVersions.isBusy('t1')).toBe(false);
  });
});

describe('a 409', () => {
  it('with different content raises VersionConflictError, carrying the server copy', async () => {
    fetchMock.mockResolvedValueOnce(conflict({ version: V2, code: 'theirs', steps: [] }));
    const error = await api.secureApi.updateTrack('t1', { code: 'mine' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(versionMod.VersionConflictError);
    expect((error as VersionModule.VersionConflictError).current).toMatchObject({ version: V2, code: 'theirs' });
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('with the same content (a folder move) saves again on the new version, unnoticed', async () => {
    fetchMock
      .mockResolvedValueOnce(conflict({ version: V2, code: 'a', steps: [], folder: 'moved' }))
      .mockResolvedValueOnce(ok(row('mine', V3)));
    await api.secureApi.updateTrack('t1', { code: 'mine' });
    expect(sentBodies().map((body) => body.expectedVersion)).toEqual([V1, V2]);
    expect(versionMod.trackVersions.get('t1')).toMatchObject({ version: V3, code: 'mine' });
  });

  it('retries once only', async () => {
    fetchMock
      .mockResolvedValueOnce(conflict({ version: V2, code: 'a', steps: [] }))
      .mockResolvedValueOnce(conflict({ version: V3, code: 'a', steps: [] }));
    await expect(api.secureApi.updateTrack('t1', { code: 'mine' })).rejects.toBeInstanceOf(
      versionMod.VersionConflictError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finding 6: a plain save on a row converted to a multitrack elsewhere is a conflict, not a success', async () => {
    fetchMock.mockResolvedValueOnce(
      conflict({
        version: V2,
        code: 'a',
        steps: [{ id: 's', name: 'S', code: 'a' }],
        isMultitrack: true,
        activeStep: 0,
      }),
    );
    await expect(api.secureApi.updateTrack('t1', { code: 'typed' })).rejects.toBeInstanceOf(
      versionMod.VersionConflictError,
    );
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
  });

  it('holding exactly what this save writes (an answer got lost) is success, not a conflict', async () => {
    fetchMock.mockResolvedValueOnce(conflict({ version: V2, code: 'mine', steps: [] }));
    await expect(api.secureApi.updateTrack('t1', { code: 'mine' })).resolves.toMatchObject({
      track: { version: V2, code: 'mine' },
    });
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V2);
  });
});

describe('while paused', () => {
  it('no save leaves the tab', async () => {
    versionMod.trackVersions.pause('t1');
    await expect(api.secureApi.updateTrack('t1', { code: 'mine' })).rejects.toBeInstanceOf(
      versionMod.VersionConflictError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('db.tracks.update reports it as an error rather than throwing', async () => {
    versionMod.trackVersions.pause('t1');
    const { error } = await api.db.tracks.update('t1', { code: 'mine' });
    expect(error).toBeInstanceOf(versionMod.VersionConflictError);
  });
});

describe('force (a chosen overwrite: import)', () => {
  it('names no version, ignores the pause, and leaves the baseline so an open tab still finds out', async () => {
    versionMod.trackVersions.pause('t1');
    fetchMock.mockResolvedValueOnce(ok(row('imported', V2)));
    await api.db.tracks.update('t1', { code: 'imported' }, { force: true });
    expect(sentBodies()[0]).not.toHaveProperty('expectedVersion');
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
  });
});

describe('saveOnUnload', () => {
  const answered = () => new Response(JSON.stringify({ success: true, track: row('b', V2) }), { status: 200 });

  it('calls fetch before returning: nothing after an await is sure to run', () => {
    fetchMock.mockResolvedValue(answered());
    expect(api.secureApi.saveOnUnload('t1', { code: 'b' })).toBe('sent');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses keepalive and the cookie, and still names the version', () => {
    fetchMock.mockResolvedValue(answered());
    api.secureApi.saveOnUnload('t1', { code: 'b' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({ updates: { code: 'b' }, expectedVersion: V1 });
  });

  it('refuses a body keepalive would reject, counted in bytes', () => {
    expect(api.secureApi.saveOnUnload('t1', { code: 'é'.repeat(api.KEEPALIVE_MAX_BYTES / 2 + 1) })).toBe('too-large');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(answered());
    expect(api.secureApi.saveOnUnload('t1', { code: 'a'.repeat(api.KEEPALIVE_MAX_BYTES / 2) })).toBe('sent');
  });

  it('sends nothing with a save in flight: its version would be stale', async () => {
    let finish: () => void = () => {};
    const save = versionMod.trackVersions.serialize('t1', () => new Promise<void>((resolve) => (finish = resolve)));
    expect(api.secureApi.saveOnUnload('t1', { code: 'b' })).toBe('busy');
    expect(fetchMock).not.toHaveBeenCalled();
    finish();
    await save;
  });

  it('sends nothing during a conflict', () => {
    versionMod.trackVersions.pause('t1');
    expect(api.secureApi.saveOnUnload('t1', { code: 'b' })).toBe('busy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('if the page stays, the baseline moves, and the next save names the new version', async () => {
    fetchMock.mockResolvedValueOnce(answered());
    const saved = new Promise((resolve) => api.secureApi.saveOnUnload('t1', { code: 'b' }, resolve));
    await saved;
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V2);
  });

  it('a version conflict is reported and nothing moves', async () => {
    fetchMock.mockResolvedValueOnce(conflict({ version: V2, code: 'theirs', steps: [] }));
    const answer = await new Promise<{ conflict?: unknown }>((resolve) =>
      api.secureApi.saveOnUnload('t1', { code: 'b' }, resolve),
    );
    expect(answer.conflict).toMatchObject({ code: 'theirs' });
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
  });

  it('a cancelled request causes no unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new TypeError('cancelled'));
    expect(api.secureApi.saveOnUnload('t1', { code: 'b' })).toBe('sent');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});

describe('delete', () => {
  it('counts as activity, and forgets the track', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const deletion = api.secureApi.deleteTrack('t1');
    expect(versionMod.trackVersions.isBusy('t1')).toBe(true);
    await deletion;
    expect(versionMod.trackVersions.get('t1')).toBeUndefined();
  });

  it('delete all counts as activity for every track', async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const deletion = api.secureApi.deleteAllTracks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(versionMod.trackVersions.isBusy('any')).toBe(true);
    answer(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await deletion;
    expect(versionMod.trackVersions.isBusy('any')).toBe(false);
  });
});

describe('sameContent', () => {
  it('ignores what a person would not call content', async () => {
    const { sameContent } = versionMod;
    const step = { id: 's1', name: 'Intro', code: 'x', modified: '2026-01-01' };
    expect(sameContent({ code: 'a', steps: [step] }, { code: 'a', steps: [{ ...step, modified: '2026-02-02' }] })).toBe(
      true,
    );
  });

  it.each([
    ['code', { code: 'b', steps: [] }],
    ['a step added', { code: 'a', steps: [{ id: 's1', name: 'n', code: 'x' }] }],
  ])('notices %s', (_name, other) => {
    expect(versionMod.sameContent({ code: 'a', steps: [] }, other)).toBe(false);
  });

  it('notices steps reordered and step code changed', () => {
    const a = { id: 'a', name: 'A', code: '1' };
    const b = { id: 'b', name: 'B', code: '2' };
    expect(versionMod.sameContent({ code: '', steps: [a, b] }, { code: '', steps: [b, a] })).toBe(false);
    expect(versionMod.sameContent({ code: '', steps: [a] }, { code: '', steps: [{ ...a, code: '9' }] })).toBe(false);
  });
});

describe('seed', () => {
  it('skips the open track, whose editor still holds what it held', () => {
    versionMod.trackVersions.setOpenTrack('t1');
    versionMod.trackVersions.seed([row('newer', V2)]);
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
  });

  it('takes other tracks, and the open one if it has no baseline yet', () => {
    versionMod.trackVersions.setOpenTrack('t9');
    versionMod.trackVersions.seed([row('newer', V2), { ...row('n', V3), id: 't9' }]);
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V2);
    expect(versionMod.trackVersions.get('t9')?.version).toBe(V3);
  });

  it('reads the API camelCase shape with `version`', () => {
    versionMod.trackVersions.seed([{ id: 't5', code: 'c', steps: [], version: V2, isMultitrack: true, activeStep: 1 }]);
    expect(versionMod.trackVersions.get('t5')).toMatchObject({ version: V2, isMultitrack: true, activeStep: 1 });
  });
});

describe('adoptIfSameContent (a rename this tab sent)', () => {
  it('moves the version when only the version moved', () => {
    versionMod.trackVersions.adoptIfSameContent('t1', row('a', V2, { name: 'renamed' }));
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V2);
  });

  it('stays put when the row shows someone else changed the content, so the poll finds that', () => {
    versionMod.trackVersions.adoptIfSameContent('t1', row('theirs', V2));
    expect(versionMod.trackVersions.get('t1')?.version).toBe(V1);
  });
});
