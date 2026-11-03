import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { invalidVersionResponse, isVersionToken } from '../tracks/_version';

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOT_FOUND = { error: 'Folder not found' };
/** Enough to say what's inside without answering with a whole library. */
const LISTED_NAMES = 20;

type FolderRow = { id: string; name: string; path: string; parent: string | null; updated_at: string };

/**
 * DELETE /api/folders/delete: `{ folderId, expectedVersion }`. One empty folder, as the signed-in user
 * (RLS). A folder with anything in it is refused with what's inside, and one that changed since it was
 * read is refused too. There is no way to delete contents along with a folder.
 */
export const DELETE: APIRoute = async ({ request }) => {
  try {
    // Sign-in is checked before the body is read (api/_auth.ts: Bearer header, then cookie).
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { folderId, expectedVersion } = body;
    if (!folderId || typeof folderId !== 'string') {
      return json({ error: 'Folder ID is required' }, 400);
    }
    if (!isVersionToken(expectedVersion)) {
      return invalidVersionResponse();
    }

    const supabase = userClient(accessToken);
    const { data: folderRows, error: folderError } = await supabase
      .from('folders')
      .select('id, name, path, parent, updated_at')
      .eq('user_id', user.id);
    if (folderError) {
      console.error('API /folders/delete - failed to list folders:', folderError);
      return json({ error: 'Failed to delete folder' }, 500);
    }
    const folders = (folderRows ?? []) as FolderRow[];
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      return json(NOT_FOUND, 404);
    }

    const conflict = () =>
      json(
        {
          error: 'This folder changed since you read it',
          code: 'version_conflict',
          current: { version: folder.updated_at, name: folder.name, path: folder.path },
        },
        409,
      );
    if (folder.updated_at !== expectedVersion) {
      return conflict();
    }

    // `parent` and `tracks.folder` may hold an id or, on older rows, a path.
    const subfolders = folders.filter(
      (f) =>
        f.id !== folder.id &&
        (f.parent === folder.id || f.parent === folder.path || f.path.startsWith(`${folder.path}/`)),
    );
    // Only this folder's tracks: a library can outgrow one response, and a track missed here would be
    // left pointing at a folder that's gone.
    const { data: trackRows, error: trackError } = await supabase
      .from('tracks')
      .select('name')
      .eq('user_id', user.id)
      .in('folder', [folder.id, folder.path]);
    if (trackError) {
      console.error('API /folders/delete - failed to list tracks:', trackError);
      return json({ error: 'Failed to delete folder' }, 500);
    }
    const tracks = (trackRows ?? []) as Array<{ name: string }>;
    if (subfolders.length || tracks.length) {
      return json(
        {
          error: 'This folder is not empty',
          code: 'folder_not_empty',
          contents: {
            folderCount: subfolders.length,
            trackCount: tracks.length,
            folders: subfolders.slice(0, LISTED_NAMES).map((f) => f.name),
            tracks: tracks.slice(0, LISTED_NAMES).map((t) => t.name),
          },
        },
        409,
      );
    }

    // `updated_at` again here: the delete and the version check can't be separated by another writer.
    const { data: deleted, error } = await supabase
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', user.id)
      .eq('updated_at', expectedVersion)
      .select('id');
    if (error) {
      console.error('API /folders/delete - database error:', error);
      return json({ error: 'Failed to delete folder' }, 500);
    }
    if (!deleted || (Array.isArray(deleted) && deleted.length === 0)) {
      return conflict();
    }

    return json({ success: true }, 200);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Not authenticated' }, 401);
    }
    console.error('API /folders/delete - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
