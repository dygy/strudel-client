// @vitest-environment jsdom
/**
 * @spec: 033-loudness-meter (functional §2.4 warning light, §2.5 strips, §2.6 panel, §2.8 locales/RTL;
 *   tech §2.4, §4 components)
 * The strip's Short-term colour thresholds and hidden while off; the warning light's text and clear;
 * the panel's readings, target persistence, Reset, on/off; the desktop header shows the strip and the
 * compact one does not; the strip opens Settings → Meter; numbers and the history stay LTR in Hebrew.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('@strudel/webaudio', () => ({ getAudioContext: () => ({ id: 'main-ac' }) }));
vi.mock('@src/components/auth/AuthButton', () => ({ AuthButton: () => null }));

import type { Root } from 'react-dom/client';
import type { LoudnessSnapshot } from '@strudel/mixer';

// isolate:false: load fresh copies so the mocks above apply (see PerformanceStrip.test.tsx).
vi.resetModules();
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: i18n } = await import('@src/i18n/i18n');
const { createLoudnessRuntime } = await import('../../../meter/loudnessRuntime');
const { LOUDNESS_METER_STORAGE_KEY } = await import('../../../meter/meterSettings');
const { LoudnessStrip } = await import('../LoudnessStrip');
const { MeterPanel } = await import('../MeterPanel');
const { Header } = await import('../../Header');
const { openMeterPanel, METER_SETTINGS_ID } = await import('../../../meter/openMeterPanel');
const { settingsMap } = await import('@src/settings');
const { resetPanelSession } = await import('../../panel/panelLayout');
const performanceStore = await import('../../../performance/performanceStore');

type Runtime = ReturnType<typeof createLoudnessRuntime>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
    data,
  };
}

/** A runtime with a stand-in meter; `emit` sends a snapshot (playing). */
async function makeRuntime(storage = memoryStorage()) {
  let listener: ((snapshot: LoudnessSnapshot) => void) | null = null;
  let measured = 0;
  const meter = {
    attach: vi.fn(() => true),
    reset: vi.fn(() => {
      measured = 0;
    }),
    onSnapshot: (cb: (snapshot: LoudnessSnapshot) => void) => {
      listener = cb;
      return () => (listener = null);
    },
    destroy: vi.fn(),
  };
  const runtime = createLoudnessRuntime({
    createMeter: async () => meter,
    getAudioContext: () => ({}) as BaseAudioContext,
    getEqualizer: () => null,
    subscribeEqualizer: () => () => {},
    destinationGain: () => null,
    storage: () => storage as unknown as Storage,
  });
  runtime.init();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const emit = (patch: Partial<LoudnessSnapshot>) =>
    act(() => {
      measured += 0.1;
      listener?.({
        m: -20,
        s: -21,
        i: -22,
        lra: 3,
        tpMax: -3,
        tpBlock: -4,
        peakDb: [-6, -7],
        rmsDb: [-12, -13],
        events: { truePeak: 0, limiter: 0, clip: 0 },
        preLimiter: true,
        measuredSeconds: measured,
        ...patch,
      });
    });
  act(() => runtime.setPlaying(true));
  return { runtime, meter, emit, storage };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function unmount() {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
}

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  window.dispatchEvent(new Event('resize'));
};

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const CONTEXT = {
  started: false,
  handleTogglePlay: () => {},
  handleEvaluate: () => {},
  handleShuffle: () => {},
  handleShare: () => {},
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common']);
  setViewport(1440, 900);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(async () => {
  unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

describe('LoudnessStrip (functional §2.5)', () => {
  it('target −14: S −10 is amber, −14.5 neutral, −21 dimmed; the number matches the panel', async () => {
    const { runtime, emit } = await makeRuntime();
    render(
      <>
        <LoudnessStrip runtime={runtime} variant="header" onOpen={() => {}} />
        <MeterPanel runtime={runtime} />
      </>,
    );
    const tone = () => q('[data-loudness-short-term]')!;
    emit({ s: -10 });
    expect(tone().getAttribute('data-loudness-short-term')).toBe('loud');
    expect(tone().textContent).toBe('-10.0');
    expect(q('[data-meter-value="s"]')!.textContent).toBe('-10.0');
    emit({ s: -14.5 });
    expect(tone().getAttribute('data-loudness-short-term')).toBe('neutral');
    emit({ s: -21 });
    expect(tone().getAttribute('data-loudness-short-term')).toBe('quiet');
    act(() => runtime.setTarget(null));
    expect(tone().getAttribute('data-loudness-short-term')).toBe('neutral');
    expect(q('[data-loudness-target-mark]')).toBeNull();
  });

  it('silence shows "—"', async () => {
    const { runtime, emit } = await makeRuntime();
    render(<LoudnessStrip runtime={runtime} variant="performance" onOpen={() => {}} />);
    emit({ s: null });
    expect(q('[data-loudness-short-term]')!.textContent).toBe('—');
  });

  it('hidden while the meter is off; back when on', async () => {
    const { runtime } = await makeRuntime();
    render(<LoudnessStrip runtime={runtime} variant="header" onOpen={() => {}} />);
    expect(q('[data-loudness-strip="header"]')).not.toBeNull();
    act(() => runtime.setOn(false));
    expect(q('[data-loudness-strip]')).toBeNull();
    act(() => runtime.setOn(true));
    expect(q('[data-loudness-strip="header"]')).not.toBeNull();
  });

  it('the number opens Settings → Meter', async () => {
    const { runtime } = await makeRuntime();
    const onOpen = vi.fn();
    render(<LoudnessStrip runtime={runtime} variant="header" onOpen={onOpen} />);
    click(q('[data-loudness-open]')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('WarningLight (functional §2.4)', () => {
  it('lit with the reasons and counts; click clears it; the counts stay until Reset', async () => {
    const { runtime, emit } = await makeRuntime();
    render(
      <>
        <LoudnessStrip runtime={runtime} variant="header" onOpen={() => {}} />
        <MeterPanel runtime={runtime} />
      </>,
    );
    const light = () => q<HTMLButtonElement>('[data-loudness-strip] [data-loudness-warning]')!;
    expect(light().getAttribute('data-loudness-warning')).toBe('off');
    expect(light().getAttribute('aria-label')).toBe('No overload since the last clear');
    emit({ events: { truePeak: 0, limiter: 3, clip: 0 } });
    expect(light().getAttribute('data-loudness-warning')).toBe('on');
    expect(light().getAttribute('aria-label')).toBe('Limiter working (3×) — click to clear');
    expect(q('[data-meter-panel] [data-loudness-warning]')!.getAttribute('data-loudness-warning')).toBe('on');

    click(light());
    expect(light().getAttribute('data-loudness-warning')).toBe('off');
    expect(q('[data-meter-count="limiter"]')!.textContent).toContain('3');

    click(q('[data-meter-reset]')!);
    expect(q('[data-meter-count="limiter"]')!.textContent).toContain('0');
  });

  it('negative: clicking a dark light does nothing', async () => {
    const { runtime } = await makeRuntime();
    const clear = vi.spyOn(runtime, 'clearWarning');
    render(<LoudnessStrip runtime={runtime} variant="header" onOpen={() => {}} />);
    click(q('[data-loudness-warning]')!);
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('MeterPanel (functional §2.6)', () => {
  it('readings: M, S, I, TP, LRA; peak and RMS per channel; "—" for silence', async () => {
    const { runtime, emit } = await makeRuntime();
    render(<MeterPanel runtime={runtime} />);
    emit({ m: -19.96, s: -21, i: -23.04, tpMax: -1.24, lra: 6.5, peakDb: [-20, -21], rmsDb: [-23, null] });
    const value = (id: string) => q(`[data-meter-value="${id}"]`)!.textContent;
    expect([value('m'), value('s'), value('i'), value('tp'), value('lra')]).toEqual([
      '-20.0',
      '-21.0',
      '-23.0',
      '-1.2',
      '6.5',
    ]);
    expect(q('[data-meter-level="L"]')!.textContent).toContain('-20.0 / -23.0 dBFS');
    expect(q('[data-meter-level="R"]')!.textContent).toContain('-21.0 / — dBFS');
  });

  it('labels keep their qualifiers: full text, wrapping, never truncated; dBFS never wraps (review #3, #4)', async () => {
    await i18n.changeLanguage('fr');
    const { runtime, emit } = await makeRuntime();
    render(<MeterPanel runtime={runtime} />);
    emit({});
    const label = (id: string) => q(`[data-meter-label="${id}"]`)!;
    expect(label('m').textContent).toBe('Momentanée (400 ms)');
    expect(label('i').textContent).toBe('Intégrée (depuis la remise à zéro)');
    for (const id of ['m', 's', 'i', 'tp', 'lra']) {
      expect(label(id).className).not.toMatch(/\btruncate\b/);
      expect(label(id).className).toMatch(/\bbreak-words\b/);
    }
    const levelText = q('[data-meter-level="L"] bdi')!;
    expect(levelText.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(levelText.className).toMatch(/\bw-36\b/);
  });

  it('the target is remembered: −23, then a reload still shows −23', async () => {
    const storage = memoryStorage();
    const { runtime } = await makeRuntime(storage);
    render(<MeterPanel runtime={runtime} />);
    const select = q<HTMLSelectElement>('[data-meter-target]')!;
    expect(select.value).toBe('-14');
    act(() => {
      select.value = '-23';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(JSON.parse(storage.data.get(LOUDNESS_METER_STORAGE_KEY)!)).toEqual({ on: true, target: -23 });
    unmount();
    const reloaded = await makeRuntime(storage);
    render(<MeterPanel runtime={reloaded.runtime} />);
    expect(q<HTMLSelectElement>('[data-meter-target]')!.value).toBe('-23');
    act(() => {
      const again = q<HTMLSelectElement>('[data-meter-target]')!;
      again.value = 'off';
      again.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(reloaded.runtime.settings.get().target).toBeNull();
  });

  it('Reset resets the meter; the switch turns the meter off (readings gone) and on', async () => {
    const { runtime, meter } = await makeRuntime();
    render(<MeterPanel runtime={runtime} />);
    meter.reset.mockClear();
    click(q('[data-meter-reset]')!);
    expect(meter.reset).toHaveBeenCalledTimes(1);
    click(q('[data-meter-on]')!);
    expect(meter.destroy).toHaveBeenCalledTimes(1);
    expect(q('[data-meter-readings]')).toBeNull();
    expect(q('[data-meter-off-note]')).not.toBeNull();
    click(q('[data-meter-on]')!);
    expect(q('[data-meter-readings]')).not.toBeNull();
  });

  it('Hebrew: the panel mirrors, numbers and the history canvas stay left-to-right', async () => {
    await i18n.changeLanguage('he');
    const { runtime, emit } = await makeRuntime();
    render(
      <div dir="rtl">
        <MeterPanel runtime={runtime} />
      </div>,
    );
    emit({ s: -14 });
    expect(q('[data-meter-value="s"]')!.closest('bdi')!.getAttribute('dir')).toBe('ltr');
    expect(q('[data-loudness-history] canvas')!.getAttribute('dir')).toBe('ltr');
    expect(q('[data-meter-panel]')!.getAttribute('aria-label')).toBe('מד עוצמה נשמעת');
  });
});

describe('placement (functional §2.5, tech §2.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPanelSession();
    settingsMap.setKey('isZen', false as never);
  });

  it('the desktop header shows the strip', () => {
    render(<Header context={CONTEXT} />);
    expect(q('header [data-loudness-strip="header"]')).not.toBeNull();
  });

  it('the compact (phone) layout shows no strip in the header, embedded or not', () => {
    setViewport(375, 800);
    render(<Header context={CONTEXT} />);
    expect(q('[data-loudness-strip]')).toBeNull();
    unmount();
    render(<Header context={CONTEXT} embedded />);
    expect(q('header')).not.toBeNull(); // a compact embed keeps the desktop header…
    expect(q('[data-loudness-strip]')).toBeNull(); // …without the strip
  });

  it('openMeterPanel leaves the performance view, selects Settings, opens the panel and scrolls to the meter', () => {
    const section = document.createElement('div');
    section.id = METER_SETTINGS_ID;
    section.scrollIntoView = vi.fn();
    document.body.appendChild(section);
    performanceStore.openPerformance();
    settingsMap.setKey('activeFooter', 'files');
    settingsMap.setKey('isPanelOpen', false as never);
    const frames: Array<() => void> = [];
    expect(openMeterPanel({ compact: false, requestFrame: (cb) => frames.push(cb) })).toBe(true);
    expect(performanceStore.performanceOpen.get()).toBe(false);
    expect(settingsMap.get().activeFooter).toBe('settings');
    expect(String(settingsMap.get().isPanelOpen)).toBe('true');
    frames.shift()?.();
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1);
    section.remove();
  });

  it('openMeterPanel waits for the section to render, then scrolls', () => {
    const frames: Array<() => void> = [];
    openMeterPanel({ compact: false, requestFrame: (cb) => frames.push(cb) });
    frames.shift()?.();
    expect(frames).toHaveLength(1); // not there yet: tries again next frame
    const section = document.createElement('div');
    section.id = METER_SETTINGS_ID;
    section.scrollIntoView = vi.fn();
    document.body.appendChild(section);
    frames.shift()?.();
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    section.remove();
  });
});
