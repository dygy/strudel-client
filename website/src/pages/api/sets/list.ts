import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { setFromRow } from '../../../lib/setLists';
import { json, SET_COLUMNS } from './_shared';

export const prerender = false;

/** GET /api/sets/list — the session user's sets, ordered by name: `200 { sets: [{ id, name, items, version }] }`. */
export const GET: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);
    // As the user, so RLS applies; the user_id filter is a second guard.
    const supabase = userClient(accessToken);
    const { data, error } = await supabase
      .from('set_lists')
      .select(SET_COLUMNS)
      .eq('user_id', user.id)
      .order('name', { ascending: true });
    if (error) {
      console.error('API /sets/list - database error:', error);
      return json({ error: 'Failed to load sets' }, 500);
    }
    const sets = ((data ?? []) as never[]).map(setFromRow);
    return json({ sets }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) return json({ error: 'Not authenticated' }, 401);
    console.error('API /sets/list - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
