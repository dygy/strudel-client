import { useEffect, useRef } from 'react';

/**
 * Custom React hook for animation frames with start/stop controls
 * @param callback - Function called on each animation frame with (time, deltaTime)
 * @param autostart - Whether to automatically start the animation loop (default: false)
 * @returns Object with start and stop functions
 */
function useFrame(
  callback: (time: number, deltaTime: number) => void,
  autostart: boolean = false
): {
  start: () => void;
  stop: () => void;
} {
  const requestRef = useRef<number>(0);
  const previousTimeRef = useRef<number>(0);

  const animate = (time: number): void => {
    if (previousTimeRef.current !== undefined) {
      const deltaTime = time - previousTimeRef.current;
      callback(time, deltaTime);
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };

  const start = (): void => {
    requestRef.current = requestAnimationFrame(animate);
  };

  const stop = (): void => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = undefined;
    }
  };

  useEffect(() => {
    if (requestRef.current) {
      stop();
      start();
    }
  }, [callback]);

  useEffect(() => {
    if (autostart) {
      start();
    }
    return stop;
  }, []); // Make sure the effect only runs once

  return {
    start,
    stop,
  };
}

export default useFrame;