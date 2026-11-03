// @vitest-environment jsdom
/**
 * Sign-out first waits for unsaved text to be saved, up to 2 s, so the button says it's working and
 * can't be pressed twice.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

let finish: () => void = () => {};
const signOut = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
const MOCKED = ['../../../hooks/useAuth'];

let AuthButton: typeof import('../AuthButton').AuthButton;
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../../../hooks/useAuth', () => ({
    useAuth: () => ({
      user: { id: 'u', email: 'u@example.test', name: 'U' },
      signInWithGoogle: async () => {},
      signOut,
      loading: false,
    }),
  }));
  const { default: i18n } = await import('@src/i18n/i18n');
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['auth', 'common']);
  ({ AuthButton } = await import('../AuthButton'));
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(() => {
  MOCKED.forEach((id) => vi.doUnmock(id));
  vi.resetModules();
});

describe('AuthButton', () => {
  it('shows it is signing out, and a second press does nothing', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => root.render(React.createElement(AuthButton, { showProfile: false })));
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Sign out');
    await React.act(async () => button.click());
    expect(button.textContent).toBe('Signing out...');
    expect(button.disabled).toBe(true);
    await React.act(async () => button.click());
    expect(signOut).toHaveBeenCalledOnce();
    await React.act(async () => finish());
    expect(button.textContent).toBe('Sign out');
    React.act(() => root.unmount());
    container.remove();
  });
});
