/**
 * @spec: 019-vinyl-scratch-control (2.1, 2.5, 2.6; tech §2.6)
 * The website's scratch runtime: the decks it attaches (speakers after audio init, headphones
 * from PreviewEngine), the store the platter reads, releaseAll before stop / Update, the deck
 * choice persisted as a string-safe setting, and MIDI loaded only when needed.
 *
 * Runs against the real ScratchController with stand-in decks (no Web Audio).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// settings.ts imports util, which imports every Strudel package (tidal needs a build).
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { ScratchController, type MidiJog, type MidiJogMapping, type ScratchDeckName } from '@strudel/mixer';
import {
  createScratchRuntime,
  type PreviewEngineLike,
  type ScratchDeckLike,
  type ScratchRuntimeDeps,
} from '../scratch/scratchRuntime';
import { parseScratchDeck } from '../../settings';

/** A deck that behaves like ScratchDeck: attach may fail (no pre-gain slot), grab is idempotent. */
class FakeDeck implements ScratchDeckLike {
  isAttached = false;
  isGrabbed = false;
  destroyed = false;
  calls: string[] = [];
  private listeners = new Set<() => void>();
  private resolveAttach: ((ok: boolean) => void) | null = null;
  constructor(
    readonly args: unknown[] = [],
    private attachResult: boolean | 'manual' = true,
  ) {}
  attach() {
    if (this.attachResult === 'manual') {
      return new Promise<boolean>((resolve) => {
        this.resolveAttach = (ok) => {
          this.isAttached = ok;
          this.emit();
          resolve(ok);
        };
      });
    }
    this.isAttached = this.attachResult;
    this.emit();
    return Promise.resolve(this.attachResult);
  }
  finishAttach(ok = true) {
    this.resolveAttach?.(ok);
  }
  grab() {
    if (!this.isAttached) return false;
    this.calls.push('grab');
    if (!this.isGrabbed) {
      this.isGrabbed = true;
      this.emit();
    }
    return true;
  }
  moveBy(seconds: number) {
    if (this.isGrabbed) this.calls.push(`move:${seconds}`);
  }
  setMotor(rate: number) {
    if (this.isGrabbed) this.calls.push(`motor:${rate}`);
  }
  release() {
    if (!this.isGrabbed) return;
    this.calls.push('release');
    this.isGrabbed = false;
    this.emit();
  }
  destroy() {
    this.release();
    this.destroyed = true;
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

/** A PreviewEngine stand-in whose ensureScratchDeck() attaches `deck` (as the real one does on play). */
function engineWith(deck: FakeDeck) {
  return {
    ensureScratchDeck: vi.fn(async () => {
      await deck.attach();
      return deck as unknown as ScratchDeckLike;
    }),
  };
}

function setup(overrides: Partial<ScratchRuntimeDeps> & { attachResult?: boolean | 'manual' } = {}) {
  const decks: FakeDeck[] = [];
  const written: ScratchDeckName[] = [];
  const createController = vi.fn(() => new ScratchController());
  const deps: ScratchRuntimeDeps = {
    createController,
    createDeck: (ac, sdc) => {
      const deck = new FakeDeck([ac, sdc], overrides.attachResult ?? true);
      decks.push(deck);
      return deck as unknown as ReturnType<ScratchRuntimeDeps['createDeck']>;
    },
    loadMidiJog: vi.fn(async () => {
      throw new Error('not used');
    }),
    readSelected: () => 'main',
    writeSelected: (deck) => written.push(deck),
    midiSupported: () => true,
    hasStoredMidiMapping: () => false,
    ...overrides,
  };
  return { runtime: createScratchRuntime(deps), decks, written, createController, deps };
}

const ac = {} as AudioContext;
const sdc = { name: 'main superdough controller' };

/** The speakers deck attached and playing: the state in which it can be grabbed. */
async function attachPlaying(runtime: ReturnType<typeof setup>['runtime']) {
  await runtime.attachMain(ac, sdc);
  runtime.setPlaying('main', true);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('scratch runtime: the speakers deck', () => {
  it('attaches one deck to superdough after audio init, and the store says it is available', async () => {
    const { runtime, decks } = setup();
    expect(runtime.store.get().available.main).toBe(false);
    await runtime.attachMain(ac, sdc);
    expect(decks).toHaveLength(1);
    expect(decks[0].args).toEqual([ac, sdc]);
    expect(runtime.store.get().available.main).toBe(true);
    // Once per controller: a second call (a re-render, StrictMode) attaches nothing new.
    await runtime.attachMain(ac, sdc);
    expect(decks).toHaveLength(1);
  });

  it('without the pre-gain slot the deck stays unavailable, and grabbing is a no-op (no throw)', async () => {
    const { runtime, decks } = setup({ attachResult: false });
    await runtime.attachMain(ac, sdc);
    expect(runtime.store.get().available.main).toBe(false);
    runtime.setPlaying('main', true);
    expect(() => runtime.grab()).not.toThrow();
    expect(runtime.store.get().grabbed).toBe(false);
    expect(decks[0].calls).toEqual([]);
  });

  it('a deck that failed to attach is dropped and retried on the next Play, once per Play (review #4)', async () => {
    let result = false;
    const decks: FakeDeck[] = [];
    const { runtime } = setup({
      createDeck: (a, c) => {
        const deck = new FakeDeck([a, c], result);
        decks.push(deck);
        return deck as unknown as ScratchDeckLike;
      },
    });
    await runtime.attachMain(ac, sdc);
    expect(decks).toHaveLength(1);
    expect(decks[0].destroyed).toBe(true); // not kept
    // Grabs and repeated "still playing" updates never retry: no storm.
    runtime.grab();
    runtime.grab();
    expect(decks).toHaveLength(1);

    runtime.setPlaying('main', true); // Play: one retry
    await vi.waitFor(() => expect(decks).toHaveLength(2));
    runtime.setPlaying('main', true);
    expect(decks).toHaveLength(2);

    await new Promise((resolve) => setTimeout(resolve, 0)); // the second attempt settles (fails)
    expect(decks[1].destroyed).toBe(true);
    result = true; // the slot exists now (e.g. after an update)
    runtime.setPlaying('main', false);
    runtime.setPlaying('main', true);
    await vi.waitFor(() => expect(runtime.store.get().available.main).toBe(true));
    expect(decks).toHaveLength(3);
    expect(runtime.grab()).toBe(true);
  });

  it('negative: after detachMain (unmount) a Play does not attach again', async () => {
    const decks: FakeDeck[] = [];
    const { runtime } = setup({
      createDeck: (a, c) => {
        const deck = new FakeDeck([a, c], false);
        decks.push(deck);
        return deck as unknown as ScratchDeckLike;
      },
    });
    await runtime.attachMain(ac, sdc);
    runtime.detachMain();
    runtime.setPlaying('main', true);
    await Promise.resolve();
    expect(decks).toHaveLength(1);
  });

  it('a detach while the worklet loads destroys the deck instead of registering it', async () => {
    const { runtime, decks } = setup({ attachResult: 'manual' });
    const attaching = runtime.attachMain(ac, sdc);
    runtime.detachMain();
    decks[0].finishAttach(true);
    await attaching;
    expect(decks[0].destroyed).toBe(true);
    expect(runtime.store.get().available.main).toBe(false);
  });

  it('detachMain lets go, destroys the deck and marks it unavailable', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab();
    runtime.detachMain();
    expect(decks[0].calls).toContain('release');
    expect(decks[0].destroyed).toBe(true);
    expect(runtime.store.get().available.main).toBe(false);
    expect(runtime.store.get().grabbed).toBe(false);
  });
});

describe('scratch runtime: no scratching a stopped deck (review #2)', () => {
  it("keys and MIDI cannot grab while the deck is stopped, so the stopped track's tail stays silent", async () => {
    const { runtime, decks } = setup();
    await runtime.attachMain(ac, sdc); // attached, but nothing plays
    expect(runtime.grab()).toBe(false);
    runtime.setMotor(-1);
    expect(decks[0].calls).toEqual([]);
    expect(runtime.store.get().grabbed).toBe(false);
    runtime.setPlaying('main', true);
    expect(runtime.grab()).toBe(true);
  });

  it('the MIDI jog drives the gated runtime, not the raw controller', async () => {
    let target: { grab(): boolean } | null = null;
    const loadMidiJog = vi.fn(async (t: { grab(): boolean }) => {
      target = t;
      return { mapping: null, state: 'off', on: () => () => {}, learn: async () => null } as unknown as MidiJog;
    });
    const { runtime, decks } = setup({ loadMidiJog, hasStoredMidiMapping: () => true });
    await runtime.restoreMidi();
    await runtime.attachMain(ac, sdc);
    expect(target).toBe(runtime);
    expect(target!.grab()).toBe(false); // a jog touch after Stop
    expect(decks[0].calls).toEqual([]);
  });

  it('a deck that stops while held is let go of', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab();
    runtime.setPlaying('main', false);
    expect(decks[0].isGrabbed).toBe(false);
    expect(runtime.store.get().grabbed).toBe(false);
  });
});

describe('scratch runtime: each input holds the record on its own (per-source holds)', () => {
  it('a held key keeps the record when the platter (pointer) lets go', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab('key');
    runtime.grab('pointer');
    runtime.release('pointer');
    expect(decks[0].isGrabbed).toBe(true);
    expect(runtime.store.get().grabbed).toBe(true);
    runtime.release('key');
    expect(decks[0].isGrabbed).toBe(false);
    expect(runtime.store.get().grabbed).toBe(false);
  });

  it("the wheel's auto-release does not drop a record the key holds", async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    runtime.grab('key');
    runtime.grab('wheel');
    runtime.moveBy(-0.06, 'wheel');
    runtime.autoRelease(250, 'wheel');
    vi.advanceTimersByTime(300);
    expect(decks[0].isGrabbed).toBe(true);
    runtime.release('key');
    expect(decks[0].isGrabbed).toBe(false);
  });

