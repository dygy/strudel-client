// @vitest-environment jsdom
/**
 * @spec: 033-loudness-meter (functional §2.2, §2.3, §2.4, §2.6 acceptance criteria, end to end below the
 *   worklet)
 * The real loudness DSP core (packages/mixer/meter/loudnessCore.mjs) stands in for the worklet: it is fed
 * synthetic stereo signals in 100 ms blocks and posts its snapshot after each, as the
 * loudness-meter-processor does. The snapshots go through the real runtime into the real strip and panel,
 * so each criterion is checked on what the performer reads: "—" for silence, Integrated across Stop/Play,
 * the warning light's reason, the peak/RMS bars, and the 60 s history drawing and freezing.
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

import type { Root } from 'react-dom/client';
import type { LoudnessSnapshot } from '@strudel/mixer';

// isolate:false: load fresh copies so the mocks above apply (see Meter033.test.tsx).
vi.resetModules();
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: i18n } = await import('@src/i18n/i18n');
const { createLoudnessRuntime, LOUDNESS_HISTORY_LENGTH } = await import('../../../meter/loudnessRuntime');
const { LoudnessStrip } = await import('../LoudnessStrip');
const { MeterPanel } = await import('../MeterPanel');
const { LoudnessMeterCore } = await import('../../../../../../packages/mixer/meter/loudnessCore.mjs');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SR = 48000;
const BLOCK = SR / 10; // the worklet posts every 100 ms
const dbToLin = (db: number) => 10 ** (db / 20);

interface Segment {
  seconds: number;
  /** dBFS of the sine's amplitude; null is silence. */
  db?: number | null;
  amp?: number;
  freq?: number;
  phase?: number;
  /** The pre-limiter input as an amplitude (a constant level), or undefined: absent (EQ off). */
  pre?: number;
}

/** A runtime whose meter is the real DSP core, posting a snapshot every 100 ms of fed audio. */
async function coreRuntime() {
  const core = new LoudnessMeterCore({ sampleRate: SR });
  let listener: ((snapshot: LoudnessSnapshot) => void) | null = null;
  let t = 0;
  const meter = {
    attach: vi.fn(() => true),
    reset: vi.fn(() => core.reset()),
    onSnapshot: (cb: (snapshot: LoudnessSnapshot) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    destroy: vi.fn(),
  };
  const runtime = createLoudnessRuntime({
    createMeter: async () => meter,
    getAudioContext: () => ({}) as BaseAudioContext,
    getEqualizer: () => null,
    subscribeEqualizer: () => () => {},
    destinationGain: () => null,
    storage: () => null,
  });
  runtime.init();
  for (let i = 0; i < 5; i++) await Promise.resolve();

  /** Feed the segments (stereo, L = R) and post a snapshot after every 100 ms block. */
  const play = (...segments: Segment[]) =>
    act(() => {
      for (const { seconds, db, amp, freq = 1000, phase = 0, pre } of segments) {
        const A = amp ?? (db == null ? 0 : dbToLin(db));
        const blocks = Math.round((seconds * SR) / BLOCK);
        for (let b = 0; b < blocks; b++) {
          const a = new Float32Array(BLOCK);
          for (let k = 0; k < BLOCK; k++) a[k] = A * Math.sin((2 * Math.PI * freq * (t + k)) / SR + phase);
          t += BLOCK;
          const preBlock =
            pre === undefined ? null : [new Float32Array(BLOCK).fill(pre), new Float32Array(BLOCK).fill(pre)];
          core.process([a, a], preBlock);
          listener?.(core.snapshot() as LoudnessSnapshot);
        }
      }
    });
  return { runtime, core, meter, play };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const value = (id: string) => q(`[data-meter-value="${id}"]`)!.textContent;
const light = () => q<HTMLButtonElement>('[data-loudness-strip] [data-loudness-warning]')!;

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function renderBoth(runtime: Awaited<ReturnType<typeof coreRuntime>>['runtime']) {
  render(
    <>
      <LoudnessStrip runtime={runtime} variant="header" onOpen={() => {}} />
      <MeterPanel runtime={runtime} />
    </>,
  );
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common']);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('§2.2 loudness readings, as shown', () => {
  it('a stereo 1 kHz sine at −23 dBFS for 20 s: M, S and I each read −23.0 (strip and panel)', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 20, db: -23 });
    const shot = runtime.view.get().snapshot!;
    for (const key of ['m', 's', 'i'] as const) expect(Math.abs(shot[key]! + 23)).toBeLessThan(0.3);
    expect([value('m'), value('s'), value('i')]).toEqual(['-23.0', '-23.0', '-23.0']);
    expect(q('[data-loudness-short-term]')!.textContent).toBe('-23.0');
  });

  it('20 s of the sine then 20 s of silence: I still −23.0, while M and S show "—"', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 20, db: -23 }, { seconds: 20, db: null });
    expect(Math.abs(runtime.view.get().snapshot!.i! + 23)).toBeLessThan(0.3);
    expect(value('i')).toBe('-23.0');
    expect(value('m')).toBe('—');
    expect(value('s')).toBe('—');
    expect(q('[data-loudness-short-term]')!.textContent).toBe('—');
  });

  it('negative: a quiet −43 dBFS tail is not silence: M and S show it, and I stays −23 (gated)', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 20, db: -23 }, { seconds: 20, db: -43 });
    expect(value('m')).toBe('-43.0');
    expect(value('s')).toBe('-43.0');
    expect(Math.abs(runtime.view.get().snapshot!.i! + 23)).toBeLessThan(0.5);
  });
});

