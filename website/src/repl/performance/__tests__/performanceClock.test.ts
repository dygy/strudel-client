/**
 * @spec: 030-performance-mode (2.3 clocks; tech §2.5)
 * The acceptance rows with an injected clock: 90 s → 1:30; stop/resume → 6:00; a switch resets
 * track time only; a hot swap (same id) keeps it; Reset; h:mm:ss. And the ticker: a snapped switch
 * resets track time when its transition starts, not when its code lands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clockResetSet,
  clockStore,
  clockTick,
  formatClock,
  INITIAL_CLOCK,
  installPerformanceClock,
  resetClockStore,
  resetSetClock,
  type ClockState,
} from '../performanceClock';

const S = 1000;
const M = 60 * S;

/** Drive the reducer through (time, started, playing id) rows. */
function run(rows: Array<[number, boolean, string | null]>, from: ClockState = INITIAL_CLOCK): ClockState {
  return rows.reduce(
    (state, [now, started, playingTrackId]) => clockTick(state, { now, started, playingTrackId }),
    from,
  );
}

describe('formatClock', () => {
  it('m:ss under an hour, h:mm:ss from one hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(90 * S)).toBe('1:30');
    expect(formatClock(9 * M + 59.9 * S)).toBe('9:59');
    expect(formatClock(12 * M)).toBe('12:00');
    expect(formatClock(59 * M + 59 * S)).toBe('59:59');
    expect(formatClock(60 * M)).toBe('1:00:00');
    expect(formatClock(62 * M + 5 * S)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('clockTick', () => {
  it('Play pressed 90 s ago: set time 1:30', () => {
    const state = run([
      [0, false, null],
      [1000, true, 'a'],
      [91000, true, 'a'],
    ]);
    expect(formatClock(state.setMs)).toBe('1:30');
    expect(formatClock(state.trackMs)).toBe('1:30');
  });

  it('nothing counts before Play', () => {
    const state = run([
      [0, false, null],
      [60 * S, false, null],
    ]);
    expect(state.setMs).toBe(0);
    expect(state.trackMs).toBe(0);
  });

  it('5 min of play, Stop for 1 min, then 1 more: set time 6:00 (track time pauses too)', () => {
    const state = run([
      [0, true, 'a'],
      [5 * M, true, 'a'],
      [5 * M, false, null], // Stop: trackSwitch.stopped() clears the playing id
      [6 * M, false, null],
      [6 * M, true, null], // Play: the evaluate is still in flight
      [6 * M + 100, true, 'a'],
      [7 * M, true, 'a'],
    ]);
    expect(formatClock(state.setMs)).toBe('6:00');
    expect(formatClock(state.trackMs)).toBe('6:00');
  });

  it('a switch to another track 20 s ago: track time 0:20, set time not reset', () => {
    const state = run([
      [0, true, 'a'],
      [3 * M, true, 'a'],
      [3 * M, true, 'b'],
      [3 * M + 20 * S, true, 'b'],
    ]);
    expect(formatClock(state.trackMs)).toBe('0:20');
    expect(formatClock(state.setMs)).toBe('3:20');
  });

  it('an Update of the same track (hot swap, same id) does not reset track time', () => {
    const state = run([
      [0, true, 'a'],
      [2 * M, true, 'a'],
      [2 * M + 10, true, 'a'],
      [3 * M, true, 'a'],
    ]);
    expect(formatClock(state.trackMs)).toBe('3:00');
  });

  it('Stop, then Play a different track: track time starts again', () => {
    const state = run([
      [0, true, 'a'],
      [2 * M, true, 'a'],
      [2 * M, false, null],
      [3 * M, true, 'b'],
      [3 * M + 15 * S, true, 'b'],
    ]);
    expect(formatClock(state.trackMs)).toBe('0:15');
    expect(formatClock(state.setMs)).toBe('2:15');
  });

  it('1 h 2 min 5 s of play: 1:02:05', () => {
    const state = run([
      [0, true, 'a'],
      [62 * M + 5 * S, true, 'a'],
    ]);
    expect(formatClock(state.setMs)).toBe('1:02:05');
  });

  it('a clock that goes backwards never makes time negative', () => {
    const state = run([
      [10 * S, true, 'a'],
      [5 * S, true, 'a'],
    ]);
    expect(state.setMs).toBe(0);
  });
});

describe('clockResetSet', () => {
  it('set time 12:00, Reset: 0:00, and it counts on while music plays; track time untouched', () => {
    let state = run([
      [0, true, 'a'],
      [12 * M, true, 'a'],
    ]);
    state = clockResetSet(state, 12 * M + 500);
    expect(formatClock(state.setMs)).toBe('0:00');
    expect(formatClock(state.trackMs)).toBe('12:00');
    state = clockTick(state, { now: 12 * M + 30 * S + 500, started: true, playingTrackId: 'a' });
    expect(formatClock(state.setMs)).toBe('0:30');
    expect(formatClock(state.trackMs)).toBe('12:30');
  });

  it('Reset while stopped: 0:00 and it stays there', () => {
    let state = run([
      [0, true, 'a'],
      [M, true, 'a'],
      [M, false, null],
    ]);
    state = clockResetSet(state, 2 * M);
    state = clockTick(state, { now: 3 * M, started: false, playingTrackId: null });
    expect(state.setMs).toBe(0);
  });
});

describe('installPerformanceClock', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetClockStore();
  });

  it('ticks every 250 ms from the REPL, and a snapped switch resets track time at its transition start', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = 0;
    let started = true;
    let playing: string | null = 'a';
    const events = new EventTarget();
    const stop = installPerformanceClock({
      isStarted: () => started,
      playingTrackId: () => playing,
      now: () => now,
      transitionEvents: events,
    });
    // Real time and the timers move together, a tick at a time.
    const advance = (ms: number) => {
      for (let left = ms; left > 0; left -= 250) {
        const step = Math.min(250, left);
        now += step;
        vi.advanceTimersByTime(step);
      }
    };

    advance(60 * S);
    expect(formatClock(clockStore.get().setMs)).toBe('1:00');

    // The new track's code lands (afterEval stamps the id), then the switch waits for its boundary.
    playing = 'b';
    events.dispatchEvent(new Event('track-transition-waiting'));
    advance(8 * S);
    expect(clockStore.get().trackId).toBe('a');
    expect(formatClock(clockStore.get().trackMs)).toBe('1:08');

    // The transition starts: track time resets now.
    events.dispatchEvent(new Event('track-transition-start'));
    expect(clockStore.get().trackId).toBe('b');
    expect(clockStore.get().trackMs).toBe(0);
    advance(20 * S);
    expect(formatClock(clockStore.get().trackMs)).toBe('0:20');
    expect(formatClock(clockStore.get().setMs)).toBe('1:28');

    // Stop pauses both; Reset zeroes set time only.
    started = false;
    advance(30 * S);
    expect(formatClock(clockStore.get().setMs)).toBe('1:28');
    resetSetClock();
    expect(clockStore.get().setMs).toBe(0);
    expect(formatClock(clockStore.get().trackMs)).toBe('0:20');

    stop();
    started = true;
    advance(10 * S);
    expect(clockStore.get().setMs).toBe(0);
  });

  it('an instant switch (no waiting) resets track time on the next tick', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = 0;
    let playing = 'a';
    const stop = installPerformanceClock({
      isStarted: () => true,
      playingTrackId: () => playing,
      now: () => now,
      transitionEvents: new EventTarget(),
    });
    now += 30 * S;
    vi.advanceTimersByTime(30 * S);
    playing = 'b';
    now += 250;
    vi.advanceTimersByTime(250);
    expect(clockStore.get().trackMs).toBe(0);
    expect(formatClock(clockStore.get().setMs)).toBe('0:30');
    stop();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/*  Feature testing (task 4.1): the ticker side of "an Update of the same code keeps track time".   */
/* ------------------------------------------------------------------------------------------------ */

describe('installPerformanceClock: same track vs another track', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetClockStore();
  });

  function ticker(playing: () => string | null) {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = 0;
    const events = new EventTarget();
    const stop = installPerformanceClock({
      isStarted: () => true,
      playingTrackId: playing,
      now: () => now,
      transitionEvents: events,
    });
    const advance = (ms: number) => {
      for (let left = ms; left > 0; left -= 250) {
        now += 250;
        vi.advanceTimersByTime(250);
      }
    };
    const fire = (name: string) => events.dispatchEvent(new Event(name));
    return { stop, advance, fire };
  }

  it('Update of the same track (same id, even through a waiting/start/end cycle): track time keeps counting', () => {
    const { stop, advance, fire } = ticker(() => 'a');
    advance(40 * S);
    fire('track-transition-waiting');
    advance(4 * S);
    fire('track-transition-start');
    advance(6 * S);
    fire('track-transition-end');
    advance(10 * S);
    expect(formatClock(clockStore.get().trackMs)).toBe('1:00');
    expect(formatClock(clockStore.get().setMs)).toBe('1:00');
    stop();
  });

  it('a switch to another track resets track time at the start event, and set time keeps counting', () => {
    let playing = 'a';
    const { stop, advance, fire } = ticker(() => playing);
    advance(40 * S);
    playing = 'b';
    fire('track-transition-waiting');
    advance(4 * S);
    expect(formatClock(clockStore.get().trackMs)).toBe('0:44');
    fire('track-transition-start');
    advance(20 * S);
    expect(formatClock(clockStore.get().trackMs)).toBe('0:20');
    expect(formatClock(clockStore.get().setMs)).toBe('1:04');
    stop();
  });
});
