import { supabase } from './supabase';

export interface DatabaseInitResult {
  success: boolean;
  tablesExist: boolean;
  error?: string;
  needsManualSetup: boolean;
}

export async function initializeDatabase(): Promise<DatabaseInitResult> {
  try {
    console.log('🔍 Checking database initialization...');

    // Check if user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        tablesExist: false,
        error: 'User not authenticated',
        needsManualSetup: false,
      };
    }

    // Try to check if tables exist by attempting simple queries
    const tableChecks = [
      { name: 'profiles', exists: false },
      { name: 'tracks', exists: false },
      { name: 'folders', exists: false },
    ];

    for (const table of tableChecks) {
      try {
        const { error } = await supabase.from(table.name).select('id').limit(1);

        if (!error) {
          table.exists = true;
        } else if (error.code === '42501') {
          // Permission denied means table exists but RLS is working
          table.exists = true;
        } else if (error.code === 'PGRST205') {
          // Table doesn't exist
          table.exists = false;
        }
      } catch (e) {
        console.warn(`Could not check table ${table.name}:`, e);
        table.exists = false;
      }
    }

    const allTablesExist = tableChecks.every((table) => table.exists);
    const existingTables = tableChecks.filter((table) => table.exists).map((table) => table.name);

    console.log('📊 Database status:', {
      allTablesExist,
      existingTables,
      missingTables: tableChecks.filter((table) => !table.exists).map((table) => table.name),
    });

    if (allTablesExist) {
      console.log('✅ Database is properly initialized');
      return {
        success: true,
        tablesExist: true,
        needsManualSetup: false,
      };
    } else {
      console.log('❌ Database needs manual setup');
      return {
        success: false,
        tablesExist: false,
        error: 'Database tables not found',
        needsManualSetup: true,
      };
    }
  } catch (error) {
    console.error('❌ Database initialization check failed:', error);
    return {
      success: false,
      tablesExist: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      needsManualSetup: true,
    };
  }
}

export function showSetupInstructions() {
  console.log('');
  console.log('🔧 DATABASE SETUP REQUIRED');
  console.log('═══════════════════════════');
  console.log('');
  console.log('The database tables need to be created manually.');
  console.log('This is a one-time setup that takes 2 minutes.');
  console.log('');
  console.log('📋 SETUP STEPS:');
  console.log('1. Go to: https://supabase.com/dashboard');
  console.log('2. Select your project');
  console.log('3. Click "SQL Editor" → "New query"');
  console.log('4. Copy the entire supabase_schema.sql file');
  console.log('5. Paste and click "Run"');
  console.log('6. Refresh this page');
  console.log('');
  console.log('📄 Schema file location: supabase_schema.sql (project root)');
  console.log('');
  console.log('✅ After setup: All users can use the app immediately');
  console.log('');
}
