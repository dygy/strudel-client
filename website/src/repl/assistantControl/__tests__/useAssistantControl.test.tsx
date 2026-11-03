// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.8, 2.12)
 * Where control is possible at all. The admin view is read-only and must never be reachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const sockets: string[] = [];
const unsubscribe = vi.fn();

vi.doMock('@src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'a.b.c', user: { id: '11111111-1111-4111-8111-111111111111' } } },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
    },
  },
}));

const { useAssistantControl } = await import('../useAssistantControl');
const { assistantControlAvailable, assistantControlOn, setAssistantControl } = await import('../store');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ readOnly }: { readOnly: boolean }) {
  useAssistantControl({ editorRef: { current: null } }, {}, readOnly);
  return null;
}

let root: Root | null = null;
const render = (readOnly: boolean) => {
  root = createRoot(document.createElement('div'));
  act(() => root!.render(<Harness readOnly={readOnly} />));
};
const unmount = () => {
  act(() => root?.unmount());
  root = null;
};

beforeEach(() => {
  sockets.length = 0;
  unsubscribe.mockClear();
  assistantControlOn.set(false);
  assistantControlAvailable.set(false);
  vi.stubGlobal(
    'WebSocket',
    Object.assign(
      class {
        readyState = 1;
        constructor(url: string) {
          sockets.push(url);
        }
        close() {}
        send() {}
      },
      { OPEN: 1 },
    ),
  );
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.doUnmock('@src/lib/supabase');
  assistantControlOn.set(false);
  assistantControlAvailable.set(false);
});

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

describe('useAssistantControl', () => {
  it('makes control possible, off, with no socket until the switch is on', async () => {
    render(false);
    await settle();
    expect(assistantControlAvailable.get()).toBe(true);
    expect(assistantControlOn.get()).toBe(false);
    expect(sockets).toEqual([]);
  });

  it('opens a socket once on', async () => {
    render(false);
    act(() => setAssistantControl(true));
    await settle();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]).toContain('/mcp/tab?u=');
  });

  it('leaves control impossible in the read-only admin view, whatever is asked', async () => {
    render(true);
    act(() => setAssistantControl(true));
    await settle();
    expect(assistantControlAvailable.get()).toBe(false);
    expect(assistantControlOn.get()).toBe(false);
    expect(sockets).toEqual([]);
  });

  it('turns off when the REPL goes away', async () => {
    render(false);
    act(() => setAssistantControl(true));
    await settle();
    unmount();
    expect(assistantControlOn.get()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
