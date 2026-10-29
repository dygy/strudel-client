import { atom } from 'nanostores';
import type { User } from '../lib/secureApi';
import { loginUrlForCurrentLocation } from '../lib/authRedirect';

interface AuthState {
  user: User | null;
  loading: boolean;
  sessionExpiresAt: Date | null;
  sessionWarning: boolean;
}

const initialState: AuthState = {
  user: null,
  loading: true,
  sessionExpiresAt: null,
  sessionWarning: false,
};

// Auth store
export const authStore = atom<AuthState>(initialState);

// Single interval reference - outside of any component
let sessionCheckInterval: ReturnType<typeof setInterval> | null = null;
let checkInFlight: Promise<boolean> | null = null;
let resumeListenersAttached = false;

// Timers are throttled in background tabs: when the tab comes back, check (and refresh) right away
// instead of waiting for the next tick, which may land after the access token expired.
function handleResume() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (!authStore.get().user) return;
  authActions.checkAuth().catch((error: unknown) => {
    console.error('Auth check on tab resume failed:', error);
  });
}

function redirectToLogin() {
  if (typeof window === 'undefined' || window.location.pathname.includes('/login')) return;
  // Leaving the page runs the beforeunload/pagehide emergency save in globalSaveManager.
  window.location.href = loginUrlForCurrentLocation();
}

async function runAuthCheck(): Promise<boolean> {
  try {
    const { checkAuthUser } = await import('../lib/authCheck');
    const result = await checkAuthUser();

    if (result.status === 'authenticated') {
      authActions.setUser(result.user);
      if (result.sessionExpiresAt) {
        const expiresAt = new Date(result.sessionExpiresAt);
        // Show warning if expiring within 15 minutes (more buffer)
        const fifteenMinutesFromNow = new Date(Date.now() + 15 * 60 * 1000);
        authActions.setSessionInfo(expiresAt, expiresAt < fifteenMinutesFromNow);
      }
      return true;
    }

    if (result.status === 'signed-out') {
      authActions.setUser(null);
      authActions.setSessionInfo(null, false);
      // 403 clears the user but stays put, as before
      if (result.httpStatus !== 403) redirectToLogin();
      return false;
    }

    // Unknown (network, 5xx, transient refresh failure): keep the current auth state
    console.warn('Auth check inconclusive, keeping current auth state:', result.reason);
    if (!authActions.getUser()) authActions.setLoading(false);
    return !!authActions.getUser();
  } catch (error: unknown) {
    console.error('Auth check failed:', error);
    if (!authActions.getUser()) authActions.setLoading(false);
    return !!authActions.getUser();
  }
}

// Auth actions
export const authActions = {
  setUser(user: User | null) {
    const currentState = authStore.get();
    authStore.set({
      ...currentState,
      user,
      loading: false,
    });
  },

  setLoading(loading: boolean) {
    const currentState = authStore.get();
    authStore.set({
      ...currentState,
      loading,
    });
  },

  setSessionInfo(expiresAt: Date | null, warning: boolean) {
    const currentState = authStore.get();
    authStore.set({
      ...currentState,
      sessionExpiresAt: expiresAt,
      sessionWarning: warning,
    });
  },

  /**
   * Ask whether the user is still signed in. The client supabase session is refreshed first and
   * sent as a Bearer token (lib/authCheck.ts), so an expired cookie alone never signs anyone out.
   * Only redirects to /login when the client has no session and the server agrees.
   * Concurrent calls (interval + tab resume) share one request.
   */
  checkAuth(): Promise<boolean> {
    if (!checkInFlight) {
      checkInFlight = runAuthCheck().finally(() => {
        checkInFlight = null;
      });
    }
    return checkInFlight;
  },

  getUser(): User | null {
    return authStore.get().user;
  },

  async signInWithGoogle() {
    try {
      this.setLoading(true);

      // Import supabase dynamically to avoid SSR issues
      const { supabase } = await import('../lib/supabase');

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        console.error('Error signing in with Google:', error);
        this.setLoading(false);
        throw error;
      }
    } catch (error) {
      console.error('Sign in error:', error);
      this.setLoading(false);
      throw error;
    }
  },

  async signOut() {
    try {
      this.setLoading(true);

      // Import supabase dynamically to avoid SSR issues
      const { supabase } = await import('../lib/supabase');

      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        throw error;
      }

      const { clearSessionCookies } = await import('../lib/authCookies');
      clearSessionCookies();
      this.setUser(null);
      this.setSessionInfo(null, false);

      // Notify other tabs
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('auth-change', Date.now().toString());
        localStorage.removeItem('auth-change');
      }

      // Redirect to login page after successful logout
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      this.setLoading(false);
    }
  },

  startPeriodicCheck() {
    // Only start if not already running and we have a user
    if (sessionCheckInterval || !authStore.get().user) {
      return;
    }

    console.log('AuthStore - Starting periodic session check (every 60 seconds)');

    sessionCheckInterval = setInterval(async () => {
      const currentState = authStore.get();
      if (currentState.user) {
        try {
          await this.checkAuth();
        } catch (error) {
          console.error('Periodic auth check failed, but continuing:', error);
          // Don't stop the interval on errors - keep checking
        }
      } else {
        // Stop checking if no user
        this.stopPeriodicCheck();
      }
    }, 60 * 1000); // Check every 60 seconds (less frequent to reduce race conditions)

    if (typeof window !== 'undefined' && !resumeListenersAttached) {
      document.addEventListener('visibilitychange', handleResume);
      window.addEventListener('focus', handleResume);
      resumeListenersAttached = true;
    }
  },

  stopPeriodicCheck() {
    if (sessionCheckInterval) {
      console.log('AuthStore - Stopping periodic session check');
      clearInterval(sessionCheckInterval);
      sessionCheckInterval = null;
    }
    if (typeof window !== 'undefined' && resumeListenersAttached) {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
      resumeListenersAttached = false;
    }
  },

  async initialize() {
    console.log('AuthStore - Initializing authentication...');

    try {
      // Initialize Supabase auth listener first
      const { initializeAuthListener, cleanupAuthListener } = await import('../lib/authListener');
      initializeAuthListener();

      const isAuthenticated = await this.checkAuth();

      if (isAuthenticated) {
        this.startPeriodicCheck();
      }

      // Listen for auth changes from other tabs
      if (typeof window !== 'undefined') {
        const handleStorageChange = (e: StorageEvent) => {
          if (e.key === 'auth-change') {
            this.checkAuth();
          }
        };

        window.addEventListener('storage', handleStorageChange);

        // Return cleanup function
        return () => {
          window.removeEventListener('storage', handleStorageChange);
          this.stopPeriodicCheck();
          cleanupAuthListener();
        };
      }
    } catch (error) {
      console.error('AuthStore - Initialization failed:', error);
      this.setLoading(false);
    }
  },
};

// Selectors
export const authSelectors = {
  getUser(): User | null {
    return authStore.get().user;
  },

  isAuthenticated(): boolean {
    return !!authStore.get().user;
  },

  isLoading(): boolean {
    return authStore.get().loading;
  },

  getSessionInfo() {
    const state = authStore.get();
    return {
      expiresAt: state.sessionExpiresAt,
      warning: state.sessionWarning,
    };
  },
};
