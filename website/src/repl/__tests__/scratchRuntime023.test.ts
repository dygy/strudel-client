/**
 * @spec: 023-vinyl-scratch-realism (2.3, 2.4, 2.5; tech §2.2–2.3, §3)
 * The website's scratch runtime for spec 023: the speakers' offset composed with spec 017's hook
 * in the main repl's editPattern, the hand-over wired to the speakers deck, the offset reset on
 * stop, grabs refused (platter dimmed) while a track switch is busy, and Snap to beat stored in
 * `strudel-scratch-snap` (default on) and applied to both decks.
 *
 * Real ScratchController and PatternOffset; stand-in decks (no Web Audio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// settings.ts imports util, which imports every Strudel package (tidal needs a build).
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import * as core from '@strudel/core';
import { PatternOffset, ScratchController } from '@strudel/mixer';
import {
  createScratchRuntime,
  isScratchActive,
  readScratchSnap,
  writeScratchSnap,
  SCRATCH_SNAP_STORAGE_KEY,
  type MainReplLike,
  type ScratchDeckLike,
  type ScratchRuntimeDeps,
} from '../scratch/scratchRuntime';
import { createScratchReplHooks } from '../scratch/scratchReplHooks';

// Not in the website's @strudel/core type stub.
const sequence = (core as unknown as { sequence: (...values: unknown[]) => any }).sequence;

class FakeDeck implements ScratchDeckLike {
  isAttached = false;
  isGrabbed = false;
  snap: boolean | undefined = undefined;
  calls: string[] = [];
  private listeners = new Set<() => void>();
  attach() {
    this.isAttached = true;
    this.emit();
    return Promise.resolve(true);
  }
  grab() {
    if (!this.isAttached) return false;
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
  abort() {
    this.calls.push('abort');
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

function setup(overrides: Partial<ScratchRuntimeDeps> = {}) {
  const decks: FakeDeck[] = [];
  const handOvers: Array<{ deck: unknown; options: Record<string, unknown>; destroyed: boolean }> = [];
  const snaps: boolean[] = [];
  const events = new EventTarget();
  const deps: ScratchRuntimeDeps = {
    createController: () => new ScratchController(),
    createDeck: () => {
      const deck = new FakeDeck();
      decks.push(deck);
      return deck as unknown as ReturnType<ScratchRuntimeDeps['createDeck']>;
    },
    loadMidiJog: vi.fn(async () => {
      throw new Error('not used');
    }),
    readSelected: () => 'main',
    writeSelected: () => {},
    midiSupported: () => false,
    hasStoredMidiMapping: () => false,
    readSnap: () => true,
    writeSnap: (snap) => snaps.push(snap),
    createPatternOffset: (options) => new PatternOffset(options),
    createHandOver: (deck, options) => {
      const entry = { deck, options: options as unknown as Record<string, unknown>, destroyed: false };
      handOvers.push(entry);
      return { destroy: () => (entry.destroyed = true) };
    },
    eventTarget: events,
    ...overrides,
  };
  return { runtime: createScratchRuntime(deps), decks, handOvers, snaps, events };
}

/** A repl like core's: setPattern → editPattern → scheduler.pattern. */
function mainRepl(runtime: ReturnType<typeof setup>['runtime'], inner?: (p: any) => any) {
  const r: MainReplLike & { scheduler: { cps: number; started: boolean; pattern: any } } = {
    scheduler: { cps: 0.5, started: true, pattern: null },
    setPattern(pattern: any) {
      r.scheduler.pattern = runtime.editMainPattern(pattern, inner);
      return Promise.resolve(r.scheduler.pattern);
    },
  };
  return r;
}

const onsets = (pat: any): number[] =>
  pat
    .queryArc(0, 2)
    .filter((h: any) => h.hasOnset())
    .map((h: any) => h.whole.begin.valueOf());

describe('speakers: the offset in the main repl editPattern', () => {
  it('passes the pattern through untouched until a scratch, composing with the 017 hook', () => {
    const { runtime } = setup();
    const kick = sequence('bd', 'sd');
    expect(runtime.editMainPattern(kick)).toBe(kick);
    const shifted = kick.late(2);
    expect(runtime.editMainPattern(kick, () => shifted)).toBe(shifted);
  });

  it('the hand-over is created for the speakers deck with the main repl, the offset and the switch check', async () => {
    let busy = false;
    const { runtime, handOvers, decks } = setup();
    const repl = mainRepl(runtime);
    runtime.setMainRepl(repl, { isBusy: () => busy });
    await runtime.attachMain({} as AudioContext, {});
    expect(handOvers).toHaveLength(1);
    expect(handOvers[0].deck).toBe(decks[0]);
    const { getRepl, offset, isBlocked } = handOvers[0].options as {
      getRepl: () => unknown;
      offset: PatternOffset;
      isBlocked: () => boolean;
    };
    expect(getRepl()).toBe(repl);
    expect(isBlocked()).toBe(false);
    busy = true;
    expect(isBlocked()).toBe(true);
    busy = false;
    // The offset it shifts is the one editMainPattern applies.
    const kick = sequence('bd', 'sd');
    repl.setPattern(kick);
    expect(offset.shift(0.5)).toBe(true);
    expect(onsets(repl.scheduler.pattern)).toEqual(onsets(kick.late(0.5)));
    runtime.detachMain();
    expect(handOvers[0].destroyed).toBe(true);
  });

  it('a same-track Update keeps the shift; stop (onToggle false) resets it and aborts a spin-up', async () => {
    const { runtime, handOvers, decks } = setup();
    const repl = mainRepl(runtime);
    runtime.setMainRepl(repl);
    await runtime.attachMain({} as AudioContext, {});
    const offset = handOvers[0].options.offset as PatternOffset;
    const kick = sequence('bd', 'sd');
    repl.setPattern(kick);
    offset.shift(0.25);
    repl.setPattern(kick); // Update: hot-swap
    expect(onsets(repl.scheduler.pattern)).toEqual(onsets(kick.late(0.25)));
    // The main repl's options (scratchReplHooks) on stop:
    const hooks = createScratchReplHooks(runtime);
    hooks.replOptions({ onToggle: (_playing: boolean) => {} }).onToggle!(false);
    expect(offset.cycles).toBe(0);
    expect(decks[0].calls).toContain('abort');
    expect(runtime.editMainPattern(kick)).toBe(kick);
  });

  it('negative pair: a start (onToggle true) keeps the offset', async () => {
    const { runtime, handOvers } = setup();
    const repl = mainRepl(runtime);
    runtime.setMainRepl(repl);
    await runtime.attachMain({} as AudioContext, {});
    const offset = handOvers[0].options.offset as PatternOffset;
    repl.setPattern(sequence('bd'));
    offset.shift(0.25);
    createScratchReplHooks(runtime).replOptions({ onToggle: (_playing: boolean) => {} }).onToggle!(true);
    expect(offset.cycles).toBe(0.25);
  });
});

