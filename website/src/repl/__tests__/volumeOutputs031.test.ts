/**
 * @spec: 031-midi-mapping (functional §2.4 volumes; task 5.1)
 * Through the app's own speakers volume (speakersVolume.ts) and the real PreviewEngine and
 * TrackTransitionController:
 * - a Dip at speakers volume 50 % dips destinationGain and comes back to 50 %, not 100 %: the Dip
 *   never touches the volume node, and the volume never touches destinationGain;
 * - untouched, the speakers node is exactly unity (gain 1, no automation) before and after a Dip;
 * - the speakers and headphones volumes are independent, both ways.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewEngine, volumeGain } from '@strudel/mixer';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from '../../../../packages/mixer/test/webAudioMock.mjs';
import { setupController, untilCycle } from '../../../../packages/mixer/test/transitionHarness031.mjs';
import {
  getSpeakersVolume,
  getSpeakersVolumeNode,
  resetSpeakersVolumeForTests,
  setSpeakersVolume,
} from '../speakersVolume';

type Param = { value: number; calls: unknown[][] };
const param = (node: GainNode) => node.gain as unknown as Param;
const ramps = (node: GainNode) =>
  param(node)
    .calls.filter(([method]) => method === 'linearRampToValueAtTime')
    .map(([, value]) => value as number);

describe('a Dip with the speakers volume (functional §2.4 AC 2, AC 4)', () => {
  beforeEach(() => {
    stubWebAudio();
    vi.useFakeTimers({ now: 0 });
    resetSpeakersVolumeForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubWebAudio();
    resetSpeakersVolumeForTests();
  });

  /** The app's speakers chain on the controller's context: destinationGain → speakers volume → destination. */
  function dipSetup() {
    const t = setupController({ settings: { type: 'dip', length: 1 } });
    const speakers = getSpeakersVolumeNode(t.ctx as unknown as BaseAudioContext);
    (t.destinationGain as unknown as GainNode).connect(speakers);
    return { ...t, speakers };
  }
  async function dip(t: ReturnType<typeof dipSetup>) {
    const done = t.controller.switchTo('A');
    await untilCycle(t.sch, 12.2);
    await done;
  }

  it('volume 50 %: the Dip goes down and comes back to 50 %; the volume node is never touched by it', async () => {
    const t = dipSetup();
    setSpeakersVolume(0.5);
    const volumeCalls = param(t.speakers).calls.length;
    const destCalls = param(t.destinationGain as unknown as GainNode).calls.length;
    expect(destCalls).toBe(0); // the volume change itself never touched destinationGain

    await dip(t);

    const dipRamps = ramps(t.destinationGain as unknown as GainNode);
    expect(dipRamps).toContain(0); // it dips…
    expect(dipRamps.at(-1)).toBe(1); // …and restores destinationGain to unity
    expect(param(t.speakers).calls.length).toBe(volumeCalls);
    expect(getSpeakersVolume()).toBe(0.5);
    // Heard after the Dip: unity × the volume node = the 50 % level.
    const heard = param(t.destinationGain as unknown as GainNode).value * param(t.speakers).value;
    expect(heard).toBe(volumeGain(0.5));
    expect(heard).not.toBe(1);
  });

  it('unity (AC 4): nobody touched the volume: the speakers node is exactly 1 with no automation, before and after a Dip', async () => {
    const t = dipSetup();
    expect(param(t.speakers).value).toBe(1);
    expect(param(t.speakers).calls).toEqual([]);
    expect(setSpeakersVolume(1)).toBe(false); // unity again: nothing scheduled
    await dip(t);
    expect(param(t.speakers).value).toBe(1);
    expect(param(t.speakers).calls).toEqual([]);
    expect(param(t.destinationGain as unknown as GainNode).value).toBe(1);
  });
});

describe('the speakers and headphones volumes are independent (functional §2.4 AC 1)', () => {
  class FakeOutput {
    output: { destinationGain: GainNode };
    constructor(ac: MockAudioContext) {
      this.output = { destinationGain: ac.createGain() as unknown as GainNode };
    }
  }
  let ac: MockAudioContext;
  let preview: InstanceType<typeof PreviewEngine> | null = null;

  beforeEach(async () => {
    stubWebAudio();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetSpeakersVolumeForTests();
    ac = new MockAudioContext();
    ac.currentTime = 2;
    preview = new PreviewEngine(
      ac as never,
      {
        SuperdoughAudioController: FakeOutput,
        superdough: vi.fn(),
        repl: () => ({ evaluate: vi.fn(), stop: vi.fn() }),
        getTime: () => ac.currentTime,
      } as never,
    );
    await preview.initialize();
  });
  afterEach(() => {
    preview?.destroy();
    preview = null;
    vi.restoreAllMocks();
    unstubWebAudio();
    resetSpeakersVolumeForTests();
  });

  it('speakers 100 % → 50 %: the speakers node ramps; the headphones node and level are unchanged', () => {
    const speakers = getSpeakersVolumeNode(ac as unknown as BaseAudioContext);
    const headphones = preview!.getVolumeNode() as unknown as GainNode;
    expect(setSpeakersVolume(0.5)).toBe(true);
    expect(ramps(speakers)).toEqual([0.25]);
    expect(param(headphones).calls).toEqual([]);
    expect(param(headphones).value).toBe(1);
    expect(preview!.getVolume()).toBe(1);
    expect(localStorage.getItem('strudel-volume-headphones')).toBeNull();
  });

  it('negative: headphones 100 % → 50 % leaves the speakers node and level alone', () => {
    const speakers = getSpeakersVolumeNode(ac as unknown as BaseAudioContext);
    const headphones = preview!.getVolumeNode() as unknown as GainNode;
    expect(preview!.setVolume(0.5)).toBe(true);
    expect(ramps(headphones)).toEqual([0.25]);
    expect(param(speakers).calls).toEqual([]);
    expect(param(speakers).value).toBe(1);
    expect(getSpeakersVolume()).toBe(1);
  });
});
