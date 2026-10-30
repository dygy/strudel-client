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

function renderSelect() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<LanguageSelector currentLanguage="en" />));
  return container.querySelector('select')!;
}

describe('LanguageSelector touch size', () => {
  it('is at least 44px tall on a phone', () => {
    setViewport(390, 844);
    expect(renderSelect().className).toMatch(/\bmin-h-11\b/);
  });

  it('keeps the desktop classes on a wide screen', () => {
    setViewport(1440, 900);
    expect(renderSelect().className).toBe('p-2 bg-background rounded-xl text-foreground border-foreground/50 pe-8');
  });
});
