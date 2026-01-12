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
    
    // Check if token is about to expire (within 10 minutes for more buffer)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at || 0;
    const timeUntilExpiry = expiresAt - now;
    
    // Refresh if expiring within 10 minutes or already expired
    if (timeUntilExpiry < 600) { 
      console.log(`Token expiring in ${timeUntilExpiry}s, refreshing session...`);
      
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) {
        console.error('Failed to refresh session:', refreshError);
        return { success: false, error: 'Session refresh failed: ' + refreshError.message };
      }
      
      if (!refreshData.session) {
        return { success: false, error: 'No session after refresh' };
      }
      
      console.log('Session refreshed successfully, new expiry:', new Date(refreshData.session.expires_at * 1000));
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

/**
 * Enhanced wrapper for API calls that handles token refresh automatically
 */
export async function withAutoRefresh<T>(apiCall: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Ensure valid session before each attempt
      const sessionResult = await ensureValidSession();
      
      if (!sessionResult.success) {
        throw new Error(`Authentication failed: ${sessionResult.error}`);
      }
      
      // Execute the API call
      return await apiCall();
      
    } catch (error) {
      lastError = error as Error;
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Check if this is an auth-related error that might be resolved by refresh
      const errorMessage = error.message?.toLowerCase() || '';
      const isAuthError = errorMessage.includes('auth') || 
                         errorMessage.includes('token') || 
                         errorMessage.includes('session') ||
                         errorMessage.includes('401') ||
                         errorMessage.includes('403');
      
      if (!isAuthError) {
        // Not an auth error, don't retry
        throw error;
      }
      
      console.log(`API call failed with auth error (attempt ${attempt + 1}), retrying...`, error.message);
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw lastError || new Error('API call failed after retries');
}

/**
 * Check if current session is valid without forcing a refresh
 */
export async function isSessionValid(): Promise<boolean> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      return false;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at || 0;
    
    // Consider session valid if it has more than 5 minutes left
    return (expiresAt - now) > 300;
  } catch (error) {
    console.error('Error checking session validity:', error);
    return false;
  }
}