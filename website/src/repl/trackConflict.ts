/**
 * When the server's copy of the open track stops being the one this tab started from (spec 018,
 * functional 2.5, tech 2.6). It finds out, pauses saving for that track, keeps what the user typed
 * in localStorage, and waits for a choice. Nothing the user typed is dropped without that choice.
 *
 * No audio here: "Load the new version" changes the editor and nothing else, so the music carries
 * on until the user presses Update. Framework-free; `useTrackConflict` wires it to the app.
 */
import { atom } from 'nanostores';
import { sameContent, trackVersions, VersionConflictError, type ServerTrack, type TrackVersions } from './trackVersion';

/** While visible; a hidden tab finds out on its return, or on its next save. */
export const POLL_INTERVAL_MS = 20_000;
/** How often text typed during a conflict reaches localStorage. */
export const DRAFT_FLUSH_INTERVAL_MS = 2_000;
const DRAFT_KEY_PREFIX = 'strudel-conflict-draft:';

export type ServerRead<T> = { status: 'found'; value: T } | { status: 'gone' } | { status: 'unknown' };

/** Enough to save the text as a track again if the track is gone. */
export interface TrackDraft {
  userId: string;
  code: string;
  name: string;
  folder: string | null;
  isMultitrack: boolean;
  steps: unknown[];
  activeStep: number;
}

export interface LocalTrackInfo {
  name: string;
  folder: string | null;
  isMultitrack: boolean;
  steps: unknown[];
  activeStep: number;
}

export interface ConflictState {
  trackId: string;
  trackName: string;
  /** `deleted`: there is no new version to load, so that button becomes a discard. */
  kind: 'changed' | 'deleted';
  /** The text to keep is the draft, not the editor (it came back after a reload or a track switch). */
  restored: boolean;
  busy: boolean;
  failed: boolean;
}

export interface TrackConflictDeps {
  userId: string;
  readVersion: (trackId: string) => Promise<ServerRead<string>>;
  readTrack: (trackId: string) => Promise<ServerRead<ServerTrack>>;
  getEditorCode: () => string;
  /** The text in the last synced state, as the editor shows it. Typing is whatever differs from it. */
  getLastSavedCode: (trackId: string) => string;
  getLocalTrack: (trackId: string) => LocalTrackInfo | undefined;
  /** The editor only: no evaluate, no reset. */
  setEditorCode: (trackId: string, code: string) => void;
  /** Sends a save through secureApi. */
  saveCode: (trackId: string, code: string) => Promise<void>;
  /** Local state now agrees with the server: this code, in this track. */
  applySynced: (trackId: string, code: string, server?: ServerTrack) => void;
  /** Saves the text as a new track. `open`: it replaces `oldTrackId` in the editor. Null on failure. */
  recreate: (oldTrackId: string, draft: TrackDraft, open: boolean) => Promise<boolean>;
  removeLocal: (trackId: string) => void;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null;
  versions?: TrackVersions;
  isVisible?: () => boolean;
}

/** The editor's text for a server copy: a multitrack's editor holds one step. */
export function editorCodeFor(server: ServerTrack, baseline: ServerTrack | undefined): string {
  if (server.isMultitrack && baseline) {
    const step = (server.steps[server.activeStep ?? 0] ?? null) as { code?: unknown } | null;
    const stepsChanged = !sameContent({ code: '', steps: baseline.steps }, { code: '', steps: server.steps });
    if (stepsChanged && typeof step?.code === 'string') return step.code;
  }
  return server.code;
}

export const trackConflictStore = atom<ConflictState | null>(null);

