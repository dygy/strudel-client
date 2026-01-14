import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '../_auth';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const PUT: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { trackId, updates } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/update - updating track:', trackId, 'for user:', user.id, 'with updates:', updates);

    // Update the track directly using Supabase service role client
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // If updating the name, check for duplicates in the same folder
    if (updates.name) {
      const trimmedName = updates.name.trim();
      
      if (!trimmedName) {
        return new Response(JSON.stringify({ error: 'Track name cannot be empty' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get the current track to know its folder
      const { data: currentTrack, error: fetchError } = await supabaseService
        .from('tracks')
        .select('folder')
        .eq('id', trackId)
        .eq('user_id', user.id)
        .single();

      if (fetchError || !currentTrack) {
        console.error('API /tracks/update - track not found:', fetchError);
        return new Response(JSON.stringify({ error: 'Track not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if another track with the same name exists in the same folder
      const targetFolder = updates.folder !== undefined ? updates.folder : currentTrack.folder;
      
      const { data: existingTracks, error: checkError } = await supabaseService
        .from('tracks')
        .select('id, name')
        .eq('user_id', user.id)
        .eq('name', trimmedName)
        .eq('folder', targetFolder || null)
        .neq('id', trackId); // Exclude the track being renamed

      if (checkError) {
        console.error('API /tracks/update - error checking for duplicates:', checkError);
        throw checkError;
      }

      if (existingTracks && existingTracks.length > 0) {
        const folderName = targetFolder || 'root folder';
        console.log('API /tracks/update - duplicate track name found:', trimmedName, 'in folder:', folderName);
        return new Response(JSON.stringify({ 
          error: `A track named "${trimmedName}" already exists in ${folderName}` 
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Update the name to trimmed version
      updates.name = trimmedName;
    }

    // Update the track with service role (bypasses RLS)
    const { data: updatedTrack, error } = await supabaseService
      .from('tracks')
      .update({
        ...updates,
        modified: new Date().toISOString()
      })
      .eq('id', trackId)
      .eq('user_id', user.id) // Still check user_id for security
      .select()
      .single();

    if (error) {
      console.error('API /tracks/update - database error:', error);
      
      if (error.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Track not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Check if it's a unique constraint violation
      if (error.code === '23505' && error.message?.includes('unique_track_name_per_folder')) {
        const folderName = updates.folder || 'root folder';
        return new Response(JSON.stringify({ 
          error: `A track named "${updates.name}" already exists in ${folderName}` 
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }

    if (!updatedTrack) {
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/update - track updated successfully:', updatedTrack.id, 'name:', updatedTrack.name);

    return new Response(JSON.stringify({ 
      success: true,
      track: updatedTrack 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/update error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};