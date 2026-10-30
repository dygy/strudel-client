// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (review #2)
 * The tree menus are portalled to document.body (the open library drawer has a transform, which
 * would otherwise offset and clip these fixed menus), placed in viewport coordinates, flipped to
 * stay inside the viewport (the "⋮" menu opens upwards on the last rows), and a "⋮" choice never
 * also selects the row the button sits in.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkingContextMenu, fitMenuInViewport } from '../WorkingContextMenu';
import { BurgerMenuButton, placeBurgerMenu } from '../BurgerMenuButton';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const phone = { width: 390, height: 844 };

describe('fitMenuInViewport (long press / right-click menu)', () => {
  const menu = { width: 200, height: 280 };
  it('opens at the pointer when it fits', () => {
    expect(fitMenuInViewport(40, 160, menu, phone)).toEqual({ left: 40, top: 160 });
  });
  it('opens to the left of the pointer near the right edge (an RTL row)', () => {
    expect(fitMenuInViewport(300, 160, menu, phone)).toEqual({ left: 100, top: 160 });
  });
  it('opens above the pointer near the bottom edge (the last rows)', () => {
    expect(fitMenuInViewport(40, 700, menu, phone)).toEqual({ left: 40, top: 420 });
  });
  it('never leaves the viewport', () => {
    const { left, top } = fitMenuInViewport(5, 200, { width: 200, height: 900 }, phone);
    expect(left).toBe(10);
    expect(top).toBe(10);
  });
});

describe('placeBurgerMenu ("⋮" menu)', () => {
  const button = { left: 280, right: 324, top: 100, bottom: 144 };
  const menu = { width: 180, height: 300 };
  it('LTR: below the button, 150px before its right edge, as on the desktop', () => {
    expect(placeBurgerMenu(button, menu, phone, false)).toEqual({ x: 174, y: 148 });
  });
  it('RTL: below the button, from its left edge inwards', () => {
    const rtlButton = { left: 66, right: 110, top: 100, bottom: 144 };
    expect(placeBurgerMenu(rtlButton, menu, phone, true)).toEqual({ x: 66, y: 148 });
  });
  it('flips above the button when it would not fit below (the last row)', () => {
    const last = { left: 280, right: 324, top: 740, bottom: 784 };
    expect(placeBurgerMenu(last, menu, phone, false)).toEqual({ x: 174, y: 436 });
  });
  it('stays inside the viewport horizontally', () => {
    expect(placeBurgerMenu({ left: 0, right: 44, top: 0, bottom: 44 }, menu, phone, false).x).toBe(10);
    expect(placeBurgerMenu({ left: 360, right: 390, top: 0, bottom: 44 }, menu, phone, true).x).toBe(200);
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
});
function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}
const menus = () => [...document.querySelectorAll<HTMLElement>('div.fixed')];

describe('portals', () => {
  it('the right-click menu renders in document.body, outside a transformed ancestor', () => {
    render(
      <div style={{ transform: 'translateX(0)' }} data-drawer="">
        <WorkingContextMenu items={[{ label: 'Rename', onClick: () => {} }]}>
          <div data-row="">row</div>
        </WorkingContextMenu>
      </div>,
    );
    act(() => {
      container!
        .querySelector('[data-row]')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
    });
    expect(menus()).toHaveLength(1);
    expect(menus()[0].parentElement).toBe(document.body);
    expect(container!.querySelector('[data-drawer] div.fixed')).toBeNull();
    expect(menus()[0].style.left).toBe('40px');
    expect(menus()[0].style.top).toBe('60px');
  });

  it('the "⋮" menu renders in document.body, and a choice does not also click the row', () => {
    const onRowClick = vi.fn();
    const onRename = vi.fn();
    render(
      <div style={{ transform: 'translateX(0)' }} onClick={onRowClick}>
        <BurgerMenuButton items={[{ label: 'Rename', onClick: onRename }]} />
      </div>,
    );
    act(() => container!.querySelector('button')!.click());
    expect(menus()).toHaveLength(1);
    expect(menus()[0].parentElement).toBe(document.body);
    act(() => menus()[0].querySelector('button')!.click());
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(0);
  });
});
