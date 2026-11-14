/**
 * @spec: 025-scratch-feel-controls (functional-spec §2.1, §2.2, §2.3; tech §2.3, §4)
 *
 * The runtime keeps the snap grid and the feel in its store, stores them on this device
 * (`strudel-scratch-snap` now holds the grid, reading 023's 'true' / 'false'; the feel is JSON in
 * `strudel-scratch-feel`), and gives both to every deck: the speakers deck on attach, the lazily
 * created headphone deck when it appears, and both on every change.
 *
 * Real ScratchController; stand-in decks (no Web Audio).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// settings.ts imports util, which imports every Strudel package (tidal needs a build).
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { ScratchController } from '@strudel/mixer';
import {
  createScratchRuntime,
  readScratchFeel,
  readScratchSnap,
  readScratchSnapGrid,
  writeScratchFeel,
  writeScratchSnap,
  writeScratchSnapGrid,
  SCRATCH_FEEL_STORAGE_KEY,
  SCRATCH_SNAP_STORAGE_KEY,
  type ScratchDeckLike,
  type ScratchFeel,
  type ScratchRuntimeDeps,
  type ScratchSnapGrid,
} from '../scratch/scratchRuntime';

/** A deck like ScratchDeck: snapGrid and setFeel. */
class GridDeck implements ScratchDeckLike {
  isAttached = false;
  isGrabbed = false;
  snapGrid: ScratchSnapGrid | undefined = undefined;
  feels: ScratchFeel[] = [];
  private listeners = new Set<() => void>();
  attach() {
    this.isAttached = true;
    this.emit();
    return Promise.resolve(true);
  }
  grab() {
    this.isGrabbed = true;
    this.emit();
    return true;
  }
  moveBy() {}
  setMotor() {}
  release() {
    this.isGrabbed = false;
    this.emit();
  }
  setFeel(feel: ScratchFeel) {
    this.feels.push(feel);
  }
  destroy() {
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

/** A spec 023 deck: only the boolean snap. */
class BoolDeck extends GridDeck {
  snap: boolean | undefined = undefined;
  constructor() {
    super();
    delete (this as { snapGrid?: unknown }).snapGrid;
  }
}

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A runtime built like the website's singleton, with the real storage functions. */
function pageLoad(createDeck: () => ScratchDeckLike = () => new GridDeck()) {
  const decks: ScratchDeckLike[] = [];
  const deps: ScratchRuntimeDeps = {
    createController: () => new ScratchController(),
    createDeck: () => {
      const deck = createDeck();
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
    readSnapGrid: readScratchSnapGrid,
    writeSnapGrid: writeScratchSnapGrid,
    readFeel: readScratchFeel,
    writeFeel: writeScratchFeel,
    eventTarget: new EventTarget(),
  };
  return { runtime: createScratchRuntime(deps), decks: decks as GridDeck[] };
}

describe('snap storage: migration of strudel-scratch-snap (2.1)', () => {
  it.each([
    [null, 'beat'],
    ['true', 'beat'],
    ['false', 'off'],
    ['off', 'off'],
    ['half', 'half'],
    ['beat', 'beat'],
    ['bar', 'bar'],
    ['garbage', 'beat'],
    ['', 'beat'],
  ])('stored %s reads as %s', (stored, grid) => {
    if (stored !== null) storage.set(SCRATCH_SNAP_STORAGE_KEY, stored);
    expect(readScratchSnapGrid()).toBe(grid);
    expect(pageLoad().runtime.store.get().snapGrid).toBe(grid);
  });

  it('writes the grid name; the deprecated boolean reader and writer still agree', () => {
    writeScratchSnapGrid('bar');
    expect(storage.get(SCRATCH_SNAP_STORAGE_KEY)).toBe('bar');
    expect(readScratchSnap()).toBe(true);
    writeScratchSnapGrid('off');
    expect(readScratchSnap()).toBe(false);
    writeScratchSnap(true);
    expect(readScratchSnapGrid()).toBe('beat');
  });

  it('survives a reload: Bar chosen, the next page starts on Bar and gives it to its deck', async () => {
    pageLoad().runtime.setSnapGrid('bar');
    const reloaded = pageLoad();
    expect(reloaded.runtime.store.get().snapGrid).toBe('bar');
    expect(reloaded.runtime.store.get().snap).toBe(true);
    await reloaded.runtime.attachMain({} as AudioContext, {});
    expect(reloaded.decks[0].snapGrid).toBe('bar');
  });
});

describe('feel storage: strudel-scratch-feel (2.2, 2.3)', () => {
  it('defaults when nothing is stored', () => {
    expect(SCRATCH_FEEL_STORAGE_KEY).toBe('strudel-scratch-feel');
    expect(readScratchFeel()).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
  });

  it('round-trips as JSON', () => {
    writeScratchFeel({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(JSON.parse(storage.get(SCRATCH_FEEL_STORAGE_KEY)!)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(readScratchFeel()).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
  });

  it.each([
    ['not json', { brakeSeconds: 0.1, spinUpSeconds: 0.4 }],
    ['null', { brakeSeconds: 0.1, spinUpSeconds: 0.4 }],
    ['[1,2]', { brakeSeconds: 0.1, spinUpSeconds: 0.4 }],
    ['{"brakeSeconds":5,"spinUpSeconds":0.05}', { brakeSeconds: 0.1, spinUpSeconds: 0.4 }],
    ['{"brakeSeconds":"0.5","spinUpSeconds":1.2}', { brakeSeconds: 0.1, spinUpSeconds: 1.2 }],
    ['{"brakeSeconds":0.3}', { brakeSeconds: 0.3, spinUpSeconds: 0.4 }],
  ])('a damaged value %s falls back per field', (raw, feel) => {
    storage.set(SCRATCH_FEEL_STORAGE_KEY, raw);
    expect(readScratchFeel()).toEqual(feel);
  });

  it('survives a reload', () => {
    pageLoad().runtime.setFeel({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(pageLoad().runtime.store.get().feel).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
  });
});

describe('the runtime gives the grid and the feel to both decks (2.3)', () => {
  async function bothDecks() {
    const t = pageLoad();
    await t.runtime.attachMain({} as AudioContext, {});
    const preview = new GridDeck();
    t.runtime.attachPreview({
      ensureScratchDeck: async () => {
        await preview.attach();
        return preview;
      },
    });
    t.runtime.setPlaying('preview', true);
    await t.runtime.ensurePreviewDeck();
    return { ...t, main: t.decks[0], preview };
  }

  it('the stored settings reach the speakers deck on attach and the lazy headphone deck when it is created', async () => {
    storage.set(SCRATCH_SNAP_STORAGE_KEY, 'half');
    storage.set(SCRATCH_FEEL_STORAGE_KEY, JSON.stringify({ brakeSeconds: 0.5, spinUpSeconds: 1.5 }));
    const { main, preview } = await bothDecks();
    expect(main.snapGrid).toBe('half');
    expect(main.feels.at(-1)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(preview.snapGrid).toBe('half');
    expect(preview.feels.at(-1)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
  });

  it('a setting changed before the headphone deck exists reaches it when it is created', async () => {
    const t = pageLoad();
    t.runtime.setSnapGrid('bar');
    t.runtime.setFeel({ spinUpSeconds: 2 });
    const preview = new GridDeck();
    t.runtime.attachPreview({ ensureScratchDeck: async () => (await preview.attach(), preview) });
    t.runtime.setPlaying('preview', true);
    await t.runtime.ensurePreviewDeck();
    expect(preview.snapGrid).toBe('bar');
    expect(preview.feels.at(-1)).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 2 });
  });

  it('setSnapGrid, setFeel and resetFeel update both decks, the store and the storage', async () => {
    const { runtime, main, preview } = await bothDecks();
    runtime.setSnapGrid('bar');
    expect([main.snapGrid, preview.snapGrid]).toEqual(['bar', 'bar']);
    expect(runtime.store.get()).toMatchObject({ snapGrid: 'bar', snap: true });
    expect(storage.get(SCRATCH_SNAP_STORAGE_KEY)).toBe('bar');

    runtime.setFeel({ brakeSeconds: 0.5 });
    expect(main.feels.at(-1)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 0.4 });
    expect(preview.feels.at(-1)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 0.4 });
    runtime.setFeel({ spinUpSeconds: 1.5 });
    expect(runtime.store.get().feel).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(JSON.parse(storage.get(SCRATCH_FEEL_STORAGE_KEY)!)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });

    runtime.resetFeel();
    expect(runtime.store.get().feel).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    expect(main.feels.at(-1)).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    expect(preview.feels.at(-1)).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
  });

  it('out-of-range values fall back to the defaults', async () => {
    const { runtime, main } = await bothDecks();
    runtime.setFeel({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    runtime.setFeel({ brakeSeconds: 3, spinUpSeconds: NaN });
    expect(runtime.store.get().feel).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    expect(main.feels.at(-1)).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    runtime.setSnapGrid('weird' as ScratchSnapGrid);
    expect(runtime.store.get().snapGrid).toBe('beat');
  });

  it('negative pair: an unchanged feel is not re-stored or re-sent', async () => {
    const { runtime, main } = await bothDecks();
    const sent = main.feels.length;
    runtime.setFeel({ brakeSeconds: 0.1 });
    expect(main.feels.length).toBe(sent);
    expect(storage.has(SCRATCH_FEEL_STORAGE_KEY)).toBe(false);
  });

  it('the deprecated setSnap maps to the grid; a spec 023 deck (no snapGrid) gets the boolean', async () => {
    const t = pageLoad(() => new BoolDeck());
    await t.runtime.attachMain({} as AudioContext, {});
    const deck = t.decks[0] as unknown as BoolDeck;
    expect(deck.snap).toBe(true);
    t.runtime.setSnap(false);
    expect(t.runtime.store.get().snapGrid).toBe('off');
    expect(deck.snap).toBe(false);
    t.runtime.setSnapGrid('half');
    expect(deck.snap).toBe(true);
    expect('snapGrid' in deck).toBe(false);
  });
});

it("the website's runtime singleton stores the grid and the feel", () => {
  const source = readFileSync(resolve(__dirname, '../scratch/scratchRuntime.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const singleton = source.slice(source.indexOf('export const scratchRuntime'));
  expect(singleton).toMatch(/readFeel: readScratchFeel,/);
  expect(singleton).toMatch(/writeFeel: writeScratchFeel,/);
  expect(singleton).toMatch(/readSnapGrid: readScratchSnapGrid,/);
  expect(singleton).toMatch(/writeSnapGrid: writeScratchSnapGrid,/);
});
