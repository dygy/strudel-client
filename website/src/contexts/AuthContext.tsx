import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { type User } from '../lib/secureApi';
import { checkAuthUser } from '../lib/authCheck';
import { syncSessionCookies } from '../lib/authCookies';
import { loginUrlForCurrentLocation } from '../lib/authRedirect';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  ensureValidSession: () => Promise<boolean>;
  sessionExpiresAt: Date | null;
  sessionWarning: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<Date | null>(null);
  const [sessionWarning, setSessionWarning] = useState(false);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  // One shared check (lib/authCheck.ts): refreshes the client session first, mirrors it into the
  // cookie and sends it as a Bearer token, so a stale cookie alone never signs anyone out.
  // 'unknown' (network, 5xx, transient refresh failure) keeps the current state.
  const checkAuth = async (): Promise<boolean> => {
    const result = await checkAuthUser();
    if (result.status === 'authenticated') {
      setUser(result.user);
      if (result.sessionExpiresAt) {
        const expiresAt = new Date(result.sessionExpiresAt);
        setSessionExpiresAt(expiresAt);
        // Check if session expires within 5 minutes
        const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
        setSessionWarning(expiresAt < fiveMinutesFromNow);
      }
      return true;
    }
    if (result.status === 'signed-out') {
      setUser(null);
      setSessionExpiresAt(null);
      setSessionWarning(false);
      return false;
    }
    console.warn('AuthContext - auth check inconclusive, keeping current state:', result.reason);
    return userRef.current !== null;
  };

  // Function to refresh session if needed
  const ensureValidSession = async (): Promise<boolean> => {
    // Just return current user state if we have one, to avoid redundant calls
    if (user) {
      return true;
    }
    return checkAuth();
  };

  // Periodic session health check - DISABLED to stop spam
  useEffect(() => {
    // Temporarily disabled to stop API spam
    // TODO: Fix the interval multiplication bug
    return () => {};
  }, [user]);

  useEffect(() => {
    let mounted = true;

    const checkBackendAuth = async () => {
      let signedOut = false;
      try {
        const result = await checkAuthUser();
        if (!mounted) return;
        if (result.status === 'authenticated') {
          setUser(result.user);
        } else if (result.status === 'signed-out') {
          setUser(null);
          signedOut = result.httpStatus === 401;
        }
      } catch (error: unknown) {
        console.error('AuthContext - Backend auth check error:', error);
      }

      if (signedOut && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = loginUrlForCurrentLocation();
        return;
      }

      // Always set loading to false
      if (mounted) {
        setLoading(false);
      }
    };

    checkBackendAuth();

    // Listen for auth changes from OAuth callback
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Keep the server's cookie copy of the access token current (and clear it on sign-out)
      syncSessionCookies(event, session);
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session) {
        // After OAuth sign-in, check auth via secure API
        await checkAuth();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }

      setLoading(false);
    });

    // Listen for auth changes from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth-change') {
        checkAuth();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        console.error('Error signing in with Google:', error);
        throw error;
      }
    } catch (error) {
      console.error('Sign in error:', error);
      setLoading(false);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        throw error;
      }

      // Clear user state
      setUser(null);

      // Notify other tabs
      localStorage.setItem('auth-change', Date.now().toString());
      localStorage.removeItem('auth-change');
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setLoading(false);
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    signInWithGoogle,
    signOut,
    isAuthenticated: !!user, // Simple: if we have a user, we're authenticated
    ensureValidSession,
    sessionExpiresAt,
    sessionWarning,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useRequireAuth() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      console.log('User not authenticated, should redirect or show auth modal');
    }
  }, [user, loading]);

  return { user, loading, isAuthenticated: !!user };
}
