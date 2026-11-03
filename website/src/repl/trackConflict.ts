/**
 * When the server's copy of the open track stops being the one this tab started from (spec 018,
 * functional 2.5, tech 2.6). It finds out, pauses saving for that track, keeps what the user typed
 * in localStorage, and waits for a choice. Nothing the user typed is dropped without that choice.
 *
 * No audio here: "Load the new version" changes the editor and nothing else, so the music carries
 * on until the user presses Update. Framework-free; `useTrackConflict` wires it to the app.
 */
import { atom } from 'nanostores';
import { activeStepIndex, hasSteps, stepsWithText, type StepLike } from '../lib/multitrack';
import {
  sameContent,
  sameSteps,
  trackVersions,
  VersionConflictError,
  type ServerTrack,
  type TrackVersions,
} from './trackVersion';

/** While visible; a hidden tab finds out on its return, or on its next save. */
export const POLL_INTERVAL_MS = 20_000;
/** How often text typed during a conflict reaches localStorage. */
export const DRAFT_FLUSH_INTERVAL_MS = 2_000;
/** How long a reload waits for the last page's keepalive save, before asking the user about it. */
export const UNLOAD_SAVE_WAITS_MS = [500, 1500];
/** A draft older than this can't be waiting for a save that's still on its way. */
const LANDING_WINDOW_MS = 10_000;
/** Another tab's draft younger than this may belong to a tab that's only reloading. */
const CLAIM_GRACE_MS = 30_000;
/** An unclaimed draft older than this is removed, and the user is told. */
export const DRAFT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const DRAFT_KEY_PREFIX = 'strudel-conflict-draft:';

export type ServerRead<T> = { status: 'found'; value: T } | { status: 'gone' } | { status: 'unknown' };

/** Text not known to be on the server, saying whose it is and what it was typed against. One per track per tab. */
export interface TrackDraft {
  userId: string;
  tabId: string;
  trackId: string;
  /** The step `code` belongs to. */
  stepIndex: number;
  code: string;
  /** All the steps, with `code` in place (none for a plain track). */
  steps: StepLike[];
  /** The server version this was typed against. */
  baseVersion: string | null;
  createdAt: number;
  // To save it as a track again if the track is gone.
  name: string;
  folder: string | null;
  isMultitrack: boolean;
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
  /** Text from an earlier page: `unsaved` if the server hasn't moved since, `moved` if it has. */
  draftOrigin?: 'unsaved' | 'moved';
  busy: boolean;
  failed: boolean;
}

