import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

interface MigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMigrationComplete: () => void;
}

export function MigrationModal({ isOpen, onClose, onMigrationComplete }: MigrationModalProps) {
  const { user } = useAuth();
  const { t } = useTranslation(['auth', 'common']);
  const [migrationState, setMigrationState] = useState<'idle' | 'checking' | 'migrating' | 'success' | 'error'>('idle');
  const [migrationResults, setMigrationResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLocalData, setHasLocalData] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      checkForLocalData();
    }
  }, [isOpen, user]);

  const checkForLocalData = () => {
    if (typeof localStorage === 'undefined') {
      setHasLocalData(false);
      return;
    }

    const tracksData = localStorage.getItem('strudel_tracks');
    const foldersData = localStorage.getItem('strudel_folders');
    
    const hasData = (tracksData && tracksData !== '{}') || (foldersData && foldersData !== '{}');
    setHasLocalData(hasData);
  };

  const handleMigration = async () => {
    if (!user) return;

    setMigrationState('checking');
    setError(null);

    try {
      // Check if user has already migrated via API
      const statusResponse = await fetch('/api/migration/status', {
        method: 'GET',
        credentials: 'include', // Include cookies
      });

      const statusResult = await statusResponse.json();

      if (!statusResponse.ok) {
        throw new Error(statusResult.error || 'Failed to check migration status');
      }
      
      if (statusResult.hasMigrated) {
        setMigrationState('success');
        setMigrationResults({ tracks: { success: 0 }, folders: { success: 0 } });
        return;
      }

      setMigrationState('migrating');

      // Get data from localStorage
      const tracksData = localStorage.getItem('strudel_tracks');
      const foldersData = localStorage.getItem('strudel_folders');

      const tracks = tracksData ? Object.values(JSON.parse(tracksData)) : [];
      const folders = foldersData ? Object.values(JSON.parse(foldersData)) : [];

      // Perform migration via API
      const migrationResponse = await fetch('/api/migration/migrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies
        body: JSON.stringify({ tracks, folders })
      });

      const migrationResult = await migrationResponse.json();

      if (!migrationResponse.ok) {
        throw new Error(migrationResult.error || 'Migration failed');
      }

      const results = migrationResult.results;
      setMigrationResults(results);

      // Check if migration was successful
      const hasErrors = results.tracks.errors.length > 0 || results.folders.errors.length > 0;
      
      if (hasErrors) {
        setMigrationState('error');
        setError('Some items could not be migrated. Please check the console for details.');
        console.error('Migration errors:', results);
      } else {
        setMigrationState('success');
        // Clear localStorage after successful migration
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('strudel_tracks');
          localStorage.removeItem('strudel_folders');
        }
        onMigrationComplete();
      }
    } catch (err) {
      console.error('Migration failed:', err);
      setMigrationState('error');
      setError(err instanceof Error ? err.message : 'Migration failed');
    }
  };

  const handleSkipMigration = () => {
    // Mark as migrated to avoid showing this modal again
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('strudel_migrated_to_supabase', 'true');
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-background text-foreground rounded-lg max-w-md w-full p-6 border border-lineHighlight">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('auth:migration.title')}
            </h2>
            <p className="text-sm text-foreground opacity-70">
              {t('auth:migration.subtitle')}
            </p>
          </div>
        </div>

        {migrationState === 'idle' && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  {hasLocalData ? (
                    <div>
                      <p className="font-medium mb-1">{t('auth:migration.hasLocalData')}</p>
                      <p>{t('auth:migration.migrationDescription')}</p>
                    </div>
                  ) : (
                    <p>{t('auth:migration.noLocalData')}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              {hasLocalData ? (
                <>
                  <button
                    onClick={handleMigration}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                  >
                    {t('auth:migration.migrate')}
                  </button>
                  <button
                    onClick={handleSkipMigration}
                    className="px-4 py-2 text-foreground opacity-70 hover:opacity-100 transition-opacity duration-200"
                  >
                    {t('auth:migration.skip')}
                  </button>
                </>
              ) : (
                <button
                  onClick={onClose}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                >
                  {t('common:close')}
                </button>
              )}
            </div>
          </div>
        )}

        {migrationState === 'checking' && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-foreground opacity-70">{t('auth:migration.checking')}</p>
          </div>
        )}

        {migrationState === 'migrating' && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-foreground opacity-70">{t('auth:migration.migrating')}</p>
          </div>
        )}

        {migrationState === 'success' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t('auth:migration.success')}
              </h3>
              {migrationResults && (
                <div className="text-sm text-foreground opacity-70 space-y-1">
                  <p>{t('auth:migration.migratedTracks', { count: migrationResults.tracks.success })}</p>
                  <p>{t('auth:migration.migratedFolders', { count: migrationResults.folders.success })}</p>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
            >
              {t('common:continue')}
            </button>
          </div>
        )}

        {migrationState === 'error' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t('auth:migration.error')}
              </h3>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleMigration}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {t('auth:migration.retry')}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-foreground opacity-70 hover:opacity-100 transition-opacity duration-200"
              >
                {t('common:close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}