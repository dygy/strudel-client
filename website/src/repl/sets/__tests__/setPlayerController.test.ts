/**
 * @spec: 022-set-playlist (2.3 Cue and Go, 2.5; tech §2.3, §3 risks)
 * The player against a fake bridge: Cue opens the item (the library's save-first path) then
 * previews it, never Go; Go passes the item's transition; a failed Go keeps the set cued; a double
 * press during a pending open is one Cue; selecting or stopping the preview cancels a cue; Missing
 * items are skipped with a toast.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSetPlayerController } from '../setPlayerController';
import type { PlayerSet } from '../setPlayer';
import type { SetItem } from '../../../lib/setLists';
import type { CueResult, GoResult, OpenResult } from '../setBridge';

const item = (id: string, trackId: string, over: Partial<SetItem> = {}): SetItem => ({
  id,
  trackId,
  transition: null,
  ...over,
});

function setup({
  goResult = 'switched' as GoResult,
  openDelay,
  openResult = 'opened' as OpenResult,
  cueResult = 'playing' as CueResult,
}: { goResult?: GoResult; openDelay?: Promise<void>; openResult?: OpenResult; cueResult?: CueResult } = {}) {
  let set: PlayerSet = {
    id: 's1',
    items: [
      item('a', 't1'),
      item('b', 't2', { transition: { type: 'cut', length: 1 } }),
      item('c', 'm1', { stepName: 'Drop', stepIndex: 1 }),
    ],
  };
  const tracks: Record<string, { id: string; name: string; isMultitrack?: boolean; steps?: { name: string }[] }> = {
    t1: { id: 't1', name: 'One' },
    t2: { id: 't2', name: 'Two' },
    m1: { id: 'm1', name: 'Multi', isMultitrack: true, steps: [{ name: 'Intro' }, { name: 'Drop' }] },
  };
  const calls: string[] = [];
  let previewStopped: (() => void) | null = null;
  let goHandler: { isCued: () => boolean; go: () => Promise<unknown> } | null = null;
  const removeRedirect = vi.fn(() => calls.push('unredirect'));
  const bridge = {
    openItem: vi.fn(async (track: { id: string }, stepIndex?: number) => {
      calls.push(`open:${track.id}${stepIndex === undefined ? '' : `#${stepIndex}`}`);
      if (openDelay) await openDelay;
      return openResult;
    }),
    cue: vi.fn(async () => {
      calls.push('cue');
      return cueResult;
    }),
    go: vi.fn(async (transition: unknown) => {
      calls.push(`go:${JSON.stringify(transition)}`);
      return goResult;
    }),
    stopPreview: vi.fn(() => calls.push('stopPreview')),
    redirectEditorToPreview: vi.fn(() => {
      calls.push('redirect');
      return removeRedirect;
    }),
    removeRedirect: vi.fn(),
    onPreviewStopped: vi.fn((listener: () => void) => {
      previewStopped = listener;
      return () => (previewStopped = null);
    }),
    setGoHandler: vi.fn((handler: typeof goHandler) => (goHandler = handler)),
  };
  const skipped = vi.fn();
  const cueFailed = vi.fn();
  const goIgnored = vi.fn();
  const positions: unknown[] = [];
  const controller = createSetPlayerController({
    bridge: bridge as never,
    getSet: (id) => (id === set.id ? set : null),
    getTracks: () => tracks,
    onSkippedMissing: skipped,
    onCueFailed: cueFailed,
    onGoIgnored: goIgnored,
    writePosition: (p) => positions.push(p),
  });
  return {
    controller,
    bridge,
    calls,
    skipped,
    cueFailed,
    goIgnored,
    positions,
    tracks,
    stopPreviewButton: () => previewStopped?.(),
    update: () => goHandler,
    setItems: (items: SetItem[]) => {
      set = { ...set, items };
    },
  };
}

describe('Cue then Go', () => {
  it('Cue opens the item and previews it; nothing goes to the speakers', async () => {
    const t = setup();
    t.controller.start('s1');
    await t.controller.press();
    expect(t.calls).toEqual(['open:t1', 'cue', 'redirect']);
    expect(t.bridge.go).not.toHaveBeenCalled();
    expect(t.controller.getState()).toMatchObject({ phase: 'cued', cuedItemId: 'a' });
  });

  it("Go mixes with the item's transition and advances", async () => {
    const t = setup();
    t.controller.start('s1', 'b');
    await t.controller.press();
    await t.controller.press();
    expect(t.bridge.go).toHaveBeenCalledWith({ type: 'cut', length: 1 });
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', nowItemId: 'b', nextItemId: 'c' });
    expect(t.positions.at(-1)).toEqual({ setId: 's1', nowItemId: 'b', nextItemId: 'c' });
  });

  it('a step item opens the multitrack on that step', async () => {
    const t = setup();
    t.controller.start('s1', 'c');
    await t.controller.press();
    expect(t.calls[0]).toBe('open:m1#1');
  });

  it('a failed Go does not advance and stays cued (Ctrl+Enter back on the headphones)', async () => {
    const t = setup({ goResult: 'failed' });
    t.controller.start('s1');
    await t.controller.press();
    t.calls.length = 0;
    await t.controller.press();
    expect(t.controller.getState()).toMatchObject({ phase: 'cued', nowItemId: null, cuedItemId: 'a' });
    expect(t.calls).toEqual(['unredirect', 'go:null', 'redirect']);
  });

  it('a second press while the item is still opening is ignored (one Cue)', async () => {
    let release!: () => void;
    const openDelay = new Promise<void>((resolve) => (release = resolve));
    const t = setup({ openDelay });
    t.controller.start('s1');
    const first = t.controller.press();
    await t.controller.press();
    release();
    await first;
    expect(t.bridge.openItem).toHaveBeenCalledTimes(1);
    expect(t.bridge.cue).toHaveBeenCalledTimes(1);
  });

  it('Update while cued is Go', async () => {
    const t = setup();
    t.controller.start('s1');
    expect(t.update()!.isCued()).toBe(false);
    await t.controller.press();
    expect(t.update()!.isCued()).toBe(true);
    await t.update()!.go();
    expect(t.bridge.go).toHaveBeenCalledTimes(1);
    expect(t.controller.getState().nowItemId).toBe('a');
  });
});

describe('cancelling', () => {
  it('stopping the preview with its button cancels the cue and keeps Up next', async () => {
    const t = setup();
    t.controller.start('s1');
    await t.controller.press();
    t.stopPreviewButton();
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', nextItemId: 'a', cuedItemId: null });
  });

  it('selecting another item while cued stops the headphones and makes it Up next', async () => {
    const t = setup();
    t.controller.start('s1');
    await t.controller.press();
    t.controller.select('c');
    expect(t.bridge.stopPreview).toHaveBeenCalled();
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', nextItemId: 'c' });
  });

  it('a select while the item is still opening means the headphones never start for it', async () => {
    let release!: () => void;
    const t = setup({ openDelay: new Promise<void>((resolve) => (release = resolve)) });
    t.controller.start('s1');
    const pressing = t.controller.press();
    t.controller.select('c');
    release();
    await pressing;
    expect(t.bridge.cue).not.toHaveBeenCalled();
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', nextItemId: 'c' });
  });

  it('End set hides the set; the music is not touched', async () => {
    const t = setup();
    t.controller.start('s1');
    await t.controller.press();
    t.controller.end();
    expect(t.controller.getState().setId).toBeNull();
    expect(t.bridge.go).not.toHaveBeenCalled();
    expect(t.positions.at(-1)).toBeNull();
  });
});

describe('missing items', () => {
  it('skips a deleted track with a toast and cues the next playable one', async () => {
    const t = setup();
    delete t.tracks.t1;
    t.controller.start('s1');
    await t.controller.press();
    expect(t.skipped).toHaveBeenCalledTimes(1);
    expect(t.calls[0]).toBe('open:t2');
  });

  it('removing the cued item from the set stops the headphones', async () => {
    const t = setup();
    t.controller.start('s1');
    await t.controller.press();
    t.setItems([item('b', 't2')]);
    t.controller.itemsChanged();
    expect(t.bridge.stopPreview).toHaveBeenCalled();
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', nextItemId: 'b' });
  });
});

// Review 022 #3: a Cue that couldn't land (zen mode: no library; the preview engine not ready) was
// silent. It now says why, and the next press tries again.
describe('a Cue that does not land', () => {
  it.each([
    ['no library (zen mode)', { openResult: 'no-library' as const }, 'no-library'],
    ['no headphone preview', { cueResult: 'no-preview' as const }, 'no-preview'],
    ['opening failed', { openResult: 'failed' as const }, 'failed'],
  ])('%s: tells the user why and goes back to Cue with Up next unchanged', async (_label, options, reason) => {
    const t = setup(options);
    t.controller.start('s1');
    await t.controller.press();
    expect(t.cueFailed).toHaveBeenCalledWith(reason);
    expect(t.controller.getState()).toMatchObject({ phase: 'idle', nextItemId: 'a', cuedItemId: null });
    // Pressing again retries.
    await t.controller.press();
    expect(t.bridge.openItem).toHaveBeenCalledTimes(2);
  });

  it('negative: a Cue that lands raises no failure toast', async () => {
    const t = setup();
    t.controller.start('s1');
    await t.controller.press();
    expect(t.cueFailed).not.toHaveBeenCalled();
  });
});

// Review 022 #2: an ignored Go (the same switch still running) must keep the cue and say so.
describe('a Go that is ignored', () => {
  it('stays cued with Ctrl+Enter on the headphones, tells the user, and the next press Goes again', async () => {
    const t = setup({ goResult: 'ignored' });
    t.controller.start('s1');
    await t.controller.press();
    await t.controller.press();
    expect(t.controller.getState()).toMatchObject({ phase: 'cued', cuedItemId: 'a', nowItemId: null });
    expect(t.goIgnored).toHaveBeenCalledTimes(1);
    expect(t.calls.at(-1)).toBe('redirect');
    await t.controller.press();
    expect(t.bridge.go).toHaveBeenCalledTimes(2);
  });
});

describe('dispose', () => {
  it('lets go of the bridge', () => {
    const t = setup();
    t.controller.dispose();
    expect(t.bridge.setGoHandler).toHaveBeenLastCalledWith(null);
  });
});
