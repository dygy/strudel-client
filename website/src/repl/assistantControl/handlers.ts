/**
 * What a tab does with an assistant's command. Every step is something the user's own buttons do: no
 * audio is touched here, so hot-swap and the transitions behave as they do for the user.
 */
import { listenForTransitionPhase, TRANSITION_EVENTS, type TransitionPhase } from '../transitionPhase';
import type { CommandHandler, RelayAnswer } from './client';

export type ControlMessage =
  | 'played'
  | 'alreadyPlaying'
  | 'stopped'
  | 'updated'
  | 'opened'
  | 'codeError'
  | 'refusedTransition'
  | 'refusedConflict'
  | 'refusedSave'
  | 'refusedNoTrack'
  | 'refusedTrackChanged'
  | 'refusedOpen'
  | 'refusedOpenFailed'
  | 'updatedNotHeard';

export type OpenTrackResult = 'opened' | 'not_found' | 'library_unavailable' | 'open_failed';

export interface TabControls {
  /** The switch is on, and this is still the same turn of it. */
  enabled(): boolean;
  isPlaying(): boolean;
  cps(): number | null;
  /** `switching`: something is changing what's heard, before or without a transition's own phases. */
  transitionPhase(): TransitionPhase | 'switching';
  conflictOpen(): boolean;
  /** The track open in the editor. */
  currentTrack(): { id: string; name: string } | null;
  /** The track the editor holds this moment, if known. */
  editorTrack(): string | null;
  /** Something's playing, and it isn't what's in the editor. */
  playingAnotherTrack(): boolean;
  hasUnsavedEdits(): boolean;
  /** The file manager's save, of this track only: it does nothing if that's not what the editor holds. */
  saveEdits(trackId: string): Promise<unknown>;
  /** Replaces the editor's text as one Undo step. */
  replaceCode(code: string): void;
  /** What Play does when stopped. Resolves when the evaluate has finished. */
  start(): Promise<unknown>;
  /** What Update does: a hot-swap, or a switch if the editor holds another track. Says which, or `ignored`. */
  update(): Promise<unknown>;
  /** This is the code the repl last started. False if someone else's has landed since. */
  isActiveCode(code: string): boolean;
  /** What Stop does. */
  stop(): void;
  /** The mistake the last evaluate left, if it left one. */
  evalError(): unknown;
  /** Opens a track as the library does, and says only once the tab really holds it. */
  openTrack(trackId: string): Promise<OpenTrackResult>;
  notify(message: ControlMessage, values?: Record<string, string | number>): void;
  /** For tests. */
  events?: EventTarget;
}

const SAVE_TRIES = 3;
const SAVE_RETRY_MS = 300;
/** Less than the relay's timeouts, so a long load is an answer rather than a timeout. */
const WAIT_FOR_EVALUATE_MS = { update_code: 4_000, play: 9_000 };

const refusal = (code: string, extra: Record<string, unknown> = {}): RelayAnswer => ({ ok: false, code, ...extra });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where a mistake is, from what each stage of evaluating says about it. Null if none of them does. */
export function errorLine(error: unknown): number | null {
  const { loc, message } = (error ?? {}) as { loc?: { line?: unknown }; message?: unknown };
  if (typeof loc?.line === 'number') return loc.line;
  const text = typeof message === 'string' ? message : String(error);
  const match = /line (\d+)/.exec(text) ?? /\((\d+):\d+\)/.exec(text);
  return match ? Number(match[1]) : null;
}

const errorMessage = (error: unknown) =>
  (typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : String(error)
  ).slice(0, 500);

