// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (2.1, slice 1)
 * The consent flow, with the real API module over a fake fetch: signed out goes through login and
 * back with authorization_id kept, Allow and Deny follow Supabase's redirect untouched, and
 * "already consented" needs no decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ConsentPage from '../ConsentPage';
import { createOAuthServerApi } from '@src/lib/oauthServerApi';
import { redirectTargetFromSearch, safeRedirectPath } from '@src/lib/authRedirect';
import i18n from '@src/i18n/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://client.test/callback',
  client: { id: 'c1', name: 'Claude Code', uri: 'https://client.test', logo_uri: '' },
  user: { id: 'u1', email: 'u@example.test' },
  scope: 'openid email',
};
const REDIRECT = 'https://client.test/callback?code=abc&state=xyz';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

const allow = () => container!.querySelector<HTMLButtonElement>('[data-testid="consent-allow"]');
const deny = () => container!.querySelector<HTMLButtonElement>('[data-testid="consent-deny"]');
const text = () => container!.textContent ?? '';
const consentCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/consent'));

async function settle(until: () => boolean) {
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function open(url: string, { token = 'user-token' as string | null } = {}) {
  window.history.replaceState(null, '', url);
  const api = createOAuthServerApi({
    supabaseUrl: 'https://sb.test',
    anonKey: 'anon',
    getAccessToken: async () => token,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ConsentPage deps={{ api, navigate }} />));
  // useTranslation suspends until i18n is ready, and then the request has to come back.
  await settle(() => !/Checking/.test(text()) && text() !== '');
}

async function click(button: HTMLButtonElement | null) {
  await act(async () => {
    button!.click();
  });
}

beforeEach(async () => {
  // isolate:false: another test file may have left i18n in another language.
  await i18n.changeLanguage('en');
  navigate = vi.fn<(url: string) => void>();
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(DETAILS));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('a request waiting for a decision', () => {
  it('names the client and offers Allow and Deny, in English from the auth namespace', async () => {
    await open('/oauth/consent?authorization_id=auth-1');
    expect(text()).toContain('Claude Code wants to connect to your Strudel account.');
    expect(allow()!.textContent).toBe('Allow');
    expect(deny()!.textContent).toBe('Deny');
    expect(navigate).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.test/auth/v1/oauth/authorizations/auth-1');
  });

  it('titles the browser tab in the current language', async () => {
    await i18n.changeLanguage('ru');
    await open('/oauth/consent?authorization_id=auth-1');
    await settle(() => document.title.includes('ассистента'));
    expect(document.title).toBe('Подключение ассистента - Strudel');
  });

  it('falls back to a generic name when the client has none', async () => {
    fetchMock.mockImplementation(async () => json({ ...DETAILS, client: { ...DETAILS.client, name: '' } }));
    await open('/oauth/consent?authorization_id=auth-1');
    expect(text()).toContain('An unnamed assistant wants to connect');
  });

  it('shows a name with markup as plain text', async () => {
    const name = '<img src=x onerror=alert(1)>';
    fetchMock.mockImplementation(async () => json({ ...DETAILS, client: { ...DETAILS.client, name } }));
    await open('/oauth/consent?authorization_id=auth-1');
    expect(text()).toContain(name);
    expect(container!.querySelector('img[src="x"]')).toBeNull();
  });
});

describe.each([
  ['Allow', 'approve', allow],
  ['Deny', 'deny', deny],
] as const)('pressing %s', (_label, action, button) => {
  it(`sends '${action}' once and follows the returned redirect untouched`, async () => {
    await open('/oauth/consent?authorization_id=auth-1');
    fetchMock.mockImplementation(async () => json({ redirect_url: REDIRECT }));
    await click(button());
    await settle(() => navigate.mock.calls.length > 0);
    expect(consentCalls()).toHaveLength(1);
    expect(JSON.parse(String(consentCalls()[0][1]?.body))).toEqual({ action });
    expect(navigate.mock.calls).toEqual([[REDIRECT]]);
    expect(allow()).toBeNull();
    expect(text()).toContain('You can close this tab');
  });

  it('disables both buttons while waiting, so a double click sends one decision', async () => {
    await open('/oauth/consent?authorization_id=auth-1');
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await click(button());
    expect(allow()!.disabled).toBe(true);
    expect(deny()!.disabled).toBe(true);
    await click(button());
    expect(consentCalls()).toHaveLength(1);
    await act(async () => answer(json({ redirect_url: REDIRECT })));
    await settle(() => navigate.mock.calls.length > 0);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('stays on the page with a message when the decision fails, and can be retried', async () => {
    await open('/oauth/consent?authorization_id=auth-1');
    fetchMock.mockImplementation(async () => json({ msg: 'boom' }, 500));
    await click(button());
    await settle(() => !!container!.querySelector('[role="alert"]'));
    expect(navigate).not.toHaveBeenCalled();
    expect(button()!.disabled).toBe(false);

    fetchMock.mockImplementation(async () => json({ redirect_url: REDIRECT }));
    await click(button());
    await settle(() => navigate.mock.calls.length > 0);
    expect(navigate.mock.calls).toEqual([[REDIRECT]]);
  });

  it('never navigates to an unsafe redirect', async () => {
    await open('/oauth/consent?authorization_id=auth-1');
    fetchMock.mockImplementation(async () => json({ redirect_url: 'javascript:alert(1)' }));
    await click(button());
    await settle(() => !!container!.querySelector('[role="alert"]'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes to login when the session ends meanwhile', async () => {
    await open('/oauth/consent?authorization_id=auth-1');
    fetchMock.mockImplementation(async () => json({ msg: 'expired' }, 401));
    await click(button());
    await settle(() => navigate.mock.calls.length > 0);
    expect(navigate.mock.calls[0][0]).toContain('/login?redirect=');
    expect(navigate.mock.calls[0][0]).toContain('authorization_id%3Dauth-1');
  });
});

describe('already consented', () => {
  it('follows the redirect from the details response, with no buttons and no decision sent', async () => {
    fetchMock.mockImplementation(async () => json({ redirect_url: REDIRECT }));
    await open('/oauth/consent?authorization_id=auth-1');
    await settle(() => navigate.mock.calls.length > 0);
    expect(navigate.mock.calls).toEqual([[REDIRECT]]);
    expect(allow()).toBeNull();
    expect(consentCalls()).toHaveLength(0);
  });
});

describe('signed out', () => {
  it('goes to login without asking Supabase, and the login round trip comes back with the id', async () => {
    await open('/oauth/consent?authorization_id=auth%2F1', { token: null });
    await settle(() => navigate.mock.calls.length > 0);
    expect(fetchMock).not.toHaveBeenCalled();
    const loginUrl = new URL(String(navigate.mock.calls[0][0]), 'https://strudel.test');
    expect(loginUrl.pathname).toBe('/login');

    // What LoginPage stores before Google, and what /auth/callback reads afterwards.
    const stored = redirectTargetFromSearch(loginUrl.search);
    const back = new URL(safeRedirectPath(stored), 'https://strudel.test');
    expect(back.pathname).toBe('/oauth/consent');
    expect(back.searchParams.get('authorization_id')).toBe('auth/1');
  });

  it('goes to login when Supabase rejects the token', async () => {
    fetchMock.mockImplementation(async () => json({ error_code: 'bad_jwt', msg: 'bad' }, 403));
    await open('/oauth/consent?authorization_id=auth-1');
    await settle(() => navigate.mock.calls.length > 0);
    expect(navigate.mock.calls[0][0]).toBe('/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-1');
  });
});

describe('a request that cannot go ahead', () => {
  it('without authorization_id asks to start again, and calls nothing', async () => {
    await open('/oauth/consent');
    expect(text()).toContain('Connect again from the assistant.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'oauth_authorization_not_found'],
    [500, undefined],
  ])('a %i says it could not be completed, with no buttons', async (status, error_code) => {
    fetchMock.mockImplementation(async () => json({ error_code, msg: 'x' }, status));
    await open('/oauth/consent?authorization_id=auth-1');
    expect(text()).toContain('could not be completed');
    expect(allow()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a redirect_url in the page URL is ignored', async () => {
    fetchMock.mockImplementation(async () => json({ redirect_url: REDIRECT }));
    await open('/oauth/consent?authorization_id=auth-1&redirect_url=https://evil.test&redirect=https://evil.test');
    await settle(() => navigate.mock.calls.length > 0);
    expect(navigate.mock.calls).toEqual([[REDIRECT]]);
  });
});

describe('what the page tells the user before they allow', () => {
  it('names the host the assistant returns to, whatever name the client chose', async () => {
    await open('/oauth/consent/?authorization_id=auth-1');
    expect(text()).toContain('client.test');
  });

  it('says the assistant can permanently delete tracks and folders', async () => {
    await open('/oauth/consent/?authorization_id=auth-1');
    expect(text()).toContain('permanently delete');
  });
});
