import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { isAdmin } from '../../../lib/adminAuth';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    // Get access token
    let accessToken = cookies.get('sb-access-token')?.value;

    if (!accessToken) {
      const cookieHeader = request.headers.get('cookie') || '';
      const cookieMap = new Map();
      cookieHeader.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          cookieMap.set(key, decodeURIComponent(value));
        }
      });
      accessToken = cookieMap.get('sb-access-token');
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the user token and check admin status
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isAdmin(user.email)) {
      return new Response(JSON.stringify({ error: 'Unauthorized - admin access required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse query parameters
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const sort = url.searchParams.get('sort') || 'track_count';
    const order = url.searchParams.get('order') || 'desc';
    const offset = (page - 1) * limit;

    // Get ALL users from auth.users using admin API
    const { data: allUsersData, error: usersError } = await supabase.auth.admin.listUsers();

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return new Response(JSON.stringify({ error: 'Failed to fetch users' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const allUsers = allUsersData?.users || [];

    // Get all tracks to calculate counts per user
    const { data: trackStats, error: statsError } = await supabase
      .from('tracks')
      .select('user_id, modified');

    if (statsError) {
      console.error('Error fetching track stats:', statsError);
    }

    // Aggregate track counts and last modified per user
    const userStats: Record<string, { track_count: number; last_active: string }> = {};

    for (const track of trackStats || []) {
      if (!track.user_id) continue;

      if (!userStats[track.user_id]) {
        userStats[track.user_id] = { track_count: 0, last_active: track.modified || '' };
      }

      userStats[track.user_id].track_count++;

      if (track.modified && track.modified > userStats[track.user_id].last_active) {
        userStats[track.user_id].last_active = track.modified;
      }
    }

    // Build users list with track counts (including users with 0 tracks)
    const usersWithEmail: Array<{
      user_id: string;
      email: string;
      track_count: number;
      last_active: string;
      created_at: string;
    }> = [];

    for (const authUser of allUsers) {
      const stats = userStats[authUser.id] || { track_count: 0, last_active: '' };
      usersWithEmail.push({
        user_id: authUser.id,
        email: authUser.email || 'unknown',
        track_count: stats.track_count,
        last_active: stats.last_active || authUser.last_sign_in_at || '',
        created_at: authUser.created_at || '',
      });
    }

    // Sort the results
    usersWithEmail.sort((a, b) => {
      let comparison = 0;

      switch (sort) {
        case 'email':
          comparison = a.email.localeCompare(b.email);
          break;
        case 'track_count':
          comparison = a.track_count - b.track_count;
          break;
        case 'last_active':
          comparison = (a.last_active || '').localeCompare(b.last_active || '');
          break;
        case 'created_at':
          comparison = (a.created_at || '').localeCompare(b.created_at || '');
          break;
        default:
          comparison = a.track_count - b.track_count;
      }

      return order === 'desc' ? -comparison : comparison;
    });

    // Paginate
    const total = usersWithEmail.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedUsers = usersWithEmail.slice(offset, offset + limit);

    return new Response(JSON.stringify({
      users: paginatedUsers,
      total,
      page,
      limit,
      totalPages,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('Admin users API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
