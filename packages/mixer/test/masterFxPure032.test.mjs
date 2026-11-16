/**
 * @spec: 032-master-fx (functional §2.2–2.4, tech §2.2, tech §4)
 * The pure parts of the Master FX: the filter curve (endpoints, dead zone, the §2.2 attenuation
 * criteria on the biquad responses), the settings sanitiser and choices, and the bundled
 * `beat-repeat-processor` (self-contained, runs in a scope with only the worklet globals).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  filterParams,
  clampFilterPosition,
  MASTER_FX_FILTER_DEAD_ZONE,
  MASTER_FX_Q_FLAT,
} from '../masterfx/filterCurve.mjs';
import {
  sanitizeMasterFxSettings,
  nextRepeatLength,
  MASTER_FX_DEFAULTS,
  MASTER_FX_DELAY_FRACTIONS,
  MASTER_FX_REPEAT_LENGTHS,
  MASTER_FX_RANGES,
} from '../masterfx/masterFxSettings.mjs';
import { loadBeatRepeatWorklet, BEAT_REPEAT_PROCESSOR } from '../masterfx/beatRepeatLoader.mjs';
import * as mixer from '../index.mjs';

/** |H| of the analog 2nd-order low-pass / high-pass prototypes at f. */
const lpMag = (f, fc, q) => {
  const r = f / fc;
  return 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
};
const hpMag = (f, fc, q) => {
  const r = f / fc;
  return (r * r) / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
};
/** Attenuation in dB (positive = quieter) through both biquads for knob `pos`, resonance 30 %. */
const attenuation = (pos, f) => {
  const p = filterParams(pos, 0.3);
  return -20 * Math.log10(lpMag(f, p.lpHz, p.lpQ) * hpMag(f, p.hpHz, p.hpQ));
};

describe('filterParams (functional §2.2)', () => {
  it('centre and the ±3 dead zone are off (dry only); just outside it is on and still open', () => {
    for (const pos of [0, 2, -2, 3, -3, 2.99]) {
      expect(filterParams(pos, 0.3)).toMatchObject({ wet: 0, side: 'off', lpHz: 20000, hpHz: 20 });
    }
    const lp = filterParams(-3.01, 0.3);
    expect(lp).toMatchObject({ wet: 1, side: 'lp' });
    expect(lp.lpHz).toBeGreaterThan(19900);
    const hp = filterParams(3.01, 0.3);
    expect(hp).toMatchObject({ wet: 1, side: 'hp' });
    expect(hp.hpHz).toBeLessThan(20.1);
    expect(MASTER_FX_FILTER_DEAD_ZONE).toBe(3);
  });

  it('endpoints: −100 is a 150 Hz low-pass, +100 a 6 kHz high-pass; the other side stays open', () => {
    expect(filterParams(-100, 0)).toMatchObject({ lpHz: 150, hpHz: 20 });
    expect(filterParams(100, 0)).toMatchObject({ lpHz: 20000 });
    expect(filterParams(100, 0).hpHz).toBeCloseTo(6000, 6);
  });

  it('exponential: the midpoint of the travel is the geometric mean of the endpoints', () => {
    const mid = -(3 + 97 / 2);
    expect(filterParams(mid, 0).lpHz).toBeCloseTo(Math.sqrt(20000 * 150), 6);
    const sweep = [-10, -30, -60, -90].map((p) => filterParams(p, 0).lpHz);
    expect(sweep).toEqual([...sweep].sort((a, b) => b - a));
  });

  it('Q = 0.707 + r × 7.3 on the side in use; the open side stays flat', () => {
    expect(filterParams(-50, 0).lpQ).toBeCloseTo(0.707, 9);
    expect(filterParams(-50, 1)).toMatchObject({ hpQ: MASTER_FX_Q_FLAT });
    expect(filterParams(-50, 1).lpQ).toBeCloseTo(8.007, 9);
    expect(filterParams(50, 0.3).hpQ).toBeCloseTo(0.707 + 0.3 * 7.3, 9);
    expect(filterParams(50, 0.3).lpQ).toBe(MASTER_FX_Q_FLAT);
  });

  it('junk is off; out of range is clamped', () => {
    expect(filterParams(NaN, 0.3).wet).toBe(0);
    expect(filterParams('x', 0.3).wet).toBe(0);
    expect(filterParams(-500, 0.3)).toEqual(filterParams(-100, 0.3));
    expect(clampFilterPosition(250)).toBe(100);
    expect(clampFilterPosition(undefined)).toBe(0);
  });

  it('AC: at −100 a 1 kHz tone loses ≥ 18 dB and a 100 Hz tone < 3 dB', () => {
    expect(attenuation(-100, 1000)).toBeGreaterThanOrEqual(18);
    expect(attenuation(-100, 100)).toBeLessThan(3);
  });

  it('AC: at +100 a 100 Hz tone loses ≥ 18 dB and a 10 kHz tone < 3 dB', () => {
    expect(attenuation(100, 100)).toBeGreaterThanOrEqual(18);
    expect(attenuation(100, 10000)).toBeLessThan(3);
  });

  it('negative: at −30 the 1 kHz tone is not yet cut by 18 dB (the sweep is gradual)', () => {
    expect(attenuation(-30, 1000)).toBeLessThan(18);
  });
});

