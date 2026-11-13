/**
 * @spec: 023-vinyl-scratch-realism (tech §2.2–2.3, §3)
 *
 * The track moves after a scratch: a per-deck offset composed with spec 017's origin, applied on
 * `lagSettled` together with the stale-voice release and the hand-over time, all synchronously.
 * A release still spinning up is cancelled by releaseAll (Update, switch, stop), so a late
 * `lagSettled` never shifts anything; and the headphone deck has its own offset and voices.
 *
 * Seams: real Patterns from @strudel/core (imported statically, no module reset), a fake repl
 * (setPattern → editPattern → scheduler.pattern, like core's), real ScratchDeck on the Web Audio
 * mock with the worklet's replies played through its port.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sequence } from '@strudel/core';
import { PatternOffset, ScratchHandOver, scratchShiftTime } from '../scratch/ScratchShift.mjs';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { ScratchController } from '../scratch/ScratchController.mjs';
import { TrackTransitionController } from '../TrackTransitionController.mjs';
import { PreviewEngine } from '../PreviewEngine.mjs';
import { stubWebAudio, unstubWebAudio, createAudioParam } from './webAudioMock.mjs';

/** Onsets (cycle positions) of a pattern within [0, 2). */
const onsets = (pat) =>
  pat
    .queryArc(0, 2)
    .filter((h) => h.hasOnset())
    .map((h) => h.whole.begin.valueOf())
    .sort((a, b) => a - b);

/** A repl like core's: setPattern runs editPattern, then hands the result to the scheduler. */
function fakeRepl(editPattern, scheduler = {}) {
  const r = {
    scheduler: {
      started: true,
      cps: 0.5,
      latency: 0.1,
      lastEnd: 10,
      num_cycles_at_cps_change: 0,
      seconds_at_cps_change: 0,
      num_ticks_since_cps_change: 5,
      pattern: null,
      ...scheduler,
    },
    setPattern: vi.fn((pattern) => {
      r.scheduler.pattern = editPattern(pattern) || pattern;
      return Promise.resolve(r.scheduler.pattern);
    }),
  };
  return r;
}

const fakeController = () => {
  const c = { insert: null };
  c.setPreGainInsert = (node) => (c.insert = node);
  c.getPreGainInsert = () => c.insert;
  return c;
};

describe('PatternOffset (2.1)', () => {
  const kick = sequence('bd', 'sd', 'hh', 'cp'); // onsets 0, .25, .5, .75

  it('offset 0 returns the very same pattern object (plain playback untouched), with or without the 017 hook', () => {
    const offset = new PatternOffset();
    expect(offset.editPattern(kick)).toBe(kick);
    const tc = new TrackTransitionController({ repl: fakeRepl(() => {}) });
    expect(offset.editPattern(kick, tc.editPattern)).toBe(kick);
  });

  it('a shift moves the scheduled pattern late by the offset, composed with the spec 017 origin (sum)', () => {
    let repl;
    const tc = new TrackTransitionController({ repl: { scheduler: {} } });
    tc.origin = 3; // the track was switched in at cycle 3
    const offset = new PatternOffset({ getRepl: () => repl });
    const edit = (p) => offset.editPattern(p, tc.editPattern);
    repl = fakeRepl(edit);
    repl.setPattern(kick); // an evaluate
    expect(onsets(repl.scheduler.pattern)).toEqual(onsets(kick.late(3)));

    expect(offset.shift(0.5)).toBe(true); // 2 beats at cps 0.5 → 1 s · 0.5
    expect(offset.cycles).toBe(0.5);
    expect(onsets(repl.scheduler.pattern)).toEqual(onsets(kick.late(3.5)));
    expect(tc.origin).toBe(3); // the 017 origin is not overwritten
    // It re-set the raw pattern without autostart.
    expect(repl.setPattern).toHaveBeenLastCalledWith(kick, false);
  });

  it('a same-track Update (idle re-evaluate) keeps the offset; stop resets it to 0', () => {
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    repl = fakeRepl((p) => offset.editPattern(p));
    repl.setPattern(kick);
    offset.shift(0.25);
    const updated = sequence('bd', 'bd');
    repl.setPattern(updated); // Update with (new) code of the same track
    expect(onsets(repl.scheduler.pattern)).toEqual(onsets(updated.late(0.25)));
    offset.reset();
    expect(offset.editPattern(updated)).toBe(updated);
  });

  it('a track switch (busy at editPattern) drops the offset: the new track starts at its own cycle 0', () => {
    let busy = false;
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl, isBusy: () => busy });
    repl = fakeRepl((p) => offset.editPattern(p));
    repl.setPattern(kick);
    offset.shift(0.5);
    busy = true;
    const next = sequence('a', 'b');
    expect(repl.setPattern(next) && repl.scheduler.pattern).toBe(next);
    expect(offset.cycles).toBe(0);
  });

  it('negative pairs: refused while a switch is busy, while stopped, without a pattern, or for junk', () => {
    let busy = true;
    let repl = fakeRepl((p) => offset.editPattern(p));
    const offset = new PatternOffset({ getRepl: () => repl, isBusy: () => busy });
    expect(offset.shift(0.5)).toBe(false); // no pattern yet
    repl.setPattern(kick);
    expect(offset.shift(0.5)).toBe(false); // busy
    busy = false;
    repl.scheduler.started = false;
    expect(offset.shift(0.5)).toBe(false); // stopped
    repl.scheduler.started = true;
    expect(offset.shift(NaN)).toBe(false);
    expect(offset.shift(0)).toBe(false);
    expect(offset.cycles).toBe(0);
    repl = null;
    expect(offset.shift(0.5)).toBe(false);
  });
});