describe('rule 2.3: no grab while a spec 017 track switch is busy', () => {
  it('refuses the grab on the speakers and dims the platter; allowed again when the switch ends', async () => {
    let busy = false;
    const { runtime, decks, events } = setup();
    runtime.setMainRepl(mainRepl(runtime), { isBusy: () => busy });
    await runtime.attachMain({} as AudioContext, {});
    runtime.setPlaying('main', true);
    busy = true;
    events.dispatchEvent(new Event('track-transition-waiting'));
    expect(runtime.store.get().blocked.main).toBe(true);
    expect(isScratchActive(runtime.store.get())).toBe(false);
    expect(runtime.grab('pointer')).toBe(false);
    expect(decks[0].calls).not.toContain('grab');
    busy = false;
    events.dispatchEvent(new Event('track-transition-end'));
    expect(runtime.store.get().blocked.main).toBe(false);
    expect(runtime.grab('pointer')).toBe(true);
  });

  it('the grab checks synchronously, even before any transition event (the switch is evaluating)', async () => {
    let busy = false;
    const { runtime, decks } = setup();
    runtime.setMainRepl(mainRepl(runtime), { isBusy: () => busy });
    await runtime.attachMain({} as AudioContext, {});
    runtime.setPlaying('main', true);
    busy = true;
    expect(runtime.grab('key')).toBe(false);
    expect(decks[0].calls).toEqual([]);
  });

  it('a switch starting while the record is held lets go of it', async () => {
    let busy = false;
    const { runtime, decks, events } = setup();
    runtime.setMainRepl(mainRepl(runtime), { isBusy: () => busy });
    await runtime.attachMain({} as AudioContext, {});
    runtime.setPlaying('main', true);
    runtime.grab('pointer');
    busy = true;
    events.dispatchEvent(new Event('track-transition-start'));
    expect(decks[0].calls).toEqual(['grab', 'release']);
  });

  it('negative pair: the headphone deck is not blocked by a switch on the speakers', async () => {
    let busy = true;
    const { runtime } = setup({ readSelected: () => 'preview' });
    runtime.setMainRepl(mainRepl(runtime), { isBusy: () => busy });
    const preview = new FakeDeck();
    runtime.attachPreview({
      ensureScratchDeck: async () => {
        await preview.attach();
        return preview;
      },
    });
    runtime.setPlaying('preview', true);
    await runtime.ensurePreviewDeck();
    expect(runtime.store.get().selected).toBe('preview');
    expect(runtime.grab('pointer')).toBe(true);
    expect(preview.calls).toEqual(['grab']);
    busy = false;
  });
});

describe('Snap to beat (2.4)', () => {
  it('applies the stored setting to each deck as it attaches, and setSnap updates both and stores it', async () => {
    const { runtime, decks, snaps } = setup({ readSnap: () => false });
    expect(runtime.store.get().snap).toBe(false);
    await runtime.attachMain({} as AudioContext, {});
    expect(decks[0].snap).toBe(false);
    const preview = new FakeDeck();
    runtime.attachPreview({
      ensureScratchDeck: async () => {
        await preview.attach();
        return preview;
      },
    });
    runtime.setPlaying('preview', true);
    await runtime.ensurePreviewDeck();
    expect(preview.snap).toBe(false);
    runtime.setSnap(true);
    expect(snaps).toEqual([true]);
    expect(decks[0].snap).toBe(true);
    expect(preview.snap).toBe(true);
    expect(runtime.store.get().snap).toBe(true);
  });
});

describe('Snap to beat storage: strudel-scratch-snap', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to on, and round-trips off and on as strings', () => {
    expect(SCRATCH_SNAP_STORAGE_KEY).toBe('strudel-scratch-snap');
    expect(readScratchSnap()).toBe(true);
    writeScratchSnap(false);
    expect(store.get('strudel-scratch-snap')).toBe('false');
    expect(readScratchSnap()).toBe(false);
    writeScratchSnap(true);
    expect(readScratchSnap()).toBe(true);
  });

  it('negative pair: junk in storage counts as on; a storage that throws counts as on', () => {
    store.set('strudel-scratch-snap', 'banana');
    expect(readScratchSnap()).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readScratchSnap()).toBe(true);
    expect(() => writeScratchSnap(false)).not.toThrow();
    warn.mockRestore();
  });
});
