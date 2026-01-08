import { atom } from 'nanostores';
import type { User } from '../lib/secureApi';

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
let sessionCheckInterval: NodeJS.Timeout | null = null;

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

  async checkAuth(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/user', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          this.setUser(data.user);
          
          if (data.sessionExpiresAt) {
            const expiresAt = new Date(data.sessionExpiresAt);
            const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
            this.setSessionInfo(expiresAt, expiresAt < fiveMinutesFromNow);
          }
          
          return true;
        } else {
          // API returned 200 but no user - user is not authenticated
          this.setUser(null);
          this.setSessionInfo(null, false);
          
          // Redirect to login if not already on login page
          if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
          
          return false;
        }
      }
      
      // Only clear user on explicit 401/403, not on network errors
      if (response.status === 401 || response.status === 403) {
        this.setUser(null);
        this.setSessionInfo(null, false);
        
        // Redirect to login on 401
        if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        
        return false;
      }
      
      // For other status codes, don't clear user - might be temporary server issue
      console.warn('Auth check returned non-OK status:', response.status, 'keeping current auth state');
      return !!this.getUser();
      
    } catch (error) {
      console.error('Auth check failed:', error);
      
      // Don't clear user on network errors - keep current state
      // Only log the error and return current auth status
      const currentUser = this.getUser();
      if (currentUser) {
        console.log('Network error during auth check, keeping user logged in');
        return true;
      }
      
      // If no current user and network error, stop loading but don't redirect
      this.setLoading(false);
      return false;
    }
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
          redirectTo: `${window.location.origin}/auth/callback`
        }
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

      this.setUser(null);
      this.setSessionInfo(null, false);

      // Notify other tabs
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('auth-change', Date.now().toString());
        localStorage.removeItem('auth-change');
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

    console.log('AuthStore - Starting periodic session check (every 30 seconds)');
    
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
    }, 30 * 1000); // Check every 30 seconds
  },

  stopPeriodicCheck() {
    if (sessionCheckInterval) {
      console.log('AuthStore - Stopping periodic session check');
      clearInterval(sessionCheckInterval);
      sessionCheckInterval = null;
    }
  },

  async initialize() {
    console.log('AuthStore - Initializing authentication...');
    
    try {
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