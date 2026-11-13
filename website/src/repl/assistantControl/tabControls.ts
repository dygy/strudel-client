/** What a command does in this REPL: the buttons' own functions, and the file manager's save and open. */
import { toastActions } from '@src/stores/toastStore';
import { hasOpenTrackConflict } from '../trackConflict';
import type { TransitionPhase } from '../transitionPhase';
import type { ControlMessage, TabControls } from './handlers';
import { libraryCanOpen, libraryOpenTrack } from './openTrack';

/** How long a track has to show up, and how long the tab has to come to hold it. */
const WAIT_FOR_NEW_TRACK_MS = 2_000;
const WAIT_FOR_OPEN_MS = 2_000;
const POLL_MS = 25;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the REPL context and file manager are untyped here */
type Loose = any;

export interface TabControlSources {
  /** The latest context, file manager and translator: they change on every render. */
  live: () => { context: Loose; fileManager: Loose; t: (key: string, values?: Loose) => string };
  enabled: () => boolean;
  /** The phase the transition events have said. */
  phase: () => TransitionPhase;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createTabControls({ live, enabled, phase }: TabControlSources): TabControls {
  const editor = () => live().context.editorRef?.current;
  const editorTrack = () => live().context.trackIds?.().editor ?? null;

  const holds = (trackId: string) => {
    const { selectedTrack } = live().fileManager ?? {};
    return selectedTrack === trackId && editorTrack() === trackId;
  };

  return {
    enabled,
    isPlaying: () => Boolean(editor()?.repl?.scheduler?.started),
    cps: () => editor()?.repl?.scheduler?.cps ?? null,
    // The events only cover a transition's last part. This covers a switch from Update on, every type
    // of it, and one that began before the switch was turned on.
    transitionPhase: () => {
      const said = phase();
      if (said !== 'idle') return said;
      return live().context.isSwitching?.() ? 'switching' : 'idle';
    },
    conflictOpen: () => hasOpenTrackConflict(),
    currentTrack: () => {
      const { selectedTrack, tracks } = live().fileManager ?? {};
      const track = selectedTrack ? tracks?.[selectedTrack] : null;
      return track ? { id: track.id, name: track.name } : null;
    },
    editorTrack,
    playingAnotherTrack: () => {
      const ids = live().context.trackIds?.();
      return Boolean(ids?.editor && ids.editor !== ids.playing);
    },
    hasUnsavedEdits: () => Boolean(live().fileManager?.hasUnsavedEdits?.()),
    // Names the track, and reads the text in the same step as checking that the editor holds that track.
    saveEdits: async (trackId) => {
      const held = editorTrack();
      if (held !== null && held !== trackId) return false;
      return live().fileManager.saveSpecificTrack(trackId, false);
    },
    replaceCode: (code) => editor().replaceCode(code),
    start: () => editor().evaluate(),
    // The same Update as a person's. runUpdate resolves once its own evaluate is done on every path
    // (since spec 022 the instant Off switch waits for it too); evaluationsSettled also covers an
    // evaluate started elsewhere at the same moment (Ctrl+Enter), so the answer stays honest. The
    // caller limits how long.
    update: async () => {
      const outcome = await live().context.runUpdate();
      if (outcome !== 'ignored') await live().context.evaluationsSettled?.();
      return outcome;
    },
    isActiveCode: (code) => {
      const active = editor()?.repl?.state?.activeCode;
      return active === undefined || active === code;
    },
    stop: () => live().context.handleTogglePlay(),
    evalError: () => editor()?.repl?.state?.evalError ?? null,
    openTrack: async (trackId) => {
      if (!libraryCanOpen()) return 'library_unavailable';
      const fileManager = () => live().fileManager;
      let track = fileManager()?.tracks?.[trackId];
      if (!track) {
        // An assistant may just have made it. The list needs a render to catch up after a refresh.
        await fileManager()?.refreshFromSupabase?.();
        const deadline = Date.now() + WAIT_FOR_NEW_TRACK_MS;
        while (!track && Date.now() < deadline) {
          await wait(POLL_MS);
          track = fileManager()?.tracks?.[trackId];
        }
      }
      if (!track) return 'not_found';
      await libraryOpenTrack(track);
      const deadline = Date.now() + WAIT_FOR_OPEN_MS;
      while (!holds(trackId) && Date.now() < deadline) await wait(POLL_MS);
      return holds(trackId) ? 'opened' : 'open_failed';
    },
    notify: (message: ControlMessage, values) => {
      const text = live().t(`assistantControl.messages.${message}`, values);
      if (message === 'codeError' || message.startsWith('refused')) toastActions.warning(text);
      else toastActions.info(text);
    },
  };
}
