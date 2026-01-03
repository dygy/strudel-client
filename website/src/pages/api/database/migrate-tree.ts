/**
 * API Endpoint: Migrate to Tree-Based File System
 * Handles migration from legacy flat structure to hierarchical tree
 */

import type { APIRoute } from 'astro';
import { TreeMigration } from '../../../lib/database/migrate-to-tree';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY
);

export const POST: APIRoute = async ({ request }) => {
  try {
    const { action, userId } = await request.json();
    
    const migration = new TreeMigration(
      import.meta.env.SUPABASE_URL,
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY
    );

    switch (action) {
      case 'apply-schema':
        await migration.applySchema();
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Tree schema applied successfully' 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      case 'migrate-user':
        if (!userId) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'User ID required' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        await migration.migrateUser(userId);
        return new Response(JSON.stringify({ 
          success: true, 
          message: `User ${userId} migrated successfully` 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      case 'migrate-all':
        await migration.migrateAllUsers();
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'All users migrated successfully' 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      case 'validate':
        if (!userId) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'User ID required for validation' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        const validation = await migration.validateMigration(userId);
        return new Response(JSON.stringify({ 
          success: true, 
          validation 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      case 'rollback':
        if (!userId) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'User ID required for rollback' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        await migration.rollbackUser(userId);
        return new Response(JSON.stringify({ 
          success: true, 
          message: `User ${userId} rollback completed` 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      default:
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid action. Use: apply-schema, migrate-user, migrate-all, validate, rollback' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }

  } catch (error) {
    console.error('Migration API error:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message || 'Migration failed' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async () => {
  try {
    // Get migration status
    const { data: legacyTracks, error: tracksError } = await supabase
      .from('tracks')
      .select('user_id', { count: 'exact', head: true });
      
    const { data: treeNodes, error: treeError } = await supabase
      .from('tree_nodes')
      .select('user_id', { count: 'exact', head: true });

    if (tracksError || treeError) {
      throw new Error('Failed to get migration status');
    }

    const status = {
      legacyTracksCount: legacyTracks?.length || 0,
      treeNodesCount: treeNodes?.length || 0,
      migrationNeeded: (legacyTracks?.length || 0) > 0 && (treeNodes?.length || 0) === 0,
      migrationComplete: (treeNodes?.length || 0) > 0
    };

    return new Response(JSON.stringify({ 
      success: true, 
      status 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Migration status error:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message || 'Failed to get migration status' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};