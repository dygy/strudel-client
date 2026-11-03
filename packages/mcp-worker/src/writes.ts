/**
 * Changing the library (spec 018, functional 2.4 and 2.6), through the site's own routes over the SITE
 * binding, so its naming and path rules stay in one place. Every change names the version it read and
 * is one request, so it's all or nothing.
 *
 * In a multitrack `steps` is the truth, `code` is the active step's text and `activeStep` says which
 * step that is. A write sets all three.
 */
import { type StepLike } from '../../../website/src/lib/multitrack';
import { trackNameClashes } from '../../../website/src/lib/trackRename';
import { fail, newId, ok, refusal, rest, siteCall, ToolFailure, type ToolContext, type ToolResult } from './context';
import {
  allFolders,
  inFolder,
  stepRef,
  trackSteps,
  reconciled,
  readTrackRow,
  webAddress,
  type FolderRow,
  type TrackRow,
} from './library';

export const MAX_CODE_BYTES = 512 * 1024;
export const MAX_STEPS = 200;
/** The app's own limits on a track name (lib/trackValidation.ts). */
const MAX_NAME_LENGTH = 100;
const INVALID_NAME = /[<>:"|?*]/;

const TOO_LARGE = () =>
  new ToolFailure(fail('too_large', 'Code is limited to 512 KB, and nothing was saved.', 'Split it across tracks.'));

function checkSize(code: string) {
  if (new TextEncoder().encode(code).length > MAX_CODE_BYTES) throw TOO_LARGE();
}

function checkTrackName(name: string) {
  const trimmed = name.trim();
  const problem = !trimmed
    ? 'A track name cannot be empty.'
    : trimmed.length > MAX_NAME_LENGTH
      ? 'A track name can have at most 100 characters.'
      : INVALID_NAME.test(trimmed)
        ? 'A track name cannot contain any of < > : " | ? *'
        : null;
  if (problem) throw new ToolFailure(fail('invalid_arguments', problem));
}

const conflict = (currentVersion: string) =>
  new ToolFailure(
    fail(
      'version_conflict',
      'This track changed since you read it',
      'Read it again, and apply your change to what is there now.',
      { currentVersion },
    ),
  );

/** The row, refused early if it has moved on. The route still decides, in one statement. */
async function readForChange(ctx: ToolContext, trackId: string, expectedVersion: string): Promise<TrackRow> {
  const row = await readTrackRow(ctx, trackId);
  if (row.updated_at !== expectedVersion) throw conflict(row.updated_at);
  return row;
}

async function putTrack(
  ctx: ToolContext,
  trackId: string,
  expectedVersion: string,
  updates: Record<string, unknown>,
): Promise<ToolResult> {
  const answer = await siteCall(ctx, 'PUT', '/api/tracks/update', { trackId, updates, expectedVersion });
  if (answer.status !== 200) return refusal('Track', answer);
  const row = answer.data.track as TrackRow;
  return ok({
    id: row.id,
    name: row.name,
    folder: row.folder ?? null,
    version: row.updated_at,
    webAddress: webAddress(ctx, row.name, row.folder ?? null, await allFolders(ctx)),
  });
}

const stepText = (step: StepLike | undefined) => step?.code ?? '';

export async function createTrack(
  ctx: ToolContext,
  args: { name: string; code?: string; folder?: string | null; steps?: Array<{ name: string; code: string }> },
): Promise<ToolResult> {
  checkTrackName(args.name);
  checkSize(args.code ?? '');
  args.steps?.forEach((step) => checkSize(step.code));

  const folders = await allFolders(ctx);
  const folderId = args.folder ?? null;
  const target = folderId ? folders.find((f) => f.id === folderId) : null;
  if (folderId && !target) return fail('not_found', 'Folder not found');
  // Only this folder's tracks: a sibling is all that can clash, and a library can outgrow one response.
  const tracks = await rest<{ id: string; name: string; folder: string | null }>(ctx, 'tracks', {
    select: 'id,name,folder',
    user_id: `eq.${ctx.identity.userId}`,
    and: `(${inFolder(target ?? null)})`,
  });
  const folder = folderId;
  // The same sibling rule as a rename: a name or a URL already used in that folder.
  // Only that folder to resolve against: these are all its tracks, and a large library would cost CPU.
  if (trackNameClashes(args.name, folder, '', tracks, target ? [target] : [])) {
    return fail('name_taken', `A track named "${args.name.trim()}" already exists here.`, 'Use another name.');
  }

  const now = new Date().toISOString();
  const steps = args.steps?.map((step) => ({
    id: newId(),
    name: step.name,
    code: step.code,
    created: now,
    modified: now,
  }));
  const answer = await siteCall(ctx, 'POST', '/api/tracks/create', {
    name: args.name,
    code: steps ? stepText(steps[0]) : (args.code ?? ''),
    folder,
    ...(steps ? { isMultitrack: true, steps, activeStep: 0 } : {}),
  });
  if (answer.status !== 200 && answer.status !== 201) return refusal('Track', answer);
  const row = answer.data.track as { id: string; name: string; folder: string | null; version: string };
  return ok({
    id: row.id,
    name: row.name,
    folder: row.folder ?? null,
    version: row.version,
    webAddress: webAddress(ctx, row.name, row.folder ?? null, folders),
  });
}

export async function updateTrack(
  ctx: ToolContext,
  args: { trackId: string; expectedVersion: string; code?: string; name?: string; step?: number },
): Promise<ToolResult> {
  if (args.code === undefined && args.name === undefined) {
    return fail('invalid_arguments', 'Give code, a name, or both.');
  }
  if (args.name !== undefined) checkTrackName(args.name);
  if (args.code !== undefined) checkSize(args.code);
  if (args.step !== undefined && args.code === undefined) {
    return fail('invalid_arguments', 'A step only goes with code.');
  }

  const updates: Record<string, unknown> = {};
  if (args.name !== undefined) updates.name = args.name;
  if (args.code !== undefined) {
    const row = await readForChange(ctx, args.trackId, args.expectedVersion);
    const track = reconciled(row);
    if (track.isMultitrack && (track.steps ?? []).length > 0) {
      const steps = track.steps!;
      const active = track.activeStep ?? 0;
      const index = args.step ?? active;
      if (index >= steps.length) return fail('invalid_arguments', `This track has ${steps.length} steps.`);
      const edited = steps.map((step, i) =>
        i === index ? { ...step, code: args.code, modified: new Date().toISOString() } : step,
      );
      updates.steps = edited;
      updates.activeStep = active;
      updates.isMultitrack = true;
      updates.code = stepText(edited[active]);
    } else {
      if (args.step !== undefined) return fail('invalid_arguments', 'This track has no steps.');
      updates.code = args.code;
    }
  }
  return putTrack(ctx, args.trackId, args.expectedVersion, updates);
}

export async function moveTrack(
  ctx: ToolContext,
  args: { trackId: string; expectedVersion: string; folder: string | null },
): Promise<ToolResult> {
  return putTrack(ctx, args.trackId, args.expectedVersion, { folder: args.folder });
}

export async function setTrackSteps(
  ctx: ToolContext,
  args: {
    trackId: string;
    expectedVersion: string;
    steps: Array<{ id?: string; name: string; code: string }>;
    activeStep?: number;
    removeSteps?: string[];
  },
): Promise<ToolResult> {
  args.steps.forEach((step) => {
    checkSize(step.code);
    if (!step.name.trim()) throw new ToolFailure(fail('invalid_arguments', 'A step name cannot be empty.'));
  });
  if (args.activeStep !== undefined && args.activeStep >= args.steps.length) {
    return fail('invalid_arguments', `There are ${args.steps.length} steps.`);
  }
  const row = await readForChange(ctx, args.trackId, args.expectedVersion);
  const track = reconciled(row);
  // By position, with `ref` as the name: stored steps can have no id, or share one.
  const stored = trackSteps(track);
  const refs = stored.map((_, index) => stepRef(stored, index));
  const kept = new Set<number>();
  const sources = args.steps.map((step) => {
    const position = step.id === undefined ? -1 : refs.indexOf(step.id);
    // A ref used twice, or one that doesn't exist, makes a new step.
    if (position < 0 || kept.has(position)) return undefined;
    kept.add(position);
    return position;
  });

  // Dropping a step deletes it. That has to be meant, by name.
  const dropped = stored.flatMap((_, index) => (kept.has(index) ? [] : [index]));
  const named = new Set(args.removeSteps ?? []);
  const unnamed = dropped.filter((index) => !named.has(refs[index]));
  if (unnamed.length) {
    return fail(
      'steps_would_be_removed',
      'This would delete steps, and nothing was changed.',
      "Keep each one by giving its ref as the step's id, or ask the user and list the refs in removeSteps.",
      { steps: unnamed.map((index) => ({ ref: refs[index], id: stored[index].id ?? null, name: stored[index].name })) },
    );
  }
  if ([...named].some((ref) => !dropped.some((index) => refs[index] === ref))) {
    return fail('invalid_arguments', 'removeSteps names a step that this keeps, or that does not exist.');
  }
  if (stored.length > 0 && kept.size === 0) {
    return fail(
      'last_step',
      'At least one existing step has to stay, and nothing was changed.',
      'Delete the track instead.',
    );
  }
  if (stored.length === 0 && row.code?.trim() && !args.steps.some((step) => step.code === row.code)) {
    return fail(
      'steps_would_be_removed',
      "This track's code is not in any of these steps, so it would be lost, and nothing was changed.",
      'Include it as a step.',
      { steps: [] },
    );
  }

  const now = new Date().toISOString();
  const steps = args.steps.map((step, index) => {
    const position = sources[index];
    const before = position === undefined ? undefined : stored[position];
    const changed = !before || before.code !== step.code || before.name !== step.name;
    return {
      // A step with no id of its own gets one now.
      id: position !== undefined && refs[position] === before?.id ? before.id : newId(),
      name: step.name.trim(),
      code: step.code,
      created: before?.created ?? now,
      modified: changed ? now : (before?.modified ?? now),
    };
  });
  // The active step follows its text through a reorder, unless told otherwise.
  const followed = sources.indexOf(track.activeStep ?? 0);
  const activeStep = args.activeStep ?? (followed >= 0 ? followed : 0);
  return putTrack(ctx, args.trackId, args.expectedVersion, {
    isMultitrack: true,
    steps,
    activeStep,
    code: steps[activeStep].code,
  });
}

export async function deleteStep(
  ctx: ToolContext,
  args: { trackId: string; expectedVersion: string; stepIndex: number },
): Promise<ToolResult> {
  const row = await readForChange(ctx, args.trackId, args.expectedVersion);
  const track = reconciled(row);
  const steps = trackSteps(track);
  if (steps.length === 0) return fail('invalid_arguments', 'This track has no steps.');
  if (args.stepIndex >= steps.length) return fail('invalid_arguments', `This track has ${steps.length} steps.`);
  if (steps.length === 1) {
    return fail('last_step', 'This is the last step, and nothing was deleted.', 'Delete the track instead.');
  }
  const left = steps.filter((_, i) => i !== args.stepIndex);
  const active = track.activeStep ?? 0;
  // The same rule as the app's own step delete.
  const activeStep = active === args.stepIndex ? 0 : active > args.stepIndex ? active - 1 : active;
  return putTrack(ctx, args.trackId, args.expectedVersion, {
    steps: left,
    activeStep,
    code: stepText(left[activeStep]),
  });
}

export async function deleteTrack(
  ctx: ToolContext,
  args: { trackId: string; expectedVersion: string },
): Promise<ToolResult> {
  const answer = await siteCall(ctx, 'DELETE', '/api/tracks/delete', {
    trackId: args.trackId,
    expectedVersion: args.expectedVersion,
  });
  if (answer.status !== 200) return refusal('Track', answer);
  return ok({ deleted: args.trackId });
}

const folderResult = (row: { id: string; name: string; path: string; parent?: string | null; updated_at?: string }) =>
  ok({ id: row.id, name: row.name, path: row.path, parent: row.parent ?? null, version: row.updated_at ?? null });

export async function createFolder(
  ctx: ToolContext,
  args: { name: string; parent?: string | null },
): Promise<ToolResult> {
  const answer = await siteCall(ctx, 'POST', '/api/folders/create', {
    id: newId(),
    name: args.name,
    parent: args.parent ?? null,
  });
  if (answer.status !== 200 && answer.status !== 201) return refusal('Folder', answer);
  return folderResult(answer.data.data as FolderRow);
}

async function putFolder(
  ctx: ToolContext,
  folderId: string,
  expectedVersion: string,
  updates: Record<string, unknown>,
) {
  const answer = await siteCall(ctx, 'PUT', '/api/folders/update', { folderId, updates, expectedVersion });
  if (answer.status !== 200) return refusal('Folder', answer);
  return folderResult(answer.data.folder as FolderRow);
}

export const renameFolder = (ctx: ToolContext, args: { folderId: string; expectedVersion: string; name: string }) =>
  putFolder(ctx, args.folderId, args.expectedVersion, { name: args.name });

export const moveFolder = (
  ctx: ToolContext,
  args: { folderId: string; expectedVersion: string; parent: string | null },
) => putFolder(ctx, args.folderId, args.expectedVersion, { parent: args.parent });

export async function deleteEmptyFolder(
  ctx: ToolContext,
  args: { folderId: string; expectedVersion: string },
): Promise<ToolResult> {
  const answer = await siteCall(ctx, 'DELETE', '/api/folders/delete', {
    folderId: args.folderId,
    expectedVersion: args.expectedVersion,
  });
  if (answer.status !== 200) return refusal('Folder', answer);
  return ok({ deleted: args.folderId });
}
