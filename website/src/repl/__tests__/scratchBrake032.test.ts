/**
 * @spec: 032-master-fx (§2.5 Brake; tech §2.4)
 * The Master FX Brake goes through the scratch runtime: it grabs the speakers deck with the source
 * 'brake' whichever deck is selected, is refused while another source holds that deck (or it isn't
 * playing), lets go only of its own hold, and the headphones' platter is not shown as held by it.
 *
 * Real ScratchController; stand-in decks (no Web Audio).
 */
import { describe, expect, it, vi } from 'vitest';

// settings.ts imports util, which imports every Strudel package (tidal needs a build).
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { ScratchController } from '@strudel/mixer';
import {
  createScratchRuntime,
  type PreviewEngineLike,
  type ScratchDeckLike,
  type ScratchRuntimeDeps,
} from '../scratch/scratchRuntime';

class FakeDeck implements ScratchDeckLike {
  isAttached = false;
  isGrabbed = false;
  calls: string[] = [];
  private listeners = new Set<() => void>();
  attach() {
    this.isAttached = true;
    this.emit();
    return Promise.resolve(true);
  }
  grab() {
    if (!this.isAttached) return false;
    if (this.isGrabbed) return true;
    this.calls.push('grab');
    this.isGrabbed = true;
    this.emit();
    return true;
  }
  moveBy() {}
  setMotor() {}
  release() {
    if (!this.isGrabbed) return;
    this.calls.push('release');
    this.isGrabbed = false;
    this.emit();
  }
  destroy() {
    this.release();
    this.isAttached = false;
    this.emit();
  }
  on(_event: 'change', fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of [...this.listeners]) fn();
  }
}

async function setup(options: { busy?: () => boolean } = {}) {
  const main = new FakeDeck();
  const preview = new FakeDeck();
  const deps: ScratchRuntimeDeps = {
    createController: () => new ScratchController() as unknown as ReturnType<ScratchRuntimeDeps['createController']>,
    createDeck: () => main as unknown as ReturnType<ScratchRuntimeDeps['createDeck']>,
    loadMidiJog: vi.fn(async () => {
      throw new Error('not used');
    }),
    readSelected: () => 'main',
    writeSelected: () => {},
    midiSupported: () => false,
    hasStoredMidiMapping: () => false,
    eventTarget: new EventTarget(),
  };
  const runtime = createScratchRuntime(deps);
  if (options.busy) runtime.setMainRepl({ scheduler: { started: true } }, { isBusy: options.busy });
  await runtime.attachMain({} as AudioContext, {});
  const engine: PreviewEngineLike = {
    ensureScratchDeck: async () => {
      await preview.attach();
      return preview;
    },
  };
  runtime.attachPreview(engine);
  runtime.setPlaying('main', true);
  return { runtime, main, preview };
}

async function selectHeadphones(ctx: Awaited<ReturnType<typeof setup>>) {
  ctx.runtime.setPlaying('preview', true);
  await ctx.runtime.ensurePreviewDeck();
  ctx.runtime.select('preview');
  expect(ctx.runtime.store.get().selected).toBe('preview');
}

describe('scratchRuntime.brake (spec 032 §2.5)', () => {
  it('speakers selected: down grabs the speakers deck, up lets go (the usual spin-up path)', async () => {
    const { runtime, main } = await setup();
    expect(runtime.brake(true)).toBe(true);
    expect(main.isGrabbed).toBe(true);
    expect(runtime.store.get().braking).toBe(true);
    runtime.brake(false);
    expect(main.isGrabbed).toBe(false);
    expect(main.calls).toEqual(['grab', 'release']);
    expect(runtime.store.get().braking).toBe(false);
  });

  it('headphones selected: the speakers brake, the headphones do not, and their platter is not shown held', async () => {
    const ctx = await setup();
    await selectHeadphones(ctx);
    expect(ctx.runtime.brake(true)).toBe(true);
    expect(ctx.main.isGrabbed).toBe(true);
    expect(ctx.preview.isGrabbed).toBe(false);
    expect(ctx.runtime.store.get().grabbed).toBe(false);
    expect(ctx.runtime.store.get().braking).toBe(true);
    ctx.runtime.brake(false);
    expect(ctx.main.isGrabbed).toBe(false);
    expect(ctx.preview.calls).toEqual([]);
  });

  it('refused while the platter holds the speakers deck: nothing changes, and up does not let the platter go', async () => {
    const { runtime, main } = await setup();
    expect(runtime.grab('pointer')).toBe(true);
    expect(runtime.brake(true)).toBe(false);
    expect(runtime.store.get().braking).toBe(false);
    runtime.brake(false);
    expect(main.isGrabbed).toBe(true);
    expect(main.calls).toEqual(['grab']);
  });

  it('a platter grabbed during the brake keeps the record held when the Brake is let go', async () => {
    const { runtime, main } = await setup();
    runtime.brake(true);
    runtime.grab('pointer');
    runtime.brake(false);
    expect(main.isGrabbed).toBe(true);
    runtime.release('pointer');
    expect(main.isGrabbed).toBe(false);
  });

  it('refused while the speakers are stopped or a track switch is under way', async () => {
    const stopped = await setup();
    stopped.runtime.setPlaying('main', false);
    expect(stopped.runtime.brake(true)).toBe(false);
    expect(stopped.main.isGrabbed).toBe(false);

    const busy = await setup({ busy: () => true });
    expect(busy.runtime.brake(true)).toBe(false);
    expect(busy.main.isGrabbed).toBe(false);
  });

  it('Stop (releaseAll) ends the brake and clears its state', async () => {
    const ctx = await setup();
    await selectHeadphones(ctx);
    ctx.runtime.brake(true);
    ctx.runtime.releaseAll();
    expect(ctx.main.isGrabbed).toBe(false);
    expect(ctx.runtime.store.get().braking).toBe(false);
  });
});
