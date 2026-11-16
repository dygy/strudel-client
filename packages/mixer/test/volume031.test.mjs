/**
 * @spec: 031-midi-mapping (functional §2.4, tech §2.4)
 * The speakers/headphones volume: the taper (unity at 1, about −6 dB at 0.7), the ramped setter
 * (anchored at the current gain, ≤ 30 ms, never a jump, nothing when unchanged), persistence, the
 * headphones node at the end of PreviewEngine's chain, and a Dip that dips on destinationGain only,
 * so it comes back to the volume level, not to 100 %.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HEADPHONES_VOLUME_STORAGE_KEY,
  SPEAKERS_VOLUME_STORAGE_KEY,
  VOLUME_RAMP_SECONDS,
  clampVolume,
  createVolumeNode,
  readVolume,
  setVolume,
  volumeGain,
  writeVolume,
} from '../volume.mjs';
import { PreviewEngine } from '../PreviewEngine.mjs';
import * as mixer from '../index.mjs';
import { MockAudioContext, createMemoryStorage, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';
import { setupController, untilCycle } from './transitionHarness031.mjs';

/** Instant changes: a `.value =` write, or a setValueAtTime to anything but the value it already had. */
function jumps(param) {
  const out = [];
  let level = null;
  for (const [method, value] of param.calls) {
    if (method === 'value=') out.push(['value=', value]);
    if (method === 'setValueAtTime' && level !== null && value !== level) out.push(['setValueAtTime', value]);
    if (method !== 'cancelScheduledValues') level = value;
  }
  return out;
}

describe('volume taper (tech §2.4)', () => {
  it('1 is exactly unity, 0 is silence, 0.7 is about −6 dB, and it rises monotonically', () => {
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0)).toBe(0);
    expect(20 * Math.log10(volumeGain(0.7))).toBeCloseTo(-6.2, 1);
    let previous = -1;
    for (let v = 0; v <= 1.0001; v += 0.01) {
      expect(volumeGain(v)).toBeGreaterThan(previous);
      previous = volumeGain(v);
    }
  });

  it('clamps and reads junk as unity', () => {
    expect(volumeGain(2)).toBe(1);
    expect(volumeGain(-1)).toBe(0);
    expect(clampVolume('0.5')).toBe(0.5);
    expect(clampVolume('junk')).toBe(1);
    expect(clampVolume(undefined)).toBe(1);
    expect(clampVolume(NaN)).toBe(1);
  });

  it('is exported from @strudel/mixer', () => {
    expect(mixer.setVolume).toBe(setVolume);
    expect(mixer.volumeGain).toBe(volumeGain);
    expect(mixer.SPEAKERS_VOLUME_STORAGE_KEY).toBe('strudel-volume-speakers');
    expect(mixer.HEADPHONES_VOLUME_STORAGE_KEY).toBe('strudel-volume-headphones');
  });
});

describe('setVolume: a ramp, never a jump (functional §2.4 AC 1)', () => {
  let ac;
  beforeEach(() => {
    ac = new MockAudioContext();
    ac.currentTime = 5;
  });

  it('100 % → 50 %: cancel, anchor at the current gain, linear ramp to 0.25 within 30 ms', () => {
    const node = createVolumeNode(ac, 1);
    expect(setVolume(node.gain, 0.5, ac)).toBe(true);
    expect(node.gain.calls).toEqual([
      ['cancelScheduledValues', 5],
      ['setValueAtTime', 1, 5],
      ['linearRampToValueAtTime', 0.25, 5 + VOLUME_RAMP_SECONDS],
    ]);
    expect(VOLUME_RAMP_SECONDS).toBeLessThanOrEqual(0.03);
    expect(jumps(node.gain)).toEqual([]);
  });

  it('a change mid-ramp anchors at where the gain is now, not at the old target', () => {
    const node = createVolumeNode(ac, 1);
    setVolume(node.gain, 0.5, ac);
    ac.currentTime = 5.01;
    setVolume(node.gain, 0.8, ac);
    const second = node.gain.calls.slice(3);
    expect(second[0]).toEqual(['cancelScheduledValues', 5.01]);
    expect(second[1][0]).toBe('setValueAtTime');
    expect(second[1][1]).toBe(node.gain.calls[2][1]); // the value read back, not an invented one
    expect(second[2]).toEqual(['linearRampToValueAtTime', volumeGain(0.8), 5.01 + VOLUME_RAMP_SECONDS]);
    expect(node.gain.calls.some(([m]) => m === 'value=')).toBe(false);
  });

  it('the same level again schedules nothing; junk schedules nothing', () => {
    const node = createVolumeNode(ac, 0.5);
    const before = node.gain.calls.length;
    expect(setVolume(node.gain, 0.5, ac)).toBe(false);
    expect(setVolume(node.gain, NaN, ac)).toBe(false);
    expect(setVolume(node.gain, 'x', ac)).toBe(false);
    expect(node.gain.calls.length).toBe(before);
  });

  it('a new node at level 1 is untouched (gain exactly 1, no automation): today’s output bit for bit', () => {
    const node = createVolumeNode(ac, 1);
    expect(node.gain.value).toBe(1);
    expect(node.gain.calls).toEqual([]);
  });

  it('a new node at another level is set before it is connected, never by a `.value =` write', () => {
    const node = createVolumeNode(ac, 0.5);
    expect(node.gain.value).toBe(0.25);
    expect(node.gain.calls).toEqual([['setValueAtTime', 0.25, 5]]);
    expect(node.connections).toEqual([]);
  });
});

