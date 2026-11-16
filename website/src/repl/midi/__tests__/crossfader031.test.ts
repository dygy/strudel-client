/**
 * @spec: 031-midi-mapping (§2.5 manual crossfader; tech §2.6 crossfader.ts)
 * Position → progress per playing end; the next track's order (set cue, then the editor's track,
 * else inert); complete flips the playing end, abandon keeps it; a mix only starts from the playing
 * end (after nothing cued, a failure or a hand-over the fader must come back first); Go during a mix
 * hands over; the progress is pushed again until the controller has the mix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrossfader, progressFor, type CrossfaderDeps, type ManualOutcome } from '../crossfader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(over: Partial<CrossfaderDeps> = {}) {
  let pending = deferred<ManualOutcome>();
  const progress: number[] = [];
  const deps = {
    isPlaying: vi.fn(() => true),
    setCued: vi.fn(() => false),
    editorDiffers: vi.fn(() => false),
    beginSet: vi.fn(() => pending.promise),
    beginEditor: vi.fn(() => pending.promise),
    setProgress: vi.fn((p: number) => {
      progress.push(p);
      return true;
    }),
    handOver: vi.fn(() => true),
    ...over,
  };
  const crossfader = createCrossfader(deps);
  const end = async (outcome: ManualOutcome) => {
    pending.resolve(outcome);
    await Promise.resolve();
    await Promise.resolve();
    pending = deferred<ManualOutcome>();
  };
  return { crossfader, deps, progress, end };
}

describe('progressFor', () => {
  it('is x from the left end and 1 − x from the right end', () => {
    expect(progressFor(0.3, 'left')).toBeCloseTo(0.3);
    expect(progressFor(0.3, 'right')).toBeCloseTo(0.7);
    expect(progressFor(1, 'right')).toBe(0);
  });
});

describe('the crossfader', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('starts with the playing end at the left, armed', () => {
    const { crossfader } = setup();
    expect(crossfader.getState()).toMatchObject({ position: 0, playingEnd: 'left', mixing: false, armed: true });
  });

  it('a set cue comes first: leaving the playing end starts the set’s manual Go with the progress', () => {
    const { crossfader, deps, progress } = setup({ setCued: vi.fn(() => true), editorDiffers: vi.fn(() => true) });
    crossfader.setPosition(0.3);
    expect(deps.beginSet).toHaveBeenCalledTimes(1);
    expect(deps.beginEditor).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBeCloseTo(0.3);
    crossfader.setPosition(0.5);
    expect(progress.at(-1)).toBeCloseTo(0.5);
    expect(deps.beginSet).toHaveBeenCalledTimes(1);
    expect(crossfader.getState().mixing).toBe(true);
  });

  it('without a cue, the editor’s different track is mixed in (the switch Update would make)', () => {
    const { crossfader, deps } = setup({ editorDiffers: vi.fn(() => true) });
    crossfader.setPosition(0.1);
    expect(deps.beginEditor).toHaveBeenCalledTimes(1);
    expect(deps.beginSet).not.toHaveBeenCalled();
  });

  it('inert with no next track: nothing starts and it says so (positive)', () => {
    const { crossfader, deps } = setup();
    crossfader.setPosition(0.6);
    crossfader.setPosition(1);
    expect(deps.beginSet).not.toHaveBeenCalled();
    expect(deps.beginEditor).not.toHaveBeenCalled();
    expect(deps.setProgress).not.toHaveBeenCalled();
    expect(crossfader.getState()).toMatchObject({ mixing: false, inert: true, playingEnd: 'left' });
    expect(crossfader.nextSource()).toBeNull();
  });

  it('inert while nothing plays on the speakers, even with a cue', () => {
    const { crossfader, deps } = setup({ isPlaying: vi.fn(() => false), setCued: vi.fn(() => true) });
    crossfader.setPosition(0.5);
    expect(deps.beginSet).not.toHaveBeenCalled();
  });

  it('after an inert move a cue appearing mid-way waits for the fader to come back (no half-level entry)', () => {
    const cued = { value: false };
    const { crossfader, deps } = setup({ setCued: vi.fn(() => cued.value) });
    crossfader.setPosition(0.5);
    cued.value = true;
    crossfader.setPosition(0.6);
    expect(deps.beginSet).not.toHaveBeenCalled();
    crossfader.setPosition(0.01);
    crossfader.setPosition(0.2);
    expect(deps.beginSet).toHaveBeenCalledTimes(1);
  });

  it('complete flips the playing end to the right; the next mix goes leftwards and p = 1 − x', async () => {
    const { crossfader, deps, progress, end } = setup({ setCued: vi.fn(() => true) });
    crossfader.setPosition(0.4);
    crossfader.setPosition(0.99);
    await end('complete');
    expect(crossfader.getState()).toMatchObject({ playingEnd: 'right', mixing: false, armed: true });
    // Back toward the left: the next mix starts, its progress measured from the right end.
    crossfader.setPosition(0.7);
    expect(deps.beginSet).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBeCloseTo(0.3);
  });

  it('negative: an abandoned mix keeps the playing end at the left', async () => {
    const { crossfader, end } = setup({ setCued: vi.fn(() => true) });
    crossfader.setPosition(0.3);
    crossfader.setPosition(0.01);
    await end('abandoned');
    expect(crossfader.getState()).toMatchObject({ playingEnd: 'left', mixing: false, armed: true });
  });

  it('a failed or refused mix must return to the playing end before trying again', async () => {
    const { crossfader, deps, end } = setup({ editorDiffers: vi.fn(() => true) });
    crossfader.setPosition(0.3);
    await end('ignored');
    crossfader.setPosition(0.35);
    expect(deps.beginEditor).toHaveBeenCalledTimes(1);
    crossfader.setPosition(0);
    crossfader.setPosition(0.1);
    expect(deps.beginEditor).toHaveBeenCalledTimes(2);
  });

  it('Go during a mix hands it over; a hand-over that completes mid-way flips but waits for the new end', async () => {
    const { crossfader, deps, end } = setup({ setCued: vi.fn(() => true) });
    expect(crossfader.handOver()).toBe(false); // nothing mixing
    crossfader.setPosition(0.5);
    expect(crossfader.handOver()).toBe(true);
    expect(deps.handOver).toHaveBeenCalledTimes(1);
    await end('complete');
    expect(crossfader.getState()).toMatchObject({ playingEnd: 'right', armed: false });
    crossfader.setPosition(0.4); // p = 0.6, not from the playing end
    expect(deps.beginSet).toHaveBeenCalledTimes(1);
    crossfader.setPosition(1);
    crossfader.setPosition(0.8);
    expect(deps.beginSet).toHaveBeenCalledTimes(2);
  });

  it('retries the progress until the controller has taken the mix', () => {
    vi.useFakeTimers();
    let ready = false;
    const { crossfader, deps } = setup({
      setCued: vi.fn(() => true),
      setProgress: vi.fn(() => ready),
    });
    crossfader.setPosition(0.4);
    expect(deps.setProgress).toHaveBeenCalledTimes(1);
    ready = true;
    vi.advanceTimersByTime(60);
    expect(deps.setProgress).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(deps.setProgress).toHaveBeenCalledTimes(2);
    crossfader.destroy();
  });
});
