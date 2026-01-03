/**
 * TreeDataTransformer
 * Transforms flat track/folder data into hierarchical tree structure
 */

export interface FlatTrack {
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

export interface FlatFolder {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  created: string;
  user_id: string;
}

export interface TreeItem {
  id: string;
  name: string;
  type: 'folder' | 'track';
  created: string;
  modified?: string;
  children?: TreeItem[];
  
  // Track-specific properties
  code?: string;
  isMultitrack?: boolean;
  steps?: any[];
  activeStep?: number;
  
  // Folder-specific properties
  path?: string;
  
  // Common properties
  user_id: string;
}

export interface TreeStructure {
  root: TreeItem;
}

export class TreeDataTransformer {
  /**
   * Transform flat tracks and folders into hierarchical tree structure
   * Uses UUID-only identification for folders to prevent duplicate key issues
   */
  static transformToTree(tracks: FlatTrack[], folders: FlatFolder[]): TreeStructure {
    // Create root node - this is what gets returned by the API
    const root: TreeItem = {
      id: 'root',
      name: 'root',
      type: 'folder',
      created: new Date().toISOString(),
      children: [],
      user_id: tracks[0]?.user_id || folders[0]?.user_id || ''
    };

    // Create a map for quick folder lookup - USE ONLY UUIDs
    const folderMap = new Map<string, TreeItem>();
    
    // Add root to folder map
    folderMap.set('root', root);

    // Convert folders to tree items first
    const folderItems: TreeItem[] = folders.map(folder => ({
      id: folder.id,
      name: folder.name,
      type: 'folder' as const,
      created: folder.created,
      path: folder.path,
      children: [],
      user_id: folder.user_id
    }));

    // SANITIZATION: Fix folders with duplicate paths by recalculating paths based on parent hierarchy
    const sanitizeFolderPaths = (folders: FlatFolder[]): FlatFolder[] => {
      console.log('TreeDataTransformer - Starting path sanitization for', folders.length, 'folders');
      console.log('TreeDataTransformer - Input folders:', folders.map(f => ({ id: f.id, name: f.name, path: f.path, parent: f.parent })));
      
      const pathCounts = new Map<string, number>();
      const sanitizedFolders: FlatFolder[] = [];
      
      // Count path occurrences
      folders.forEach(folder => {
        pathCounts.set(folder.path, (pathCounts.get(folder.path) || 0) + 1);
      });
      
      console.log('TreeDataTransformer - Path counts:', Array.from(pathCounts.entries()));
      
      // Fix duplicate paths
      folders.forEach(folder => {
        if (pathCounts.get(folder.path)! > 1) {
          // This path is duplicated, recalculate based on parent
          let correctPath = folder.name;
          
          if (folder.parent && folder.parent !== 'root' && folder.parent !== '') {
            const parentFolder = folders.find(f => f.id === folder.parent);
            if (parentFolder) {
              correctPath = `${parentFolder.path}/${folder.name}`;
            }
          }
          
          console.warn(`TreeDataTransformer - Fixed duplicate path: "${folder.path}" -> "${correctPath}" for folder "${folder.name}" (ID: ${folder.id})`);
          
          sanitizedFolders.push({
            ...folder,
            path: correctPath
          });
        } else {
          sanitizedFolders.push(folder);
        }
      });
      
      console.log('TreeDataTransformer - Sanitized folders:', sanitizedFolders.map(f => ({ id: f.id, name: f.name, path: f.path, parent: f.parent })));
      return sanitizedFolders;
    };
    
    // Apply sanitization
    const sanitizedFolders = sanitizeFolderPaths(folders);
    
    // Update folderItems with sanitized paths
    const sanitizedFolderItems: TreeItem[] = sanitizedFolders.map(folder => ({
      id: folder.id,
      name: folder.name,
      type: 'folder' as const,
      created: folder.created,
      path: folder.path,
      children: [],
      user_id: folder.user_id
    }));

    // Add folders to the map using ONLY their UUIDs
    sanitizedFolderItems.forEach(folder => {
      folderMap.set(folder.id, folder);
    });

    // Build folder hierarchy using UUIDs only
    // Process folders in dependency order: parents first, then children
    const processedFolders = new Set<string>();
    
    const processFolderHierarchy = (folderId: string) => {
      if (processedFolders.has(folderId)) return;
      
      const folder = sanitizedFolderItems.find(f => f.id === folderId);
      const originalFolder = sanitizedFolders.find(f => f.id === folderId);
      
      if (!folder || !originalFolder) return;
      
      // Process parent first if it exists and hasn't been processed
      if (originalFolder.parent && 
          originalFolder.parent !== 'root' && 
          originalFolder.parent !== '' && 
          !processedFolders.has(originalFolder.parent)) {
        processFolderHierarchy(originalFolder.parent);
      }
      
      // Now process this folder
      let parentFolder: TreeItem;
      
      if (!originalFolder.parent || originalFolder.parent === 'root' || originalFolder.parent === '') {
        // This folder belongs to root
        parentFolder = root;
        console.log(`TreeDataTransformer - Placing folder "${folder.name}" (${folder.id}) in root`);
      } else {
        // Find parent folder by UUID only
        parentFolder = folderMap.get(originalFolder.parent) || root;
        
        if (!folderMap.has(originalFolder.parent)) {
          console.warn(`TreeDataTransformer - Parent folder UUID not found: ${originalFolder.parent}, placing "${folder.name}" in root`);
        } else {
          console.log(`TreeDataTransformer - Placing folder "${folder.name}" (${folder.id}) under parent "${parentFolder.name}" (${originalFolder.parent})`);
        }
      }

      if (!parentFolder.children) {
        parentFolder.children = [];
      }
      
      parentFolder.children.push(folder);
      processedFolders.add(folderId);
    };
    
    // Process all folders
    sanitizedFolderItems.forEach(folder => {
      processFolderHierarchy(folder.id);
    });

    // Convert tracks to tree items and place them in appropriate folders
    const trackItems: TreeItem[] = tracks.map(track => ({
      id: track.id,
      name: track.name,
      type: 'track' as const,
      created: track.created,
      modified: track.modified,
      code: track.code,
      isMultitrack: track.isMultitrack,
      steps: track.steps,
      activeStep: track.activeStep,
      user_id: track.user_id
    }));

    // Place tracks in their folders - try UUID first, then path as fallback
    trackItems.forEach(track => {
      const originalTrack = tracks.find(t => t.id === track.id);
      if (!originalTrack) return;

      let parentFolder: TreeItem;

      if (!originalTrack.folder || originalTrack.folder === 'root' || originalTrack.folder === '') {
        // Track belongs to root
        parentFolder = root;
        console.log(`TreeDataTransformer - Placing track "${track.name}" (${track.id}) in root`);
      } else {
        // Try to find parent folder by UUID first
        parentFolder = folderMap.get(originalTrack.folder);
        
        if (!parentFolder) {
          // Fallback: try to find by path (for backward compatibility)
          parentFolder = folderItems.find(f => f.path === originalTrack.folder) || root;
          
          if (parentFolder === root) {
            console.warn(`TreeDataTransformer - Folder not found for track "${track.name}", folder reference: "${originalTrack.folder}", placing in root`);
          } else {
            console.log(`TreeDataTransformer - Found folder by path for track "${track.name}": "${parentFolder.name}"`);
          }
        } else {
          console.log(`TreeDataTransformer - Placing track "${track.name}" (${track.id}) under folder "${parentFolder.name}" (${originalTrack.folder})`);
        }
      }

      if (!parentFolder.children) {
        parentFolder.children = [];
      }
      
      parentFolder.children.push(track);
    });

    // Sort children in each folder (folders first, then tracks, both alphabetically)
    this.sortTreeChildren(root);

    // Debug: Log final tree structure
    console.log('TreeDataTransformer - Final tree structure:');
    console.log(`Root has ${root.children?.length || 0} direct children`);
    root.children?.forEach(child => {
      if (child.type === 'folder') {
        console.log(`  📁 ${child.name} (${child.id}) - ${child.children?.length || 0} children`);
        child.children?.forEach(grandchild => {
          console.log(`    ${grandchild.type === 'folder' ? '📁' : '📄'} ${grandchild.name} (${grandchild.id})`);
        });
      } else {
        console.log(`  📄 ${child.name} (${child.id})`);
      }
    });

    return { root };
  }

