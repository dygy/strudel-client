/**
 * Scalable Tree-Based File System
 * Core data structures and interfaces for hierarchical file management
 */

import { nanoid } from 'nanoid';

// Core tree node interfaces
export interface TreeNode {
  id: string;                    // UUID - unique identifier
  name: string;                  // Display name (allows duplicates)
  type: 'folder' | 'track';      // Node type
  parentId: string | null;       // Parent node reference
  userId: string;                // Owner identifier
  created: string;               // ISO timestamp
  modified: string;              // ISO timestamp
  metadata: NodeMetadata;        // Additional properties
  
  // Computed properties (not stored in database)
  path?: string;                 // Full hierarchical path
  depth?: number;                // Distance from root
  childCount?: number;           // Number of direct children
}

export interface TrackNode extends TreeNode {
  type: 'track';
  code: string;                  // Strudel code content
  isMultitrack: boolean;         // Multitrack flag
  steps?: TrackStep[];           // Multitrack steps
  activeStep: number;            // Current active step
}

export interface FolderNode extends TreeNode {
  type: 'folder';
  // Folders have no additional properties beyond TreeNode
}

export interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

export interface NodeMetadata {
  tags?: string[];               // User-defined tags
  color?: string;                // UI color hint
  description?: string;          // User description
  customProperties?: Record<string, any>; // Extensible metadata
  deleted?: boolean;             // Soft delete flag
  deletedAt?: string;            // Soft delete timestamp
}

// Tree statistics and validation interfaces
export interface TreeStatistics {
  totalNodes: number;
  totalFolders: number;
  totalTracks: number;
  maxDepth: number;
  averageDepth: number;
  nodesPerLevel: number[];
  largestSubtree: {
    nodeId: string;
    size: number;
  };
  duplicateNames: {
    name: string;
    count: number;
    nodes: string[];
  }[];
}

export interface NodeStatistics {
  nodeId: string;
  subtreeSize: number;
  depth: number;
  childCount: number;
  descendantCount: number;
  pathLength: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'cycle' | 'orphan' | 'invalid_parent' | 'missing_node';
  nodeId: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  type: 'duplicate_name' | 'deep_nesting' | 'large_subtree';
  nodeId: string;
  message: string;
  suggestion?: string;
}

// Search and query interfaces
export interface SearchQuery {
  term?: string;                 // Text search term
  type?: 'folder' | 'track';     // Filter by node type
  parentId?: string;             // Search within specific parent
  tags?: string[];               // Filter by tags
  pattern?: string;              // Regex pattern for names
  maxDepth?: number;             // Limit search depth
  includeMetadata?: boolean;     // Search in metadata
}

export interface SearchResult {
  nodes: TreeNode[];
  totalCount: number;
  searchTime: number;
  query: SearchQuery;
}

// Tree traversal interfaces
export type NodeVisitor = (node: TreeNode, depth: number, path: string) => void | boolean;

export interface TraversalOptions {
  maxDepth?: number;
  filter?: (node: TreeNode) => boolean;
  includeRoot?: boolean;
  stopOnFirst?: boolean;
}

// Core TreeEngine class for in-memory operations
export class TreeEngine {
  private nodes: Map<string, TreeNode> = new Map();
  private children: Map<string, Set<string>> = new Map();
  private parents: Map<string, string> = new Map();
  private pathCache: Map<string, string> = new Map();
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // Node management operations
  addNode(node: TreeNode): void {
    if (node.userId !== this.userId) {
      throw new Error('Cannot add node for different user');
    }

    this.nodes.set(node.id, node);
    
    if (node.parentId) {
      this.parents.set(node.id, node.parentId);
      
      if (!this.children.has(node.parentId)) {
        this.children.set(node.parentId, new Set());
      }
      this.children.get(node.parentId)!.add(node.id);
    }

    // Invalidate path cache for this node and its descendants
    this.invalidatePathCache(node.id);
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Remove from parent's children
    if (node.parentId) {
      const siblings = this.children.get(node.parentId);
      if (siblings) {
        siblings.delete(nodeId);
      }
    }

    // Remove all descendants recursively
    const childIds = this.children.get(nodeId);
    if (childIds) {
      Array.from(childIds).forEach(childId => {
        this.removeNode(childId);
      });
    }

    // Clean up maps
    this.nodes.delete(nodeId);
    this.children.delete(nodeId);
    this.parents.delete(nodeId);
    this.pathCache.delete(nodeId);
  }

