/**
 * The library's own "open this track" (the save, the URL, the title, the load), which lives with the
 * file manager's operations. They publish it here while mounted, which isn't in zen mode.
 */
type SelectTrack = (track: { id: string }) => Promise<void> | void;
/** Open one step of a multitrack, as a click on the step does (spec 022). */
type SelectStep = (target: { trackId: string; stepIndex: number }) => Promise<void> | void;

let selectTrack: SelectTrack | null = null;
let selectStep: SelectStep | null = null;

export function registerTrackSelect(select: SelectTrack | null) {
  selectTrack = select;
}

/** Published by the file manager next to registerTrackSelect; never in the read-only admin view. */
export function registerStepSelect(select: SelectStep | null) {
  selectStep = select;
}

export const libraryCanOpen = () => selectTrack !== null;

export const libraryOpenTrack = (track: { id: string }) => selectTrack?.(track);

/** Open step `stepIndex` of multitrack `trackId` (saving the current track first). */
export const libraryOpenStep = (target: { trackId: string; stepIndex: number }) => selectStep?.(target);
