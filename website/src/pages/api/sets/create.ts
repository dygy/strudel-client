import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { nextFreeSetName, setFromRow, validateSetName } from '../../../lib/setLists';
import { invalidNameResponse, isUniqueViolation, json, nameTakenResponse, otherSetNames, SET_COLUMNS } from './_shared';

export const prerender = false;

/**
 * POST /api/sets/create — a new, empty set for the session user. Body: `{ name? }`.
 * A missing name becomes the first free "Set N" (the client normally sends the localized one).
 * `201 { set }`; a name another of the user's sets has: `409 { error: 'name_taken' }`.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    // Sign-in is checked before the body is read.
    const { user, accessToken } = await getAuthenticatedUser(request);

    const body = await readJsonObject(request);
    if (!body) return invalidDataResponse();

    let name: string | null = null;
    if (body.name !== undefined) {
      name = validateSetName(body.name);
      if (!name) return invalidNameResponse();
    }

    const supabase = userClient(accessToken);
    const { names, error: namesError } = await otherSetNames(supabase, user.id);
    if (namesError) {
      console.error('API /sets/create - failed to list sets:', namesError);
      return json({ error: 'Failed to create set' }, 500);
    }
    if (name === null) name = nextFreeSetName('Set', names);
    if (names.includes(name)) return nameTakenResponse();

    // user_id comes from the session only; nothing else in the body is written.
    const { data, error } = await supabase
      .from('set_lists')
      .insert({ user_id: user.id, name, items: [] } as never)
      .select(SET_COLUMNS)
      .single();
    if (error) {
      if (isUniqueViolation(error)) return nameTakenResponse();
      console.error('API /sets/create - database error:', error);
      return json({ error: 'Failed to create set' }, 500);
    }
    return json({ set: setFromRow(data as never) }, 201);
  } catch (error: unknown) {
    if (error instanceof AuthError) return json({ error: 'Not authenticated' }, 401);
    console.error('API /sets/create - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
