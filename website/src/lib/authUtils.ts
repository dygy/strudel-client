import { supabase } from './supabase';

/**
 * Utility to ensure we have a valid session before making API calls
 */
export async function ensureValidSession() {
  try {
    // Get current session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session error:', sessionError);
      return { success: false, error: sessionError.message };
    }
    
    if (!session) {
      return { success: false, error: 'No active session' };
    }
    
    // Check if token is about to expire (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at || 0;
    const timeUntilExpiry = expiresAt - now;
    
    if (timeUntilExpiry < 300) { // Less than 5 minutes
      console.log('Token expiring soon, refreshing session...');
      
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.error('Failed to refresh session:', refreshError);
        return { success: false, error: 'Session refresh failed: ' + refreshError.message };
      }
      
      if (!refreshData.session) {
        return { success: false, error: 'No session after refresh' };
      }
      
      console.log('Session refreshed successfully');
      return { success: true, session: refreshData.session };
    }
    
    return { success: true, session };
    
  } catch (error) {
    console.error('ensureValidSession error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Wrapper for API calls that ensures valid authentication
 */
export async function withValidSession<T>(apiCall: () => Promise<T>): Promise<T> {
  const sessionResult = await ensureValidSession();
  
  if (!sessionResult.success) {
    throw new Error(`Authentication failed: ${sessionResult.error}`);
  }
  
  return apiCall();
}