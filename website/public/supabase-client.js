// Client-side Supabase configuration
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js@2';

// Get environment variables from the global window object (set by Astro)
const supabaseUrl = window.SUPABASE_URL || 'https://iarlunyimplczudavrcl.supabase.co';
const supabaseAnonKey = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlhcmx1bnlpbXBsY3p1ZGF2cmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODczMzksImV4cCI6MjA4Mjg2MzMzOX0.px2ShuMyEogGaoUrRKWupogB1D0Ra2gPF4wNMCGV63w';

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

// Make it available globally for easier access
window.supabase = supabase;