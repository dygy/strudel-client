/**
 * @spec: 031-midi-mapping (functional §2.4, tech §2.4)
 * The speakers volume: one permanent GainNode, the last node before the destination (after the main
 * EQ, and still last once the EQ is gone), separate from destinationGain, surviving superdough's
 * reset() and EQ swaps, upstream of the recording and meter taps; its setter ramps (never a jump),
 * is remembered in this browser and tells listeners.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuperdoughAudioController } from '../../../../packages/superdough/superdoughoutput.mjs';
import {
  MockAudioContext,
  stubWebAudio,
  stubWebAudioNodeConstructors,
  unstubWebAudio,
} from '../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizerOutputTap, initMainEqualizer } from '../mainEqualizer';
import {
  getSpeakersVolume,
  getSpeakersVolumeNode,
  resetSpeakersVolumeForTests,
  setSpeakersVolume,
  subscribeSpeakersVolume,
} from '../speakersVolume';

const conns = (node: unknown): unknown[] => (node as { connections: unknown[] }).connections;
const calls = (node: GainNode): unknown[][] => (node.gain as unknown as { calls: unknown[][] }).calls;

describe('speakers volume (spec 031)', () => {
  let ac: any;
  let controller: any;

  beforeEach(() => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resetSpeakersVolumeForTests();
    ac = new MockAudioContext();
    ac.currentTime = 3;
    controller = new SuperdoughAudioController(ac);
  });
  afterEach(() => {
    destroyMainEqualizer();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    unstubWebAudio();
    resetSpeakersVolumeForTests();
  });
  const settle = () => vi.runOnlyPendingTimers();

  it('is the last node: destinationGain → EQ → volume → destination; the taps stay upstream', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();
    const volume = getSpeakersVolumeNode(ac);
    expect(conns(controller.output.destinationGain)).toEqual([eq.getInput()]);
    expect(conns(eq.getOutput())).toEqual([volume]);
    expect(conns(volume)).toEqual([ac.destination]);
    expect(volume).not.toBe(controller.output.destinationGain);
    // Record as heard and the meter tap the EQ output, before the volume.
    expect(getMainEqualizerOutputTap()).toBe(eq.getOutput());
  });

  it('untouched, its gain is exactly 1 with no automation (unity: today’s level)', () => {
    initMainEqualizer(ac, controller);
    const volume = getSpeakersVolumeNode(ac);
    expect(volume.gain.value).toBe(1);
    expect(calls(volume)).toEqual([]);
    expect(getSpeakersVolume()).toBe(1);
  });

  it('survives superdough’s reset(): same node, same edge to the destination, EQ re-attached', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();
    const volume = getSpeakersVolumeNode(ac);
    setSpeakersVolume(0.5);
    const before = calls(volume).length;

    controller.reset();
    settle();

    expect(getSpeakersVolumeNode(ac)).toBe(volume);
    expect(conns(controller.output.destinationGain)).toEqual([eq.getInput()]);
    expect(conns(eq.getOutput())).toEqual([volume]);
    expect(conns(volume)).toEqual([ac.destination]);
    expect(calls(volume).length).toBe(before); // reset never touches the volume
    expect(volume.gain.value).toBe(0.25);
  });

  it('stays last when the EQ goes away, and when it comes back (one node per context, never re-made)', () => {
    initMainEqualizer(ac, controller);
    settle();
    const volume = getSpeakersVolumeNode(ac);

    destroyMainEqualizer();
    settle();
    expect(controller.output.outputInsert).toBe(volume);
    expect(conns(controller.output.destinationGain)).toEqual([volume]);
    expect(conns(volume)).toEqual([ac.destination]);

    const eq2 = initMainEqualizer(ac, controller);
    settle();
    expect(conns(controller.output.destinationGain)).toEqual([eq2.getInput()]);
    expect(conns(eq2.getOutput())).toEqual([volume]);
    expect(conns(volume)).toEqual([ac.destination]);
    expect(ac.createdNodes.filter((n: any) => n.connections?.includes(ac.destination))).toEqual([volume]);
  });

  it('the EQ swap stays click-free: the old path fades out, the volume path fades in (spec 020)', () => {
    initMainEqualizer(ac, controller);
    settle();
    destroyMainEqualizer();
    // While fading, destinationGain feeds two switch gains, each ramped, never set by a jump.
    const switches = conns(controller.output.destinationGain) as any[];
    expect(switches).toHaveLength(2);
    for (const sw of switches) {
      expect(sw.gain.calls.some(([m]: [string]) => m === 'value=')).toBe(false);
      expect(sw.gain.calls.some(([m]: [string]) => m === 'linearRampToValueAtTime')).toBe(true);
    }
    expect(switches.map((sw) => sw.connections[0])).toContain(getSpeakersVolumeNode(ac));
  });

  it('setSpeakersVolume ramps from the current gain (no jump), leaving destinationGain alone', () => {
    initMainEqualizer(ac, controller);
    const volume = getSpeakersVolumeNode(ac);
    const destinationGain = controller.output.destinationGain;
    const destBefore = destinationGain.gain.calls.length;

    expect(setSpeakersVolume(0.5)).toBe(true);

    expect(calls(volume)).toEqual([
      ['cancelScheduledValues', 3],
      ['setValueAtTime', 1, 3],
      ['linearRampToValueAtTime', 0.25, 3.02],
    ]);
    expect(destinationGain.gain.calls.length).toBe(destBefore);
    expect(setSpeakersVolume(0.5)).toBe(false); // unchanged: no ramp
  });

  it('is remembered: a new page (fresh module state) builds the node at the stored level', () => {
    setSpeakersVolume(0.5);
    expect(localStorage.getItem('strudel-volume-speakers')).toBe('0.5');
    resetSpeakersVolumeForTests();
    const other = new MockAudioContext() as any;
    const node = getSpeakersVolumeNode(other);
    expect(getSpeakersVolume()).toBe(0.5);
    expect(node.gain.value).toBe(0.25);
  });

  it('listeners hear a change once; junk is ignored', () => {
    const heard: number[] = [];
    const off = subscribeSpeakersVolume((v) => heard.push(v));
    setSpeakersVolume(0.3);
    setSpeakersVolume(0.3);
    setSpeakersVolume(Number.NaN);
    off();
    setSpeakersVolume(0.9);
    expect(heard).toEqual([0.3]);
  });
});
