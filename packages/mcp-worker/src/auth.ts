/**
 * Token check on every request (tech spec 2.3): the token must carry a `client_id` claim, which
 * only tokens issued by the OAuth server have, and Supabase must still accept it.
 *
 * `/auth/v1/user` answers with the user, not the token's claims, so `client_id` has to come from
 * the token's payload. Decoding without verifying is safe here because nothing is trusted until
 * Supabase has accepted the same token. It also refuses web sessions without a network call.
 */
import type { Env } from './env';

export interface AssistantIdentity {
  userId: string;
  email: string | null;
  clientId: string;
}

export type TokenCheck =
  | { ok: true; identity: AssistantIdentity }
  /** `web_session`: a valid-looking token that was not issued to an assistant. */
  | { ok: false; reason: 'malformed' | 'wrong_issuer' | 'web_session' | 'rejected' | 'service_unavailable' };

const MAX_TOKEN_LENGTH = 8192;

interface Claims {
  iss?: unknown;
  client_id?: unknown;
}

function decodeClaims(token: string): Claims | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const binary = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims !== null && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Claims) : null;
  } catch {
    return null;
  }
}

/** The bearer token, or null. Cookies are never read: a web session can't reach this server. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer +(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match ? match[1] : null;
}

export async function checkToken(token: string, env: Env, fetchImpl: typeof fetch): Promise<TokenCheck> {
  const claims = decodeClaims(token);
  if (!claims) return { ok: false, reason: 'malformed' };
  if (claims.iss !== `${env.PUBLIC_SUPABASE_URL}/auth/v1`) return { ok: false, reason: 'wrong_issuer' };
  const clientId = claims.client_id;
  if (typeof clientId !== 'string' || clientId === '') return { ok: false, reason: 'web_session' };

  let response: Response;
  try {
    response = await fetchImpl(`${env.PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: 'service_unavailable' };
  }
  // Only a definite answer about the token may end the connection. An outage or a rate limit says
  // nothing about it, and a 401 would send the assistant through consent again for no reason.
  if (response.status === 429 || response.status >= 500) return { ok: false, reason: 'service_unavailable' };
  if (!response.ok) return { ok: false, reason: 'rejected' };

  let user: { id?: unknown; email?: unknown };
  try {
    user = (await response.json()) as { id?: unknown; email?: unknown };
  } catch {
    return { ok: false, reason: 'service_unavailable' };
  }
  if (typeof user?.id !== 'string' || user.id === '') return { ok: false, reason: 'service_unavailable' };
  return {
    ok: true,
    identity: { userId: user.id, email: typeof user.email === 'string' ? user.email : null, clientId },
  };
}
