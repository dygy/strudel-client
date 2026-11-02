/**
 * @spec: 018-strudel-mcp-server (tech 2.3)
 * The requests match what @supabase/auth-js 2.118.0 sends, and a redirect is returned untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthServerApi, isOAuthRedirect, isSessionRejected, OAuthServerApiError } from '../oauthServerApi';

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://client.test/callback',
  client: { id: 'c1', name: 'Claude', uri: 'https://client.test', logo_uri: '' },
  user: { id: 'u1', email: 'u@example.test' },
  scope: 'openid email',
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(response: () => Response | Promise<Response>, token: string | null = 'user-token') {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetchMock);
  const api = createOAuthServerApi({
    supabaseUrl: 'https://sb.test',
    anonKey: 'anon',
    getAccessToken: async () => token,
  });
  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url, method: init?.method, headers: new Headers(init?.headers), body: init?.body };
  };
  return { api, fetchMock, lastCall };
}

afterEach(() => vi.unstubAllGlobals());

describe('getAuthorizationDetails', () => {
  it('GETs /oauth/authorizations/<id> with the token, the anon key and the API version', async () => {
    const { api, lastCall } = setup(() => jsonResponse(DETAILS));
    const data = await api.getAuthorizationDetails('auth-1');
    expect(data).toEqual(DETAILS);
    expect(isOAuthRedirect(data)).toBe(false);
    const call = lastCall();
    expect(call.url).toBe('https://sb.test/auth/v1/oauth/authorizations/auth-1');
    expect(call.method).toBe('GET');
    expect(call.headers.get('authorization')).toBe('Bearer user-token');
    expect(call.headers.get('apikey')).toBe('anon');
    expect(call.headers.get('x-supabase-api-version')).toBe('2024-01-01');
    expect(call.body).toBeUndefined();
  });

  it('recognises an answer holding only a redirect (already consented)', async () => {
    const { api } = setup(() => jsonResponse({ redirect_url: 'https://client.test/callback?code=x&state=y' }));
    const data = await api.getAuthorizationDetails('auth-1');
    expect(isOAuthRedirect(data)).toBe(true);
    expect(data).toEqual({ redirect_url: 'https://client.test/callback?code=x&state=y' });
  });

  it('an id from the URL cannot change the path', async () => {
    const { api, lastCall } = setup(() => jsonResponse(DETAILS));
    await api.getAuthorizationDetails('../../user?x=1');
    expect(lastCall().url).toBe('https://sb.test/auth/v1/oauth/authorizations/..%2F..%2Fuser%3Fx%3D1');
  });
});

describe.each([
  ['approve', 'approve'],
  ['deny', 'deny'],
] as const)('%s', (method, action) => {
  it(`POSTs {action: '${action}'} to the consent endpoint`, async () => {
    const { api, lastCall } = setup(() => jsonResponse({ redirect_url: 'https://client.test/cb?code=x' }));
    await api[method]('auth-1');
    const call = lastCall();
    expect(call.url).toBe('https://sb.test/auth/v1/oauth/authorizations/auth-1/consent');
    expect(call.method).toBe('POST');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(call.body))).toEqual({ action });
  });

  it.each([
    'https://client.test/cb?code=a%20b&state=x#frag',
    'http://localhost:33418/callback?code=x',
    'cursor://anysphere.cursor-mcp/oauth/callback?code=x',
  ])('returns the redirect exactly as received: %s', async (redirect_url) => {
    const { api } = setup(() => jsonResponse({ redirect_url }));
    await expect(api[method]('auth-1')).resolves.toEqual({ redirect_url });
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relative', '', undefined, 42])(
    'refuses %j as a redirect',
    async (redirect_url) => {
      const { api } = setup(() => jsonResponse({ redirect_url }));
      await expect(api[method]('auth-1')).rejects.toMatchObject({ code: 'bad_redirect' });
    },
  );
});

describe('grants', () => {
  it('lists with GET /user/oauth/grants', async () => {
    const grants = [{ client: DETAILS.client, scopes: ['email'], granted_at: '2026-11-02T00:00:00Z' }];
    const { api, lastCall } = setup(() => jsonResponse(grants));
    await expect(api.listGrants()).resolves.toEqual(grants);
    expect(lastCall().url).toBe('https://sb.test/auth/v1/user/oauth/grants');
    expect(lastCall().method).toBe('GET');
  });

  it('refuses a list that is not an array', async () => {
    const { api } = setup(() => jsonResponse({}));
    await expect(api.listGrants()).rejects.toBeInstanceOf(OAuthServerApiError);
  });

  it('revokes with DELETE and client_id in the query, and an empty answer is fine', async () => {
    const { api, lastCall } = setup(() => new Response(null, { status: 204 }));
    await expect(api.revokeGrant('client id/1')).resolves.toBeUndefined();
    expect(lastCall().url).toBe('https://sb.test/auth/v1/user/oauth/grants?client_id=client+id%2F1');
    expect(lastCall().method).toBe('DELETE');
  });
});

describe('failures', () => {
  it('signed out: no request is made, and it counts as the session being rejected', async () => {
    const { api, fetchMock } = setup(() => jsonResponse(DETAILS), null);
    const error = await api.getAuthorizationDetails('a').catch((e: unknown) => e);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isSessionRejected(error)).toBe(true);
  });

  it('keeps the status and the code of an error answer', async () => {
    const { api } = setup(() =>
      jsonResponse({ code: 404, error_code: 'oauth_authorization_not_found', msg: 'gone' }, 404),
    );
    await expect(api.getAuthorizationDetails('a')).rejects.toMatchObject({
      name: 'OAuthServerApiError',
      status: 404,
      code: 'oauth_authorization_not_found',
      message: 'gone',
    });
  });

  it('survives an error answer that is not JSON', async () => {
    const { api } = setup(() => new Response('<html>', { status: 502 }));
    await expect(api.approve('a')).rejects.toMatchObject({ status: 502 });
  });

  it('turns a network failure into status 0', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('offline')));
    await expect(api.deny('a')).rejects.toMatchObject({ status: 0, message: 'offline' });
  });

  it.each([
    [401, undefined, true],
    [403, 'bad_jwt', true],
    [403, 'session_not_found', true],
    [403, 'forbidden', false],
    [404, 'oauth_authorization_not_found', false],
    [500, undefined, false],
    [0, undefined, false],
  ])('isSessionRejected for %i %s is %s', (status, code, expected) => {
    expect(isSessionRejected(new OAuthServerApiError('x', status, code))).toBe(expected);
  });

  it('isSessionRejected is false for other errors', () => {
    expect(isSessionRejected(new Error('401'))).toBe(false);
  });
});
