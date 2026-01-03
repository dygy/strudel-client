/**
 * Graph-based File System Manager
 * 
 * This replaces the fragile string-based path system with a proper graph structure
 * using UUID-based node relationships.
 */

export interface FileSystemNode {
  id: string;           // UUID - unique identifier
  name: string;         // Display name (can be duplicate)
  type: 'folder' | 'track';
  parentId: string | null;  // Parent node ID (not path!)
  userId: string;       // Owner
  created: string;
  modified: string;
  
  // Track-specific fields
  code?: string;
  isMultitrack?: boolean;
  steps?: TrackStep[];
  activeStep?: number;
  
  // Computed properties
  fullPath?: string;    // Generated from graph traversal
  depth?: number;       // Distance from root
  children?: FileSystemNode[];
}

export interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

export interface Track extends FileSystemNode {
  type: 'track';
  code: string;
  isMultitrack: boolean;
  steps?: TrackStep[];
  activeStep: number;
}

export interface Folder extends FileSystemNode {
  type: 'folder';
}

export interface TreeNode {
  id: string;
  name: string;
  type: 'folder' | 'track';
  data: FileSystemNode;
  children?: TreeNode[];
  fullPath?: string;
  depth?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class FileSystemGraph {
  private nodes: Map<string, FileSystemNode> = new Map();
  private children: Map<string, Set<string>> = new Map();
  private parent: Map<string, string> = new Map();

  constructor(nodes: FileSystemNode[] = []) {
    this.loadNodes(nodes);
  }

  // Public getter for nodes
  getNode(nodeId: string): FileSystemNode | undefined {
    return this.nodes.get(nodeId);
  }

  // Public getter for all nodes
  getAllNodes(): FileSystemNode[] {
    return Array.from(this.nodes.values());
  }

  // Load nodes into the graph
  loadNodes(nodes: FileSystemNode[]): void {
    this.nodes.clear();
    this.children.clear();
    this.parent.clear();

    // First pass: add all nodes
    nodes.forEach(node => {
      this.nodes.set(node.id, node);
      if (!this.children.has(node.id)) {
        this.children.set(node.id, new Set());
      }
    });

    // Second pass: build relationships
    nodes.forEach(node => {
      if (node.parentId) {
        // Add to parent's children
        if (!this.children.has(node.parentId)) {
          this.children.set(node.parentId, new Set());
        }
        this.children.get(node.parentId)!.add(node.id);
        
        // Set parent relationship
        this.parent.set(node.id, node.parentId);
      }
    });
  }

  // Core operations
  addNode(node: FileSystemNode): void {
    this.nodes.set(node.id, node);
    
    if (!this.children.has(node.id)) {
      this.children.set(node.id, new Set());
    }
    
    if (node.parentId) {
      if (!this.children.has(node.parentId)) {
        this.children.set(node.parentId, new Set());
      }
      this.children.get(node.parentId)!.add(node.id);
      this.parent.set(node.id, node.parentId);
    }
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Remove from parent's children
    if (node.parentId) {
      this.children.get(node.parentId)?.delete(nodeId);
    }

    // Remove all children (cascade delete)
    const childrenIds = Array.from(this.children.get(nodeId) || []);
    childrenIds.forEach(childId => this.removeNode(childId));

    // Remove the node itself
    this.nodes.delete(nodeId);
    this.children.delete(nodeId);
    this.parent.delete(nodeId);
  }

  moveNode(nodeId: string, newParentId: string | null): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    // Validate the move
    if (!this.canMove(nodeId, newParentId)) {
      return false;
    }

    // Remove from old parent
    if (node.parentId) {
      this.children.get(node.parentId)?.delete(nodeId);
    }

    // Add to new parent
    if (newParentId) {
      if (!this.children.has(newParentId)) {
        this.children.set(newParentId, new Set());
      }
      this.children.get(newParentId)!.add(nodeId);
      this.parent.set(nodeId, newParentId);
    } else {
      this.parent.delete(nodeId);
    }

    // Update the node
    node.parentId = newParentId;
    this.nodes.set(nodeId, node);

    return true;
  }

  // Traversal methods
  getChildren(nodeId: string): FileSystemNode[] {
    const childrenIds = Array.from(this.children.get(nodeId) || []);
    return childrenIds
      .map(id => this.nodes.get(id))
      .filter(node => node !== undefined) as FileSystemNode[];
  }

  getParent(nodeId: string): FileSystemNode | null {
    const parentId = this.parent.get(nodeId);
    return parentId ? this.nodes.get(parentId) || null : null;
  }

