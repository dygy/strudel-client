import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const CallbackPage: React.FC = () => {
  const [status, setStatus] = useState('Authenticating...');

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    const handleCallback = async () => {
      try {
        // Get environment variables
        const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://iarlunyimplczudavrcl.supabase.co';
        const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlhcmx1bnlpbXBsY3p1ZGF2cmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODczMzksImV4cCI6MjA4Mjg2MzMzOX0.px2ShuMyEogGaoUrRKWupogB1D0Ra2gPF4wNMCGV63w';
        
        // Create Supabase client
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
          },
        });
        
        console.log('OAuth callback - Starting...');
        setStatus('Processing authentication...');
        
        // Wait a bit for Supabase to process the OAuth callback
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check for session multiple times with retries
        let session = null;
        let attempts = 0;
        const maxAttempts = 5;
        
        while (!session && attempts < maxAttempts) {
          attempts++;
          console.log(`OAuth callback - Attempt ${attempts} to get session...`);
          setStatus(`Verifying authentication (${attempts}/${maxAttempts})...`);
          
          const { data: { session: currentSession }, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('OAuth callback - Session error:', error);
          }
          
          if (currentSession) {
            session = currentSession;
            console.log('OAuth callback - Session found:', {
              userId: session.user?.id,
              userEmail: session.user?.email,
              accessToken: session.access_token ? 'present' : 'missing',
              expiresAt: session.expires_at
            });
            break;
          }
          
          // Wait before retry
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        if (session) {
          console.log('OAuth callback - Success! Setting cookies and redirecting to /repl');
          setStatus('Authentication successful! Redirecting...');
          
          // Set cookies that the server can read
          document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=3600; secure; samesite=lax`;
          if (session.refresh_token) {
            document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=86400; secure; samesite=lax`;
          }
          
          // Check for stored redirect URL first, then URL params
          const storedRedirect = sessionStorage.getItem('strudel_redirect_after_auth');
          const urlParams = new URLSearchParams(window.location.search);
          const trackParam = urlParams.get('track');
          
          // Small delay to show success message
          await new Promise(resolve => setTimeout(resolve, 500));
          
          if (storedRedirect) {
            sessionStorage.removeItem('strudel_redirect_after_auth');
            window.location.href = storedRedirect;
          } else if (trackParam) {
            window.location.href = `/repl?track=${trackParam}`;
          } else {
            window.location.href = '/repl';
          }
        } else {
          console.error('OAuth callback - No session found after all attempts');
          setStatus('Authentication failed. Redirecting to login...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          window.location.href = '/login?error=no_session';
        }
      } catch (error) {
        console.error('OAuth callback - Error:', error);
        setStatus('Authentication error. Redirecting to login...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        window.location.href = '/login?error=callback_error';
      }
    };
    
    handleCallback();
  }, []);

  const styles = {
    body: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      margin: 0,
      background: '#f8fafc',
    },
    container: {
      textAlign: 'center' as const,
      padding: '2rem',
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      maxWidth: '400px',
    },
    spinner: {
      width: '40px',
      height: '40px',
      border: '4px solid #e5e7eb',
      borderTop: '4px solid #3b82f6',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      margin: '0 auto 1rem',
    },
  };

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <div style={styles.spinner}></div>
        <h2>Authenticating...</h2>
        <p>{status}</p>
      </div>
      
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default CallbackPage;