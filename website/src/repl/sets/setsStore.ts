/**
 * The user's sets in the browser (spec 022 §2.1–2.2, tech §2.3 useSets): loaded when signed in,
 * edited optimistically, saved within 2 seconds.
 *
 * - Item edits show at once and are saved after a short pause (several quick edits = one save).
 * - A failed save keeps the change on screen, says "Couldn't save the set — retrying" and retries
 *   with backoff.
 * - A `version_conflict` (the set changed elsewhere) adopts the server's version and sends the
 *   local items again, once; a second conflict adopts the server's set.
 * - A set deleted elsewhere (404) disappears.
 * - Renames wait for the server, because a clash must be refused and the old name kept.
 *
 * No React here (useSets wraps it), so the timing can be tested with an injected scheduler.
 */
import { nanoid } from 'nanoid';
import { nextFreeSetName, validateSetName, type SetItem, type SetList } from '../../lib/setLists';
import { SetsApiError, type SetsApi } from './setsApi';

export interface SetsState {
  sets: SetList[];
  /** The list has been loaded at least once. */
  loaded: boolean;
  loading: boolean;
  loadFailed: boolean;
}

export type Schedule = (task: () => void, ms: number) => () => void;

export interface SetsStoreDeps {
  api: Pick<SetsApi, 'list' | 'create' | 'update' | 'remove'> & Partial<Pick<SetsApi, 'sendOnUnload'>>;
  /** A save failed and will be retried (the toast). */
  onSaveFailed?: (setId: string) => void;
  /** Wait after the last edit before saving. ≤ 2 s (spec 2.2). */
  debounceMs?: number;
  /** Backoff between retries of a failed save; the last value repeats. */
  retryMs?: number[];
  schedule?: Schedule;
}

export type RenameResult = 'ok' | 'invalid' | 'name_taken' | 'failed';
export type CreateResult = { ok: true; set: SetList } | { ok: false; error: 'name_taken' | 'invalid' | 'failed' };

const defaultSchedule: Schedule = (task, ms) => {
  const id = setTimeout(task, ms);
  return () => clearTimeout(id);
};

const EMPTY: SetsState = { sets: [], loaded: false, loading: false, loadFailed: false };

/** A new item for track `trackId` (or one of its steps), on Default transition. */
export function newSetItem(target: {
  trackId: string;
  stepId?: string;
  stepName?: string;
  stepIndex?: number;
}): SetItem {
  const item: SetItem = { id: nanoid(12), trackId: target.trackId, transition: null };
  if (target.stepIndex !== undefined) {
    item.stepIndex = target.stepIndex;
    if (target.stepId) item.stepId = target.stepId;
    if (target.stepName !== undefined) item.stepName = target.stepName;
  }
  return item;
}

