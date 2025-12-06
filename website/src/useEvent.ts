import { useEffect } from 'react';

/**
 * Custom React hook for adding and cleaning up document event listeners
 * @param name - The event name to listen for
 * @param onTrigger - The event handler function
 * @param useCapture - Whether to use capture phase (default: false)
 */
function useEvent<T = any>(
  name: string,
  onTrigger: (event: CustomEvent<T> | Event) => void,
  useCapture: boolean = false
): void {
  useEffect(() => {
    document.addEventListener(name, onTrigger, useCapture);
    return () => {
      document.removeEventListener(name, onTrigger, useCapture);
    };
  }, [name, onTrigger, useCapture]);
}

export default useEvent;