/**
 * Spec 019 tech §2.3–2.4 / §4: ScratchDeck (worklet loading, insert slot, port messages,
 * teardown) and the PreviewEngine's headphone deck, against the Web Audio mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScratchDeck, SCRATCH_BUFFER_SECONDS } from '../scratch/ScratchDeck.mjs';
import { loadScratchWorklet } from '../scratch/scratchWorklet.mjs';
import { PreviewEngine } from '../PreviewEngine.mjs';
import { stubWebAudio, unstubWebAudio, createAudioParam } from './webAudioMock.mjs';

/** A SuperdoughAudioController stand-in with the agreed pre-gain insert slot. */
function fakeController({ withSlot = true, withGetter = true } = {}) {
  const c = { insert: null, slotCalls: [] };
  if (withSlot) {
    c.setPreGainInsert = (node) => {
      c.slotCalls.push(node);
      c.insert = node;
    };
  }
  if (withSlot && withGetter) c.getPreGainInsert = () => c.insert;
  return c;
}

const types = (node) => node.port.posted.map((m) => m.type);

describe('ScratchDeck', () => {
  let ac;
  let warn;

  beforeEach(() => {
    stubWebAudio();
    ac = new AudioContext();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    unstubWebAudio();
  });

  describe('attach', () => {
    it('loads the worklet, creates a scratch-processor node and puts it in the pre-gain slot', async () => {
      const controller = fakeController();
      const deck = new ScratchDeck(ac, controller);
      const changes = vi.fn();
      deck.on('change', changes);
      expect(deck.isAttached).toBe(false);

      await expect(deck.attach()).resolves.toBe(true);

      expect(ac.addedModules).toHaveLength(1);
      expect(ac.addedModules[0]).toMatch(/^data:text\/javascript;base64,/);
      expect(ac.workletNodes).toHaveLength(1);
      const node = ac.workletNodes[0];
      expect(node.name).toBe('scratch-processor');
      expect(node.options).toMatchObject({
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        outputChannelCount: [2],
        processorOptions: { bufferSeconds: SCRATCH_BUFFER_SECONDS },
      });
      expect(controller.slotCalls).toEqual([node]);
      expect(deck.isAttached).toBe(true);
      expect(changes).toHaveBeenCalledTimes(1);
    });

    it('follows the destination channel count (multichannel outputs)', async () => {
      ac.destination.channelCount = 6;
      const deck = new ScratchDeck(ac, fakeController());
      await deck.attach();
      expect(ac.workletNodes[0].options.channelCount).toBe(6);
      expect(ac.workletNodes[0].options.outputChannelCount).toEqual([6]);
    });

    it('loads the module once per AudioContext, shared by both decks, and once per attach call', async () => {
      const a = new ScratchDeck(ac, fakeController());
      const b = new ScratchDeck(ac, fakeController());
      await Promise.all([a.attach(), a.attach(), b.attach()]);
      expect(ac.addedModules).toHaveLength(1);
      expect(ac.workletNodes).toHaveLength(2);
      await a.attach(); // already attached: no second node
      expect(ac.workletNodes).toHaveLength(2);

      const other = new AudioContext();
      await new ScratchDeck(other, fakeController()).attach();
      expect(other.addedModules).toHaveLength(1);
    });

    it('without setPreGainInsert: warns, stays un-attached, never throws', async () => {
      const controller = fakeController({ withSlot: false });
      const deck = new ScratchDeck(ac, controller);
      await expect(deck.attach()).resolves.toBe(false);
      expect(deck.isAttached).toBe(false);
      expect(ac.workletNodes).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('setPreGainInsert'));
      // Everything stays a safe no-op.
      expect(deck.grab()).toBe(false);
      deck.moveBy(-1);
      deck.release();
      deck.destroy();
    });

    it('a failed worklet load resolves false and a later attach retries', async () => {
      let fail = true;
      ac.audioWorklet.addModule = vi.fn(() => (fail ? Promise.reject(new Error('blocked')) : Promise.resolve()));
      const deck = new ScratchDeck(ac, fakeController());
      await expect(deck.attach()).resolves.toBe(false);
      expect(warn).toHaveBeenCalled();
      fail = false;
      await expect(deck.attach()).resolves.toBe(true);
      expect(ac.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    });

    it('loadScratchWorklet rejects when the context has no AudioWorklet', async () => {
      await expect(loadScratchWorklet({})).rejects.toThrow(/AudioWorklet/);
    });
  });

  describe('messages', () => {
    let deck;
    let node;
    beforeEach(async () => {
      deck = new ScratchDeck(ac, fakeController());
      await deck.attach();
      node = ac.workletNodes[0];
    });

    it('posts grab, move, motor and release in order', () => {
      deck.grab();
      deck.moveBy(-0.1);
      deck.moveBy(0.05);
      deck.setMotor(-1);
      deck.release();
      expect(node.port.posted).toEqual([
        { type: 'grab' },
        { type: 'move', delta: -0.1 },
        { type: 'move', delta: 0.05 },
        { type: 'motor', rate: -1 },
        { type: 'release' },
      ]);
    });

    it('tracks isGrabbed and emits change on grab and release only', () => {
      const changes = vi.fn();
      deck.on('change', changes);
      deck.grab();
      expect(deck.isGrabbed).toBe(true);
      deck.grab(); // already held
      deck.moveBy(-0.1);
      deck.release();
      expect(deck.isGrabbed).toBe(false);
      expect(changes).toHaveBeenCalledTimes(2);
      expect(types(node)).toEqual(['grab', 'move', 'release']);
    });

    it('negative pair: moves and motor without a grab post nothing; release is idempotent', () => {
      deck.moveBy(-0.1);
      deck.setMotor(1);
      deck.release();
      deck.release();
      expect(node.port.posted).toEqual([]);
      deck.grab();
      deck.release();
      deck.release();
      expect(types(node)).toEqual(['grab', 'release']);
    });

    it('ignores non-finite moves and rates, and clamps the motor to ±8', () => {
      deck.grab();
      deck.moveBy(NaN);
      deck.moveBy(Infinity);
      deck.moveBy('1');
      deck.setMotor(NaN);
      deck.setMotor(100);
      deck.setMotor(-100);
      expect(node.port.posted).toEqual([{ type: 'grab' }, { type: 'motor', rate: 8 }, { type: 'motor', rate: -8 }]);
    });

    it('getDebugState resolves the worklet reply via a port round-trip', async () => {
      const p = deck.getDebugState();
      const req = node.port.posted.at(-1);
      expect(req).toMatchObject({ type: 'debug' });
      node.port.reply({ type: 'debug', id: req.id, mix: 1, grabbed: true, pos: -0.25 });
      await expect(p).resolves.toEqual({ mix: 1, grabbed: true, pos: -0.25 });
    });

    it('getDebugState resolves null when the worklet does not answer', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const p = deck.getDebugState();
      vi.advanceTimersByTime(1000);
      await expect(p).resolves.toBeNull();
    });
  });

  describe('release before attach resolves', () => {
    it('release() and grab() are safe no-ops while the worklet still loads', async () => {
      let finish;
      ac.audioWorklet.addModule = () => new Promise((r) => (finish = r));
      const deck = new ScratchDeck(ac, fakeController());
      const attaching = deck.attach();
      expect(() => deck.release()).not.toThrow();
      expect(deck.grab()).toBe(false);
      expect(deck.isGrabbed).toBe(false);
      await Promise.resolve();
      finish();
      await expect(attaching).resolves.toBe(true);
      expect(ac.workletNodes[0].port.posted).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('releases, clears the slot, disconnects the node and closes its port', async () => {
      const controller = fakeController();
      const deck = new ScratchDeck(ac, controller);
      await deck.attach();
      const node = ac.workletNodes[0];
      deck.grab();
      deck.destroy();
      expect(types(node)).toEqual(['grab', 'release']);
      expect(controller.slotCalls).toEqual([node, null]);
      expect(node.disconnected).toBe(1);
      expect(node.port.closed).toBe(true);
      expect(node.port.onmessage).toBeNull();
      expect(deck.isAttached).toBe(false);
      deck.destroy(); // idempotent
      expect(node.disconnected).toBe(1);
      await expect(deck.attach()).resolves.toBe(false);
    });

    it('does not clear the slot when it now holds another deck', async () => {
      const controller = fakeController();
      const first = new ScratchDeck(ac, controller);
      await first.attach();
      const second = new ScratchDeck(ac, controller);
      await second.attach();
      first.destroy();
      expect(controller.insert).toBe(ac.workletNodes[1]);
    });

    it('destroy while the worklet loads: no node is created or inserted', async () => {
      let finish;
      ac.audioWorklet.addModule = () => new Promise((r) => (finish = r));
      const controller = fakeController();
      const deck = new ScratchDeck(ac, controller);
      const attaching = deck.attach();
      deck.destroy();
      await Promise.resolve();
      finish();
      await expect(attaching).resolves.toBe(false);
      expect(ac.workletNodes).toHaveLength(0);
      expect(controller.slotCalls).toEqual([]);
    });

    it('a pending getDebugState resolves null on destroy', async () => {
      const deck = new ScratchDeck(ac, fakeController());
      await deck.attach();
      const p = deck.getDebugState();
      deck.destroy();
      await expect(p).resolves.toBeNull();
    });

    it('five attach/destroy cycles leave no node connected', async () => {
      const controller = fakeController();
      for (let i = 0; i < 5; i++) {
        const deck = new ScratchDeck(ac, controller);
        await deck.attach();
        deck.grab();
        deck.moveBy(-0.2);
        deck.release();
        deck.destroy();
      }
      expect(ac.workletNodes).toHaveLength(5);
      expect(ac.workletNodes.every((n) => n.disconnected === 1 && n.port.closed)).toBe(true);
      expect(controller.insert).toBeNull();
      expect(ac.addedModules).toHaveLength(1);
    });
  });
});

describe('PreviewEngine scratch deck', () => {
  let warn;
  let log;

  beforeEach(() => {
    stubWebAudio();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    log.mockRestore();
    unstubWebAudio();
  });

  function makeDeps(controllers) {
    class FakeSuperdoughController {
      constructor(ctx) {
        const destinationGain = ctx.createGain();
        destinationGain.gain = createAudioParam(1);
        this.output = { destinationGain };
        this.insert = null;
        controllers.push(this);
      }
      setPreGainInsert(node) {
        this.insert = node;
      }
      getPreGainInsert() {
        return this.insert;
      }
    }
    return {
      SuperdoughAudioController: FakeSuperdoughController,
      superdough: vi.fn(),
      repl: () => ({ evaluate: vi.fn(), stop: vi.fn() }),
      getTime: () => 0,
    };
  }

  it('initialize() creates no scratch node and loads no worklet (page mount, before a gesture)', async () => {
    const ac = new AudioContext();
    const controllers = [];
    const engine = new PreviewEngine(ac, makeDeps(controllers));
    await engine.initialize();
    expect(engine.isInitialized).toBe(true);
    expect(engine.scratchDeck).toBeNull();
    expect(ac.addedModules).toHaveLength(0);
    expect(ac.workletNodes).toHaveLength(0);
    expect(controllers[0].insert).toBeNull();
    engine.destroy();
  });

  it('ensureScratchDeck() creates and attaches the deck on the preview controller, once', async () => {
    const ac = new AudioContext();
    const controllers = [];
    const engine = new PreviewEngine(ac, makeDeps(controllers));
    await engine.initialize();
    const [a, b] = await Promise.all([engine.ensureScratchDeck(), engine.ensureScratchDeck()]);
    expect(a).toBeInstanceOf(ScratchDeck);
    expect(b).toBe(a);
    expect(engine.scratchDeck).toBe(a);
    expect(a.isAttached).toBe(true);
    expect(controllers[0].insert).toBe(ac.workletNodes[0]);
    expect(ac.workletNodes).toHaveLength(1);
    expect(ac.addedModules).toHaveLength(1);
    await expect(engine.ensureScratchDeck()).resolves.toBe(a);
    expect(ac.workletNodes).toHaveLength(1);
    engine.destroy();
  });

  it('the first preview evaluate() creates the deck, after ensurePlaying', async () => {
    const ac = new AudioContext();
    const engine = new PreviewEngine(ac, makeDeps([]));
    await engine.initialize();
    await engine.evaluate('s("bd")');
    expect(engine.audioElement.paused).toBe(false);
    expect(engine.scratchDeck).toBeInstanceOf(ScratchDeck);
    await engine.ensureScratchDeck();
    expect(engine.scratchDeck.isAttached).toBe(true);
    expect(ac.workletNodes).toHaveLength(1);
    engine.destroy();
  });

  it('ensureScratchDeck() before initialize resolves null and creates nothing', async () => {
    const ac = new AudioContext();
    const engine = new PreviewEngine(ac, makeDeps([]));
    await expect(engine.ensureScratchDeck()).resolves.toBeNull();
    expect(engine.scratchDeck).toBeNull();
    expect(ac.addedModules).toHaveLength(0);
  });

  it('destroy() while the deck attaches: no node inserted, ensureScratchDeck resolves null', async () => {
    const ac = new AudioContext();
    let finish;
    ac.audioWorklet.addModule = () => new Promise((r) => (finish = r));
    const controllers = [];
    const engine = new PreviewEngine(ac, makeDeps(controllers));
    await engine.initialize();
    const pending = engine.ensureScratchDeck();
    engine.destroy();
    await Promise.resolve();
    finish();
    await expect(pending).resolves.toBeNull();
    expect(ac.workletNodes).toHaveLength(0);
    expect(controllers[0].insert).toBeNull();
    expect(engine.scratchDeck).toBeNull();
  });

  it('destroy() with no deck yet is safe', async () => {
    const ac = new AudioContext();
    const engine = new PreviewEngine(ac, makeDeps([]));
    await engine.initialize();
    expect(() => engine.destroy()).not.toThrow();
    expect(engine.scratchDeck).toBeNull();
  });

  it('destroys the deck in destroy(): slot cleared, node disconnected', async () => {
    const ac = new AudioContext();
    const controllers = [];
    const engine = new PreviewEngine(ac, makeDeps(controllers));
    await engine.initialize();
    const deck = await engine.ensureScratchDeck();
    deck.grab();
    engine.destroy();
    expect(engine.scratchDeck).toBeNull();
    expect(deck.isAttached).toBe(false);
    expect(controllers[0].insert).toBeNull();
    expect(ac.workletNodes[0].disconnected).toBe(1);
    expect(ac.workletNodes[0].port.posted.map((m) => m.type)).toEqual(['grab', 'release']);
  });

  it('a deck that could not attach (no insert slot) resolves null and leaves initialize working', async () => {
    const ac = new AudioContext();
    const deps = makeDeps([]);
    delete deps.SuperdoughAudioController.prototype.setPreGainInsert;
    const engine = new PreviewEngine(ac, deps);
    await engine.initialize();
    expect(engine.isInitialized).toBe(true);
    await expect(engine.ensureScratchDeck()).resolves.toBeNull();
    expect(engine.scratchDeck.isAttached).toBe(false);
    engine.destroy();
  });
});
