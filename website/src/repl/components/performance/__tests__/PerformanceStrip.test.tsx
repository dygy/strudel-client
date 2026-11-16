// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (2.2 layout, 2.3 clocks, 2.4 level meter; tech §2.3, §2.6)
 * The strip: Play/Stop and Update call the header's handlers; Now/Next and Cue/Go come from the set
 * bar's model with a set playing, and Now is the track name without one; A−/A+ stop at 16 and 64;
 * Exit closes; set time offers Reset; the meter opens its tap on mount, closes it on unmount, skips
 * reading while the tab is hidden, and lights Clip; logical classes and flex-wrap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

const meter = vi.hoisted(() => ({
  read: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  ballistics: vi.fn(),
}));

vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('@strudel/webaudio', () => ({ getAudioContext: () => ({ id: 'main-ac' }) }));
vi.mock('@src/components/auth/AuthButton', () => ({ AuthButton: () => null }));
vi.mock('@src/repl/performance/levelMeter', () => ({
  METER_FLOOR_DB: -60,
  openLevelMeter: meter.open,
  meterBallistics: meter.ballistics,
}));

import type { Root } from 'react-dom/client';
import type { SetPlayerContextValue } from '../../../sets/useSetPlayer';

// isolate:false: load fresh copies so the mocks above apply (see CompactLayout.test.tsx).
vi.resetModules();
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: i18n } = await import('@src/i18n/i18n');
const { PerformanceStrip } = await import('../PerformanceStrip');
const { SetBar } = await import('../../set/SetBar');
const { dbToPercent, METER_RED_DB } = await import('../LevelMeter');
const { SetPlayerContext } = await import('../../../sets/useSetPlayer');
const { NO_SET } = await import('../../../sets/setPlayer');
const store = await import('../../../performance/performanceStore');
const clock = await import('../../../performance/performanceClock');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frames: FrameRequestCallback[] = [];
const runFrame = (time: number) => {
  const pending = frames.splice(0);
  act(() => pending.forEach((cb) => cb(time)));
};

const READING = { peakDb: [-6, -7] as [number, number], rmsDb: [-9, -10] as [number, number], over: false };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common']);
  frames.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames.length = 0;
  });
  meter.read.mockReset().mockReturnValue(READING);
  meter.close.mockReset();
  meter.open.mockReset().mockImplementation(() => ({ read: meter.read, close: meter.close }));
  meter.ballistics.mockReset().mockImplementation((_prev: unknown, reading: typeof READING) => ({
    peakDb: reading.peakDb,
    holdDb: reading.peakDb,
    holdAgeMs: [0, 0],
    clip: reading.over,
    clipAgeMs: reading.over ? 0 : Infinity,
  }));
  store.performanceOpen.set(true);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  store.performanceOpen.set(false);
  store.performanceFontSize.set('28');
  clock.resetClockStore();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

const makeContext = () => ({
  started: false,
  isDirty: false,
  handleTogglePlay: vi.fn(),
  handleEvaluate: vi.fn(),
  handleShuffle: vi.fn(),
  handleShare: vi.fn(),
});

function setContext(over: Partial<SetPlayerContextValue> = {}): SetPlayerContextValue {
  return {
    enabled: true,
    signedIn: true,
    sets: [
      {
        id: 's1',
        name: 'Friday',
        version: 'v1',
        items: [
          { id: 'a', trackId: 't1', transition: null },
          { id: 'b', trackId: 't2', transition: null },
        ],
      },
    ],
    loaded: true,
    loadFailed: false,
    tracks: { t1: { id: 't1', name: 'Groove' }, t2: { id: 't2', name: 'Drop' } },
    openSetId: 's1',
    setOpenSetId: vi.fn(),
    player: { ...NO_SET, setId: 's1', nowItemId: 'a', nextItemId: 'b' },
    buttonMode: 'cue',
    endOfSet: false,
    createSet: vi.fn(async () => ({ ok: false as const, error: 'failed' as const })),
    renameSet: vi.fn(async () => 'ok' as const),
    deleteSet: vi.fn(async () => true),
    addItem: vi.fn(),
    moveItem: vi.fn(),
    removeItem: vi.fn(),
    setItemTransition: vi.fn(),
    playSet: vi.fn(),
    endSet: vi.fn(),
    press: vi.fn(),
    selectItem: vi.fn(),
    requestAddToSet: vi.fn(),
    chooserTarget: null,
    closeChooser: vi.fn(),
    ...over,
  };
}

