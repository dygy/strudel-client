/**
 * The tools: static definitions (plain JSON Schema, with no per-request setup, tech spec 2.1) and who
 * answers each. Failures are results with a stable code and a next step, not protocol errors.
 */
import type { AssistantIdentity } from './auth';
import { HELPER_PUBLISHED } from '../../../website/src/lib/mcpHelper';
import { fail, ok, ToolFailure, unavailable, type ToolContext, type ToolResult } from './context';
import { CHECK_MAX_BYTES, checkCodeTool, listSounds, lookupFunction, searchFunctions } from './knowledge';
import { getTrack, listFolders, searchTracks } from './library';
import { listTabs, openTrack, play, stop, updateCode } from './tabTools';
import { firstProblem, type Schema } from './validate';
import {
  createFolder,
  createTrack,
  deleteEmptyFolder,
  deleteStep,
  deleteTrack,
  moveFolder,
  moveTrack,
  renameFolder,
  setTrackSteps,
  updateTrack,
  MAX_STEPS,
} from './writes';

const id = { type: 'string', minLength: 1, maxLength: 200 } as const;
const version = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  description: 'The version you read. Nothing is written if the item has changed since.',
} as const;
const code = { type: 'string', description: 'Strudel code, at most 512 KB.' } as const;
const name = { type: 'string', minLength: 1, maxLength: 200 } as const;
const cursor = { type: 'string', maxLength: 2000, description: 'nextCursor from the previous page.' } as const;
const offset = { type: 'integer', minimum: 0 } as const;

const input = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const output = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
});

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const stepOut: Schema = output({ ref: str, id: nullableStr, name: str, code: str });
const changedTrack = output({ id: str, name: str, folder: nullableStr, version: str, webAddress: str });
const changedFolder = output({ id: str, name: str, path: str, parent: nullableStr, version: nullableStr });
const deleted = output({ deleted: str });

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: typeof READ;
  run: (ctx: ToolContext, args: never) => Promise<ToolResult> | ToolResult;
}

const tabId = {
  type: 'string',
  maxLength: 64,
  description: 'Which tab, from list_tabs. Needed only when more than one tab allows control.',
} as const;
const tabState = output(
  {
    tabId: str,
    track: { type: ['object', 'null'], properties: { id: str, name: str } },
    playing: { type: 'boolean' },
    cps: { type: ['number', 'null'] },
    transition: { type: 'string', enum: ['idle', 'switching', 'waiting', 'running'] },
    changedElsewhere: { type: 'boolean' },
    ran: { type: 'boolean', description: 'False if the code had not finished running when this answered.' },
    heard: { type: 'boolean', description: 'Whether this changed what is playing.' },
  },
  ['track', 'playing', 'cps', 'transition', 'changedElsewhere'],
);

