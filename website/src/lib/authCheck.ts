/**
 * One auth check for the whole client (authStore and AuthContext).
 *
 * The browser supabase-js session is the source of truth and the only refresh owner. The check
 * first makes sure that session is fresh (refreshing it if it is about to expire), mirrors it into
 * the session cookie, and asks `/api/auth/user` with `Authorization: Bearer <access token>`. A stale
 * or missing cookie therefore can't sign out a user whose client session is still valid.
 *
 * If the server rejects a token the client believes is valid (e.g. the local clock runs slow, so
 * ensureValidSession didn't refresh), the session is force-refreshed and the server asked once more
 * before anything is decided.
 */
import type { User } from './secureApi';
import { ensureValidSession, forceRefreshSession } from './authUtils';
import { writeSessionCookies } from './authCookies';

export type AuthCheckResult =
  | { status: 'authenticated'; user: User; sessionExpiresAt: string | null }
  /** The server and the client agree there is no session: the user really is signed out. */
  | { status: 'signed-out'; httpStatus: number }
  /** Couldn't tell (network error, 5xx, a refresh that failed for a transient reason). Keep state. */
  | { status: 'unknown'; reason: string };

type ServerAnswer =
  | { kind: 'user'; user: User; sessionExpiresAt: string | null }
  | { kind: 'rejected'; httpStatus: number }
  | { kind: 'unknown'; reason: string };

async function askServer(accessToken: string | null): Promise<ServerAnswer> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch('/api/auth/user', { method: 'GET', credentials: 'include', headers });
  } catch (error: unknown) {
    return { kind: 'unknown', reason: error instanceof Error ? error.message : 'network error' };
  }

  if (response.ok) {
    let data: { user?: User | null; sessionExpiresAt?: string | null } | null = null;
    try {
      data = await response.json();
    } catch {
      return { kind: 'unknown', reason: 'unreadable /api/auth/user response' };
    }
    if (data?.user) return { kind: 'user', user: data.user, sessionExpiresAt: data.sessionExpiresAt ?? null };
    return { kind: 'rejected', httpStatus: response.status };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: 'rejected', httpStatus: response.status };
  }
  return { kind: 'unknown', reason: `HTTP ${response.status}` };
}

function fromUser(answer: { user: User; sessionExpiresAt: string | null }): AuthCheckResult {
  return { status: 'authenticated', user: answer.user, sessionExpiresAt: answer.sessionExpiresAt };
}

export async function checkAuthUser(): Promise<AuthCheckResult> {
  let accessToken: string | null = null;
  // A refresh that failed while a session still exists (e.g. offline) is not a sign-out.
  let clientSessionUncertain = false;

  try {
    const sessionResult = await ensureValidSession();
    if (sessionResult.success && sessionResult.session?.access_token) {
      accessToken = sessionResult.session.access_token;
      writeSessionCookies(sessionResult.session);
    } else if (!sessionResult.noSession) {
      clientSessionUncertain = true;
    }
  } catch (error: unknown) {
    console.warn('Auth check - could not read the client session:', error);
    clientSessionUncertain = true;
  }

  const first = await askServer(accessToken);
  if (first.kind === 'user') return fromUser(first);
  if (first.kind === 'unknown') return { status: 'unknown', reason: first.reason };

  // The server rejected the session.
  if (clientSessionUncertain) return { status: 'unknown', reason: 'session refresh failed' };
  if (!accessToken) return { status: 'signed-out', httpStatus: first.httpStatus };

  // The client thinks its token is valid but the server doesn't (clock skew, revoked token):
  // force one refresh and ask once more before deciding.
  const refreshed = await forceRefreshSession();
  if (!refreshed.success || !refreshed.session?.access_token) {
    return refreshed.invalid
      ? { status: 'signed-out', httpStatus: first.httpStatus }
      : { status: 'unknown', reason: `forced refresh failed: ${refreshed.error ?? 'unknown error'}` };
  }
  writeSessionCookies(refreshed.session);

  const second = await askServer(refreshed.session.access_token);
  if (second.kind === 'user') return fromUser(second);
  if (second.kind === 'unknown') return { status: 'unknown', reason: second.reason };
  return { status: 'signed-out', httpStatus: second.httpStatus };
}
