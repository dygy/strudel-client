import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { sanitizeItems, setFromRow, validateSetName, type SetItem } from '../../../lib/setLists';
import { isVersionToken } from '../tracks/_version';
import {
  invalidNameResponse,
  isUniqueViolation,
  json,
  missOnSetVersion,
  nameTakenResponse,
  otherSetNames,
  SET_COLUMNS,
} from './_shared';

export const prerender = false;

/**
 * PUT /api/sets/update — rename a set and/or replace its items. Body: `{ id, name?, items?, expectedVersion }`.
 * One UPDATE filtered on `updated_at = expectedVersion`, so nothing is written over a newer version:
 * on a miss `409 { error: 'version_conflict', current }`, or 404 when the set is gone (or not the
 * user's). A name another of the user's sets has: `409 { error: 'name_taken' }`.
 */
export const PUT: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);

    const body = await readJsonObject(request);
    if (!body) return invalidDataResponse();
    const { id, expectedVersion } = body;
    if (typeof id !== 'string' || !id) return invalidDataResponse();
    if (!isVersionToken(expectedVersion)) return invalidDataResponse();

    const changes: { name?: string; items?: SetItem[] } = {};
    if (body.name !== undefined) {
      const name = validateSetName(body.name);
      if (!name) return invalidNameResponse();
      changes.name = name;
    }
    if (body.items !== undefined) {
      const items = sanitizeItems(body.items);
      if (!items) return invalidDataResponse();
      changes.items = items;
    }
    if (!Object.keys(changes).length) return invalidDataResponse();

    const supabase = userClient(accessToken);
    if (changes.name !== undefined) {
      const { names, error: namesError } = await otherSetNames(supabase, user.id, id);
      if (namesError) {
        console.error('API /sets/update - failed to list sets:', namesError);
        return json({ error: 'Failed to update set' }, 500);
      }
      if (names.includes(changes.name)) return nameTakenResponse();
    }

    // One statement: the version check and the write can't be separated by another writer.
    const { data, error } = await supabase
      .from('set_lists')
      .update(changes as never)
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('updated_at', expectedVersion)
      .select(SET_COLUMNS);
    if (error) {
      if (isUniqueViolation(error)) return nameTakenResponse();
      console.error('API /sets/update - database error:', error);
      return json({ error: 'Failed to update set' }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return missOnSetVersion(supabase, id, user.id);
    return json({ set: setFromRow(row as never) }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) return json({ error: 'Not authenticated' }, 401);
    console.error('API /sets/update - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
