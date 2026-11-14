// @vitest-environment jsdom
/**
 * @spec: 025-scratch-feel-controls (functional §2.3, AC 3: languages)
 * When the user opens the Scratch section in any of the 9 languages, the new labels appear in that
 * language: Snap and its four options, Brake, Spin-up, Reset and the hint. The key-presence check
 * lives in i18n/__tests__/scratchFeelKeys025.test.ts; this one renders the section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { ScratchSection } from '../ScratchSection';
import { fakeRuntime } from './scratchFakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOCALES = ['ar', 'en', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'] as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const strings = async (locale: string): Promise<Record<string, string>> =>
  (await import(`../../../../i18n/locales/${locale}/settings.json`)).default;

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

/** The visible text of every spec 025 control, in the order of the keys below. */
function renderedLabels() {
  const q = (sel: string) => container!.querySelector(sel)!;
  const options = [...container!.querySelectorAll<HTMLOptionElement>('[data-scratch-snap] option')];
  return {
    scratchSnap: q('[data-scratch-snap] label').textContent,
    scratchSnapOff: options[0].textContent,
    scratchSnapHalf: options[1].textContent,
    scratchSnapBeat: options[2].textContent,
    scratchSnapBar: options[3].textContent,
    scratchBrake: q('[data-scratch-feel="brakeSeconds"] label').textContent,
    scratchSpinUp: q('[data-scratch-feel="spinUpSeconds"] label').textContent,
    scratchFeelReset: q('[data-scratch-feel-reset]').textContent,
    scratchFeelHint: q('[data-scratch-feel-hint]').textContent,
  };
}

function section() {
  const { runtime } = fakeRuntime({
    readSnapGrid: () => 'beat',
    writeSnapGrid: () => {},
    readFeel: () => ({ brakeSeconds: 0.1, spinUpSeconds: 0.4 }),
    writeFeel: () => {},
  });
  mount(<ScratchSection runtime={runtime} />);
}

beforeEach(async () => {
  await i18n.loadNamespaces('settings');
});

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  await i18n.changeLanguage('en');
});

describe('Scratch section labels in each language (025 §2.3)', () => {
  it.each(LOCALES)(
    '%s: Snap, its four options, Brake, Spin-up, Reset and the hint show in that language',
    async (locale) => {
      await i18n.changeLanguage(locale);
      await i18n.loadNamespaces('settings');
      const own = await strings(locale);
      section();
      const shown = renderedLabels();
      for (const [key, text] of Object.entries(shown)) expect(text, `${locale}.${key}`).toBe(own[key]);
    },
  );

  it.each(LOCALES.filter((l) => l !== 'en'))('negative pair: %s shows no English label', async (locale) => {
    await i18n.changeLanguage(locale);
    await i18n.loadNamespaces('settings');
    const en = await strings('en');
    section();
    const shown = renderedLabels();
    for (const [key, text] of Object.entries(shown)) expect(text, `${locale}.${key}`).not.toBe(en[key]);
  });
});
