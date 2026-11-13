/**
 * Helpers shared by the `/api/sets/*` routes (spec 022, tech §2.2). Not a route: Astro ignores files
 * starting with an underscore.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { setFromRow } from '../../../lib/setLists';

export const SET_COLUMNS = 'id, name, items, updated_at';

export const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const nameTakenResponse = () => json({ error: 'name_taken' }, 409);
export const invalidNameResponse = () => json({ error: 'invalid_name' }, 400);
export const notFoundResponse = () => json({ error: 'not_found' }, 404);

/** Postgres unique violation: `unique (user_id, name)` refused a write that raced another one. */
export const isUniqueViolation = (error: unknown): boolean => (error as { code?: string } | null)?.code === '23505';

/** The names of this user's sets other than `exceptId`, for the "already exists" check. */
export async function otherSetNames(
  supabase: SupabaseClient,
  userId: string,
  exceptId?: string,
): Promise<{ names: string[]; error: unknown }> {
  const { data, error } = await supabase.from('set_lists').select('id, name').eq('user_id', userId);
  if (error) return { names: [], error };
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  return { names: rows.filter((row) => row.id !== exceptId).map((row) => row.name), error: null };
}

/**
 * A compare-and-swap touched no row: the set is gone (404) or has moved on (409 with what is there
 * now, so the client can adopt it without a second request).
 */
export async function missOnSetVersion(supabase: SupabaseClient, id: string, userId: string): Promise<Response> {
  const { data, error } = await supabase
    .from('set_lists')
    .select(SET_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('API /sets - could not re-read after a version miss:', error);
    return json({ error: 'Failed to update set' }, 500);
  }
  if (!data) return notFoundResponse();
  return json({ error: 'version_conflict', current: setFromRow(data as never) }, 409);
}
