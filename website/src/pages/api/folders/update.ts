import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { serverEnv } from '../../../lib/server-env';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { planFolderRename, type FolderRenamePlan, type RenamableFolder } from '../../../lib/folderRename';

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const RENAME_ERRORS = {
  notFound: { status: 404, error: 'Folder not found or access denied' },
  empty: { status: 400, error: 'Folder name cannot be empty' },
  slash: { status: 400, error: 'Folder name cannot contain "/"' },
  duplicate: { status: 409, error: 'A folder with this name already exists here' },
} as const;

type FolderRow = RenamableFolder & { user_id?: string; created?: string; updated_at?: string };

export const PUT: APIRoute = async ({ request }) => {
  try {
    // Sign-in is checked before the body is read (api/_auth.ts: Bearer header, then cookie).
    const { user } = await getAuthenticatedUser(request);

    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { folderId, updates } = body;

    if (!folderId || typeof folderId !== 'string') {
      return json({ error: 'Folder ID is required' }, 400);
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return json({ error: 'Updates object is required' }, 400);
    }
    if (updates.name !== undefined && typeof updates.name !== 'string') {
      return json({ error: 'Folder name must be a string' }, 400);
    }

    // Service-role client: every query below is scoped by the session user's id.
    const { supabaseUrl, supabaseServiceKey } = serverEnv();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // The whole folder list of this user: needed for the ownership check, the sibling-name
    // check, the parent/cycle checks and the descendant cascade.
    const { data: folderRows, error: listError } = await supabase
      .from('folders')
      .select('id, user_id, name, path, parent, created')
      .eq('user_id', user.id);
    if (listError) {
      console.error('API /folders/update - Failed to list folders:', listError);
      return json({ error: 'Failed to update folder' }, 500);
    }
    const folders = ((folderRows ?? []) as FolderRow[]).filter((f) => f && typeof f.id === 'string');

    const existingFolder = folders.find((f) => f.id === folderId);
    if (!existingFolder) {
      return json(RENAME_ERRORS.notFound, 404);
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let effectiveParent = existingFolder.parent ?? null;

    if (updates.parent !== undefined) {
      if (updates.parent !== null) {
        if (typeof updates.parent !== 'string' || !folders.some((f) => f.id === updates.parent)) {
          return json({ error: 'Parent folder not found or access denied' }, 400);
        }
        if (isCircular(folders, folderId, updates.parent)) {
          return json({ error: 'Cannot move folder into itself or its descendants' }, 400);
        }
      }
      updateData.parent = updates.parent;
      effectiveParent = updates.parent;
    }

    // A client-sent `path` is ignored: the path is always derived from the parent's path.
    let plan: FolderRenamePlan | null = null;
    if (typeof updates.name === 'string') {
      const withParent = folders.map((f) => (f.id === folderId ? { ...f, parent: effectiveParent } : f));
      const result = planFolderRename(withParent, folderId, updates.name);
      if ('error' in result) {
        const { status, error } = RENAME_ERRORS[result.error];
        return json({ error, code: result.error }, status);
      }
      plan = result.plan;
      updateData.name = plan.newName;
      updateData.path = plan.pathChanges[0].newPath;
    }

    // Tracks that store a renamed raw path (older rows) move by id, never by folder string:
    // rows that already hold one of the new paths (orphans) must neither be swept along on the
    // way forward nor dragged back by a rollback. Tracks storing a folder id need nothing.
    const trackMoves: Array<{ ids: string[]; oldPath: string; newPath: string }> = [];
    if (plan && plan.trackFolderRemaps.length) {
      const oldPaths = plan.trackFolderRemaps.map((r) => r.oldPath);
      const newPaths = plan.trackFolderRemaps.map((r) => r.newPath);
      const { data: trackRows, error: trackError } = await supabase
        .from('tracks')
        .select('id, name, folder')
        .eq('user_id', user.id)
        .in('folder', [...oldPaths, ...newPaths]);
      if (trackError) {
        console.error('API /folders/update - Failed to list tracks:', trackError);
        return json({ error: 'Failed to update folder' }, 500);
      }
      const rows = (trackRows ?? []) as Array<{ id: string; name: string; folder: string }>;
      for (const remap of plan.trackFolderRemaps) {
        const moving = rows.filter((t) => t.folder === remap.oldPath);
        // unique (user_id, name, folder): a track of the same name already sits at the new path.
        const taken = new Set(rows.filter((t) => t.folder === remap.newPath).map((t) => t.name));
        if (moving.some((t) => taken.has(t.name))) {
          return json(
            { error: 'A track with the same name already exists at the new path', code: 'track_conflict' },
            409,
          );
        }
        if (moving.length) trackMoves.push({ ids: moving.map((t) => t.id), ...remap });
      }
    }

    // Each step is scoped by the session user's id as well as its own key.
    const updateRow = (
      table: 'folders' | 'tracks',
      [column, value]: [string, string],
      data: Record<string, unknown>,
    ): PromiseLike<{ error: unknown }> =>
      supabase
        .from(table)
        .update(data as never)
        .eq(column, value)
        .eq('user_id', user.id);
    const updateTracksById = (ids: string[], folder: string): PromiseLike<{ error: unknown }> =>
      supabase
        .from('tracks')
        .update({ folder } as never)
        .eq('user_id', user.id)
        .in('id', ids);

    // supabase-js reports failures as `{ error }`, not by throwing — both are checked.
    const applied: Array<{ what: string; undo: () => PromiseLike<{ error: unknown }> }> = [];
    const fail = async (what: string, err: unknown) => {
      console.error(`API /folders/update - ${what} failed, rolling back:`, err);
      const failedUndos: string[] = [];
      for (const step of applied.reverse()) {
        let undoError: unknown = null;
        try {
          undoError = (await step.undo()).error;
        } catch (thrown: unknown) {
          undoError = thrown ?? 'thrown';
        }
        if (undoError) {
          console.error(`API /folders/update - rollback of ${step.what} failed:`, undoError);
          failedUndos.push(step.what);
        }
      }
      if (failedUndos.length) {
        return json(
          { error: 'Failed to update folder; the rollback is incomplete', code: 'rollback_incomplete', failedUndos },
          500,
        );
      }
      return json({ error: 'Failed to update folder' }, 500);
    };

    const { error: updateError } = await updateRow('folders', ['id', folderId], updateData);
    if (updateError) {
      return fail('Folder update', updateError);
    }
    applied.push({
      what: `folder ${folderId}`,
      undo: () =>
        updateRow('folders', ['id', folderId], {
          name: existingFolder.name,
          path: existingFolder.path,
          parent: existingFolder.parent ?? null,
        }),
    });

    if (plan) {
      // Descendant folders: rebuild their paths below the new one.
      for (const change of plan.pathChanges.slice(1)) {
        if (change.oldPath === change.newPath) continue;
        const { error } = await updateRow('folders', ['id', change.id], { path: change.newPath });
        if (error) return fail('Descendant folder update', error);
        applied.push({
          what: `folder ${change.id}`,
          undo: () => updateRow('folders', ['id', change.id], { path: change.oldPath }),
        });
      }

      for (const move of trackMoves) {
        const { error } = await updateTracksById(move.ids, move.newPath);
        if (error) return fail('Track folder update', error);
        applied.push({
          what: `tracks in ${move.oldPath}`,
          undo: () => updateTracksById(move.ids, move.oldPath),
        });
      }
    }

    const updatedFolder = { ...existingFolder, ...updateData } as FolderRow;
    return json(
      {
        success: true,
        folder: {
          id: updatedFolder.id,
          name: updatedFolder.name,
          path: updatedFolder.path,
          parent: updatedFolder.parent ?? null,
          created: updatedFolder.created,
          updated_at: updatedFolder.updated_at,
        },
        pathChanges: plan?.pathChanges ?? [],
        trackFolderRemaps: plan?.trackFolderRemaps ?? [],
      },
      200,
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Not authenticated' }, 401);
    }
    console.error('API /folders/update - Unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};

/** Would making `targetParentId` the parent of `folderId` create a cycle? (in-memory, this user's folders only) */
function isCircular(folders: RenamableFolder[], folderId: string, targetParentId: string): boolean {
  const parentOf = new Map(folders.map((f) => [f.id, f.parent ?? null]));
  let current: string | null = targetParentId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === folderId) return true;
    visited.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}
