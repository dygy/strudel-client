import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { json, notFoundResponse } from './_shared';

export const prerender = false;

/**
 * DELETE /api/sets/delete — delete one of the session user's sets (never the tracks in it).
 * Body: `{ id }`. `200 { ok: true }`, or 404 when no such set is the user's.
 */
export const DELETE: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);

    const body = await readJsonObject(request);
    if (!body) return invalidDataResponse();
    const { id } = body;
    if (typeof id !== 'string' || !id) return invalidDataResponse();

    // `.select()` returns the deleted rows: RLS refusing a delete is zero rows, not an error, and
    // must not be reported as success.
    const supabase = userClient(accessToken);
    const { data, error } = await supabase.from('set_lists').delete().eq('id', id).eq('user_id', user.id).select('id');
    if (error) {
      console.error('API /sets/delete - database error:', error);
      return json({ error: 'Failed to delete set' }, 500);
    }
    if (!data || (Array.isArray(data) && data.length === 0)) return notFoundResponse();
    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) return json({ error: 'Not authenticated' }, 401);
    console.error('API /sets/delete - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
