/**
 * @spec: 018-strudel-mcp-server (review)
 * A tab's id survives its reload, but a duplicated tab starts with a copy of a live tab's
 * sessionStorage, so it must notice and take its own, or two tabs would share one draft.
 */
import { describe, expect, it, vi } from 'vitest';
import { claimTab, isTabAlive } from '../tabIdentity';

function fakeLocks(heldNames: string[] = []) {
  const held = new Set(heldNames);
  return {
    held,
    request: vi.fn(async (name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      return callback({ name });
    }),
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
  };
}
const memory = (initial?: string) => {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_k: string, v: string) => void (value = v) };
};
const noWait = async () => {};

describe('claimTab', () => {
  it('a new tab makes an id, and keeps it for its reloads', async () => {
    const storage = memory();
    const { tabId } = await claimTab(storage, fakeLocks() as never, noWait);
    expect(storage.getItem()).toBe(tabId);
  });

  it('a reload keeps its id', async () => {
    await expect(claimTab(memory('tab-1'), fakeLocks() as never, noWait)).resolves.toMatchObject({ tabId: 'tab-1' });
  });

  it("waits for a reloading page's lock to go before calling this a copy", async () => {
    const locks = fakeLocks(['strudel-tab:tab-1']);
    const { tabId } = await claimTab(
      memory('tab-1'),
      locks as never,
      async () => void locks.held.delete('strudel-tab:tab-1'),
    );
    expect(tabId).toBe('tab-1');
  });

  it('a duplicated tab, whose id a live page holds, takes a fresh one and stores it', async () => {
    const storage = memory('tab-1');
    const { tabId } = await claimTab(storage, fakeLocks(['strudel-tab:tab-1']) as never, noWait);
    expect(tabId).not.toBe('tab-1');
    expect(storage.getItem()).toBe(tabId);
  });

  it('without the Locks API keeps the stored id', async () => {
    await expect(claimTab(memory('tab-1'), null, noWait)).resolves.toMatchObject({ tabId: 'tab-1' });
  });

  it('releasing lets the id go', async () => {
    const locks = {
      ...fakeLocks(),
      request: vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) =>
        callback({}),
      ),
    };
    const { release } = await claimTab(memory('tab-1'), locks as never, noWait);
    expect(release).toBeTypeOf('function');
    release();
  });
});

describe('isTabAlive', () => {
  it('is true while its lock is held', async () => {
    await expect(isTabAlive('tab-1', fakeLocks(['strudel-tab:tab-1']) as never)).resolves.toBe(true);
    await expect(isTabAlive('tab-2', fakeLocks(['strudel-tab:tab-1']) as never)).resolves.toBe(false);
  });

  it('is false without the Locks API, or when asking fails', async () => {
    await expect(isTabAlive('tab-1', null)).resolves.toBe(false);
    const broken = { query: async () => Promise.reject(new Error('no')), request: vi.fn() };
    await expect(isTabAlive('tab-1', broken as never)).resolves.toBe(false);
  });
});
