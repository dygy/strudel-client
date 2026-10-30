import React, { useCallback, useRef, useEffect } from 'react';
import { getPendingCode, clearPendingCode, getEditorInstance } from '../../stores/editorStore';

interface CodeProps {
  containerRef: React.MutableRefObject<HTMLElement | null>;
  editorRef: React.MutableRefObject<any>;
  init: () => void;
}

export const Code = React.memo(function Code({ editorRef, containerRef, init }: CodeProps) {
  // Use a ref to track if we've already initialized
  const hasInitialized = useRef(false);
  // The post-init check below; cleared on unmount so it never runs after the editor is gone
  // (in tests it used to fire after jsdom's teardown: "window is not defined").
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (readyTimer.current !== null) clearTimeout(readyTimer.current);
      readyTimer.current = null;
    },
    [],
  );

  // Memoize the ref callback to prevent recreation on every render
  const refCallback = useCallback((el: HTMLElement | null) => {
    if (el && !hasInitialized.current) {
      hasInitialized.current = true;
      containerRef.current = el;

      // Initialize immediately since we have the element
      init();

      // CRITICAL: After initialization, check if there's code that needs to be loaded
      readyTimer.current = setTimeout(() => {
        readyTimer.current = null;
        // Check if there's a track that should be loaded
        const activePattern = (window as any).getActivePattern?.();
        if (activePattern) {
          window.dispatchEvent(
            new CustomEvent('strudel-editor-ready', {
              detail: { activePattern },
            }),
          );
        }

        // Also check for any pending code in the nano store
        const pendingCode = getPendingCode();
        if (pendingCode) {
          if (editorRef.current?.setCode) {
            editorRef.current.setCode(pendingCode);
          }
          clearPendingCode(); // Clear it
        }
      }, 100);
    }
  }, []); // Empty dependencies to prevent recreation

  // Remove the debug visual indicator and CodeMirror test code
  // as they were causing issues and are not needed for production

  return (
    <section
      className={'text-gray-100 cursor-text pb-0 overflow-auto h-full w-full'}
      id="code"
      dir="ltr"
      ref={refCallback}
    />
  );
});
