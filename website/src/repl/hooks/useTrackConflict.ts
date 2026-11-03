/**
 * Connects the conflict controller to the file manager, the editor and the browser Supabase client.
 * Reads go straight to Supabase under RLS, so detection costs no Worker requests (tech 2.6).
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@src/lib/supabase';
import {
  createTrackConflictController,
  setActiveTrackConflictController,
  trackConflictStore,
  type ServerRead,
  type TrackConflictController,
  type TrackConflictDeps,
} from '../trackConflict';
import { serverTrackFromRow, trackVersions, type ServerTrack } from '../trackVersion';

/**
 * Without a session, RLS answers "no rows" for every track, which must not read as "deleted".
 * So does a missing row for a signed-in user: that one is real.
 */
async function hasSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  return !error && !!data.session;
}

export async function readServerVersion(trackId: string): Promise<ServerRead<string>> {
  try {
    if (!(await hasSession())) return { status: 'unknown' };
    const { data, error } = await supabase.from('tracks').select('updated_at').eq('id', trackId).maybeSingle();
    if (error) return { status: 'unknown' };
    const version = (data as { updated_at?: unknown } | null)?.updated_at;
    if (!data) return { status: 'gone' };
    return typeof version === 'string' ? { status: 'found', value: version } : { status: 'unknown' };
  } catch {
    return { status: 'unknown' };
  }
}

export async function readServerTrack(trackId: string): Promise<ServerRead<ServerTrack>> {
  try {
    if (!(await hasSession())) return { status: 'unknown' };
    const { data, error } = await supabase
      .from('tracks')
      .select('updated_at, name, folder, code, steps, is_multitrack, active_step')
      .eq('id', trackId)
      .maybeSingle();
    if (error) return { status: 'unknown' };
    if (!data) return { status: 'gone' };
    const track = serverTrackFromRow(data);
    return track ? { status: 'found', value: track } : { status: 'unknown' };
  } catch {
    return { status: 'unknown' };
  }
}

type AppDeps = Omit<TrackConflictDeps, 'readVersion' | 'readTrack' | 'storage' | 'userId'>;

/**
 * @param userId null while signed out; `enabled` is false for the read-only admin view, whose RLS
 *   reads would see nothing.
 * @param appDeps read on every call, so the controller always sees the latest state.
 */
export function useTrackConflict({
  userId,
  enabled,
  openTrackId,
  knownTrackIds,
  appDeps,
}: {
  userId: string | null;
  enabled: boolean;
  openTrackId: string | null;
  /** Null until the library has loaded. */
  knownTrackIds: Set<string> | null;
  appDeps: AppDeps;
}): TrackConflictController | null {
  const depsRef = useRef(appDeps);
  depsRef.current = appDeps;
  const [controller, setController] = useState<TrackConflictController | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    const created = createTrackConflictController({
      userId,
      readVersion: readServerVersion,
      readTrack: readServerTrack,
      storage: typeof window !== 'undefined' ? window.localStorage : null,
      getEditorCode: () => depsRef.current.getEditorCode(),
      getLastSavedCode: (id) => depsRef.current.getLastSavedCode(id),
      getLocalTrack: (id) => depsRef.current.getLocalTrack(id),
      setEditorCode: (id, code) => depsRef.current.setEditorCode(id, code),
      saveCode: (id, code) => depsRef.current.saveCode(id, code),
      applySynced: (id, code, server) => depsRef.current.applySynced(id, code, server),
      recreate: (id, draft, open) => depsRef.current.recreate(id, draft, open),
      removeLocal: (id) => depsRef.current.removeLocal(id),
    });
    created.startWatching();
    setActiveTrackConflictController(created);
    setController(created);
    return () => {
      created.stopWatching();
      setActiveTrackConflictController(null);
      setController(null);
      trackConflictStore.set(null);
      trackVersions.setOpenTrack(null);
    };
  }, [enabled, userId]);

  useEffect(() => {
    if (controller && knownTrackIds) controller.trackOpened(openTrackId);
  }, [controller, openTrackId, knownTrackIds !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (controller && knownTrackIds) controller.offerOrphanDrafts(knownTrackIds);
  }, [controller, knownTrackIds !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  return controller;
}
