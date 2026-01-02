import { createClient } from '@supabase/supabase-js';

// Supabase configuration from environment variables
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

// Create Supabase client with default session storage (more reliable)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    // Use default localStorage-based storage for better reliability
    // storage: window.localStorage (this is the default)
  },
});

// Database types
// Database types (snake_case to match PostgreSQL)
export interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string;
  is_multitrack?: boolean; // Database column name
  steps?: TrackStep[];
  active_step?: number; // Database column name
  user_id: string;
  // UI compatibility fields (will be converted)
  isMultitrack?: boolean;
  activeStep?: number;
}

export interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parent?: string;
  created: string;
  user_id: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

// Database table names
export const TABLES = {
  TRACKS: 'tracks',
  FOLDERS: 'folders',
  PROFILES: 'profiles',
} as const;

// Auth helper functions
export const auth = {
  // Sign in with Google
  signInWithGoogle: async () => {
    // Get the current origin, but ensure we use the correct callback URL
    const origin = window.location.origin;
    const callbackUrl = `${origin}/auth/callback`;

    console.log('=== SIGN IN WITH GOOGLE DEBUG ===');
    console.log('Origin:', origin);
    console.log('Callback URL:', callbackUrl);
    console.log('Starting OAuth flow...');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
      },
    });
    
    console.log('OAuth result:', { data, error });
    console.log('=== END SIGN IN WITH GOOGLE DEBUG ===');
    
    return { data, error };
  },

  // Sign out
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  // Get current user
  getCurrentUser: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    return { user, error };
  },

  // Get current session
  getCurrentSession: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    return { session, error };
  },

  // Listen to auth changes
  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    return supabase.auth.onAuthStateChange(callback);
  },
};

// Database helper functions
// Helper functions to convert between database format and UI format
const convertTrackFromDB = (dbTrack: Track): Track => ({
  ...dbTrack,
  isMultitrack: dbTrack.is_multitrack,
  activeStep: dbTrack.active_step,
});

const convertTrackToDB = (uiTrack: any): any => {
  const dbTrack = { ...uiTrack };
  
  // Convert UI fields to database fields
  if (uiTrack.isMultitrack !== undefined) {
    dbTrack.is_multitrack = uiTrack.isMultitrack;
    delete dbTrack.isMultitrack;
  }
  
  if (uiTrack.activeStep !== undefined) {
    dbTrack.active_step = uiTrack.activeStep;
    delete dbTrack.activeStep;
  }
  
  return dbTrack;
};

export const db = {
  // Tracks
  tracks: {
    // Get all tracks for current user
    getAll: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .select('*')
        .eq('user_id', user.id)
        .order('modified', { ascending: false });

      // Convert database format to UI format
      const convertedData = data?.map(convertTrackFromDB) || null;

      return { data: convertedData, error };
    },

    // Get single track
    get: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      // Convert database format to UI format
      const convertedData = data ? convertTrackFromDB(data) : null;

      return { data: convertedData, error };
    },

    // Create track
    create: async (track: Omit<Track, 'user_id'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Convert UI format to database format
      const dbTrack = convertTrackToDB(track);

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .insert({ ...dbTrack, user_id: user.id })
        .select()
        .single();

      // Convert database format back to UI format
      const convertedData = data ? convertTrackFromDB(data) : null;

      return { data: convertedData, error };
    },

    // Update track
    update: async (id: string, updates: Partial<Omit<Track, 'id' | 'user_id'>>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Convert UI format to database format
      const dbUpdates = convertTrackToDB(updates);

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .update({ ...dbUpdates, modified: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      // Convert database format back to UI format
      const convertedData = data ? convertTrackFromDB(data) : null;

      return { data: convertedData, error };
    },

    // Delete track
    delete: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      return { data, error };
    },

    // Bulk insert tracks (for migration)
    bulkInsert: async (tracks: Omit<Track, 'user_id'>[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Convert UI format to database format
      const dbTracks = tracks.map(track => convertTrackToDB({ ...track, user_id: user.id }));

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .insert(dbTracks)
        .select();

      // Convert database format back to UI format
      const convertedData = data?.map(convertTrackFromDB) || null;

      return { data: convertedData, error };
    },
  },

  // Folders
  folders: {
    // Get all folders for current user
    getAll: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.FOLDERS)
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      return { data, error };
    },

    // Create folder
    create: async (folder: Omit<Folder, 'user_id'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.FOLDERS)
        .insert({ ...folder, user_id: user.id })
        .select()
        .single();

      return { data, error };
    },

    // Update folder
    update: async (id: string, updates: Partial<Omit<Folder, 'id' | 'user_id'>>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.FOLDERS)
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      return { data, error };
    },

    // Delete folder
    delete: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.FOLDERS)
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      return { data, error };
    },

    // Bulk insert folders (for migration)
    bulkInsert: async (folders: Omit<Folder, 'user_id'>[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const foldersWithUserId = folders.map(folder => ({ ...folder, user_id: user.id }));

      const { data, error } = await supabase
        .from(TABLES.FOLDERS)
        .insert(foldersWithUserId)
        .select();

      return { data, error };
    },
  },

  // User profiles
  profiles: {
    // Get current user profile
    get: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.PROFILES)
        .select('*')
        .eq('id', user.id)
        .single();

      return { data, error };
    },

    // Update user profile
    update: async (updates: Partial<Omit<UserProfile, 'id' | 'created_at'>>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from(TABLES.PROFILES)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .select()
        .single();

      return { data, error };
    },
  },
};

// Migration helpers
export const migration = {
  // Check if user has migrated
  hasMigrated: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from(TABLES.TRACKS)
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    return !error && data && data.length > 0;
  },

  // Migrate localStorage data to Supabase
  migrateFromLocalStorage: async () => {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage not available');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Get data from localStorage
    const tracksData = localStorage.getItem('strudel_tracks');
    const foldersData = localStorage.getItem('strudel_folders');

    const results = {
      tracks: { success: 0, errors: [] as any[] },
      folders: { success: 0, errors: [] as any[] },
    };

    // Migrate tracks
    if (tracksData) {
      try {
        const tracks = JSON.parse(tracksData);
        const trackArray = Object.values(tracks) as any[];

        if (trackArray.length > 0) {
          const { data, error } = await db.tracks.bulkInsert(trackArray);
          if (error) {
            results.tracks.errors.push(error);
          } else {
            results.tracks.success = data?.length || 0;
          }
        }
      } catch (error) {
        results.tracks.errors.push(error);
      }
    }

    // Migrate folders
    if (foldersData) {
      try {
        const folders = JSON.parse(foldersData);
        const folderArray = Object.values(folders) as any[];

        if (folderArray.length > 0) {
          const { data, error } = await db.folders.bulkInsert(folderArray);
          if (error) {
            results.folders.errors.push(error);
          } else {
            results.folders.success = data?.length || 0;
          }
        }
      } catch (error) {
        results.folders.errors.push(error);
      }
    }

    return results;
  },

  // Clear localStorage after successful migration
  clearLocalStorage: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('strudel_tracks');
      localStorage.removeItem('strudel_folders');
      localStorage.setItem('strudel_migrated_to_supabase', 'true');
    }
  },

  // Check if localStorage has been cleared
  isLocalStorageCleared: () => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('strudel_migrated_to_supabase') === 'true';
  },
};

export default supabase;