  /**
   * Recursively sort children in tree structure
   */
  private static sortTreeChildren(item: TreeItem): void {
    if (!item.children || item.children.length === 0) return;

    // Sort: folders first, then tracks, both alphabetically
    item.children.sort((a, b) => {
      // Folders come before tracks
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      
      // Within same type, sort alphabetically
      return a.name.localeCompare(b.name);
    });

    // Recursively sort children of folders
    item.children.forEach(child => {
      if (child.type === 'folder') {
        this.sortTreeChildren(child);
      }
    });
  }

  /**
   * Get all items at root level (direct children of root)
   */
  static getRootItems(tree: TreeStructure): TreeItem[] {
    return tree.root.children || [];
  }

  /**
   * Find an item by ID in the tree
   */
  static findItemById(tree: TreeStructure, id: string): TreeItem | null {
    return this.findItemByIdRecursive(tree.root, id);
  }

  private static findItemByIdRecursive(item: TreeItem, id: string): TreeItem | null {
    if (item.id === id) return item;
    
    if (item.children) {
      for (const child of item.children) {
        const found = this.findItemByIdRecursive(child, id);
        if (found) return found;
      }
    }
    
    return null;
  }

  /**
   * Get the path to an item (array of parent names)
   */
  static getItemPath(tree: TreeStructure, id: string): string[] {
    const path: string[] = [];
    this.getItemPathRecursive(tree.root, id, path);
    return path.slice(1); // Remove 'Root' from path
  }