export function createSetsStore(deps: SetsStoreDeps) {
  const { api } = deps;
  const debounceMs = deps.debounceMs ?? 800;
  const retryMs = deps.retryMs?.length ? deps.retryMs : [2000, 4000, 8000, 16000, 30000];
  const schedule = deps.schedule ?? defaultSchedule;

  let state: SetsState = EMPTY;
  const listeners = new Set<() => void>();
  // set id -> pending save timer / retry count / a save is on the wire
  const timers = new Map<string, () => void>();
  const attempts = new Map<string, number>();
  const inFlight = new Set<string>();
  // set id -> its items changed after the save on the wire was sent
  const dirtyAgain = new Set<string>();
  // Bumped on reset (sign-out): answers to an older generation are dropped.
  let generation = 0;

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const setState = (next: Partial<SetsState>) => {
    state = { ...state, ...next };
    emit();
  };
  const find = (id: string) => state.sets.find((set) => set.id === id);
  const replaceSet = (id: string, change: (set: SetList) => SetList) =>
    setState({ sets: state.sets.map((set) => (set.id === id ? change(set) : set)) });
  const sortByName = (sets: SetList[]) => [...sets].sort((a, b) => a.name.localeCompare(b.name));

  const cancelTimer = (id: string) => {
    timers.get(id)?.();
    timers.delete(id);
  };

  const scheduleSave = (id: string, ms: number) => {
    cancelTimer(id);
    timers.set(
      id,
      schedule(() => {
        timers.delete(id);
        void save(id);
      }, ms),
    );
  };

  async function save(id: string, conflictRetried = false): Promise<void> {
    const local = find(id);
    if (!local) return;
    if (inFlight.has(id)) {
      dirtyAgain.add(id);
      return;
    }
    const gen = generation;
    inFlight.add(id);
    dirtyAgain.delete(id);
    const sentItems = local.items;
    try {
      const saved = await api.update(id, { items: sentItems }, () => find(id)?.version ?? local.version);
      if (gen !== generation) return;
      attempts.delete(id);
      // Keep edits made while this save was on the wire; take the server's version.
      replaceSet(id, (set) => ({ ...set, version: saved.version, name: saved.name }));
    } catch (error: unknown) {
      if (gen !== generation) return;
      if (error instanceof SetsApiError && error.code === 'version_conflict' && error.current) {
        const current = error.current;
        if (!conflictRetried) {
          // Adopt the server's version and send the local items again, once.
          replaceSet(id, (set) => ({ ...set, version: current.version, name: current.name }));
          inFlight.delete(id);
          await save(id, true);
          return;
        }
        replaceSet(id, () => current);
        return;
      }
      if (error instanceof SetsApiError && error.status === 404) {
        setState({ sets: state.sets.filter((set) => set.id !== id) });
        return;
      }
      const attempt = attempts.get(id) ?? 0;
      attempts.set(id, attempt + 1);
      deps.onSaveFailed?.(id);
      scheduleSave(id, retryMs[Math.min(attempt, retryMs.length - 1)]);
      return;
    } finally {
      if (gen === generation) inFlight.delete(id);
    }
    if (dirtyAgain.has(id)) scheduleSave(id, debounceMs);
  }

  const store = {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Load the signed-in user's sets. */
    async load(): Promise<void> {
      const gen = generation;
      setState({ loading: true, loadFailed: false });
      try {
        const sets = await api.list();
        if (gen !== generation) return;
        setState({ sets: sortByName(sets), loaded: true, loading: false });
      } catch (error: unknown) {
        if (gen !== generation) return;
        console.warn('[sets] could not load the sets:', error);
        setState({ loading: false, loadFailed: true });
      }
    },

    /** A new set named `name`, or the first free "<base> N". */
    async create(name: string | undefined, base: string): Promise<CreateResult> {
      const wanted =
        name === undefined
          ? nextFreeSetName(
              base,
              state.sets.map((s) => s.name),
            )
          : validateSetName(name);
      if (!wanted) return { ok: false, error: 'invalid' };
      if (state.sets.some((set) => set.name === wanted)) return { ok: false, error: 'name_taken' };
      try {
        const set = await api.create(wanted);
        setState({ sets: sortByName([...state.sets, set]) });
        return { ok: true, set };
      } catch (error: unknown) {
        if (error instanceof SetsApiError && error.code === 'name_taken') return { ok: false, error: 'name_taken' };
        console.warn('[sets] could not create a set:', error);
        return { ok: false, error: 'failed' };
      }
    },

    /** Rename a set. Refused (old name kept) when empty, too long, or another set has the name. */
    async rename(id: string, name: string): Promise<RenameResult> {
      const set = find(id);
      const wanted = validateSetName(name);
      if (!set || !wanted) return 'invalid';
      if (wanted === set.name) return 'ok';
      if (state.sets.some((other) => other.id !== id && other.name === wanted)) return 'name_taken';
      try {
        const saved = await api.update(id, { name: wanted }, () => find(id)?.version ?? set.version);
        replaceSet(id, (current) => ({ ...current, name: saved.name, version: saved.version }));
        setState({ sets: sortByName(state.sets) });
        return 'ok';
      } catch (error: unknown) {
        if (error instanceof SetsApiError && error.code === 'name_taken') return 'name_taken';
        if (error instanceof SetsApiError && error.code === 'version_conflict' && error.current) {
          // Changed elsewhere: take what's there now, then try the rename once more.
          const current = error.current;
          replaceSet(id, (s) => ({ ...s, version: current.version }));
          try {
            const saved = await api.update(id, { name: wanted }, current.version);
            replaceSet(id, (s) => ({ ...s, name: saved.name, version: saved.version }));
            return 'ok';
          } catch {
            return 'failed';
          }
        }
        console.warn('[sets] could not rename the set:', error);
        return 'failed';
      }
    },

    /** Delete a set (never its tracks). */
    async remove(id: string): Promise<boolean> {
      cancelTimer(id);
      try {
        await api.remove(id);
      } catch (error: unknown) {
        if (!(error instanceof SetsApiError && error.status === 404)) {
          console.warn('[sets] could not delete the set:', error);
          return false;
        }
      }
      attempts.delete(id);
      setState({ sets: state.sets.filter((set) => set.id !== id) });
      return true;
    },

    /** Change a set's items: shown at once, saved after a short pause. */
    updateItems(id: string, change: (items: SetItem[]) => SetItem[]): void {
      const set = find(id);
      if (!set) return;
      const items = change([...set.items]);
      if (items === set.items) return;
      replaceSet(id, (current) => ({ ...current, items }));
      if (inFlight.has(id)) dirtyAgain.add(id);
      scheduleSave(id, debounceMs);
    },

    /** A recreated track (new id): every item pointing at the old id follows it. */
    remapTrackId(oldId: string, newId: string): void {
      for (const set of state.sets) {
        if (set.items.some((item) => item.trackId === oldId)) {
          store.updateItems(set.id, (items) =>
            items.map((item) => (item.trackId === oldId ? { ...item, trackId: newId } : item)),
          );
        }
      }
    },

    /** Save every pending change now (e.g. before the page goes away). */
    flush(): void {
      for (const id of [...timers.keys()]) {
        cancelTimer(id);
        void save(id);
      }
    },

    /**
     * The page is going away (pagehide): every unsaved change goes out synchronously, in this call
     * (setsApi.sendOnUnload: keepalive, no await before the fetch). A waiting debounce, a retry
     * after a failure and an edit made while a save was on the wire all count as unsaved.
     */
    flushOnUnload(): void {
      const pending = new Set([...timers.keys(), ...dirtyAgain]);
      for (const id of pending) {
        cancelTimer(id);
        dirtyAgain.delete(id);
        const set = find(id);
        if (!set) continue;
        const sent = api.sendOnUnload?.(id, { items: set.items }, set.version);
        if (sent !== 'sent') void save(id);
      }
    },

    /** Whether a change is waiting to be saved. */
    hasPendingSaves: () => timers.size > 0 || inFlight.size > 0,

    /** Signed out: forget everything. */
    reset(): void {
      generation++;
      for (const id of [...timers.keys()]) cancelTimer(id);
      attempts.clear();
      inFlight.clear();
      dirtyAgain.clear();
      state = EMPTY;
      emit();
    },
  };
  return store;
}

export type SetsStore = ReturnType<typeof createSetsStore>;
