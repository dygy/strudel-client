import { useStore } from '@nanostores/react';
import { authStore, authActions, authSelectors } from '../stores/authStore';

export function useAuth() {
  const state = useStore(authStore);

  return {
    // State
    user: state.user,
    loading: state.loading,
    isAuthenticated: !!state.user,
    sessionExpiresAt: state.sessionExpiresAt,
    sessionWarning: state.sessionWarning,

    // Actions
    signInWithGoogle: authActions.signInWithGoogle.bind(authActions),
    signOut: authActions.signOut.bind(authActions),
    checkAuth: authActions.checkAuth.bind(authActions),
    
    // Selectors (for convenience)
    ...authSelectors,
  };
}