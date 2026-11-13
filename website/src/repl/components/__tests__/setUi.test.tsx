// @vitest-environment jsdom
/**
 * @spec: 022-set-playlist (2.1, 2.2, 2.3 set bar, 2.6 who sees sets; tech §2.5)
 * The Set tab (signed out, items, Missing, move buttons, transition picker) and the set bar
 * (hidden without a playing set, Cue / Go / End of set), and no Set tab in the read-only view.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { SetTab } from '../panel/SetTab';
import { SetBar } from '../set/SetBar';
import { getTabNames } from '../panel/panelTabs';
import { SetPlayerContext, type SetPlayerContextValue } from '../../sets/useSetPlayer';
import { NO_SET } from '../../sets/setPlayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common', 'tabs']);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
});

function context(over: Partial<SetPlayerContextValue> = {}): SetPlayerContextValue {
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
          { id: 'b', trackId: 'gone', transition: null },
          { id: 'c', trackId: 'm1', stepName: 'Drop', stepIndex: 0, transition: { type: 'crossfade', length: 8 } },
        ],
      },
    ],
    loaded: true,
    loadFailed: false,
    tracks: {
      t1: { id: 't1', name: 'Groove' },
      m1: { id: 'm1', name: 'Big', isMultitrack: true, steps: [{ name: 'Drop' }] },
    },
    openSetId: 's1',
    setOpenSetId: vi.fn(),
    player: NO_SET,
    buttonMode: 'cue',
    endOfSet: false,
    createSet: vi.fn(async () => ({ ok: false as const, error: 'failed' as const })),
    renameSet: vi.fn(async () => 'ok' as const),
    deleteSet: vi.fn(async () => true),
    addItem: vi.fn(),
    moveItem: vi.fn(),
    removeItem: vi.fn(),
    setItemTransition: vi.fn(),
    playSet: vi.fn(),
    endSet: vi.fn(),
    press: vi.fn(),
    selectItem: vi.fn(),
    requestAddToSet: vi.fn(),
    chooserTarget: null,
    closeChooser: vi.fn(),
    ...over,
  };
}

function render(ui: React.ReactElement, value: SetPlayerContextValue | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SetPlayerContext.Provider value={value}>{ui}</SetPlayerContext.Provider>));
  return container;
}

const q = (selector: string) => container!.querySelector(selector) as HTMLElement | null;

describe('SetTab', () => {
  it('signed out: "Sign in to build a set" and no set controls', () => {
    render(<SetTab />, context({ signedIn: false, enabled: false }));
    expect(q('[data-set-signin]')?.textContent).toBe('Sign in to build a set');
    expect(q('[data-set-new]')).toBeNull();
    expect(q('[data-set-items]')).toBeNull();
  });

  it('outside the REPL (no provider) it also asks to sign in', () => {
    render(<SetTab />, null);
    expect(q('[data-set-signin]')).not.toBeNull();
  });

  it('shows each item with its track (and step) name, its transition, and Missing for a deleted track', () => {
    render(<SetTab />, context());
    const rows = [...container!.querySelectorAll('[data-set-item]')];
    expect(rows.map((row) => row.getAttribute('data-set-item'))).toEqual(['a', 'b', 'c']);
    expect(rows[0].textContent).toContain('Groove');
    expect(rows[1].querySelector('[data-set-missing]')?.textContent).toBe('Missing');
    expect(rows[2].textContent).toContain('Big · Drop');
    expect((rows[2].querySelector('[data-set-transition-type]') as HTMLSelectElement).value).toBe('crossfade');
    expect((rows[2].querySelector('[data-set-transition-length]') as HTMLSelectElement).value).toBe('8');
    expect((rows[0].querySelector('[data-set-transition-type]') as HTMLSelectElement).value).toBe('default');
    expect((rows[0].querySelector('[data-set-transition-length]') as HTMLSelectElement).disabled).toBe(true);
  });

  it('move up is disabled on the first item, move down on the last; the others move', () => {
    const value = context();
    render(<SetTab />, value);
    const rows = [...container!.querySelectorAll('[data-set-item]')];
    expect((rows[0].querySelector('[data-set-move-up]') as HTMLButtonElement).disabled).toBe(true);
    expect((rows[2].querySelector('[data-set-move-down]') as HTMLButtonElement).disabled).toBe(true);
    act(() => (rows[2].querySelector('[data-set-move-up]') as HTMLButtonElement).click());
    expect(value.moveItem).toHaveBeenCalledWith('s1', 2, 1);
    act(() => (rows[1].querySelector('[data-set-remove]') as HTMLButtonElement).click());
    expect(value.removeItem).toHaveBeenCalledWith('s1', 'b');
  });

  it('picking a type sets the transition (length 4 by default); Default clears it', () => {
    const value = context();
    render(<SetTab />, value);
    const select = container!.querySelector('[data-set-item="a"] [data-set-transition-type]') as HTMLSelectElement;
    act(() => {
      select.value = 'dip';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(value.setItemTransition).toHaveBeenCalledWith('s1', 'a', { type: 'dip', length: 4 });
    const other = container!.querySelector('[data-set-item="c"] [data-set-transition-type]') as HTMLSelectElement;
    act(() => {
      other.value = 'default';
      other.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(value.setItemTransition).toHaveBeenCalledWith('s1', 'c', null);
  });

  it('Play set starts from the item clicked first; while playing, a click selects Up next', () => {
    const value = context();
    render(<SetTab />, value);
    act(() => (container!.querySelector('[data-set-item="c"] [data-set-item-select]') as HTMLButtonElement).click());
    act(() => q('[data-set-play]')!.click());
    expect(value.playSet).toHaveBeenCalledWith('s1', 'c');
  });

  it('while the set plays, clicking an item makes it Up next, and End set is offered', () => {
    const value = context({
      player: { setId: 's1', nowItemId: 'a', nextItemId: 'b', cuedItemId: null, phase: 'idle' },
    });
    render(<SetTab />, value);
    act(() => (container!.querySelector('[data-set-item="c"] [data-set-item-select]') as HTMLButtonElement).click());
    expect(value.selectItem).toHaveBeenCalledWith('c');
    expect(q('[data-set-play]')).toBeNull();
    act(() => q('[data-set-end]')!.click());
    expect(value.endSet).toHaveBeenCalled();
  });

  it('a rename to a taken name shows the message and keeps the old name', async () => {
    const value = context({ renameSet: vi.fn(async () => 'name_taken' as const) });
    render(<SetTab />, value);
    act(() => q('[data-set-rename]')!.click());
    const input = q('[data-set-name-input]') as HTMLInputElement;
    await act(async () => {
      input.form!.requestSubmit();
    });
    expect(q('[data-set-name-error]')?.textContent).toBe('A set with this name already exists');
  });

  it('delete asks first, in the page (no browser dialog)', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const value = context();
    render(<SetTab />, value);
    act(() => q('[data-set-delete]')!.click());
    expect(confirm).not.toHaveBeenCalled();
    expect(value.deleteSet).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('The tracks in it stay in your library.');
    confirm.mockRestore();
  });
});

describe('SetBar', () => {
  it('is hidden while no set plays, signed out, or outside the REPL', () => {
    render(<SetBar />, context());
    expect(q('[data-set-bar]')).toBeNull();
    act(() => root!.unmount());
    container!.remove();
    render(<SetBar />, null);
    expect(q('[data-set-bar]')).toBeNull();
  });

  it('shows Now playing and Up next with a Cue button that presses', () => {
    const value = context({
      player: { setId: 's1', nowItemId: 'a', nextItemId: 'c', cuedItemId: null, phase: 'idle' },
    });
    render(<SetBar />, value);
    expect(q('[data-set-bar-now]')?.textContent).toContain('Groove');
    expect(q('[data-set-bar-next]')?.textContent).toContain('Big · Drop');
    const button = q('[data-set-bar-button]') as HTMLButtonElement;
    expect(button.textContent).toBe('Cue');
    act(() => button.click());
    expect(value.press).toHaveBeenCalled();
  });

  it('reads Go when cued', () => {
    render(
      <SetBar touch />,
      context({
        buttonMode: 'go',
        player: { setId: 's1', nowItemId: 'a', nextItemId: 'c', cuedItemId: 'c', phase: 'cued' },
      }),
    );
    expect(q('[data-set-bar-button]')?.textContent).toBe('Go');
    expect(q('[data-set-bar]')?.getAttribute('data-set-bar-touch')).toBe('true');
  });

  it('says End of set at the end, and the button does nothing', () => {
    const value = context({
      endOfSet: true,
      player: { setId: 's1', nowItemId: 'c', nextItemId: null, cuedItemId: null, phase: 'idle' },
    });
    render(<SetBar />, value);
    expect(q('[data-set-bar-next]')?.textContent).toBe('End of set');
    expect((q('[data-set-bar-button]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('End set is in its menu', () => {
    const value = context({
      player: { setId: 's1', nowItemId: 'a', nextItemId: 'b', cuedItemId: null, phase: 'idle' },
    });
    render(<SetBar />, value);
    act(() => q('[data-set-bar-menu]')!.click());
    act(() => q('[data-set-bar-end]')!.click());
    expect(value.endSet).toHaveBeenCalled();
  });
});

// Regression (2026-11-13 browser checks): at 390×844 in Hebrew the touch set bar's long label
// ("האזנה מקדימה") overflowed the compact bar (scrollWidth 413); a width cap then broke the label
// mid-word ("האז / נה / מקד…"). The touch button is now built like its siblings: an icon and a
// one-word caption on one line, the full text in aria-label and title.
describe('the touch set bar is an icon with a one-word caption, like its siblings', () => {
  const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
  const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  // CompactControlBar's BarButton caption.
  const SIBLING_CAPTION = ['text-[10px]', 'leading-none', 'opacity-70', 'first-letter:uppercase'];

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each(LANGUAGES)(
    '%s: headphones + Cue caption, forward + Go caption, on one line, full text in aria-label and title',
    async (lang) => {
      await i18n.changeLanguage(lang);
      for (const mode of ['cue', 'go'] as const) {
        const label = i18n.t(mode === 'cue' ? 'settings:setListCue' : 'settings:setListGo');
        const caption = i18n.t(mode === 'cue' ? 'settings:setListCueShort' : 'settings:setListGoShort');
        render(
          <SetBar touch />,
          context({
            buttonMode: mode,
            player: {
              setId: 's1',
              nowItemId: 'a',
              nextItemId: 'c',
              cuedItemId: mode === 'go' ? 'c' : null,
              phase: mode === 'go' ? 'cued' : 'idle',
            },
          }),
        );
        const bar = q('[data-set-bar]');
        const button = q('[data-set-bar-button]');
        // A 44px tap target that doesn't shrink below its content, laid out like the siblings.
        expect(classes(bar)).toContain('shrink-0');
        expect(classes(button)).toEqual(
          expect.arrayContaining(['min-w-11', 'min-h-11', 'shrink-0', 'flex-col', 'items-center']),
        );
        // The icon: headphones for Cue, forward for Go.
        const icon = button!.querySelector('svg[data-set-bar-icon]');
        expect(icon?.getAttribute('data-set-bar-icon')).toBe(mode === 'cue' ? 'headphones' : 'forward');
        // The caption: the short word, the siblings' classes, one line, never broken or clamped.
        const text = button!.querySelector('[data-set-bar-caption]');
        expect(text!.textContent).toBe(caption);
        expect(classes(text)).toEqual(expect.arrayContaining([...SIBLING_CAPTION, 'whitespace-nowrap']));
        for (const breaking of ['break-words', 'break-all', 'hyphens-auto', 'line-clamp-2', 'truncate']) {
          expect(classes(text)).not.toContain(breaking);
        }
        expect(button!.textContent).toBe(caption);
        // The full "Cue: <Up next>" for screen readers and on hover.
        expect(button!.getAttribute('aria-label')).toBe(`${label}: Big · Drop`);
        expect(button!.getAttribute('title')).toContain(`${label}: Big · Drop`);
        // Logical classes only (no physical left/right).
        expect(bar!.outerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-|text-(left|right)\b/);
        act(() => root!.unmount());
        container!.remove();
        root = container = null;
      }
    },
  );
});

describe('the Set tab in the panel', () => {
  const t = (key: string) => key;
  it('is offered to the signed-in user', () => {
    expect(Object.keys(getTabNames(t))).toContain('set');
  });
  it('is not offered in the read-only admin view', () => {
    expect(Object.keys(getTabNames(t, { readOnly: true }))).not.toContain('set');
  });
});
