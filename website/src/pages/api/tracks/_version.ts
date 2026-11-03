/**
 * Optimistic version checks on tracks (spec 018, tech 2.4 and 2.5). The version token is the row's
 * `updated_at`, which a trigger bumps on every write. It is an opaque string: never parse it with
 * Date, because that drops the microseconds the comparison depends on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A timestamptz as PostgREST writes one. Anything else would be a 500 from Postgres. */
const VERSION_TOKEN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}(:?\d{2})?)$/;

export function isVersionToken(value: unknown): value is string {
  return typeof value === 'string' && VERSION_TOKEN.test(value);
}

export const invalidVersionResponse = () => json({ error: 'expectedVersion must be a track version' }, 400);

/**
 * A compare-and-swap touched no rows: the track is gone (404) or has moved on (409). The 409 carries
 * what the caller needs to decide, without a second request.
 */
export async function missOnVersion(supabase: SupabaseClient, trackId: string, userId: string): Promise<Response> {
  const { data, error } = await supabase
    .from('tracks')
    .select('updated_at, name, folder, code, steps, is_multitrack, active_step')
    .eq('id', trackId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('API /tracks - could not re-read after a version miss:', error);
    return json({ error: 'Failed to update track' }, 500);
  }
  if (!data) return json({ error: 'Track not found' }, 404);
  return json(
    {
      error: 'This track changed since you read it',
      code: 'version_conflict',
      current: {
        version: data.updated_at,
        name: data.name,
        folder: data.folder,
        code: data.code,
        steps: data.steps,
        isMultitrack: data.is_multitrack,
        activeStep: data.active_step,
      },
    },
    409,
  );
}
