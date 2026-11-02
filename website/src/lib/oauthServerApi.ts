/**
 * Browser calls to Supabase's OAuth 2.1 server, the ones a consent page and a "connected apps" list
 * need, made with plain fetch and the signed-in user's own access token.
 *
 * supabase-js here is 2.48.1, with no `auth.oauth`. Endpoints and shapes follow
 * @supabase/auth-js 2.118.0: `src/GoTrueClient.ts` (_getAuthorizationDetails, _approveAuthorization,
 * _denyAuthorization, _listOAuthGrants, _revokeOAuthGrant) and `src/lib/types.ts`
 * (OAuthAuthorizationDetails, OAuthRedirect, OAuthGrant). Replace with `supabase.auth.oauth` if the
 * SDK is ever upgraded.
 */

const API_VERSION = '2024-01-01';

export interface OAuthClientInfo {
  id: string;
  name: string;
  uri: string;
  logo_uri: string;
}

/** The user has to decide. */
export interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  client: OAuthClientInfo;
  user: { id: string; email: string };
  scope: string;
}

/** A decision exists already, or was just made: send the browser here. */
export interface OAuthRedirect {
  redirect_url: string;
}

export interface OAuthGrant {
  client: OAuthClientInfo;
  scopes: string[];
  granted_at: string;
}

export class OAuthServerApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or 0 when no answer came back. */
    readonly status: number,
    /** Supabase's error code, when it sent one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OAuthServerApiError';
  }
}

const SESSION_REJECTED_CODES = new Set(['bad_jwt', 'session_not_found', 'session_expired', 'no_session']);

/** The user has to sign in (again). Any other failure says nothing about the session. */
export function isSessionRejected(error: unknown): boolean {
  if (!(error instanceof OAuthServerApiError)) return false;
  return error.status === 401 || (error.code !== undefined && SESSION_REJECTED_CODES.has(error.code));
}

/** Script-running schemes. Real clients redirect to https, to localhost or to their own app scheme. */
const UNSAFE_REDIRECT_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'about:']);

function readRedirectUrl(value: unknown): string {
  if (typeof value === 'string') {
    try {
      if (!UNSAFE_REDIRECT_SCHEMES.has(new URL(value).protocol)) return value;
    } catch {
      // Not an absolute URL: falls through to the refusal.
    }
  }
  throw new OAuthServerApiError('The authorization server returned an unusable redirect', 200, 'bad_redirect');
}

export interface OAuthServerApiConfig {
  supabaseUrl: string;
  anonKey: string;
  /** The current access token, or null when signed out. */
  getAccessToken: () => Promise<string | null>;
}

export interface OAuthServerApi {
  getAuthorizationDetails(authorizationId: string): Promise<OAuthAuthorizationDetails | OAuthRedirect>;
  approve(authorizationId: string): Promise<OAuthRedirect>;
  deny(authorizationId: string): Promise<OAuthRedirect>;
  listGrants(): Promise<OAuthGrant[]>;
  revokeGrant(clientId: string): Promise<void>;
}

/** Details needing a decision always carry `authorization_id` (see auth-js's own example). */
export function isOAuthRedirect(data: OAuthAuthorizationDetails | OAuthRedirect): data is OAuthRedirect {
  return !('authorization_id' in data);
}

export function createOAuthServerApi({ supabaseUrl, anonKey, getAccessToken }: OAuthServerApiConfig): OAuthServerApi {
  const authUrl = `${supabaseUrl}/auth/v1`;

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await getAccessToken();
    if (!token) throw new OAuthServerApiError('Not signed in', 401, 'no_session');

    let response: Response;
    try {
      response = await fetch(`${authUrl}${path}`, {
        method,
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${token}`,
          'x-supabase-api-version': API_VERSION,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error: unknown) {
      throw new OAuthServerApiError(error instanceof Error ? error.message : 'Network error', 0);
    }
    if (response.ok) return response;

    const failure = (await response.json().catch(() => null)) as {
      code?: unknown;
      error_code?: unknown;
      msg?: unknown;
      message?: unknown;
    } | null;
    const code = [failure?.error_code, failure?.code].find((value) => typeof value === 'string') as string | undefined;
    const message = [failure?.msg, failure?.message].find((value) => typeof value === 'string') as string | undefined;
    throw new OAuthServerApiError(message ?? `HTTP ${response.status}`, response.status, code);
  }

  async function readJson(response: Response): Promise<Record<string, unknown>> {
    const data: unknown = await response.json().catch(() => null);
    if (data === null || typeof data !== 'object') {
      throw new OAuthServerApiError('The authorization server returned an unreadable answer', response.status);
    }
    return data as Record<string, unknown>;
  }

  /** The id comes from the page's URL, so it must not be able to change the path. */
  const authorizationPath = (id: string) => `/oauth/authorizations/${encodeURIComponent(id)}`;

  async function decide(id: string, action: 'approve' | 'deny'): Promise<OAuthRedirect> {
    const data = await readJson(await request('POST', `${authorizationPath(id)}/consent`, { action }));
    return { redirect_url: readRedirectUrl(data.redirect_url) };
  }

  return {
    async getAuthorizationDetails(id) {
      const data = await readJson(await request('GET', authorizationPath(id)));
      if ('authorization_id' in data) return data as unknown as OAuthAuthorizationDetails;
      return { redirect_url: readRedirectUrl(data.redirect_url) };
    },
    approve: (id) => decide(id, 'approve'),
    deny: (id) => decide(id, 'deny'),
    async listGrants() {
      const data: unknown = await (await request('GET', '/user/oauth/grants')).json().catch(() => null);
      if (!Array.isArray(data)) {
        throw new OAuthServerApiError('The authorization server returned an unreadable answer', 200);
      }
      return data as OAuthGrant[];
    },
    async revokeGrant(clientId) {
      await request('DELETE', `/user/oauth/grants?${new URLSearchParams({ client_id: clientId })}`);
    },
  };
}
