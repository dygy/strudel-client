/**
 * @spec: 033-loudness-meter (functional §2.5 colours, §2.6 target and on/off remembered, §2.7 Before EQ
 *   toggle remembered; tech §2.3 sanitising, §4)
 * The stored settings fall back field by field; the Before EQ key is off when absent; the Short-term
 * colour thresholds; "—" for silence; bar percentages; the warning text.
 */
import { describe, expect, it } from 'vitest';
import {
  EQ_SPECTRUM_PRE_STORAGE_KEY,
  LOUDNESS_METER_DEFAULTS,
  LOUDNESS_METER_STORAGE_KEY,
  readLoudnessMeterSettings,
  readSpectrumPreOn,
  sanitizeLoudnessMeterSettings,
  writeLoudnessMeterSettings,
  writeSpectrumPreOn,
} from '../meterSettings';
import {
  formatReading,
  reasonLabel,
  shortTermTone,
  STRIP_BAR_RANGE,
  toPercent,
  TRUE_PEAK_LIMIT_TEXT,
  warningText,
} from '../loudnessFormat';

const store = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe('meter settings (tech §2.3)', () => {
  it('defaults: on, −14', () => {
    expect(LOUDNESS_METER_DEFAULTS).toEqual({ on: true, target: -14 });
    expect(readLoudnessMeterSettings(store())).toEqual({ on: true, target: -14 });
    expect(readLoudnessMeterSettings(null)).toEqual({ on: true, target: -14 });
  });

  it.each([
    [
      { on: false, target: -23 },
      { on: false, target: -23 },
    ],
    [
      { on: true, target: -9 },
      { on: true, target: -9 },
    ],
    [
      { on: true, target: null },
      { on: true, target: null },
    ],
    [
      { on: 'yes', target: -14 },
      { on: true, target: -14 },
    ],
    [
      { on: false, target: -15 },
      { on: false, target: -14 },
    ],
    [
      { on: false, target: '-23' },
      { on: false, target: -14 },
    ],
    [{ target: -23 }, { on: true, target: -23 }],
    ['garbage', { on: true, target: -14 }],
    [null, { on: true, target: -14 }],
  ])('sanitises %j to %j', (raw, expected) => {
    expect(sanitizeLoudnessMeterSettings(raw)).toEqual(expected);
  });

  it('damaged JSON and a throwing storage give the defaults', () => {
    expect(readLoudnessMeterSettings(store({ [LOUDNESS_METER_STORAGE_KEY]: '{oops' }))).toEqual({
      on: true,
      target: -14,
    });
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLoudnessMeterSettings(throwing)).toEqual({ on: true, target: -14 });
  });

  it('writes the sanitised value; a full storage does not throw', () => {
    const s = store();
    writeLoudnessMeterSettings(s, { on: false, target: -23 });
    expect(s.data.get(LOUDNESS_METER_STORAGE_KEY)).toBe('{"on":false,"target":-23}');
    const full = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeLoudnessMeterSettings(full, { on: true, target: -14 })).not.toThrow();
  });

  it('Before EQ: its own key, off when absent, remembered', () => {
    expect(EQ_SPECTRUM_PRE_STORAGE_KEY).toBe('strudel-eq-spectrum-pre');
    const s = store();
    expect(readSpectrumPreOn(s)).toBe(false);
    writeSpectrumPreOn(s, true);
    expect(s.data.get(EQ_SPECTRUM_PRE_STORAGE_KEY)).toBe('true');
    expect(readSpectrumPreOn(s)).toBe(true);
    writeSpectrumPreOn(s, false);
    expect(readSpectrumPreOn(s)).toBe(false);
    expect(readSpectrumPreOn(store({ [EQ_SPECTRUM_PRE_STORAGE_KEY]: 'yes' }))).toBe(false);
  });
});

describe('display rules (functional §2.2, §2.5)', () => {
  it('target −14: S at −10 is amber, at −14.5 neutral, at −20.5 dimmed', () => {
    expect(shortTermTone(-10, -14)).toBe('loud');
    expect(shortTermTone(-14.5, -14)).toBe('neutral');
    expect(shortTermTone(-12, -14)).toBe('neutral'); // exactly +2: not above it
    expect(shortTermTone(-11.9, -14)).toBe('loud');
    expect(shortTermTone(-20, -14)).toBe('neutral'); // exactly −6
    expect(shortTermTone(-20.5, -14)).toBe('quiet');
  });

  it('target off, or no reading: always neutral', () => {
    expect(shortTermTone(-3, null)).toBe('neutral');
    expect(shortTermTone(-60, null)).toBe('neutral');
    expect(shortTermTone(null, -14)).toBe('neutral');
  });

  it('one decimal; silence is "—", never −∞', () => {
    expect(formatReading(-14.04, 'en')).toBe('-14.0');
    expect(formatReading(-0.04, 'en')).toBe('0.0');
    expect(formatReading(-23.26, 'fr')).toMatch(/^[-−]23,3$/);
    expect(formatReading(null, 'en')).toBe('—');
    expect(formatReading(-Infinity, 'en')).toBe('—');
    expect(formatReading(Number.NaN, 'en')).toBe('—');
  });

  it('bar percentages clamp to the range; silence is empty', () => {
    expect(toPercent(-18, STRIP_BAR_RANGE)).toBe(50);
    expect(toPercent(-50, STRIP_BAR_RANGE)).toBe(0);
    expect(toPercent(3, STRIP_BAR_RANGE)).toBe(100);
    expect(toPercent(null, STRIP_BAR_RANGE)).toBe(0);
  });

  it('the warning text names the reasons with their counts', () => {
    const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ''}`;
    expect(warningText(t, { lit: false, reasons: [] }, null)).toBe('meter.warningNone');
    const text = warningText(t, { lit: true, reasons: ['limiter', 'truePeak'] }, { limiter: 3, truePeak: 1 });
    expect(text.startsWith('meter.warningTitle')).toBe(true);
    expect(text).toContain('meter.reasonLimiter');
    expect(text).toContain('\\"count\\":3');
    expect(text).toContain('\\"count\\":1');
  });

  it('the true-peak limit is an LTR isolate, so RTL languages keep "−1 dBTP" in order', () => {
    const t = (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.limit ?? '')}`;
    expect(reasonLabel(t, 'truePeak')).toBe('meter.reasonTruePeak:\u2066−1 dBTP\u2069');
    expect(TRUE_PEAK_LIMIT_TEXT.startsWith('\u2066')).toBe(true);
    expect(TRUE_PEAK_LIMIT_TEXT.endsWith('\u2069')).toBe(true);
  });
});
