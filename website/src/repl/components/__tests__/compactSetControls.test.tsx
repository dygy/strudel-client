// @vitest-environment jsdom
/**
 * @spec: 022-set-playlist (2.3 set bar in the compact layout; spec 016 compact bar)
 * Regression (2026-11-13 browser check, 360×800, ru): the touch set bar (its button plus a ⋯ menu,
 * 86px) squeezed the compact transition picker to 14px and its label spilled onto Scratch.
 * - the compact bar's set bar is the one Cue/Go button: no ⋯ menu;
 * - End set is in the title bar's More menu, only while a set plays, and it ends the set;
 * - the compact picker keeps at least 44px and its select never spills out of its box.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SetPlayerContextValue } from '../../sets/useSetPlayer';
import { NO_SET, type SetPlayerState } from '../../sets/setPlayer';

// Node >= 25 ships its own global `localStorage` (undefined without --localstorage-file), which
// shadows jsdom's; settings.ts reads it at import time (as in CompactLayout.test.tsx).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

vi.mock('@src/components/auth/AuthButton', () => ({ AuthButton: () => <span data-auth-button="" /> }));
// As in CompactLayout.test.tsx: the REPL's module loader isn't needed here.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// isolate:false: another file may have loaded these with the real AuthButton (memory:
// vitest-module-cache-leak), so load them fresh under the mock.
let mods: {
  CompactControlBar: typeof import('../compact/CompactControlBar').CompactControlBar;
  CompactMoreMenu: typeof import('../compact/CompactMoreMenu').CompactMoreMenu;
  SetPlayerContext: typeof import('../../sets/useSetPlayer').SetPlayerContext;
};

beforeAll(async () => {
  vi.resetModules();
  const i18n = (await import('@src/i18n/i18n')).default;
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common']);
  mods = {
    CompactControlBar: (await import('../compact/CompactControlBar')).CompactControlBar,
    CompactMoreMenu: (await import('../compact/CompactMoreMenu')).CompactMoreMenu,
    SetPlayerContext: (await import('../../sets/useSetPlayer')).SetPlayerContext,
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
});

const PLAYING: SetPlayerState = { setId: 's1', nowItemId: 'a', nextItemId: 'b', cuedItemId: null, phase: 'idle' };

function context(player: SetPlayerState = PLAYING): SetPlayerContextValue {
  return {
    enabled: true,
    signedIn: true,
    sets: [
      {
        id: 's1',
        name: 'Friday',
        version: 'v1',
        items: [
          { id: 'a', trackId: 't1', transition: null },
          { id: 'b', trackId: 't2', transition: null },
        ],
      },
    ],
    loaded: true,
    loadFailed: false,
    tracks: { t1: { id: 't1', name: 'One' }, t2: { id: 't2', name: 'Two' } },
    openSetId: 's1',
    player,
    buttonMode: 'cue',
    endOfSet: false,
    endSet: vi.fn(),
    press: vi.fn(),
  } as unknown as SetPlayerContextValue;
}

function render(ui: React.ReactElement, value: SetPlayerContextValue | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const { SetPlayerContext } = mods;
  act(() => root!.render(<SetPlayerContext.Provider value={value}>{ui}</SetPlayerContext.Provider>));
}

const barContext = { started: true, isDirty: false, handleTogglePlay: () => {}, handleEvaluate: () => {} };
const menuContext = { handleShare: () => {} } as never;
const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('the compact bar while a set plays', () => {
  it('holds only the Cue/Go button: no set ⋯ menu', () => {
    render(<mods.CompactControlBar context={barContext} />, context());
    const bar = document.querySelector('[data-compact-control-bar] [data-set-bar]');
    expect(bar).not.toBeNull();
    expect(bar!.querySelector('[data-set-bar-button]')).not.toBeNull();
    expect(document.querySelector('[data-set-bar-menu]')).toBeNull();
    expect(bar!.querySelectorAll('button')).toHaveLength(1);
  });

  it('the transition picker keeps at least 44px and its select stays in its box', () => {
    render(<mods.CompactControlBar context={barContext} />, context());
    const picker = document.querySelector('[data-compact-control-bar] [data-transition-picker]');
    expect(classes(picker)).toContain('min-w-11');
    expect(classes(picker)).not.toContain('min-w-0');
    expect(classes(picker!.querySelector('select'))).toEqual(expect.arrayContaining(['w-full', 'min-w-0']));
  });
});

describe('End set in the compact More menu', () => {
  const anchorRef = { current: null };

  it('is offered while a set plays, and ends the set and closes the menu', () => {
    const value = context();
    const onClose = vi.fn();
    render(<mods.CompactMoreMenu context={menuContext} open onClose={onClose} anchorRef={anchorRef} />, value);
    const item = document.querySelector('[data-more-end-set]') as HTMLButtonElement;
    expect(item?.textContent).toContain('End set');
    act(() => item.click());
    expect(value.endSet).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('negative: not offered while no set plays, signed out, or outside the REPL', () => {
    render(
      <mods.CompactMoreMenu context={menuContext} open onClose={() => {}} anchorRef={anchorRef} />,
      context(NO_SET),
    );
    expect(document.querySelector('[data-more-end-set]')).toBeNull();
    act(() => root!.unmount());
    container!.remove();
    render(<mods.CompactMoreMenu context={menuContext} open onClose={() => {}} anchorRef={anchorRef} />, {
      ...context(),
      enabled: false,
    } as SetPlayerContextValue);
    expect(document.querySelector('[data-more-end-set]')).toBeNull();
    act(() => root!.unmount());
    container!.remove();
    render(<mods.CompactMoreMenu context={menuContext} open onClose={() => {}} anchorRef={anchorRef} />, null);
    expect(document.querySelector('[data-more-end-set]')).toBeNull();
    // The menu itself still renders its usual items.
    expect(document.querySelector('[data-more-share]')).not.toBeNull();
  });
});
