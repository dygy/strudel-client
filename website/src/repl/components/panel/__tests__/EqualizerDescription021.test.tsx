// @vitest-environment jsdom
/**
 * @spec: 021-eq-genre-presets-transparency (functional §2.1, §2.2, §2.3; tech §2.3)
 * The EQ panel's picker lists the four genre families in order, then Profiles, with exactly the
 * spec's presets. Under the picker, the description says what the current settings do (regions,
 * cuts, output) and, while a genre preset is active, why; it updates on every edit, says
 * "No change: flat" for Flat, announces its summary through one polite, atomic, debounced live
 * region, is there in the compact layout, follows the app language and isolates values in RTL.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { AudioEqualizer, EQUALIZER_PRESETS } from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { EqualizerUI } from '../EqualizerUI';
import { formatDescribeDb, formatDescribeHz } from '../EqualizerPresetDescription';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let preview: AudioEqualizer;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
/** Text without the bidi isolates the description wraps values in. */
const text = (sel: string) => (q(sel)?.textContent ?? '').replace(/[\u2066-\u2069]/g, '');
const bandSliders = () => [...container!.querySelectorAll<HTMLInputElement>('.sm\\:grid-cols-10 input[type="range"]')];

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={{ equalizer: preview }} />));
}

function pick(preset: string) {
  act(() => {
    const select = q<HTMLSelectElement>('select')!;
    select.value = preset;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('settings');
  localStorage.clear();
  setViewport(1440, 900);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const ac = new MockAudioContext();
  initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  destroyMainEqualizer();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('§2.1 the picker groups the genre presets by family', () => {
  it('five groups in order, each with exactly the spec presets in the spec order', () => {
    render();
    const groups = [...container!.querySelectorAll('optgroup')];
    const members = groups.map((g) => [...g.querySelectorAll('option')].map((o) => o.value));
    expect(groups.map((g) => g.getAttribute('label'))).toEqual([
      'Brazilian & Latin',
      'Phonk, Hip-Hop & Trap',
      'Electronic & Club',
      'Live & Other',
      'Listening profiles',
    ]);
    expect(members[0].slice(0, 6)).toEqual([
      'brazilianFunk',
      'automotivo',
      'montagem',
      'funkAgressivo',
      'mandelao',
      'bruxaria',
    ]);
    expect(members[0].at(-1)).toBe('amapiano');
    expect(members[1].slice(0, 4)).toEqual(['phonk', 'driftPhonk', 'trap', 'brazilianPhonk']);
    expect(members[2].slice(0, 5)).toEqual(['electro', 'techno', 'drumAndBass', 'dubstep', 'house']);
    expect(members[3]).toEqual([
      'rockGenre',
      'metal',
      'punk',
      'usFunk',
      'disco',
      'soul',
      'reggae',
      'dub',
      'ambient',
      'chillout',
      'lofi',
    ]);
    expect(members[4]).toHaveLength(22);
    expect(members[4]).toContain('rock');
  });

  it('every option shows a name, not a raw key', () => {
    render();
    const raw = [...container!.querySelectorAll('option')].filter((o) => /^equalizer/.test(o.textContent ?? ''));
    expect(raw.map((o) => o.value)).toEqual([]);
  });

  it('picking Amapiano sets its bands, cuts and output, and the picker shows Amapiano', () => {
    render();
    pick('amapiano');
    const p = EQUALIZER_PRESETS.amapiano;
    expect(q<HTMLSelectElement>('select')!.value).toBe('amapiano');
    expect(preview.getState().bands.map((b) => b.gain)).toEqual(p.gains);
    expect(preview.getState().lowCut).toEqual({ enabled: true, frequency: p.lowCut });
    expect(preview.getState().highCut.enabled).toBe(false);
    expect(preview.getState().outputGain).toBe(p.outputGain);
  });
});

describe('§2.2 what the preset does', () => {
  it('Drift Phonk: sub boost, scooped low mids, presence lift, low cut 25 Hz, high cut 14 kHz, output −8 dB, then why', () => {
    render();
    pick('driftPhonk');
    const regions = text('[data-eq-describe="regions"]');
    expect(regions).toMatch(/Sub \+\d+ dB/);
    expect(regions).toContain('Low mids −4 dB');
    expect(regions).toContain('Presence +7 dB');
    expect(text('[data-eq-describe="strip"]')).toBe('Low cut 25 Hz · High cut 14 kHz · Output −8 dB');
    expect(text('[data-eq-describe="why"]')).toContain('cowbell');
  });

  it('moving the 4 kHz band after a preset: Custom, no why, and the summary shows the new value', () => {
    render();
    pick('driftPhonk');
    drag(bandSliders()[7], '-6');
    expect(q<HTMLSelectElement>('select')!.value).toBe('custom');
    expect(q('[data-eq-describe="why"]')).toBeNull();
    expect(text('[data-eq-describe="regions"]')).toContain('Presence −6 dB');
  });

  it('a cut or the output moved on Custom updates the summary at once', () => {
    render();
    pick('phonk');
    drag(q<HTMLInputElement>('[data-eq-slider="output"]')!, '-3');
    expect(text('[data-eq-describe="strip"]')).toContain('Output −3 dB');
  });

  it('reset to Flat reads "No change: flat", with no why', () => {
    render();
    pick('driftPhonk');
    pick('flat');
    expect(text('[data-eq-describe="flat"]')).toBe('No change: flat');
    expect(q('[data-eq-describe="regions"]')).toBeNull();
    expect(q('[data-eq-describe="why"]')).toBeNull();
  });

  it('a listening profile shows what it does but no why', () => {
    render();
    pick('bassBoost');
    expect(text('[data-eq-describe="regions"]')).toContain('Sub +7 dB');
    expect(q('[data-eq-describe="why"]')).toBeNull();
  });

  it('the description sits under the picker; only its summary is live (polite, atomic), not the box or the title', () => {
    render();
    const description = q('[data-eq-description]')!;
    const select = q('select')!;
    expect(select.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.hasAttribute('aria-live')).toBe(false);
    const live = container!.querySelectorAll('[aria-live]');
    expect(live).toHaveLength(1);
    expect(live[0].getAttribute('aria-live')).toBe('polite');
    expect(live[0].getAttribute('aria-atomic')).toBe('true');
    expect(live[0].textContent).toBe('No change: flat');
    expect(live[0].textContent).not.toContain('What it does');
    // The visible lines are not read twice.
    expect(q('[data-eq-describe="flat"]')!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('a slider drag is announced once, ~500 ms after the last change; the visible text updates at once', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render();
      const live = q('[data-eq-describe-live]')!;
      const plain = () => (live.textContent ?? '').replace(/[\u2066-\u2069]/g, '');
      // takeRecords() reads the queued mutations synchronously (the callback would run later).
      const observer = new MutationObserver(() => undefined);
      observer.observe(live, { childList: true, characterData: true, subtree: true });

      for (const gain of ['2', '4', '6', '8', '10']) {
        drag(bandSliders()[7], gain);
        act(() => vi.advanceTimersByTime(100));
      }
      // Visible: the latest value, immediately. Announced: nothing yet.
      expect(text('[data-eq-describe="regions"]')).toBe('Presence +10 dB');
      expect(live.textContent).toBe('No change: flat');
      expect(observer.takeRecords()).toEqual([]);

      act(() => vi.advanceTimersByTime(399));
      expect(observer.takeRecords()).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(plain()).toBe('Presence +10 dB');
      expect(observer.takeRecords().length).toBeGreaterThan(0);
      // Nothing further is queued: one announcement for the whole drag.
      act(() => vi.advanceTimersByTime(2000));
      expect(observer.takeRecords()).toEqual([]);
      observer.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the announcement carries the summary and the why of a genre preset', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render();
      pick('driftPhonk');
      act(() => vi.advanceTimersByTime(500));
      const live = (q('[data-eq-describe-live]')!.textContent ?? '').replace(/[\u2066-\u2069]/g, '');
      expect(live).toContain('Low cut 25 Hz · High cut 14 kHz · Output \u22128 dB');
      expect(live).toContain('Why: The 808 sub and cowbell');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the compact (phone) layout shows the same description', () => {
    setViewport(390, 844);
    render();
    expect(q('[data-eq-compact]')).not.toBeNull();
    expect(bandSliders()).toHaveLength(0);
    pick('amapiano');
    expect(text('[data-eq-describe="regions"]')).toContain('Sub +11 dB');
    expect(text('[data-eq-describe="strip"]')).toBe('Low cut 25 Hz · Output −7 dB');
    expect(text('[data-eq-describe="why"]')).toContain('log drum');
  });
});

describe('§2.3 languages', () => {
  it('switching the app language changes the description and the why', async () => {
    render();
    pick('driftPhonk');
    await act(async () => {
      await i18n.changeLanguage('ru');
      await i18n.loadNamespaces('settings');
    });
    expect(text('[data-eq-describe="strip"]')).toBe('Срез низов 25 Hz · Срез верхов 14 kHz · Выход −8 dB');
    expect(text('[data-eq-describe="regions"]')).toContain('Саб');
    expect(text('[data-eq-describe="why"]')).toContain('ковбелл');
  });
});

describe('right-to-left languages', () => {
  it.each(['he', 'ar'])('%s: every value is isolated left-to-right (LRI…PDI), so "−8 dB" never flips', async (lang) => {
    await act(async () => {
      await i18n.changeLanguage(lang);
      await i18n.loadNamespaces('settings');
    });
    render();
    pick('driftPhonk');
    const strip = q('[data-eq-describe="strip"]')!.textContent!;
    for (const value of ['\u22128 dB', '14 kHz', '25 Hz']) {
      expect([value, strip.includes(`\u2066${value}\u2069`)]).toEqual([value, true]);
    }
    const regions = q('[data-eq-describe="regions"]')!.textContent!;
    expect(regions).toContain('\u2066+7 dB\u2069');
    expect(regions).toContain('\u2066\u22124 dB\u2069');
  });
});

describe('formatting', () => {
  it('dB with a sign and a real minus, Hz and kHz without trailing .0', () => {
    expect([formatDescribeDb(16), formatDescribeDb(-4), formatDescribeDb(-5.5), formatDescribeDb(0)]).toEqual([
      '+16 dB',
      '−4 dB',
      '−5.5 dB',
      '0 dB',
    ]);
    expect([formatDescribeHz(25), formatDescribeHz(14000), formatDescribeHz(12500)]).toEqual([
      '25 Hz',
      '14 kHz',
      '12.5 kHz',
    ]);
  });
});
