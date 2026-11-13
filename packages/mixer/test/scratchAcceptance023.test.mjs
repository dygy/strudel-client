/**
 * @spec: 023-vinyl-scratch-realism (functional-spec §2.1, §2.3, §2.4, §2.5; task 4.1)
 *
 * Acceptance criteria end to end, through the real pieces: a ScratchDeck on the Web Audio mock
 * whose port is bridged to a real ScratchDsp (the worklet's message adapter, done by hand, as in
 * scratchProcessor.mjs), a real ScratchHandOver and PatternOffset, real @strudel/core Patterns,
 * and a fake repl that does what core's does (setPattern → editPattern → scheduler.pattern).
 *
 * - 2.1: a keyboard scratch (setMotor, Alt+Shift+←/→) right after the grab is heard both ways.
 * - 2.3: a 4-beat loop held still for 2 beats ends up with its kick on beat 3.
 * - 2.4: a hold that leaves the record ~1.8 beats behind lands on 2 beats with Snap on, and stays
 *   at 1.8 beats (off the grid) with Snap off.
 * - 2.5: a scratch on one deck never moves the other, both ways.
 * - Strudel rules: the code is never re-evaluated by a scratch, and a scratch held when Update,
 *   a track switch or stop comes is let go and its lag is never applied.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sequence, silence } from '@strudel/core';
import { ScratchDsp } from '../scratch/scratchDsp.mjs';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { ScratchController } from '../scratch/ScratchController.mjs';
import { PatternOffset, ScratchHandOver } from '../scratch/ScratchShift.mjs';
import { PreviewEngine } from '../PreviewEngine.mjs';
import { stubWebAudio, unstubWebAudio, createAudioParam } from './webAudioMock.mjs';

const SR = 48000;
const BLOCK = 128;
const CPS = 0.5; // one beat (a quarter cycle) = 0.5 s
const BEAT = 0.25 / CPS;
const blocksFor = (seconds) => Math.ceil((seconds * SR) / BLOCK);
const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length));
const sine =
  (f, a = 0.5) =>
  (n) =>
    a * Math.sin((2 * Math.PI * f * n) / SR);

/** Onsets (cycle positions) of a pattern within [0, 2). */
const onsets = (pat) =>
  pat
    .queryArc(0, 2)
    .filter((h) => h.hasOnset())
    .map((h) => h.whole.begin.valueOf())
    .sort((a, b) => a - b);

/** The value that sounds at cycle 0. */
const firstValue = (pat) => pat.queryArc(0, 0.01).find((h) => h.hasOnset())?.value;

const fakeController = () => {
  const c = { insert: null };
  c.setPreGainInsert = (node) => (c.insert = node);
  c.getPreGainInsert = () => c.insert;
  return c;
};

/**
 * A repl like core's. The scheduler's query end follows the context clock, so the shifted audio
 * starts 0.15 s after "now" (0.05 s already queried plus 0.1 s latency).
 */
function fakeRepl(editPattern, ac, code = 's("bd ~ ~ ~")') {
  const r = {
    code,
    evaluate: vi.fn(),
    setCode: vi.fn(),
    scheduler: {
      started: true,
      cps: CPS,
      latency: 0.1,
      num_cycles_at_cps_change: 0,
      seconds_at_cps_change: 0,
      num_ticks_since_cps_change: 5,
      get lastEnd() {
        return (ac.currentTime + 0.05) * CPS;
      },
      pattern: null,
    },
    setPattern: vi.fn((pattern) => {
      r.scheduler.pattern = editPattern(pattern) || pattern;
      return Promise.resolve(r.scheduler.pattern);
    }),
  };
  return r;
}

/**
 * Bridges a ScratchDeck's mock port to a real ScratchDsp, like the worklet: posted messages go to
 * the DSP, the DSP's events come back through the port. The context clock follows the DSP clock.
 */