export function createTrackConflictController(deps: TrackConflictDeps) {
  const versions = deps.versions ?? trackVersions;
  const isVisible = deps.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let timers: Array<ReturnType<typeof setInterval>> = [];
  let onVisibility: (() => void) | null = null;

  const draftKey = (id: string) => `${DRAFT_KEY_PREFIX}${id}`;

  function readDraft(id: string): TrackDraft | null {
    try {
      const raw = deps.storage?.getItem(draftKey(id));
      const draft = raw ? (JSON.parse(raw) as TrackDraft) : null;
      return draft && draft.userId === deps.userId && typeof draft.code === 'string' ? draft : null;
    } catch {
      return null;
    }
  }

  function writeDraft(id: string, code: string) {
    const local = deps.getLocalTrack(id);
    const previous = readDraft(id);
    const draft: TrackDraft = {
      userId: deps.userId,
      code,
      name: local?.name ?? previous?.name ?? '',
      folder: local?.folder ?? previous?.folder ?? null,
      isMultitrack: local?.isMultitrack ?? previous?.isMultitrack ?? false,
      steps: local?.steps ?? previous?.steps ?? [],
      activeStep: local?.activeStep ?? previous?.activeStep ?? 0,
    };
    try {
      deps.storage?.setItem(draftKey(id), JSON.stringify(draft));
    } catch (error: unknown) {
      // Storage full or blocked. Saving stays paused, so the text is safe for as long as the tab is open.
      console.warn('TrackConflict - could not store the draft:', error);
    }
  }

  function clearDraft(id: string) {
    try {
      deps.storage?.removeItem(draftKey(id));
    } catch (error: unknown) {
      console.warn('TrackConflict - could not remove the draft:', error);
    }
  }

  const current = () => trackConflictStore.get();
  const patch = (changes: Partial<ConflictState>) => {
    const state = current();
    if (state) trackConflictStore.set({ ...state, ...changes });
  };

  function open(id: string, kind: ConflictState['kind'], restored: boolean) {
    versions.pause(id);
    const name = deps.getLocalTrack(id)?.name ?? readDraft(id)?.name ?? '';
    trackConflictStore.set({ trackId: id, trackName: name, kind, restored, busy: false, failed: false });
  }

  /** Keeps the editor's text if anything was typed. */
  function keepTypedText(id: string) {
    const text = deps.getEditorCode();
    if (text !== deps.getLastSavedCode(id)) writeDraft(id, text);
  }

  /** The server moved on. A draft from before (reload, switch) takes the place of the editor's text. */
  function raise(id: string, kind: ConflictState['kind']) {
    const restored = readDraft(id) !== null;
    if (!restored) keepTypedText(id);
    open(id, kind, restored);
  }

  const controller = {
    /** The editor now holds this track (null: none). */
    trackOpened(id: string | null) {
      versions.setOpenTrack(id);
      const state = current();
      // A conflict stays with its own track. Its draft is in storage, and it comes back on reopening.
      // One for a track that no longer exists has nowhere else to appear, so it stays up.
      if (state && state.trackId !== id && deps.getLocalTrack(state.trackId)) {
        trackConflictStore.set(null);
      }
      if (id) void controller.check();
    },

    /** Compares the open track with the server. Never decides on a read that a save may have overlapped. */
    async check(): Promise<void> {
      const id = versions.openTrackId;
      if (!id || current()?.trackId === id || versions.isBusy(id) || !deps.getLocalTrack(id)) return;
      const activity = versions.activity(id);
      const stale = () =>
        versions.openTrackId !== id || versions.isBusy(id) || versions.activity(id) !== activity || !!current();

      const version = await deps.readVersion(id);
      if (stale() || version.status === 'unknown') return;
      if (version.status === 'gone') {
        raise(id, 'deleted');
        return;
      }

      let baseline = versions.get(id);
      if (!baseline || baseline.version !== version.value) {
        const read = await deps.readTrack(id);
        if (stale() || read.status === 'unknown') return;
        if (read.status === 'gone') {
          raise(id, 'deleted');
          return;
        }
        if (baseline && !sameContent(baseline, read.value)) {
          raise(id, 'changed');
          return;
        }
        // A folder move or a rename, or the first look at this track.
        versions.set(id, read.value);
        baseline = read.value;
      }

      const draft = readDraft(id);
      if (draft && draft.code !== editorCodeFor(baseline, baseline)) {
        open(id, 'changed', true);
        return;
      }
      // Nothing left to choose between (it may have been paused earlier, and been put back since).
      if (draft) clearDraft(id);
      versions.resume(id);
    },

    /** A save was refused because the server moved on. `text` is what it tried to write. */
    saveConflicted(id: string, text: string) {
      writeDraft(id, text);
      versions.pause(id);
      if (versions.openTrackId === id) open(id, 'changed', false);
    },

    /** A save found the track gone. */
    saveFoundGone(id: string, text: string) {
      writeDraft(id, text);
      versions.pause(id);
      if (versions.openTrackId === id) open(id, 'deleted', false);
    },

    /** A save that didn't leave the tab because of the conflict. Unload ends up here too. */
    savePaused(id: string, text: string) {
      if (current()?.restored && current()?.trackId === id) return;
      if (text !== deps.getLastSavedCode(id)) writeDraft(id, text);
    },

    /** The text typed so far reaches storage, whenever it's asked and before the page goes. */
    flushDraft() {
      const state = current();
      if (!state || state.restored || versions.openTrackId !== state.trackId) return;
      keepTypedText(state.trackId);
    },

    /** On the open track: an orphan draft's notice says nothing about what's in the editor. */
    hasOpenConflict: () => {
      const state = current();
      return state !== null && state.trackId === versions.openTrackId;
    },

    /** Drafts of tracks that no longer exist: no track will ever open to offer them. */
    offerOrphanDrafts(knownTrackIds: Set<string>) {
      if (current() || !deps.storage) return;
      for (let i = 0; i < deps.storage.length; i++) {
        const key = deps.storage.key(i);
        if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue;
        const id = key.slice(DRAFT_KEY_PREFIX.length);
        if (!knownTrackIds.has(id) && readDraft(id)) {
          open(id, 'deleted', true);
          return;
        }
      }
    },

    async loadNewVersion(): Promise<void> {
      const state = current();
      if (!state || state.busy) return;
      patch({ busy: true, failed: false });
      const read = await deps.readTrack(state.trackId);
      if (read.status === 'unknown') {
        patch({ busy: false, failed: true });
        return;
      }
      if (read.status === 'gone') {
        patch({ busy: false, kind: 'deleted' });
        return;
      }
      const code = editorCodeFor(read.value, versions.get(state.trackId));
      versions.set(state.trackId, read.value);
      versions.resume(state.trackId);
      clearDraft(state.trackId);
      // Local state first, so autosave never sees the new text as unsaved typing.
      deps.applySynced(state.trackId, code, read.value);
      deps.setEditorCode(state.trackId, code);
      trackConflictStore.set(null);
    },

    async keepMine(): Promise<void> {
      const state = current();
      if (!state || state.busy) return;
      const id = state.trackId;
      const draft = readDraft(id);
      const isOpen = versions.openTrackId === id;
      const text = state.restored && draft ? draft.code : deps.getEditorCode();
      patch({ busy: true, failed: false });

      const read = await deps.readTrack(id);
      if (read.status === 'unknown') {
        if (!state.restored) writeDraft(id, text);
        patch({ busy: false, failed: true });
        return;
      }

      if (read.status === 'gone') {
        if (!state.restored) writeDraft(id, text);
        const recreated = await deps.recreate(id, readDraft(id) ?? emptyDraft(text), isOpen);
        if (!recreated) {
          patch({ busy: false, failed: true });
          return;
        }
        clearDraft(id);
        versions.forget(id);
        trackConflictStore.set(null);
        return;
      }

      // Save on top of what's there now. The user has seen the message and chose this.
      versions.set(id, read.value);
      versions.resume(id);
      try {
        await deps.saveCode(id, text);
      } catch (error: unknown) {
        versions.pause(id);
        writeDraft(id, text);
        // Yet another change landed meanwhile: the notice simply stays up.
        if (!(error instanceof VersionConflictError)) console.warn('TrackConflict - Keep mine failed:', error);
        patch({ busy: false, failed: !(error instanceof VersionConflictError) });
        return;
      }
      clearDraft(id);
      deps.applySynced(id, text);
      if (isOpen && deps.getEditorCode() !== text) deps.setEditorCode(id, text);
      trackConflictStore.set(null);
    },

    /** A deleted track: the user lets it go. */
    discard() {
      const state = current();
      if (!state || state.busy) return;
      clearDraft(state.trackId);
      versions.forget(state.trackId);
      deps.removeLocal(state.trackId);
      trackConflictStore.set(null);
    },

    /** The user deleted this track in this tab: its draft goes with it. */
    trackDeletedHere(id: string) {
      clearDraft(id);
      versions.forget(id);
      if (current()?.trackId === id) trackConflictStore.set(null);
    },

    startWatching(win: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = null) {
      controller.stopWatching();
      timers = [
        setInterval(() => {
          if (isVisible()) void controller.check();
        }, POLL_INTERVAL_MS),
        setInterval(() => controller.flushDraft(), DRAFT_FLUSH_INTERVAL_MS),
      ];
      const target = win ?? (typeof document !== 'undefined' ? document : null);
      if (target) {
        onVisibility = () => {
          if (isVisible()) void controller.check();
        };
        target.addEventListener('visibilitychange', onVisibility);
      }
      stopVisibility = () => {
        if (target && onVisibility) target.removeEventListener('visibilitychange', onVisibility);
        onVisibility = null;
      };
    },

    stopWatching() {
      timers.forEach(clearInterval);
      timers = [];
      stopVisibility?.();
      stopVisibility = null;
    },
  };

  let stopVisibility: (() => void) | null = null;

  function emptyDraft(code: string): TrackDraft {
    return { userId: deps.userId, code, name: '', folder: null, isMultitrack: false, steps: [], activeStep: 0 };
  }

  return controller;
}

export type TrackConflictController = ReturnType<typeof createTrackConflictController>;

/** What the page-unload handlers reach, without importing the file manager. */
let activeController: TrackConflictController | null = null;

export function setActiveTrackConflictController(controller: TrackConflictController | null) {
  activeController = controller;
}

export const hasOpenTrackConflict = () => activeController?.hasOpenConflict() ?? false;
export const flushTrackConflictDraft = () => activeController?.flushDraft();
