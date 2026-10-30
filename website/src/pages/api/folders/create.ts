import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { findFolderByPathOrId, validateFolderName, type RenamableFolder } from '../../../lib/folderRename';

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NAME_ERRORS = {
  empty: { status: 400, error: 'Folder name cannot be empty' },
  slash: { status: 400, error: 'Folder name cannot contain "/"' },
  duplicate: { status: 409, error: 'A folder with this name already exists here' },
} as const;

/** Client-generated ids are nanoid()s. */
const FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * POST /api/folders/create — `{ id, name, parent? }`. `parent` may be a folder id or (as the
 * sidebar sends it) the parent's path; it is stored as the parent's id. The path is built here
 * from the parent's path, never taken from the client, and a sibling with the same name or URL
 * slug is refused with 409 (two such folders would share one URL).
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    // Sign-in is checked before the body is read (api/_auth.ts: Bearer header, then cookie).
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { id, name, parent } = body;
    if (typeof id !== 'string' || !FOLDER_ID.test(id) || typeof name !== 'string') {
      return json({ error: 'Missing required fields' }, 400);
    }
    if (parent !== undefined && parent !== null && typeof parent !== 'string') {
      return json({ error: 'Parent must be a folder id or path' }, 400);
    }

    // As the user, so RLS applies; every query is also scoped by the session user's id.
    const supabase = userClient(accessToken);
    const { data: folderRows, error: listError } = await supabase
      .from('folders')
      .select('id, name, path, parent')
      .eq('user_id', user.id);
    if (listError) {
      console.error('API /folders/create - failed to list folders:', listError);
      return json({ error: 'Failed to create folder' }, 500);
    }
    const folders = (folderRows ?? []) as RenamableFolder[];

    const parentFolder = parent ? findFolderByPathOrId(folders, parent) : undefined;
    if (parent && !parentFolder) {
      return json({ error: 'Parent folder not found or access denied' }, 400);
    }

    const candidate: RenamableFolder = { id, name: name.trim(), path: '', parent: parentFolder?.id ?? null };
    const nameError = validateFolderName(name, candidate, folders);
    if (nameError) {
      const { status, error } = NAME_ERRORS[nameError];
      return json({ error, code: nameError }, status);
    }

    const row = {
      id,
      user_id: user.id,
      name: candidate.name,
      path: parentFolder ? `${parentFolder.path}/${candidate.name}` : candidate.name,
      parent: candidate.parent,
      created: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('folders').insert(row).select();
    if (error) {
      // Primary key taken (an id collision, or a retried create).
      if ((error as { code?: string }).code === '23505') {
        return json({ error: 'A folder with this id already exists', code: 'id_taken' }, 409);
      }
      console.error('API /folders/create - database error:', error);
      return json({ error: 'Failed to create folder' }, 500);
    }

    return json({ data: Array.isArray(data) ? (data[0] ?? row) : (data ?? row) }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Not authenticated' }, 401);
    }
    console.error('API /folders/create - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