describe('volume persistence', () => {
  it('reads 1 when missing or junk; writes clamped strings', () => {
    const storage = createMemoryStorage();
    expect(readVolume(storage, SPEAKERS_VOLUME_STORAGE_KEY)).toBe(1);
    storage.setItem(SPEAKERS_VOLUME_STORAGE_KEY, 'garbage');
    expect(readVolume(storage, SPEAKERS_VOLUME_STORAGE_KEY)).toBe(1);
    writeVolume(storage, SPEAKERS_VOLUME_STORAGE_KEY, 0.4);
    expect(storage.getItem(SPEAKERS_VOLUME_STORAGE_KEY)).toBe('0.4');
    expect(readVolume(storage, SPEAKERS_VOLUME_STORAGE_KEY)).toBe(0.4);
    writeVolume(storage, SPEAKERS_VOLUME_STORAGE_KEY, 7);
    expect(storage.getItem(SPEAKERS_VOLUME_STORAGE_KEY)).toBe('1');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readVolume(broken, SPEAKERS_VOLUME_STORAGE_KEY)).toBe(1);
    expect(() => writeVolume(broken, SPEAKERS_VOLUME_STORAGE_KEY, 0.5)).not.toThrow();
  });
});

describe('headphones volume at the end of PreviewEngine (tech §2.4)', () => {
  class FakeController {
    constructor(ac) {
      this.output = { destinationGain: ac.createGain() };
    }
  }
  let ac;
  let preview;
  const engine = (deps = {}) =>
    new PreviewEngine(ac, {
      SuperdoughAudioController: FakeController,
      superdough: vi.fn(),
      repl: () => ({ evaluate: vi.fn(), stop: vi.fn() }),
      getTime: () => ac.currentTime,
      ...deps,
    });

  beforeEach(() => {
    stubWebAudio();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ac = new MockAudioContext();
  });
  afterEach(() => {
    preview?.destroy();
    preview = null;
    vi.restoreAllMocks();
    unstubWebAudio();
  });

  it('EQ output → volume → the device stream; at the default level the gain is exactly 1', async () => {
    preview = engine();
    await preview.initialize();
    const volume = preview.getVolumeNode();
    expect(preview.equalizer.getOutput().connections).toEqual([volume]);
    expect(volume.connections).toEqual([preview.mediaStreamDest]);
    expect(volume.gain.value).toBe(1);
    expect(volume.gain.calls).toEqual([]);
    expect(preview.getVolume()).toBe(1);
  });

  it('setVolume ramps (no jump), is remembered, and a new engine starts at the stored level', async () => {
    preview = engine();
    await preview.initialize();
    const volume = preview.getVolumeNode();
    expect(preview.setVolume(0.5)).toBe(true);
    expect(volume.gain.calls.at(-1)).toEqual(['linearRampToValueAtTime', 0.25, ac.currentTime + VOLUME_RAMP_SECONDS]);
    expect(jumps(volume.gain)).toEqual([]);
    expect(localStorage.getItem(HEADPHONES_VOLUME_STORAGE_KEY)).toBe('0.5');
    preview.destroy();
    expect(volume.connections).toEqual([]); // disconnected on destroy

    preview = engine();
    await preview.initialize();
    expect(preview.getVolume()).toBe(0.5);
    expect(preview.getVolumeNode().gain.value).toBe(0.25);
  });

  it('a level set before initialize applies when the chain is built; the volume node is made once', async () => {
    preview = engine({ storage: createMemoryStorage() });
    expect(preview.setVolume(0.6)).toBe(false); // nothing built yet
    await preview.initialize();
    expect(preview.getVolumeNode().gain.value).toBeCloseTo(0.36, 10);
    const node = preview.getVolumeNode();
    await preview.initialize();
    expect(preview.getVolumeNode()).toBe(node);
  });

  it('setting the headphones volume leaves the speakers key alone', async () => {
    preview = engine();
    await preview.initialize();
    preview.setVolume(0.3);
    expect(localStorage.getItem(SPEAKERS_VOLUME_STORAGE_KEY)).toBeNull();
  });
});

describe('a Dip never fights the volume (functional §2.4 AC 2)', () => {
  beforeEach(() => {
    stubWebAudio();
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubWebAudio();
  });

  it('volume 50 %: the Dip dips and restores destinationGain to 1, the volume node stays at 0.25', async () => {
    const { controller, sch, ctx, destinationGain } = setupController({ settings: { type: 'dip', length: 1 } });
    // The speakers graph: destinationGain → … → speakers volume → destination.
    const speakers = createVolumeNode(ctx, 1);
    destinationGain.connect(speakers);
    speakers.connect(ctx.destination);
    setVolume(speakers.gain, 0.5, ctx);
    const volumeCalls = speakers.gain.calls.length;

    const done = controller.switchTo('A');
    await untilCycle(sch, 12.2);
    await done;

    const dip = destinationGain.gain.calls.filter(([m]) => m === 'linearRampToValueAtTime').map(([, v]) => v);
    expect(dip).toContain(0); // it dips…
    expect(dip.at(-1)).toBe(1); // …and comes back to unity on destinationGain
    expect(speakers.gain.calls.length).toBe(volumeCalls); // the Dip never touched the volume
    expect(speakers.gain.value).toBe(0.25);
    // What the speakers hear after the Dip: unity × volume = the 50 % level, not 100 %.
    expect(destinationGain.gain.value * speakers.gain.value).toBe(volumeGain(0.5));
  });
});
