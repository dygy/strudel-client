/**
 * @spec: 022-set-playlist (2.3 Cue / Go / Update while cued / editing while cued, 2.4; tech §2.4)
 * The set bridge: Cue plays on the headphones only; Go stops the preview (letting go of its scratch
 * platter) and runs a forced switch with the item's transition; it resolves 'switched' as soon as
 * the code plays, 'failed' when it didn't evaluate; Ctrl+Enter while cued goes to the preview; Update
 * while cued is Go; the preview's own stop button fires the cancel event.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSetBridge, type SetBridgeDeps } from '../setBridge';

function setup(over: Partial<SetBridgeDeps> = {}) {
  let previewing = false;
  const engine = { isInitialized: true, evaluate: vi.fn(async () => ({})), stop: vi.fn() };
  const mainEvaluate = vi.fn(async () => undefined);
  const editor = { code: 's("bd")', evaluate: mainEvaluate as (...args: unknown[]) => unknown };
  const runSwitch = vi.fn(async () => ({ outcome: 'switch' as const, result: 'ok' as const }));
  const scratch = { beforeEvaluate: vi.fn(), previewStopping: vi.fn() };
  const openTrack = vi.fn(async () => {});
  const openStep = vi.fn(async () => {});
  const deps: SetBridgeDeps = {
    previewEngine: () => engine,
    isPreviewing: () => previewing,
    setPreviewing: (value) => {
      previewing = value;
    },
    isPlaying: () => true,
    editor: () => editor,
    runSwitch,
    scratch,
    canOpen: () => true,
    openTrack,
    openStep,
    ...over,
  };
  return {
    bridge: createSetBridge(deps),
    engine,
    editor,
    mainEvaluate,
    runSwitch,
    scratch,
    openTrack,
    openStep,
    previewing: () => previewing,
  };
}

describe('openItem', () => {
  it('opens a track or a step through the library', async () => {
    const t = setup();
    expect(await t.bridge.openItem({ id: 't1' })).toBe('opened');
    expect(t.openTrack).toHaveBeenCalledWith({ id: 't1' });
    expect(await t.bridge.openItem({ id: 'm1' }, 2)).toBe('opened');
    expect(t.openStep).toHaveBeenCalledWith({ trackId: 'm1', stepIndex: 2 });
  });

  it("says why it couldn't: no mounted library (zen mode), or opening threw", async () => {
    expect(await setup({ canOpen: () => false }).bridge.openItem({ id: 't1' })).toBe('no-library');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup({ openTrack: vi.fn(async () => Promise.reject(new Error('save failed'))) });
    expect(await t.bridge.openItem({ id: 't1' })).toBe('failed');
    warn.mockRestore();
  });
});

describe('cue', () => {
  it('plays the editor code on the headphones and never touches the speakers', async () => {
    const t = setup();
    expect(await t.bridge.cue()).toBe('playing');
    expect(t.engine.evaluate).toHaveBeenCalledWith('s("bd")');
    expect(t.previewing()).toBe(true);
    expect(t.mainEvaluate).not.toHaveBeenCalled();
    expect(t.runSwitch).not.toHaveBeenCalled();
  });

  it("is 'no-preview' when the preview engine is missing or not ready", async () => {
    expect(await setup({ previewEngine: () => null }).bridge.cue()).toBe('no-preview');
    const notReady = { isInitialized: false, evaluate: vi.fn(), stop: vi.fn() };
    expect(await setup({ previewEngine: () => notReady }).bridge.cue()).toBe('no-preview');
  });
});

// Review 022 #2: a Go for the same switch that is already in flight changed nothing on the speakers,
// yet the headphones had been stopped. It must leave the cue alone.
describe('go while the same switch is in flight', () => {
  it("is 'ignored' up front: no switch, headphones and Ctrl+Enter redirect untouched", async () => {
    const t = setup({ goWouldBeIgnored: () => true });
    await t.bridge.cue();
    t.bridge.redirectEditorToPreview();
    expect(await t.bridge.go(null)).toBe('ignored');
    expect(t.runSwitch).not.toHaveBeenCalled();
    expect(t.engine.stop).not.toHaveBeenCalled();
    expect(t.previewing()).toBe(true);
    expect(t.bridge.isRedirected()).toBe(true);
  });

  it('ignored by the switch itself after all: the cue is put back on the headphones', async () => {
    const t = setup({ runSwitch: vi.fn(async () => ({ outcome: 'ignored' as const, result: 'ok' as const })) });
    await t.bridge.cue();
    expect(await t.bridge.go(null)).toBe('ignored');
    expect(t.engine.evaluate).toHaveBeenLastCalledWith('s("bd")');
    expect(t.previewing()).toBe(true);
  });
});

describe('go', () => {
  it('stops the preview, lets go of its platter, and runs a forced switch with the item transition', async () => {
    const t = setup();
    await t.bridge.cue();
    expect(await t.bridge.go({ type: 'cut', length: 1 })).toBe('switched');
    expect(t.scratch.previewStopping).toHaveBeenCalledWith(t.engine);
    expect(t.engine.stop).toHaveBeenCalled();
    expect(t.previewing()).toBe(false);
    expect(t.runSwitch).toHaveBeenCalledWith({ force: true, transition: { type: 'cut', length: 1 } });
  });

  it("is 'failed' when the new code didn't evaluate", async () => {
    const t = setup({ runSwitch: vi.fn(async () => ({ outcome: 'switch' as const, result: 'failed' as const })) });
    expect(await t.bridge.go(null)).toBe('failed');
  });

  it("is 'failed' when the switch threw", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await setup({ runSwitch: vi.fn(async () => Promise.reject(new Error('x'))) }).bridge.go(null)).toBe(
      'failed',
    );
    error.mockRestore();
  });

  it("resolves 'switched' as soon as the code plays, not when a long transition ends", async () => {
    let finish: (() => void) | null = null;
    const t = setup({
      runSwitch: vi.fn(
        () =>
          new Promise<{ outcome: 'switch'; result: 'ok' }>(
            (resolve) => (finish = () => resolve({ outcome: 'switch', result: 'ok' })),
          ),
      ),
    });
    const going = t.bridge.go({ type: 'crossfade', length: 16 });
    t.bridge.evaluated('something else');
    t.bridge.evaluated('s("bd")');
    expect(await going).toBe('switched');
    finish!();
  });
});

describe('while cued', () => {
  it("the editor's evaluate (Ctrl+Enter) plays on the headphones until the redirect is removed", async () => {
    const t = setup();
    const remove = t.bridge.redirectEditorToPreview();
    t.editor.code = 's("hh")';
    await t.editor.evaluate();
    expect(t.engine.evaluate).toHaveBeenCalledWith('s("hh")');
    expect(t.mainEvaluate).not.toHaveBeenCalled();
    remove();
    await t.editor.evaluate();
    expect(t.mainEvaluate).toHaveBeenCalledTimes(1);
    expect(t.editor.evaluate).toBe(t.mainEvaluate);
  });

  it('go removes the redirect first', async () => {
    const t = setup();
    t.bridge.redirectEditorToPreview();
    await t.bridge.go(null);
    expect(t.bridge.isRedirected()).toBe(false);
    expect(t.editor.evaluate).toBe(t.mainEvaluate);
  });

  it('a wrapper added on top is kept when the redirect is removed; ours then passes through', async () => {
    const t = setup();
    const remove = t.bridge.redirectEditorToPreview();
    const ours = t.editor.evaluate;
    const outer = vi.fn((...args: unknown[]) => ours(...args));
    t.editor.evaluate = outer;
    remove();
    expect(t.editor.evaluate).toBe(outer);
    await t.editor.evaluate();
    expect(t.mainEvaluate).toHaveBeenCalledTimes(1);
  });

  it('Play (evaluateOnSpeakers) still reaches the speakers', async () => {
    const t = setup();
    t.bridge.redirectEditorToPreview();
    await t.bridge.evaluateOnSpeakers();
    expect(t.mainEvaluate).toHaveBeenCalledTimes(1);
  });

  it('Update is the set Go only while the player says it is cued', () => {
    const t = setup();
    expect(t.bridge.routeUpdate()).toBe(false);
    const go = vi.fn(async () => {});
    let cued = false;
    t.bridge.setGoHandler({ isCued: () => cued, go });
    expect(t.bridge.routeUpdate()).toBe(false);
    cued = true;
    expect(t.bridge.routeUpdate()).toBe(true);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("the preview's own stop button fires the cancel event; the set's stopPreview doesn't", async () => {
    const t = setup();
    const cancelled = vi.fn();
    const off = t.bridge.onPreviewStopped(cancelled);
    await t.bridge.cue();
    t.bridge.stopPreview();
    expect(cancelled).not.toHaveBeenCalled();
    t.bridge.previewStoppedByUser();
    expect(cancelled).toHaveBeenCalledTimes(1);
    off();
    t.bridge.previewStoppedByUser();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
