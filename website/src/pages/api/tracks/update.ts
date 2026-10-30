import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { serverEnv } from '../../../lib/server-env';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { trackNameClashes, type NamedTrack, type PathedFolder } from '../../../lib/trackRename';

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * PUT /api/tracks/update — save (code, steps), rename and/or move one of the session user's tracks.
 * Every code save (autosave, Cmd+S, save-before-switch, emergency save) comes through here.
 * Body: `{ trackId, updates: { code?, steps?, isMultitrack?, activeStep?, name?, folder? } }`.
 * Only these fields are written: the query runs with the service-role key, so anything else sent
 * (user_id, id, created, …) is ignored.
 */
export const PUT: APIRoute = async ({ request }) => {
  try {
    // Sign-in is checked before the body is read (api/_auth.ts: Bearer header, then cookie).
    const { user } = await getAuthenticatedUser(request);

    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { trackId, updates } = body;

    if (!trackId || typeof trackId !== 'string') {
      return json({ error: 'Track ID is required' }, 400);
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return json({ error: 'Updates object is required' }, 400);
    }

    const changes: {
      name?: string;
      folder?: string | null;
      code?: string;
      steps?: unknown[] | null;
      is_multitrack?: boolean;
      active_step?: number | null;
    } = {};
    if (updates.code !== undefined) {
      if (typeof updates.code !== 'string') {
        return json({ error: 'Code must be a string' }, 400);
      }
      changes.code = updates.code;
    }
    if (updates.steps !== undefined) {
      if (updates.steps !== null && !Array.isArray(updates.steps)) {
        return json({ error: 'Steps must be an array' }, 400);
      }
      changes.steps = updates.steps;
    }
    // The client uses camelCase; the columns are snake_case (see tracks/create.ts).
    const isMultitrack = updates.isMultitrack ?? updates.is_multitrack;
    if (isMultitrack !== undefined) {
      if (typeof isMultitrack !== 'boolean') {
        return json({ error: 'isMultitrack must be a boolean' }, 400);
      }
      changes.is_multitrack = isMultitrack;
    }
    const activeStep = updates.activeStep ?? updates.active_step;
    if (activeStep !== undefined) {
      if (activeStep !== null && !Number.isInteger(activeStep)) {
        return json({ error: 'activeStep must be an integer' }, 400);
      }
      changes.active_step = activeStep;
    }
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || !updates.name.trim()) {
        return json({ error: 'Track name cannot be empty' }, 400);
      }
      changes.name = updates.name.trim();
    }
    if (updates.folder !== undefined) {
      if (updates.folder !== null && typeof updates.folder !== 'string') {
        return json({ error: 'Folder must be a folder id or null' }, 400);
      }
      changes.folder = updates.folder || null;
    }
    if (!Object.keys(changes).length) {
      return json({ error: 'Nothing to update' }, 400);
    }

    // Service-role client: every query below is scoped by the session user's id.
    const supabase = createClient(serverEnv().supabaseUrl, serverEnv().supabaseServiceKey);

    // A rename or move needs this user's tracks and folders for the sibling check; a plain code
    // save (autosave) does not, and must stay a single query.
    if (changes.name !== undefined || changes.folder !== undefined) {
      const [{ data: trackRows, error: tracksError }, { data: folderRows, error: foldersError }] = await Promise.all([
        supabase.from('tracks').select('id, name, folder').eq('user_id', user.id),
        supabase.from('folders').select('id, name, path').eq('user_id', user.id),
      ]);
      if (tracksError || foldersError) {
        console.error('API /tracks/update - failed to list tracks/folders:', tracksError ?? foldersError);
        return json({ error: 'Failed to update track' }, 500);
      }
      const tracks = (trackRows ?? []) as NamedTrack[];
      const folders = (folderRows ?? []) as PathedFolder[];

      const current = tracks.find((t) => t.id === trackId);
      if (!current) {
        return json({ error: 'Track not found' }, 404);
      }

      // A folder must be one of this user's folders (by id, or by path for older rows).
      if (changes.folder && !folders.some((f) => f.id === changes.folder || f.path === changes.folder)) {
        return json({ error: 'Folder not found or access denied' }, 400);
      }

      const name = changes.name ?? current.name;
      const folder = changes.folder !== undefined ? changes.folder : (current.folder ?? null);
      if (trackNameClashes(name, folder, trackId, tracks, folders)) {
        return json({ error: `A track named "${name}" already exists here`, code: 'duplicate' }, 409);
      }
    }

    const { data: updatedRows, error } = await supabase
      .from('tracks')
      .update({ ...changes, modified: new Date().toISOString() } as never)
      .eq('id', trackId)
      .eq('user_id', user.id)
      .select();

    if (error) {
      // unique (user_id, name, folder): a concurrent write took the name.
      if ((error as { code?: string }).code === '23505') {
        return json({ error: 'A track with this name already exists here', code: 'duplicate' }, 409);
      }
      console.error('API /tracks/update - database error:', error);
      return json({ error: 'Failed to update track' }, 500);
    }

    const updatedTrack = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
    if (!updatedTrack) {
      return json({ error: 'Track not found' }, 404);
    }

    return json({ success: true, track: updatedTrack }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Not authenticated' }, 401);
    }
    console.error('API /tracks/update - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
