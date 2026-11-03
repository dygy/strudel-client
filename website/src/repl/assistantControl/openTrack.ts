/**
 * The library's own "open this track" (the save, the URL, the title, the load), which lives with the
 * file manager's operations. They publish it here while mounted, which isn't in zen mode.
 */
type SelectTrack = (track: { id: string }) => Promise<void> | void;

let selectTrack: SelectTrack | null = null;

export function registerTrackSelect(select: SelectTrack | null) {
  selectTrack = select;
}

export const libraryCanOpen = () => selectTrack !== null;

export const libraryOpenTrack = (track: { id: string }) => selectTrack?.(track);
