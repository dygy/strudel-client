/** Connects the switch, the socket and the commands to the REPL. Mounted once, in `ReplEditor`. */
import { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { useTranslation } from '@src/i18n';
import { writeSessionCookies } from '@src/lib/authCookies';
import { supabase } from '@src/lib/supabase';
import { listenForTransitionPhase, type TransitionPhase } from '../transitionPhase';
import { createAssistantControlClient, onSessionChange } from './client';
import { createCommandHandler } from './handlers';
import { createTabControls } from './tabControls';
import { assistantControlAvailable, assistantControlOn, setAssistantControl } from './store';

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
    let alive = true;
    const controls = createTabControls({
      live: () => live.current,
      enabled: () => alive && assistantControlOn.get(),
      phase: () => phase,
    });

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
      alive = false;
      subscription.unsubscribe();
      stopWatchingPhase();
      client.stop();
    };
  }, [on, readOnly]);
}
