// @vitest-environment jsdom
/**
 * @spec: 019-vinyl-scratch-control (2.2, 2.3; tech §2.4, §2.6)
 * The platter: dragging clockwise moves forwards and counter-clockwise backwards by the angle
 * turned (one turn = 1.8 s), the wheel nudges it without scrolling the page and lets go 250 ms
 * later, and lifting the pointer (up, cancel, lost capture) lets go. Dimmed means inert.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SCRATCH_SECONDS_PER_TURN, SCRATCH_WHEEL_SECONDS_PER_NOTCH } from '@strudel/mixer';
import { Platter, angleDelta, wheelPixels } from '../Platter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: string[] = [];

const actions = {
  // Each call records its source: the platter holds as 'pointer', the wheel as 'wheel'.
  grab: (source?: string) => calls.push(`grab@${source}`) > 0,
  moveBy: (seconds: number, source?: string) => calls.push(`move:${seconds.toFixed(4)}@${source}`),
  release: (source?: string) => calls.push(`release@${source}`),
  autoRelease: (ms: number, source?: string) => calls.push(`auto:${ms}@${source}`),
};

function render(props: { active?: boolean; size?: 'settings' | 'compact' } = {}) {
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Platter actions={actions} active={props.active ?? true} grabbed={false} size={props.size} label="Platter" />,
    ),
  );
  const platter = container.querySelector<HTMLDivElement>('[data-scratch-platter]')!;
  // A 160px platter at the page origin: its centre is (80, 80).
  platter.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 160, height: 160, right: 160, bottom: 160, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return platter;
}

function pointer(el: Element, type: string, x: number, y: number, pointerId = 1) {
  const Ctor = (window as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const event = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function wheel(el: Element, deltaY: number) {
  const event = new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

const quarterTurn = (SCRATCH_SECONDS_PER_TURN / 4).toFixed(4);

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Platter', () => {
  it('a quarter turn clockwise moves forwards by a quarter of 1.8 s', () => {
    const platter = render();
    pointer(platter, 'pointerdown', 160, 80); // 3 o'clock
    pointer(platter, 'pointermove', 80, 160); // 6 o'clock: clockwise on screen
    expect(calls).toEqual(['grab@pointer', `move:${quarterTurn}@pointer`]);
  });

  it('counter-clockwise moves backwards', () => {
    const platter = render();
    pointer(platter, 'pointerdown', 160, 80);
    pointer(platter, 'pointermove', 80, 0); // 12 o'clock
    expect(calls).toEqual(['grab@pointer', `move:-${quarterTurn}@pointer`]);
  });

  it('crossing 9 o’clock is a small move, not a whole turn', () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('%s lets go, once', (type) => {
    const platter = render();
    pointer(platter, 'pointerdown', 160, 80);
    pointer(platter, type, 160, 80);
    expect(calls).toEqual(['grab@pointer', 'release@pointer']);
    // The browser follows up with the other end events: still one release.
    pointer(platter, 'lostpointercapture', 160, 80);
    pointer(platter, 'pointerup', 160, 80);
    expect(calls).toEqual(['grab@pointer', 'release@pointer']);
  });

  it('the touch platter never lets the page scroll or pan (touch-action: none)', () => {
    const platter = render({ size: 'compact' });
    expect(platter.style.touchAction).toBe('none');
    expect(platter.style.width).toBe('220px');
  });

  it('the wheel nudges the record (down = back), stops the page scrolling and arms a 250 ms release', () => {
    const platter = render();
    const down = wheel(platter, 100);
    expect(down.defaultPrevented).toBe(true);
    expect(calls).toEqual([
      'grab@wheel',
      `move:-${SCRATCH_WHEEL_SECONDS_PER_NOTCH.toFixed(4)}@wheel`,
      'auto:250@wheel',
    ]);
    calls = [];
    wheel(platter, -100);
    expect(calls).toEqual(['grab@wheel', `move:${SCRATCH_WHEEL_SECONDS_PER_NOTCH.toFixed(4)}@wheel`, 'auto:250@wheel']);
  });

  it('wheel lines and pages become pixels, and one fling is capped', () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(99);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 })).toBe(300);
    expect(wheelPixels({ deltaY: -5000, deltaMode: 0 })).toBe(-300);
  });

  it('negative: a dimmed platter (deck not playing) ignores drag and wheel, and the page scrolls', () => {
    const platter = render({ active: false });
    expect(platter.getAttribute('aria-disabled')).toBe('true');
    pointer(platter, 'pointerdown', 160, 80);
    pointer(platter, 'pointermove', 80, 160);
    const event = wheel(platter, 100);
    expect(event.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
  });

  it('closing the platter mid-drag lets go', () => {
    const platter = render();
    pointer(platter, 'pointerdown', 160, 80);
    act(() => root?.unmount());
    root = null;
    expect(calls).toEqual(['grab@pointer', 'release@pointer']);
  });
});