function bridge(ac, node, fn = sine(220)) {
  const dsp = new ScratchDsp(SR, 2);
  let cursor = 0;
  const out = [];
  const events = [];
  const deliver = () => {
    while (cursor < node.port.posted.length) {
      const m = node.port.posted[cursor++];
      if (m.type === 'grab') dsp.grab();
      else if (m.type === 'move') dsp.moveBy(m.delta);
      else if (m.type === 'motor') dsp.setMotor(m.rate);
      else if (m.type === 'release') dsp.release({ id: m.id, beatSeconds: m.beatSeconds });
      else if (m.type === 'handOver') dsp.handOver(m.id, Math.round(m.at * SR));
      else if (m.type === 'abort') dsp.abort();
    }
  };
  const run = (blocks, onBlock) => {
    const start = out.length;
    for (let b = 0; b < blocks; b++) {
      onBlock?.(b);
      deliver();
      const l = new Float32Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) l[i] = fn(dsp.n + i);
      const o = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      dsp.process([l, l], o, BLOCK);
      for (let i = 0; i < BLOCK; i++) out.push(o[0][i]);
      ac.currentTime = dsp.n / SR;
      const e = dsp.takeEvent();
      if (e === 'lagSettled') {
        events.push({ type: e, lagSeconds: dsp.eventLagSeconds });
        node.port.reply({ type: 'lagSettled', id: dsp.eventId, lagSeconds: dsp.eventLagSeconds });
      } else if (e === 'idle') {
        events.push({ type: e });
        node.port.reply({ type: 'idle', id: dsp.eventId });
      }
    }
    deliver();
    return out.slice(start);
  };
  return { dsp, run, events };
}

