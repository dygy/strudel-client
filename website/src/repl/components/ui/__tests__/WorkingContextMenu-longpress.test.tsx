// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (2.2)
 * On touch, the library's right-click menu opens with a long press: 500 ms held still opens it,
 * moving more than 10px (a scroll) cancels it, the click that ends the press doesn't also pick
 * the row, and a mouse right-click works as before. The read-only (admin) view offers no edit
 * items, and the "⋮" button has a 44px hit area on touch screens.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkingContextMenu, LONG_PRESS_MS } from '../WorkingContextMenu';
import { BurgerMenuButton } from '../BurgerMenuButton';
import { FileTree } from '../../sidebar/FileTree';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.useRealTimers();
});

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

const pointer = (target: Element, type: string, pointerType: string, clientX = 50, clientY = 50) =>
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType, clientX, clientY }));
  });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const menuButtons = () =>
  [...document.querySelectorAll<HTMLButtonElement>('div.fixed button')].map((b) => b.textContent?.trim());

const onRowClick = vi.fn();
const onRename = vi.fn();
const items = [
  { label: 'Rename', onClick: onRename },
  { label: 'Delete', onClick: () => {} },
];

function renderRow() {
  render(
    <WorkingContextMenu items={items}>
      <div data-row="" onClick={onRowClick}>
        row
      </div>
    </WorkingContextMenu>,
  );
  return container!.querySelector('[data-row]')!;
}

describe('long press on touch', () => {
  beforeEach(() => onRowClick.mockClear());

  it('opens the menu after 500 ms held still', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'touch');
    wait(LONG_PRESS_MS - 1);
    expect(menuButtons()).toEqual([]);
    wait(1);
    expect(menuButtons()).toEqual(['Rename', 'Delete']);
  });

  it('the click that ends the long press does not also pick the row, and the menu stays open', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'touch');
    wait(LONG_PRESS_MS);
    pointer(row, 'pointerup', 'touch');
    act(() => (row as HTMLElement).click());
    expect(onRowClick).not.toHaveBeenCalled();
    expect(menuButtons()).toEqual(['Rename', 'Delete']);
    // a later tap picks the row again
    pointer(row, 'pointerdown', 'touch');
    pointer(row, 'pointerup', 'touch');
    act(() => (row as HTMLElement).click());
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('a menu item does the same as from the right-click menu', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'touch');
    wait(LONG_PRESS_MS);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('div.fixed button')][0].click());
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('moving more than 10px (a scroll) cancels it', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'touch', 50, 50);
    pointer(row, 'pointermove', 'touch', 50, 65);
    wait(LONG_PRESS_MS * 2);
    expect(menuButtons()).toEqual([]);
  });

  it('a small wobble (under 10px) still opens it', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'touch', 50, 50);
    pointer(row, 'pointermove', 'touch', 54, 55);
    wait(LONG_PRESS_MS);
    expect(menuButtons()).toEqual(['Rename', 'Delete']);
  });

  it('lifting the finger early is a normal tap', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'touch');
    wait(200);
    pointer(row, 'pointerup', 'touch');
    wait(LONG_PRESS_MS);
    expect(menuButtons()).toEqual([]);
  });

  it('a pen long press opens it too; a held mouse button does not', () => {
    const row = renderRow();
    pointer(row, 'pointerdown', 'mouse');
    wait(LONG_PRESS_MS * 2);
    expect(menuButtons()).toEqual([]);
    pointer(row, 'pointerdown', 'pen');
    wait(LONG_PRESS_MS);
    expect(menuButtons()).toEqual(['Rename', 'Delete']);
  });

  it('nested menus: only the innermost (the row, not the empty-space menu) opens', () => {
    render(
      <WorkingContextMenu items={[{ label: 'New track', onClick: () => {} }]}>
        <WorkingContextMenu items={items}>
          <div data-row="">row</div>
        </WorkingContextMenu>
      </WorkingContextMenu>,
    );
    pointer(container!.querySelector('[data-row]')!, 'pointerdown', 'touch');
    wait(LONG_PRESS_MS);
    expect(menuButtons()).toEqual(['Rename', 'Delete']);
  });
});

describe('mouse right-click', () => {
  it('still opens the menu immediately', () => {
    const row = renderRow();
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    });
    expect(menuButtons()).toEqual(['Rename', 'Delete']);
  });
});

describe('the library tree on touch', () => {
  const tracks = { a: { id: 'a', name: 'alpha', code: '', created: '', modified: '', isMultitrack: false } } as any;
  const noop = () => {};
  const props = (readOnly: boolean) =>
    ({
      tracks,
      folders: {},
      selectedTrack: null,
      activePattern: '',
      onTrackSelect: noop,
      onTrackRename: readOnly ? undefined : noop,
      onTrackDelete: readOnly ? undefined : noop,
      onTrackDuplicate: readOnly ? undefined : noop,
      onTrackInfo: noop,
      onTrackDownload: noop,
      onFolderDownload: noop,
      renamingTrack: null,
      renamingFolder: null,
      renameValue: '',
      setRenameValue: noop,
      onRenameFinish: noop,
      onRenameCancel: noop,
      emptySpaceContextItems: [],
      onSwitchStep: noop,
      renamingStep: null,
      onRenameStepFinish: noop,
      onRenameStepCancel: noop,
      readOnly,
    }) as any;
  const longPressTrack = () => {
    const name = [...container!.querySelectorAll<HTMLElement>('span')].find((s) => s.textContent === 'alpha')!;
    pointer(name, 'pointerdown', 'touch');
    wait(LONG_PRESS_MS);
  };
  // i18n resources load lazily (bare keys or English, depending on the test order), so the
  // read-only menu is compared with the full one rendered in the same environment.
  const fullMenu = () => {
    render(<FileTree {...props(false)} />);
    longPressTrack();
    const labels = menuButtons();
    act(() => root?.unmount());
    container?.remove();
    return labels;
  };

  it('a long press on a track offers the desktop right-click actions', () => {
    // load, rename, duplicate, convert to multitrack, download, info, delete
    expect(fullMenu()).toHaveLength(7);
  });

  it('in the read-only (admin) view it offers only load, download and info', () => {
    const [load, , , , download, info] = fullMenu();
    render(<FileTree {...props(true)} />);
    longPressTrack();
    expect(menuButtons()).toEqual([load, download, info]);
  });

  it('the "⋮" button has a 44px hit area on touch and narrow screens', () => {
    render(<BurgerMenuButton items={items} />);
    const button = container!.querySelector('button')!;
    expect(button.className).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(button.className).toContain('[@media(pointer:coarse)]:min-w-11');
    expect(button.className).toContain('max-md:min-h-11');
    expect(button.className).toContain('max-md:min-w-11');
  });
});
