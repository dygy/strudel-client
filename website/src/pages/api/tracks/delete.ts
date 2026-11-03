import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { invalidVersionResponse, isVersionToken, missOnVersion } from './_version';

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const DELETE: APIRoute = async ({ request }) => {
  try {
    // Bearer header or sb-access-token cookie. An AuthError becomes a 401 below, on which the client
    // refreshes its own session and retries. No setSession/refresh fallback here: refresh tokens are
    // single-use and the browser client is the only refresh owner.
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { trackId, expectedVersion } = body;

    if (!trackId || typeof trackId !== 'string') {
      return json({ error: 'Track ID is required' }, 400);
    }
    if (expectedVersion !== undefined && !isVersionToken(expectedVersion)) {
      return invalidVersionResponse();
    }

    // As the user, so RLS applies (the user_id filter stays as a second guard). `.select()` returns
    // the deleted rows: RLS refusing a delete is not an error, just zero rows, and must not be
    // reported as success (the track would come back on the next load).
    // With `expectedVersion`, a track that changed since it was read is not deleted.
    const supabase = userClient(accessToken);
    const deletion = supabase.from('tracks').delete().eq('id', trackId).eq('user_id', user.id);
    const { data: deleted, error } = await (
      expectedVersion === undefined ? deletion : deletion.eq('updated_at', expectedVersion)
    ).select('id');

    if (error) {
      console.error('API /tracks/delete - database error:', error);
      return json({ error: 'Failed to delete track' }, 500);
    }
    if (!deleted || (Array.isArray(deleted) && deleted.length === 0)) {
      if (expectedVersion !== undefined) return missOnVersion(supabase, trackId, user.id);
      return json({ error: 'Track not found' }, 404);
    }

    return json({ success: true }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Not authenticated' }, 401);
    }
    console.error('API /tracks/delete - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
