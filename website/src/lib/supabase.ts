import { createClient } from '@supabase/supabase-js';

// Supabase configuration from environment variables
// Use placeholder values only if environment variables are not available (for local development)
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Only create client if we have real values (not placeholders)
const hasRealConfig = supabaseUrl !== 'https://placeholder.supabase.co' && supabaseAnonKey !== 'placeholder-key';

// Create Supabase client with proper OAuth configuration
// Use placeholder values during build if environment variables are not available
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: hasRealConfig,
    persistSession: hasRealConfig, // Only persist sessions if we have real config
    detectSessionInUrl: hasRealConfig, // Only detect sessions if we have real config
    flowType: 'pkce', // Use PKCE flow for security
  },
});

// Use standard Supabase auth - no custom overrides needed
export const auth = supabase.auth;

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
  migrated_from_localstorage?: boolean; // Track if user has migrated from localStorage
}

// Database table names
export const TABLES = {
  TRACKS: 'tracks',
  FOLDERS: 'folders',
  PROFILES: 'profiles',
} as const;

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
      // First check session and refresh if needed
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (session?.expires_at && Date.now() / 1000 > session.expires_at) {
        console.log('db.tracks.getAll - Session expired, attempting refresh...');
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          console.error('db.tracks.getAll - Failed to refresh session:', refreshError);
        }
      }
      
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (!user) {
        console.error('db.tracks.getAll - No authenticated user found');
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase
        .from(TABLES.TRACKS)
        .select('*')
        .eq('user_id', user.id)
        .order('modified', { ascending: false });

      if (error) {
        console.error('db.tracks.getAll - Database error:', error);
      }

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
        .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows

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
        .maybeSingle(); // Use maybeSingle() instead of single()

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
        .maybeSingle(); // Use maybeSingle() instead of single()

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
        .maybeSingle(); // Use maybeSingle() instead of single()

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
        .maybeSingle(); // Use maybeSingle() instead of single()

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
        .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows

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
        .maybeSingle(); // Use maybeSingle() instead of single()

      return { data, error };
    },
  },
};

// Migration helpers
export const migration = {
  // Check if user has migrated from localStorage
  hasMigrated: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Check if user has any tracks (indicates migration has happened)
    const { data: tracks, error: tracksError } = await supabase
      .from(TABLES.TRACKS)
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (tracksError) {
      console.error('Error checking for migrated tracks:', tracksError);
      return false;
    }

    // Also check the profile migration flag
    const { data: profile, error: profileError } = await supabase
      .from(TABLES.PROFILES)
      .select('migrated_from_localstorage')
      .eq('id', user.id)
      .maybeSingle(); // Use maybeSingle() instead of single()

    if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking profile migration flag:', profileError);
    }

    // User has migrated if they have tracks OR the migration flag is set
    const hasTracks = tracks && tracks.length > 0;
    const migrationFlagSet = profile?.migrated_from_localstorage === true;
    
    return hasTracks || migrationFlagSet;
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

    // Set migration flag in user profile
    try {
      await db.profiles.update({
        migrated_from_localstorage: true,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error setting migration flag:', error);
      // Don't fail the migration if we can't set the flag
    }

    return results;
  },

  // Clear localStorage after successful migration
  clearLocalStorage: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('strudel_tracks');
      localStorage.removeItem('strudel_folders');
      // Don't set a localStorage flag - we use Supabase profile flag instead
    }
  },

  // Check if localStorage has been cleared (deprecated - use hasMigrated instead)
  isLocalStorageCleared: () => {
    // Always return true since we don't use localStorage flags anymore
    // Migration status is tracked in Supabase profile
    return true;
  },
};

export default supabase;
