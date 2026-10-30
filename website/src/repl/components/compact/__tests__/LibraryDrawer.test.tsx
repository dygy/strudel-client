// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (2.2)
 * The library drawer closes after a single track is picked (after the save-before-switch handler
 * ran), stays open for folders, multitrack expansion and steps, and closes on a swipe back
 * towards its edge (mirrored in RTL), but never on a vertical scroll of the tree.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileTree } from '../../sidebar/FileTree';
import { LibraryDrawer, isSwipeToClose } from '../LibraryDrawer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const folders = { f1: { id: 'f1', name: 'test', path: 'test', parent: null, created: '' } } as any;
const step = (id: string, name: string) => ({ id, name, code: '', created: '', modified: '' });
const tracks = {
  a: { id: 'a', name: 'alpha', code: '', created: '', modified: '', isMultitrack: false },
  m: {
    id: 'm',
    name: 'multi',
    code: '',
    created: '',
    modified: '',
    isMultitrack: true,
    steps: [step('s1', 'first step'), step('s2', 'second step')],
    activeStep: 0,
  },
  b: { id: 'b', name: 'beta', code: '', created: '', modified: '', folder: 'f1', isMultitrack: false },
} as any;

const noop = () => {};
const treeProps = (overrides: Record<string, unknown>) =>
  ({
    tracks,
    folders,
    selectedTrack: null,
    activePattern: '',
    onTrackSelect: noop,
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
    ...overrides,
  }) as any;

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

/** The leaf element showing exactly this text (a row's name, a step's name). */
const byText = (text: string) =>
  [...container!.querySelectorAll<HTMLElement>('*')].find(
    (el) => el.textContent?.trim() === text && el.children.length === 0,
  )!;
const click = (text: string) => act(() => byText(text).click());

describe('close on select (FileTree)', () => {
  it('a single track: asks the drawer to close only after the (async) select has resolved', async () => {
    const calls: string[] = [];
    let finish!: () => void;
    render(
      <FileTree
        {...treeProps({
          onTrackSelect: (t: { name: string }) => {
            calls.push(`select ${t.name}`);
            return new Promise<void>((resolve) => (finish = resolve));
          },
          onAfterTrackSelect: () => calls.push('close'),
        })}
      />,
    );
    click('alpha');
    await act(async () => {});
    expect(calls).toEqual(['select alpha']); // the save-before-switch is still running
    await act(async () => finish());
    expect(calls).toEqual(['select alpha', 'close']);
  });

  it('a failed select keeps the drawer open', async () => {
    const onAfterTrackSelect = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <FileTree {...treeProps({ onAfterTrackSelect, onTrackSelect: () => Promise.reject(new Error('offline')) })} />,
    );
    click('alpha');
    await act(async () => {});
    expect(onAfterTrackSelect).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a synchronous select (the desktop sidebar) is still called synchronously', () => {
    const onTrackSelect = vi.fn();
    render(<FileTree {...treeProps({ onTrackSelect })} />);
    click('alpha');
    expect(onTrackSelect).toHaveBeenCalledTimes(1);
  });

  it('a folder opens or closes and the drawer stays open', () => {
    const onAfterTrackSelect = vi.fn();
    render(<FileTree {...treeProps({ onAfterTrackSelect })} />);
    click('test');
    expect(byText('beta')).toBeDefined();
    click('test');
    expect(onAfterTrackSelect).not.toHaveBeenCalled();
  });

  it('a track inside an opened folder closes it', async () => {
    const onAfterTrackSelect = vi.fn();
    render(<FileTree {...treeProps({ onAfterTrackSelect })} />);
    click('test');
    click('beta');
    await act(async () => {});
    expect(onAfterTrackSelect).toHaveBeenCalledTimes(1);
  });

  it('expanding a multitrack and picking one of its steps keep the drawer open', () => {
    const onAfterTrackSelect = vi.fn();
    const onSwitchStep = vi.fn();
    render(<FileTree {...treeProps({ onAfterTrackSelect, onSwitchStep })} />);
    click('multi');
    click('second step');
    expect(onSwitchStep).toHaveBeenCalledWith('m', 1);
    expect(onAfterTrackSelect).not.toHaveBeenCalled();
  });

  it('works without the callback (the desktop sidebar passes none)', () => {
    const onTrackSelect = vi.fn();
    render(<FileTree {...treeProps({ onTrackSelect })} />);
    click('alpha');
    expect(onTrackSelect).toHaveBeenCalledTimes(1);
  });
});

