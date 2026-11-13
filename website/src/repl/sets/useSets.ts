/**
 * The signed-in user's sets for React (spec 022, tech §2.3): the sets store, loaded while `enabled`
 * (signed in, not the read-only admin view), forgotten when signed out. Recreated tracks are
 * followed (trackIdRemap) and pending saves go out when the page is hidden.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createSetsStore, type SetsState, type SetsStore } from './setsStore';
import { setsApi } from './setsApi';
import { onTrackIdReplaced } from './trackIdRemap';

export interface UseSetsResult extends SetsState {
  store: SetsStore;
}

export function useSets({ enabled, onSaveFailed }: { enabled: boolean; onSaveFailed?: () => void }): UseSetsResult {
  const onSaveFailedRef = useRef(onSaveFailed);
  onSaveFailedRef.current = onSaveFailed;
  const [store] = useState(() => createSetsStore({ api: setsApi, onSaveFailed: () => onSaveFailedRef.current?.() }));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    if (enabled) void store.load();
    else store.reset();
  }, [enabled, store]);

  // A deleted track saved again under a new id: its items follow it (and are saved).
  useEffect(() => onTrackIdReplaced((oldId, newId) => store.remapTrackId(oldId, newId)), [store]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Synchronous: the page may be gone before any awaited step (review 022 #4).
    const flush = () => store.flushOnUnload();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [store]);

  return { ...state, store };
}