  updateParent(nodeId: string, newParentId: string | null): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    // Check for cycles
    if (newParentId && this.wouldCreateCycle(nodeId, newParentId)) {
      throw new Error('Move would create a cycle');
    }

    // Remove from old parent
    if (node.parentId) {
      const oldSiblings = this.children.get(node.parentId);
      if (oldSiblings) {
        oldSiblings.delete(nodeId);
      }
    }

    // Add to new parent
    if (newParentId) {
      if (!this.children.has(newParentId)) {
        this.children.set(newParentId, new Set());
      }
      this.children.get(newParentId)!.add(nodeId);
      this.parents.set(nodeId, newParentId);
    } else {
      this.parents.delete(nodeId);
    }

    // Update node
    node.parentId = newParentId;
    node.modified = new Date().toISOString();

    // Invalidate path cache
    this.invalidatePathCache(nodeId);
  }

  // Enhanced traversal algorithms with performance optimizations
  depthFirstTraversal(rootId: string, visitor: NodeVisitor, options: TraversalOptions = {}): void {
    const root = this.nodes.get(rootId);
    if (!root) return;

    const stack: Array<{ nodeId: string; depth: number; path: string }> = [
      { nodeId: rootId, depth: 0, path: this.computePath(rootId) }
    ];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const { nodeId, depth, path } = stack.pop()!;
      
      // Prevent infinite loops in case of data corruption
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) continue;

      // Apply filter if provided
      if (options.filter && !options.filter(node)) continue;

      // Check max depth
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

      // Visit node (include root if specified)
      if (options.includeRoot !== false || nodeId !== rootId) {
        const shouldContinue = visitor(node, depth, path);
        if (shouldContinue === false) break;
        if (options.stopOnFirst) break;
      }

      // Add children to stack (in reverse order for correct DFS order)
      const childIds = this.children.get(nodeId);
      if (childIds) {
        const childArray = Array.from(childIds).reverse();
        childArray.forEach(childId => {
          if (!visited.has(childId)) {
            const childNode = this.nodes.get(childId);
            if (childNode) {
              stack.push({
                nodeId: childId,
                depth: depth + 1,
                path: `${path}/${childNode.name}`
              });
            }
          }
        });
      }
    }
  }

  breadthFirstTraversal(rootId: string, visitor: NodeVisitor, options: TraversalOptions = {}): void {
    const root = this.nodes.get(rootId);
    if (!root) return;

    const queue: Array<{ nodeId: string; depth: number; path: string }> = [
      { nodeId: rootId, depth: 0, path: this.computePath(rootId) }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { nodeId, depth, path } = queue.shift()!;
      
      // Prevent infinite loops in case of data corruption
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) continue;

      // Apply filter if provided
      if (options.filter && !options.filter(node)) continue;

      // Check max depth
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

      // Visit node (include root if specified)
      if (options.includeRoot !== false || nodeId !== rootId) {
        const shouldContinue = visitor(node, depth, path);
        if (shouldContinue === false) break;
        if (options.stopOnFirst) break;
      }

      // Add children to queue
      const childIds = this.children.get(nodeId);
      if (childIds) {
        Array.from(childIds).forEach(childId => {
          if (!visited.has(childId)) {
            const childNode = this.nodes.get(childId);
            if (childNode) {
              queue.push({
                nodeId: childId,
                depth: depth + 1,
                path: `${path}/${childNode.name}`
              });
            }
          }
        });
      }
    }
  }

  // Post-order traversal for operations that need to process children before parents
  postOrderTraversal(rootId: string, visitor: NodeVisitor, options: TraversalOptions = {}): void {
    const root = this.nodes.get(rootId);
    if (!root) return;

    const visited = new Set<string>();
    const processed = new Set<string>();

    const traverse = (nodeId: string, depth: number, path: string): boolean => {
      if (visited.has(nodeId) || processed.has(nodeId)) return true;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return true;

      // Apply filter if provided
      if (options.filter && !options.filter(node)) return true;

      // Check max depth
      if (options.maxDepth !== undefined && depth > options.maxDepth) return true;

      // Process children first
      const childIds = this.children.get(nodeId);
      if (childIds) {
        for (const childId of Array.from(childIds)) {
          if (!processed.has(childId)) {
            const childNode = this.nodes.get(childId);
            if (childNode) {
              const shouldContinue = traverse(childId, depth + 1, `${path}/${childNode.name}`);
              if (!shouldContinue) return false;
            }
          }
        }
      }

      // Visit node after children (include root if specified)
      if (options.includeRoot !== false || nodeId !== rootId) {
        processed.add(nodeId);
        const shouldContinue = visitor(node, depth, path);
        if (shouldContinue === false) return false;
        if (options.stopOnFirst) return false;
      }

      return true;
    };

    traverse(rootId, 0, this.computePath(rootId));
  }

  // Enhanced path operations with caching optimization
  computePath(nodeId: string): string {
    // Check cache first
    if (this.pathCache.has(nodeId)) {
      return this.pathCache.get(nodeId)!;
    }

    const node = this.nodes.get(nodeId);
    if (!node) return '';

    if (!node.parentId) {
      // Root node
      this.pathCache.set(nodeId, node.name);
      return node.name;
    }

    const parentPath = this.computePath(node.parentId);
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    this.pathCache.set(nodeId, fullPath);
    return fullPath;
  }

  // Enhanced path resolution with better error handling
  resolvePath(path: string): string | null {
    if (!path || path.trim().length === 0) return null;
    
    const parts = path.split('/').filter(part => part.length > 0);
    if (parts.length === 0) return null;

    // Find root nodes matching the first part (deterministic: return first match)
    const rootNodes = Array.from(this.nodes.values()).filter(node => !node.parentId);
    let currentNode = rootNodes.find(node => node.name === parts[0]);
    if (!currentNode) return null;

    // Traverse path parts (deterministic: always take first match)
    for (let i = 1; i < parts.length; i++) {
      const childIds = this.children.get(currentNode.id);
      if (!childIds) return null;

      let found = false;
      for (const childId of Array.from(childIds)) {
        const child = this.nodes.get(childId);
        if (child && child.name === parts[i]) {
          currentNode = child;
          found = true;
          break; // Take the first match for deterministic behavior
        }
      }

      if (!found) return null;
    }

    return currentNode.id;
  }

  // Batch path resolution for multiple paths
  resolveMultiplePaths(paths: string[]): Map<string, string | null> {
    const results = new Map<string, string | null>();
    
    for (const path of paths) {
      results.set(path, this.resolvePath(path));
    }
    
    return results;
  }

  // Find all paths matching a pattern
  findPathsByPattern(pattern: RegExp): Array<{ nodeId: string; path: string }> {
    const matches: Array<{ nodeId: string; path: string }> = [];
    
    for (const nodeId of Array.from(this.nodes.keys())) {
      const path = this.computePath(nodeId);
      if (pattern.test(path)) {
        matches.push({ nodeId, path });
      }
    }
    
    return matches;
  }

  // Get all paths in the tree (useful for debugging and export)
  getAllPaths(): Map<string, string> {
    const paths = new Map<string, string>();
    
    for (const nodeId of Array.from(this.nodes.keys())) {
      paths.set(nodeId, this.computePath(nodeId));
    }
    
    return paths;
  }

  // Enhanced cache invalidation with cascade support
  invalidatePathCache(nodeId: string): void {
    this.pathCache.delete(nodeId);
    
    // Invalidate all descendants recursively
    const childIds = this.children.get(nodeId);
    if (childIds) {
      Array.from(childIds).forEach(childId => {
        this.invalidatePathCache(childId);
      });
    }
  }

  // Clear entire path cache (useful for major tree restructuring)
  clearPathCache(): void {
    this.pathCache.clear();
  }

  // Warm up path cache for frequently accessed nodes
  warmPathCache(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.computePath(nodeId);
    }
  }

  // Advanced search functionality
  searchNodes(query: SearchQuery): SearchResult {
    const startTime = performance.now();
    const matchingNodes: TreeNode[] = [];
    
    for (const [nodeId, node] of Array.from(this.nodes.entries())) {
      let matches = true;
      
      // Filter by type
      if (query.type && node.type !== query.type) {
        matches = false;
      }
      
      // Filter by parent
      if (matches && query.parentId !== undefined) {
        if (query.parentId === null) {
          // Looking for root nodes
          matches = node.parentId === null;
        } else {
          // Looking for children of specific parent
          matches = node.parentId === query.parentId;
        }
      }
      
      // Text search in name
      if (matches && query.term) {
        const searchTerm = query.term.toLowerCase();
        matches = node.name.toLowerCase().includes(searchTerm);
        
        // Also search in metadata if requested
        if (!matches && query.includeMetadata) {
          const metadataStr = JSON.stringify(node.metadata).toLowerCase();
          matches = metadataStr.includes(searchTerm);
        }
      }
      
      // Pattern matching
      if (matches && query.pattern) {
        const regex = new RegExp(query.pattern, 'i');
        matches = regex.test(node.name);
      }
      
      // Tag filtering
      if (matches && query.tags && query.tags.length > 0) {
        const nodeTags = node.metadata.tags || [];
        matches = query.tags.some(tag => nodeTags.includes(tag));
      }
      
      // Depth filtering
      if (matches && query.maxDepth !== undefined) {
        const depth = this.getNodeDepth(nodeId);
        matches = depth <= query.maxDepth;
      }
      
      if (matches) {
        matchingNodes.push(node);
      }
    }
    
    const searchTime = performance.now() - startTime;
    
    return {
      nodes: matchingNodes,
      totalCount: matchingNodes.length,
      searchTime,
      query
    };
  }

  // Enhanced validation methods
  validateHierarchy(): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for cycles
    const cycles = this.findCycles();
    for (const nodeId of cycles) {
      errors.push({
        type: 'cycle',
        nodeId,
        message: `Node ${nodeId} is part of a cycle`,
        severity: 'error'
      });
    }

    // Check for orphaned nodes
    const orphans = this.findOrphanedNodes();
    for (const nodeId of orphans) {
      errors.push({
        type: 'orphan',
        nodeId,
        message: `Node ${nodeId} references non-existent parent`,
        severity: 'error'
      });
    }

    // Check for orphaned nodes
    for (const [nodeId, node] of Array.from(this.nodes.entries())) {
      if (node.parentId && !this.nodes.has(node.parentId)) {
        errors.push({
          type: 'invalid_parent',
          nodeId,
          message: `Node ${nodeId} references non-existent parent ${node.parentId}`,
          severity: 'error'
        });
      }
    }

    // Check for duplicate names (warning only)
    const duplicateGroups = this.findDuplicateNames();
    for (const group of duplicateGroups) {
      if (group.nodes.length > 1) {
        for (const nodeId of group.nodes) {
          warnings.push({
            type: 'duplicate_name',
            nodeId,
            message: `Node ${nodeId} has duplicate name "${group.name}" with ${group.nodes.length - 1} other nodes`,
            suggestion: 'Consider renaming to avoid confusion'
          });
        }
      }
    }

    // Check for deep nesting (warning)
    const maxDepth = this.getMaxDepth();
    if (maxDepth > 10) {
      const deepNodes = this.findNodesAtDepth(maxDepth);
      for (const nodeId of deepNodes) {
        warnings.push({
          type: 'deep_nesting',
          nodeId,
          message: `Node ${nodeId} is at depth ${maxDepth}, which may impact performance`,
          suggestion: 'Consider flattening the hierarchy'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Enhanced cycle detection with path tracking
  detectCycle(nodeId: string): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    return this.detectCycleFromNodeEnhanced(nodeId, visited, recursionStack);
  }

  private detectCycleFromNodeEnhanced(
    nodeId: string,
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    if (recursionStack.has(nodeId)) {
      return true; // Cycle detected
    }
    
    if (visited.has(nodeId)) {
      return false; // Already processed
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const parentId = this.parents.get(nodeId);
    if (parentId && this.detectCycleFromNodeEnhanced(parentId, visited, recursionStack)) {
      return true;
    }

    recursionStack.delete(nodeId);
    return false;
  }

  // Find duplicate names within the same parent
  findDuplicateNames(): Array<{ name: string; count: number; nodes: string[] }> {
    const nameGroups = new Map<string, Map<string, string[]>>();
    
    // Group nodes by parent and name
    for (const [nodeId, node] of Array.from(this.nodes.entries())) {
      const parentKey = node.parentId || 'root';
      
      if (!nameGroups.has(parentKey)) {
        nameGroups.set(parentKey, new Map());
      }
      
      const parentGroup = nameGroups.get(parentKey)!;
      if (!parentGroup.has(node.name)) {
        parentGroup.set(node.name, []);
      }
      
      parentGroup.get(node.name)!.push(nodeId);
    }

    // Find duplicates
    const duplicates: Array<{ name: string; count: number; nodes: string[] }> = [];
    
    for (const parentGroup of Array.from(nameGroups.values())) {
      for (const [name, nodeIds] of Array.from(parentGroup.entries())) {
        if (nodeIds.length > 1) {
          duplicates.push({
            name,
            count: nodeIds.length,
            nodes: nodeIds
          });
        }
      }
    }

    return duplicates;
  }

  // Get maximum depth in the tree
  getMaxDepth(): number {
    let maxDepth = 0;
    
    for (const nodeId of Array.from(this.nodes.keys())) {
      const depth = this.getNodeDepth(nodeId);
      maxDepth = Math.max(maxDepth, depth);
    }
    
    return maxDepth;
  }

  // Get depth of a specific node
  getNodeDepth(nodeId: string): number {
    let depth = 0;
    let currentId = nodeId;
    const visited = new Set<string>();
    
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const parentId = this.parents.get(currentId);
      if (parentId) {
        depth++;
        currentId = parentId;
      } else {
        break;
      }
    }
    
    return depth;
  }

  // Find all nodes at a specific depth
  findNodesAtDepth(targetDepth: number): string[] {
    const nodesAtDepth: string[] = [];
    
    for (const nodeId of Array.from(this.nodes.keys())) {
      if (this.getNodeDepth(nodeId) === targetDepth) {
        nodesAtDepth.push(nodeId);
      }
    }
    
    return nodesAtDepth;
  }

  // Repair orphaned nodes by moving them to root
  repairOrphans(): string[] {
    const orphans = this.findOrphanedNodes();
    const repairedNodes: string[] = [];
    
    for (const nodeId of orphans) {
      const node = this.nodes.get(nodeId);
      if (node) {
        // Move orphan to root
        node.parentId = null;
        node.modified = new Date().toISOString();
        
        // Update internal structures
        this.parents.delete(nodeId);
        this.invalidatePathCache(nodeId);
        
        repairedNodes.push(nodeId);
      }
    }
    
    return repairedNodes;
  }

  // Validate a potential move operation
  canMove(nodeId: string, targetParentId: string | null): { canMove: boolean; reason?: string } {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { canMove: false, reason: 'Source node does not exist' };
    }

    if (targetParentId) {
      const targetParent = this.nodes.get(targetParentId);
      if (!targetParent) {
        return { canMove: false, reason: 'Target parent does not exist' };
      }

      if (targetParent.type !== 'folder') {
        return { canMove: false, reason: 'Target parent must be a folder' };
      }

      // Check for cycle
      if (this.wouldCreateCycle(nodeId, targetParentId)) {
        return { canMove: false, reason: 'Move would create a cycle' };
      }

      // Check if moving to self
      if (nodeId === targetParentId) {
        return { canMove: false, reason: 'Cannot move node to itself' };
      }
    }

    return { canMove: true };
  }

  private wouldCreateCycle(nodeId: string, newParentId: string): boolean {
    let current = newParentId;
    const visited = new Set<string>();

    while (current) {
      if (current === nodeId) return true;
      if (visited.has(current)) break; // Existing cycle, but not involving our node
      
      visited.add(current);
      current = this.parents.get(current) || null;
    }

    return false;
  }

  private findCycles(): string[] {
    const cycles: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const nodeId of Array.from(this.nodes.keys())) {
      if (!visited.has(nodeId)) {
        this.detectCycleFromNode(nodeId, visited, recursionStack, cycles);
      }
    }

    return cycles;
  }

  private detectCycleFromNode(
    nodeId: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    cycles: string[]
  ): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const parentId = this.parents.get(nodeId);
    if (parentId) {
      if (!visited.has(parentId)) {
        if (this.detectCycleFromNode(parentId, visited, recursionStack, cycles)) {
          cycles.push(nodeId);
          return true;
        }
      } else if (recursionStack.has(parentId)) {
        cycles.push(nodeId);
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  findOrphanedNodes(): string[] {
    const orphans: string[] = [];

    for (const [nodeId, node] of Array.from(this.nodes.entries())) {
      if (node.parentId && !this.nodes.has(node.parentId)) {
        orphans.push(nodeId);
      }
    }

    return orphans;
  }

  // Utility methods
  getChildren(nodeId: string): TreeNode[] {
    const childIds = this.children.get(nodeId);
    if (!childIds) return [];

    return Array.from(childIds)
      .map(id => this.nodes.get(id))
      .filter((node): node is TreeNode => node !== undefined);
  }

  getParent(nodeId: string): TreeNode | null {
    const parentId = this.parents.get(nodeId);
    return parentId ? this.nodes.get(parentId) || null : null;
  }

  getRootNodes(): TreeNode[] {
    return Array.from(this.nodes.values()).filter(node => !node.parentId);
  }

  getNode(nodeId: string): TreeNode | null {
    return this.nodes.get(nodeId) || null;
  }

  getAllNodes(): TreeNode[] {
    return Array.from(this.nodes.values());
  }

  getNodeCount(): number {
    return this.nodes.size;
  }
}

// Factory functions for creating nodes
export function createFolderNode(
  name: string,
  userId: string,
  parentId: string | null = null,
  metadata: NodeMetadata = {}
): FolderNode {
  const now = new Date().toISOString();
  
  return {
    id: nanoid(),
    name,
    type: 'folder',
    parentId,
    userId,
    created: now,
    modified: now,
    metadata
  };
}

export function createTrackNode(
  name: string,
  code: string,
  userId: string,
  parentId: string | null = null,
  isMultitrack: boolean = false,
  metadata: NodeMetadata = {}
): TrackNode {
  const now = new Date().toISOString();
  
  return {
    id: nanoid(),
    name,
    type: 'track',
    parentId,
    userId,
    created: now,
    modified: now,
    metadata,
    code,
    isMultitrack,
    steps: isMultitrack ? [] : undefined,
    activeStep: 0
  };
}

export function createTrackStep(name: string, code: string): TrackStep {
  const now = new Date().toISOString();
  
  return {
    id: nanoid(),
    name,
    code,
    created: now,
    modified: now
  };
}