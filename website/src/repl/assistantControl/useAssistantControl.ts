/** Connects the switch, the socket and the commands to the REPL. Mounted once, in `ReplEditor`. */
import { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { useTranslation } from '@src/i18n';
import { writeSessionCookies } from '@src/lib/authCookies';
import { supabase } from '@src/lib/supabase';
import { toastActions } from '@src/stores/toastStore';
import { hasOpenTrackConflict } from '../trackConflict';
import { listenForTransitionPhase, type TransitionPhase } from '../transitionPhase';
import { createAssistantControlClient, onSessionChange } from './client';
import { createCommandHandler, type ControlMessage, type TabControls } from './handlers';
import { libraryOpenTrack } from './openTrack';
import { assistantControlAvailable, assistantControlOn, setAssistantControl } from './store';

const WAIT_FOR_NEW_TRACK_MS = 2_000;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the REPL context and file manager are untyped here */
type Loose = any;

/**
 * The browser client is the only refresh owner: `getSession` renews an expired session, and the cookie
 * the Worker reads is mirrored from it. Mirrored here too, because a try can come before the app's own
 * listener has run.
 */
async function currentSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) writeSessionCookies(session);
  return session;
}

export function useAssistantControl(context: Loose, fileManager: Loose, readOnly: boolean) {
  const { t } = useTranslation('settings');
  const on = useStore(assistantControlOn);
  // Both change on every render, and the socket's handler is made once.
  const live = useRef({ context, fileManager, t });
  live.current = { context, fileManager, t };

  // Off the moment this REPL goes away, and never here at all in a read-only view.
  useEffect(() => {
    if (readOnly) return undefined;
    assistantControlAvailable.set(true);
    return () => {
      assistantControlAvailable.set(false);
      setAssistantControl(false);
    };
  }, [readOnly]);

  useEffect(() => {
    if (!on || readOnly) return undefined;

    let phase: TransitionPhase = 'idle';
    const stopWatchingPhase = listenForTransitionPhase((next) => {
      phase = next;
    });
    const editor = () => live.current.context.editorRef?.current;

    const controls: TabControls = {
      isPlaying: () => Boolean(editor()?.repl?.scheduler?.started),
      cps: () => editor()?.repl?.scheduler?.cps ?? null,
      transitionPhase: () => phase,
      conflictOpen: () => hasOpenTrackConflict(),
      currentTrack: () => {
        const { selectedTrack, tracks } = live.current.fileManager ?? {};
        const track = selectedTrack ? tracks?.[selectedTrack] : null;
        return track ? { id: track.id, name: track.name } : null;
      },
      playingAnotherTrack: () => {
        const ids = live.current.context.trackIds?.();
        return Boolean(ids?.editor && ids.editor !== ids.playing);
      },
      hasUnsavedEdits: () => Boolean(live.current.fileManager?.hasUnsavedEdits?.()),
      saveEdits: () => live.current.fileManager.saveCurrentTrack(false),
      replaceCode: (code) => editor().replaceCode(code),
      start: () => editor().evaluate(),
      update: () => live.current.context.handleEvaluate(),
      stop: () => live.current.context.handleTogglePlay(),
      evalError: () => editor()?.repl?.state?.evalError ?? null,
      openTrack: async (trackId) => {
        const fileManager = () => live.current.fileManager;
        let track = fileManager()?.tracks?.[trackId];
        if (!track) {
          // An assistant may just have made it. The list needs a render to catch up after a refresh.
          await fileManager()?.refreshFromSupabase?.();
          const deadline = Date.now() + WAIT_FOR_NEW_TRACK_MS;
          while (!track && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            track = fileManager()?.tracks?.[trackId];
          }
        }
        if (!track) return false;
        await libraryOpenTrack(track);
        return true;
      },
      notify: (message: ControlMessage, values) => {
        const text = live.current.t(`assistantControl.messages.${message}`, values);
        if (message === 'codeError' || message.startsWith('refused')) toastActions.warning(text);
        else toastActions.info(text);
      },
    };

    let userId: string | null = null;
    const client = createAssistantControlClient({
      origin: window.location.origin,
      prepareSession: async () => {
        const session = await currentSession();
        userId = session?.user.id ?? null;
        return session !== null;
      },
      handle: createCommandHandler(controls),
    });
    client.start();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      onSessionChange(event, session, userId, {
        sendToken: client.sendToken,
        turnOff: () => setAssistantControl(false),
      });
    });

    return () => {
      subscription.unsubscribe();
      stopWatchingPhase();
      client.stop();
    };
  }, [on, readOnly]);
}
