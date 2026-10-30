// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (2.5, signed out)
 * The sign-in page on a 390x844 phone: the Google button is a full-width, at least 44px tall
 * touch target, and the page and card paddings shrink on phones so nothing scrolls sideways.
 * From the `sm` breakpoint up the button and the paddings are as before.
 * jsdom has no layout, so this pins the Tailwind classes; the real overflow is a browser check.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage` (undefined without --localstorage-file), which
// shadows jsdom's; LoginPage reads it on mount, so point it at jsdom's before imports.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

const signInWithOAuth = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null })));
vi.mock('@src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithOAuth,
    },
  },
}));
vi.mock('@src/lib/authUtils', () => ({ forceRefreshSession: async () => null }));
vi.mock('@src/lib/authCookies', () => ({ writeSessionCookies: () => {} }));
vi.mock('@src/lib/loginResume', () => ({ resumeSessionFromLogin: async () => {} }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import LoginPage from '../LoginPage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const originalSize = { width: window.innerWidth, height: window.innerHeight };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderLogin() {
  setViewport(390, 844);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<LoginPage />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
  signInWithOAuth.mockClear();
});

/** The Google button: the only button with the Google "G" (four paths) in it. */
const googleButton = () =>
  [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.querySelectorAll('path').length === 4)!;
const classes = (el: Element) => el.className.split(/\s+/);

describe('the sign-in page on a 390x844 phone', () => {
  it('the Google button is full width and at least 44px tall, and still signs in with Google', () => {
    renderLogin();
    const button = googleButton();
    expect(button).toBeDefined();
    expect(classes(button)).toEqual(expect.arrayContaining(['min-h-11', 'w-full', 'justify-center']));
    act(() => button.click());
    expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));
  });

  it('from sm up the button goes back to its natural width (desktop unchanged)', () => {
    renderLogin();
    expect(classes(googleButton())).toContain('sm:w-auto');
  });

  it('the page and the card use the narrow phone padding, not a bare 32px padding that overflows', () => {
    renderLogin();
    const card = googleButton().closest('.rounded-xl')!;
    const page = card.parentElement!;
    for (const el of [page, card]) {
      expect(classes(el)).toEqual(expect.arrayContaining(['p-4', 'sm:p-8']));
      // An unprefixed p-8 would apply at 390px too: 2 x 32px + 2 x 32px of padding.
      expect(classes(el)).not.toContain('p-8');
    }
    expect(classes(card)).toEqual(expect.arrayContaining(['w-full', 'max-w-md']));
  });
});
