/**
 * The set playlist for the REPL (spec 022, tech §2.3): the user's sets (useSets), the player
 * (setPlayerController) wired to the REPL's set bridge, the Alt+Shift+N key, and the actions the
 * Set tab, the set bar and the library's "Add to set" use. ReplEditor calls it once and provides it
 * through SetPlayerContext; components read it with useSetPlayerContext (null outside the REPL).
 *
 * Off (no sets loaded, the key inert, nothing shown) while signed out and in the read-only admin view.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from '@src/i18n';
import { toastActions } from '@src/stores/toastStore';
import type { SetItem, SetItemTransition, SetList } from '../../lib/setLists';
import type { SetBridge } from './setBridge';
import { createSetPlayerController, type CueFailure } from './setPlayerController';
import { buttonMode, isEndOfSet, NO_SET, type SetPlayerState } from './setPlayer';
import { readSetPosition, writeSetPosition } from './setPosition';
import { installSetShortcut } from './setShortcut';
import { useSets } from './useSets';
import { newSetItem, type CreateResult, type RenameResult } from './setsStore';
import type { LibraryTrack } from './resolveItem';

/** What "Add to set" adds: a track, or one step of a multitrack. */
export interface AddToSetTarget {
  trackId: string;
  stepIndex?: number;
}

export interface SetPlayerContextValue {
  /** Signed in and not read-only: sets can be loaded, built and played. */
  enabled: boolean;
  signedIn: boolean;
  sets: SetList[];
  loaded: boolean;
  loadFailed: boolean;
  tracks: Record<string, LibraryTrack | undefined>;
  /** The set open in the Set tab. */
  openSetId: string | null;
  setOpenSetId: (id: string | null) => void;
  player: SetPlayerState;
  buttonMode: 'cue' | 'go';
  endOfSet: boolean;
  createSet: (name?: string) => Promise<CreateResult>;
  renameSet: (id: string, name: string) => Promise<RenameResult>;
  deleteSet: (id: string) => Promise<boolean>;
  addItem: (setId: string, target: AddToSetTarget) => void;
  moveItem: (setId: string, from: number, to: number) => void;
  removeItem: (setId: string, itemId: string) => void;
  setItemTransition: (setId: string, itemId: string, transition: SetItemTransition | null) => void;
  playSet: (setId: string, fromItemId?: string | null) => void;
  endSet: () => void;
  press: () => void;
  selectItem: (itemId: string) => void;
  /** The library's "Add to set": into the open set, or ask which one. */
  requestAddToSet: (target: AddToSetTarget) => void;
  /** Waiting for the user to pick a set for this target (the chooser is open). */
  chooserTarget: AddToSetTarget | null;
  closeChooser: () => void;
}

export const SetPlayerContext = createContext<SetPlayerContextValue | null>(null);

/** The set playlist, or null outside the REPL (tests, other pages). */
export const useSetPlayerContext = (): SetPlayerContextValue | null => useContext(SetPlayerContext);

export interface UseSetPlayerOptions {
  bridge: SetBridge | undefined;
  signedIn: boolean;
  readOnly: boolean;
  /** The library's loaded tracks, keyed by id (the file manager's). */
  tracks: Record<string, LibraryTrack | undefined> | undefined;
}

const EMPTY_TRACKS: Record<string, LibraryTrack | undefined> = {};

/** The toast for each reason a Cue didn't land (`settings:` keys). */
export const CUE_FAILURE_KEYS: Record<CueFailure, string> = {
  'no-library': 'setListCueNoLibrary',
  'no-preview': 'setListCueNoPreview',
  failed: 'setListCueFailed',
};

/** Moves the element at `from` to `to` (both clamped); the same array when nothing moves. */
export function moveInArray<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

