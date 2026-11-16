/**
 * @spec: 031-midi-mapping (review 031 #1/#2)
 * superdough fork addition: a voice started from a value carrying `_mixSide` is recorded with that
 * side, and `getActiveSoundIds(owner, side)` lists one side; without `side` (and for values without
 * the control) everything is as before. The control reaches the sound unchanged otherwise: the sound
 * receives exactly the controls it would without it, plus the inert `_mixSide` key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

describe('superdough voice sides (_mixSide)', () => {
  let sd;
  let main;
  let triggered;

  beforeEach(async () => {
    stubWebAudio();
    const gainNode = function (ac) {
      return ac.createGain();
    };
    vi.stubGlobal('GainNode', gainNode);
    vi.stubGlobal('ChannelMergerNode', gainNode);
    // A fresh superdough instance, so its cached AudioContext and voices never leak to other files.
    vi.resetModules();
    sd = await import('superdough');
    main = sd.getSuperdoughAudioController();
    main.getOrbit = () => ({});
    triggered = [];
    sd.registerSound('sidevoice', (t, value) => {
      triggered.push({ ...value });
      return { node: sd.getAudioContext().createGain(), stop: vi.fn() };
    });
  });
  afterEach(() => {
    sd.releaseSounds(sd.getActiveSoundIds(main), 0, 0);
    unstubWebAudio();
  });

  async function voice(extra = {}) {
    const before = new Set(sd.getActiveSoundIds(main));
    const t = sd.getAudioContext().currentTime + 1;
    await sd.superdough({ s: 'sidevoice', gain: 0.8, ...extra }, t, 4, 0.5, 0, main).catch(() => {}); // the rest of the chain needs a real context
    const id = sd.getActiveSoundIds(main).find((i) => !before.has(i));
    expect(id).toBeDefined();
    return id;
  }

  it('lists each side on its own; without side, every voice (old, new and unstamped)', async () => {
    const plain = await voice();
    const old = await voice({ _mixSide: 'old' });
    const fresh = await voice({ _mixSide: 'new' });
    expect(sd.getActiveSoundIds(main, 'old')).toEqual([old]);
    expect(sd.getActiveSoundIds(main, 'new')).toEqual([fresh]);
    expect(sd.getActiveSoundIds(main).sort()).toEqual([plain, old, fresh].sort());
    expect(sd.getActiveSoundIds().sort()).toEqual([plain, old, fresh].sort()); // the default owner
  });

  it('an unstamped voice belongs to no side (upstream behaviour unchanged)', async () => {
    await voice();
    expect(sd.getActiveSoundIds(main, 'old')).toEqual([]);
    expect(sd.getActiveSoundIds(main, 'new')).toEqual([]);
  });

  it('the sound gets the same controls with or without the marker (it reads none of it)', async () => {
    await voice();
    await voice({ _mixSide: 'new' });
    const [without, withMarker] = triggered;
    const { _mixSide, ...rest } = withMarker;
    expect(_mixSide).toBe('new');
    expect(rest).toEqual(without);
  });
});