describe('scratchShiftTime', () => {
  it('is the context time of the scheduler query end plus latency', () => {
    const s = { lastEnd: 10.5, num_cycles_at_cps_change: 10, seconds_at_cps_change: 20, cps: 0.5, latency: 0.1 };
    expect(scratchShiftTime(s, 20.5)).toBeCloseTo(21.1, 12);
  });
  it('right after a tempo change it anchors on the next tick; without the fields an upper bound', () => {
    const s = { num_ticks_since_cps_change: 0, clock: { getPhase: () => 30 }, latency: 0.1, lastEnd: 12, cps: 0.5 };
    expect(scratchShiftTime(s, 29.9)).toBeCloseTo(30.1, 12);
    expect(scratchShiftTime({}, 5)).toBeCloseTo(5.35, 12);
    expect(scratchShiftTime({ lastEnd: 0, num_cycles_at_cps_change: 0, seconds_at_cps_change: 0, cps: 1 }, 9)).toBe(9);
  });
});

describe('ScratchHandOver and ScratchDeck (2.2, 2.3)', () => {
  let ac;
  let warn;
  beforeEach(() => {
    stubWebAudio();
    ac = new AudioContext();
    ac.currentTime = 20;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    unstubWebAudio();
  });

  async function setup({ blocked = () => false, voiceIds = ['v1', 'v2'] } = {}) {
    const deck = new ScratchDeck(ac, fakeController());
    await deck.attach();
    const node = ac.workletNodes.at(-1);
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    repl = fakeRepl((p) => offset.editPattern(p), {
      lastEnd: 40.25,
      num_cycles_at_cps_change: 40,
      seconds_at_cps_change: 20,
    });
    repl.setPattern(sequence('bd', 'sd'));
    const voices = { getActiveSoundIds: vi.fn(() => voiceIds), releaseSounds: vi.fn() };
    const handOver = new ScratchHandOver(deck, { getRepl: () => repl, offset, voices, isBlocked: blocked });
    return { deck, node, repl, offset, voices, handOver };
  }

  /** Grab, release, and play the worklet's lagSettled for that release. */
  function settle(deck, node, lagSeconds) {
    deck.grab();
    deck.release();
    const id = node.port.posted.at(-1).id;
    node.port.reply({ type: 'lagSettled', id, lagSeconds });
    return id;
  }

  it('release sends the snap beat from the repl tempo (0.25 cycle / cps), or 0 with snap off', async () => {
    const { deck, node } = await setup();
    deck.grab();
    deck.release();
    expect(node.port.posted.at(-1)).toEqual({ type: 'release', id: 1, beatSeconds: 0.5 });
    deck.snap = false;
    deck.grab();
    deck.release();
    // The grab during release 1's spin-up took it over (id 2), so this release is id 3.
    expect(node.port.posted.at(-1)).toEqual({ type: 'release', id: 3, beatSeconds: 0 });
  });

  it('lagSettled: the offset grows by D·cps, the stale voices fade out by the shift time, and the hand-over is sent', async () => {
    const { deck, node, offset, voices, repl } = await setup();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const id = settle(deck, node, 1); // 2 beats at 120 bpm
    expect(offset.cycles).toBe(0.5);
    expect(repl.setPattern).toHaveBeenLastCalledWith(expect.anything(), false);
    // Shift time: (40.25 − 40) / 0.5 + 20 + 0.1 latency = 20.6 s.
    expect(voices.releaseSounds).toHaveBeenCalledTimes(1);
    const [ids, end, start] = voices.releaseSounds.mock.calls[0];
    expect(ids).toEqual(['v1', 'v2']);
    expect(end).toBeCloseTo(20.6, 9);
    expect(start).toBeCloseTo(20.57, 9);
    const msg = node.port.posted.at(-1);
    expect(msg).toMatchObject({ type: 'handOver', id });
    expect(msg.at).toBeCloseTo(20.605, 9);
    expect(deck.phase).toBe('live');
    // Synchronous: nothing left pending on the main thread.
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('negative pair: a lagSettled for an older release (taken over by a grab) is ignored', async () => {
    const { deck, node, offset, voices } = await setup();
    deck.grab();
    deck.release();
    const stale = node.port.posted.at(-1).id;
    deck.grab(); // grabbed again during the spin-up
    node.port.reply({ type: 'lagSettled', id: stale, lagSeconds: 1 });
    expect(offset.cycles).toBe(0);
    expect(voices.releaseSounds).not.toHaveBeenCalled();
    expect(node.port.posted.some((m) => m.type === 'handOver')).toBe(false);
  });

  it('trap: an Update or switch mid-release (releaseAll) cancels it synchronously; the late lagSettled applies nothing', async () => {
    const { deck, node, offset, voices } = await setup();
    const scratch = new ScratchController();
    scratch.setDeck('main', deck);
    scratch.grab('pointer');
    scratch.release('pointer');
    const id = node.port.posted.at(-1).id;
    expect(deck.phase).toBe('releasing');
    scratch.releaseAll(); // runUpdate → beforeUpdate, beforeEval, onToggle
    expect(node.port.posted.at(-1)).toEqual({ type: 'abort' });
    expect(deck.phase).toBe('live');
    // The worklet had already settled before it got the abort: its message arrives late.
    node.port.reply({ type: 'lagSettled', id, lagSeconds: 1 });
    expect(offset.cycles).toBe(0);
    expect(voices.releaseSounds).not.toHaveBeenCalled();
    expect(node.port.posted.filter((m) => m.type === 'handOver')).toEqual([]);
  });

  it('a settled deck (shift applied, hand-over scheduled) is not aborted by releaseAll: it completes in the worklet', async () => {
    const { deck, node, offset } = await setup();
    const scratch = new ScratchController();
    scratch.setDeck('main', deck);
    settle(deck, node, 1);
    const posted = node.port.posted.length;
    scratch.releaseAll();
    expect(node.port.posted.length).toBe(posted); // no abort, no new message
    expect(offset.cycles).toBe(0.5);
  });

  it('rule 2.3: during a spec 017 transition the settled lag is not applied; the deck goes back to live', async () => {
    const { deck, node, offset, voices } = await setup({ blocked: () => true });
    settle(deck, node, 1);
    expect(offset.cycles).toBe(0);
    expect(voices.getActiveSoundIds).not.toHaveBeenCalled();
    expect(node.port.posted.at(-1)).toEqual({ type: 'abort' });
  });

  it('a deck without a listener (or a refused shift) goes back to live by itself', async () => {
    const deck = new ScratchDeck(ac, fakeController());
    await deck.attach();
    const node = ac.workletNodes.at(-1);
    deck.grab();
    deck.release();
    node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 });
    expect(node.port.posted.at(-1)).toEqual({ type: 'abort' });
  });

  it('stop: abort drops a spin-up (the next lagSettled is ignored); a held deck stays held', async () => {
    const { deck, node, offset } = await setup();
    deck.grab();
    deck.abort();
    expect(node.port.posted.at(-1)).toEqual({ type: 'grab' });
    deck.release();
    const id = node.port.posted.at(-1).id;
    deck.abort();
    node.port.reply({ type: 'lagSettled', id, lagSeconds: 1 });
    expect(offset.cycles).toBe(0);
  });

  it('only this deck: two decks with their own offsets and voices; a shift on one leaves the other untouched', async () => {
    const a = await setup({ voiceIds: ['main-1'] });
    const b = await setup({ voiceIds: ['preview-1'] });
    settle(b.deck, b.node, 0.5);
    expect(b.offset.cycles).toBe(0.25);
    expect(a.offset.cycles).toBe(0);
    expect(b.voices.releaseSounds.mock.calls[0][0]).toEqual(['preview-1']);
    expect(a.voices.getActiveSoundIds).not.toHaveBeenCalled();
    expect(a.voices.releaseSounds).not.toHaveBeenCalled();
  });

  it('destroy stops listening', async () => {
    const { deck, node, offset, handOver } = await setup();
    handOver.destroy();
    deck.grab();
    deck.release();
    expect(node.port.posted.at(-1).beatSeconds).toBe(0); // no tempo source any more
    node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 });
    expect(offset.cycles).toBe(0);
  });
});