describe('§2.3 Stop, Play and Update', () => {
  it('30 s, Stop: I keeps its value and M/S show "—"; Play: I is "—" until enough is measured', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 30, db: -18 });
    expect(value('i')).toBe('-18.0');
    act(() => runtime.setPlaying(false));
    expect(value('i')).toBe('-18.0');
    expect([value('m'), value('s')]).toEqual(['—', '—']);
    play({ seconds: 5, db: null }); // the worklet keeps measuring silence while stopped
    expect(value('i')).toBe('-18.0');
    act(() => runtime.setPlaying(true));
    expect(value('i')).toBe('—');
    play({ seconds: 0.3, db: -30 }); // under one 400 ms gating block
    expect(value('i')).toBe('—');
    play({ seconds: 0.5, db: -30 });
    expect(value('i')).toBe('-30.0'); // a new measurement, not the old −18 mixed in
  });

  it('Update while playing (no toggle) leaves I accumulating across the new code', async () => {
    const { runtime, meter, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 10, db: -18 });
    meter.reset.mockClear();
    act(() => runtime.setPlaying(true)); // what a hot-swap would look like if it reported at all
    play({ seconds: 10, db: -24 });
    expect(meter.reset).not.toHaveBeenCalled();
    // Both halves count: the mean of −18 and −24 (≈ −20.0), not −24 alone.
    expect(Math.abs(runtime.view.get().snapshot!.i! + 20.03)).toBeLessThan(0.3);
  });
});

describe('§2.4 the warning light, from real signals', () => {
  it('a true peak of −0.5 dBTP with sample peaks below −1 dBFS lights it with "True peak over −1 dBTP"', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    // fs/4 at 45°: every sample is 3.01 dB under the waveform's peak.
    play({ seconds: 0.5, amp: dbToLin(-0.5), freq: SR / 4, phase: Math.PI / 4 });
    expect(runtime.view.get().snapshot!.peakDb[0]!).toBeLessThan(-1);
    expect(light().getAttribute('data-loudness-warning')).toBe('on');
    expect(light().getAttribute('aria-label')).toBe('True peak over ⁦−1 dBTP⁩ (1×) — click to clear');
  });

  it('negative: a mix peaking at −3 dBTP keeps the warning off, with every count at 0', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 5, db: -3 });
    expect(Math.abs(runtime.view.get().snapshot!.tpMax! + 3)).toBeLessThan(0.1);
    expect(light().getAttribute('data-loudness-warning')).toBe('off');
    for (const reason of ['truePeak', 'limiter', 'clip']) {
      expect(q(`[data-meter-count="${reason}"]`)!.textContent).toContain('0');
    }
  });

  it('EQ off (no pre-limiter input) and a sample at 0 dBFS: lit with "Clipping"', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 0.2, amp: 1, freq: 250 }); // samples reach 1.0 at the crests
    const { reasons } = runtime.view.get().warning;
    expect(reasons).toContain('clip');
    expect(light().getAttribute('aria-label')).toContain('Clipping (1×)');
  });

  it('negative: with the EQ on (a pre-limiter input under its ceiling), 0 dBFS out is not "Clipping"', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 0.2, amp: 1, freq: 250, pre: 0.5 });
    expect(runtime.view.get().snapshot!.events.clip).toBe(0);
    expect(light().getAttribute('aria-label')).not.toContain('Clipping');
  });

  it('EQ pushed into its limiter: the "Limiter working" count rises by 1 per event, not per sample', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 1, db: -12, pre: 0.99 }); // one long overload
    expect(q('[data-meter-count="limiter"]')!.textContent).toContain('1');
    play({ seconds: 0.3, db: -12, pre: 0.5 }, { seconds: 0.3, db: -12, pre: 0.99 }); // 0.3 s gap: the same event
    expect(runtime.view.get().snapshot!.events.limiter).toBe(1);
    play({ seconds: 0.6, db: -12, pre: 0.5 }, { seconds: 0.2, db: -12, pre: 0.99 }); // 0.6 s gap: a new one
    expect(runtime.view.get().snapshot!.events.limiter).toBe(2);
    expect(light().getAttribute('aria-label')).toBe('Limiter working (2×) — click to clear');
    click(light());
    expect(light().getAttribute('data-loudness-warning')).toBe('off');
    expect(q('[data-meter-count="limiter"]')!.textContent).toContain('2'); // counts stay until Reset
  });
});

