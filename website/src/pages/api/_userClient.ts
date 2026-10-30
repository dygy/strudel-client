import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../../lib/server-env';

/**
 * A Supabase client that acts as the signed-in user, so RLS (`auth.uid()`) applies. Use it on
 * user routes; the service-role key belongs to `/api/admin/*` only.
 *
 * One client per request: a module-level client would carry one user's token into the next.
 */
export function userClient(accessToken: string) {
  const { supabaseUrl, supabaseAnonKey } = serverEnv();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