  it('a held platter keeps the record when the key is let go', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab('pointer');
    runtime.grab('key');
    runtime.release('key');
    expect(decks[0].isGrabbed).toBe(true);
    runtime.release('pointer');
    expect(decks[0].isGrabbed).toBe(false);
  });

  it('releaseAll (stop, Update) drops every source at once', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab('key');
    runtime.grab('pointer');
    runtime.grab('midi');
    runtime.releaseAll();
    expect(decks[0].isGrabbed).toBe(false);
    // Nothing left holding: a late pointer-up changes nothing.
    runtime.release('pointer');
    expect(decks[0].isGrabbed).toBe(false);
  });
});

describe('scratch runtime: grab, move, release', () => {
  it('grab / moveBy / setMotor / release reach the selected deck, and the store follows', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab();
    expect(runtime.store.get().grabbed).toBe(true);
    runtime.moveBy(-0.06);
    runtime.setMotor(-1);
    runtime.release();
    expect(decks[0].calls).toEqual(['grab', 'move:-0.06', 'motor:-1', 'release']);
    expect(runtime.store.get().grabbed).toBe(false);
  });

  it('ignores non-finite moves and rates', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    runtime.grab();
    runtime.moveBy(Number.NaN);
    runtime.moveBy(Number.POSITIVE_INFINITY);
    runtime.setMotor(Number.NaN);
    expect(decks[0].calls).toEqual(['grab']);
  });

  it('autoRelease lets go 250 ms after the last move', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    runtime.grab();
    runtime.moveBy(-0.06);
    runtime.autoRelease(250);
    vi.advanceTimersByTime(200);
    runtime.moveBy(-0.06); // a move re-arms the timer
    vi.advanceTimersByTime(200);
    expect(runtime.store.get().grabbed).toBe(true);
    vi.advanceTimersByTime(60);
    expect(runtime.store.get().grabbed).toBe(false);
    expect(decks[0].calls.at(-1)).toBe('release');
  });

  it('releaseAll lets go of both decks (stop, Update, track switch)', async () => {
    const { runtime, decks } = setup();
    await attachPlaying(runtime);
    const previewDeck = new FakeDeck();
    runtime.attachPreview(engineWith(previewDeck));
    await runtime.ensurePreviewDeck();
    runtime.grab();
    expect(decks[0].isGrabbed).toBe(true);
    previewDeck.grab(); // e.g. a MIDI jog on the headphones
    runtime.releaseAll();
    expect(decks[0].isGrabbed).toBe(false);
    expect(previewDeck.isGrabbed).toBe(false);
    expect(runtime.store.get().grabbed).toBe(false);
  });

  it('negative: releaseAll before anything was scratched creates no controller', () => {
    const { runtime, createController } = setup();
    expect(() => runtime.releaseAll()).not.toThrow();
    expect(createController).not.toHaveBeenCalled();
  });
});