export function createCommandHandler(controls: TabControls): CommandHandler {
  const status = () => {
    const track = controls.currentTrack();
    return {
      track: track ? { id: track.id, name: track.name } : null,
      playing: controls.isPlaying(),
      cps: controls.cps(),
      transition: controls.transitionPhase(),
      changedElsewhere: controls.conflictOpen(),
    };
  };

  /**
   * Everything that can make a command wrong, asked again after every wait. Anything may have happened
   * during one: the user pressed something, the switch went off, the track changed.
   * @param trackId the track this command was meant for, if it was for one
   */
  const refused = (trackId?: string): RelayAnswer | null => {
    if (!controls.enabled()) return refusal('control_off');
    if (controls.transitionPhase() !== 'idle') {
      controls.notify('refusedTransition');
      return refusal('transition_in_progress');
    }
    if (controls.conflictOpen()) {
      controls.notify('refusedConflict');
      return refusal('conflict_open');
    }
    if (trackId !== undefined) {
      const open = controls.currentTrack();
      if (!open) {
        controls.notify('refusedNoTrack');
        return refusal('no_track_open');
      }
      // The editor changes a moment before React says so, and it's the editor's text this would replace.
      const held = controls.editorTrack();
      if (open.id !== trackId || (held !== null && held !== trackId)) {
        controls.notify('refusedTrackChanged');
        return refusal('track_changed', { openTrackId: held ?? open.id });
      }
    }
    return null;
  };

  /**
   * Saves what was typed in this track. A save already on its way makes this one return without saving,
   * so it asks again before giving up. Null when none of it is left only in the editor.
   */
  const protectTyping = async (trackId: string | undefined): Promise<RelayAnswer | null> => {
    for (let attempt = 0; attempt < SAVE_TRIES; attempt++) {
      if (!controls.hasUnsavedEdits()) return null;
      if (trackId === undefined) break;
      if (attempt > 0) await wait(SAVE_RETRY_MS);
      const early = refused(trackId);
      if (early) return early;
      try {
        await controls.saveEdits(trackId);
      } catch (error: unknown) {
        console.error('[assistant control] the save before a change failed:', error);
      }
      const after = refused(trackId);
      if (after) return after;
    }
    if (!controls.hasUnsavedEdits()) return null;
    controls.notify('refusedSave');
    return refusal('save_failed');
  };

  /**
   * Runs an evaluate and waits for what it says, or until a switch is under way (by then the new code
   * has evaluated, and the transition can take far longer than the assistant should wait). `ran` is
   * false if it was still loading when the wait ran out, so that nobody is told it ran when it may not.
   */
  const evaluate = async (
    run: () => Promise<unknown>,
    waitMs: number,
  ): Promise<{ failed: RelayAnswer | null; ran: boolean }> => {
    const target = controls.events ?? window;
    let switchError: unknown = null;
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: unknown; evaluateFailed?: boolean }>).detail;
      if (detail?.evaluateFailed) switchError = { message: detail.error };
    };
    target.addEventListener(TRANSITION_EVENTS.error, onError);
    let stopListening = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let answer: unknown;
    const finished = run().then((value) => {
      answer = value;
      return 'finished' as const;
    });
    try {
      const outcome = await Promise.race([
        finished,
        new Promise<'switching'>((resolve) => {
          stopListening = listenForTransitionPhase((phase) => {
            if (phase !== 'idle') resolve('switching');
          }, target);
        }),
        new Promise<'waited'>((resolve) => {
          timer = setTimeout(() => resolve('waited'), waitMs);
        }),
      ]);
      // The evaluate's own error says where the mistake is. The transition's only says that there is one.
      const error = switchError || outcome === 'finished' ? (controls.evalError() ?? switchError) : null;
      if (error) {
        controls.notify('codeError');
        return {
          failed: refusal('code_error', { error: { message: errorMessage(error), line: errorLine(error) } }),
          ran: false,
        };
      }
      // Update found the same switch already under way, and did nothing.
      if (answer === 'ignored') return { failed: refusal('ignored'), ran: false };
      return { failed: null, ran: outcome !== 'waited' };
    } finally {
      stopListening();
      clearTimeout(timer);
      target.removeEventListener(TRANSITION_EVENTS.error, onError);
    }
  };

  const commands: Record<string, (args: Record<string, unknown>) => Promise<RelayAnswer> | RelayAnswer> = {
    status: () => ({ ok: true, result: status() }),

    stop: () => {
      if (!controls.enabled()) return refusal('control_off');
      if (controls.isPlaying()) controls.stop();
      controls.notify('stopped');
      return { ok: true, result: status() };
    },

    play: async () => {
      const stopped = refused();
      if (stopped) return stopped;
      if (controls.isPlaying() && !controls.playingAnotherTrack()) {
        controls.notify('alreadyPlaying');
        return { ok: true, result: { ...status(), ran: false } };
      }
      // Stopped: Play. Another track playing: Update, which is what uses the selected transition.
      const run = controls.isPlaying() ? controls.update : controls.start;
      const { failed, ran } = await evaluate(() => run(), WAIT_FOR_EVALUATE_MS.play);
      if (failed) return failed;
      controls.notify('played');
      return { ok: true, result: { ...status(), ran } };
    },

    update_code: async ({ code, trackId }) => {
      const track = String(trackId);
      const stopped = refused(track);
      if (stopped) return stopped;
      const unsafe = await protectTyping(track);
      if (unsafe) return unsafe;
      const late = refused(track);
      if (late) return late;
      // Nothing to wait for from here to the replacement, so nothing typed can slip in between.
      if (controls.hasUnsavedEdits()) {
        controls.notify('refusedSave');
        return refusal('save_failed');
      }
      controls.replaceCode(String(code));
      // Only `play` starts sound or changes which track is heard. This changes text, and if this is the
      // track being heard, what's heard.
      if (!controls.isPlaying() || controls.playingAnotherTrack()) {
        const elsewhere = controls.isPlaying();
        controls.notify(elsewhere ? 'updatedNotHeard' : 'updated');
        return { ok: true, result: { ...status(), ran: false, heard: false } };
      }
      const { failed, ran } = await evaluate(() => controls.update(), WAIT_FOR_EVALUATE_MS.update_code);
      if (failed) return failed;
      // A person may have pressed something while this ran, and theirs is what's heard.
      const heard = ran && controls.isActiveCode(String(code));
      controls.notify(ran && !heard ? 'updatedNotHeard' : 'updated');
      return { ok: true, result: { ...status(), ran, heard } };
    },

    open_track: async ({ trackId }) => {
      const wanted = String(trackId);
      const stopped = refused();
      if (stopped) return stopped;
      const unsafe = await protectTyping(controls.currentTrack()?.id);
      if (unsafe) return unsafe;
      const late = refused();
      if (late) return late;
      const opened = await controls.openTrack(wanted);
      if (!controls.enabled()) return refusal('control_off');
      if (opened === 'not_found') return refusal('not_found');
      if (opened !== 'opened') {
        controls.notify(opened === 'open_failed' ? 'refusedOpenFailed' : 'refusedOpen');
        return refusal(opened);
      }
      controls.notify('opened', { name: controls.currentTrack()?.name ?? '' });
      return { ok: true, result: status() };
    },
  };

  // One at a time: two commands saving and replacing at once could undo each other's checks.
  let queue: Promise<unknown> = Promise.resolve();
  return (command, args) => {
    const handler = commands[command];
    if (!handler) return Promise.resolve(refusal('unknown_command'));
    if (command === 'status') return Promise.resolve(handler(args));
    // The switch may have gone off while this waited its turn.
    const run = queue.then(() => (controls.enabled() ? handler(args) : refusal('control_off')));
    queue = run.catch(() => {});
    return run;
  };
}
