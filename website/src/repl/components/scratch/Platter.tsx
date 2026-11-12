import { useEffect, useRef } from 'react';
import cx from '@src/cx';
import { SCRATCH_SECONDS_PER_TURN, SCRATCH_WHEEL_SECONDS_PER_NOTCH } from '@strudel/mixer';
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
}: {
  actions: ScratchActions;
  /** The selected deck is attached and playing. */
  active: boolean;
  /** The record is held (by any input: platter, keys or jog). */
  grabbed: boolean;
  size?: PlatterSize;
  label: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<SVGGElement>(null);
  const angleRef = useRef(0); // degrees, for the picture only
  const dragRef = useRef<{ pointerId: number; angle: number } | null>(null);
  const latest = useRef({ actions, active, grabbed });
  latest.current = { actions, active, grabbed };

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

  // Turning at 33⅓ rpm while the deck plays and nobody holds it.
  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== 'function' || reducedMotion()) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null && !dragRef.current && !latest.current.grabbed) {
        angleRef.current += ((now - last) / 1000) * IDLE_DEGREES_PER_SECOND;
        paint();
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