describe('Master FX settings', () => {
  it('defaults are the functional spec’s', () => {
    expect(MASTER_FX_DEFAULTS).toEqual({
      resonance: 0.3,
      delay: { fraction: 3 / 16, feedback: 0.55, level: 0.7 },
      reverb: { decay: 3, level: 0.7 },
      repeatLength: 1 / 4,
    });
    expect(MASTER_FX_DELAY_FRACTIONS).toEqual([1 / 8, 3 / 16, 1 / 4, 3 / 8]);
    expect(MASTER_FX_REPEAT_LENGTHS).toEqual([1 / 2, 1 / 4, 1 / 8, 1 / 16]);
    expect(MASTER_FX_RANGES.delayFeedback.max).toBe(0.9);
    expect(MASTER_FX_RANGES.reverbDecay).toEqual({ min: 1, max: 8 });
  });

  it('keeps valid values (numeric strings too)', () => {
    const s = {
      resonance: 0.8,
      delay: { fraction: 3 / 8, feedback: 0.2, level: 1 },
      reverb: { decay: 7.5, level: 0 },
      repeatLength: 1 / 16,
    };
    expect(sanitizeMasterFxSettings(s)).toEqual(s);
    expect(sanitizeMasterFxSettings({ resonance: '0.5' }).resonance).toBe(0.5);
  });

  it('every out-of-range, wrong-type or missing field falls back to its default; the others stay', () => {
    expect(sanitizeMasterFxSettings(null)).toEqual(MASTER_FX_DEFAULTS);
    expect(sanitizeMasterFxSettings('garbage')).toEqual(MASTER_FX_DEFAULTS);
    expect(sanitizeMasterFxSettings([1, 2])).toEqual(MASTER_FX_DEFAULTS);
    const s = sanitizeMasterFxSettings({
      resonance: 2,
      delay: { fraction: 0.2, feedback: 0.95, level: 0.4 },
      reverb: { decay: 0.5, level: NaN },
      repeatLength: 1 / 3,
    });
    expect(s).toEqual({
      resonance: 0.3,
      delay: { fraction: 3 / 16, feedback: 0.55, level: 0.4 },
      reverb: { decay: 3, level: 0.7 },
      repeatLength: 1 / 4,
    });
  });

  it('nextRepeatLength steps 1/2 → 1/4 → 1/8 → 1/16 → 1/2', () => {
    expect([1 / 2, 1 / 4, 1 / 8, 1 / 16].map(nextRepeatLength)).toEqual([1 / 4, 1 / 8, 1 / 16, 1 / 2]);
    expect(nextRepeatLength(0.3)).toBe(1 / 2);
  });

  it('is exported from @strudel/mixer', () => {
    expect(mixer.filterParams).toBe(filterParams);
    expect(mixer.sanitizeMasterFxSettings).toBe(sanitizeMasterFxSettings);
    expect(mixer.MASTER_FX_DEFAULTS).toBe(MASTER_FX_DEFAULTS);
    expect(mixer.MASTER_FX_STORAGE_KEY).toBe('strudel-master-fx');
    expect(typeof mixer.MasterFx).toBe('function');
    expect(mixer.loadBeatRepeatWorklet).toBe(loadBeatRepeatWorklet);
  });
});

