/**
 * @spec: 023-vinyl-scratch-realism (functional-spec §2.3, §2.4; task 4.1)
 *
 * - 2.4 "When the user reloads the page, the Snap to beat setting is as they left it": a runtime
 *   writes the switch through `writeScratchSnap`, a fresh runtime (the reload) reads it through
 *   `readScratchSnap` and gives it to the deck it attaches; and the website's singleton is built
 *   with those two (checked in its source, like scratchReplWiring023.test.ts).
 * - 2.3 "Update with the same code keeps the shifted position": every hook an Update goes through
 *   (beforeUpdate, beforeEvaluate, the repl's beforeEval, a re-start) lets go of the platter but
 *   keeps the speakers' offset; only a stop resets it.
 *
 * Real ScratchController, PatternOffset and runtime; stand-in decks (no Web Audio).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// settings.ts imports util, which imports every Strudel package (tidal needs a build).
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import * as core from '@strudel/core';
import { PatternOffset, ScratchController } from '@strudel/mixer';
import {
  createScratchRuntime,
  readScratchSnap,
  writeScratchSnap,
  type MainReplLike,
  type ScratchDeckLike,
  type ScratchRuntimeDeps,
} from '../scratch/scratchRuntime';
import { createScratchReplHooks } from '../scratch/scratchReplHooks';

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

/** A runtime built like the website's singleton, with the real snap storage functions. */
function pageLoad() {
  const decks: FakeDeck[] = [];
  const offsets: PatternOffset[] = [];
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
    readSnap: readScratchSnap,
    writeSnap: writeScratchSnap,
    createPatternOffset: (options) => {
      const offset = new PatternOffset(options);
      offsets.push(offset);
      return offset;
    },
    createHandOver: () => ({ destroy: () => {} }),
    eventTarget: new EventTarget(),
  };
  return { runtime: createScratchRuntime(deps), decks, offsets };
}

describe('2.4 Snap to beat survives a reload', () => {
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

  it('turned off, then reloaded: the new page starts with it off and its deck releases without snap', async () => {
    const first = pageLoad();
    expect(first.runtime.store.get().snap).toBe(true); // a first visit: on by default
    first.runtime.setSnap(false);

    const reloaded = pageLoad();
    expect(reloaded.runtime.store.get().snap).toBe(false);
    await reloaded.runtime.attachMain({} as AudioContext, {});
    expect(reloaded.decks[0].snap).toBe(false);
  });

  it('negative pair: turned off and back on, then reloaded: it is on', async () => {
    const first = pageLoad();
    first.runtime.setSnap(false);
    first.runtime.setSnap(true);
    const reloaded = pageLoad();
    expect(reloaded.runtime.store.get().snap).toBe(true);
    await reloaded.runtime.attachMain({} as AudioContext, {});
    expect(reloaded.decks[0].snap).toBe(true);
  });

  it("the website's runtime singleton reads and writes the stored setting", () => {
    const source = readFileSync(resolve(__dirname, '../scratch/scratchRuntime.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const singleton = source.slice(source.indexOf('export const scratchRuntime'));
    // Spec 025: the singleton stores the snap grid (which still reads 023's 'true' / 'false').
    expect(singleton).toMatch(/readSnapGrid: readScratchSnapGrid,/);
    expect(singleton).toMatch(/writeSnapGrid: writeScratchSnapGrid,/);
  });
});

describe('2.3 a same-track Update keeps the shift; stop and start begin from the top', () => {
  function playingWithShift() {
    const { runtime, decks, offsets } = pageLoad();
    const repl: MainReplLike & { scheduler: { cps: number; started: boolean; pattern: any } } = {
      scheduler: { cps: 0.5, started: true, pattern: null },
      setPattern(pattern: any) {
        repl.scheduler.pattern = runtime.editMainPattern(pattern);
        return Promise.resolve(repl.scheduler.pattern);
      },
    };
    runtime.setMainRepl(repl, { isBusy: () => false });
    const hooks = createScratchReplHooks(runtime);
    const options = hooks.replOptions({ beforeEval: () => {}, onToggle: (_playing: boolean) => {} });
    const kick = sequence('bd', 'sd', 'hh', 'cp');
    repl.setPattern(kick);
    expect(offsets[0].shift(0.5)).toBe(true); // a settled 2-beat scratch
    return { runtime, decks, offset: offsets[0], repl, hooks, options, kick };
  }
  const firstValue = (pat: any) => pat.queryArc(0, 0.01).find((h: any) => h.hasOnset())?.value;

  it('Update (beforeUpdate, beforeEvaluate, beforeEval, the hot-swap evaluate) keeps the track 2 beats late', async () => {
    const t = playingWithShift();
    await t.runtime.attachMain({} as AudioContext, {});
    t.runtime.setPlaying('main', true);
    t.runtime.grab('pointer'); // a scratch in progress when Update is pressed
    t.hooks.beforeUpdate();
    t.hooks.beforeEvaluate();
    t.options.beforeEval!();
    t.repl.setPattern(t.kick); // same code
    expect(t.decks[0].calls).toEqual(['grab', 'release']); // let go first
    expect(t.offset.cycles).toBe(0.5);
    expect(firstValue(t.repl.scheduler.pattern)).toBe('hh'); // beat 3 now sounds at cycle 0
  });

  it('negative pair: stop resets the shift, so the next start begins at beat 1', () => {
    const t = playingWithShift();
    t.options.onToggle!(false);
    t.options.onToggle!(true);
    t.repl.setPattern(t.kick);
    expect(t.offset.cycles).toBe(0);
    expect(firstValue(t.repl.scheduler.pattern)).toBe('bd');
  });
});
