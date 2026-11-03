// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (2.3: every control in the settings sheet is a 44px target)
 * The language select gets a 44px minimum height on compact screens; the desktop one is unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LanguageSelector } from '../LanguageSelector';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const originalSize = { width: window.innerWidth, height: window.innerHeight };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
});

// useTranslation suspends while a namespace loads, and under isolate:false that depends on which files
// ran before this one on the worker. So wait for the select rather than expect it on the first render.
async function renderSelect() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<LanguageSelector currentLanguage="en" />));
  for (let i = 0; i < 100 && !container.querySelector('select'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return container.querySelector('select')!;
}

describe('LanguageSelector touch size', () => {
  it('is at least 44px tall on a phone', async () => {
    setViewport(390, 844);
    expect((await renderSelect()).className).toMatch(/\bmin-h-11\b/);
  });

  it('keeps the desktop classes on a wide screen', async () => {
    setViewport(1440, 900);
    expect((await renderSelect()).className).toBe(
      'p-2 bg-background rounded-xl text-foreground border-foreground/50 pe-8',
    );
  });
});