describe('scratch runtime: deck choice and the headphone preview', () => {
  it('the headphone deck is created only when the preview plays; Headphones is available while it runs', async () => {
    const { runtime } = setup();
    const previewDeck = new FakeDeck();
    const engine = engineWith(previewDeck);
    runtime.attachPreview(engine);
    // Page mount: no deck, no worklet (review #5).
    expect(engine.ensureScratchDeck).not.toHaveBeenCalled();
    expect(runtime.store.get().available.preview).toBe(false);
    runtime.setPlaying('preview', true);
    expect(engine.ensureScratchDeck).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(runtime.store.get().previewAvailable).toBe(true));
    runtime.setPlaying('preview', false);
    expect(runtime.store.get().previewAvailable).toBe(false);
    expect(runtime.store.get().available.preview).toBe(true);
    runtime.detachPreview();
    expect(runtime.store.get().available.preview).toBe(false);
    expect(runtime.store.get().previewAvailable).toBe(false);
  });

  it('a headphone deck that fails to attach is retried on the next preview start', async () => {
    const { runtime } = setup();
    const previewDeck = new FakeDeck();
    let ok = false;
    const engine = { ensureScratchDeck: vi.fn(async () => (ok ? (await previewDeck.attach(), previewDeck) : null)) };
    runtime.attachPreview(engine as unknown as PreviewEngineLike);
    runtime.setPlaying('preview', true);
    await runtime.ensurePreviewDeck();
    expect(runtime.store.get().available.preview).toBe(false);
    runtime.setPlaying('preview', false);
    ok = true;
    runtime.setPlaying('preview', true);
    await vi.waitFor(() => expect(runtime.store.get().previewAvailable).toBe(true));
  });

  it('negative: no engine (or a detached one) never registers a deck', async () => {
    const { runtime } = setup();
    expect(() => runtime.attachPreview(null)).not.toThrow();
    runtime.setPlaying('preview', true);
    await runtime.ensurePreviewDeck();
    expect(runtime.store.get().available.preview).toBe(false);
    const engine = engineWith(new FakeDeck());
    runtime.attachPreview(engine);
    const pending = runtime.ensurePreviewDeck();
    runtime.detachPreview(); // the engine is destroyed while the worklet loads
    await pending;
    expect(runtime.store.get().available.preview).toBe(false);
  });

  it('a stored Headphones choice falls back to Speakers until the headphone preview runs (review #6)', async () => {
    const { runtime, decks, written, createController } = setup({ readSelected: () => 'preview' });
    // After a reload: Headphones is remembered, but the effective deck is the speakers.
    expect(runtime.store.get()).toMatchObject({ preferred: 'preview', selected: 'main' });
    await attachPlaying(runtime);
    expect(runtime.grab()).toBe(true);
    expect(decks[0].isGrabbed).toBe(true);
    const controller = createController.mock.results[0].value as ScratchController;
    expect(controller.selected).toBe('main');

    // The preview starts: input goes to the headphones, and the speakers are let go of.
    const previewDeck = new FakeDeck();
    runtime.attachPreview(engineWith(previewDeck));
    runtime.setPlaying('preview', true);
    await vi.waitFor(() => expect(runtime.store.get().selected).toBe('preview'));
    expect(controller.selected).toBe('preview');
    expect(decks[0].isGrabbed).toBe(false);

    // The preview stops: back to the speakers, the stored choice is kept.
    runtime.setPlaying('preview', false);
    expect(runtime.store.get()).toMatchObject({ preferred: 'preview', selected: 'main' });
    expect(controller.selected).toBe('main');
    expect(written).toEqual([]);
  });

  it('select() stores the choice; the effective deck changes only when it is usable', async () => {
    const { runtime, decks, written } = setup();
    await attachPlaying(runtime);
    runtime.select('preview'); // no preview running
    expect(written).toEqual(['preview']);
    expect(runtime.store.get()).toMatchObject({ preferred: 'preview', selected: 'main' });
    runtime.grab();
    expect(decks[0].isGrabbed).toBe(true);
    runtime.select('main');
    expect(written).toEqual(['preview', 'main']);
    expect(runtime.store.get().selected).toBe('main');
  });

  it('the stored setting is string-safe after a reload', () => {
    expect(parseScratchDeck('preview')).toBe('preview');
    expect(parseScratchDeck('main')).toBe('main');
    expect(parseScratchDeck(undefined)).toBe('main');
    expect(parseScratchDeck('true')).toBe('main');
    expect(parseScratchDeck('"preview"')).toBe('main');
  });
});