export function useSetPlayer({ bridge, signedIn, readOnly, tracks }: UseSetPlayerOptions): SetPlayerContextValue {
  const { t } = useTranslation('settings');
  const enabled = signedIn && !readOnly && Boolean(bridge);
  const { sets, loaded, loadFailed, store } = useSets({
    enabled,
    onSaveFailed: () =>
      toastActions.addToast({ type: 'warning', title: t('setListSaveRetrying') }, 'set-save-retrying'),
  });
  const library = tracks ?? EMPTY_TRACKS;

  // Read by the controller and the key, which outlive renders.
  const tracksRef = useRef(library);
  tracksRef.current = library;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const tRef = useRef(t);
  tRef.current = t;

  const controller = useMemo(
    () =>
      bridge
        ? createSetPlayerController({
            bridge,
            getSet: (id) => store.getState().sets.find((set) => set.id === id) ?? null,
            getTracks: () => tracksRef.current,
            onSkippedMissing: () =>
              toastActions.addToast(
                { type: 'info', title: tRef.current('setListSkippedMissing') },
                'set-skipped-missing',
              ),
            writePosition: (position) => writeSetPosition(position),
            onCueFailed: (reason) =>
              toastActions.addToast(
                { type: 'warning', title: tRef.current(CUE_FAILURE_KEYS[reason]) },
                `set-cue-failed-${reason}`,
              ),
            onGoIgnored: () =>
              toastActions.addToast({ type: 'info', title: tRef.current('setListGoIgnored') }, 'set-go-ignored'),
          })
        : null,
    [bridge, store],
  );
  useEffect(() => () => controller?.dispose(), [controller]);

  const subscribe = useCallback((listener: () => void) => controller?.subscribe(listener) ?? (() => {}), [controller]);
  const getPlayer = useCallback(() => controller?.getState() ?? NO_SET, [controller]);
  const player = useSyncExternalStore(subscribe, getPlayer, getPlayer);

  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [chooserTarget, setChooserTarget] = useState<AddToSetTarget | null>(null);

  // After a reload: reopen the set that was playing, at the same place, with nothing playing.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!controller || !loaded || restoredRef.current) return;
    restoredRef.current = true;
    const position = readSetPosition();
    if (!position) return;
    if (!sets.some((set) => set.id === position.setId)) {
      writeSetPosition(null);
      return;
    }
    controller.restore(position);
    setOpenSetId(position.setId);
  }, [controller, loaded, sets]);

  // The playing set changed (edits here, a conflict adopted, deleted): keep the position by item id.
  useEffect(() => {
    controller?.itemsChanged();
  }, [controller, sets]);

  // Signed out: nothing plays and nothing is open.
  useEffect(() => {
    if (enabled) return;
    if (controller && controller.getState().setId) controller.end();
    setOpenSetId(null);
    setChooserTarget(null);
    restoredRef.current = false;
  }, [enabled, controller]);

  // The next key, installed once; inert unless signed in, not read-only and a set is playing.
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  useEffect(
    () =>
      installSetShortcut(() => void controllerRef.current?.press(), {
        enabled: () => enabledRef.current && Boolean(controllerRef.current?.getState().setId),
      }),
    [],
  );

  const stepTarget = useCallback((target: AddToSetTarget) => {
    const track = tracksRef.current[target.trackId];
    if (target.stepIndex === undefined || !track) return { trackId: target.trackId };
    const step = track.steps?.[target.stepIndex];
    return { trackId: target.trackId, stepIndex: target.stepIndex, stepId: step?.id, stepName: step?.name ?? '' };
  }, []);

  const addItem = useCallback(
    (setId: string, target: AddToSetTarget) => {
      store.updateItems(setId, (items) => [...items, newSetItem(stepTarget(target))]);
    },
    [store, stepTarget],
  );

  return {
    enabled,
    signedIn,
    sets,
    loaded,
    loadFailed,
    tracks: library,
    openSetId,
    setOpenSetId,
    player,
    buttonMode: buttonMode(player),
    endOfSet: isEndOfSet(player),
    createSet: async (name) => {
      const result = await store.create(name, t('setListDefaultBase'));
      if (result.ok) setOpenSetId(result.set.id);
      return result;
    },
    renameSet: (id, name) => store.rename(id, name),
    deleteSet: async (id) => {
      const ok = await store.remove(id);
      if (ok && openSetId === id) setOpenSetId(null);
      return ok;
    },
    addItem,
    moveItem: (setId, from, to) => store.updateItems(setId, (items) => moveInArray(items, from, to)),
    removeItem: (setId, itemId) => store.updateItems(setId, (items) => items.filter((item) => item.id !== itemId)),
    setItemTransition: (setId, itemId, transition) =>
      store.updateItems(setId, (items: SetItem[]) =>
        items.map((item) => (item.id === itemId ? { ...item, transition } : item)),
      ),
    playSet: (setId, fromItemId) => controller?.start(setId, fromItemId),
    endSet: () => controller?.end(),
    press: () => void controller?.press(),
    selectItem: (itemId) => controller?.select(itemId),
    requestAddToSet: (target) => {
      if (!enabled) return;
      if (openSetId && sets.some((set) => set.id === openSetId)) addItem(openSetId, target);
      else setChooserTarget(target);
    },
    chooserTarget,
    closeChooser: () => setChooserTarget(null),
  };
}
