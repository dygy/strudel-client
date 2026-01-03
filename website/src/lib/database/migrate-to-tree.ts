/**
 * Database Migration: Legacy System to Tree-Based File System
 * Migrates existing tracks and folders to the new tree structure
 */

import { createClient } from '@supabase/supabase-js';

interface LegacyTrack {
  id: string;
  user_id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder: string | null;
  is_multitrack: boolean;
  steps: any;
  active_step: number;
}

interface LegacyFolder {
  id: string;
  user_id: string;
  name: string;
  path: string;
  parent: string | null;
  created: string;
}

interface TreeNode {
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
}

export class TreeMigration {
  private supabase: any;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Apply the new tree schema to the database
   */
  async applySchema(): Promise<void> {
    console.log('Applying tree schema...');
    
    // Read and execute the schema file
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const schemaPath = path.join(process.cwd(), 'website/src/lib/database/tree-schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    
    // Execute schema in chunks (PostgreSQL has statement limits)
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      try {
        const { error } = await this.supabase.rpc('exec_sql', { sql: statement + ';' });
        if (error) {
          console.warn('Schema statement warning:', error.message);
        }
      } catch (err) {
        console.error('Schema execution error:', err);
        // Continue with other statements
      }
    }
    
    console.log('Tree schema applied successfully');
  }

  /**
   * Migrate all users' data from legacy system to tree structure
   */
  async migrateAllUsers(): Promise<void> {
    console.log('Starting migration of all users...');
    
    // Get all users who have data to migrate
    const { data: users, error: usersError } = await this.supabase
      .from('tracks')
      .select('user_id')
      .group('user_id');
      
    if (usersError) {
      throw new Error(`Failed to get users: ${usersError.message}`);
    }

    const uniqueUsers = [...new Set(users.map((u: { user_id: string }) => u.user_id))].filter((id): id is string => typeof id === 'string');
    console.log(`Found ${uniqueUsers.length} users to migrate`);

    for (const userId of uniqueUsers) {
      try {
        await this.migrateUser(userId);
        console.log(`✓ Migrated user: ${userId}`);
      } catch (error) {
        console.error(`✗ Failed to migrate user ${userId}:`, error);
      }
    }
    
    console.log('Migration completed');
  }

  /**
   * Migrate a single user's data to tree structure
   */
  async migrateUser(userId: string): Promise<void> {
    console.log(`Migrating user: ${userId}`);
    
    // Check if user already migrated
    const { data: existingNodes } = await this.supabase
      .from('tree_nodes')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
      
    if (existingNodes && existingNodes.length > 0) {
      console.log(`User ${userId} already migrated, skipping`);
      return;
    }

    // Get legacy data
    const [legacyTracks, legacyFolders] = await Promise.all([
      this.getLegacyTracks(userId),
      this.getLegacyFolders(userId)
    ]);

    // Build folder hierarchy
    const folderMap = new Map<string, TreeNode>();
    const folderHierarchy = this.buildFolderHierarchy(legacyFolders, userId);
    
    // Create tree nodes
    const treeNodes: TreeNode[] = [];
    
    // Add folders to tree
    for (const folder of folderHierarchy) {
      const treeNode: TreeNode = {
        id: folder.id,
        user_id: userId,
        name: folder.name,
        type: 'folder',
        parent_id: folder.parent_id,
        created: folder.created,
        modified: folder.created, // folders don't have modified in legacy
        metadata: {
          originalPath: folder.path,
          migratedFrom: 'legacy_folders'
        }
      };
      
      treeNodes.push(treeNode);
      folderMap.set(folder.path, treeNode);
    }

    // Add tracks to tree
    for (const track of legacyTracks) {
      const parentId = track.folder ? this.findFolderByPath(folderMap, track.folder)?.id || null : null;
      
      const treeNode: TreeNode = {
        id: track.id,
        user_id: userId,
        name: track.name,
        type: 'track',
        parent_id: parentId,
        created: track.created,
        modified: track.modified,
        code: track.code,
        is_multitrack: track.is_multitrack,
        steps: track.steps,
        active_step: track.active_step,
        metadata: {
          originalFolder: track.folder,
          migratedFrom: 'legacy_tracks'
        }
      };
      
      treeNodes.push(treeNode);
    }

    // Insert tree nodes in batches
    const batchSize = 100;
    for (let i = 0; i < treeNodes.length; i += batchSize) {
      const batch = treeNodes.slice(i, i + batchSize);
      
      const { error } = await this.supabase
        .from('tree_nodes')
        .insert(batch);
        
      if (error) {
        throw new Error(`Failed to insert tree nodes: ${error.message}`);
      }
    }

    console.log(`Migrated ${treeNodes.length} nodes for user ${userId}`);
  }

  /**
   * Get legacy tracks for a user
   */
  private async getLegacyTracks(userId: string): Promise<LegacyTrack[]> {
    const { data, error } = await this.supabase
      .from('tracks')
      .select('*')
      .eq('user_id', userId);
      
    if (error) {
      throw new Error(`Failed to get legacy tracks: ${error.message}`);
    }
    
    return data || [];
  }

