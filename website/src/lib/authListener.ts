import { supabase } from './supabase';
import { authActions } from '../stores/authStore';

let authListener: { data: { subscription: { unsubscribe: () => void } } } | null = null;

/**
 * Initialize auth state listener to handle automatic token refresh
 * and session changes from Supabase
 */
export function initializeAuthListener() {
  if (authListener) {
    console.log('Auth listener already initialized');
    return;
  }

  console.log('Initializing Supabase auth state listener...');

  authListener = supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state change:', event, session ? 'session present' : 'no session');

    switch (event) {
      case 'SIGNED_IN':
        console.log('User signed in, updating auth store');
        if (session?.user) {
          authActions.setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || session.user.email || '',
            avatar: session.user.user_metadata?.avatar_url,
          });
          authActions.startPeriodicCheck();
        }
        break;

      case 'SIGNED_OUT':
        console.log('User signed out, clearing auth store');
        authActions.setUser(null);
        authActions.setSessionInfo(null, false);
        authActions.stopPeriodicCheck();
        break;

      case 'TOKEN_REFRESHED':
        console.log('Token refreshed successfully');
        if (session?.user) {
          // Update session info with new expiry
          if (session.expires_at) {
            const expiresAt = new Date(session.expires_at * 1000);
            const fifteenMinutesFromNow = new Date(Date.now() + 15 * 60 * 1000);
            authActions.setSessionInfo(expiresAt, expiresAt < fifteenMinutesFromNow);
          }
        }
        break;

      case 'USER_UPDATED':
        console.log('User updated');
        if (session?.user) {
          authActions.setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || session.user.email || '',
            avatar: session.user.user_metadata?.avatar_url,
          });
        }
        break;

      default:
        console.log('Unhandled auth event:', event);
    }
  });

  console.log('Auth listener initialized');
}

/**
 * Cleanup auth listener
 */
export function cleanupAuthListener() {
  if (authListener) {
    console.log('Cleaning up auth listener');
    authListener.data.subscription.unsubscribe();
    authListener = null;
  }
}