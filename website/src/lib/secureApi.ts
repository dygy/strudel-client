/**
 * Secure API client that uses server-side API routes instead of direct Supabase calls
 * This ensures API keys are never exposed to the frontend
 */

import { ensureValidSession } from './authUtils';
import { sameContent, serverTrackFromRow, trackVersions, VersionConflictError } from '../repl/trackVersion';

export interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder: string | null;
  isMultitrack: boolean;
  steps: any[];
  activeStep: number;
  user_id: string;
  /** The row's updated_at: what a save names as the version it read (spec 018). */
  version?: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  created: string;
  user_id: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  /** From /api/auth/user (app_metadata.role); for showing the admin link only. */
  isAdmin?: boolean;
  user_metadata?: {
    full_name?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    avatar_url?: string;
    picture?: string;
    [key: string]: any;
  };
}

/** A refused request. The message is what callers always got; status and body are for those who ask. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class SecureApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    // Ensure we have a valid session before making the request
    const sessionResult = await ensureValidSession();
    if (!sessionResult.success) {
      throw new Error(`Authentication failed: ${sessionResult.error}`);
    }

    // Get the access token from the session to include in headers
    const accessToken = sessionResult.session?.access_token;
    if (!accessToken) {
      throw new Error('No access token found');
    }

    const url = `${this.baseUrl}/api${endpoint}`;

    const response = await fetch(url, {
      ...options,
      credentials: 'include', // Include cookies for authentication
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`, // Include access token in header
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));

      // If it's an auth error, try to refresh session and retry once
      if (response.status === 401 && !options.headers?.['X-Retry-After-Refresh']) {
        console.log('Got 401, attempting session refresh and retry...');

        const retrySessionResult = await ensureValidSession();
        if (retrySessionResult.success && retrySessionResult.session?.access_token) {
          // Wait a moment for cookies to update
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Retry the request once with a flag to prevent infinite loops
          return this.request(endpoint, {
            ...options,
            headers: {
              ...options.headers,
              'X-Retry-After-Refresh': 'true',
            },
          });
        } else {
          console.error('Session refresh failed or no access token after refresh');
          throw new Error('Session refresh failed');
        }
      }

      throw new ApiError(errorData.error || `HTTP ${response.status}`, response.status, errorData);
    }

    return response.json();
  }

  // Authentication
  async getUser(): Promise<{ user: User | null; session: any }> {
    return this.request('/auth/user');
  }

  // Tracks
  async getTracks(): Promise<{ tracks: Track[]; folders: Folder[] }> {
    // API now returns hierarchical format, convert to flat for compatibility
    const hierarchicalData = await this.request('/tracks/list');

    // Convert hierarchical data to flat format
    if (hierarchicalData && hierarchicalData.id === 'root' && hierarchicalData.children) {
      const tracks: Track[] = [];
      const folders: Folder[] = [];

      const processItems = (items: any[], parentPath: string | null = null) => {
        for (const item of items) {
          if (item.type === 'track') {
            tracks.push({
              ...item,
              folder: parentPath,
            });
          } else if (item.type === 'folder') {
            const folderPath = item.path || item.name;
            folders.push({
              ...item,
              path: folderPath,
              parent: parentPath,
            });

            if (item.children && item.children.length > 0) {
              processItems(item.children, folderPath);
            }
          }
        }
      };

      processItems(hierarchicalData.children);
      return { tracks, folders };
    }

    // Fallback for empty or invalid data
    return { tracks: [], folders: [] };
  }

  async createTrack(data: {
    name: string;
    code?: string;
    folder?: string | null;
    isMultitrack?: boolean;
    steps?: any[];
    activeStep?: number;
  }): Promise<{ track: Track }> {
    return this.request('/tracks/create', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  private sendTrackUpdate(trackId: string, updates: Partial<Track>, expectedVersion?: string) {
    return this.request('/tracks/update', {
      method: 'PUT',
      body: JSON.stringify({ trackId, updates, ...(expectedVersion ? { expectedVersion } : {}) }),
    });
  }

  /**
   * Every save goes through here (spec 018, tech 2.6). It names the version this tab last synced
   * with, so it can't overwrite a change made elsewhere, and moves that baseline to the version the
   * server returns. Raises VersionConflictError when the server holds different content, and an
   * ApiError with status 404 when the track is gone.
   *
   * `force` is for a user's explicit overwrite (import): no version check, and the baseline stays,
   * so an open tab still finds out that its copy is out of date.
   */
  async updateTrack(
    trackId: string,
    updates: Partial<Track>,
    { force = false }: { force?: boolean } = {},
  ): Promise<{ track: Track }> {
    if (force) {
      return trackVersions.serialize(trackId, () => this.sendTrackUpdate(trackId, updates));
    }
    return trackVersions.serialize(trackId, async () => {
      if (trackVersions.isPaused(trackId)) throw new VersionConflictError(trackId, null);

      // At most one retry: after a conflict that turned out to change no content.
      for (let attempt = 0; ; attempt++) {
        const baseline = trackVersions.get(trackId);
        try {
          const result = await this.sendTrackUpdate(trackId, updates, baseline?.version);
          const saved = serverTrackFromRow(result.track);
          if (saved) trackVersions.set(trackId, saved);
          else trackVersions.forget(trackId);
          return result;
        } catch (error: unknown) {
          if (!(error instanceof ApiError) || error.status !== 409 || error.data.code !== 'version_conflict') {
            throw error;
          }
          const current = serverTrackFromRow(error.data.current);
          if (!current) throw new VersionConflictError(trackId, null);
          // The server already holds exactly what this save is writing (an earlier attempt landed
          // and its answer was lost): nothing can be overwritten and nothing is left to do.
          const merged = { code: updates.code ?? current.code, steps: updates.steps ?? current.steps };
          if (sameContent(merged, current)) {
            trackVersions.set(trackId, current);
            return { track: error.data.current as Track };
          }
          // Only the version moved (a folder move or a rename): save again on top of it.
          if (attempt === 0 && baseline && sameContent(baseline, current)) {
            trackVersions.set(trackId, current);
            continue;
          }
          throw new VersionConflictError(trackId, current);
        }
      }
    });
  }

  async deleteTrack(trackId: string): Promise<{ success: boolean }> {
    return trackVersions.serialize(trackId, async () => {
      const result = await this.request('/tracks/delete', {
        method: 'DELETE',
        body: JSON.stringify({ trackId }),
      });
      trackVersions.forget(trackId);
      return result;
    });
  }

  async deleteAllTracks(): Promise<{ success: boolean }> {
    return trackVersions.bulk(() =>
      this.request('/tracks/delete-all', {
        method: 'DELETE',
      }),
    );
  }

  // Folders
  async getFolders(): Promise<{ folders: Folder[] }> {
    return this.request('/folders/list');
  }

  async deleteAllFolders(): Promise<{ success: boolean }> {
    return this.request('/folders/delete-all', {
      method: 'DELETE',
    });
  }

  // Batch operations
  async batchImportLibrary(data: { tracks: any[]; folders: any[] }): Promise<{
    success: boolean;
    results: {
      tracksCreated: number;
      foldersCreated: number;
      totalCreated: number;
      errors: string[];
    };
  }> {
    return this.request('/library/batch-import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

// Export singleton instance
export const secureApi = new SecureApiClient();

// Legacy compatibility - create a db-like interface
export const db = {
  tracks: {
    getAll: async () => {
      const result = await secureApi.getTracks();
      // Return both tracks and folders since /tracks/list provides both
      return { data: { tracks: result.tracks, folders: result.folders }, error: null };
    },
    create: async (track: Omit<Track, 'id' | 'created' | 'modified' | 'user_id'>) => {
      try {
        const result = await secureApi.createTrack(track);
        return { data: result.track, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    update: async (id: string, updates: Partial<Track>, options?: { force?: boolean }) => {
      try {
        const result = await secureApi.updateTrack(id, updates, options);
        return { data: result.track, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    delete: async (id: string) => {
      try {
        await secureApi.deleteTrack(id);
        return { error: null };
      } catch (error) {
        return { error };
      }
    },
    deleteAll: async () => {
      try {
        await secureApi.deleteAllTracks();
        return { error: null };
      } catch (error) {
        return { error };
      }
    },
  },
  folders: {
    getAll: async () => {
      const result = await secureApi.getFolders();
      return { data: result.folders, error: null };
    },
    deleteAll: async () => {
      try {
        await secureApi.deleteAllFolders();
        return { error: null };
      } catch (error) {
        return { error };
      }
    },
  },
};

// Batch operations helper
export const batch = {
  importLibrary: async (data: { tracks: any[]; folders: any[] }) => {
    try {
      const result = await secureApi.batchImportLibrary(data);
      return { data: result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