  getRootNodes(): FileSystemNode[] {
    return Array.from(this.nodes.values()).filter(node => !node.parentId);
  }

  getPath(nodeId: string): string {
    const node = this.nodes.get(nodeId);
    if (!node) return '';

    const pathParts: string[] = [];
    let currentNode: FileSystemNode | null = node;

    while (currentNode) {
      pathParts.unshift(currentNode.name);
      currentNode = currentNode.parentId ? this.nodes.get(currentNode.parentId) || null : null;
    }

    return pathParts.join('/');
  }

  getDepth(nodeId: string): number {
    let depth = 0;
    let currentId: string | undefined = nodeId;

    while (currentId && this.parent.has(currentId)) {
      depth++;
      currentId = this.parent.get(currentId);
    }

    return depth;
  }

  // Validation methods
  canMove(nodeId: string, targetParentId: string | null): boolean {
    if (!targetParentId) return true; // Moving to root is always valid

    // Can't move to self
    if (nodeId === targetParentId) return false;

    // Can't move to a descendant (would create cycle)
    return !this.isDescendant(targetParentId, nodeId);
  }

  private isDescendant(potentialDescendant: string, ancestor: string): boolean {
    const children = this.getChildren(ancestor);
    
    for (const child of children) {
      if (child.id === potentialDescendant) return true;
      if (this.isDescendant(potentialDescendant, child.id)) return true;
    }
    
    return false;
  }

  detectCycles(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const children = this.getChildren(nodeId);
      for (const child of children) {
        if (hasCycle(child.id)) return true;
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (hasCycle(nodeId)) return true;
      }
    }

    return false;
  }

  validateHierarchy(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for cycles
    if (this.detectCycles()) {
      errors.push('Circular reference detected in file system hierarchy');
    }

    // Check for orphaned nodes (parent doesn't exist)
    for (const node of this.nodes.values()) {
      if (node.parentId && !this.nodes.has(node.parentId)) {
        errors.push(`Node "${node.name}" (${node.id}) references non-existent parent ${node.parentId}`);
      }
    }

    // Check for duplicate names in same folder
    const folderContents = new Map<string, string[]>();
    for (const node of this.nodes.values()) {
      const parentKey = node.parentId || 'root';
      if (!folderContents.has(parentKey)) {
        folderContents.set(parentKey, []);
      }
      folderContents.get(parentKey)!.push(node.name);
    }

    for (const [parentKey, names] of folderContents.entries()) {
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      if (duplicates.length > 0) {
        const parentName = parentKey === 'root' ? 'root' : this.nodes.get(parentKey)?.name || 'unknown';
        warnings.push(`Duplicate names in folder "${parentName}": ${[...new Set(duplicates)].join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Tree building for UI
  buildTree(): TreeNode[] {
    const rootNodes = this.getRootNodes();
    return rootNodes.map(node => this.buildSubtree(node));
  }

  private buildSubtree(node: FileSystemNode): TreeNode {
    const children = this.getChildren(node.id);
    
    // Sort children: folders first, then tracks, both alphabetically
    children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      data: node,
      children: children.map(child => this.buildSubtree(child)),
      fullPath: this.getPath(node.id),
      depth: this.getDepth(node.id)
    };
  }

  // Search and query methods
  findByName(name: string, type?: 'folder' | 'track'): FileSystemNode[] {
    return Array.from(this.nodes.values()).filter(node => 
      node.name.toLowerCase().includes(name.toLowerCase()) &&
      (!type || node.type === type)
    );
  }

  findDuplicateNames(parentId?: string): FileSystemNode[] {
    const siblings = parentId ? this.getChildren(parentId) : this.getRootNodes();
    const nameCount = new Map<string, FileSystemNode[]>();

    siblings.forEach(node => {
      if (!nameCount.has(node.name)) {
        nameCount.set(node.name, []);
      }
      nameCount.get(node.name)!.push(node);
    });

    const duplicates: FileSystemNode[] = [];
    for (const nodes of nameCount.values()) {
      if (nodes.length > 1) {
        duplicates.push(...nodes);
      }
    }

    return duplicates;
  }

  // Statistics
  getStats() {
    const nodes = Array.from(this.nodes.values());
    return {
      totalNodes: nodes.length,
      folders: nodes.filter(n => n.type === 'folder').length,
      tracks: nodes.filter(n => n.type === 'track').length,
      multitracks: nodes.filter(n => n.type === 'track' && n.isMultitrack).length,
      maxDepth: Math.max(...nodes.map(n => this.getDepth(n.id))),
      rootNodes: this.getRootNodes().length
    };
  }
}