function render(
  { set = null, trackName }: { set?: SetPlayerContextValue | null; trackName?: string } = {},
  context = makeContext(),
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SetPlayerContext.Provider value={set}>
        <PerformanceStrip context={context} trackName={trackName} />
      </SetPlayerContext.Provider>,
    ),
  );
  return context;
}

const q = <T extends HTMLElement = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const click = (selector: string) => act(() => q(selector)!.click());

describe('PerformanceStrip', () => {
  it('Play/Stop and Update call the same handlers as the header', () => {
    const context = render();
    const [play, update] = [...q('[data-performance-strip]')!.querySelectorAll('button')];
    act(() => play.click());
    act(() => update.click());
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(1);
    expect(context.handleEvaluate).toHaveBeenCalledTimes(1);
    expect(play.getAttribute('title')).toBe('Play (Ctrl+P)');
    expect(update.getAttribute('title')).toBe('Update (Ctrl+U)');
  });

  it('shows Stop while playing', () => {
    render({}, { ...makeContext(), started: true });
    expect(q('[data-play-state="stop"]')).not.toBeNull();
  });

  it('without a set: Now is the open track, and there is no Next or Cue/Go', () => {
    render({ trackName: 'Night drive' });
    expect(q('[data-perf-now]')!.textContent).toBe('Now: Night drive');
    expect(q('[data-perf-next]')).toBeNull();
    expect(q('[data-perf-cue-go]')).toBeNull();
  });

  it('with a set playing: Now and Next as the set bar shows them, and Cue/Go presses the same action', () => {
    const set = setContext();
    render({ set, trackName: 'ignored' });
    expect(q('[data-perf-now]')!.textContent).toBe('Now: Groove');
    expect(q('[data-perf-next]')!.textContent).toBe('Up next: Drop');
    const button = q<HTMLButtonElement>('[data-perf-cue-go]')!;
    expect(button.getAttribute('data-perf-cue-go')).toBe('cue');
    expect(button.textContent).toBe('Cue');
    act(() => button.click());
    expect(set.press).toHaveBeenCalledTimes(1);
  });

  it('Go mode, and End of set disables Cue', () => {
    render({ set: setContext({ buttonMode: 'go' }) });
    expect(q('[data-perf-cue-go]')!.textContent).toBe('Go');
    act(() => root!.unmount());
    container!.remove();
    render({
      set: setContext({ endOfSet: true, player: { ...NO_SET, setId: 's1', nowItemId: 'b', nextItemId: null } }),
    });
    expect(q('[data-perf-next]')!.textContent).toBe('End of set');
    expect(q<HTMLButtonElement>('[data-perf-cue-go]')!.disabled).toBe(true);
  });

  it('a set that is not playing (or the read-only view) counts as no set', () => {
    render({ set: setContext({ player: NO_SET }), trackName: 'Solo' });
    expect(q('[data-perf-now]')!.textContent).toBe('Now: Solo');
    expect(q('[data-perf-cue-go]')).toBeNull();
  });

  it('A+ three times from 28 gives 40; A− and A+ stop at 16 and 64', () => {
    render();
    expect(q('[data-perf-font-size]')!.textContent).toBe('28');
    click('[data-perf-bigger]');
    click('[data-perf-bigger]');
    click('[data-perf-bigger]');
    expect(q('[data-perf-font-size]')!.textContent).toBe('40');
    expect(store.readPerformanceFontSize()).toBe(40);
    for (let i = 0; i < 10; i++) click('[data-perf-bigger]');
    expect(q('[data-perf-font-size]')!.textContent).toBe('64');
    expect(q<HTMLButtonElement>('[data-perf-bigger]')!.disabled).toBe(true);
    for (let i = 0; i < 20; i++) click('[data-perf-smaller]');
    expect(q('[data-perf-font-size]')!.textContent).toBe('16');
    expect(q<HTMLButtonElement>('[data-perf-smaller]')!.disabled).toBe(true);
    expect(q('[data-perf-smaller]')!.getAttribute('aria-label')).toBe('Smaller code');
    expect(q('[data-perf-bigger]')!.getAttribute('aria-label')).toBe('Bigger code');
  });

  it('Exit closes the view', () => {
    render();
    expect(q('[data-perf-exit]')!.textContent).toBe('Exit');
    click('[data-perf-exit]');
    expect(store.performanceOpen.get()).toBe(false);
  });

  it('shows the clocks, and set time offers Reset to zero', () => {
    clock.clockStore.set({ setMs: 12 * 60_000, trackMs: 20_000, runningSince: null, trackId: 'a' });
    render();
    expect(q('[data-perf-set-time-value]')!.textContent).toBe('12:00');
    expect(q('[data-perf-track-time-value]')!.textContent).toBe('0:20');
    expect(q('[data-perf-set-time]')!.textContent).toContain('Set time');
    expect(q('[data-perf-track-time]')!.textContent).toContain('Track time');
    expect(q('[data-perf-reset]')).toBeNull();
    click('[data-perf-set-time]');
    expect(q('[data-perf-reset]')!.textContent).toBe('Reset');
    click('[data-perf-reset]');
    expect(q('[data-perf-set-time-value]')!.textContent).toBe('0:00');
    expect(q('[data-perf-track-time-value]')!.textContent).toBe('0:20');
    expect(q('[data-perf-reset]')).toBeNull();
  });

  it('wraps on a narrow screen and uses logical spacing only (RTL mirrors it)', () => {
    render({ set: setContext() });
    const strip = q('[data-performance-strip]')!;
    expect(strip.className).toMatch(/\bflex-wrap\b/);
    const classes = [strip, ...strip.querySelectorAll<HTMLElement>('*')]
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ');
    expect(classes).not.toMatch(/(^|\s)!?(pl|pr|ml|mr|left|right)-/);
    expect(classes).not.toMatch(/\btext-(left|right)\b/);
  });

  it('spec 032: has the Master FX row (filter, repeat length, four hold buttons), wrapping inside the strip', () => {
    render();
    const row = q('[data-performance-strip] [data-perf-master-fx]')!;
    expect(row).not.toBeNull();
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect(row.querySelector('[data-master-fx-filter-slider]')).not.toBeNull();
    expect(row.querySelector('[data-master-fx-select="perf-repeat-length"]')).not.toBeNull();
    expect(
      [...row.querySelectorAll('[data-master-fx-hold]')].map((b) => b.getAttribute('data-master-fx-hold')),
    ).toEqual(['delay', 'reverb', 'repeat', 'brake']);
  });
});

