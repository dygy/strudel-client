import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { FileSystemGraph, type FileSystemNode, type Track, type Folder, type TreeNode } from '../../../../lib/FileSystemGraph';
import { toastActions } from '@src/stores/toastStore';
import { useStableTranslation } from '@src/i18n/useStableTranslation';
import { nanoid } from 'nanoid';

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
  trackRouter?: any;
}

export function useGraphFileManager(context: ReplContext) {
  const { user, isAuthenticated, ensureValidSession } = useAuth();
  const { stable, t } = useStableTranslation('files', 'common', 'tabs', 'auth');
  
  // Graph state
  const [graph, setGraph] = useState<FileSystemGraph>(new FileSystemGraph());
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  // UI state
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newItemParentId, setNewItemParentId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  
  // Modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  
  // Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);

  // Load graph data from API
  const loadGraphFromAPI = useCallback(async () => {
    if (!isAuthenticated) return;
    
    setIsLoading(true);
    setSyncError(null);
    
    try {
      console.log('GraphFileManager - Loading graph structure from API');
      
      const response = await fetch('/api/filesystem/nodes', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to load graph structure');
      }

      console.log('GraphFileManager - Loaded graph nodes:', result.totalNodes);
      
      // Flatten the tree structure back to a list of nodes
      const flattenNodes = (nodes: any[]): FileSystemNode[] => {
        const flattened: FileSystemNode[] = [];
        
        const traverse = (nodeList: any[]) => {
          nodeList.forEach(node => {
            // Add the node itself (without children to avoid circular refs)
            const { children, ...nodeData } = node;
            flattened.push(nodeData);
            
            // Recursively add children
            if (children && children.length > 0) {
              traverse(children);
            }
          });
        };
        
        traverse(nodes);
        return flattened;
      };

      const nodes = flattenNodes(result.nodes);
      
      // Create new graph and build tree
      const newGraph = new FileSystemGraph(nodes);
      const newTreeNodes = newGraph.buildTree();
      
      setGraph(newGraph);
      setTreeNodes(newTreeNodes);
      setIsInitialized(true);
      
      console.log('GraphFileManager - Graph loaded successfully:', {
        totalNodes: nodes.length,
        treeNodes: newTreeNodes.length,
        stats: newGraph.getStats()
      });
      
    } catch (error) {
      console.error('GraphFileManager - Error loading graph:', error);
      setSyncError(error instanceof Error ? error.message : 'Failed to load graph');
      toastActions.error(stable.files.errors.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]); // Stable dependencies only

  // Initialize graph on authentication
  useEffect(() => {
    if (!isAuthenticated || !user) {
      console.log('GraphFileManager - User not authenticated, clearing graph');
      setGraph(new FileSystemGraph());
      setTreeNodes([]);
      setIsInitialized(false);
      return;
    }

    console.log('GraphFileManager - User authenticated, loading graph');
    loadGraphFromAPI();
  }, [isAuthenticated, user, loadGraphFromAPI]);

  // Create a new folder
  const createFolder = useCallback(async (name: string, parentId?: string): Promise<Folder | null> => {
    if (!isAuthenticated) return null;
    
    try {
      const newFolder: Folder = {
        id: nanoid(),
        name,
        type: 'folder',
        parentId: parentId || null,
        userId: user!.id,
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      };

      // Send to API first
      const response = await fetch('/api/filesystem/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: newFolder.id,
          name: newFolder.name,
          type: 'folder',
          parentId: newFolder.parentId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create folder');
      }

      // Add to local graph
      graph.addNode(newFolder);
      setTreeNodes(graph.buildTree());
      
      console.log('GraphFileManager - Created folder:', newFolder);
      toastActions.success(stable.files.success.folderCreated(name));
      
      return newFolder;
    } catch (error) {
      console.error('GraphFileManager - Error creating folder:', error);
      toastActions.error(stable.files.errors.createFolderFailed);
      return null;
    }
  }, [isAuthenticated, user, graph]); // Stable dependencies only

  // Create a new track
  const createTrack = useCallback(async (
    name: string, 
    code: string = '', 
    parentId?: string,
    isMultitrack: boolean = false,
    steps?: any[],
    activeStep: number = 0
  ): Promise<Track | null> => {
    if (!isAuthenticated) return null;
    
    try {
      const newTrack: Track = {
        id: nanoid(),
        name,
        type: 'track',
        parentId: parentId || null,
        userId: user!.id,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        code,
        isMultitrack,
        steps,
        activeStep
      };

      // Send to API first
      const response = await fetch('/api/filesystem/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: newTrack.id,
          name: newTrack.name,
          type: 'track',
          parentId: newTrack.parentId,
          code: newTrack.code,
          isMultitrack: newTrack.isMultitrack,
          steps: newTrack.steps,
          activeStep: newTrack.activeStep
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create track');
      }

      // Add to local graph
      graph.addNode(newTrack);
      setTreeNodes(graph.buildTree());
      
      console.log('GraphFileManager - Created track:', newTrack);
      toastActions.success(stable.files.success.trackCreated(name));
      
      return newTrack;
    } catch (error) {
      console.error('GraphFileManager - Error creating track:', error);
      toastActions.error(stable.files.errors.createTrackFailed);
      return null;
    }
  }, [isAuthenticated, user, graph]); // Stable dependencies only

  // Move a node to a new parent
  const moveNode = useCallback(async (nodeId: string, newParentId: string | null): Promise<boolean> => {
    if (!isAuthenticated) return false;
    
    try {
      // Send to API first
      const response = await fetch('/api/filesystem/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          nodeId,
          newParentId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to move node');
      }

      // Update local graph
      const success = graph.moveNode(nodeId, newParentId);
      
      if (success) {
        setTreeNodes(graph.buildTree());
        console.log('GraphFileManager - Moved node:', nodeId, 'to parent:', newParentId);
        toastActions.success(stable.files.success.itemMoved);
        return true;
      } else {
        toastActions.error(stable.files.errors.moveFailed);
        return false;
      }
    } catch (error) {
      console.error('GraphFileManager - Error moving node:', error);
      toastActions.error(stable.files.errors.moveFailed);
      return false;
    }
  }, [isAuthenticated, graph]); // Stable dependencies only

  // Delete a node
  const deleteNode = useCallback(async (nodeId: string): Promise<boolean> => {
    if (!isAuthenticated) return false;
    
    try {
      const node = graph.getNode(nodeId);
      if (!node) return false;
      
      // Send to API first
      const response = await fetch('/api/filesystem/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: nodeId })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete node');
      }

      // Update local graph
      graph.removeNode(nodeId);
      setTreeNodes(graph.buildTree());
      
      console.log('GraphFileManager - Deleted node:', nodeId);
      toastActions.success(stable.files.success.itemDeleted(node.name));
      
      return true;
    } catch (error) {
      console.error('GraphFileManager - Error deleting node:', error);
      toastActions.error(stable.files.errors.deleteFailed);
      return false;
    }
  }, [isAuthenticated, graph]); // Stable dependencies only

  // Load a track into the editor
  const loadTrack = useCallback((track: Track) => {
    console.log('GraphFileManager - Loading track:', track.name, track.id);
    setSelectedTrack(track.id);
    
    // Update editor with track code
    if (context.handleUpdate) {
      context.handleUpdate({ id: track.id, code: track.code }, true);
    }
  }, [context]);

  // Get track by ID
  const getTrack = useCallback((trackId: string): Track | null => {
    const node = graph.getNode(trackId);
    return (node && node.type === 'track') ? node as Track : null;
  }, [graph]);

  // Get folder by ID
  const getFolder = useCallback((folderId: string): Folder | null => {
    const node = graph.getNode(folderId);
    return (node && node.type === 'folder') ? node as Folder : null;
  }, [graph]);

  // Validate graph integrity
  const validateGraph = useCallback(() => {
    const validation = graph.validateHierarchy();
    
    if (!validation.isValid) {
      console.error('Graph validation failed:', validation.errors);
      setSyncError(`Graph integrity issues: ${validation.errors.join(', ')}`);
    }
    
    if (validation.warnings.length > 0) {
      console.warn('Graph validation warnings:', validation.warnings);
    }
    
    return validation;
  }, [graph]);

  // Convert to legacy format for backward compatibility
  const toLegacyFormat = useCallback(() => {
    const nodes = graph.getAllNodes();
    
    const tracks: Record<string, any> = {};
    const folders: Record<string, any> = {};
    
    nodes.forEach(node => {
      if (node.type === 'track') {
        tracks[node.id] = {
          id: node.id,
          name: node.name,
          code: node.code || '',
          created: node.created,
          modified: node.modified,
          folder: node.parentId ? graph.getPath(node.parentId) : null,
          isMultitrack: node.isMultitrack || false,
          steps: node.steps,
          activeStep: node.activeStep || 0
        };
      } else if (node.type === 'folder') {
        folders[node.id] = {
          id: node.id,
          name: node.name,
          path: graph.getPath(node.id),
          parent: node.parentId ? graph.getPath(node.parentId) : null,
          created: node.created
        };
      }
    });
    
    return { tracks, folders };
  }, [graph]);

  return {
    // Graph state
    graph,
    treeNodes,
    isInitialized,
    isLoading,
    syncError,
    
    // UI state
    selectedTrack,
    isCreating,
    isCreatingFolder,
    newTrackName,
    newFolderName,
    newItemParentId,
    saveStatus,
    showDeleteModal,
    nodeToDelete,
    showDeleteAllModal,
    isDragOver,
    
    // Setters
    setSelectedTrack,
    setIsCreating,
    setIsCreatingFolder,
    setNewTrackName,
    setNewFolderName,
    setNewItemParentId,
    setShowDeleteModal,
    setNodeToDelete,
    setShowDeleteAllModal,
    setIsDragOver,
    
    // Operations
    createFolder,
    createTrack,
    moveNode,
    deleteNode,
    loadTrack,
    getTrack,
    getFolder,
    validateGraph,
    loadGraphFromAPI,
    toLegacyFormat,
    
    // Graph utilities
    getStats: () => graph.getStats(),
    findByName: (name: string, type?: 'folder' | 'track') => graph.findByName(name, type),
    getPath: (nodeId: string) => graph.getPath(nodeId),
    getChildren: (nodeId: string) => graph.getChildren(nodeId),
    getParent: (nodeId: string) => graph.getParent(nodeId),
    
    // Authentication
    isAuthenticated
  };
}