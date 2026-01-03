import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const PUT: APIRoute = async ({ request, cookies }) => {
  try {
    console.log('API /folders/update - Starting folder update');

    // Get the session from cookies
    const accessToken = cookies.get('sb-access-token')?.value;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Supabase client with service role key for server-side operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /folders/update - User verified:', user.id);

    // Parse request body
    const body = await request.json();
    const { folderId, updates } = body;

    console.log('API /folders/update - Received data:', {
      folderId,
      updates: Object.keys(updates || {})
    });

    // Validate input
    if (!folderId || typeof folderId !== 'string') {
      return new Response(JSON.stringify({ error: 'Folder ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!updates || typeof updates !== 'object') {
      return new Response(JSON.stringify({ error: 'Updates object is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify folder ownership
    const { data: existingFolder, error: fetchError } = await supabase
      .from('folders')
      .select('id, user_id, name, path, parent')
      .eq('id', folderId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existingFolder) {
      console.log('API /folders/update - Folder not found or access denied:', fetchError?.message);
      return new Response(JSON.stringify({ error: 'Folder not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Prepare update data
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Handle allowed updates
    if (updates.name && typeof updates.name === 'string') {
      updateData.name = updates.name.trim();
    }

    if (updates.parent !== undefined) {
      // Validate parent folder exists and belongs to user (if not null)
      if (updates.parent !== null) {
        const { data: parentFolder, error: parentError } = await supabase
          .from('folders')
          .select('id')
          .eq('id', updates.parent)
          .eq('user_id', user.id)
          .single();

        if (parentError || !parentFolder) {
          console.log('API /folders/update - Parent folder not found:', parentError?.message);
          return new Response(JSON.stringify({ error: 'Parent folder not found or access denied' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Check for circular dependency (prevent moving folder into itself or its descendants)
        const isCircular = await checkCircularDependency(supabase, folderId, updates.parent);
        if (isCircular) {
          console.log('API /folders/update - Circular dependency detected');
          return new Response(JSON.stringify({ error: 'Cannot move folder into itself or its descendants' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      updateData.parent = updates.parent;
    }

    if (updates.path && typeof updates.path === 'string') {
      updateData.path = updates.path.trim();
    }

    console.log('API /folders/update - Updating folder with data:', updateData);

    // Update the folder
    const { data: updatedFolder, error: updateError } = await supabase
      .from('folders')
      .update(updateData)
      .eq('id', folderId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('API /folders/update - Update failed:', updateError);
      return new Response(JSON.stringify({ 
        error: 'Failed to update folder',
        details: updateError.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /folders/update - Folder updated successfully:', updatedFolder.id);

    return new Response(JSON.stringify({
      success: true,
      folder: {
        id: updatedFolder.id,
        name: updatedFolder.name,
        path: updatedFolder.path,
        parent: updatedFolder.parent,
        created: updatedFolder.created,
        updated_at: updatedFolder.updated_at
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /folders/update - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * Check if moving a folder would create a circular dependency
 */
async function checkCircularDependency(
  supabase: any, 
  folderId: string, 
  targetParentId: string
): Promise<boolean> {
  // If trying to move folder to itself, that's circular
  if (folderId === targetParentId) {
    return true;
  }

  // Walk up the parent chain of the target to see if we encounter the folder being moved
  let currentParentId = targetParentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);

    // If we encounter the folder being moved in the parent chain, it's circular
    if (currentParentId === folderId) {
      return true;
    }

    // Get the parent of the current folder
    const { data: parentFolder } = await supabase
      .from('folders')
      .select('parent')
      .eq('id', currentParentId)
      .single();

    currentParentId = parentFolder?.parent;
  }

  return false;
}