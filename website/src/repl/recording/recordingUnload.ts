/**
 * What a recording does when the page is asked to go (spec 030 review #1; recorders spec 013/014 Req 6.3).
 *
 * The choice, and why:
 * - `beforeunload` only ASKS. While recording it cancels the event, so the browser shows its
 *   "Leave site?" question, and it touches nothing else. Several listeners can cancel the same event
 *   (the performance close guard does while music plays), and the user often answers "Stay": the
 *   recording must then go on exactly as it was. The old handlers stopped the engine and downloaded
 *   here, so "Stay" cut the recording and left a fragment on disk.
 * - `pagehide` SAVES, because it fires only when the page really goes: a close, a reload or a navigation
 *   the user confirmed, or the page entering the back/forward cache (`event.persisted`). The save is
 *   synchronous and does not stop the engine: it downloads the chunks collected so far (the
 *   MediaRecorders run with a 1 s timeslice, so at most about a second is missing), as the recorder's raw
 *   WebM. If the page comes back from the back/forward cache, the recording simply goes on.
 *
 * Reliability: nothing asynchronous survives a page that is going away. The old save awaited
 * MediaRecorder.stop() (and, for audio, decodeAudioData for a WAV), so on a real leave it only completed
 * while a prompt kept the page alive, i.e. exactly when the user chose "Stay". A download started
 * synchronously from `pagehide` is the most a page can do, but browsers may still drop a download that
 * starts during unload (Chrome does not guarantee it), so it is best-effort. The real protection is the
 * question: a recording never ends on a close the user did not confirm.
 */

/** The page-leave handlers of one recorder. */
export interface RecordingUnloadOptions {
  /** Whether a recording is running now. */
  isRecording: () => boolean;
  /** The recording so far, assembled synchronously (null or empty: nothing to save). */
  snapshot: () => Blob | null;
  /** The file name for the saved recording. */
  filename: () => string;
  /** The window to listen on (default `window`). */
  win?: Window;
  /** How to download a blob (default: a temporary `<a download>` click). */
  download?: (blob: Blob, filename: string) => void;
}

/** Download `blob` as `filename` through a temporary `<a download>` element. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Install a recorder's page-leave handlers (see the module comment): `beforeunload` asks while recording,
 * `pagehide` saves the recording so far while recording. Returns the uninstall function.
 */
export function installRecordingUnload(options: RecordingUnloadOptions): () => void {
  const win = options.win ?? window;
  const download = options.download ?? downloadBlob;
  const recording = () => {
    try {
      return options.isRecording();
    } catch {
      return false;
    }
  };

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!recording()) return;
    event.preventDefault();
    // The legacy requirement (Chrome < 119, Safari): a non-undefined returnValue shows the prompt.
    event.returnValue = '';
  };

  const onPageHide = () => {
    if (!recording()) return;
    try {
      const blob = options.snapshot();
      if (blob && blob.size > 0) download(blob, options.filename());
    } catch (error: unknown) {
      console.warn('[recording] could not save the recording on page leave', error);
    }
  };

  win.addEventListener('beforeunload', onBeforeUnload);
  win.addEventListener('pagehide', onPageHide);
  return () => {
    win.removeEventListener('beforeunload', onBeforeUnload);
    win.removeEventListener('pagehide', onPageHide);
  };
}
