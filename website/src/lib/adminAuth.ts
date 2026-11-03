/**
 * Admin authentication utilities
 */

/** A user as Supabase auth returns it: only `app_metadata` matters here. */
export interface RoleCarrier {
  app_metadata?: Record<string, unknown> | null;
}

/**
 * Is this user an admin? The role is `app_metadata.role === 'admin'`. `app_metadata` can only be
 * written with the service-role key (Supabase Admin API), never by the user, unlike
 * `user_metadata`, so it is safe to trust. Grant or revoke it with
 * `PUT /auth/v1/admin/users/<id>` `{ "app_metadata": { "role": "admin" } }`.
 */
export function isAdminUser(user: RoleCarrier | null | undefined): boolean {
  return user?.app_metadata?.role === 'admin';
}

/**
 * Was this token issued to an assistant? Only tokens from the OAuth server carry a `client_id`. Supabase
 * accepts them like any session, and an admin who connects an assistant hands it a token with their role,
 * so paths past RLS have to ask. Only says what the token claims: Supabase still has to accept it.
 */
export function isAssistantToken(token: string | null | undefined): boolean {
  const payload = token?.split('.')[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { client_id?: unknown }).client_id !== undefined;
  } catch {
    return false;
  }
}

/** An admin, signed in as themselves: what every service-role path and bulk delete requires. */
export function isAdminSession(user: RoleCarrier | null | undefined, token: string | null | undefined): boolean {
  return isAdminUser(user) && !isAssistantToken(token);
}
