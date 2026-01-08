import { useEffect } from 'react';
import { authActions } from '../../stores/authStore';

export function AuthInitializer() {
  useEffect(() => {
    // Initialize auth store once on app startup
    const initializeAuth = async () => {
      return await authActions.initialize();
    };

    let cleanup: (() => void) | undefined;

    initializeAuth().then((cleanupFn) => {
      cleanup = cleanupFn;
    });

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []); // Empty dependency array - only run once

  return null; // This component doesn't render anything
}
