import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Get authenticated user from request
 */
async function getAuthenticatedUser(request: Request) {
  const cookies = request.headers.get('cookie') || '';
  
  if (!cookies) {
    throw new Error('No authentication cookies found');
  }

  // Parse cookies to get Supabase session tokens
  const cookieMap = new Map();
  cookies.split(';').forEach(cookie => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      cookieMap.set(key, decodeURIComponent(value));
    }
  });

  // Look for Supabase auth cookies
  let accessToken = null;

  // Try different cookie patterns that Supabase might use
  for (const [key, value] of cookieMap) {
    // Access token should be a JWT (starts with eyJ and has dots)
    if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
      accessToken = value;
      break;
    }
  }

  if (!accessToken) {
    throw new Error('No access token found in cookies');
  }

  // Create anon client for token verification
  const supabaseAnon = createClient(supabaseUrl, import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
  const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);

  if (error || !user) {
    throw new Error('Invalid session');
  }

  return user;
}

/**
 * Create TreeManager instance for user
 */
function createTreeManager(userId: string) {
  // Import TreeManager dynamically to avoid issues
  const { TreeManager } = require('../../../lib/TreeManager');
  return new TreeManager(supabase, userId);
}

// GET /api/tree/validate - Validate tree integrity
export const GET: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    const validation = await treeManager.validateTree();
    const cycles = await treeManager.detectCycles();
    const orphans = await treeManager.findOrphans();

    return new Response(JSON.stringify({
      success: true,
      validation: {
        ...validation,
        cycles,
        orphans: orphans.map(node => ({
          ...node,
          path: treeManager.getPath(node.id)
        }))
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Tree validation error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Validation failed'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};