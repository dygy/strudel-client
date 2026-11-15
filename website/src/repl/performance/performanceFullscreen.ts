/**
 * The browser's full screen for the performance view (spec 030 §2.1, tech §2.1).
 *
 * - Opening the view asks for full screen. A refusal or a missing API (iOS Safari, an iframe, a
 *   denied permission) is swallowed: the view still fills the window as a layout.
 * - Closing the view leaves full screen only if the view entered it.
 * - Leaving full screen (Esc, the browser's own control) after the view entered it closes the view.
 *
 * The request runs inside the store listener, which nanostores calls synchronously from
 * openPerformance(), so it is still inside the click or keydown that opened the view (browsers only
 * grant full screen during a user gesture). Installed once from ReplEditor.
 */
import type { ReadableAtom } from 'nanostores';
import { closePerformance, performanceOpen } from './performanceStore';

export interface PerformanceFullscreenOptions {
  open?: ReadableAtom<boolean>;
  close?: () => void;
  doc?: Document;
}

/** Install the full-screen follower. Returns the uninstall function. */
export function installPerformanceFullscreen({
  open = performanceOpen,
  close = closePerformance,
  doc = document,
}: PerformanceFullscreenOptions = {}): () => void {
  // Whether this view put the page in full screen (we only ever leave what we entered).
  let entered = false;
  // The request still in flight: a fast enter then exit must leave full screen once it lands.
  let pending: Promise<void> | null = null;

  const request = () => {
    const element = doc.documentElement;
    if (pending) return; // Still entering from an earlier open: the view is open again, keep it.
    if (doc.fullscreenElement || typeof element?.requestFullscreen !== 'function') return;
    entered = true;
    try {
      // Old engines return undefined; a refusal rejects.
      const settled: Promise<void> = Promise.resolve(element.requestFullscreen()).then(
        () => {},
        () => {
          entered = false;
        },
      );
      pending = settled;
      void settled.then(() => {
        if (pending === settled) pending = null;
      });
    } catch {
      entered = false;
      pending = null;
    }
  };

  const leave = () => {
    entered = false;
    if (!doc.fullscreenElement || typeof doc.exitFullscreen !== 'function') return;
    try {
      void Promise.resolve(doc.exitFullscreen()).catch(() => {});
    } catch {
      // Already out of full screen.
    }
  };

  const exit = () => {
    if (!entered) return;
    if (pending) {
      // The request hasn't landed yet: leave full screen once it does, if the view is still closed.
      void pending.then(() => {
        if (entered && !open.get()) leave();
      });
      return;
    }
    leave();
  };

  const unlisten = open.listen((isOpen) => {
    if (isOpen) request();
    else exit();
  });

  const onFullscreenChange = () => {
    if (doc.fullscreenElement || !entered) return;
    entered = false;
    if (open.get()) close();
  };
  doc.addEventListener('fullscreenchange', onFullscreenChange);

  return () => {
    unlisten();
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
  };
}