  private static getItemPathRecursive(item: TreeItem, targetId: string, currentPath: string[]): boolean {
    currentPath.push(item.name);
    
    if (item.id === targetId) {
      return true;
    }
    
    if (item.children) {
      for (const child of item.children) {
        if (this.getItemPathRecursive(child, targetId, currentPath)) {
          return true;
        }
      }
    }
    
    currentPath.pop();
    return false;
  }

  /**
   * Get all tracks in the tree (flattened)
   */
  static getAllTracks(tree: TreeStructure): TreeItem[] {
    const tracks: TreeItem[] = [];
    this.collectTracksRecursive(tree.root, tracks);
    return tracks;
  }

  private static collectTracksRecursive(item: TreeItem, tracks: TreeItem[]): void {
    if (item.type === 'track') {
      tracks.push(item);
    }
    
    if (item.children) {
      item.children.forEach(child => {
        this.collectTracksRecursive(child, tracks);
      });
    }
  }

  /**
   * Get all folders in the tree (flattened)
   */
  static getAllFolders(tree: TreeStructure): TreeItem[] {
    const folders: TreeItem[] = [];
    this.collectFoldersRecursive(tree.root, folders);
    return folders.filter(f => f.id !== 'root'); // Exclude root
  }

  private static collectFoldersRecursive(item: TreeItem, folders: TreeItem[]): void {
    if (item.type === 'folder') {
      folders.push(item);
    }
    
    if (item.children) {
      item.children.forEach(child => {
        this.collectFoldersRecursive(child, folders);
      });
    }
  }

  /**
   * Get tree statistics
   */
  static getTreeStats(tree: TreeStructure): {
    totalTracks: number;
    totalFolders: number;
    maxDepth: number;
    totalItems: number;
  } {
    const tracks = this.getAllTracks(tree);
    const folders = this.getAllFolders(tree);
    const maxDepth = this.getMaxDepth(tree.root, 0);
    
    return {
      totalTracks: tracks.length,
      totalFolders: folders.length,
      maxDepth,
      totalItems: tracks.length + folders.length
    };
  }

  private static getMaxDepth(item: TreeItem, currentDepth: number): number {
    if (!item.children || item.children.length === 0) {
      return currentDepth;
    }
    
    let maxChildDepth = currentDepth;
    item.children.forEach(child => {
      const childDepth = this.getMaxDepth(child, currentDepth + 1);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    });
    
    return maxChildDepth;
  }

  /**
   * Convert tree back to flat structure (for compatibility)
   */
  static treeToFlat(tree: TreeStructure): { tracks: FlatTrack[], folders: FlatFolder[] } {
    const tracks: FlatTrack[] = [];
    const folders: FlatFolder[] = [];
    
    this.treeToFlatRecursive(tree.root, tracks, folders, null);
    
    return { tracks, folders };
  }

  private static treeToFlatRecursive(
    item: TreeItem, 
    tracks: FlatTrack[], 
    folders: FlatFolder[], 
    parentPath: string | null
  ): void {
    if (item.id === 'root') {
      // Skip root, process its children
      if (item.children) {
        item.children.forEach(child => {
          this.treeToFlatRecursive(child, tracks, folders, null);
        });
      }
      return;
    }

    if (item.type === 'folder') {
      folders.push({
        id: item.id,
        name: item.name,
        path: item.path || item.name,
        parent: parentPath,
        created: item.created,
        user_id: item.user_id
      });
      
      // Process children
      if (item.children) {
        item.children.forEach(child => {
          this.treeToFlatRecursive(child, tracks, folders, item.path || item.name);
        });
      }
    } else if (item.type === 'track') {
      tracks.push({
        id: item.id,
        name: item.name,
        code: item.code || '',
        created: item.created,
        modified: item.modified || item.created,
        folder: parentPath,
        isMultitrack: item.isMultitrack || false,
        steps: item.steps || [],
        activeStep: item.activeStep || 0,
        user_id: item.user_id
      });
    }
  }
}