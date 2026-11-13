// @vitest-environment jsdom
/**
 * @spec: 022-set-playlist (2.2 "Add to set", 2.3 the next key and "After a reload", 2.6 who sees sets; tech §2.3)
 * The hook that ReplEditor mounts, against a fake set bridge and a stubbed sets API (no Supabase):
 * - "Add to set" goes to the end of the open set (the same track twice = two items; a step keeps
 *   its index and name), or opens the chooser when no set is open;
 * - signed out or in the read-only view nothing is loaded, "Add to set" does nothing and
 *   Alt+Shift+N does nothing;
 * - after a reload the set that was playing reopens at the same place, and nothing plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { useSetPlayer, type SetPlayerContextValue, type UseSetPlayerOptions } from '../useSetPlayer';
import { setsApi } from '../setsApi';
import { SET_POSITION_KEY } from '../setPosition';
import type { SetBridge } from '../setBridge';
import type { SetList } from '../../../lib/setLists';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETS: SetList[] = [
  {
    id: 's1',
    name: 'Friday',
    version: 'v1',
    items: [
      { id: 'a', trackId: 't1', transition: null },
      { id: 'b', trackId: 't2', transition: null },
      { id: 'c', trackId: 't1', transition: null },
    ],
  },
];
const TRACKS = {
  t1: { id: 't1', name: 'One' },
  t2: { id: 't2', name: 'Two' },
  m1: {
    id: 'm1',
    name: 'Multi',
    isMultitrack: true,
    steps: [
      { id: 'x1', name: 'Intro' },
      { id: 'x2', name: 'Drop' },
    ],
  },
};

function fakeBridge() {
  return {
    openItem: vi.fn(async () => true),
    cue: vi.fn(async () => true),
    go: vi.fn(async () => 'switched' as const),
    stopPreview: vi.fn(),
    redirectEditorToPreview: vi.fn(() => () => {}),
    removeRedirect: vi.fn(),
    onPreviewStopped: vi.fn(() => () => {}),
    setGoHandler: vi.fn(),
  };
}

let bridge: ReturnType<typeof fakeBridge>;
let latest: SetPlayerContextValue;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness(props: UseSetPlayerOptions) {
  latest = useSetPlayer(props);
  return null;
}

const options = (over: Partial<UseSetPlayerOptions> = {}): UseSetPlayerOptions => ({
  bridge: bridge as unknown as SetBridge,
  signedIn: true,
  readOnly: false,
  tracks: TRACKS,
  ...over,
});

async function mount(over: Partial<UseSetPlayerOptions> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness {...options(over)} />));
  await act(async () => {}); // the list request resolves
}
async function rerender(over: Partial<UseSetPlayerOptions>) {
  await act(async () => root!.render(<Harness {...options(over)} />));
}

const altShiftN = () => {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyN',
    key: '˜',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
};
const itemsOf = (id: string) => latest.sets.find((set) => set.id === id)!.items;

let list: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings']);
  bridge = fakeBridge();
  localStorage.removeItem(SET_POSITION_KEY);
  // A fresh copy each time: the store keeps (and edits) what the API answered.
  list = vi.spyOn(setsApi, 'list').mockImplementation(async () => structuredClone(SETS));
  vi.spyOn(setsApi, 'update').mockImplementation(async (id, changes) => ({
    ...structuredClone(SETS.find((set) => set.id === id)!),
    ...changes,
    version: 'v2',
  }));
  vi.spyOn(setsApi, 'create').mockRejectedValue(new Error('not used'));
  vi.spyOn(setsApi, 'remove').mockResolvedValue(undefined);
});

afterEach(async () => {
  // Signing out resets the store, which cancels any pending (debounced) save.
  if (root) await rerender({ signedIn: false });
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  localStorage.removeItem(SET_POSITION_KEY);
  vi.restoreAllMocks();
});

describe('"Add to set" from the library', () => {
  it('with a set open, the track goes to the end of it; twice = two separate items', async () => {
    await mount();
    act(() => latest.setOpenSetId('s1'));
    act(() => latest.requestAddToSet({ trackId: 't2' }));
    act(() => latest.requestAddToSet({ trackId: 't2' }));
    const items = itemsOf('s1');
    expect(items.map((item) => item.trackId)).toEqual(['t1', 't2', 't1', 't2', 't2']);
    expect(items[3].id).not.toBe(items[4].id);
    expect(items[4].transition).toBeNull();
    expect(latest.chooserTarget).toBeNull();
  });

  it('a multitrack step keeps its index, id and name (so the item shows "Multi · Drop")', async () => {
    await mount();
    act(() => latest.setOpenSetId('s1'));
    act(() => latest.requestAddToSet({ trackId: 'm1', stepIndex: 1 }));
    expect(itemsOf('s1').at(-1)).toMatchObject({ trackId: 'm1', stepIndex: 1, stepId: 'x2', stepName: 'Drop' });
  });

  it('negative: with no set open, it asks which set (the chooser) and adds nothing yet', async () => {
    await mount();
    act(() => latest.requestAddToSet({ trackId: 't2' }));
    expect(latest.chooserTarget).toEqual({ trackId: 't2' });
    expect(itemsOf('s1')).toHaveLength(3);
  });
});

describe('who sees sets', () => {
  it('signed in: the sets are loaded', async () => {
    await mount();
    expect(list).toHaveBeenCalledTimes(1);
    expect(latest.enabled).toBe(true);
    expect(latest.sets.map((set) => set.id)).toEqual(['s1']);
  });

  it.each([
    ['signed out', { signedIn: false }],
    ['the read-only admin view', { readOnly: true }],
  ])('negative, %s: nothing is loaded and "Add to set" does nothing', async (_name, over) => {
    await mount(over);
    expect(list).not.toHaveBeenCalled();
    expect(latest.enabled).toBe(false);
    act(() => latest.requestAddToSet({ trackId: 't2' }));
    expect(latest.chooserTarget).toBeNull();
    expect(latest.sets).toEqual([]);
  });

  it('Alt+Shift+N Cues while signed in with a set playing (no character reaches the page)', async () => {
    await mount();
    act(() => latest.playSet('s1'));
    let event!: KeyboardEvent;
    await act(async () => {
      event = altShiftN();
    });
    expect(event.defaultPrevented).toBe(true);
    expect(bridge.openItem).toHaveBeenCalledTimes(1);
    expect(bridge.openItem).toHaveBeenCalledWith(TRACKS.t1, undefined);
  });

  it('negative: once signed out, Alt+Shift+N does nothing', async () => {
    await mount();
    act(() => latest.playSet('s1'));
    await rerender({ signedIn: false });
    let event!: KeyboardEvent;
    await act(async () => {
      event = altShiftN();
    });
    expect(bridge.openItem).not.toHaveBeenCalled();
    expect(bridge.cue).not.toHaveBeenCalled();
    expect(bridge.go).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(latest.player.setId).toBeNull();
  });
});

describe('after a reload', () => {
  it('the set that was playing reopens with the same Now playing and Up next; nothing plays', async () => {
    localStorage.setItem(SET_POSITION_KEY, JSON.stringify({ setId: 's1', nowItemId: 'b', nextItemId: 'c' }));
    await mount();
    expect(latest.openSetId).toBe('s1');
    expect(latest.player).toMatchObject({ setId: 's1', nowItemId: 'b', nextItemId: 'c', cuedItemId: null });
    expect(latest.buttonMode).toBe('cue');
    expect(bridge.openItem).not.toHaveBeenCalled();
    expect(bridge.cue).not.toHaveBeenCalled();
    expect(bridge.go).not.toHaveBeenCalled();
  });

  it('negative: a saved position for a set that is gone is dropped, and no set plays', async () => {
    localStorage.setItem(SET_POSITION_KEY, JSON.stringify({ setId: 'deleted', nowItemId: 'b', nextItemId: 'c' }));
    await mount();
    expect(latest.player.setId).toBeNull();
    expect(latest.openSetId).toBeNull();
    expect(localStorage.getItem(SET_POSITION_KEY)).toBeNull();
  });
});
