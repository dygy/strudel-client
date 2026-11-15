/**
 * The set and track clocks (spec 030 §2.3, tech §2.5).
 *
 * - Set time: how long the main output has played since the page loaded or the last Reset. It
 *   counts through track switches, transitions and hot swaps; Stop pauses it, Play resumes it.
 * - Track time: how long the playing track has played, since Play or since a switch to a
 *   different track began its transition. A hot swap keeps the same track id, so it keeps counting.
 *
 * A pure reducer (testable with an injected clock) plus a 250 ms ticker installed once from
 * ReplEditor. The clocks count whether or not the view is open.
 *
 * When the playing track id changes: `trackIds().playing` (trackSwitch.ts) is stamped when the new
 * code's evaluate LANDS (afterEval), not when Update is pressed. For a transition with a snap, that
 * is before the audible start: TrackTransitionController emits `track-transition-waiting` right
 * after the evaluate (same microtask chain, no timer in between) and `track-transition-start` at the
 * boundary. So while a switch waits, the ticker keeps the old id, and the reset happens on the
 * start event (or on an instant switch, as soon as the evaluate lands).
 */
import { atom } from 'nanostores';
import { listenForTransitionPhase, type TransitionPhase } from '../transitionPhase';

export interface ClockState {
  setMs: number;
  trackMs: number;
  /** When the time since the last tick started accruing; null while stopped. */
  runningSince: number | null;
  /** The playing track the track clock belongs to. */
  trackId: string | null;
}

export interface ClockInput {
  now: number;
  started: boolean;
  playingTrackId: string | null;
}

export const INITIAL_CLOCK: ClockState = Object.freeze({ setMs: 0, trackMs: 0, runningSince: null, trackId: null });

/**
 * One step of the clocks:
 * - while started, the time since `runningSince` accrues to both clocks;
 * - a different (non-null) playing track id while started resets the track clock (a null id is
 *   "not known yet", e.g. Play's evaluate still in flight, and changes nothing);
 * - `started` turning false freezes both; turning true resumes them.
 */
export function clockTick(state: ClockState, { now, started, playingTrackId }: ClockInput): ClockState {
  if (!started) {
    if (state.runningSince === null) return state;
    const elapsed = Math.max(0, now - state.runningSince);
    return { ...state, setMs: state.setMs + elapsed, trackMs: state.trackMs + elapsed, runningSince: null };
  }
  const elapsed = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  const setMs = state.setMs + elapsed;
  let trackMs = state.trackMs + elapsed;
  let trackId = state.trackId;
  if (playingTrackId !== null && playingTrackId !== state.trackId) {
    trackId = playingTrackId;
    // The first track after the page loaded starts with Play, already counted from 0.
    if (state.trackId !== null) trackMs = 0;
  }
  return { setMs, trackMs, runningSince: now, trackId };
}

/** Reset: set time to zero; it counts on from `now` if music plays. Track time is untouched. */
export function clockResetSet(state: ClockState, now: number): ClockState {
  if (state.runningSince === null) return { ...state, setMs: 0 };
  // Bank the track time up to now, so the reset only touches the set clock.
  const elapsed = Math.max(0, now - state.runningSince);
  return { ...state, setMs: 0, trackMs: state.trackMs + elapsed, runningSince: now };
}

/** `m:ss`, or `h:mm:ss` from one hour. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** The clocks, for the display. Fed by the ticker. */
export const clockStore = atom<ClockState>(INITIAL_CLOCK);

/** Back to zero (tests; isolate:false shares the module between files). */
export function resetClockStore(): void {
  clockStore.set(INITIAL_CLOCK);
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let clockNow: () => number = defaultNow;

/** The Reset in the clocks' popover. */
export function resetSetClock(now: number = clockNow()): void {
  clockStore.set(clockResetSet(clockStore.get(), now));
}

export interface PerformanceClockOptions {
  /** The main scheduler plays (not the preview). */
  isStarted: () => boolean;
  /** `trackIds().playing` of the main REPL. */
  playingTrackId: () => string | null;
  now?: () => number;
  intervalMs?: number;
  /** Where TrackTransitionController's events arrive (window by default). */
  transitionEvents?: EventTarget;
}

export const CLOCK_INTERVAL_MS = 250;

/** Start the ticker. Returns the function that stops it. */
export function installPerformanceClock({
  isStarted,
  playingTrackId,
  now = defaultNow,
  intervalMs = CLOCK_INTERVAL_MS,
  transitionEvents,
}: PerformanceClockOptions): () => void {
  clockNow = now;
  let phase: TransitionPhase = 'idle';
  const tick = () => {
    const state = clockStore.get();
    let id: string | null = null;
    try {
      id = playingTrackId();
    } catch {
      id = null;
    }
    // A snapped switch has landed but not started: the old track is still what's heard.
    if (phase === 'waiting') id = state.trackId;
    const next = clockTick(state, { now: now(), started: Boolean(isStarted()), playingTrackId: id });
    if (next !== state) clockStore.set(next);
  };
  const stopPhase = listenForTransitionPhase((next) => {
    phase = next;
    // The transition starts now: reset the track clock now, not up to 250 ms later.
    if (next !== 'waiting') tick();
  }, transitionEvents);
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearInterval(timer);
    stopPhase();
    clockNow = defaultNow;
  };
}
