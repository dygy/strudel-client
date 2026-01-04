// OAuth callback handler script
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js@2';

async function handleCallback() {
    try {
        // Get environment variables from window (set by Astro)
        const supabaseUrl = window.SUPABASE_URL || 'https://iarlunyimplczudavrcl.supabase.co';
        const supabaseAnonKey = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlhcmx1bnlpbXBsY3p1ZGF2cmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODczMzksImV4cCI6MjA4Mjg2MzMzOX0.px2ShuMyEogGaoUrRKWupogB1D0Ra2gPF4wNMCGV63w';
        
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
        
        // Wait a bit for Supabase to process the OAuth callback
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check for session multiple times with retries
        let session = null;
        let attempts = 0;
        const maxAttempts = 5;
        
        while (!session && attempts < maxAttempts) {
            attempts++;
            console.log(`OAuth callback - Attempt ${attempts} to get session...`);
            
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
            
            // Set cookies that the server can read
            document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=3600; secure; samesite=lax`;
            if (session.refresh_token) {
                document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=86400; secure; samesite=lax`;
            }
            
            // Check for stored redirect URL first, then URL params
            const storedRedirect = sessionStorage.getItem('strudel_redirect_after_auth');
            const urlParams = new URLSearchParams(window.location.search);
            const trackParam = urlParams.get('track');
            
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
            window.location.href = '/login?error=no_session';
        }
    } catch (error) {
        console.error('OAuth callback - Error:', error);
        window.location.href = '/login?error=callback_error';
    }
}

// Start the callback handling
handleCallback();