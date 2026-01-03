 /**
 * TreeManager Service Layer
 * Bridges in-memory TreeEngine with Supabase database operations
 * Provides async database operations with authentication integration
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TreeEngine, createFolderNode, createTrackNode } from './TreeSystem';
import type { TreeNode, TrackNode, FolderNode, SearchQuery, SearchResult, ValidationResult, TreeStatistics, NodeStatistics } from './TreeSystem';

export interface TreeManagerConfig {
  userId: string;
  supabase?: SupabaseClient;
}

export interface DatabaseTreeNode {
  id: string;
  user_id: string;
  name: string;
  type: 'folder' | 'track';
  parent_id: string | null;
  created: string;
  modified: string;
  code?: string;
  is_multitrack?: boolean;
  steps?: any;
  active_step?: number;
  metadata: Record<string, any>;
  path_array?: string[];
  depth?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateNodeRequest {
  name: string;
  type: 'folder' | 'track';
  parentId?: string | null;
  code?: string;
  isMultitrack?: boolean;
  steps?: any;
  activeStep?: number;
  metadata?: Record<string, any>;
}

export interface UpdateNodeRequest {
  name?: string;
  parentId?: string | null;
  code?: string;
  isMultitrack?: boolean;
  steps?: any;
  activeStep?: number;
  metadata?: Record<string, any>;
}

export interface MoveNodeRequest {
  nodeId: string;
  newParentId: string | null;
}

export interface BatchOperation {
  type: 'create' | 'update' | 'delete' | 'move';
  nodeId?: string;
  data?: CreateNodeRequest | UpdateNodeRequest | MoveNodeRequest;
}

export class TreeManager {
  private supabase: SupabaseClient;
  private engine: TreeEngine;
  private userId: string;
  private isLoaded: boolean = false;

  constructor(config: TreeManagerConfig) {
    // Use provided supabase client or create a new one
    if (config.supabase) {
      this.supabase = config.supabase;
    } else {
      // Fallback: try to create client from environment
      const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase client not provided and environment variables not found');
      }
      
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
    
    this.userId = config.userId;
    this.engine = new TreeEngine(config.userId);
  }

  /**
   * Load user's tree from database into memory
   */
  async loadTree(): Promise<void> {
    if (this.isLoaded) return;

    try {
      const { data: nodes, error } = await this.supabase
        .from('tree_nodes')
        .select('*')
        .eq('user_id', this.userId)
        .order('depth', { ascending: true }); // Load parents before children

      if (error) {
        throw new Error(`Failed to load tree: ${error.message}`);
      }

      // Convert database nodes to TreeNode format and add to engine
      for (const dbNode of nodes || []) {
        const treeNode = this.dbNodeToTreeNode(dbNode);
        this.engine.addNode(treeNode);
      }

      this.isLoaded = true;
    } catch (error) {
      console.error('TreeManager: Failed to load tree:', error);
      throw error;
    }
  }

  /**
   * Create a new node
   */
  async createNode(request: CreateNodeRequest): Promise<TreeNode> {
    await this.ensureLoaded();

    let node: TreeNode;

    if (request.type === 'folder') {
      node = createFolderNode(
        request.name,
        this.userId,
        request.parentId || null,
        request.metadata || {}
      );
    } else {
      node = createTrackNode(
        request.name,
        request.code || '',
        this.userId,
        request.parentId || null,
        request.isMultitrack || false,
        request.metadata || {}
      );
      
      if (request.steps) {
        (node as TrackNode).steps = request.steps;
      }
      if (request.activeStep !== undefined) {
        (node as TrackNode).activeStep = request.activeStep;
      }
    }

    // Validate the operation
    if (request.parentId) {
      const validation = this.engine.canMove(node.id, request.parentId);
      if (!validation.canMove) {
        throw new Error(`Cannot create node: ${validation.reason}`);
      }
    }

    try {
      // Insert into database
      const dbNode = this.treeNodeToDbNode(node);
      const { error } = await this.supabase
        .from('tree_nodes')
        .insert([dbNode])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create node: ${error.message}`);
      }

      // Add to in-memory engine
      this.engine.addNode(node);

      return node;
    } catch (error) {
      console.error('TreeManager: Failed to create node:', error);
      throw error;
    }
  }

  /**
   * Update an existing node
   */
  async updateNode(nodeId: string, updates: UpdateNodeRequest): Promise<TreeNode> {
    await this.ensureLoaded();

    const existingNode = this.engine.getNode(nodeId);
    if (!existingNode) {
      throw new Error(`Node ${nodeId} not found`);
    }

    // Validate parent change if requested
    if (updates.parentId !== undefined && updates.parentId !== existingNode.parentId) {
      const validation = this.engine.canMove(nodeId, updates.parentId);
      if (!validation.canMove) {
        throw new Error(`Cannot move node: ${validation.reason}`);
      }
    }

    try {
      // Prepare database update
      const dbUpdates: Partial<DatabaseTreeNode> = {
        modified: new Date().toISOString()
      };

      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.parentId !== undefined) dbUpdates.parent_id = updates.parentId;
      if (updates.code !== undefined) dbUpdates.code = updates.code;
      if (updates.isMultitrack !== undefined) dbUpdates.is_multitrack = updates.isMultitrack;
      if (updates.steps !== undefined) dbUpdates.steps = updates.steps;
      if (updates.activeStep !== undefined) dbUpdates.active_step = updates.activeStep;
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;

      // Update in database
      const { error } = await this.supabase
        .from('tree_nodes')
        .update(dbUpdates)
        .eq('id', nodeId)
        .eq('user_id', this.userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update node: ${error.message}`);
      }

      // Update in-memory engine
      const updatedNode = { ...existingNode };
      if (updates.name !== undefined) updatedNode.name = updates.name;
      if (updates.code !== undefined && updatedNode.type === 'track') {
        (updatedNode as TrackNode).code = updates.code;
      }
      if (updates.isMultitrack !== undefined && updatedNode.type === 'track') {
        (updatedNode as TrackNode).isMultitrack = updates.isMultitrack;
      }
      if (updates.steps !== undefined && updatedNode.type === 'track') {
        (updatedNode as TrackNode).steps = updates.steps;
      }
      if (updates.activeStep !== undefined && updatedNode.type === 'track') {
        (updatedNode as TrackNode).activeStep = updates.activeStep;
      }
      if (updates.metadata !== undefined) {
        updatedNode.metadata = { ...updatedNode.metadata, ...updates.metadata };
      }
      updatedNode.modified = dbUpdates.modified!;

      // Handle parent change
      if (updates.parentId !== undefined && updates.parentId !== existingNode.parentId) {
        this.engine.updateParent(nodeId, updates.parentId);
        updatedNode.parentId = updates.parentId;
      }

      // Update the node in engine's internal storage
      this.engine.addNode(updatedNode);

      return updatedNode;
    } catch (error) {
      console.error('TreeManager: Failed to update node:', error);
      throw error;
    }
  }

  /**
   * Delete a node and optionally its children
   */
  async deleteNode(nodeId: string, cascade: boolean = true): Promise<void> {
    await this.ensureLoaded();

    const node = this.engine.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    try {
      if (cascade) {
        // Database cascade delete is handled by foreign key constraints
        const { error } = await this.supabase
          .from('tree_nodes')
          .delete()
          .eq('id', nodeId)
          .eq('user_id', this.userId);

        if (error) {
          throw new Error(`Failed to delete node: ${error.message}`);
        }

        // Remove from in-memory engine (this also removes children)
        this.engine.removeNode(nodeId);
      } else {
        // Move children to parent before deleting
        const children = this.engine.getChildren(nodeId);
        for (const child of children) {
          await this.updateNode(child.id, { parentId: node.parentId });
        }

        // Delete the node
        const { error } = await this.supabase
          .from('tree_nodes')
          .delete()
          .eq('id', nodeId)
          .eq('user_id', this.userId);

        if (error) {
          throw new Error(`Failed to delete node: ${error.message}`);
        }

        this.engine.removeNode(nodeId);
      }
    } catch (error) {
      console.error('TreeManager: Failed to delete node:', error);
      throw error;
    }
  }

  /**
   * Move a node to a new parent
   */
  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.ensureLoaded();

    const validation = this.engine.canMove(nodeId, newParentId);
    if (!validation.canMove) {
      throw new Error(`Cannot move node: ${validation.reason}`);
    }

    try {
      const { error } = await this.supabase
        .from('tree_nodes')
        .update({ 
          parent_id: newParentId,
          modified: new Date().toISOString()
        })
        .eq('id', nodeId)
        .eq('user_id', this.userId);

      if (error) {
        throw new Error(`Failed to move node: ${error.message}`);
      }

      // Update in-memory engine
      this.engine.updateParent(nodeId, newParentId);
    } catch (error) {
      console.error('TreeManager: Failed to move node:', error);
      throw error;
    }
  }

  /**
   * Get a node by ID
   */
  async getNode(nodeId: string): Promise<TreeNode | null> {
    await this.ensureLoaded();
    return this.engine.getNode(nodeId);
  }

  /**
   * Get children of a node
   */
  async getChildren(parentId: string | null): Promise<TreeNode[]> {
    await this.ensureLoaded();
    
    if (parentId === null) {
      return this.engine.getRootNodes();
    }
    
    return this.engine.getChildren(parentId);
  }

  /**
   * Get parent of a node
   */
  async getParent(nodeId: string): Promise<TreeNode | null> {
    await this.ensureLoaded();
    return this.engine.getParent(nodeId);
  }

  /**
   * Get full path of a node
   */
  async getPath(nodeId: string): Promise<string> {
    await this.ensureLoaded();
    return this.engine.computePath(nodeId);
  }

  /**
   * Get subtree starting from a node
   */
  async getSubtree(rootId: string, maxDepth?: number): Promise<TreeNode[]> {
    await this.ensureLoaded();
    
    const subtree: TreeNode[] = [];
    this.engine.depthFirstTraversal(rootId, (node) => {
      subtree.push(node);
    }, { maxDepth });
    
    return subtree;
  }

  /**
   * Search nodes
   */
  async searchNodes(query: SearchQuery): Promise<SearchResult> {
    await this.ensureLoaded();
    return this.engine.searchNodes(query);
  }

  /**
   * Find node by path
   */
  async findByPath(path: string): Promise<TreeNode | null> {
    await this.ensureLoaded();
    const nodeId = this.engine.resolvePath(path);
    return nodeId ? this.engine.getNode(nodeId) : null;
  }

  /**
   * Find nodes by pattern
   */
  async findByPattern(pattern: string): Promise<TreeNode[]> {
    await this.ensureLoaded();
    const regex = new RegExp(pattern, 'i');
    const matches = this.engine.findPathsByPattern(regex);
    return matches.map(match => this.engine.getNode(match.nodeId)!).filter(Boolean);
  }

  /**
   * Validate tree integrity
   */
  async validateTree(): Promise<ValidationResult> {
    await this.ensureLoaded();
    return this.engine.validateHierarchy();
  }

  /**
   * Detect cycles in the tree
   */
  async detectCycles(): Promise<string[]> {
    await this.ensureLoaded();
    const allNodes = this.engine.getAllNodes();
    const cycles: string[] = [];
    
    for (const node of allNodes) {
      if (this.engine.detectCycle(node.id)) {
        cycles.push(node.id);
      }
    }
    
    return cycles;
  }

  /**
   * Find orphaned nodes
   */
  async findOrphans(): Promise<TreeNode[]> {
    await this.ensureLoaded();
    const orphanIds = this.engine.findOrphanedNodes();
    return orphanIds.map(id => this.engine.getNode(id)!).filter(Boolean);
  }

  /**
   * Repair orphaned nodes by moving them to root or specified parent
   */
  async repairOrphans(targetParentId: string | null = null): Promise<string[]> {
    await this.ensureLoaded();
    
    const orphans = await this.findOrphans();
    const repairedNodeIds: string[] = [];
    
    try {
      for (const orphan of orphans) {
        // Validate target parent if specified
        if (targetParentId) {
          const targetParent = await this.getNode(targetParentId);
          if (!targetParent) {
            throw new Error(`Target parent ${targetParentId} not found`);
          }
          if (targetParent.type !== 'folder') {
            throw new Error('Target parent must be a folder');
          }
        }
        
        // Update the orphan's parent
        await this.updateNode(orphan.id, { parentId: targetParentId });
        repairedNodeIds.push(orphan.id);
      }
      
      return repairedNodeIds;
    } catch (error) {
      console.error('TreeManager: Failed to repair orphans:', error);
      throw error;
    }
  }

  /**
   * Soft delete a node (mark as deleted without removing from database)
   */
  async softDeleteNode(nodeId: string, cascade: boolean = true): Promise<void> {
    await this.ensureLoaded();

    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    try {
      if (cascade) {
        // Soft delete all descendants
        const subtree = await this.getSubtree(nodeId);
        for (const descendant of subtree) {
          await this.updateNode(descendant.id, {
            metadata: {
              ...descendant.metadata,
              deleted: true,
              deletedAt: new Date().toISOString()
            }
          });
        }
      } else {
        // Just soft delete the node itself
        await this.updateNode(nodeId, {
          metadata: {
            ...node.metadata,
            deleted: true,
            deletedAt: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error('TreeManager: Failed to soft delete node:', error);
      throw error;
    }
  }

  /**
   * Restore a soft-deleted node
   */
  async restoreNode(nodeId: string, cascade: boolean = true): Promise<void> {
    await this.ensureLoaded();

    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    try {
      if (cascade) {
        // Restore all descendants
        const subtree = await this.getSubtree(nodeId);
        for (const descendant of subtree) {
          const newMetadata = { ...descendant.metadata };
          delete newMetadata.deleted;
          delete newMetadata.deletedAt;
          
          await this.updateNode(descendant.id, {
            metadata: newMetadata
          });
        }
      } else {
        // Just restore the node itself
        const newMetadata = { ...node.metadata };
        delete newMetadata.deleted;
        delete newMetadata.deletedAt;
        
        await this.updateNode(nodeId, {
          metadata: newMetadata
        });
      }
    } catch (error) {
      console.error('TreeManager: Failed to restore node:', error);
      throw error;
    }
  }

  /**
   * Get all soft-deleted nodes
   */
  async getSoftDeletedNodes(): Promise<TreeNode[]> {
    await this.ensureLoaded();
    
    const allNodes = await this.getAllNodes();
    return allNodes.filter(node => node.metadata.deleted === true);
  }

  /**
   * Permanently delete soft-deleted nodes older than specified days
   */
  async purgeOldSoftDeletedNodes(olderThanDays: number = 30): Promise<string[]> {
    await this.ensureLoaded();
    
    const softDeletedNodes = await this.getSoftDeletedNodes();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const nodesToPurge = softDeletedNodes.filter(node => {
      const deletedAt = node.metadata.deletedAt;
      if (!deletedAt) return false;
      
      const deletedDate = new Date(deletedAt);
      return deletedDate < cutoffDate;
    });
    
    const purgedNodeIds: string[] = [];
    
    try {
      for (const node of nodesToPurge) {
        await this.deleteNode(node.id, true); // Hard delete
        purgedNodeIds.push(node.id);
      }
      
      return purgedNodeIds;
    } catch (error) {
      console.error('TreeManager: Failed to purge old soft-deleted nodes:', error);
      throw error;
    }
  }

  /**
   * Get tree statistics
   */
  async getTreeStats(): Promise<TreeStatistics> {
    await this.ensureLoaded();
    
    const allNodes = this.engine.getAllNodes();
    const folders = allNodes.filter(n => n.type === 'folder');
    const tracks = allNodes.filter(n => n.type === 'track');
    
    const depths = allNodes.map(n => this.engine.getNodeDepth(n.id));
    const maxDepth = Math.max(...depths, 0);
    const averageDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
    
    // Calculate nodes per level
    const nodesPerLevel: number[] = [];
    for (let i = 0; i <= maxDepth; i++) {
      nodesPerLevel[i] = depths.filter(d => d === i).length;
    }
    
    // Find largest subtree
    let largestSubtree = { nodeId: '', size: 0 };
    for (const node of allNodes) {
      const subtreeSize = await this.getSubtreeSize(node.id);
      if (subtreeSize > largestSubtree.size) {
        largestSubtree = { nodeId: node.id, size: subtreeSize };
      }
    }
    
    // Find duplicate names
    const duplicateNames = this.engine.findDuplicateNames();
    
    return {
      totalNodes: allNodes.length,
      totalFolders: folders.length,
      totalTracks: tracks.length,
      maxDepth,
      averageDepth,
      nodesPerLevel,
      largestSubtree,
      duplicateNames
    };
  }

  /**
   * Get statistics for a specific node
   */
  async getNodeStats(nodeId: string): Promise<NodeStatistics> {
    await this.ensureLoaded();
    
    const node = this.engine.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    
    const subtreeSize = await this.getSubtreeSize(nodeId);
    const depth = this.engine.getNodeDepth(nodeId);
    const children = this.engine.getChildren(nodeId);
    const path = this.engine.computePath(nodeId);
    
    // Count all descendants
    let descendantCount = 0;
    this.engine.depthFirstTraversal(nodeId, () => {
      descendantCount++;
    });
    descendantCount--; // Don't count the node itself
    
    return {
      nodeId,
      subtreeSize,
      depth,
      childCount: children.length,
      descendantCount,
      pathLength: path.length
    };
  }

  /**
   * Perform batch operations atomically
   */
  async batchOperations(operations: BatchOperation[]): Promise<void> {
    await this.ensureLoaded();
    
    // Use Supabase transaction for atomicity
    const { error } = await this.supabase.rpc('execute_batch_operations', {
      operations: operations,
      user_id: this.userId
    });
    
    if (error) {
      throw new Error(`Batch operations failed: ${error.message}`);
    }
    
    // Reload tree to sync with database changes
    this.isLoaded = false;
    await this.loadTree();
  }

  /**
   * Refresh tree from database
   */
  async refresh(): Promise<void> {
    this.isLoaded = false;
    await this.loadTree();
  }

  /**
   * Get all nodes (for debugging/export)
   */
  async getAllNodes(): Promise<TreeNode[]> {
    await this.ensureLoaded();
    return this.engine.getAllNodes();
  }

  /**
   * Get node count
   */
  async getNodeCount(): Promise<number> {
    await this.ensureLoaded();
    return this.engine.getNodeCount();
  }

  // Private helper methods

  private async ensureLoaded(): Promise<void> {
    if (!this.isLoaded) {
      await this.loadTree();
    }
  }

  private async getSubtreeSize(nodeId: string): Promise<number> {
    let size = 0;
    this.engine.depthFirstTraversal(nodeId, () => {
      size++;
    });
    return size;
  }

  private dbNodeToTreeNode(dbNode: DatabaseTreeNode): TreeNode {
    const baseNode: TreeNode = {
      id: dbNode.id,
      name: dbNode.name,
      type: dbNode.type,
      parentId: dbNode.parent_id,
      userId: dbNode.user_id,
      created: dbNode.created,
      modified: dbNode.modified,
      metadata: dbNode.metadata || {}
    };

    if (dbNode.type === 'track') {
      const trackNode: TrackNode = {
        ...baseNode,
        type: 'track',
        code: dbNode.code || '',
        isMultitrack: dbNode.is_multitrack || false,
        steps: dbNode.steps,
        activeStep: dbNode.active_step || 0
      };
      return trackNode;
    }

    return baseNode as FolderNode;
  }

  private treeNodeToDbNode(treeNode: TreeNode): Omit<DatabaseTreeNode, 'path_array' | 'depth' | 'created_at' | 'updated_at'> {
    const dbNode: Omit<DatabaseTreeNode, 'path_array' | 'depth' | 'created_at' | 'updated_at'> = {
      id: treeNode.id,
      user_id: treeNode.userId,
      name: treeNode.name,
      type: treeNode.type,
      parent_id: treeNode.parentId,
      created: treeNode.created,
      modified: treeNode.modified,
      metadata: treeNode.metadata
    };

    if (treeNode.type === 'track') {
      const trackNode = treeNode as TrackNode;
      dbNode.code = trackNode.code;
      dbNode.is_multitrack = trackNode.isMultitrack;
      dbNode.steps = trackNode.steps;
      dbNode.active_step = trackNode.activeStep;
    }

    return dbNode;
  }
}

// Factory function for creating TreeManager instances
export function createTreeManager(config: TreeManagerConfig): TreeManager {
  return new TreeManager(config);
}

// Singleton pattern for application-wide tree manager
let globalTreeManager: TreeManager | null = null;

export function getGlobalTreeManager(): TreeManager | null {
  return globalTreeManager;
}

export function setGlobalTreeManager(manager: TreeManager): void {
  globalTreeManager = manager;
}

export function initializeGlobalTreeManager(config: TreeManagerConfig): TreeManager {
  globalTreeManager = new TreeManager(config);
  return globalTreeManager;
}