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

  // Function to check authentication using secure API
  const checkAuth = async () => {
    try {
      const { user: authUser } = await secureApi.getUser();
      setUser(authUser);
      
      // Update session expiry info
      if (authUser) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.expires_at) {
          const expiresAt = new Date(session.expires_at * 1000);
          setSessionExpiresAt(expiresAt);
          
          // Check if session expires within 5 minutes
          const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
          setSessionWarning(expiresAt < fiveMinutesFromNow);
        }
      } else {
        setSessionExpiresAt(null);
        setSessionWarning(false);
      }
      
      return !!authUser;
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
    try {
      // First try to refresh the session with Supabase
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.log('AuthContext - Session refresh failed:', refreshError.message);
        // If refresh fails, try to get current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!currentSession) {
          console.log('AuthContext - No valid session found');
          setUser(null);
          setSessionExpiresAt(null);
          setSessionWarning(false);
          return false;
        }
      } else if (session) {
        console.log('AuthContext - Session refreshed successfully');
      }

      // Then validate with our secure API
      const { user: authUser } = await secureApi.getUser();
      if (authUser) {
        setUser(authUser);
        
        // Update session expiry info
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.expires_at) {
          const expiresAt = new Date(currentSession.expires_at * 1000);
          setSessionExpiresAt(expiresAt);
          
          // Check if session expires within 5 minutes
          const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
          setSessionWarning(expiresAt < fiveMinutesFromNow);
          
          console.log('AuthContext - Session expires at:', expiresAt.toLocaleString());
        }
        
        return true;
      } else {
        setUser(null);
        setSessionExpiresAt(null);
        setSessionWarning(false);
        return false;
      }
    } catch (error) {
      console.error('Session validation failed:', error);
      setUser(null);
      setSessionExpiresAt(null);
      setSessionWarning(false);
      return false;
    }
  };

  // Periodic session health check
  useEffect(() => {
    let sessionCheckInterval: NodeJS.Timeout | null = null;

    const startSessionHealthCheck = () => {
      // Only start health check if user is authenticated and not loading
      if (!user || loading) {
        console.log('AuthContext - Not starting session health check:', { hasUser: !!user, loading });
        return;
      }

      console.log('AuthContext - Starting periodic session health check (every 10 seconds)');
      
      sessionCheckInterval = setInterval(async () => {
        try {
          console.log('AuthContext - 🔄 Performing periodic session check...');
          
          // Always make explicit network call to validate session
          const response = await fetch('/api/auth/user', {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
            },
          });
          
          if (response.ok) {
            const userData = await response.json();
            if (userData.user) {
              console.log('AuthContext - ✅ Periodic session validation successful');
              setUser(userData.user);
              
              // Check session expiry
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.expires_at) {
                const expiresAt = new Date(session.expires_at * 1000);
                const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);
                
                if (expiresAt < tenMinutesFromNow) {
                  console.log('AuthContext - ⚠️ Session expires soon, will refresh on next check');
                  setSessionWarning(true);
                } else {
                  setSessionWarning(false);
                }
                
                setSessionExpiresAt(expiresAt);
              }
            } else {
              console.warn('AuthContext - ❌ No user in periodic validation response');
              setUser(null);
              setSessionExpiresAt(null);
              setSessionWarning(false);
            }
          } else {
            console.warn('AuthContext - ❌ Periodic session validation failed:', response.status);
            if (response.status === 401) {
              console.log('AuthContext - Session expired, signing out user');
              setUser(null);
              setSessionExpiresAt(null);
              setSessionWarning(false);
            }
          }
        } catch (error) {
          console.error('AuthContext - ❌ Session health check failed:', error);
        }
      }, 10000); // Check every 10 seconds
    };

    const stopSessionHealthCheck = () => {
      if (sessionCheckInterval) {
        console.log('AuthContext - Stopping periodic session health check');
        clearInterval(sessionCheckInterval);
        sessionCheckInterval = null;
      }
    };

    // Debug current state
    console.log('AuthContext - Session health check effect triggered:', { 
      hasUser: !!user, 
      loading, 
      isAuthenticated: !!user && !loading 
    });

    // Start health check when user is authenticated and not loading
    if (user && !loading) {
      startSessionHealthCheck();
    } else {
      stopSessionHealthCheck();
    }

    // Cleanup on unmount or user change
    return () => {
      stopSessionHealthCheck();
    };
  }, [user, loading]); // Restart health check when user or loading state changes

  useEffect(() => {
    let mounted = true;
    let retryCount = 0;
    const maxRetries = 3;

    // Get initial session using secure API with retry logic
    const getInitialSession = async () => {
      try {
        // Add timeout to prevent infinite loading
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Initial session timeout')), 15000);
        });

        // First, try to restore session from Supabase storage
        console.log('AuthContext - Attempting to restore session...');
        
        let session: Session | null = null;
        let sessionError: Error | null = null;
        
        try {
          const sessionResult = await Promise.race([
            supabase.auth.getSession(),
            timeoutPromise
          ]);
          
          // Type guard to check if we got a valid session result
          if (sessionResult && typeof sessionResult === 'object' && 'data' in sessionResult) {
            const typedResult = sessionResult as { data: { session: Session | null }, error: Error | null };
            session = typedResult.data.session;
            sessionError = typedResult.error;
          } else {
            console.log('AuthContext - Invalid session result type');
            sessionError = new Error('Invalid session result');
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'Initial session timeout') {
            console.log('AuthContext - Session restoration timed out');
            sessionError = error;
          } else {
            throw error;
          }
        }
        
        if (session && !sessionError) {
          console.log('AuthContext - Session restored from storage');
        } else if (sessionError) {
          console.log('AuthContext - Session restoration error:', sessionError);
        } else {
          console.log('AuthContext - No session found in storage');
        }

        // Then check authentication via secure API with timeout
        let isAuthenticated = false;
        
        try {
          const authResult = await Promise.race([
            checkAuth(),
            timeoutPromise
          ]);
          
          // Type guard to check if we got a boolean result
          if (typeof authResult === 'boolean') {
            isAuthenticated = authResult;
          } else {
            console.log('AuthContext - Invalid auth result type:', typeof authResult);
            isAuthenticated = false;
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'Initial session timeout') {
            console.log('AuthContext - Authentication check timed out');
            isAuthenticated = false;
          } else {
            throw error;
          }
        }

        if (!mounted) return;

        if (isAuthenticated) {
          console.log('AuthContext - User authenticated');
          setLoading(false);
        } else {
          console.log('AuthContext - No authenticated user');
          
          // If no user found and we haven't exceeded retries, try again after a short delay
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`AuthContext - Retrying authentication check (${retryCount}/${maxRetries})...`);
            setTimeout(() => {
              if (mounted) {
                getInitialSession();
              }
            }, 2000 * retryCount); // Longer delay for better session restoration
            return;
          }
          
          // Only set loading to false after all retries are exhausted
          console.log('AuthContext - All retries exhausted, no user found');
          setLoading(false);
        }
      } catch (error) {
        console.error('AuthContext - Error getting initial session:', error);
        if (mounted) {
          // If it's a timeout error, just set loading to false and let user try to sign in
          if (error instanceof Error && error.message === 'Initial session timeout') {
            console.log('AuthContext - Session restoration timed out, setting loading to false');
            setLoading(false);
            return;
          }
          
          // Retry on other errors if we haven't exceeded max retries
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`AuthContext - Retrying after error (${retryCount}/${maxRetries})...`);
            setTimeout(() => {
              if (mounted) {
                getInitialSession();
              }
            }, 1000 * retryCount);
            return;
          }
          setLoading(false);
        }
      }
    };

    getInitialSession();

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
    isAuthenticated: !!user,
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
