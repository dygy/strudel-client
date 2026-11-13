/**
 * @spec: 008-audio-equalizer (Req 2.2: the EQ applies to the Source_Device output)
 * The main (speakers) EQ: created at app start with the saved settings applied (no settings panel
 * needed), installed between superdough's output and the destination through the output insert,
 * kept across resetGlobalEffects() (controller.reset()), and removed cleanly on teardown.
 * Review follow-ups: reference-counted (useReplContext is mounted twice at once), installed only
 * once superdough's audioReady resolves (the controller sizes its channels for the chosen device),
 * and by default on the GLOBAL controller the app plays through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-expect-error untyped upstream .mjs (superdough is not a website dependency; @strudel/webaudio re-exports it)
import { SuperdoughAudioController } from '../../../../packages/superdough/superdoughoutput.mjs';
import { saveEqualizerSettings, getDefaultSettings } from '@strudel/equalizer';
import {
  MockAudioContext,
  stubWebAudio,
  stubWebAudioNodeConstructors,
  unstubWebAudio,
  // @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
} from '../../../../packages/mixer/test/webAudioMock.mjs';
import {
  destroyMainEqualizer,
  getMainEqualizer,
  initMainEqualizer,
  installMainEqualizerWhenReady,
  releaseMainEqualizer,
} from '../mainEqualizer';

const BAND_125 = 2;

/**
 * What each band's filter applies (audible), in band order. The bands sit on the EQ's wet path
 * (spec 020: input → cuts → bands → … → output, plus a dry bypass), so read them from the EQ.
 */
function appliedGains(eq: any): number[] {
  return eq.bands.map((b: any) => b.filter.gain.value);
}

function saveWithBand125(gain: number, isEnabled: boolean) {
  const settings = getDefaultSettings();
  settings.bands[BAND_125].gain = gain;
  saveEqualizerSettings({ ...settings, isEnabled, preset: 'custom' });
}

describe('main (speakers) equalizer', () => {
  let ac: any;
  let controller: any;

  beforeEach(() => {
    stubWebAudio(); // fresh localStorage, read by loadEqualizerSettings at call time
    stubWebAudioNodeConstructors();
    // superdough fades an insert swap and cleans up on a timer (spec 020): settle() runs it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ac = new MockAudioContext();
    controller = new SuperdoughAudioController(ac);
  });
  afterEach(() => {
    destroyMainEqualizer();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    unstubWebAudio();
  });
  /** Let superdough's insert swap finish (fade, then the bare edge back) and a removed EQ be destroyed. */
  const settle = () => vi.runOnlyPendingTimers();

  it('applies the saved settings when it is created, without the settings panel', () => {
    saveWithBand125(12, true);

    const eq = initMainEqualizer(ac, controller);

    expect(appliedGains(eq)[BAND_125]).toBe(12);
    expect(eq.getState().bands[BAND_125].gain).toBe(12);
  });

  it('an EQ saved as off is created silent (flat) but remembers the saved curve', () => {
    saveWithBand125(12, false);

    const eq = initMainEqualizer(ac, controller);

    expect(appliedGains(eq)).toEqual(Array(10).fill(0));
    expect(eq.getState()).toMatchObject({ isEnabled: false });
    expect(eq.getState().bands[BAND_125].gain).toBe(12);
  });

  it('without saved settings it starts flat', () => {
    const eq = initMainEqualizer(ac, controller);
    expect(appliedGains(eq)).toEqual(Array(10).fill(0));
  });

  it('superdough’s destinationGain plays into the EQ, and the EQ into the destination', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();

    const destinationGain = controller.output.destinationGain;
    expect(destinationGain.connections).toEqual([eq.getInput()]);
    expect(destinationGain.connections).not.toContain(ac.destination);
    expect(eq.getOutput().connections).toEqual([ac.destination]);
  });

  it('stays in the path after resetGlobalEffects() rebuilds destinationGain', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();

    controller.reset();

    expect(controller.output.destinationGain.connections).toEqual([eq.getInput()]);
  });

  it('is created once: a second init returns the same EQ and connects nothing twice', () => {
    const eq = initMainEqualizer(ac, controller);
    expect(initMainEqualizer(ac, controller)).toBe(eq);
    settle();
    expect(getMainEqualizer()).toBe(eq);
    expect(controller.output.destinationGain.connections).toEqual([eq.getInput()]);
    expect(eq.getOutput().connections).toEqual([ac.destination]);
  });

  it('teardown restores the destination and disconnects the EQ', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();

    destroyMainEqualizer();
    expect(getMainEqualizer()).toBeNull();
    settle(); // the EQ is disconnected once its path has faded out

    expect(controller.output.destinationGain.connections).toEqual([ac.destination]);
    expect(eq.getOutput().connections).toEqual([]);
    expect(eq.getInput().connections).toEqual([]);
  });

  // Review finding (spec 020): the EQ's limiter layout was fixed when the EQ was built; a reset that
  // grows the output's channels (a sink whose maxChannelCount is known late) left channels 3+ downmixed.
  it('the EQ follows the channel count when superdough’s output reset changes it', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();
    expect(eq.getChannelCount()).toBe(2);

    ac.destination.maxChannelCount = 6;
    controller.reset();
    settle();

    expect(eq.getChannelCount()).toBe(6);
    expect(controller.output.destinationGain.connections[0] === eq.getInput()).toBe(true);
  });

  // Spec 020: superdough fades the EQ path out on removal; disconnecting the EQ at once would cut it.
  it('a removed EQ stays connected until its path has faded out, then is disconnected', () => {
    const eq = initMainEqualizer(ac, controller);
    settle();

    destroyMainEqualizer();
    expect(eq.getOutput().connections[0] === ac.destination).toBe(true); // still fading through it

    settle();
    expect(eq.getOutput().connections.length).toBe(0);
  });

  describe('shared by several useReplContext instances (reference count)', () => {
    it('the first release keeps the EQ for the instance still mounted; the last one removes it', () => {
      const eq = initMainEqualizer(ac, controller); // Repl.tsx's instance
      expect(initMainEqualizer(ac, controller)).toBe(eq); // AuthenticatedReplEditor's instance

      settle();
      releaseMainEqualizer();
      expect(getMainEqualizer()).toBe(eq);
      expect(controller.output.destinationGain.connections).toEqual([eq.getInput()]);
      expect(eq.getOutput().connections).toEqual([ac.destination]);

      releaseMainEqualizer();
      expect(getMainEqualizer()).toBeNull();
      settle();
      expect(controller.output.destinationGain.connections).toEqual([ac.destination]);
      expect(eq.getOutput().connections).toEqual([]);
    });

    it('an extra release does nothing (the count never goes below zero)', () => {
      releaseMainEqualizer();
      const eq = initMainEqualizer(ac, controller);
      releaseMainEqualizer();
      expect(getMainEqualizer()).toBeNull();
      releaseMainEqualizer();
      expect(initMainEqualizer(ac, controller)).not.toBe(eq);
      expect(getMainEqualizer()).not.toBeNull();
    });
  });
});

