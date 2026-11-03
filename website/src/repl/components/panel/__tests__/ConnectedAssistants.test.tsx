// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.2)
 * Connected assistants: the list with name and date, Disconnect, the empty state with its link, and
 * failures that say so. Real API module, fake server.
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
import i18n from '@src/i18n/i18n';
import { createOAuthServerApi } from '@src/lib/oauthServerApi';
import {
  CLAUDE_CODE_COMMAND,
  ConnectedAssistants,
  HELPER_COMMAND,
  HELPER_PUBLISHED,
  LIST_REFRESH_MS,
  MCP_ADDRESS,
} from '../ConnectedAssistants';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client = (id: string, name: string) => ({ id, name, uri: '', logo_uri: '' });
const GRANTS = [
  { client: client('c1', 'Claude Code'), scopes: ['email'], granted_at: '2026-11-02T10:00:00Z' },
  { client: client('c2', ''), scopes: [], granted_at: '2026-10-01T10:00:00Z' },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
const api = createOAuthServerApi({
  supabaseUrl: 'https://sb.test',
  anonKey: 'anon',
  getAccessToken: async () => 'token',
});

const text = () => container!.textContent ?? '';
const buttons = () => [...container!.querySelectorAll('button')];

async function settle(until: () => boolean) {
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function render(until: () => boolean) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ConnectedAssistants api={api} />));
  await settle(until);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(GRANTS));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Connected assistants', () => {
  it('lists each assistant with its name and when it was connected', async () => {
    await render(() => text().includes('Claude Code'));
    expect(text()).toContain('Claude Code');
    expect(text()).toContain('Connected on Nov 2, 2026');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.test/auth/v1/user/oauth/grants');
  });

  it('gives an assistant with no name a generic one', async () => {
    await render(() => text().includes('Claude Code'));
    expect(text()).toContain('An unnamed assistant');
  });

  it('Disconnect revokes that one and takes it off the list', async () => {
    await render(() => text().includes('Claude Code'));
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await act(async () => buttons()[0].click());
    const listed = () => [...container!.querySelectorAll('li')].map((li) => li.textContent ?? '');
    await settle(() => listed().length === 1);
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe('https://sb.test/auth/v1/user/oauth/grants?client_id=c1');
    expect(init?.method).toBe('DELETE');
    expect(listed()[0]).toContain('An unnamed assistant');
  });

  it('keeps it on the list and says so if Disconnect fails', async () => {
    await render(() => text().includes('Claude Code'));
    fetchMock.mockImplementation(async () => json({ msg: 'boom' }, 500));
    await act(async () => buttons()[0].click());
    await settle(() => text().includes('Could not disconnect'));
    expect(text()).toContain('Claude Code');
    expect(text()).toContain('Could not disconnect');
    expect(buttons()[0].disabled).toBe(false);
  });

  it('a double press sends one revoke', async () => {
    await render(() => text().includes('Claude Code'));
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const before = fetchMock.mock.calls.length;
    await act(async () => buttons()[0].click());
    await act(async () => buttons()[0].click());
    expect(fetchMock.mock.calls.length - before).toBe(1);
    await act(async () => answer(new Response(null, { status: 204 })));
  });

  it('explains what Disconnect does and where it stops', async () => {
    await render(() => text().includes('Claude Code'));
    expect(text()).toContain('Disconnect ends access through Strudel at once.');
  });

  it('with no assistant says so, and shows the connect steps open', async () => {
    fetchMock.mockImplementation(async () => json([]));
    await render(() => text().includes('No assistant'));
    expect(text()).toContain('No assistant is connected.');
    const steps = container!.querySelector('[data-testid="connect-steps"]')!;
    expect(steps.closest('details')).toBeNull();
    expect(steps.textContent).toContain(MCP_ADDRESS);
    expect(steps.textContent).toContain(CLAUDE_CODE_COMMAND);
  });

  it('with assistants connected keeps the steps collapsed under Connect another assistant', async () => {
    await render(() => text().includes('Claude Code'));
    const details = container!.querySelector<HTMLDetailsElement>('[data-testid="connect-another"]')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Connect another assistant');
    expect(details.querySelector('[data-testid="connect-steps"]')).not.toBeNull();
  });

  it('leaves the helper command out until the package is on npm', async () => {
    fetchMock.mockImplementation(async () => json([]));
    await render(() => text().includes('No assistant'));
    expect(HELPER_PUBLISHED).toBe(false);
    expect(text()).not.toContain('strudel-mcp');
    expect(text()).not.toContain('Local helper');
  });

  it('a list that fails to load still shows how to connect', async () => {
    fetchMock.mockImplementation(async () => json({ msg: 'boom' }, 500));
    await render(() => text().includes('Could not load'));
    expect(container!.querySelector('[data-testid="connect-steps"]')).not.toBeNull();
  });

  it('a refresh read before a Disconnect finished does not bring the assistant back', async () => {
    // Only the refresh interval: faking the rest makes React and i18next spin forever on Node 24.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<ConnectedAssistants api={api} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      for (let i = 0; i < 100 && !container.querySelector('li'); i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      let answerList: (response: Response) => void = () => {};
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answerList = resolve)));
      await act(async () => vi.advanceTimersByTimeAsync(LIST_REFRESH_MS));
      fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
      await act(async () => {
        container!.querySelector<HTMLButtonElement>('li button')!.click();
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        answerList(json(GRANTS));
        await vi.advanceTimersByTimeAsync(0);
      });
      const names = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
      expect(names).toHaveLength(1);
      expect(names[0]).toContain('An unnamed assistant');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll in a hidden tab, and catches up on its return', async () => {
    // Only the refresh interval: faking the rest makes React and i18next spin forever on Node 24.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      visibility.mockReturnValue('visible');
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<ConnectedAssistants api={api} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      fetchMock.mockClear();
      visibility.mockReturnValue('hidden');
      await act(async () => vi.advanceTimersByTimeAsync(LIST_REFRESH_MS * 3));
      expect(fetchMock).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('the address and the command are the real ones', () => {
    expect(HELPER_COMMAND).toContain('strudel_mcp');
    expect(MCP_ADDRESS).toBe('https://strudel.dygy.app/mcp');
    expect(CLAUDE_CODE_COMMAND).toContain(MCP_ADDRESS);
  });

  // @spec: 018-strudel-mcp-server (2.2) @regression. With no transport, Claude Code runs the address as a program.
  it('gives Claude Code a whole command for an HTTP server, needing nothing else', () => {
    expect(CLAUDE_CODE_COMMAND).toBe('claude mcp add --transport http strudel https://strudel.dygy.app/mcp');
    expect(CLAUDE_CODE_COMMAND).not.toMatch(/--transport (sse|stdio)|<|\[/);
  });

  describe('Copy', () => {
    const firstCopy = () =>
      [...container!.querySelectorAll('[data-testid="connect-steps"] button')][0] as HTMLButtonElement;
    const stubClipboard = (writeText: () => Promise<void>) =>
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('puts the address on the clipboard and confirms for 2 seconds', async () => {
      fetchMock.mockImplementation(async () => json([]));
      const writeText = vi.fn(async () => {});
      stubClipboard(writeText);
      await render(() => text().includes('No assistant'));
      await act(async () => firstCopy().click());
      expect(writeText).toHaveBeenCalledWith(MCP_ADDRESS);
      expect(firstCopy().textContent).toBe('Copied');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2100));
      });
      expect(firstCopy().textContent).toBe('Copy');
    }, 5000);

    it('if the browser refuses, selects the text and says so', async () => {
      fetchMock.mockImplementation(async () => json([]));
      stubClipboard(async () => {
        throw new DOMException('denied', 'NotAllowedError');
      });
      await render(() => text().includes('No assistant'));
      await act(async () => firstCopy().click());
      expect(container!.querySelector('[role="alert"]')!.textContent).toContain('selected');
      expect(window.getSelection()!.toString()).toBe(MCP_ADDRESS);
    });
  });

  it('refreshes the list while open, so a new assistant appears within 30 seconds', async () => {
    // Only the refresh interval: faking the rest makes React and i18next spin forever on Node 24.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      fetchMock.mockImplementation(async () => json([]));
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<ConnectedAssistants api={api} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      for (let i = 0; i < 100 && !text().includes('No assistant'); i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      expect(text()).toContain('No assistant');
      expect(LIST_REFRESH_MS).toBeLessThanOrEqual(30_000);
      fetchMock.mockImplementation(async () => json(GRANTS));
      await act(async () => vi.advanceTimersByTimeAsync(LIST_REFRESH_MS));
      expect(container!.querySelector('li')?.textContent).toContain('Claude Code');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refresh that fails leaves the list as it was', async () => {
    // Only the refresh interval: faking the rest makes React and i18next spin forever on Node 24.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<ConnectedAssistants api={api} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      for (let i = 0; i < 100 && !text().includes('Claude Code'); i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      fetchMock.mockImplementation(async () => json({ msg: 'boom' }, 500));
      await act(async () => vi.advanceTimersByTimeAsync(LIST_REFRESH_MS));
      expect(container!.querySelector('li')?.textContent).toContain('Claude Code');
      expect(text()).not.toContain('Could not load');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops refreshing when closed', async () => {
    // Only the refresh interval: faking the rest makes React and i18next spin forever on Node 24.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<ConnectedAssistants api={api} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => root!.unmount());
      root = null;
      fetchMock.mockClear();
      await vi.advanceTimersByTimeAsync(LIST_REFRESH_MS * 2);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so if the list cannot be loaded, and can try again', async () => {
    fetchMock.mockImplementation(async () => json({ msg: 'boom' }, 500));
    await render(() => text().includes('Could not load'));
    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
    fetchMock.mockImplementation(async () => json(GRANTS));
    await act(async () => buttons()[0].click());
    await settle(() => text().includes('Claude Code'));
    expect(text()).toContain('Claude Code');
  });

  it('writes the date in the current language', async () => {
    await i18n.changeLanguage('ru');
    await render(() => text().includes('Claude Code'));
    expect(text()).toContain('2026');
    expect(text()).toContain('Подключён');
  });

  it('a track-free name with markup stays plain text', async () => {
    fetchMock.mockImplementation(async () =>
      json([{ ...GRANTS[0], client: client('c9', '<img src=x onerror=alert(1)>') }]),
    );
    await render(() => text().includes('<img'));
    expect(container!.querySelector('img')).toBeNull();
  });
});
