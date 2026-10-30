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
