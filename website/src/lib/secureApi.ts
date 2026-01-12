/**
 * Secure API client that uses server-side API routes instead of direct Supabase calls
 * This ensures API keys are never exposed to the frontend
 */

import { ensureValidSession } from './authUtils';

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
    
    const url = `${this.baseUrl}/api${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      credentials: 'include', // Include cookies for authentication
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      
      // If it's an auth error, try to refresh session and retry once
      if (response.status === 401 && !options.headers?.['X-Retry-After-Refresh']) {
        console.log('Got 401, attempting session refresh and retry...');
        
        const retrySessionResult = await ensureValidSession();
        if (retrySessionResult.success) {
          // Retry the request once with a flag to prevent infinite loops
          return this.request(endpoint, {
            ...options,
            headers: {
              ...options.headers,
              'X-Retry-After-Refresh': 'true'
            }
          });
        }
      }
      
      throw new Error(errorData.error || `HTTP ${response.status}`);
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
              folder: parentPath
            });
          } else if (item.type === 'folder') {
            const folderPath = item.path || item.name;
            folders.push({
              ...item,
              path: folderPath,
              parent: parentPath
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

  async updateTrack(trackId: string, updates: Partial<Track>): Promise<{ track: Track }> {
    return this.request('/tracks/update', {
      method: 'PUT',
      body: JSON.stringify({ trackId, updates }),
    });
  }

  async deleteTrack(trackId: string): Promise<{ success: boolean }> {
    return this.request('/tracks/delete', {
      method: 'DELETE',
      body: JSON.stringify({ trackId }),
    });
  }

  async deleteAllTracks(): Promise<{ success: boolean }> {
    return this.request('/tracks/delete-all', {
      method: 'DELETE',
    });
  }

  // Folders
  async getFolders(): Promise<{ folders: Folder[] }> {
    return this.request('/folders/list');
  }

  async createFolder(data: {
    name: string;
    path: string;
  }): Promise<{ folder: Folder }> {
    return this.request('/folders/create', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createFolders(folders: Array<{ name: string; path: string }>): Promise<{ folders: Folder[] }> {
    return this.request('/folders/bulk-create', {
      method: 'POST',
      body: JSON.stringify({ folders }),
    });
  }

  async deleteAllFolders(): Promise<{ success: boolean }> {
    return this.request('/folders/delete-all', {
      method: 'DELETE',
    });
  }

  // Migration
  async checkMigrationStatus(): Promise<{ hasMigrated: boolean }> {
    return this.request('/migration/status');
  }

  async performMigration(): Promise<{ success: boolean; message: string }> {
    return this.request('/migration/migrate', {
      method: 'POST',
    });
  }

  // Batch operations
  async batchImportLibrary(data: { tracks: any[], folders: any[] }): Promise<{ 
    success: boolean, 
    results: { 
      tracksCreated: number, 
      foldersCreated: number, 
      totalCreated: number, 
      errors: string[] 
    } 
  }> {
    return this.request('/library/batch-import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Database setup
  async setupDatabase(): Promise<{ success: boolean; message: string }> {
    return this.request('/database/migrate', {
      method: 'POST',
    });
  }

  // Tree API - File system operations
  async getTreeNodes(parentId?: string | null): Promise<{ success: boolean; nodes: any[] }> {
    const params = new URLSearchParams();
    if (parentId !== undefined) {
      params.set('parent', parentId === null ? 'null' : parentId);
    }
    return this.request(`/tree/nodes?${params.toString()}`);
  }

  async createTreeNode(data: {
    name: string;
    type: 'folder' | 'track';
    parentId?: string | null;
    code?: string;
    isMultitrack?: boolean;
    steps?: any;
    activeStep?: number;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; node: any }> {
    return this.request('/tree/nodes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTreeNode(nodeId: string, updates: {
    name?: string;
    parentId?: string | null;
    code?: string;
    isMultitrack?: boolean;
    steps?: any;
    activeStep?: number;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; node: any }> {
    return this.request('/tree/nodes', {
      method: 'PUT',
      body: JSON.stringify({ nodeId, ...updates }),
    });
  }

  async deleteTreeNode(nodeId: string, cascade: boolean = true): Promise<{ success: boolean; message: string }> {
    return this.request('/tree/nodes', {
      method: 'DELETE',
      body: JSON.stringify({ nodeId, cascade }),
    });
  }

  async moveTreeNode(nodeId: string, newParentId: string | null): Promise<{ success: boolean; node: any; message: string }> {
    return this.request('/tree/move', {
      method: 'POST',
      body: JSON.stringify({ nodeId, newParentId }),
    });
  }

  async searchTreeNodes(query: {
    term?: string;
    type?: 'folder' | 'track';
    parentId?: string | null;
    tags?: string[];
    pattern?: string;
    maxDepth?: number;
    includeMetadata?: boolean;
  }): Promise<{ success: boolean; result: any }> {
    const params = new URLSearchParams();
    if (query.term) params.set('term', query.term);
    if (query.type) params.set('type', query.type);
    if (query.parentId !== undefined) params.set('parentId', query.parentId === null ? 'null' : query.parentId);
    if (query.tags) params.set('tags', query.tags.join(','));
    if (query.pattern) params.set('pattern', query.pattern);
    if (query.maxDepth) params.set('maxDepth', query.maxDepth.toString());
    if (query.includeMetadata) params.set('includeMetadata', 'true');
    
    return this.request(`/tree/search?${params.toString()}`);
  }

  async getTreeStats(nodeId?: string): Promise<{ success: boolean; treeStats?: any; nodeStats?: any }> {
    const params = new URLSearchParams();
    if (nodeId) params.set('nodeId', nodeId);
    return this.request(`/tree/stats?${params.toString()}`);
  }

  async validateTree(): Promise<{ success: boolean; validation: any }> {
    return this.request('/tree/validate');
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
    update: async (id: string, updates: Partial<Track>) => {
      try {
        const result = await secureApi.updateTrack(id, updates);
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
    }
  },
  folders: {
    getAll: async () => {
      const result = await secureApi.getFolders();
      return { data: result.folders, error: null };
    },
    create: async (folder: { name: string; path: string }) => {
      try {
        const result = await secureApi.createFolder(folder);
        return { data: result.folder, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    bulkCreate: async (folders: Array<{ name: string; path: string }>) => {
      try {
        const result = await secureApi.createFolders(folders);
        return { data: result.folders, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    deleteAll: async () => {
      try {
        await secureApi.deleteAllFolders();
        return { error: null };
      } catch (error) {
        return { error };
      }
    }
  }
};

// Batch operations helper
export const batch = {
  importLibrary: async (data: { tracks: any[], folders: any[] }) => {
    try {
      const result = await secureApi.batchImportLibrary(data);
      return { data: result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
};

// Migration helper
export const migration = {
  hasMigrated: async () => {
    try {
      const result = await secureApi.checkMigrationStatus();
      return result.hasMigrated;
    } catch (error) {
      console.error('Error checking migration status:', error);
      return false;
    }
  },
  migrate: async () => {
    try {
      const result = await secureApi.performMigration();
      return result;
    } catch (error) {
      console.error('Error performing migration:', error);
      return { success: false, message: 'Migration failed' };
    }
  }
};