/**
 * The app's own path: useReplContext calls installMainEqualizerWhenReady(audioReady) with the
 * defaults, which resolve to the global AudioContext and superdough controller from
 * @strudel/webaudio. A fresh module graph, so the global superdough state is this file's.
 */
describe('main EQ on the global superdough controller, after audioReady', () => {
  let me: typeof import('../mainEqualizer');
  let webaudio: any;

  beforeEach(async () => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    vi.resetModules();
    webaudio = await import('@strudel/webaudio');
    me = await import('../mainEqualizer');
  });
  afterEach(() => {
    me.destroyMainEqualizer();
    unstubWebAudio();
  });

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('initMainEqualizer() installs on the controller the app plays through', async () => {
    const eq = me.initMainEqualizer();
    await new Promise((r) => setTimeout(r, 80)); // superdough's insert swap settles (spec 020)
    expect(webaudio.getSuperdoughAudioController().output.outputInsert).toBe(eq.getInput());
    expect(webaudio.getSuperdoughAudioController().output.destinationGain.connections).toEqual([eq.getInput()]);
    expect(eq.getOutput().connections).toEqual([webaudio.getAudioContext().destination]);
  });

  it('waits for audioReady: the controller is not built (channels not sized) before the device is set', async () => {
    const ac = webaudio.getAudioContext();
    ac.destination.maxChannelCount = 8; // a multichannel interface, known once initAudio set it
    const ready = deferred();

    me.installMainEqualizerWhenReady(ready.promise);
    await flush();

    expect(me.getMainEqualizer()).toBeNull();
    expect(ac.destination.channelCount).toBe(2); // superdough's controller not created yet

    ready.resolve();
    await flush();

    const eq = me.getMainEqualizer();
    expect(eq).not.toBeNull();
    expect(ac.destination.channelCount).toBe(8);
    expect(webaudio.getSuperdoughAudioController().output.outputInsert).toBe(eq!.getInput());
  });

  it('is in place before an evaluate that awaits the same promise later (first note goes through it)', async () => {
    const ready = deferred();
    me.installMainEqualizerWhenReady(ready.promise); // at mount
    let installedAtEval: unknown = 'not run';
    const evaluate = ready.promise.then(() => {
      installedAtEval = me.getMainEqualizer(); // beforeEval's continuation
    });
    ready.resolve();
    await evaluate;
    expect(installedAtEval).not.toBeNull();
  });

  it('an unmount before audioReady cancels the install', async () => {
    const ready = deferred();
    const release = me.installMainEqualizerWhenReady(ready.promise);
    release();
    ready.resolve();
    await flush();
    expect(me.getMainEqualizer()).toBeNull();
  });

  it('two mounted instances: the EQ stays until both have unmounted', async () => {
    const releaseA = me.installMainEqualizerWhenReady(Promise.resolve());
    const releaseB = me.installMainEqualizerWhenReady(Promise.resolve());
    await flush();
    const eq = me.getMainEqualizer();
    expect(eq).not.toBeNull();

    releaseA();
    releaseA(); // a second call of the same release does not drop the other's reference
    expect(me.getMainEqualizer()).toBe(eq);

    releaseB();
    expect(me.getMainEqualizer()).toBeNull();
    expect(webaudio.getSuperdoughAudioController().output.outputInsert).toBeNull();
  });
});
