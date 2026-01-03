/**
 * useHierarchicalFileTree Hook
 * Provides hierarchical tree structure from flat track/folder data
 */

import { useMemo } from 'react';
import { TreeDataTransformer, type TreeStructure, type TreeItem } from '../../../../lib/TreeDataTransformer';

interface Track {
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

interface Folder {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  created: string;
  user_id: string;
}

interface UseHierarchicalFileTreeProps {
  tracks: Record<string, Track>;
  folders: Record<string, Folder>;
}

interface UseHierarchicalFileTreeReturn {
  tree: TreeStructure;
  rootItems: TreeItem[];
  findItemById: (id: string) => TreeItem | null;
  getItemPath: (id: string) => string[];
  getAllTracks: () => TreeItem[];
  getAllFolders: () => TreeItem[];
  getTreeStats: () => {
    totalTracks: number;
    totalFolders: number;
    maxDepth: number;
    totalItems: number;
  };
}

export function useHierarchicalFileTree({
  tracks,
  folders
}: UseHierarchicalFileTreeProps): UseHierarchicalFileTreeReturn {
  
  const tree = useMemo(() => {
    // Convert object records to arrays
    const trackArray = Object.values(tracks);
    const folderArray = Object.values(folders);
    
    // Transform to hierarchical structure
    return TreeDataTransformer.transformToTree(trackArray, folderArray);
  }, [tracks, folders]);

  const rootItems = useMemo(() => {
    return TreeDataTransformer.getRootItems(tree);
  }, [tree]);

  const findItemById = useMemo(() => {
    return (id: string) => TreeDataTransformer.findItemById(tree, id);
  }, [tree]);

  const getItemPath = useMemo(() => {
    return (id: string) => TreeDataTransformer.getItemPath(tree, id);
  }, [tree]);

  const getAllTracks = useMemo(() => {
    return () => TreeDataTransformer.getAllTracks(tree);
  }, [tree]);

  const getAllFolders = useMemo(() => {
    return () => TreeDataTransformer.getAllFolders(tree);
  }, [tree]);

  const getTreeStats = useMemo(() => {
    return () => TreeDataTransformer.getTreeStats(tree);
  }, [tree]);

  return {
    tree,
    rootItems,
    findItemById,
    getItemPath,
    getAllTracks,
    getAllFolders,
    getTreeStats
  };
}

// Helper hook for working with a specific tree item
export function useTreeItem(tree: TreeStructure, itemId: string | null) {
  return useMemo(() => {
    if (!itemId) return null;
    return TreeDataTransformer.findItemById(tree, itemId);
  }, [tree, itemId]);
}

// Helper hook for getting children of a specific item
export function useTreeItemChildren(tree: TreeStructure, itemId: string | null) {
  return useMemo(() => {
    if (!itemId) return [];
    const item = TreeDataTransformer.findItemById(tree, itemId);
    return item?.children || [];
  }, [tree, itemId]);
}