/**
 * Spec 019 tech §2.4 / §4: ScratchController routes every input to the selected deck,
 * releases all decks, auto-releases after idle, and reports state changes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { ScratchController, SCRATCH_DECKS } from '../scratch/ScratchController.mjs';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

function slot() {
  const c = { insert: null };
  c.setPreGainInsert = (node) => (c.insert = node);
  c.getPreGainInsert = () => c.insert;
  return c;
}

const types = (deck) => deck.node.port.posted.map((m) => m.type);

describe('ScratchController', () => {
  let ac;
  let main;
  let preview;
  let scratch;
  let warn;

  beforeEach(async () => {
    stubWebAudio();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ac = new AudioContext();
    main = new ScratchDeck(ac, slot());
    preview = new ScratchDeck(ac, slot());
    await Promise.all([main.attach(), preview.attach()]);
    scratch = new ScratchController();
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    unstubWebAudio();
  });

  it('starts on the main deck with nothing available', () => {
    expect(SCRATCH_DECKS).toEqual(['main', 'preview']);
    expect(scratch.selected).toBe('main');
    expect(scratch.state).toEqual({ grabbed: false, selected: 'main', available: { main: false, preview: false } });
    // With no deck every call is a no-op.
    expect(scratch.grab()).toBe(false);
    scratch.moveBy(-1);
    scratch.setMotor(1);
    scratch.release();
    scratch.releaseAll();
  });

  it('sends grab / moveBy / setMotor / release to the selected deck only', () => {
    scratch.setDeck('main', main);
    scratch.setDeck('preview', preview);
    expect(scratch.grab()).toBe(true);
    scratch.moveBy(-0.1);
    scratch.setMotor(-1);
    scratch.release();
    expect(main.node.port.posted).toEqual([
      { type: 'grab' },
      { type: 'move', delta: -0.1 },
      { type: 'motor', rate: -1 },
      { type: 'release' },
    ]);
    expect(preview.node.port.posted).toEqual([]);

    scratch.selected = 'preview';
    scratch.grab();
    expect(types(preview)).toEqual(['grab']);
    expect(main.isGrabbed).toBe(false);
  });

  it('switching the selected deck while held lets go of the previous one', () => {
    scratch.setDeck('main', main);
    scratch.setDeck('preview', preview);
    scratch.grab();
    scratch.selected = 'preview';
    expect(main.isGrabbed).toBe(false);
    expect(types(main)).toEqual(['grab', 'release']);
  });

  it('ignores unknown deck names', () => {
    scratch.setDeck('booth', main);
    scratch.selected = 'booth';
    expect(scratch.selected).toBe('main');
    expect(scratch.getDeck('booth')).toBeNull();
  });

  it('releaseAll lets go of both decks', () => {
    scratch.setDeck('main', main);
    scratch.setDeck('preview', preview);
    main.grab();
    preview.grab();
    expect(scratch.state.grabbed).toBe(true);
    scratch.releaseAll();
    expect(main.isGrabbed).toBe(false);
    expect(preview.isGrabbed).toBe(false);
    expect(scratch.state.grabbed).toBe(false);
  });

  it('replacing or clearing a deck releases the old one', () => {
    scratch.setDeck('main', main);
    scratch.grab();
    scratch.setDeck('main', null);
    expect(main.isGrabbed).toBe(false);
    expect(scratch.state.available.main).toBe(false);
  });

  describe('autoRelease', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      scratch.setDeck('main', main);
    });

    it('lets go after the idle time', () => {
      scratch.grab();
      scratch.moveBy(-0.06);
      scratch.autoRelease(250);
      vi.advanceTimersByTime(249);
      expect(main.isGrabbed).toBe(true);
      vi.advanceTimersByTime(1);
      expect(main.isGrabbed).toBe(false);
      expect(types(main)).toEqual(['grab', 'move', 'release']);
    });

    it('does not let go while moves keep coming (each move re-arms it)', () => {
      scratch.grab();
      scratch.autoRelease(250);
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(200);
        scratch.moveBy(-0.06);
        expect(main.isGrabbed).toBe(true);
      }
      vi.advanceTimersByTime(250);
      expect(main.isGrabbed).toBe(false);
    });

    it('an explicit release cancels it; a later grab is not released by the stale timer', () => {
      scratch.grab();
      scratch.autoRelease(250);
      scratch.release();
      scratch.grab(); // e.g. the user grabs the platter by hand
      vi.advanceTimersByTime(1000);
      expect(main.isGrabbed).toBe(true);
      // and moves after the cancelled auto-release do not re-arm it
      scratch.moveBy(-0.1);
      vi.advanceTimersByTime(1000);
      expect(main.isGrabbed).toBe(true);
    });

    it('releaseAll cancels it', () => {
      scratch.grab();
      scratch.autoRelease(250);
      scratch.releaseAll();
      scratch.grab();
      vi.advanceTimersByTime(1000);
      expect(main.isGrabbed).toBe(true);
    });

    it('ignores invalid durations', () => {
      scratch.grab();
      scratch.autoRelease(NaN);
      scratch.autoRelease(-5);
      vi.advanceTimersByTime(1000);
      expect(main.isGrabbed).toBe(true);
    });
  });

  describe('per-source holds (review finding 1)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      scratch.setDeck('main', main);
    });

    it('wheel then a mouse grab within 250 ms, held still: the wheel idle release does not let go', () => {
      scratch.grab('wheel');
      scratch.moveBy(-0.06, 'wheel');
      scratch.autoRelease(250, 'wheel');
      vi.advanceTimersByTime(100);
      scratch.grab('pointer'); // the user grabs the platter and holds it still
      vi.advanceTimersByTime(1000);
      expect(main.isGrabbed).toBe(true);
      expect(scratch.holders).toEqual(['pointer']);
      scratch.release('pointer');
      expect(main.isGrabbed).toBe(false);
      expect(types(main)).toEqual(['grab', 'move', 'release']);
    });

    it('key held + pointer-up: the deck stays grabbed until the key is released', () => {
      scratch.grab('key');
      scratch.setMotor(-1, 'key');
      scratch.grab('pointer');
      scratch.release('pointer');
      expect(main.isGrabbed).toBe(true);
      expect(scratch.holders).toEqual(['key']);
      scratch.release('key');
      expect(main.isGrabbed).toBe(false);
    });

    it('a pointer-up from a pointer that never grabbed does not release the key hold', () => {
      scratch.grab('key');
      scratch.release('pointer');
      expect(main.isGrabbed).toBe(true);
    });

    it('MIDI jog idle release does not let go of a record the keyboard holds', () => {
      scratch.grab('key');
      scratch.grab('midi');
      scratch.moveBy(-0.01, 'midi');
      scratch.autoRelease(250, 'midi');
      vi.advanceTimersByTime(300);
      expect(main.isGrabbed).toBe(true);
      expect(scratch.holders).toEqual(['key']);
    });

    it("a source's moves re-arm only its own auto-release", () => {
      scratch.grab('wheel');
      scratch.autoRelease(250, 'wheel');
      scratch.grab('midi');
      scratch.autoRelease(250, 'midi');
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(200);
        scratch.moveBy(-0.01, 'wheel');
      }
      expect(scratch.holders).toEqual(['wheel']); // midi's timer fired; the wheel still holds
      expect(main.isGrabbed).toBe(true);
      vi.advanceTimersByTime(250);
      expect(main.isGrabbed).toBe(false);
    });

    it('releaseAll drops every source and every pending auto-release', () => {
      scratch.grab('key');
      scratch.grab('pointer');
      scratch.grab('wheel');
      scratch.autoRelease(250, 'wheel');
      scratch.releaseAll();
      expect(main.isGrabbed).toBe(false);
      expect(scratch.holders).toEqual([]);
      scratch.grab('pointer');
      vi.advanceTimersByTime(1000); // the cancelled wheel timer must not fire
      expect(main.isGrabbed).toBe(true);
    });

    it('switching the deck drops every source', () => {
      scratch.setDeck('preview', preview);
      scratch.grab('key');
      scratch.grab('pointer');
      scratch.selected = 'preview';
      expect(main.isGrabbed).toBe(false);
      expect(scratch.holders).toEqual([]);
    });

    it('a deck released by itself (destroy) clears its holds', () => {
      scratch.grab('key');
      main.destroy();
      expect(scratch.holders).toEqual([]);
    });

    it('no-arg calls keep working as one default source', () => {
      scratch.grab();
      scratch.grab('pointer');
      scratch.release(); // default lets go; the pointer still holds
      expect(main.isGrabbed).toBe(true);
      scratch.release('pointer');
      expect(main.isGrabbed).toBe(false);
      expect(scratch.holders).toEqual([]);
    });
  });

  describe("on('change')", () => {
    it('reports grab, release, selection and availability, but not moves', () => {
      const states = [];
      const off = scratch.on('change', (s) => states.push(s));
      scratch.setDeck('main', main);
      scratch.setDeck('preview', preview);
      scratch.grab();
      scratch.moveBy(-0.1);
      scratch.moveBy(-0.1);
      scratch.release();
      scratch.selected = 'preview';
      expect(states).toEqual([
        { grabbed: false, selected: 'main', available: { main: true, preview: false } },
        { grabbed: false, selected: 'main', available: { main: true, preview: true } },
        { grabbed: true, selected: 'main', available: { main: true, preview: true } },
        { grabbed: false, selected: 'main', available: { main: true, preview: true } },
        { grabbed: false, selected: 'preview', available: { main: true, preview: true } },
      ]);
      off();
      scratch.selected = 'main';
      expect(states).toHaveLength(5);
    });

    it('a deck that attaches later becomes available', async () => {
      const late = new ScratchDeck(ac, slot());
      const fn = vi.fn();
      scratch.on('change', fn);
      scratch.setDeck('preview', late);
      expect(scratch.state.available.preview).toBe(false);
      await late.attach();
      expect(scratch.state.available.preview).toBe(true);
      expect(fn).toHaveBeenLastCalledWith(expect.objectContaining({ available: { main: false, preview: true } }));
      late.destroy();
      expect(scratch.state.available.preview).toBe(false);
    });

    it('stops listening to a deck that was replaced', () => {
      scratch.setDeck('main', main);
      scratch.setDeck('main', null);
      const fn = vi.fn();
      scratch.on('change', fn);
      main.grab();
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