// Review #3: on touch a long press must open the row menu, not start a native drag.
describe('track rows are not draggable on touch or compact screens', () => {
  const original = { width: window.innerWidth, height: window.innerHeight, matchMedia: window.matchMedia };
  const setViewport = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  };
  afterEach(() => {
    setViewport(original.width, original.height);
    window.matchMedia = original.matchMedia;
  });
  const row = () => byText('alpha').closest('[draggable]')!;

  it('a phone (390x844): rows are not draggable', () => {
    setViewport(390, 844);
    render(<FileTree {...treeProps({})} />);
    expect(row().getAttribute('draggable')).toBe('false');
  });

  it('a wide touch screen without hover (a tablet held sideways): rows are not draggable', () => {
    setViewport(1180, 820);
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    render(<FileTree {...treeProps({})} />);
    expect(row().getAttribute('draggable')).toBe('false');
  });

  it('a desktop (1440x900, mouse): rows stay draggable', () => {
    setViewport(1440, 900);
    render(<FileTree {...treeProps({})} />);
    expect(row().getAttribute('draggable')).toBe('true');
  });

  it('the read-only view is never draggable', () => {
    setViewport(1440, 900);
    render(<FileTree {...treeProps({ readOnly: true })} />);
    expect(row().getAttribute('draggable')).toBe('false');
  });
});

describe('swipe to close', () => {
  it('a horizontal swipe of more than 60px towards the start edge closes it', () => {
    expect(isSwipeToClose(-61, 5, false)).toBe(true);
    expect(isSwipeToClose(-60, 0, false)).toBe(false);
    expect(isSwipeToClose(80, 0, false)).toBe(false); // away from the edge
  });

  it('is mirrored in RTL (the drawer comes from the right)', () => {
    expect(isSwipeToClose(61, 5, true)).toBe(true);
    expect(isSwipeToClose(-80, 0, true)).toBe(false);
  });

  it('a mostly vertical move (scrolling the tree) never closes it', () => {
    expect(isSwipeToClose(-70, 90, false)).toBe(false);
    expect(isSwipeToClose(70, -90, true)).toBe(false);
  });

  it('the drawer closes on a swipe gesture and not on a tap', () => {
    const onClose = vi.fn();
    render(
      <LibraryDrawer open onClose={onClose}>
        <div data-content="">library</div>
      </LibraryDrawer>,
    );
    const drawer = container!.querySelector<HTMLElement>('[data-library-drawer]')!;
    const pointer = (type: string, clientX: number, clientY = 100) =>
      act(() => {
        drawer.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX, clientY }),
        );
      });
    pointer('pointerdown', 300);
    pointer('pointerup', 298);
    expect(onClose).not.toHaveBeenCalled();
    pointer('pointerdown', 300);
    pointer('pointerup', 200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed, it is hidden and slid out, but its content stays mounted', () => {
    render(
      <LibraryDrawer open={false} onClose={noop}>
        <div data-content="">library</div>
      </LibraryDrawer>,
    );
    const drawer = container!.querySelector<HTMLElement>('[data-library-drawer]')!;
    expect(drawer.className).toMatch(/\binvisible\b/);
    expect(drawer.className).toMatch(/-translate-x-full/);
    expect(drawer.className).toMatch(/rtl:translate-x-full/);
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(container!.querySelector('[data-content]')).not.toBeNull();
  });

  it('sits at the logical start edge with a 44px close button', () => {
    render(
      <LibraryDrawer open onClose={noop}>
        <div />
      </LibraryDrawer>,
    );
    const drawer = container!.querySelector<HTMLElement>('[data-library-drawer]')!;
    expect(drawer.className).toMatch(/\bstart-0\b/);
    // vertical scrolling stays native everywhere inside; horizontal moves are left to the swipe
    expect(drawer.className).toMatch(/(^|\s)touch-pan-y(\s|$)/);
    expect(drawer.className).toContain('[&_*]:touch-pan-y');
    const close = container!.querySelector<HTMLElement>('[data-library-close]')!;
    expect(close.className).toMatch(/\bh-11\b/);
    expect(close.className).toMatch(/\bw-11\b/);
    expect(close.getAttribute('aria-label')).toBeTruthy();
  });
});