describe('scratch runtime: MIDI jog', () => {
  const mapping: MidiJogMapping = { inputName: 'DJ Control', channel: 1, controller: 33, encoding: 'twos-complement' };

  function fakeJog() {
    const listeners = new Set<(jog: MidiJog) => void>();
    let finish: ((m: MidiJogMapping | null) => void) | null = null;
    const jog = {
      mapping: null as MidiJogMapping | null,
      state: 'off' as MidiJog['state'],
      reason: undefined as MidiJog['reason'],
      ready: Promise.resolve(),
      learn: vi.fn(() => {
        jog.state = 'learning';
        listeners.forEach((fn) => fn(jog as unknown as MidiJog));
        return new Promise<MidiJogMapping | null>((resolve) => {
          finish = (m) => {
            if (m) jog.mapping = m;
            jog.state = jog.mapping ? 'ready' : 'off';
            listeners.forEach((fn) => fn(jog as unknown as MidiJog));
            resolve(m);
          };
        });
      }),
      forget: vi.fn(() => {
        jog.mapping = null;
        jog.state = 'off';
        listeners.forEach((fn) => fn(jog as unknown as MidiJog));
      }),
      on: (_event: 'change', fn: (j: MidiJog) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy: vi.fn(),
    };
    return { jog: jog as unknown as MidiJog, finish: (m: MidiJogMapping | null) => finish?.(m) };
  }

  it('without Web MIDI: unavailable ("unsupported"), Learn resolves null and loads nothing', async () => {
    const { runtime, deps } = setup({ midiSupported: () => false });
    expect(runtime.store.get().midi).toMatchObject({ state: 'unavailable', reason: 'unsupported' });
    await expect(runtime.midiLearn()).resolves.toBeNull();
    expect(deps.loadMidiJog).not.toHaveBeenCalled();
  });

  it('Learn loads the jog once, shows learning, then the assigned control; Forget clears it', async () => {
    const { jog, finish } = fakeJog();
    const loadMidiJog = vi.fn(async () => jog);
    const { runtime } = setup({ loadMidiJog });
    const learning = runtime.midiLearn();
    await vi.waitFor(() => expect(runtime.store.get().midi.state).toBe('learning'));
    finish(mapping);
    await expect(learning).resolves.toEqual(mapping);
    expect(runtime.store.get().midi).toMatchObject({ state: 'ready', mapping });
    runtime.midiForget();
    expect(runtime.store.get().midi).toMatchObject({ state: 'off', mapping: null });
    expect(loadMidiJog).toHaveBeenCalledTimes(1);
  });

  it('restoreMidi loads the jog only when a mapping is stored', async () => {
    const without = setup({ hasStoredMidiMapping: () => false });
    await without.runtime.restoreMidi();
    expect(without.deps.loadMidiJog).not.toHaveBeenCalled();

    const { jog } = fakeJog();
    const loadMidiJog = vi.fn(async () => jog);
    const stored = setup({ hasStoredMidiMapping: () => true, loadMidiJog });
    await stored.runtime.restoreMidi();
    expect(loadMidiJog).toHaveBeenCalledTimes(1);
  });

  it('a failed MIDI load reports unavailable instead of throwing', async () => {
    const loadMidiJog = vi.fn(async () => {
      throw new Error('chunk failed');
    });
    const { runtime } = setup({ loadMidiJog });
    await expect(runtime.midiLearn()).resolves.toBeNull();
    expect(runtime.store.get().midi.state).toBe('unavailable');
  });
});
