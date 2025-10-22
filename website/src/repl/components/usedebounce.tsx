import { useMemo, useEffect, useRef } from 'react';

function debounce<T extends (...args: any[]) => any>(fn: T, wait: number): T {
  let timer: NodeJS.Timeout | undefined;
  return ((...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), wait);
  }) as T;
}

export function useDebounce(callback: () => void): () => void {
  const ref = useRef<() => void>(()=> undefined);
  
  useEffect(() => {
    ref.current = callback;
  }, [callback]);

  const debouncedCallback = useMemo(() => {
    const func = () => {
      ref.current?.();
    };

    return debounce(func, 1000);
  }, []);

  return debouncedCallback;
}