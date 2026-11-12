// @vitest-environment jsdom
/**
 * @spec: 019-vinyl-scratch-control (2.1; tech §2.6)
 * The Scratch button opens a floating platter next to it; an outside click or Escape closes it.
 * The compact-bar variant is a 44px button whose popover holds a finger-sized platter, placed
 * beside the transition picker. The popover and Mixer Settings share one runtime (deck choice).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ScratchRuntime } from '../../../scratch/scratchRuntime';
import { ScratchButton } from '../ScratchButton';
import { ScratchSection } from '../ScratchSection';
import { CompactControlBar } from '../../compact/CompactControlBar';
import { fakeRuntime, playing } from './scratchFakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const button = () => q<HTMLButtonElement>('[data-scratch-button]')!;
const popover = () => q('[data-scratch-popover]');
const open = () => act(() => button().click());

function press(key: string) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function mousedown(target: EventTarget) {
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Scratch button and floating platter', () => {
  it('opens a floating platter, and Escape closes it', () => {
    const { runtime } = fakeRuntime();
    render(<ScratchButton runtime={runtime} />);
    expect(popover()).toBeNull();
    open();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(popover()?.getAttribute('data-scratch-popover')).toBe('header');
    expect(popover()?.querySelector('[data-scratch-platter]')?.getAttribute('data-scratch-size')).toBe('settings');
    press('Escape');
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('a click outside closes it; a click inside (the platter) does not', () => {
    const { runtime } = fakeRuntime();
    render(<ScratchButton runtime={runtime} />);
    open();
    mousedown(popover()!.querySelector('[data-scratch-platter]')!);
    expect(popover()).not.toBeNull();
    mousedown(document.body);
    expect(popover()).toBeNull();
  });

  it('negative: other keys leave it open, and the button toggles it closed', () => {
    const { runtime } = fakeRuntime();
    render(<ScratchButton runtime={runtime} />);
    open();
    press('Enter');
    expect(popover()).not.toBeNull();
    open();
    expect(popover()).toBeNull();
  });

  it('closing the popover mid-scratch lets go of the record', async () => {
    const { runtime } = fakeRuntime();
    await playing(runtime);
    render(<ScratchButton runtime={runtime} />);
    open();
    const platter = popover()!.querySelector<HTMLElement>('[data-scratch-platter]')!;
    platter.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 160 }) as DOMRect;
    const Ctor = (window as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
    const down = new Ctor('pointerdown', { bubbles: true, clientX: 160, clientY: 80, button: 0 });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    act(() => {
      platter.dispatchEvent(down);
    });
    expect(runtime.store.get().grabbed).toBe(true);
    press('Escape');
    expect(runtime.store.get().grabbed).toBe(false);
  });

  it('the touch variant is a 44px button with a finger-sized platter above the bar', () => {
    const { runtime } = fakeRuntime();
    render(<ScratchButton touch runtime={runtime} />);
    expect(button().getAttribute('data-scratch-button')).toBe('touch');
    expect(button().className).toContain('min-h-11');
    open();
    expect(popover()?.getAttribute('data-scratch-popover')).toBe('touch');
    expect(popover()?.className).toContain('bottom-full');
    expect(popover()?.querySelector('[data-scratch-platter]')?.getAttribute('data-scratch-size')).toBe('compact');
    press('Escape');
    expect(popover()).toBeNull();
  });

  it('the compact control bar has the Scratch button right after the transition picker', () => {
    render(
      <CompactControlBar
        context={{ started: true, isDirty: false, handleTogglePlay: () => {}, handleEvaluate: () => {} }}
      />,
    );
    const items = [...document.querySelectorAll('[data-compact-control-bar] > *')];
    const picker = items.findIndex((el) => el.hasAttribute('data-transition-picker'));
    expect(picker).toBeGreaterThan(-1);
    expect(items[picker + 1]?.querySelector('[data-scratch-button="touch"]')).not.toBeNull();
  });

  it('the floating platter and Mixer Settings share the deck choice', async () => {
    const { runtime } = fakeRuntime();
    await playing(runtime, { preview: true });
    render(
      <>
        <ScratchSection runtime={runtime as ScratchRuntime} />
        <ScratchButton runtime={runtime} />
      </>,
    );
    open();
    const inPopover = popover()!.querySelector<HTMLButtonElement>('[data-scratch-deck="preview"]')!;
    act(() => inPopover.click());
    const inSettings = document.querySelector('[data-scratch-section] [data-scratch-deck="preview"]')!;
    expect(inSettings.getAttribute('aria-checked')).toBe('true');
  });
});