const ALL: Tool[] = [
  {
    name: 'whoami',
    title: 'Who am I',
    description: 'Shows which Strudel user this connection acts for, and which client it was issued to.',
    inputSchema: input({}),
    outputSchema: {
      ...output({ user_id: str, email: nullableStr, client_id: str }),
      additionalProperties: false,
    },
    annotations: READ,
    run: ({ identity }) => whoami(identity),
  },
  {
    name: 'list_folders',
    title: 'List folders',
    description: 'Lists your folders, 50 to a page.',
    inputSchema: input({ cursor }),
    outputSchema: output({
      folders: {
        type: 'array',
        items: output({ id: str, name: str, path: str, parent: nullableStr, version: str }),
      },
      nextCursor: nullableStr,
    }),
    annotations: READ,
    run: listFolders,
  },
  {
    name: 'search_tracks',
    title: 'Search tracks',
    description:
      "Finds tracks by text in the name or the code, in one folder or all, 50 to a page, most recently changed first. Lists leave the code out: read a track with get_track. In a multitrack, only the active step's code is searched.",
    inputSchema: input({
      query: { type: 'string', maxLength: 200 },
      folder: { type: 'string', maxLength: 200, description: 'A folder id, or "root" for the top level.' },
      cursor,
    }),
    outputSchema: output({
      tracks: {
        type: 'array',
        items: output({
          id: str,
          name: str,
          folder: nullableStr,
          isMultitrack: { type: 'boolean' },
          modified: str,
          version: str,
          webAddress: str,
        }),
      },
      nextCursor: nullableStr,
    }),
    annotations: READ,
    run: searchTracks,
  },
  {
    name: 'get_track',
    title: 'Read a track',
    description:
      'Reads one track: its code, every step of a multitrack in order, its version (which a change must name) and the web address that opens it.',
    inputSchema: input({ trackId: id }, ['trackId']),
    outputSchema: output({
      id: str,
      name: str,
      folder: nullableStr,
      code: str,
      isMultitrack: { type: 'boolean' },
      activeStep: { type: 'integer' },
      steps: { type: 'array', items: stepOut },
      modified: str,
      version: str,
      webAddress: str,
    }),
    annotations: READ,
    run: getTrack,
  },
  {
    name: 'create_track',
    title: 'Create a track',
    description: 'Creates a track, or a multitrack if steps are given. The same naming rules as in the app apply.',
    inputSchema: input(
      {
        name,
        code,
        folder: { type: ['string', 'null'], description: 'A folder id. Leave it out for the top level.' },
        steps: { type: 'array', minItems: 1, maxItems: MAX_STEPS, items: input({ name, code }, ['name', 'code']) },
      },
      ['name'],
    ),
    outputSchema: changedTrack,
    annotations: WRITE,
    run: createTrack,
  },
  {
    name: 'update_track',
    title: 'Change a track',
    description:
      "Changes a track's code, its name, or both, at once or not at all. In a multitrack the code goes into the given step, or the active one.",
    inputSchema: input({ trackId: id, expectedVersion: version, code, name, step: { type: 'integer', minimum: 0 } }, [
      'trackId',
      'expectedVersion',
    ]),
    outputSchema: changedTrack,
    annotations: WRITE,
    run: updateTrack,
  },
  {
    name: 'move_track',
    title: 'Move a track',
    description: 'Moves a track to a folder, or to the top level with null.',
    inputSchema: input({ trackId: id, expectedVersion: version, folder: { type: ['string', 'null'] } }, [
      'trackId',
      'expectedVersion',
      'folder',
    ]),
    outputSchema: changedTrack,
    annotations: WRITE,
    run: moveTrack,
  },
  {
    name: 'set_track_steps',
    title: "Set a multitrack's steps",
    description:
      'Replaces the steps of a track, in the order given: add, change and reorder. Keep each step you are keeping by giving its ref from get_track as its id. Dropping a step deletes it permanently, so it is refused unless removeSteps lists its ref: ask the user first. At least one existing step has to stay. A plain track becomes a multitrack, and its code has to be in one of the steps.',
    inputSchema: input(
      {
        trackId: id,
        expectedVersion: version,
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_STEPS,
          items: input(
            { id: { type: 'string', maxLength: 200, description: 'The ref of the step this keeps.' }, name, code },
            ['name', 'code'],
          ),
        },
        activeStep: { type: 'integer', minimum: 0 },
        removeSteps: {
          type: 'array',
          maxItems: MAX_STEPS,
          items: { type: 'string', maxLength: 200 },
          description: 'The refs of the steps this deletes.',
        },
      },
      ['trackId', 'expectedVersion', 'steps'],
    ),
    outputSchema: changedTrack,
    annotations: DESTROY,
    run: setTrackSteps,
  },
  {
    name: 'create_folder',
    title: 'Create a folder',
    description: 'Creates a folder, inside another one if a parent is given.',
    inputSchema: input({ name, parent: { type: ['string', 'null'] } }, ['name']),
    outputSchema: changedFolder,
    annotations: WRITE,
    run: createFolder,
  },
  {
    name: 'rename_folder',
    title: 'Rename a folder',
    description: 'Renames a folder. Tracks inside it stay inside it.',
    inputSchema: input({ folderId: id, expectedVersion: version, name }, ['folderId', 'expectedVersion', 'name']),
    outputSchema: changedFolder,
    annotations: WRITE,
    run: renameFolder,
  },
  {
    name: 'move_folder',
    title: 'Move a folder',
    description: 'Moves a folder under another one, or to the top level with null.',
    inputSchema: input({ folderId: id, expectedVersion: version, parent: { type: ['string', 'null'] } }, [
      'folderId',
      'expectedVersion',
      'parent',
    ]),
    outputSchema: changedFolder,
    annotations: WRITE,
    run: moveFolder,
  },
  {
    name: 'delete_track',
    title: 'Delete a track',
    description: 'Permanently deletes one track. There is no trash: ask the user first.',
    inputSchema: input({ trackId: id, expectedVersion: version }, ['trackId', 'expectedVersion']),
    outputSchema: deleted,
    annotations: DESTROY,
    run: deleteTrack,
  },
  {
    name: 'delete_step',
    title: 'Delete a multitrack step',
    description: 'Permanently deletes one step of a multitrack. There is no trash: ask the user first.',
    inputSchema: input({ trackId: id, expectedVersion: version, stepIndex: { type: 'integer', minimum: 0 } }, [
      'trackId',
      'expectedVersion',
      'stepIndex',
    ]),
    outputSchema: changedTrack,
    annotations: DESTROY,
    run: deleteStep,
  },
  {
    name: 'delete_empty_folder',
    title: 'Delete an empty folder',
    description: 'Permanently deletes one folder that holds nothing. A folder with anything in it is refused.',
    inputSchema: input({ folderId: id, expectedVersion: version }, ['folderId', 'expectedVersion']),
    outputSchema: deleted,
    annotations: DESTROY,
    run: deleteEmptyFolder,
  },
  {
    name: 'lookup_function',
    title: 'Look up a function',
    description: "A Strudel function's description, parameters and examples, as in the site's reference.",
    inputSchema: input({ name }, ['name']),
    outputSchema: output({
      name: str,
      synonyms: { type: 'array', items: str },
      description: str,
      params: { type: 'array', items: output({ name: str, type: str, description: str }) },
      examples: { type: 'array', items: str },
    }),
    annotations: READ,
    run: (_ctx, args) => lookupFunction(args),
  },
  {
    name: 'search_functions',
    title: 'Search functions',
    description: 'Finds Strudel functions by text in the name or the description, names first, 50 to a page.',
    inputSchema: input({ query: { type: 'string', minLength: 1, maxLength: 200 }, offset }, ['query']),
    outputSchema: output({
      functions: {
        type: 'array',
        items: output({ name: str, synonyms: { type: 'array', items: str }, summary: str }),
      },
      nextOffset: { type: ['integer', 'null'] },
    }),
    annotations: READ,
    run: (_ctx, args) => searchFunctions(args),
  },
  {
    name: 'list_sounds',
    title: 'List sounds',
    description: 'The synths, samples, drum machines, banks and soundfonts the site loads at start, 200 to a page.',
    inputSchema: input({
      kind: { type: 'string', enum: ['synths', 'samples', 'drumMachines', 'banks', 'soundfonts'] },
      query: { type: 'string', maxLength: 200 },
      offset,
    }),
    outputSchema: output({
      sounds: { type: 'array', items: output({ name: str, kind: str }) },
      nextOffset: { type: ['integer', 'null'] },
      note: str,
    }),
    annotations: READ,
    run: (_ctx, args) => listSounds(args),
  },
  {
    name: 'check_code',
    title: 'Check code',
    description: `Finds syntax mistakes, mini-notation mistakes and function names that do not exist, with line and column, without running the code. Up to ${CHECK_MAX_BYTES} bytes here${HELPER_PUBLISHED ? '; larger code needs the local helper' : ''}.`,
    inputSchema: input({ code: { type: 'string' } }, ['code']),
    outputSchema: output({
      ok: { type: 'boolean' },
      errors: { type: 'array', items: { type: 'object' } },
      warnings: { type: 'array', items: { type: 'object' } },
    }),
    annotations: READ,
    run: (_ctx, args) => checkCodeTool(args),
  },
  {
    name: 'list_tabs',
    title: 'List open tabs',
    description:
      'The tabs where the user has switched on Allow assistant control, and what each is doing: track, playing or stopped, tempo. No tab means the switch is off everywhere, and only the user can turn it on.',
    inputSchema: input({}),
    outputSchema: output({ tabs: { type: 'array', items: tabState } }),
    annotations: READ,
    run: listTabs,
  },
  {
    name: 'play',
    title: 'Play in a tab',
    description:
      "Starts the track open in the tab. If another track is playing, this switches to it using the transition selected in the tab. Makes sound on the user's speakers.",
    inputSchema: input({ tabId }),
    outputSchema: tabState,
    annotations: WRITE,
    run: play,
  },
  {
    name: 'stop',
    title: 'Stop a tab',
    description: 'Stops the music in the tab, the same as the user pressing Stop.',
    inputSchema: input({ tabId }),
    outputSchema: tabState,
    annotations: { ...WRITE, idempotentHint: true },
    run: stop,
  },
  {
    name: 'update_code',
    title: 'Update the code in a tab',
    description:
      "Replaces the code of the track open in a tab's editor. Name that track with trackId, from list_tabs: if something else is open now, this is refused with track_changed. Anything the user typed is saved first, Undo brings it back, and if that save fails this is refused. If this is the track being heard, the new code is heard with no gap or fade (heard: true). A stopped tab stays stopped, and if another track is playing it keeps playing (heard: false): only play changes what's heard. A mistake in the code leaves the music playing and comes back as code_error, with the line where known. It reaches the library by autosave, as typing does.",
    inputSchema: input({ code: { type: 'string' }, trackId: id, tabId }, ['code', 'trackId']),
    outputSchema: tabState,
    annotations: WRITE,
    run: updateCode,
  },
  {
    name: 'open_track',
    title: 'Open a track in a tab',
    description:
      "Opens a track in the tab's editor. What's playing carries on until play is called, which then uses the transition selected in the tab. Anything the user typed is saved first.",
    inputSchema: input({ trackId: id, tabId }, ['trackId']),
    outputSchema: tabState,
    annotations: WRITE,
    run: openTrack,
  },
];

const BY_NAME = new Map(ALL.map((tool) => [tool.name, tool]));

/** What `tools/list` answers: the definitions without their functions. */
export const TOOLS = ALL.map(({ run: _run, ...definition }) => definition);

export function whoami(identity: AssistantIdentity) {
  return ok({ user_id: identity.userId, email: identity.email, client_id: identity.clientId });
}

export const isTool = (name: unknown): name is string => typeof name === 'string' && BY_NAME.has(name);

/** Answers one tool call. `outcome` is a stable code, for the log. */
export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = BY_NAME.get(name)!;
  const problem = firstProblem(args, tool.inputSchema);
  if (problem) return fail('invalid_arguments', problem);
  try {
    return await tool.run(ctx, args as never);
  } catch (error: unknown) {
    if (error instanceof ToolFailure) return error.result;
    console.error('strudel-mcp: a tool failed:', name, error instanceof Error ? error.name : 'unknown');
    return unavailable();
  }
}
