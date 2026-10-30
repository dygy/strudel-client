/**
 * Audio and screen recording actions shared by the desktop header's record popover and the
 * compact "More" menu (spec 016), so both call the same context handlers with the same rules.
 */

export interface RecordContext {
  isRecording?: boolean;
  recordingElapsedSeconds?: number;
  handleRecordToggle?: () => void;
  isScreenRecording?: boolean;
  screenRecordingElapsedSeconds?: number;
  handleScreenRecordToggle?: () => void;
  isScreenRecordingSupported?: boolean;
}

/** Audio recording can't start while the screen is being recorded. */
export function isAudioRecordDisabled(context: RecordContext): boolean {
  return !!context.isScreenRecording;
}

/** Screen recording can't start while audio is recorded, or where the browser can't do it. */
export function isScreenRecordDisabled(context: RecordContext): boolean {
  return !!context.isRecording || !context.isScreenRecordingSupported;
}

/**
 * Start or stop audio recording. `onClose` (the menu) runs when a recording starts, so the
 * menu gets out of the way; stopping leaves it open, as the desktop popover always did.
 */
export function toggleAudioRecording(context: RecordContext, onClose: () => void): void {
  context.handleRecordToggle?.();
  if (!context.isRecording) onClose();
}

/** Start or stop screen recording; same menu rule as audio. */
export function toggleScreenRecording(context: RecordContext, onClose: () => void): void {
  context.handleScreenRecordToggle?.();
  if (!context.isScreenRecording) onClose();
}

export function isAnyRecording(context: RecordContext): boolean {
  return !!(context.isRecording || context.isScreenRecording);
}

/** Elapsed seconds of whichever recording runs (audio first). */
export function activeRecordingSeconds(context: RecordContext): number {
  return context.isRecording ? (context.recordingElapsedSeconds ?? 0) : (context.screenRecordingElapsedSeconds ?? 0);
}