describe('beat-repeat-processor (bundled)', () => {
  let Processor;

  beforeAll(async () => {
    let url;
    await loadBeatRepeatWorklet({
      audioWorklet: {
        addModule(u) {
          url = u;
          return Promise.resolve();
        },
      },
    });
    expect(url).toMatch(/^data:text\/javascript;base64,/);
    const source = Buffer.from(url.replace(/^data:text\/javascript;base64,/, ''), 'base64').toString('utf8');
    expect(source).not.toMatch(/\bimport\s*[{*(]|\brequire\(/);
    const registered = {};
    class AudioWorkletProcessor {
      constructor() {
        this.port = {
          posted: [],
          onmessage: null,
          postMessage(m) {
            this.posted.push(m);
          },
        };
      }
    }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'window', 'document', 'navigator', source)(
      AudioWorkletProcessor,
      (name, cls) => (registered[name] = cls),
      1000,
      undefined,
      undefined,
      undefined,
    );
    Processor = registered[BEAT_REPEAT_PROCESSOR];
  });
  afterEach(() => vi.unstubAllGlobals());

  /** One 128-frame block of a ramp input (value = frame) at `frame` through `p`. */
  function block(p, frame, channels = 2) {
    vi.stubGlobal('currentFrame', frame);
    const input = Array.from({ length: channels }, () => Float32Array.from({ length: 128 }, (_, i) => frame + i));
    const output = Array.from({ length: channels }, () => new Float32Array(128));
    expect(p.process([input], [output])).toBe(true);
    return output;
  }

  it('registers beat-repeat-processor; idle is an exact copy on every channel', () => {
    expect(typeof Processor).toBe('function');
    const p = new Processor({ outputChannelCount: [3] });
    const out = block(p, 0, 3);
    for (let c = 0; c < 3; c++) expect([...out[c]]).toEqual(Array.from({ length: 128 }, (_, i) => i));
  });

  it('roll / length / stop messages drive the core, timed by currentFrame', () => {
    const p = new Processor({ outputChannelCount: [2] });
    for (let f = 0; f < 1024; f += 128) block(p, f);
    p.port.onmessage({ data: { type: 'roll', startFrame: 1024, lengthFrames: 256 } });
    block(p, 1024);
    block(p, 1152); // first pass, live
    const looped = block(p, 1280);
    expect(looped[0][10]).toBe(1024 + 10);
    p.port.onmessage({ data: { type: 'debug', id: 7 } });
    expect(p.port.posted.at(-1)).toMatchObject({
      type: 'debug',
      id: 7,
      active: true,
      looping: true,
      start: 1024,
      len: 256,
    });
    p.port.onmessage({ data: { type: 'stop' } });
    const live = block(p, 1408);
    expect(live[1][100]).toBe(1408 + 100);
    p.port.onmessage({ data: { type: 'debug', id: 8 } });
    expect(p.port.posted.at(-1)).toMatchObject({ active: false });
    p.port.onmessage({ data: null }); // junk is ignored
    p.port.onmessage({ data: { type: 'length', lengthFrames: 200 } }); // no roll: ignored
  });
});
