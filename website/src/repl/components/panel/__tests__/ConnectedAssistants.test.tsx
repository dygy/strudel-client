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
import { ConnectedAssistants, SETUP_PAGE_URL } from '../ConnectedAssistants';

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
    await settle(() => !text().includes('Claude Code'));
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe('https://sb.test/auth/v1/user/oauth/grants?client_id=c1');
    expect(init?.method).toBe('DELETE');
    expect(text()).not.toContain('Claude Code');
    expect(text()).toContain('An unnamed assistant');
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

  it('with no assistant says so and links to the setup page', async () => {
    fetchMock.mockImplementation(async () => json([]));
    await render(() => text().includes('No assistant'));
    expect(text()).toContain('No assistant is connected.');
    expect(container!.querySelector('a')!.getAttribute('href')).toBe(SETUP_PAGE_URL);
    expect(buttons()).toEqual([]);
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
