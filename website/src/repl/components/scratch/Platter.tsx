import { useEffect, useRef } from 'react';
import cx from '@src/cx';
import {
  SCRATCH_SECONDS_PER_TURN,
  SCRATCH_WHEEL_SECONDS_PER_NOTCH,
  SCRATCH_BRAKE_SECONDS,
  SCRATCH_SPINUP_SECONDS,
  scratchBrakeRate,
  scratchReleaseRate,
  scratchSpinUpRate,
  type ScratchFeel,
} from '@strudel/mixer';
import type { ScratchActions } from '../../scratch/scratchRuntime';

/** 33⅓ rpm, in degrees per second: how fast the record turns while the deck plays. */
const IDLE_DEGREES_PER_SECOND = (100 / 3 / 60) * 360;
/** The wheel lets go this long after it stops (tech §2.4). */
export const WHEEL_RELEASE_MS = 250;
/** A wheel event is at most this many pixels, so one fling never throws the record 8 s back. */
const MAX_WHEEL_PIXELS = 300;

export type PlatterSize = 'settings' | 'compact';

const SIZE_PX: Record<PlatterSize, number> = { settings: 160, compact: 220 };

/** Wheel deltaY in pixels, whatever the event's deltaMode (lines, pages). */
export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const factor = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 800 : 1;
  const pixels = event.deltaY * factor;
  return Math.max(-MAX_WHEEL_PIXELS, Math.min(MAX_WHEEL_PIXELS, pixels));
}

/** The smallest signed turn from `from` to `to` (radians), so crossing ±π never jumps a turn. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * The record's motor as the picture sees it (spec 023 2.2): the same brake and spin-up curves the
 * worklet runs, so the platter slows down when grabbed and speeds up when let go, together with
 * the sound. Times are in milliseconds (requestAnimationFrame timestamps).
 */
export interface PlatterMotor {
  /** 'run': turning at normal speed; 'brake': grabbed, stopping; 'spin': let go, spinning up. */
  mode: 'run' | 'brake' | 'spin';
  /** The rate the current curve started from. */
  from: number;
  /** When it started (ms). */
  since: number;
  /**
   * Spec 025: the curve's length in seconds (the feel's brake, or its spin-up until the plan
   * arrives). Default: spec 023's 0.1 s / 0.4 s.
   */
  seconds?: number;
  /**
   * Spec 023 review 2: the worklet's plan for this release (stretched spin-up, then the snap
   * correction). Without one the nominal 0.4 s spin-up is drawn until it arrives.
   */
  plan?: PlatterSpinPlan | null;
}

/** The part of a release plan the picture needs (see `planScratchRelease`). */
export interface PlatterSpinPlan {
  id?: number;
  upSeconds: number;
  bumpSeconds: number;
  bumpDepth: number;
}

/** The platter's motor rate (× normal speed) at `now` (ms). */
export function platterRate(motor: PlatterMotor, now: number): number {
  const t = Math.max(0, (now - motor.since) / 1000);
  if (motor.mode === 'brake') return scratchBrakeRate(t, motor.from, motor.seconds ?? SCRATCH_BRAKE_SECONDS);
  if (motor.mode === 'spin') {
    if (motor.plan) return scratchReleaseRate(t, { ...motor.plan, fromRate: motor.from }, motor.from);
    const up = motor.seconds ?? SCRATCH_SPINUP_SECONDS;
    return t >= up ? 1 : scratchSpinUpRate(t, motor.from, up);
  }
  return 1;
}

/** The worklet's plan for the running spin-up arrived: follow it from the release on. */
export const platterFollowPlan = (motor: PlatterMotor, plan: PlatterSpinPlan | null | undefined): PlatterMotor =>
  motor.mode === 'spin' && plan ? { ...motor, plan } : motor;

/** Grabbed at `now`: brake (over `brakeSeconds`, spec 025) from whatever rate the platter turns at. */
export const platterGrab = (motor: PlatterMotor, now: number, brakeSeconds?: number): PlatterMotor => ({
  mode: 'brake',
  from: platterRate(motor, now),
  since: now,
  ...(brakeSeconds !== undefined && { seconds: brakeSeconds }),
});

/**
 * Let go at `now`: spin up (over `spinUpSeconds`, spec 025, until the worklet's plan arrives) from
 * whatever rate it turns at (0 after a hold).
 */
export const platterRelease = (motor: PlatterMotor, now: number, spinUpSeconds?: number): PlatterMotor => ({
  mode: 'spin',
  from: Math.max(0, Math.min(1, platterRate(motor, now))),
  since: now,
  ...(spinUpSeconds !== undefined && { seconds: spinUpSeconds }),
});

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The on-screen record (spec 019 2.1–2.3). It turns at 33⅓ rpm while the deck plays. Grabbing it
 * (mouse or finger) replaces the live sound with the scratch sound; turning it clockwise plays
 * forwards, counter-clockwise backwards, and holding it still is silence. The wheel nudges it and
 * lets go 250 ms after the wheel stops. Dimmed and inert when the deck can't be scratched.
 *
 * Clockwise is clockwise in RTL too: it is a physical record, not text.
 */