describe('LevelMeter in the strip', () => {
  it('opens the tap on the main AudioContext on mount and closes it on unmount', () => {
    render();
    expect(meter.open).toHaveBeenCalledTimes(1);
    expect(meter.open.mock.calls[0][0]).toEqual({ id: 'main-ac' });
    expect(meter.close).not.toHaveBeenCalled();
    act(() => root!.unmount());
    root = null;
    expect(meter.close).toHaveBeenCalledTimes(1);
    expect(frames.length).toBe(0);
  });

  it('draws the reading: a role=meter with the louder peak, labelled Level', () => {
    render();
    runFrame(16);
    runFrame(32);
    const el = q('[role="meter"]')!;
    expect(el.getAttribute('aria-label')).toBe('Level');
    expect(el.getAttribute('aria-valuenow')).toBe('-6');
    expect(q('[data-meter-clip]')!.getAttribute('data-meter-clip')).toBe('off');
    expect(meter.ballistics).toHaveBeenLastCalledWith(expect.anything(), READING, 16);
  });

  it('lights Clip when the ballistics latch it, and draws the top 1 dB in red', () => {
    meter.read.mockReturnValue({ peakDb: [-0.2, -3], rmsDb: [-3, -6], over: true });
    render();
    runFrame(16);
    expect(q('[data-meter-clip]')!.getAttribute('data-meter-clip')).toBe('on');
    expect(q('[data-meter-clip]')!.textContent).toBe('Clip');
    expect(q('[data-meter-bar="L"] [data-meter-red]')).not.toBeNull();
    expect(q('[data-meter-bar="R"] [data-meter-red]')).toBeNull();
  });

  it('does not read the tap while the tab is hidden', () => {
    render();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    runFrame(16);
    runFrame(32);
    expect(meter.read).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    runFrame(48);
    expect(meter.read).toHaveBeenCalledTimes(1);
  });

  it('a tap that cannot open (no audio yet) shows silence and does not throw', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    meter.open.mockImplementation(() => {
      throw new Error('no context');
    });
    render();
    runFrame(16);
    expect(q('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('-60');
    vi.restoreAllMocks();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/*  Feature testing (task 4.1)                                                                      */
/* ------------------------------------------------------------------------------------------------ */

describe('030 §2.2 the strip and the set bar are one model', () => {
  function renderBoth(set: SetPlayerContextValue, trackName = 'Open track') {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <SetPlayerContext.Provider value={set}>
          <SetBar />
          <PerformanceStrip context={makeContext()} trackName={trackName} />
        </SetPlayerContext.Provider>,
      ),
    );
  }

  it('the same Now / Next texts and button label, and both buttons press the same action', () => {
    const set = setContext({ buttonMode: 'go' });
    renderBoth(set);
    expect(q('[data-perf-now]')!.textContent).toBe(q('[data-set-bar-now]')!.textContent);
    expect(q('[data-perf-next]')!.textContent).toBe(q('[data-set-bar-next]')!.textContent);
    expect(q('[data-perf-cue-go]')!.textContent).toBe(q('[data-set-bar-button]')!.textContent);
    expect(q('[data-perf-cue-go]')!.getAttribute('aria-label')).toBe(
      q('[data-set-bar-button]')!.getAttribute('aria-label'),
    );
    click('[data-set-bar-button]');
    click('[data-perf-cue-go]');
    expect(set.press).toHaveBeenCalledTimes(2);
    expect(set.playSet).not.toHaveBeenCalled();
    expect(set.endSet).not.toHaveBeenCalled();
  });

  it('a Cue in flight disables both, and neither presses', () => {
    const set = setContext({ player: { ...NO_SET, setId: 's1', nowItemId: 'a', nextItemId: 'b', phase: 'cueing' } });
    renderBoth(set);
    expect(q<HTMLButtonElement>('[data-set-bar-button]')!.disabled).toBe(true);
    expect(q<HTMLButtonElement>('[data-perf-cue-go]')!.disabled).toBe(true);
    click('[data-set-bar-button]');
    click('[data-perf-cue-go]');
    expect(set.press).not.toHaveBeenCalled();
  });

  it('no set playing: the set bar is gone and the strip shows the open track only', () => {
    renderBoth(setContext({ player: NO_SET }), 'Night drive');
    expect(q('[data-set-bar]')).toBeNull();
    expect(q('[data-perf-now]')!.textContent).toBe('Now: Night drive');
    expect(q('[data-perf-cue-go]')).toBeNull();
  });
});

describe('030 §2.2 Play/Stop and Update in the strip', () => {
  it('Play calls only Play/Stop; Update calls only Update', () => {
    const context = render();
    const [play, update] = [...q('[data-performance-strip]')!.querySelectorAll('button')];
    act(() => play.click());
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(1);
    expect(context.handleEvaluate).not.toHaveBeenCalled();
    act(() => update.click());
    expect(context.handleEvaluate).toHaveBeenCalledTimes(1);
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('while stopped it shows Play, not Stop', () => {
    render({}, { ...makeContext(), started: false });
    expect(q('[data-play-state="play"]')).not.toBeNull();
    expect(q('[data-play-state="stop"]')).toBeNull();
  });
});

describe('030 §2.4 the meter scale: the top 1 dB is red', () => {
  it('maps −60…0 dBFS onto 0…100 %, clamped', () => {
    expect(METER_RED_DB).toBe(-1);
    expect(dbToPercent(0)).toBe(100);
    expect(dbToPercent(-60)).toBe(0);
    expect(dbToPercent(-30)).toBeCloseTo(50);
    expect(dbToPercent(-1)).toBeCloseTo((59 / 60) * 100);
    expect(dbToPercent(-80)).toBe(0);
    expect(dbToPercent(3)).toBe(100);
    expect(dbToPercent(-Infinity)).toBe(0);
    expect(dbToPercent(Infinity)).toBe(100);
    expect(dbToPercent(NaN)).toBe(0);
  });

  it('a peak inside the top 1 dB draws red; just below it does not', () => {
    meter.read.mockReturnValue({ peakDb: [-0.5, -1.5], rmsDb: [-3, -4], over: false });
    render();
    runFrame(16);
    expect(q('[data-meter-bar="L"] [data-meter-red]')).not.toBeNull();
    expect(q('[data-meter-bar="R"] [data-meter-red]')).toBeNull();
    // Neither reached −0.3 dBFS: no clip light.
    expect(q('[data-meter-clip]')!.getAttribute('data-meter-clip')).toBe('off');
  });
});