export interface TrackConflictDeps {
  userId: string;
  /** Stays the same across a reload of this tab. */
  tabId: string;
  isTabAlive?: (tabId: string) => Promise<boolean>;
  readVersion: (trackId: string) => Promise<ServerRead<string>>;
  readTrack: (trackId: string) => Promise<ServerRead<ServerTrack>>;
  getEditorCode: () => string;
  /** What the editor holds if nothing was typed. */
  getLastSavedCode: (trackId: string) => string;
  getLocalTrack: (trackId: string) => LocalTrackInfo | undefined;
  /** No evaluate, no reset. */
  setEditorCode: (trackId: string, code: string) => void;
  /** Puts a draft on screen: its steps in local state, its step open, its text in the editor. */
  showDraft: (trackId: string, draft: TrackDraft) => void;
  /** Saves `code` into the open step of a track, through secureApi. */
  saveCode: (trackId: string, code: string) => Promise<void>;
  /** Local state now agrees with the server. */
  applySynced: (trackId: string, code: string, server: ServerTrack) => void;
  /** Saves the draft as a new track. `open`: it replaces `oldTrackId` in the editor. False on failure. */
  recreate: (oldTrackId: string, draft: TrackDraft, open: boolean) => Promise<boolean>;
  removeLocal: (trackId: string) => void;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null;
  versions?: TrackVersions;
  isVisible?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** The editor's text for a server copy. `stepIndex` keeps the user on their step, if it's still there. */
export function editorCodeFor(server: ServerTrack, stepIndex?: number): string {
  const steps = server.steps as StepLike[];
  const step = server.isMultitrack
    ? (steps[stepIndex ?? server.activeStep ?? 0] ?? steps[server.activeStep ?? 0])
    : null;
  return typeof step?.code === 'string' ? step.code : server.code;
}

/** Is everything in the draft already on the server, including the steps that weren't open? */
const onServer = (draft: TrackDraft, server: ServerTrack) =>
  draft.steps.length > 0 ? sameSteps(draft.steps, server.steps) : draft.code === server.code;

export const trackConflictStore = atom<ConflictState | null>(null);

export function createTrackConflictController(deps: TrackConflictDeps) {
  const versions = deps.versions ?? trackVersions;
  const isVisible = deps.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isTabAlive = deps.isTabAlive ?? (async () => false);
  // Tracks whose draft is a copy of what's still in this page's editor (a hide, not a goodbye).
  const stillInEditor = new Set<string>();
  // Tracks this page has written a draft for: no save from an earlier page can be landing for those.
  const writtenHere = new Set<string>();
  let stopWatchingNow: (() => void) | null = null;

  const keyOf = (draft: TrackDraft) => `${DRAFT_KEY_PREFIX}${draft.trackId}:${draft.tabId}`;
  const store = (action: (storage: NonNullable<TrackConflictDeps['storage']>) => void) => {
    try {
      if (deps.storage) action(deps.storage);
    } catch (error: unknown) {
      // Storage full or blocked. Saving stays paused, so the text is safe for as long as the tab is open.
      console.warn('TrackConflict - draft storage failed:', error);
    }
  };

  /** This user's drafts, for one track or all of them. */
  function drafts(trackId?: string): TrackDraft[] {
    const found: TrackDraft[] = [];
    store((storage) => {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(`${DRAFT_KEY_PREFIX}${trackId ? `${trackId}:` : ''}`)) continue;
        try {
          const draft = JSON.parse(storage.getItem(key) ?? 'null') as TrackDraft | null;
          if (draft?.userId === deps.userId && typeof draft.code === 'string') found.push(draft);
        } catch {
          // Not ours to interpret.
        }
      }
    });
    return found.sort((a, b) => b.createdAt - a.createdAt);
  }
  const ownDraft = (trackId: string) => drafts(trackId).find((draft) => draft.tabId === deps.tabId) ?? null;
  const removeDraft = (draft: TrackDraft) => store((storage) => storage.removeItem(keyOf(draft)));
  const removeAllDrafts = (trackId: string) => drafts(trackId).forEach(removeDraft);
  const removeOwnDraft = (trackId: string) => {
    const own = ownDraft(trackId);
    if (own) removeDraft(own);
  };

  /** The draft to deal with here: this tab's own from an earlier page, or one a closed tab left. */
  async function draftForThisTab(trackId: string): Promise<TrackDraft | null> {
    if (stillInEditor.has(trackId)) return null;
    for (const draft of drafts(trackId)) {
      if (await isOursToTake(draft)) return draft;
    }
    return null;
  }

  /** This tab's own, or one its closed tab can't come back for. */
  async function isOursToTake(draft: TrackDraft) {
    if (draft.tabId === deps.tabId) return true;
    return Date.now() - draft.createdAt >= CLAIM_GRACE_MS && !(await isTabAlive(draft.tabId));
  }

  function keep(trackId: string, code: string, stepIndex?: number): TrackDraft {
    const local = deps.getLocalTrack(trackId);
    const previous = ownDraft(trackId);
    const steps = (local?.steps ?? previous?.steps ?? []) as StepLike[];
    const isMultitrack = hasSteps({ code, steps, isMultitrack: local?.isMultitrack ?? previous?.isMultitrack });
    const index = activeStepIndex({ code, steps, activeStep: stepIndex ?? local?.activeStep ?? previous?.stepIndex });
    const draft: TrackDraft = {
      userId: deps.userId,
      tabId: deps.tabId,
      trackId,
      stepIndex: isMultitrack ? index : 0,
      code,
      steps: isMultitrack ? stepsWithText(steps, index, code) : [],
      baseVersion: versions.get(trackId)?.version ?? previous?.baseVersion ?? null,
      createdAt: Date.now(),
      name: local?.name ?? previous?.name ?? '',
      folder: local?.folder ?? previous?.folder ?? null,
      isMultitrack,
    };
    writtenHere.add(trackId);
    store((storage) => storage.setItem(keyOf(draft), JSON.stringify(draft)));
    return draft;
  }

  const current = () => trackConflictStore.get();
  const onTrack = (id: string) => current()?.trackId === id;
  const patch = (id: string, changes: Partial<ConflictState>) => {
    if (onTrack(id)) trackConflictStore.set({ ...current()!, ...changes });
  };
  const close = (id: string) => onTrack(id) && trackConflictStore.set(null);

  function raise(id: string, kind: ConflictState['kind'], draftOrigin?: ConflictState['draftOrigin'], name?: string) {
    versions.pause(id);
    stillInEditor.delete(id);
    trackConflictStore.set({
      trackId: id,
      trackName: deps.getLocalTrack(id)?.name ?? name ?? ownDraft(id)?.name ?? '',
      kind,
      ...(draftOrigin ? { draftOrigin } : {}),
      busy: false,
      failed: false,
    });
  }

  const hasTyped = (id: string) => deps.getEditorCode() !== deps.getLastSavedCode(id);

  /** The server moved on or the track went, with whatever is in the editor still the user's. */
  function raiseKeepingText(id: string, kind: ConflictState['kind']) {
    if (hasTyped(id)) keep(id, deps.getEditorCode());
    raise(id, kind);
  }

  /**
   * Where the editor is now. An action that awaited anything compares this before it touches the
   * editor: the user may have moved to another track or step, and its text doesn't belong there.
   */
  function position() {
    const trackId = versions.openTrackId;
    const local = trackId ? deps.getLocalTrack(trackId) : undefined;
    return `${trackId}:${local ? activeStepIndex(local as never) : 0}`;
  }

  /** Our own save from the last page landed: show it, as if nothing had happened. */
  function adopt(id: string, server: ServerTrack, draft: TrackDraft) {
    const local = deps.getLocalTrack(id);
    const code = editorCodeFor(server, local?.isMultitrack ? local.activeStep : undefined);
    versions.set(id, server);
    versions.resume(id);
    removeDraft(draft);
    deps.applySynced(id, code, server);
    if (deps.getEditorCode() !== code) deps.setEditorCode(id, code);
  }

  const controller = {
    /** The editor now holds this track (null: none). */
    trackOpened(id: string | null) {
      versions.setOpenTrack(id);
      stillInEditor.clear();
      const state = current();
      // A conflict stays with its own track, and comes back on reopening. One for a track that no
      // longer exists has nowhere else to appear, so it stays up.
      if (state && state.trackId !== id && deps.getLocalTrack(state.trackId)) trackConflictStore.set(null);
      if (id) void controller.check();
    },

    /** Compares the open track with the server. Never decides on a read that a save may have overlapped. */
    async check(): Promise<void> {
      const id = versions.openTrackId;
      if (!id || onTrack(id) || versions.isBusy(id) || !deps.getLocalTrack(id)) return;
      const activity = versions.activity(id);
      const stale = () =>
        versions.openTrackId !== id || versions.isBusy(id) || versions.activity(id) !== activity || !!current();

      const version = await deps.readVersion(id);
      if (stale() || version.status === 'unknown') return;
      if (version.status === 'gone') return raiseKeepingText(id, 'deleted');

      const baseline = versions.get(id);
      let server = baseline;
      if (!baseline || baseline.version !== version.value) {
        const read = await deps.readTrack(id);
        if (stale() || read.status === 'unknown') return;
        if (read.status === 'gone') return raiseKeepingText(id, 'deleted');
        server = read.value;
      }
      if (!server) return;

      let draft = await draftForThisTab(id);
      if (stale()) return;
      // A reload is usually faster than the save it started, so give that a moment.
      const mayBeLanding =
        draft &&
        !onServer(draft, server) &&
        draft.tabId === deps.tabId &&
        !writtenHere.has(id) &&
        draft.baseVersion === server.version &&
        Date.now() - draft.createdAt < LANDING_WINDOW_MS;
      if (draft && mayBeLanding) {
        const shown = deps.getEditorCode();
        for (const wait of UNLOAD_SAVE_WAITS_MS) {
          await sleep(wait);
          if (stale() || deps.getEditorCode() !== shown) break;
          const read = await deps.readTrack(id);
          if (read.status === 'found') server = read.value;
          if (onServer(draft, server)) break;
        }
        if (stale()) return;
      }

      if (draft && onServer(draft, server)) {
        const own = draft.tabId === deps.tabId;
        if (own && !hasTyped(id)) {
          adopt(id, server, draft);
          return;
        }
        removeDraft(draft);
        draft = null;
      }

      if (draft && !hasTyped(id)) {
        // From here on the text is this tab's, and on screen: typing updates it, Keep mine saves it.
        removeDraft(draft);
        const origin = draft.baseVersion === server.version ? 'unsaved' : 'moved';
        deps.showDraft(id, { ...draft, tabId: deps.tabId });
        keep(id, draft.code, draft.stepIndex);
        raise(id, 'changed', origin, draft.name);
        return;
      }

      if (baseline && !sameContent(baseline, server)) return raiseKeepingText(id, 'changed');
      // A folder move or a rename, or the first look, or it's back to what the tab holds.
      versions.set(id, server);
      versions.resume(id);
    },

    /** A save was refused: the server moved on, or the track is gone. `text` is what it tried to write. */
    saveRefused(id: string, kind: ConflictState['kind'], text: string, stepIndex?: number) {
      keep(id, text, stepIndex);
      versions.pause(id);
      if (versions.openTrackId === id) raise(id, kind);
    },

    /** A save that didn't leave the tab because of the conflict. Unload ends up here too. */
    savePaused(id: string, text: string) {
      const own = ownDraft(id);
      if (own?.code !== text && (text !== deps.getLastSavedCode(id) || own)) keep(id, text);
    },

    /**
     * Text not on the server yet. `inEditor`: the page may stay and still holds it, so this page won't
     * offer it to itself. Otherwise (leaving this track) it's offered on the way back. True if stored.
     */
    keepDraft(
      id: string,
      text: string,
      { inEditor = false, stepIndex }: { inEditor?: boolean; stepIndex?: number } = {},
    ) {
      keep(id, text, stepIndex);
      if (inEditor) stillInEditor.add(id);
      else stillInEditor.delete(id);
      return ownDraft(id)?.code === text;
    },

    /**
     * A save built at `sentAt` reached the server, and the baseline is already its version. A draft from
     * before that is older than what's saved now, so it goes. One written while the save was in flight
     * holds newer text, which stays, now typed against the version this save made. `leaving`: the next
     * page may have read the row before this landed, and needs the draft to recognise it.
     */
    textSaved(id: string, text: string, sentAt: number, { leaving = false } = {}) {
      const draft = ownDraft(id);
      if (!draft) return;
      if (draft.code === text || draft.createdAt <= sentAt) {
        if (!leaving) {
          removeDraft(draft);
          stillInEditor.delete(id);
        }
      } else {
        const rebased = { ...draft, baseVersion: versions.get(id)?.version ?? draft.baseVersion };
        store((storage) => storage.setItem(keyOf(rebased), JSON.stringify(rebased)));
      }
    },

    /** The text typed so far reaches storage, whenever it's asked and before the page goes. */
    flushDraft() {
      const state = current();
      if (!state || versions.openTrackId !== state.trackId) return;
      // Written even if unchanged: a recent time tells other tabs this one may only be reloading.
      if (ownDraft(state.trackId) || hasTyped(state.trackId)) keep(state.trackId, deps.getEditorCode());
    },

    /** On the open track: a notice for a track that's gone says nothing about what's in the editor. */
    hasOpenConflict: () => current() !== null && onTrack(versions.openTrackId ?? ''),

    /**
     * Removes drafts the server already holds, going by the rows just loaded, and those past their
     * expiry. Returns the expired ones, which may be the only copy, so that the user can be told.
     */
    async sweepDrafts(): Promise<TrackDraft[]> {
      const expired: TrackDraft[] = [];
      for (const draft of drafts()) {
        if (!(await isOursToTake(draft))) continue;
        const server = versions.get(draft.trackId);
        if (Date.now() - draft.createdAt >= DRAFT_EXPIRY_MS) {
          if (!server || !onServer(draft, server)) expired.push(draft);
          removeDraft(draft);
        } else if (server && onServer(draft, server)) {
          removeDraft(draft);
        }
      }
      return expired;
    },

    /** Drafts of tracks that no longer exist: no track will ever open to offer them. */
    async offerOrphanDrafts(knownTrackIds: Set<string>) {
      for (const draft of drafts()) {
        if (current()) return;
        if (knownTrackIds.has(draft.trackId) || !(await isOursToTake(draft))) continue;
        // It's this tab's now, so that the choice below ends it and no other tab's.
        removeDraft(draft);
        const claimed = { ...draft, tabId: deps.tabId };
        store((storage) => storage.setItem(keyOf(claimed), JSON.stringify(claimed)));
        raise(draft.trackId, 'deleted', undefined, draft.name);
        return;
      }
    },

    async loadNewVersion(): Promise<void> {
      const state = current();
      if (!state || state.busy) return;
      const id = state.trackId;
      const where = position();
      patch(id, { busy: true, failed: false });
      const read = await deps.readTrack(id);
      if (read.status === 'unknown') return patch(id, { busy: false, failed: true });
      if (read.status === 'gone') return patch(id, { busy: false, kind: 'deleted', draftOrigin: undefined });
      const local = deps.getLocalTrack(id);
      const code = editorCodeFor(read.value, local?.isMultitrack ? local.activeStep : undefined);
      versions.set(id, read.value);
      versions.resume(id);
      removeOwnDraft(id);
      // Local state first, so autosave never sees the new text as unsaved typing.
      deps.applySynced(id, code, read.value);
      if (position() === where) deps.setEditorCode(id, code);
      close(id);
    },

    async keepMine(): Promise<void> {
      const state = current();
      if (!state || state.busy) return;
      const id = state.trackId;
      const isOpen = versions.openTrackId === id;
      const text = isOpen ? deps.getEditorCode() : (ownDraft(id)?.code ?? drafts(id)[0]?.code ?? '');
      const fail = () => patch(id, { busy: false, failed: true });
      patch(id, { busy: true, failed: false });

      const read = await deps.readTrack(id);
      if (read.status === 'unknown') {
        if (isOpen) keep(id, text);
        return fail();
      }
      if (read.status === 'gone') {
        const draft = isOpen ? keep(id, text) : (ownDraft(id) ?? drafts(id)[0]);
        if (!draft || !(await deps.recreate(id, draft, isOpen && versions.openTrackId === id))) return fail();
        removeOwnDraft(id);
        versions.forget(id);
        return close(id);
      }

      // Save on top of what's there now. The user has seen the message and chose this.
      versions.set(id, read.value);
      versions.resume(id);
      try {
        await deps.saveCode(id, text);
      } catch (error: unknown) {
        versions.pause(id);
        keep(id, text);
        // Yet another change landed meanwhile: the notice simply stays up.
        if (error instanceof VersionConflictError) return patch(id, { busy: false });
        console.warn('TrackConflict - Keep mine failed:', error);
        return fail();
      }
      removeOwnDraft(id);
      close(id);
    },

    /** A deleted track: the user lets this text go. */
    discard() {
      const state = current();
      if (!state || state.busy) return;
      removeOwnDraft(state.trackId);
      versions.forget(state.trackId);
      close(state.trackId);
      deps.removeLocal(state.trackId);
    },

    /** The user deleted this track: its drafts go with it. */
    trackDeletedHere(id: string) {
      removeAllDrafts(id);
      versions.forget(id);
      close(id);
    },

    startWatching(target: Pick<Document, 'addEventListener' | 'removeEventListener'> | null = null) {
      controller.stopWatching();
      const pollIfVisible = () => isVisible() && void controller.check();
      const poll = setInterval(pollIfVisible, POLL_INTERVAL_MS);
      const flush = setInterval(() => controller.flushDraft(), DRAFT_FLUSH_INTERVAL_MS);
      const events = target ?? (typeof document !== 'undefined' ? document : null);
      events?.addEventListener('visibilitychange', pollIfVisible);
      stopWatchingNow = () => {
        clearInterval(poll);
        clearInterval(flush);
        events?.removeEventListener('visibilitychange', pollIfVisible);
      };
    },

    stopWatching() {
      stopWatchingNow?.();
      stopWatchingNow = null;
    },
  };

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
