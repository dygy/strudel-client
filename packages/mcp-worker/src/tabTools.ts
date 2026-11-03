/** Controlling an open tab (spec 018, functional 2.8): a tool call, through the relay, to the tab. */
import { fail, ok, unavailable, type ErrorCode, type ToolContext, type ToolResult } from './context';
import { MAX_CODE_BYTES } from './writes';

export const COMMAND_TIMEOUT_MS = 5_000;
/** A first play may have sounds to load. */
export const PLAY_TIMEOUT_MS = 10_000;

const ALLOW = 'Ask the user to open Strudel and switch on Allow assistant control in that tab.';

const REFUSALS: Record<string, { code: ErrorCode; message: string; next: string }> = {
  no_tab: { code: 'no_tab', message: 'No tab allows control.', next: ALLOW },
  ambiguous_tab: {
    code: 'ambiguous_tab',
    message: 'More than one tab allows control, and nothing was done.',
    next: 'Choose one, and name it with tabId.',
  },
  transition_in_progress: {
    code: 'transition_in_progress',
    message: 'A transition is in progress.',
    next: 'Try again when it has finished.',
  },
  conflict_open: {
    code: 'conflict_open',
    message: 'This tab is asking the user about a track that changed elsewhere, and nothing was done.',
    next: 'Ask the user to choose in that tab, then try again.',
  },
  save_failed: {
    code: 'save_failed',
    message: "The user's unsaved text could not be saved, so the editor wasn't touched.",
    next: 'Try again in a moment, or tell the user.',
  },
  no_track_open: {
    code: 'no_track_open',
    message: 'This tab has no track open, so there is nowhere to save the code.',
    next: 'Open one with open_track.',
  },
  tab_timeout: {
    code: 'tab_timeout',
    message: 'The tab did not answer in time, so this may or may not have happened.',
    next: 'Check with list_tabs before trying again.',
  },
  track_changed: {
    code: 'track_changed',
    message: 'That track is not the one open in this tab now, and nothing was changed.',
    next: 'Check with list_tabs, then open_track if you still mean that one.',
  },
  control_off: {
    code: 'control_off',
    message: 'The user turned off Allow assistant control in this tab, and this was not done.',
    next: ALLOW,
  },
  ignored: {
    code: 'ignored',
    message: 'A switch to this track is already under way, so this did nothing.',
    next: 'Check with list_tabs when it has finished.',
  },
  open_failed: {
    code: 'open_failed',
    message: 'The tab did not come to hold that track.',
    next: 'Check with list_tabs before trying again.',
  },
  library_unavailable: {
    code: 'library_unavailable',
    message: 'This tab is in a view without the track library, so it can not open a track.',
    next: 'Ask the user to leave zen mode.',
  },
  not_found: { code: 'not_found', message: 'Track not found', next: 'Find its id with search_tracks.' },
  code_error: {
    code: 'code_error',
    message: 'The code has a mistake. What was playing carries on.',
    next: 'Fix it and send it again. check_code can help.',
  },
};

interface Answer {
  ok: boolean;
  code?: string;
  result?: Record<string, unknown>;
  tabs?: unknown[];
  [key: string]: unknown;
}

async function askRelay(
  ctx: ToolContext,
  command: string,
  args: Record<string, unknown>,
  tabId: string | undefined,
  timeoutMs: number,
): Promise<Answer | null> {
  const relay = ctx.env.TAB_RELAY;
  if (!relay) return null;
  try {
    const stub = relay.get(relay.idFromName(ctx.identity.userId));
    const response = await stub.fetch('https://relay/command', {
      method: 'POST',
      headers: {
        'x-command': command,
        'x-timeout-ms': String(timeoutMs),
        ...(tabId ? { 'x-tab-id': tabId } : {}),
      },
      body: JSON.stringify(args),
    });
    return response.ok ? ((await response.json()) as Answer) : null;
  } catch {
    return null;
  }
}

const refused = (answer: Answer): ToolResult => {
  const { code, message, next } = REFUSALS[answer.code ?? ''] ?? {
    code: 'service_unavailable' as const,
    message: 'The tab could not be reached, and nothing was done.',
    next: 'Try again in a moment.',
  };
  const extra: Record<string, unknown> = {};
  if (answer.tabs) extra.tabs = answer.tabs;
  if (answer.error) extra.error = answer.error;
  if (answer.openTrackId) extra.openTrackId = answer.openTrackId;
  return fail(code, message, next, extra);
};

async function run(
  ctx: ToolContext,
  command: string,
  { tabId, ...args }: Record<string, unknown>,
  timeoutMs: number,
): Promise<ToolResult> {
  const answer = await askRelay(ctx, command, args, tabId as string | undefined, timeoutMs);
  if (!answer) return unavailable();
  return answer.ok ? ok(answer.result ?? {}) : refused(answer);
}

export async function listTabs(ctx: ToolContext): Promise<ToolResult> {
  const answer = await askRelay(ctx, 'status', {}, undefined, COMMAND_TIMEOUT_MS);
  if (!answer) return unavailable();
  return ok({ tabs: answer.tabs ?? [] });
}

export const play = (ctx: ToolContext, args: { tabId?: string }) => run(ctx, 'play', args, PLAY_TIMEOUT_MS);
export const stop = (ctx: ToolContext, args: { tabId?: string }) => run(ctx, 'stop', args, COMMAND_TIMEOUT_MS);
export const openTrack = (ctx: ToolContext, args: { trackId: string; tabId?: string }) =>
  run(ctx, 'open_track', args, COMMAND_TIMEOUT_MS);

export function updateCode(
  ctx: ToolContext,
  args: { code: string; trackId: string; tabId?: string },
): Promise<ToolResult> | ToolResult {
  if (new TextEncoder().encode(args.code).length > MAX_CODE_BYTES) {
    return fail('too_large', 'Code is limited to 512 KB, and nothing was changed.');
  }
  return run(ctx, 'update_code', args, COMMAND_TIMEOUT_MS);
}