describe('PreviewEngine: the headphone deck has its own offset (2.5)', () => {
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

  function deps(captured, voices) {
    class FakeSuperdoughController {
      constructor(ctx) {
        const destinationGain = ctx.createGain();
        destinationGain.gain = createAudioParam(1);
        this.output = { destinationGain };
        this.insert = null;
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
      voices,
      repl: (options) => {
        captured.options = options;
        const r = fakeRepl((p) => options.editPattern(p), {
          lastEnd: 4,
          num_cycles_at_cps_change: 4,
          seconds_at_cps_change: 0,
        });
        r.evaluate = vi.fn();
        r.stop = vi.fn(() => options.onToggle(false));
        captured.repl = r;
        return r;
      },
      getTime: () => 0,
    };
  }

  it('its repl gets the offset hook; a settled scratch shifts only it, releasing only its own voices', async () => {
    const ac = new AudioContext();
    const captured = {};
    const voices = {
      getActiveSoundIds: vi.fn((owner) => [`of-${owner === engine.controller}`]),
      releaseSounds: vi.fn(),
    };
    const engine = new PreviewEngine(ac, deps(captured, voices));
    await engine.initialize();
    const kick = sequence('bd', 'sd');
    expect(captured.options.editPattern(kick)).toBe(kick); // offset 0: untouched
    captured.repl.setPattern(kick);
    const deck = await engine.ensureScratchDeck();
    const node = ac.workletNodes.at(-1);
    deck.grab();
    deck.release();
    expect(node.port.posted.at(-1).beatSeconds).toBe(0.5); // the preview repl's tempo
    node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 });
    expect(engine.scratchOffset.cycles).toBe(0.5);
    expect(onsets(captured.repl.scheduler.pattern)).toEqual(onsets(kick.late(0.5)));
    expect(voices.getActiveSoundIds).toHaveBeenCalledWith(engine.controller);
    expect(voices.releaseSounds.mock.calls[0][0]).toEqual(['of-true']);
    engine.destroy();
  });

  it('stop resets the offset and drops a spin-up', async () => {
    const ac = new AudioContext();
    const captured = {};
    const engine = new PreviewEngine(ac, deps(captured, { getActiveSoundIds: () => [], releaseSounds: vi.fn() }));
    await engine.initialize();
    captured.repl.setPattern(sequence('bd'));
    const deck = await engine.ensureScratchDeck();
    const node = ac.workletNodes.at(-1);
    deck.grab();
    deck.release();
    node.port.reply({ type: 'lagSettled', id: deck.releaseId, lagSeconds: 1 });
    expect(engine.scratchOffset.cycles).toBe(0.5);
    deck.grab();
    deck.release(); // spinning up again
    engine.stop();
    expect(engine.scratchOffset.cycles).toBe(0);
    expect(node.port.posted.at(-1)).toEqual({ type: 'abort' });
    engine.destroy();
  });
});
