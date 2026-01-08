import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { secureApi, type User } from '../lib/secureApi';
import type { Session } from '@supabase/supabase-js';

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

  // Function to check authentication using backend API
  const checkAuth = async () => {
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
          setUser(data.user);
          
          // Update session expiry info if available
          if (data.sessionExpiresAt) {
            const expiresAt = new Date(data.sessionExpiresAt);
            setSessionExpiresAt(expiresAt);
            
            // Check if session expires within 5 minutes
            const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
            setSessionWarning(expiresAt < fiveMinutesFromNow);
          }
          
          return true;
        }
      }
      
      setUser(null);
      setSessionExpiresAt(null);
      setSessionWarning(false);
      return false;
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
      setSessionExpiresAt(null);
      setSessionWarning(false);
      return false;
    }
  };

  // Function to refresh session if needed
  const ensureValidSession = async (): Promise<boolean> => {
    // Just return current user state if we have one, to avoid redundant calls
    if (user) {
      return true;
    }
    
    try {
      // Only make API call if we don't have a user
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
          setUser(data.user);
          
          if (data.sessionExpiresAt) {
            const expiresAt = new Date(data.sessionExpiresAt);
            setSessionExpiresAt(expiresAt);
            
            const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
            setSessionWarning(expiresAt < fiveMinutesFromNow);
          }
          
          return true;
        }
      }
      
      setUser(null);
      setSessionExpiresAt(null);
      setSessionWarning(false);
      return false;
    } catch (error) {
      console.error('Session validation failed:', error);
      setUser(null);
      setSessionExpiresAt(null);
      setSessionWarning(false);
      return false;
    }
  };

  // Periodic session health check - DISABLED to stop spam
  useEffect(() => {
    // Temporarily disabled to stop API spam
    // TODO: Fix the interval multiplication bug
    return () => {};
  }, [user]);

  useEffect(() => {
    let mounted = true;

    // Simple backend authentication check
    const checkBackendAuth = async () => {
      try {
        // Just ask the backend if we're authenticated
        const response = await fetch('/api/auth/user', {
          method: 'GET',
          credentials: 'include', // Include HTTP-only cookies
          headers: {
            'Cache-Control': 'no-cache',
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            setUser(data.user);
          } else {
            setUser(null);
          }
        } else {
          setUser(null);
          
          // If 401, redirect to login
          if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
            window.location.href = '/login';
            return;
          }
        }
      } catch (error) {
        console.error('AuthContext - Backend auth check error:', error);
        setUser(null);
      }
      
      // Always set loading to false
      if (mounted) {
        setLoading(false);
      }
    };

    checkBackendAuth();

    // Listen for auth changes from OAuth callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
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
          redirectTo: `${window.location.origin}/auth/callback`
        }
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

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
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
