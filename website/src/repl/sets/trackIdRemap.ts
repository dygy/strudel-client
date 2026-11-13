/**
 * A deleted track saved again under a new id (spec 018, useSupabaseFileManager's recreate path) is
 * the same music: sets that point at the old id follow it (spec 022, tech §2.4), so the item doesn't
 * turn Missing. useReplContext's replaceTrackId announces it here; useSets listens.
 */
type Listener = (oldId: string, newId: string) => void;

const listeners = new Set<Listener>();

/** Listen for recreated tracks. Returns the unsubscribe. */
export function onTrackIdReplaced(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce that track `oldId` is now `newId`. */
export function announceTrackIdReplaced(oldId: string, newId: string): void {
  if (!oldId || !newId || oldId === newId) return;
  for (const listener of [...listeners]) {
    try {
      listener(oldId, newId);
    } catch (error: unknown) {
      console.warn('[sets] could not follow a recreated track:', error);
    }
  }
}
