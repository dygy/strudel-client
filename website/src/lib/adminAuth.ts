/**
 * Admin authentication utilities
 */

export const ADMIN_EMAIL = 'a.shvartcman@gmail.com';

/**
 * Check if the given email is an admin email
 */
export function isAdmin(email: string | undefined | null): boolean {
  return email === ADMIN_EMAIL;
}

/**
 * Check if the current user (from Supabase auth) is an admin
 */
export function isAdminUser(user: { email?: string | null } | null): boolean {
  return isAdmin(user?.email);
}
