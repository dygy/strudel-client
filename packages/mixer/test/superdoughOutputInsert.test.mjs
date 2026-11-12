/**
 * superdough fork addition for spec 008 (setOutputInsert): the main output can play into an insert
 * (the main EQ) instead of audioContext.destination, and the insert survives reset(), which
 * resetGlobalEffects() runs and which rebuilds destinationGain. Without an insert nothing changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SuperdoughAudioController } from 'superdough';
import { MockAudioContext, stubWebAudio, stubWebAudioNodeConstructors, unstubWebAudio } from './webAudioMock.mjs';

describe('SuperdoughAudioController.setOutputInsert (spec 008)', () => {
  let ac;
  let controller;
  let insert;

  beforeEach(() => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    ac = new MockAudioContext();
    controller = new SuperdoughAudioController(ac);
    insert = ac.createGain(); // the main EQ's input
  });
  afterEach(() => unstubWebAudio());

  const destinationGain = () => controller.output.destinationGain;

  it('without an insert, destinationGain plays into the destination (upstream behaviour)', () => {
    expect(destinationGain().connections).toEqual([ac.destination]);
  });

  it('with an insert, destinationGain plays into the insert and not into the destination', () => {
    controller.setOutputInsert(insert);
    expect(destinationGain().connections).toEqual([insert]);
    expect(destinationGain().connections).not.toContain(ac.destination);
  });

  it('the insert survives reset(): the rebuilt destinationGain plays into it, not the destination', () => {
    controller.setOutputInsert(insert);
    const before = destinationGain();
    controller.reset();
    expect(destinationGain()).not.toBe(before);
    expect(destinationGain().connections).toEqual([insert]);
    // The old destinationGain is not left connected anywhere (no leaked path around the EQ).
    expect(before.connections).toEqual([]);
  });

  it('null restores the destination, also after a reset', () => {
    controller.setOutputInsert(insert);
    controller.setOutputInsert(null);
    expect(destinationGain().connections).toEqual([ac.destination]);
    controller.reset();
    expect(destinationGain().connections).toEqual([ac.destination]);
  });

  it('the destination itself as the insert keeps the output connected (same as null)', () => {
    controller.setOutputInsert(ac.destination);
    expect(destinationGain().connections).toEqual([ac.destination]);
    expect(controller.output.outputInsert).toBeNull();

    controller.setOutputInsert(insert);
    controller.setOutputInsert(ac.destination);
    expect(destinationGain().connections).toEqual([ac.destination]);
    controller.reset();
    expect(destinationGain().connections).toEqual([ac.destination]);
  });

  it('installing the same insert twice connects it once', () => {
    controller.setOutputInsert(insert);
    controller.setOutputInsert(insert);
    expect(destinationGain().connections).toEqual([insert]);
  });

  it('orbits still reach destinationGain through the merger (taps on destinationGain stay pre-insert)', () => {
    controller.setOutputInsert(insert);
    controller.getOrbit(1);
    expect(controller.output.channelMerger.connections).toEqual([destinationGain()]);
  });
});
