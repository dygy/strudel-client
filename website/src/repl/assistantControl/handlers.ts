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
  | 'refusedNoTrack';

export interface TabControls {
  isPlaying(): boolean;
  cps(): number | null;
  transitionPhase(): TransitionPhase;
  conflictOpen(): boolean;
  /** The track open in the editor. */
  currentTrack(): { id: string; name: string } | null;
  /** Something's playing, and it isn't what's in the editor. */
  playingAnotherTrack(): boolean;
  hasUnsavedEdits(): boolean;
  /** The file manager's save, the one Cmd+S uses. */
  saveEdits(): Promise<unknown>;
  /** Replaces the editor's text as one Undo step. */
  replaceCode(code: string): void;
  /** What Play does when stopped. Resolves when the evaluate has finished. */
  start(): Promise<unknown>;
  /** What Update does: a hot-swap, or a switch if the editor holds another track. */
  update(): Promise<unknown>;
  /** What Stop does. */
  stop(): void;
  /** The mistake the last evaluate left, if it left one. */
  evalError(): unknown;
  /** Opens a track as the library does. False if there's no such track. */
  openTrack(trackId: string): Promise<boolean>;
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

/**
 * Saves what's been typed. True when none of it is left only in the editor. A save already on its way
 * makes this one return without saving, so it asks again before giving up.
 */
async function typingIsSafe(controls: TabControls): Promise<boolean> {
  for (let attempt = 0; attempt < SAVE_TRIES; attempt++) {
    if (!controls.hasUnsavedEdits()) return true;
    if (attempt > 0) await wait(SAVE_RETRY_MS);
    try {
      await controls.saveEdits();
    } catch (error: unknown) {
      console.error('[assistant control] the save before a change failed:', error);
    }
    // Checked last, with nothing to wait for between this and the caller replacing the text.
    if (!controls.hasUnsavedEdits()) return true;
  }
  return false;
}

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

  /** What's refused for a track being switched, or one the user has to decide about. */
  const blocked = (): RelayAnswer | null => {
    if (controls.transitionPhase() !== 'idle') {
      controls.notify('refusedTransition');
      return refusal('transition_in_progress');
    }
    if (controls.conflictOpen()) {
      controls.notify('refusedConflict');
      return refusal('conflict_open');
    }
    return null;
  };

  const protectTyping = async (): Promise<RelayAnswer | null> => {
    if (await typingIsSafe(controls)) return null;
    // The save itself may be what found out that the track changed elsewhere.
    if (controls.conflictOpen()) {
      controls.notify('refusedConflict');
      return refusal('conflict_open');
    }
    controls.notify('refusedSave');
    return refusal('save_failed');
  };

  /**
   * Runs an evaluate and waits for what it says, or until a switch is under way (by then the new code
   * has evaluated, and the transition can take far longer than the assistant should wait).
   */
  const evaluate = async (run: () => Promise<unknown>, waitMs: number): Promise<RelayAnswer | null> => {
    const target = controls.events ?? window;
    let switchError: unknown = null;
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: unknown; evaluateFailed?: boolean }>).detail;
      if (detail?.evaluateFailed) switchError = { message: detail.error };
    };
    target.addEventListener(TRANSITION_EVENTS.error, onError);
    let stopListening = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = run().then(() => 'finished' as const);
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
      if (!error) return null;
      controls.notify('codeError');
      return refusal('code_error', { error: { message: errorMessage(error), line: errorLine(error) } });
    } finally {
      stopListening();
      clearTimeout(timer);
      target.removeEventListener(TRANSITION_EVENTS.error, onError);
    }
  };

  const commands: Record<string, (args: Record<string, unknown>) => Promise<RelayAnswer> | RelayAnswer> = {
    status: () => ({ ok: true, result: status() }),

    stop: () => {
      if (controls.isPlaying()) controls.stop();
      controls.notify('stopped');
      return { ok: true, result: status() };
    },

    play: async () => {
      const stopped = blocked();
      if (stopped) return stopped;
      if (controls.isPlaying() && !controls.playingAnotherTrack()) {
        controls.notify('alreadyPlaying');
        return { ok: true, result: status() };
      }
      // Stopped: Play. Another track playing: Update, which is what uses the selected transition.
      const run = controls.isPlaying() ? controls.update : controls.start;
      const failed = await evaluate(() => run(), WAIT_FOR_EVALUATE_MS.play);
      if (failed) return failed;
      controls.notify('played');
      return { ok: true, result: status() };
    },

    update_code: async ({ code }) => {
      const stopped = blocked();
      if (stopped) return stopped;
      if (!controls.currentTrack()) {
        controls.notify('refusedNoTrack');
        return refusal('no_track_open');
      }
      const unsafe = await protectTyping();
      if (unsafe) return unsafe;
      // Nothing to wait for from here to the replacement, so nothing typed can slip in between.
      controls.replaceCode(String(code));
      // Stopped stays stopped: an update is never why sound starts.
      if (controls.isPlaying()) {
        const failed = await evaluate(() => controls.update(), WAIT_FOR_EVALUATE_MS.update_code);
        if (failed) return failed;
      }
      controls.notify('updated');
      return { ok: true, result: status() };
    },

    open_track: async ({ trackId }) => {
      const stopped = blocked();
      if (stopped) return stopped;
      const unsafe = await protectTyping();
      if (unsafe) return unsafe;
      if (!(await controls.openTrack(String(trackId)))) return refusal('not_found');
      const track = controls.currentTrack();
      controls.notify('opened', { name: track?.name ?? '' });
      return { ok: true, result: status() };
    },
  };

  // One at a time: two commands saving and replacing at once could undo each other's checks.
  let queue: Promise<unknown> = Promise.resolve();
  return (command, args) => {
    const handler = commands[command];
    if (!handler) return Promise.resolve(refusal('unknown_command'));
    if (command === 'status') return Promise.resolve(handler(args));
    const run = queue.then(() => handler(args));
    queue = run.catch(() => {});
    return run;
  };
}
