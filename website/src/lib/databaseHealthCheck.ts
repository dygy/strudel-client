import { supabase } from './supabase';

export interface DatabaseHealthCheck {
  isHealthy: boolean;
  issues: string[];
  tables: {
    profiles: boolean;
    tracks: boolean;
    folders: boolean;
  };
  authentication: {
    hasUser: boolean;
    userId?: string;
    userEmail?: string;
  };
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthCheck> {
  const result: DatabaseHealthCheck = {
    isHealthy: true,
    issues: [],
    tables: {
      profiles: false,
      tracks: false,
      folders: false,
    },
    authentication: {
      hasUser: false,
    },
  };

  try {
    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      result.issues.push(`Authentication error: ${userError.message}`);
      result.isHealthy = false;
    } else if (user) {
      result.authentication.hasUser = true;
      result.authentication.userId = user.id;
      result.authentication.userEmail = user.email;
    } else {
      result.issues.push('No authenticated user found');
      result.isHealthy = false;
    }

    // Check if tables exist by trying simple queries
    const tableChecks = [
      { name: 'profiles', query: supabase.from('profiles').select('id').limit(1) },
      { name: 'tracks', query: supabase.from('tracks').select('id').limit(1) },
      { name: 'folders', query: supabase.from('folders').select('id').limit(1) },
    ];

    for (const check of tableChecks) {
      try {
        const { error } = await check.query;
        
        if (error) {
          if (error.code === 'PGRST205') {
            result.issues.push(`Table '${check.name}' does not exist`);
            result.isHealthy = false;
          } else if (error.code === '42501') {
            // Permission denied - table exists but RLS is working
            result.tables[check.name as keyof typeof result.tables] = true;
          } else {
            result.issues.push(`Table '${check.name}' error: ${error.message}`);
            result.isHealthy = false;
          }
        } else {
          result.tables[check.name as keyof typeof result.tables] = true;
        }
      } catch (err) {
        result.issues.push(`Failed to check table '${check.name}': ${err instanceof Error ? err.message : 'Unknown error'}`);
        result.isHealthy = false;
      }
    }

    // If user is authenticated, try a simple operation
    if (result.authentication.hasUser && result.tables.tracks) {
      try {
        const { error } = await supabase
          .from('tracks')
          .select('id')
          .limit(1);
        
        if (error && error.code !== '42501') {
          result.issues.push(`Database access error: ${error.message}`);
          result.isHealthy = false;
        }
      } catch (err) {
        result.issues.push(`Database operation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        result.isHealthy = false;
      }
    }

  } catch (err) {
    result.issues.push(`Health check failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    result.isHealthy = false;
  }

  return result;
}

export function logDatabaseHealth(health: DatabaseHealthCheck) {
  console.log('=== DATABASE HEALTH CHECK ===');
  console.log('Overall Health:', health.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY');
  
  console.log('\nAuthentication:');
  console.log('- Has User:', health.authentication.hasUser ? '✅' : '❌');
  if (health.authentication.userId) {
    console.log('- User ID:', health.authentication.userId);
  }
  if (health.authentication.userEmail) {
    console.log('- User Email:', health.authentication.userEmail);
  }
  
  console.log('\nTables:');
  console.log('- Profiles:', health.tables.profiles ? '✅' : '❌');
  console.log('- Tracks:', health.tables.tracks ? '✅' : '❌');
  console.log('- Folders:', health.tables.folders ? '✅' : '❌');
  
  if (health.issues.length > 0) {
    console.log('\nIssues:');
    health.issues.forEach((issue, index) => {
      console.log(`${index + 1}. ${issue}`);
    });
  }
  
  if (!health.isHealthy) {
    console.log('\n🔧 SOLUTION:');
    console.log('Run the supabase_schema.sql file in your Supabase SQL Editor');
    console.log('1. Go to https://supabase.com/dashboard');
    console.log('2. Select your project');
    console.log('3. Go to SQL Editor');
    console.log('4. Create new query and paste supabase_schema.sql contents');
    console.log('5. Run the query to create all tables and policies');
  }
  
  console.log('==============================');
}