export function Platter({
  actions,
  active,
  grabbed,
  size = 'settings',
  label,
  className,
  spin,
  feel,
}: {
  actions: ScratchActions;
  /** The selected deck is attached and playing. */
  active: boolean;
  /** The record is held (by any input: platter, keys or jog). */
  grabbed: boolean;
  size?: PlatterSize;
  label: string;
  className?: string;
  /** Spec 023 review 2: the selected deck's latest release plan (from the worklet). */
  spin?: PlatterSpinPlan | null;
  /** Spec 025: the brake and spin-up the sound uses, so the picture follows them. */
  feel?: ScratchFeel;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<SVGGElement>(null);
  const angleRef = useRef(0); // degrees, for the picture only
  const dragRef = useRef<{ pointerId: number; angle: number } | null>(null);
  const latest = useRef({ actions, active, grabbed, feel });
  latest.current = { actions, active, grabbed, feel };
  const motorRef = useRef<PlatterMotor>({ mode: grabbed ? 'brake' : 'run', from: 0, since: 0 });

  // Spec 023: grabbing brakes the picture, letting go spins it up (the same curves as the sound).
  const grabbedBefore = useRef(grabbed);
  useEffect(() => {
    if (grabbedBefore.current === grabbed) return;
    grabbedBefore.current = grabbed;
    const now = nowMs();
    const f = latest.current.feel;
    motorRef.current = grabbed
      ? platterGrab(motorRef.current, now, f?.brakeSeconds)
      : platterRelease(motorRef.current, now, f?.spinUpSeconds);
  }, [grabbed]);
  // The plan arrives a few ms after the release: the picture follows it from the release on.
  useEffect(() => {
    if (!grabbed) motorRef.current = platterFollowPlan(motorRef.current, spin);
  }, [spin]);

  const paint = () => {
    if (discRef.current) discRef.current.style.transform = `rotate(${angleRef.current % 360}deg)`;
  };

  const pointerAngle = (clientX: number, clientY: number): number => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2));
  };

  const letGo = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    latest.current.actions.release('pointer');
  };

  // A drag can't outlive the platter being usable, nor the component.
  useEffect(() => {
    if (!active) letGo();
  }, [active]);
  useEffect(() => () => letGo(), []);

  // Turning while the deck plays: 33⅓ rpm × the motor's rate (braking, stopped, spinning up).
  // The hand's moves are added where they happen (pointer, wheel).
  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== 'function' || reducedMotion()) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        // The rate at the middle of the frame, so a curve is integrated without a lag.
        const rate = platterRate(motorRef.current, (now + last) / 2);
        if (rate !== 0) {
          angleRef.current += ((now - last) / 1000) * IDLE_DEGREES_PER_SECOND * rate;
          paint();
        }
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // The wheel, registered non-passive so preventDefault keeps the page from scrolling.
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!latest.current.active) return;
      event.preventDefault();
      const pixels = wheelPixels(event);
      if (pixels === 0) return;
      // Wheel down pulls the record back.
      const seconds = -(pixels / 100) * SCRATCH_WHEEL_SECONDS_PER_NOTCH;
      const { actions: scratch } = latest.current;
      scratch.grab('wheel');
      scratch.moveBy(seconds, 'wheel');
      // Drops only the wheel's hold: a key or the platter holding the record keeps it.
      scratch.autoRelease(WHEEL_RELEASE_MS, 'wheel');
      angleRef.current += (seconds / SCRATCH_SECONDS_PER_TURN) * 360;
      paint();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active || dragRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch (error: unknown) {
      // Capture is a nicety (keeps the drag outside the disc); the drag works without it.
    }
    dragRef.current = { pointerId: event.pointerId, angle: pointerAngle(event.clientX, event.clientY) };
    actions.grab('pointer');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const angle = pointerAngle(event.clientX, event.clientY);
    const delta = angleDelta(drag.angle, angle);
    drag.angle = angle;
    if (delta === 0) return;
    actions.moveBy((delta / (2 * Math.PI)) * SCRATCH_SECONDS_PER_TURN, 'pointer');
    angleRef.current += (delta * 180) / Math.PI;
    paint();
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    letGo();
  };

  const px = SIZE_PX[size];

  return (
    <div
      ref={rootRef}
      data-scratch-platter=""
      data-scratch-size={size}
      data-active={active ? 'true' : 'false'}
      data-grabbed={grabbed ? 'true' : 'false'}
      role="img"
      aria-label={label}
      aria-disabled={!active}
      title={label}
      style={{ width: px, height: px, touchAction: 'none' }}
      className={cx(
        'relative shrink-0 rounded-full select-none',
        active ? 'cursor-grab' : 'opacity-40 cursor-not-allowed',
        active && grabbed && 'cursor-grabbing',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg viewBox="0 0 100 100" width={px} height={px} aria-hidden="true" className="block pointer-events-none">
        <g ref={discRef} style={{ transformOrigin: '50px 50px' }}>
          <circle cx="50" cy="50" r="49" fill="#111" stroke="#333" strokeWidth="1" />
          {[44, 39, 34, 29, 24].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#262626" strokeWidth="0.6" />
          ))}
          <circle cx="50" cy="50" r="16" fill={grabbed ? '#f97316' : '#3b82f6'} />
          {/* The mark that shows the record turning */}
          <rect x="49" y="35" width="2" height="9" rx="1" fill="#f8fafc" />
          <circle cx="50" cy="50" r="1.8" fill="#e5e5e5" />
        </g>
      </svg>
    </div>
  );
}
