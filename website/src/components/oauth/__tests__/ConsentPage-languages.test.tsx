// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.12)
 * @regression
 * The consent page has no I18nProvider or HeadCommon, and its HTML says `lang="en"`, so whatever turns the
 * page right-to-left has to come along with the one import it does have. How it then looks is browser-only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ConsentPage from '../ConsentPage';
import { createOAuthServerApi } from '@src/lib/oauthServerApi';
import i18n from '@src/i18n/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://client.test/callback',
  client: { id: 'c1', name: 'Claude Code', uri: 'https://client.test', logo_uri: '' },
  user: { id: 'u1', email: 'u@example.test' },
  scope: 'openid email',
};

async function showIn(language: string) {
  await i18n.loadNamespaces('auth');
  await i18n.changeLanguage(language);
  window.history.replaceState(null, '', '/oauth/consent?authorization_id=auth-1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(DETAILS), { status: 200 })),
  );
  const api = createOAuthServerApi({
    supabaseUrl: 'https://project.supabase.test',
    anonKey: 'anon',
    getAccessToken: async () => 'token',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ConsentPage deps={{ api, navigate: () => {} }} />));
  for (let i = 0; i < 100 && !container.querySelector('[data-testid="consent-allow"]'); i++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 5))));
  }
  return container.querySelector<HTMLButtonElement>('[data-testid="consent-allow"]')!;
}

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

const consentText = (language: string) => (i18n.getResource(language, 'auth', 'consent') as { allow: string }).allow;

describe('the consent page', () => {
  it.each(['he', 'ar'])('in %s lays out right to left, in that language', async (language) => {
    const allow = await showIn(language);
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe(language);
    expect(allow.textContent).toContain(consentText(language));
    expect(consentText(language)).not.toBe(consentText('en'));
  });

  it.each(['en', 'fr', 'es', 'ru', 'sr', 'ko', 'zh'])('in %s lays out left to right', async (language) => {
    // Coming from a right-to-left language, as changing the language in another tab would.
    await i18n.changeLanguage('he');
    const allow = await showIn(language);
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe(language);
    expect(allow.textContent).toContain(consentText(language));
  });
});
