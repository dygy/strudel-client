import { useEffect, useState } from 'react';

/**
 * What the speakers' track switch is doing, from TrackTransitionController's window events
 * (spec 017 §2.3: "the Update button shows that a switch is waiting"):
 * - `waiting`: a snapped switch is armed and waits for its boundary T;
 * - `running`: the transition plays;
 * - `idle`: nothing in flight (it ended, was cancelled, or the new code failed).
 */
export type TransitionPhase = 'idle' | 'waiting' | 'running';

export const TRANSITION_EVENTS = {
  waiting: 'track-transition-waiting',
  start: 'track-transition-start',
  end: 'track-transition-end',
  error: 'track-transition-error',
} as const;
export type TransitionEventName = keyof typeof TRANSITION_EVENTS;

const PHASE_AFTER: Record<TransitionEventName, TransitionPhase> = {
  waiting: 'waiting',
  start: 'running',
  end: 'idle',
  error: 'idle',
};

export function phaseAfter(event: TransitionEventName): TransitionPhase {
  return PHASE_AFTER[event];
}

/** Call `onChange` with the new phase on every transition event. Returns a function that stops it. */
export function listenForTransitionPhase(
  onChange: (phase: TransitionPhase) => void,
  target: EventTarget | undefined = typeof window !== 'undefined' ? window : undefined,
): () => void {
  if (!target) return () => {};
  const names = Object.keys(TRANSITION_EVENTS) as TransitionEventName[];
  const handlers = names.map((name) => {
    const handler = () => onChange(phaseAfter(name));
    target.addEventListener(TRANSITION_EVENTS[name], handler);
    return () => target.removeEventListener(TRANSITION_EVENTS[name], handler);
  });
  return () => handlers.forEach((remove) => remove());
}

/** The current transition phase as a hook. */
export function useTransitionPhase(): TransitionPhase {
  const [phase, setPhase] = useState<TransitionPhase>('idle');
  useEffect(() => listenForTransitionPhase(setPhase), []);
  return phase;
}
