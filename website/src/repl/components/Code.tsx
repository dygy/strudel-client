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

  // Memoize the ref callback to prevent recreation on every render
  const refCallback = useCallback((el: HTMLElement | null) => {
    console.log('Code component - ref callback called, element:', !!el, 'hasInitialized:', hasInitialized.current);

    if (el && !hasInitialized.current) {
      hasInitialized.current = true;
      containerRef.current = el;
      console.log('Code component - initializing editor with element');

      // Initialize immediately since we have the element
      console.log('Code component - calling init() with containerRef:', !!containerRef.current);
      init();

      // CRITICAL: After initialization, check if there's code that needs to be loaded
      setTimeout(() => {
        console.log('Code component - checking for pending code after init');

        // Check if there's a track that should be loaded
        const activePattern = (window as any).getActivePattern?.();
        if (activePattern) {
          console.log('Code component - found active pattern, dispatching load event:', activePattern);
          window.dispatchEvent(new CustomEvent('strudel-editor-ready', {
            detail: { activePattern }
          }));
        }

        // Also check for any pending code in the nano store
        const pendingCode = getPendingCode();
        if (pendingCode) {
          console.log('Code component - found pending code, setting it:', pendingCode.substring(0, 50) + '...');
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
      className={'text-gray-100 cursor-text pb-0 overflow-auto grow'}
      id="code"
      dir="ltr"
      ref={refCallback}
    />
  );
});
