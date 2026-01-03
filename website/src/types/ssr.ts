/**
 * SSR Data Types
 * Shared types for server-side rendered data
 */

export interface SSRTrack {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string | null;
  isMultitrack?: boolean;
  steps?: SSRTrackStep[];
  activeStep?: number;
  user_id: string;
}

export interface SSRTrackStep {
  id: string;
  name: string;
  code: string;
  active?: boolean;
}

export interface SSRFolder {
  id: string;
  name: string;
  path: string;
  parent?: string | null;
  created: string;
  user_id: string;
}

export interface SSRData {
  tracks: SSRTrack[];
  folders: SSRFolder[];
}

// Hierarchical tree structure returned by /api/tracks/list
export interface TreeItem {
  id: string;
  name: string;
  type: 'folder' | 'track';
  created: string;
  modified?: string;
  user_id: string;
  // Track-specific fields
  code?: string;
  isMultitrack?: boolean;
  steps?: SSRTrackStep[];
  activeStep?: number;
  folder?: string | null;
  // Folder-specific fields
  path?: string;
  parent?: string | null;
  // Tree structure
  children?: TreeItem[];
}

export interface TreeResponse {
  id: 'root';
  children: TreeItem[];
}