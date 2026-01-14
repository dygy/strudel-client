import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { getAuthenticatedUser } from '../_auth';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { name, code = '', folder, isMultitrack, steps, activeStep } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Track name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const trimmedName = name.trim();
    
    if (!trimmedName) {
      return new Response(JSON.stringify({ error: 'Track name cannot be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/create - creating track for user:', user.id, { name: trimmedName, folder, isMultitrack });

    // Create the track directly using Supabase service role client
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Check if a track with the same name already exists in the same folder
    const { data: existingTracks, error: checkError } = await supabaseService
      .from('tracks')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('name', trimmedName)
      .eq('folder', folder || null);

    if (checkError) {
      console.error('API /tracks/create - error checking for duplicates:', checkError);
      throw checkError;
    }

    if (existingTracks && existingTracks.length > 0) {
      const folderName = folder || 'root folder';
      console.log('API /tracks/create - duplicate track name found:', trimmedName, 'in folder:', folderName);
      return new Response(JSON.stringify({ 
        error: `A track named "${trimmedName}" already exists in ${folderName}` 
      }), {
        status: 409, // Conflict status code
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create the track with service role (bypasses RLS)
    const trackData = {
      id: nanoid(),
      user_id: user.id,
      name: trimmedName,
      code: code || '',
      folder: folder || null,
      is_multitrack: isMultitrack || false,
      steps: steps || [],
      active_step: activeStep || 0,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    const { data: newTrack, error } = await supabaseService
      .from('tracks')
      .insert(trackData)
      .select()
      .single();

    if (error) {
      console.error('API /tracks/create - database error:', error);
      
      // Check if it's a unique constraint violation
      if (error.code === '23505' && error.message?.includes('unique_track_name_per_folder')) {
        const folderName = folder || 'root folder';
        return new Response(JSON.stringify({ 
          error: `A track named "${trimmedName}" already exists in ${folderName}` 
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }

    if (!newTrack) {
      throw new Error('Failed to create track');
    }

    console.log('API /tracks/create - track created successfully:', newTrack.id);

    // Transform database response to match TypeScript interface
    const responseTrack = {
      id: newTrack.id,
      name: newTrack.name,
      code: newTrack.code,
      created: newTrack.created,
      modified: newTrack.modified,
      folder: newTrack.folder,
      isMultitrack: newTrack.is_multitrack || false,
      steps: newTrack.steps || [],
      activeStep: newTrack.active_step || 0,
      user_id: newTrack.user_id,
    };

    return new Response(JSON.stringify({ 
      success: true,
      track: responseTrack 
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/create error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};