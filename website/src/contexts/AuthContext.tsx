import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, type UserProfile } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

// Function to sync localStorage data to Supabase
async function syncLocalStorageToSupabase() {
  if (typeof localStorage === 'undefined') return;

  console.log('AuthContext: Starting localStorage to Supabase sync...');

  try {
    const { migration } = await import('../lib/supabase');
    const { toastActions } = await import('../stores/toastStore');
    
    // Check if user has already migrated
    const hasMigrated = await migration.hasMigrated();
    if (hasMigrated) {
      console.log('AuthContext: User already has Supabase data, skipping sync');
      return;
    }

    // Check if there's localStorage data to sync
    const tracksData = localStorage.getItem('strudel_tracks');
    const foldersData = localStorage.getItem('strudel_folders');
    
    if (!tracksData && !foldersData) {
      console.log('AuthContext: No localStorage data to sync');
      return;
    }

    // Show sync notification
    toastActions.info('Syncing your tracks to the cloud...');

    // Perform migration
    console.log('AuthContext: Migrating localStorage data to Supabase...');
    const results = await migration.migrateFromLocalStorage();
    
    console.log('AuthContext: Migration completed:', {
      tracks: results.tracks.success,
      folders: results.folders.success,
      errors: [...results.tracks.errors, ...results.folders.errors]
    });

    // Clear localStorage after successful migration
    if (results.tracks.success > 0 || results.folders.success > 0) {
      migration.clearLocalStorage();
      console.log('AuthContext: localStorage cleared after successful migration');
      
      // Show success notification
      const totalSynced = results.tracks.success + results.folders.success;
      toastActions.success(`Successfully synced ${totalSynced} items to the cloud!`);
    } else if (results.tracks.errors.length > 0 || results.folders.errors.length > 0) {
      toastActions.error('Some items could not be synced. Please try again.');
    }
  } catch (error) {
    console.error('AuthContext: Error during localStorage sync:', error);
    const { toastActions } = await import('../stores/toastStore');
    toastActions.error('Failed to sync your tracks to the cloud. Please try again.');
  }
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let retryCount = 0;
    const maxRetries = 10;
    
    // Get initial session with retry logic
    const getInitialSession = async () => {
      try {
        console.log('AuthContext: Getting initial session...');
        const { session, error } = await auth.getCurrentSession();
        
        if (!mounted) return;
        
        if (error) {
          console.error('AuthContext: Error getting session:', error);
        } else if (session) {
          console.log('AuthContext: Initial session loaded:', `authenticated (${session.user.email})`);
          setSession(session);
          setUser(session.user);
          setLoading(false);
          return; // Session found, stop retrying
        } else {
          console.log('AuthContext: Initial session loaded: not authenticated');
          
          // If we're coming from OAuth callback, retry a few times
          const isFromCallback = window.location.pathname === '/' && 
                                 (window.location.search.includes('code=') || 
                                  sessionStorage.getItem('strudel_redirect_after_auth') ||
                                  document.referrer.includes('/auth/callback'));
          
          console.log('AuthContext: OAuth callback detection:', {
            pathname: window.location.pathname,
            hasCode: window.location.search.includes('code='),
            hasRedirectUrl: !!sessionStorage.getItem('strudel_redirect_after_auth'),
            referrer: document.referrer,
            isFromCallback
          });
          
          if (isFromCallback && retryCount < maxRetries) {
            retryCount++;
            console.log(`AuthContext: Retrying session check ${retryCount}/${maxRetries} (OAuth callback detected)`);
            setTimeout(getInitialSession, 1000); // Retry after 1 second
            return;
          }
        }
      } catch (error) {
        console.error('AuthContext: Error getting initial session:', error);
      }
      
      // Only set loading to false if we're not retrying
      if (mounted && (retryCount >= maxRetries || !window.location.search.includes('code='))) {
        setLoading(false);
      }
    };

    getInitialSession();

    // Also set up a periodic session check for the first 30 seconds after page load
    // This helps catch sessions that become available after OAuth
    let periodicCheckCount = 0;
    const maxPeriodicChecks = 30; // 30 checks over 30 seconds
    
    const periodicSessionCheck = setInterval(async () => {
      if (!mounted) {
        clearInterval(periodicSessionCheck);
        return;
      }
      
      periodicCheckCount++;
      
      try {
        const { session, error } = await auth.getCurrentSession();
        
        if (session && !user) {
          console.log('AuthContext: Session found via periodic check!', session.user.email);
          setSession(session);
          setUser(session.user);
          setLoading(false);
          clearInterval(periodicSessionCheck);
          return;
        }
      } catch (error) {
        console.error('AuthContext: Periodic session check error:', error);
      }
      
      if (periodicCheckCount >= maxPeriodicChecks || user) {
        clearInterval(periodicSessionCheck);
      }
    }, 1000);

    // Listen for auth changes
    const { data: { subscription } } = auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      
      console.log('AuthContext: Auth state changed:', event, session?.user?.email || 'no user');
      
      setSession(session);
      setUser(session?.user || null);
      
      // Always set loading to false when we get an auth state change
      setLoading(false);

      // Load user profile when signed in
      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        try {
          const { db } = await import('../lib/supabase');
          const { data: profileData, error } = await db.profiles.get();
          if (error) {
            console.error('AuthContext: Error loading profile:', error);
          } else {
            console.log('AuthContext: Profile loaded:', profileData?.email);
            setProfile(profileData);
          }
        } catch (error) {
          console.error('AuthContext: Error loading profile:', error);
        }

        // Handle redirect after authentication
        if (event === 'SIGNED_IN') {
          // Auto-sync localStorage data to Supabase when user signs in
          try {
            await syncLocalStorageToSupabase();
          } catch (error) {
            console.error('AuthContext: Error syncing localStorage to Supabase:', error);
          }

          const redirectUrl = sessionStorage.getItem('strudel_redirect_after_auth');
          if (redirectUrl) {
            console.log('AuthContext: Redirecting to stored URL:', redirectUrl);
            sessionStorage.removeItem('strudel_redirect_after_auth');
            // Small delay to ensure auth state is fully updated
            setTimeout(() => {
              window.location.href = redirectUrl;
            }, 100);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        console.log('AuthContext: User signed out, clearing profile');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (periodicSessionCheck) {
        clearInterval(periodicSessionCheck);
      }
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      const { error } = await auth.signInWithGoogle();
      if (error) {
        console.error('Error signing in with Google:', error);
        throw error;
      }
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      const { error } = await auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        throw error;
      }
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const value: AuthContextType = {
    user,
    session,
    profile,
    loading,
    signInWithGoogle,
    signOut,
    isAuthenticated: !!user,
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

// Hook for checking if user is authenticated
export function useRequireAuth() {
  const { user, loading } = useAuth();
  
  useEffect(() => {
    if (!loading && !user) {
      // Redirect to sign in or show auth modal
      console.log('User not authenticated, should redirect or show auth modal');
    }
  }, [user, loading]);

  return { user, loading, isAuthenticated: !!user };
}