/**
 * What a multitrack is on the server: `steps` holds the text of every step, `active_step` says which
 * one is open, and `code` is a copy of that step's text. Saves write all three together.
 *
 * Rows written before that rule can disagree, so loading has to cope (reconcileMultitrack).
 */

import { trackNameToSlug } from './slugUtils';

export interface StepLike {
  id?: string;
  name?: string;
  code?: string;
  created?: string;
  modified?: string;
}

export interface MultitrackFields {
  code: string;
  isMultitrack?: boolean;
  steps?: StepLike[] | null;
  activeStep?: number | null;
}

export function hasSteps(track: MultitrackFields): boolean {
  return Boolean(track.isMultitrack && track.steps && track.steps.length > 0);
}

/** A valid index into the steps, whatever the row says. */
export function activeStepIndex(track: MultitrackFields): number {
  const count = track.steps?.length ?? 0;
  const index = track.activeStep ?? 0;
  return Number.isInteger(index) && index >= 0 && index < count ? index : 0;
}

/** The steps with this step's text replaced. A step whose text didn't change keeps its timestamp. */
export function stepsWithText(steps: StepLike[], index: number, text: string, now = new Date().toISOString()) {
  return steps.map((step, i) => (i === index && step.code !== text ? { ...step, code: text, modified: now } : step));
}

/**
 * The fields to send when `text` is what the user has in the editor. A plain track sends its code;
 * a multitrack sends everything, so the three fields can't drift apart.
 */
export function saveFieldsFor(track: MultitrackFields, text: string, stepIndex = activeStepIndex(track)) {
  if (!hasSteps(track)) return { code: text };
  return {
    code: text,
    steps: stepsWithText(track.steps!, stepIndex, text),
    activeStep: stepIndex,
    isMultitrack: true,
  };
}

/** The same, for a new row (create, import): `code` follows the active step whatever the file said. */
export function consistentNewTrack<T extends MultitrackFields>(track: T): T {
  if (!hasSteps(track)) return track;
  const activeStep = activeStepIndex(track);
  return { ...track, activeStep, code: track.steps![activeStep].code ?? '' };
}

/** Its id stays the same on every load, but it's never one a step already has (it can happen twice). */
function recoveredStep(trackId: string | undefined, steps: StepLike[], name: string, code: string): StepLike {
  const base = `${trackId ?? 'track'}-recovered`;
  const taken = steps.filter((step) => step.id?.startsWith(base)).length;
  return { id: taken ? `${base}-${taken + 1}` : base, name, code };
}

/**
 * Local state for a row as it comes from the server, writing nothing. `steps` wins, so the editor
 * shows the active step. Older saves put text in `code` and never in `steps`; when `code` matches no
 * step it is the only copy of those edits, so it becomes a step of its own, which the next real save
 * then stores. Without a save the row stays as it is, and this gives the same result on every load.
 */
export function reconcileMultitrack<T extends MultitrackFields & { id?: string }>(
  track: T,
  recoveredStepName: string,
): T {
  if (!hasSteps(track)) return track;
  const steps = track.steps!;
  const activeStep = activeStepIndex(track);
  const stepText = steps[activeStep].code ?? '';
  const isOrphan = track.code !== stepText && Boolean(track.code?.trim()) && !steps.some((s) => s.code === track.code);
  return {
    ...track,
    activeStep,
    code: stepText,
    steps: isOrphan ? [...steps, recoveredStep(track.id, steps, recoveredStepName, track.code)] : steps,
  };
}

/** The track as a page load opens it: reconciled, on the step the URL names if it has one. */
export function openingTrack<T extends MultitrackFields & { id?: string }>(
  track: T,
  stepSlug: string | null | undefined,
  recoveredStepName: string,
): T {
  const local = reconcileMultitrack(track, recoveredStepName);
  if (!stepSlug || !hasSteps(local)) return local;
  const wanted = trackNameToSlug(stepSlug);
  const index = local.steps!.findIndex((step) => trackNameToSlug(step.name ?? '') === wanted);
  return index < 0 ? local : { ...local, activeStep: index, code: local.steps![index].code ?? '' };
}