  /**
   * Get legacy folders for a user
   */
  private async getLegacyFolders(userId: string): Promise<LegacyFolder[]> {
    const { data, error } = await this.supabase
      .from('folders')
      .select('*')
      .eq('user_id', userId);
      
    if (error) {
      throw new Error(`Failed to get legacy folders: ${error.message}`);
    }
    
    return data || [];
  }

  /**
   * Build proper folder hierarchy from legacy flat structure
   */
  private buildFolderHierarchy(legacyFolders: LegacyFolder[], userId: string): Array<LegacyFolder & { parent_id: string | null }> {
    const folderMap = new Map<string, LegacyFolder>();
    const pathToId = new Map<string, string>();
    
    // Index folders by path
    for (const folder of legacyFolders) {
      folderMap.set(folder.id, folder);
      pathToId.set(folder.path, folder.id);
    }
    
    // Build hierarchy
    const hierarchy: Array<LegacyFolder & { parent_id: string | null }> = [];
    
    for (const folder of legacyFolders) {
      const pathParts = folder.path.split('/').filter(part => part.length > 0);
      let parentId: string | null = null;
      
      // Find parent by reconstructing parent path
      if (pathParts.length > 1) {
        const parentPath = pathParts.slice(0, -1).join('/');
        parentId = pathToId.get(parentPath) || null;
      }
      
      hierarchy.push({
        ...folder,
        parent_id: parentId
      });
    }
    
    return hierarchy;
  }

  /**
   * Find folder by path in the folder map
   */
  private findFolderByPath(folderMap: Map<string, TreeNode>, path: string): TreeNode | null {
    return folderMap.get(path) || null;
  }

  /**
   * Validate migration for a user
   */
  async validateMigration(userId: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      // Count legacy data
      const [legacyTracksCount, legacyFoldersCount] = await Promise.all([
        this.countLegacyTracks(userId),
        this.countLegacyFolders(userId)
      ]);
      
      // Count tree data
      const { data: treeNodes, error } = await this.supabase
        .from('tree_nodes')
        .select('type')
        .eq('user_id', userId);
        
      if (error) {
        errors.push(`Failed to count tree nodes: ${error.message}`);
        return { valid: false, errors };
      }
      
      const treeTracksCount = treeNodes.filter((n: { type: string }) => n.type === 'track').length;
      const treeFoldersCount = treeNodes.filter((n: { type: string }) => n.type === 'folder').length;
      
      // Validate counts
      if (legacyTracksCount !== treeTracksCount) {
        errors.push(`Track count mismatch: legacy=${legacyTracksCount}, tree=${treeTracksCount}`);
      }
      
      if (legacyFoldersCount !== treeFoldersCount) {
        errors.push(`Folder count mismatch: legacy=${legacyFoldersCount}, tree=${treeFoldersCount}`);
      }
      
      // Check for cycles (should be prevented by triggers)
      const { data: cycles } = await this.supabase.rpc('detect_cycles', { user_uuid: userId });
      if (cycles && cycles.length > 0) {
        errors.push(`Found ${cycles.length} cycles in tree structure`);
      }
      
    } catch (error) {
      errors.push(`Validation error: ${error.message}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  private async countLegacyTracks(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('tracks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
      
    if (error) throw error;
    return count || 0;
  }

  private async countLegacyFolders(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
      
    if (error) throw error;
    return count || 0;
  }

  /**
   * Rollback migration for a user (for testing)
   */
  async rollbackUser(userId: string): Promise<void> {
    console.log(`Rolling back migration for user: ${userId}`);
    
    const { error } = await this.supabase
      .from('tree_nodes')
      .delete()
      .eq('user_id', userId);
      
    if (error) {
      throw new Error(`Failed to rollback user ${userId}: ${error.message}`);
    }
    
    console.log(`Rollback completed for user: ${userId}`);
  }
}

// CLI usage
if (require.main === module) {
  const migration = new TreeMigration(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const command = process.argv[2];
  const userId = process.argv[3];
  
  switch (command) {
    case 'schema':
      migration.applySchema().catch(console.error);
      break;
    case 'migrate-all':
      migration.migrateAllUsers().catch(console.error);
      break;
    case 'migrate-user':
      if (!userId) {
        console.error('Usage: migrate-user <user_id>');
        process.exit(1);
      }
      migration.migrateUser(userId).catch(console.error);
      break;
    case 'validate':
      if (!userId) {
        console.error('Usage: validate <user_id>');
        process.exit(1);
      }
      migration.validateMigration(userId).then(result => {
        console.log('Validation result:', result);
      }).catch(console.error);
      break;
    case 'rollback':
      if (!userId) {
        console.error('Usage: rollback <user_id>');
        process.exit(1);
      }
      migration.rollbackUser(userId).catch(console.error);
      break;
    default:
      console.log('Usage: migrate-to-tree.ts <schema|migrate-all|migrate-user|validate|rollback> [user_id]');
  }
}