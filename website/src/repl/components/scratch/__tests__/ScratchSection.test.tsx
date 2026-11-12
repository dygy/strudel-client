// @vitest-environment jsdom
/**
 * @spec: 019-vinyl-scratch-control (2.1, 2.5; tech §2.6)
 * Mixer Settings → Scratch: the platter (dimmed while the deck can't be scratched), the deck
 * switch (Headphones only while the headphone preview runs; absent without the mixer), MIDI
 * Learn / Forget with the assigned control, and Learn disabled with a note without MIDI.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's; settings.ts reads it at
// import time, so point it at jsdom's before imports.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import en from '@src/i18n/locales/en/settings.json';
import type { ScratchRuntime } from '../../../scratch/scratchRuntime';
import { ScratchSection, withLtrKeys } from '../ScratchSection';
import { ShortcutsTab } from '../../panel/ShortcutsTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeJog, fakeRuntime, playing } from './scratchFakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(runtime: ScratchRuntime, props: { withPreview?: boolean } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ScratchSection runtime={runtime} {...props} />));
  return container;
}

const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const deckButton = (deck: string) => q<HTMLButtonElement>(`[data-scratch-deck="${deck}"]`);
const platter = () => q('[data-scratch-platter]')!;
const text = (selector: string) => q(selector)?.textContent ?? '';

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Mixer Settings: Scratch section', () => {
  it('shows the platter, the deck switch, the MIDI controls and the shortcut hint', () => {
    const { runtime } = fakeRuntime();
    render(runtime);
    expect(q('[data-scratch-section]')).not.toBeNull();
    expect(platter()).not.toBeNull();
    expect(deckButton('main')?.getAttribute('aria-checked')).toBe('true');
    expect(deckButton('preview')).not.toBeNull();
    expect(q('[data-scratch-midi-learn]')).not.toBeNull();
    expect(text('[data-scratch-shortcut-hint]')).toBe(en.scratchShortcutHint);
  });

  it('dimmed while nothing plays on the deck; usable once the deck plays', async () => {
    const { runtime } = fakeRuntime();
    render(runtime);
    expect(platter().getAttribute('data-active')).toBe('false');
    // The speakers' deck isn't attached yet (no pre-gain slot): say so instead of throwing.
    expect(text('[data-scratch-status]')).toBe(en.scratchUnavailable);
    await act(async () => runtime.attachMain({} as AudioContext, {}));
    expect(text('[data-scratch-status]')).toBe(en.scratchNotPlaying);
    act(() => runtime.setPlaying('main', true));
    expect(platter().getAttribute('data-active')).toBe('true');
    expect(text('[data-scratch-status]')).toBe('');
  });

  it('Headphones is disabled until the headphone preview runs, then selecting it is remembered', async () => {
    const { runtime, written } = fakeRuntime();
    render(runtime);
    expect(deckButton('preview')!.disabled).toBe(true);
    expect(deckButton('preview')!.title).toBe(en.scratchPreviewOff);
    await act(async () => playing(runtime, { preview: true }));
    expect(deckButton('preview')!.disabled).toBe(false);
    act(() => deckButton('preview')!.click());
    expect(deckButton('preview')!.getAttribute('aria-checked')).toBe('true');
    expect(written).toEqual(['preview']);
  });

  it('a stored Headphones choice shows Speakers selected until the preview runs (review #6)', async () => {
    const { runtime, written } = fakeRuntime({ readSelected: () => 'preview' });
    render(runtime, { withPreview: false });
    expect(deckButton('main')!.getAttribute('aria-checked')).toBe('true');
    act(() => root!.unmount());
    root = null;
    container!.remove();
    render(runtime);
    expect(deckButton('main')!.getAttribute('aria-checked')).toBe('true');
    expect(deckButton('preview')!.getAttribute('aria-checked')).toBe('false');
    await act(async () => playing(runtime, { preview: true }));
    expect(deckButton('preview')!.getAttribute('aria-checked')).toBe('true');
    expect(written).toEqual([]); // the stored choice was never overwritten
  });

  it('negative: without the preview mixer only Speakers is offered', () => {
    const { runtime } = fakeRuntime();
    render(runtime, { withPreview: false });
    expect(deckButton('main')).not.toBeNull();
    expect(deckButton('preview')).toBeNull();
  });

  it('Learn shows the waiting note, then the controller name and control; Forget clears it', async () => {
    const midi = fakeJog();
    const { runtime } = fakeRuntime({ loadMidiJog: vi.fn(async () => midi.jog) });
    render(runtime);
    expect(text('[data-scratch-midi-status]')).toBe(en.scratchMidiNone);
    await act(async () => {
      q<HTMLButtonElement>('[data-scratch-midi-learn]')!.click();
    });
    expect(text('[data-scratch-midi-status]')).toBe(en.scratchMidiLearning);
    expect(q<HTMLButtonElement>('[data-scratch-midi-learn]')!.disabled).toBe(true);
    await act(async () =>
      midi.finish({ inputName: 'DJ Control', channel: 2, controller: 33, encoding: 'twos-complement' }),
    );
    expect(text('[data-scratch-midi-status]')).toBe('DJ Control · control 33, channel 2');
    act(() => q<HTMLButtonElement>('[data-scratch-midi-forget]')!.click());
    expect(text('[data-scratch-midi-status]')).toBe(en.scratchMidiNone);
    expect(q('[data-scratch-midi-forget]')).toBeNull();
  });

  it('a Learn that times out keeps the old state and says nothing changed', async () => {
    const midi = fakeJog();
    const { runtime } = fakeRuntime({ loadMidiJog: vi.fn(async () => midi.jog) });
    render(runtime);
    await act(async () => {
      q<HTMLButtonElement>('[data-scratch-midi-learn]')!.click();
    });
    await act(async () => midi.finish(null));
    expect(text('[data-scratch-midi-status]')).toBe(en.scratchMidiNone);
    expect(text('[data-scratch-midi-timeout]')).toBe(en.scratchMidiLearnTimeout);
  });

  it('no MIDI support: Learn is disabled with a note, and the platter keeps working', async () => {
    const { runtime } = fakeRuntime({ midiSupported: () => false });
    await playing(runtime);
    render(runtime);
    expect(q<HTMLButtonElement>('[data-scratch-midi-learn]')!.disabled).toBe(true);
    expect(text('[data-scratch-midi-status]')).toBe(en.scratchMidiUnsupported);
    expect(platter().getAttribute('data-active')).toBe('true');
  });

  it('MIDI access denied: Learn is disabled with the denied note', async () => {
    const midi = fakeJog();
    const { runtime } = fakeRuntime({ loadMidiJog: vi.fn(async () => midi.jog) });
    // The real jog resolves Learn with null after reporting unavailable.
    (midi.jog.learn as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      midi.fail('denied');
      return null;
    });
    render(runtime);
    await act(async () => {
      q<HTMLButtonElement>('[data-scratch-midi-learn]')!.click();
    });
    expect(q<HTMLButtonElement>('[data-scratch-midi-learn]')!.disabled).toBe(true);
    expect(text('[data-scratch-midi-status]')).toBe(en.scratchMidiDenied);
    expect(q('[data-scratch-midi-timeout]')).toBeNull();
  });
});

describe('key combinations stay left-to-right in RTL languages', () => {
  const hintIn = (lang: string): string =>
    JSON.parse(readFileSync(resolve(process.cwd(), `website/src/i18n/locales/${lang}/settings.json`), 'utf8'))
      .scratchShortcutHint;

  /** The key combinations withLtrKeys puts in their own LTR element, and the text between. */
  function ltrParts(text: string) {
    const parts = withLtrKeys(text);
    const keys = parts.filter((p) => React.isValidElement(p)) as React.ReactElement<{
      dir?: string;
      children?: string;
    }>[];
    return {
      keys,
      rejoined: parts
        .map((p) =>
          typeof p === 'string' ? p : String((p as React.ReactElement<{ children?: string }>).props.children),
        )
        .join(''),
    };
  }

  it.each(['ar', 'he', 'en', 'es', 'fr', 'ko', 'ru', 'sr', 'zh'])(
    '%s: both combinations are LTR elements, no text lost',
    (lang) => {
      const hint = hintIn(lang);
      const { keys, rejoined } = ltrParts(hint);
      expect(keys.map((k) => k.props.dir)).toEqual(['ltr', 'ltr']);
      expect(keys.map((k) => k.props.children?.slice(-1))).toEqual(['←', '→']);
      expect(keys.every((k) => k.props.children?.startsWith('Alt+'))).toBe(true);
      expect(rejoined).toBe(hint);
    },
  );

  it('the rendered hint wraps each combination in <kbd dir="ltr">', () => {
    const { runtime } = fakeRuntime();
    render(runtime);
    const kbds = [...q('[data-scratch-shortcut-hint]')!.querySelectorAll('kbd')];
    expect(kbds.map((k) => [k.getAttribute('dir'), k.textContent])).toEqual([
      ['ltr', 'Alt+Shift+←'],
      ['ltr', 'Alt+Shift+→'],
    ]);
  });

  it.each(['ar', 'he', 'en', 'es', 'fr', 'ko', 'ru', 'sr', 'zh'])(
    '%s: the Windows note (Alt+Shift may switch the layout) keeps its keys left-to-right',
    (lang) => {
      const note: string = JSON.parse(
        readFileSync(resolve(process.cwd(), `website/src/i18n/locales/${lang}/settings.json`), 'utf8'),
      ).scratchShortcutWindowsNote;
      expect(note).toContain('Windows');
      const keys = withLtrKeys(note).filter((p) => React.isValidElement(p)) as React.ReactElement<{
        dir?: string;
        children?: string;
      }>[];
      expect(keys).toHaveLength(1);
      expect(keys[0].props.dir).toBe('ltr');
      expect(keys[0].props.children).toMatch(/^Alt\+/);
    },
  );

  it('the section shows the Windows layout note under the shortcut hint', () => {
    const { runtime } = fakeRuntime();
    render(runtime);
    expect(text('[data-scratch-shortcut-note]')).toBe(en.scratchShortcutWindowsNote);
    expect(q('[data-scratch-shortcut-note] kbd')?.textContent).toBe('Alt+Shift');
  });

  it('negative: text without a key combination is returned unchanged', () => {
    expect(withLtrKeys('No keys here (Alt alone, or + signs).')).toEqual(['No keys here (Alt alone, or + signs).']);
  });

  it('the Shortcuts tab lays every key row out left to right', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<ShortcutsTab />));
    const rows = [...container.querySelectorAll('[data-shortcut-keys]')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.getAttribute('dir') === 'ltr')).toBe(true);
    const scratchRow = rows.find((row) => row.textContent?.includes('← / →'));
    expect(scratchRow).toBeDefined();
  });
});
