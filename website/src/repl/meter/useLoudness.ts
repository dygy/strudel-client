/**
 * React access to the loudness meter's store (spec 033 tech §2.3). Components take a runtime prop for
 * tests; the default is the website's singleton.
 *
 * The view and the history change at the meter's 10 Hz. While the tab is hidden the components are not
 * re-rendered (the worklet keeps measuring); when it shows again they catch up at once.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useStore } from '@nanostores/react';
import type { ReadableAtom } from 'nanostores';
import { loudnessRuntime, type LoudnessRuntime } from './loudnessRuntime';

const isHidden = () => typeof document !== 'undefined' && document.hidden === true;

/**
 * Subscribe to `store`, but only be told of its changes while the tab is visible, so a hidden tab is not
 * re-rendered at 10 Hz; showing the tab again re-reads it.
 */
export function useVisibleStore<T>(store: ReadableAtom<T>): T {
  const read = useCallback(() => store.get(), [store]);
  const subscribe = useCallback(
    (notify: () => void) => {
      const unlisten = store.listen(() => {
        if (!isHidden()) notify();
      });
      const onVisibility = () => {
        if (!isHidden()) notify();
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      return () => {
        unlisten();
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      };
    },
    [store],
  );
  return useSyncExternalStore(subscribe, read, read);
}

export function useLoudnessView(runtime: LoudnessRuntime = loudnessRuntime) {
  return useVisibleStore(runtime.view);
}

export function useLoudnessSettings(runtime: LoudnessRuntime = loudnessRuntime) {
  return useStore(runtime.settings);
}