describe('023 acceptance: the decks, end to end', () => {
  let ac;
  let warn;
  let log;
  beforeEach(() => {
    stubWebAudio();
    ac = new AudioContext();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    log.mockRestore();
    unstubWebAudio();
  });

  /** The speakers deck as the website wires it: deck, offset, hand-over, repl. */
  async function speakers({ snap = true } = {}) {
    const deck = new ScratchDeck(ac, fakeController());
    await deck.attach();
    deck.snap = snap;
    const node = ac.workletNodes.at(-1);
    let repl;
    const offset = new PatternOffset({ getRepl: () => repl });
    repl = fakeRepl((p) => offset.editPattern(p), ac);
    const voices = { getActiveSoundIds: vi.fn(() => ['main-voice']), releaseSounds: vi.fn() };
    const handOver = new ScratchHandOver(deck, { getRepl: () => repl, offset, voices });
    const kick = sequence('bd', silence, silence, silence); // a 4-beat loop, kick on beat 1
    repl.setPattern(kick); // the user's evaluate
    const b = bridge(ac, node);
    b.run(blocksFor(2)); // 2 s of playing fills the ring
    return { deck, node, repl, offset, voices, handOver, kick, ...b };
  }

  /** Grab, hold still for `holdSeconds`, let go, and play until back to live. */
  function holdAndRelease(s, holdSeconds) {
    s.deck.grab();
    s.run(blocksFor(holdSeconds));
    s.deck.release();
    s.run(blocksFor(4));
  }

  describe('2.1 the sound follows the hand: the keyboard (setMotor) right after the grab', () => {
    it('Alt+Shift+→ (motor +1) straight after the grab is heard; Alt+Shift+← (motor −1) too', async () => {
      const s = await speakers();
      s.deck.grab();
      s.run(blocksFor(0.3)); // the brake is over, the record held still: lag ≈ 0.25 s
      expect(rms(s.run(blocksFor(0.05)))).toBeLessThan(1e-3); // held still: silent
      s.deck.setMotor(1);
      const forwards = s.run(blocksFor(0.1)).slice(Math.round(0.015 * SR));
      expect(rms(forwards)).toBeGreaterThan(0.2);
      s.deck.setMotor(-1);
      const backwards = s.run(blocksFor(0.1)).slice(Math.round(0.015 * SR));
      expect(rms(backwards)).toBeGreaterThan(0.2);
    });

    it('negative pair: motor 0 (the key let go while the record is held) is silent', async () => {
      const s = await speakers();
      s.deck.grab();
      s.run(blocksFor(0.15));
      s.deck.setMotor(1);
      s.run(blocksFor(0.1));
      s.deck.setMotor(0);
      s.run(blocksFor(0.15)); // the stylus gain and the DC blocker settle
      expect(rms(s.run(blocksFor(0.1)))).toBeLessThan(1e-3);
    });
  });

  describe('2.3 the track continues from where the record is', () => {
    it('a 4-beat loop held still for exactly 2 beats: the kick lands where beat 3 was, and live takes over', async () => {
      const s = await speakers();
      holdAndRelease(s, 2 * BEAT);
      expect(s.events.map((e) => e.type)).toEqual(['lagSettled', 'idle']);
      expect(s.events[0].lagSeconds).toBeCloseTo(2 * BEAT, 4);
      expect(s.offset.cycles).toBeCloseTo(0.5, 4);
      expect(onsets(s.repl.scheduler.pattern).map((x) => +x.toFixed(4))).toEqual([0.5, 1.5]);
      // Back to live: the deck and the worklet are idle, the stale voices were let go.
      expect(s.deck.phase).toBe('live');
      expect(s.dsp.phase).toBe('live');
      expect(s.voices.releaseSounds).toHaveBeenCalledWith(['main-voice'], expect.any(Number), expect.any(Number));
    });

    it('negative pair: a grab and an immediate let-go (no hold) leaves the track where it was', async () => {
      const s = await speakers();
      s.deck.grab();
      s.deck.release();
      s.run(blocksFor(4));
      expect(s.events.map((e) => e.type)).toEqual(['idle']);
      expect(s.offset.cycles).toBe(0);
      expect(s.repl.scheduler.pattern).toBe(s.kick);
      expect(s.voices.releaseSounds).not.toHaveBeenCalled();
    });

    it('rule: code and saved work are never touched; the scratch re-sets the same evaluated pattern only', async () => {
      const s = await speakers();
      const setsBefore = s.repl.setPattern.mock.calls.length;
      holdAndRelease(s, 2 * BEAT);
      expect(s.repl.evaluate).not.toHaveBeenCalled();
      expect(s.repl.setCode).not.toHaveBeenCalled();
      expect(s.repl.code).toBe('s("bd ~ ~ ~")');
      const calls = s.repl.setPattern.mock.calls.slice(setsBefore);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe(s.kick); // the very pattern the user's evaluate produced
      expect(calls[0][1]).toBe(false); // no autostart
    });
  });

  describe('2.4 Snap to beat', () => {
    // Held 0.75 s: the brake carries the record 0.05 s, the spin-up loses 0.2 s, so the record
    // ends 0.9 s = 1.8 beats behind.
    const HOLD = 0.75;

    it('snap on: a record ~1.8 beats behind lands exactly 2 beats behind, kick on the grid', async () => {
      const s = await speakers({ snap: true });
      holdAndRelease(s, HOLD);
      expect(s.events[0].lagSeconds).toBeCloseTo(2 * BEAT, 4);
      expect(s.offset.cycles).toBeCloseTo(0.5, 4);
      const kicks = onsets(s.repl.scheduler.pattern);
      for (const k of kicks) expect(Math.abs(k / 0.25 - Math.round(k / 0.25))).toBeLessThan(1e-3);
    });

    it('snap off: the same hold stays 1.8 beats behind, off the grid', async () => {
      const s = await speakers({ snap: false });
      holdAndRelease(s, HOLD);
      expect(s.events[0].lagSeconds / BEAT).toBeCloseTo(1.8, 1);
      expect(s.offset.cycles).toBeCloseTo(0.45, 2);
      const [kick] = onsets(s.repl.scheduler.pattern);
      expect(Math.abs(kick / 0.25 - Math.round(kick / 0.25))).toBeGreaterThan(0.1);
    });
  });

  describe('2.5 both decks: a scratch on one never moves the other', () => {
    function previewDeps(captured, voices) {
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
          const r = fakeRepl((p) => options.editPattern(p), captured.ac);
          r.stop = vi.fn(() => options.onToggle(false));
          captured.repl = r;
          return r;
        },
        getTime: () => 0,
      };
    }

    /** Speakers and headphones, each with its own context, routed by one ScratchController. */
    async function bothDecks() {
      const main = await speakers();
      const previewAc = new AudioContext();
      const captured = { ac: previewAc };
      const previewVoices = { getActiveSoundIds: vi.fn(() => ['preview-voice']), releaseSounds: vi.fn() };
      const engine = new PreviewEngine(previewAc, previewDeps(captured, previewVoices));
      await engine.initialize();
      const hats = sequence('a', 'b', 'c', 'd'); // each beat tells itself apart
      captured.repl.setPattern(hats);
      const previewDeck = await engine.ensureScratchDeck();
      const preview = bridge(previewAc, previewAc.workletNodes.at(-1));
      preview.run(blocksFor(2));
      const scratch = new ScratchController();
      scratch.setDeck('main', main.deck);
      scratch.setDeck('preview', previewDeck);
      return { main, preview, previewRepl: captured.repl, previewVoices, engine, hats, scratch };
    }

    /** Scratch the selected deck via the controller: hold 2 beats, let go, play both decks. */
    function scratchSelected({ main, preview, scratch }) {
      scratch.grab('pointer');
      for (let i = 0; i < blocksFor(2 * BEAT); i++) {
        main.run(1);
        preview.run(1);
      }
      scratch.release('pointer');
      for (let i = 0; i < blocksFor(4); i++) {
        main.run(1);
        preview.run(1);
      }
    }

    it('scratching the headphones moves only the headphone track; the speakers play on unchanged', async () => {
      const d = await bothDecks();
      d.scratch.selected = 'preview';
      scratchSelected(d);
      expect(d.engine.scratchOffset.cycles).toBeCloseTo(0.5, 4);
      expect(firstValue(d.previewRepl.scheduler.pattern)).toBe('c'); // 2 beats later: beat 3 at cycle 0
      // The speakers: no offset, the same pattern object, no voice released, never grabbed.
      expect(d.main.offset.cycles).toBe(0);
      expect(d.main.repl.scheduler.pattern).toBe(d.main.kick);
      expect(d.main.voices.getActiveSoundIds).not.toHaveBeenCalled();
      expect(d.main.events).toEqual([]);
      expect(d.main.node.port.posted.some((m) => m.type === 'grab')).toBe(false);
      d.engine.destroy();
    });

    it('the reverse: scratching the speakers moves only the speakers track; the headphones play on unchanged', async () => {
      const d = await bothDecks();
      d.scratch.selected = 'main';
      scratchSelected(d);
      expect(d.main.offset.cycles).toBeCloseTo(0.5, 4);
      expect(d.engine.scratchOffset.cycles).toBe(0);
      expect(d.previewRepl.scheduler.pattern).toBe(d.hats);
      expect(d.previewVoices.getActiveSoundIds).not.toHaveBeenCalled();
      expect(d.preview.events).toEqual([]);
      d.engine.destroy();
    });
  });

  describe('rule: a scratch in progress is let go on Update, track switch and stop (releaseAll)', () => {
    it('held when Update comes: let go, the spin-up cancelled, and its lag never applied', async () => {
      const s = await speakers();
      const scratch = new ScratchController();
      scratch.setDeck('main', s.deck);
      scratch.grab('pointer');
      s.run(blocksFor(2 * BEAT)); // the record is 2 beats behind and still held
      scratch.releaseAll(); // scratchReplHooks: beforeUpdate / beforeEval / onToggle
      expect(s.deck.isGrabbed).toBe(false);
      expect(s.node.port.posted.slice(-2).map((m) => m.type)).toEqual(['release', 'abort']);
      s.repl.setPattern(s.kick); // the Update's evaluate
      s.run(blocksFor(4));
      expect(s.events.map((e) => e.type)).toEqual(['idle']);
      expect(s.offset.cycles).toBe(0);
      expect(s.repl.scheduler.pattern).toBe(s.kick);
      expect(s.dsp.phase).toBe('live');
    });

    it('negative pair: without releaseAll, the same held scratch does shift the track when let go', async () => {
      const s = await speakers();
      const scratch = new ScratchController();
      scratch.setDeck('main', s.deck);
      scratch.grab('pointer');
      s.run(blocksFor(2 * BEAT));
      scratch.release('pointer');
      s.run(blocksFor(4));
      expect(s.offset.cycles).toBeCloseTo(0.5, 4);
    });
  });
});
