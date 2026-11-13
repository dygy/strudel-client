/**
 * superdough fork addition for spec 008 (setOutputInsert): the main output can play into an insert
 * (the main EQ) instead of audioContext.destination, and the insert survives reset(), which
 * resetGlobalEffects() runs and which rebuilds destinationGain. Without an insert nothing changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuperdoughAudioController, OUTPUT_INSERT_FADE_TIME } from 'superdough';
import { MockAudioContext, stubWebAudio, stubWebAudioNodeConstructors, unstubWebAudio } from './webAudioMock.mjs';

describe('SuperdoughAudioController.setOutputInsert (spec 008)', () => {
  let ac;
  let controller;
  let insert;

  beforeEach(() => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ac = new MockAudioContext();
    controller = new SuperdoughAudioController(ac);
    insert = ac.createGain(); // the main EQ's input
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubWebAudio();
  });

  const destinationGain = () => controller.output.destinationGain;
  /** Spec 020: a swap while playing fades and then puts the bare edge back on a timer. */
  const set = (node) => {
    controller.setOutputInsert(node);
    vi.runOnlyPendingTimers();
  };

  it('without an insert, destinationGain plays into the destination (upstream behaviour)', () => {
    expect(destinationGain().connections).toEqual([ac.destination]);
  });

  it('with an insert, destinationGain plays into the insert and not into the destination', () => {
    set(insert);
    expect(destinationGain().connections).toEqual([insert]);
    expect(destinationGain().connections).not.toContain(ac.destination);
  });

  it('the insert survives reset(): the rebuilt destinationGain plays into it, not the destination', () => {
    set(insert);
    const before = destinationGain();
    controller.reset();
    expect(destinationGain()).not.toBe(before);
    expect(destinationGain().connections).toEqual([insert]);
    // The old destinationGain is not left connected anywhere (no leaked path around the EQ).
    expect(before.connections).toEqual([]);
  });

  it('null restores the destination, also after a reset', () => {
    set(insert);
    set(null);
    expect(destinationGain().connections).toEqual([ac.destination]);
    controller.reset();
    expect(destinationGain().connections).toEqual([ac.destination]);
  });

  it('the destination itself as the insert keeps the output connected (same as null)', () => {
    set(ac.destination);
    expect(destinationGain().connections).toEqual([ac.destination]);
    expect(controller.output.outputInsert).toBeNull();

    set(insert);
    set(ac.destination);
    expect(destinationGain().connections).toEqual([ac.destination]);
    controller.reset();
    expect(destinationGain().connections).toEqual([ac.destination]);
  });

  it('installing the same insert twice connects it once', () => {
    set(insert);
    set(insert);
    expect(destinationGain().connections).toEqual([insert]);
  });

  // Spec 020: the direct path and the EQ path differ by the EQ's 6 ms look-ahead, so an instant switch
  // while playing jumps (a click). The swap fades through switch gains after destinationGain.
  describe('a swap while playing is click-free (spec 020)', () => {
    const ramps = (param) => param.calls.filter(([m]) => m === 'linearRampToValueAtTime');
    const switches = () => [...controller.output.outputSwitches.values()];
    // Labels, not nodes: a failing toEqual over linked mock nodes takes minutes to print.
    const label = (n) =>
      n === ac.destination ? 'destination' : n === insert ? 'insert' : switches().includes(n) ? 'switch' : 'other';
    const to = (node) => node.connections.map(label);

    it('fades the direct path out, then the insert in, each over OUTPUT_INSERT_FADE_TIME', () => {
      ac.currentTime = 2;
      const silentAfter = controller.setOutputInsert(insert);

      expect(silentAfter).toBe(OUTPUT_INSERT_FADE_TIME);
      const [toDestination, toInsert] = switches();
      expect(to(toDestination)).toEqual(['destination']);
      expect(to(toInsert)).toEqual(['insert']);
      expect(to(destinationGain())).toEqual(['switch', 'switch']); // no bare edge around them
      expect(ramps(toDestination.gain)).toEqual([['linearRampToValueAtTime', 0, 2 + OUTPUT_INSERT_FADE_TIME]]);
      expect(ramps(toInsert.gain)).toEqual([['linearRampToValueAtTime', 1, 2 + 2 * OUTPUT_INSERT_FADE_TIME]]);
      // the insert path holds silent until the direct path is gone
      expect(toInsert.gain.calls).toContainEqual(['setValueAtTime', 0, 2 + OUTPUT_INSERT_FADE_TIME]);
    });

    it('never touches destinationGain, so the recorders and transitions tapping it hear no change', () => {
      const gainCalls = destinationGain().gain.calls.length;
      controller.setOutputInsert(insert);
      controller.setOutputInsert(null);
      vi.runOnlyPendingTimers();
      expect(destinationGain().gain.calls).toHaveLength(gainCalls);
    });

    it('once settled the switch gains are gone (both edges) and the bare edge is back', () => {
      controller.setOutputInsert(insert);
      const used = switches();
      vi.runOnlyPendingTimers();

      expect(controller.output.outputSwitches.size).toBe(0);
      expect(to(destinationGain())).toEqual(['insert']);
      used.forEach((sw) => expect(sw.connections.length).toBe(0));
    });

    it('removing the insert fades back to the destination the same way', () => {
      set(insert);
      ac.currentTime = 5;
      expect(controller.setOutputInsert(null)).toBe(OUTPUT_INSERT_FADE_TIME);
      const [fromInsert, toDestination] = switches();
      expect(to(fromInsert)).toEqual(['insert']);
      expect(ramps(fromInsert.gain)).toEqual([['linearRampToValueAtTime', 0, 5 + OUTPUT_INSERT_FADE_TIME]]);
      expect(ramps(toDestination.gain)).toEqual([['linearRampToValueAtTime', 1, 5 + 2 * OUTPUT_INSERT_FADE_TIME]]);
      vi.runOnlyPendingTimers();
      expect(to(destinationGain())).toEqual(['destination']);
    });

    it('with the context not running (nothing playing) the switch is immediate', () => {
      ac.state = 'suspended';
      expect(controller.setOutputInsert(insert)).toBe(0);
      expect(to(destinationGain())).toEqual(['insert']);
      expect(controller.output.outputSwitches.size).toBe(0);
    });

    it('a reset() during a swap leaves only the bare edge into the insert', () => {
      controller.setOutputInsert(insert);
      controller.reset();
      vi.runOnlyPendingTimers();
      expect(to(destinationGain())).toEqual(['insert']);
      expect(controller.output.outputSwitches.size).toBe(0);
    });
  });

  // Spec 020: the EQ's multichannel limiter is sized for the output's channels, which a reset changes.
  describe('onChannelCount (spec 020)', () => {
    it('is called with the destination channel count whenever reset() rebuilds the output', () => {
      const counts = [];
      controller.setOutputInsert(insert, { onChannelCount: (n) => counts.push(n) });
      ac.destination.maxChannelCount = 6; // a sink whose channel count is known late
      controller.reset();
      expect(counts).toEqual([6]);
    });

    it('is not called after the insert is removed', () => {
      const counts = [];
      controller.setOutputInsert(insert, { onChannelCount: (n) => counts.push(n) });
      controller.setOutputInsert(null);
      controller.reset();
      expect(counts).toEqual([]);
    });
  });

  it('orbits still reach destinationGain through the merger (taps on destinationGain stay pre-insert)', () => {
    set(insert);
    controller.getOrbit(1);
    expect(controller.output.channelMerger.connections).toEqual([destinationGain()]);
  });
});