describe('§2.6 peak and RMS bars, history', () => {
  it('a stereo 1 kHz sine at −20 dBFS: both bars read peak −20.0 and RMS −23.0 dBFS', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 1, db: -20 });
    const { peakDb, rmsDb } = runtime.view.get().snapshot!;
    for (const c of [0, 1]) {
      expect(Math.abs(peakDb[c]! + 20)).toBeLessThan(0.5);
      expect(Math.abs(rmsDb[c]! + 23)).toBeLessThan(0.5);
    }
    expect(q('[data-meter-level="L"]')!.textContent).toContain('-20.0 / -23.0 dBFS');
    expect(q('[data-meter-level="R"]')!.textContent).toContain('-20.0 / -23.0 dBFS');
  });

  it('negative: after Stop the bars show no stale level', async () => {
    const { runtime, play } = await coreRuntime();
    renderBoth(runtime);
    act(() => runtime.setPlaying(true));
    play({ seconds: 1, db: -20 });
    act(() => runtime.setPlaying(false));
    expect(q('[data-meter-level="L"]')!.textContent).toContain('— / — dBFS');
  });

  /** A canvas context that records the path calls drawHistory makes. */
  function recordingContext() {
    const calls: Array<{ op: string; x?: number; y?: number; style?: string }> = [];
    let style = '';
    const ctx = {
      clearRect: () => {},
      beginPath: () => calls.push({ op: 'begin', style }),
      moveTo: (x: number, y: number) => calls.push({ op: 'move', x, y, style }),
      lineTo: (x: number, y: number) => calls.push({ op: 'line', x, y, style }),
      stroke: () => {},
      fillRect: (x: number) => calls.push({ op: 'mark', x }),
      save: () => {},
      restore: () => {},
      setLineDash: () => {},
      set strokeStyle(v: string) {
        style = v;
      },
      get strokeStyle() {
        return style;
      },
      fillStyle: '',
      lineWidth: 1,
    };
    return { ctx, calls };
  }

  it('60 s of play: S and M span the whole graph; after Stop it stops scrolling (no redraw, no new entry)', async () => {
    const { runtime, play } = await coreRuntime();
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    const { ctx, calls } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    act(() => runtime.setPlaying(true));
    play({ seconds: 60, db: -16 });
    expect(runtime.history.get()).toHaveLength(LOUDNESS_HISTORY_LENGTH);
    render(<MeterPanel runtime={runtime} />);
    act(() => frames.splice(0).forEach((cb) => cb()));
    const s = calls.filter((c) => c.style.startsWith('rgba(29, 185, 84') && (c.op === 'move' || c.op === 'line'));
    const m = calls.filter((c) => c.style.startsWith('rgba(96, 165, 250') && (c.op === 'move' || c.op === 'line'));
    // Short-term is a value only once its 3 s window has any sound; both lines reach the right edge (now).
    expect(m[0].x).toBe(0);
    expect(s[0].x).toBe(0);
    expect(s[s.length - 1].x).toBe(600);
    expect(m[m.length - 1].x).toBe(600);
    expect(s.filter((c) => c.op === 'line').length).toBeGreaterThan(590);

    act(() => runtime.setPlaying(false));
    const before = runtime.history.get();
    play({ seconds: 3, db: -10 });
    expect(runtime.history.get()).toBe(before); // frozen: the same array, nothing appended
    expect(frames).toHaveLength(0); // and nothing asks to redraw
  });

  it('negative: 10 s of play fills only the right sixth of the graph (old on the left, now on the right)', async () => {
    const { runtime, play } = await coreRuntime();
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    const { ctx, calls } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    act(() => runtime.setPlaying(true));
    play({ seconds: 10, db: -16 });
    render(<MeterPanel runtime={runtime} />);
    act(() => frames.splice(0).forEach((cb) => cb()));
    const s = calls.filter((c) => c.style.startsWith('rgba(29, 185, 84') && (c.op === 'move' || c.op === 'line'));
    expect(s[0].x!).toBeGreaterThan(490);
    expect(s[s.length - 1].x).toBe(600);
  });
});
