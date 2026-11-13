/**
 * @spec: 022-set-playlist (2.1 managing sets, 2.2 saving within 2 s; tech §2.3 useSets)
 * Optimistic edits saved after a pause; a failed save keeps the change, tells the user and retries;
 * a version conflict adopts the server's version and re-sends once; renames refuse a clash and keep
 * the old name; a recreated track's items follow it.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSetsStore, newSetItem } from '../setsStore';
import { SetsApiError } from '../setsApi';
import type { SetList } from '../../../lib/setLists';

function manualScheduler() {
  const tasks: Array<{ task: () => void; ms: number; cancelled: boolean }> = [];
  return {
    schedule: (task: () => void, ms: number) => {
      const entry = { task, ms, cancelled: false };
      tasks.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    pending: () => tasks.filter((t) => !t.cancelled),
    runAll: () => {
      const due = tasks.filter((t) => !t.cancelled);
      due.forEach((t) => (t.cancelled = true));
      due.forEach((t) => t.task());
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(initial: SetList[] = [{ id: 's1', name: 'Set 1', items: [], version: 'v1' }]) {
  const server = new Map(initial.map((set) => [set.id, structuredClone(set)]));
  let n = 1;
  const api = {
    list: vi.fn(async () => [...server.values()].map((s) => structuredClone(s))),
    create: vi.fn(async (name?: string) => {
      const set = { id: `new${n++}`, name: name ?? 'x', items: [], version: 'v1' };
      server.set(set.id, set);
      return structuredClone(set);
    }),
    update: vi.fn(async (id: string, changes: Partial<SetList>, expected: string | (() => string)) => {
      const current = server.get(id);
      if (!current) throw new SetsApiError('not_found', 404, 'not_found');
      const version = typeof expected === 'function' ? expected() : expected;
      if (current.version !== version) {
        throw new SetsApiError('version_conflict', 409, 'version_conflict', structuredClone(current));
      }
      const next = { ...current, ...changes, version: `${current.version}+` };
      server.set(id, next);
      return structuredClone(next);
    }),
    remove: vi.fn(async (id: string) => {
      server.delete(id);
    }),
  };
  const scheduler = manualScheduler();
  const onSaveFailed = vi.fn();
  const store = createSetsStore({
    api,
    schedule: scheduler.schedule,
    onSaveFailed,
    debounceMs: 800,
    retryMs: [2000, 4000],
  });
  return { store, api, server, scheduler, onSaveFailed };
}

const add = (trackId: string) => (items: ReturnType<typeof newSetItem>[]) => [...items, newSetItem({ trackId })];

describe('saving item edits', () => {
  it('shows an edit at once and saves several quick edits as one, after a pause under 2 s', async () => {
    const t = setup();
    await t.store.load();
    t.store.updateItems('s1', add('t1'));
    t.store.updateItems('s1', add('t2'));
    expect(t.store.getState().sets[0].items.map((i) => i.trackId)).toEqual(['t1', 't2']);
    expect(t.api.update).not.toHaveBeenCalled();
    expect(t.scheduler.pending().map((p) => p.ms)).toEqual([800]);
    t.scheduler.runAll();
    await flush();
    expect(t.api.update).toHaveBeenCalledTimes(1);
    expect(t.server.get('s1')!.items.map((i) => i.trackId)).toEqual(['t1', 't2']);
    expect(t.store.getState().sets[0].version).toBe('v1+');
  });

  it('a failed save keeps the change on screen, tells the user and retries with backoff', async () => {
    const t = setup();
    await t.store.load();
    t.api.update.mockRejectedValueOnce(new SetsApiError('boom', 500, null));
    t.store.updateItems('s1', add('t1'));
    t.scheduler.runAll();
    await flush();
    expect(t.onSaveFailed).toHaveBeenCalledTimes(1);
    expect(t.store.getState().sets[0].items).toHaveLength(1);
    expect(t.scheduler.pending().map((p) => p.ms)).toEqual([2000]);
    t.scheduler.runAll();
    await flush();
    expect(t.server.get('s1')!.items).toHaveLength(1);
  });

  it('a version conflict adopts the server version and re-sends the local items once', async () => {
    const t = setup();
    await t.store.load();
    t.server.set('s1', { ...t.server.get('s1')!, version: 'v7', name: 'Renamed elsewhere' });
    t.store.updateItems('s1', add('t1'));
    t.scheduler.runAll();
    await flush();
    await flush();
    expect(t.api.update).toHaveBeenCalledTimes(2);
    expect(t.server.get('s1')!.items).toHaveLength(1);
    expect(t.store.getState().sets[0]).toMatchObject({ name: 'Renamed elsewhere', version: 'v7+' });
    expect(t.onSaveFailed).not.toHaveBeenCalled();
  });

  it('a set deleted elsewhere disappears instead of retrying forever', async () => {
    const t = setup();
    await t.store.load();
    t.server.delete('s1');
    t.store.updateItems('s1', add('t1'));
    t.scheduler.runAll();
    await flush();
    expect(t.store.getState().sets).toEqual([]);
    expect(t.scheduler.pending()).toEqual([]);
  });
});

describe('creating, renaming, deleting', () => {
  it('a new set gets the first free "<base> N"', async () => {
    const t = setup();
    await t.store.load();
    const result = await t.store.create(undefined, 'Set');
    expect(result).toMatchObject({ ok: true, set: { name: 'Set 2' } });
  });

  it('a rename to another set’s name is refused and the old name stays', async () => {
    const t = setup([
      { id: 's1', name: 'Set 1', items: [], version: 'v1' },
      { id: 's2', name: 'Friday', items: [], version: 'v1' },
    ]);
    await t.store.load();
    expect(await t.store.rename('s1', 'Friday')).toBe('name_taken');
    expect(await t.store.rename('s1', '   ')).toBe('invalid');
    expect(t.store.getState().sets.find((s) => s.id === 's1')!.name).toBe('Set 1');
    expect(t.api.update).not.toHaveBeenCalled();
  });

  it('a rename the server refuses (name taken elsewhere) keeps the old name', async () => {
    const t = setup();
    await t.store.load();
    t.api.update.mockRejectedValueOnce(new SetsApiError('name_taken', 409, 'name_taken'));
    expect(await t.store.rename('s1', 'Saturday')).toBe('name_taken');
    expect(t.store.getState().sets[0].name).toBe('Set 1');
  });

  it('a rename that is accepted shows the new name', async () => {
    const t = setup();
    await t.store.load();
    expect(await t.store.rename('s1', ' Saturday ')).toBe('ok');
    expect(t.store.getState().sets[0].name).toBe('Saturday');
  });

  it('deleting removes only the set', async () => {
    const t = setup();
    await t.store.load();
    expect(await t.store.remove('s1')).toBe(true);
    expect(t.store.getState().sets).toEqual([]);
  });
});

// Review 022 #4: edits just before the page closes must leave synchronously.
describe('flushOnUnload', () => {
  it('hands every unsaved set to sendOnUnload in the same call, with its latest items and version', async () => {
    const t = setup();
    await t.store.load();
    const sendOnUnload = vi.fn(() => 'sent' as const);
    Object.assign(t.api, { sendOnUnload });
    t.store.updateItems('s1', add('t1'));
    t.store.flushOnUnload();
    expect(sendOnUnload).toHaveBeenCalledTimes(1);
    expect(sendOnUnload).toHaveBeenCalledWith('s1', { items: t.store.getState().sets[0].items }, 'v1');
    // The debounced save is cancelled, not sent a second time.
    expect(t.scheduler.pending()).toEqual([]);
    expect(t.api.update).not.toHaveBeenCalled();
  });

  it('a set waiting to retry after a failed save goes out too', async () => {
    const t = setup();
    await t.store.load();
    t.api.update.mockRejectedValueOnce(new SetsApiError('boom', 500, null));
    t.store.updateItems('s1', add('t1'));
    t.scheduler.runAll();
    await flush();
    const sendOnUnload = vi.fn(() => 'sent' as const);
    Object.assign(t.api, { sendOnUnload });
    t.store.flushOnUnload();
    expect(sendOnUnload).toHaveBeenCalledTimes(1);
  });

  it('negative: nothing unsaved, nothing sent; too large falls back to a normal save', async () => {
    const t = setup();
    await t.store.load();
    const sendOnUnload = vi.fn(() => 'too-large' as const);
    Object.assign(t.api, { sendOnUnload });
    t.store.flushOnUnload();
    expect(sendOnUnload).not.toHaveBeenCalled();
    t.store.updateItems('s1', add('t1'));
    t.store.flushOnUnload();
    await flush();
    expect(t.api.update).toHaveBeenCalledTimes(1);
  });
});

describe('recreated tracks and sign-out', () => {
  it("a recreated track's items follow it", async () => {
    const t = setup();
    await t.store.load();
    t.store.updateItems('s1', add('old'));
    t.store.remapTrackId('old', 'new');
    expect(t.store.getState().sets[0].items[0].trackId).toBe('new');
  });

  it('reset forgets everything and drops late answers', async () => {
    const t = setup();
    const loading = t.store.load();
    t.store.reset();
    await loading;
    expect(t.store.getState()).toMatchObject({ sets: [], loaded: false });
  });
});

describe('newSetItem', () => {
  it('makes a unique Default item, with step fields only for a step', () => {
    const a = newSetItem({ trackId: 't1' });
    const b = newSetItem({ trackId: 't1' });
    expect(a.id).not.toBe(b.id);
    expect(a).toEqual({ id: a.id, trackId: 't1', transition: null });
    expect(newSetItem({ trackId: 'm', stepIndex: 1, stepId: 'x', stepName: 'Drop' })).toMatchObject({
      stepIndex: 1,
      stepId: 'x',
      stepName: 'Drop',
    });
  });
});
