import React from 'react';
import { AuthProvider } from '../../contexts/AuthContext';
import { AuthButton } from '../../components/auth/AuthButton';
import { MigrationModal } from '../../components/auth/MigrationModal';
import ReplEditor from './ReplEditor';
import { useAuth } from '../../contexts/AuthContext';
import { useSupabaseFileManager } from './sidebar/hooks/useSupabaseFileManager';
import { FileManagerRefactored as FileManager } from './sidebar/FileManagerRefactored';
import { ResizableSidebar } from './sidebar/ResizableSidebar';
import { useSettings } from '@src/settings';
import { useTranslation } from 'react-i18next';

interface ReplContext {
  containerRef: React.RefObject<HTMLDivElement>;
  editorRef: React.RefObject<any>;
  error?: Error | null;
  init: () => void;
  pending?: boolean;
  started?: boolean;
  isDirty?: boolean;
  activeCode?: string;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
  handleUpdate: (data: any, reset?: boolean) => void;
  trackRouter?: any;
}

interface AuthenticatedReplEditorProps extends React.HTMLAttributes<HTMLDivElement> {
  context: ReplContext;
}

function AuthenticatedReplContent({ context, ...editorProps }: AuthenticatedReplEditorProps) {
  const { isAuthenticated, loading } = useAuth();
  const settings = useSettings();
  const { isZen, isFileManagerOpen } = settings;
  const { t } = useTranslation('auth');
  
  // Always call the hook - it will handle authentication state internally
  const supabaseFileManager = useSupabaseFileManager(context);

  // Check if there's a track parameter in the URL
  React.useEffect(() => {
    if (!loading && !isAuthenticated) {
      // Store the current URL for redirect after authentication
      const currentUrl = window.location.href;
      sessionStorage.setItem('strudel_redirect_after_auth', currentUrl);
      
      console.log('User needs to login to access Strudel');
    }
  }, [loading, isAuthenticated]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Allow unauthenticated users to use the app with localStorage
  // Only show login prompt for track URLs that require authentication
  if (!isAuthenticated) {
    const urlParams = new URLSearchParams(window.location.search);
    const trackParam = urlParams.get('track');
    
    // Only require authentication for specific track URLs
    if (trackParam) {
      return (
        <div className="h-full flex items-center justify-center bg-gray-50">
          <div className="max-w-md mx-auto text-center p-8 bg-white rounded-lg shadow-lg">
            <div className="mb-6">
              <svg className="w-16 h-16 mx-auto text-blue-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {t('trackAccess.title')}
              </h2>
              <p className="text-gray-600 mb-6">
                {t('trackAccess.description')}
              </p>
            </div>
            
            <div className="space-y-4">
              <AuthButton />
              <button
                onClick={() => {
                  // Clear track parameter and continue without authentication
                  const newUrl = new URL(window.location.href);
                  newUrl.searchParams.delete('track');
                  window.history.replaceState({}, '', newUrl.toString());
                  window.location.reload();
                }}
                className="w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Continue without signing in
              </button>
              <p className="text-sm text-gray-500">
                {t('trackAccess.redirectMessage')}
              </p>
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      {/* Migration Modal */}
      {isAuthenticated && supabaseFileManager && typeof supabaseFileManager === 'object' && supabaseFileManager.isAuthenticated && (
        <MigrationModal
          isOpen={supabaseFileManager.showMigrationModal}
          onClose={() => supabaseFileManager.setShowMigrationModal(false)}
          onMigrationComplete={supabaseFileManager.handleMigrationComplete}
        />
      )}

      {/* Sync Error Display */}
      {isAuthenticated && supabaseFileManager && typeof supabaseFileManager === 'object' && supabaseFileManager.isAuthenticated && supabaseFileManager.syncError && (
        <div className="absolute top-16 right-4 z-40 bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-lg max-w-sm">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm">Sync Error: {supabaseFileManager.syncError}</span>
            <button
              onClick={() => supabaseFileManager.loadDataFromSupabase && supabaseFileManager.loadDataFromSupabase()}
              className="ml-2 text-xs underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Main REPL Editor */}
      <ReplEditor context={context} {...editorProps} />

      {/* Override FileManager with Supabase version when authenticated */}
      {isAuthenticated && supabaseFileManager && typeof supabaseFileManager === 'object' && supabaseFileManager.isAuthenticated && !isZen && isFileManagerOpen && (
        <div className="absolute left-0 top-0 bottom-0 z-30">
          <ResizableSidebar defaultWidth={300} minWidth={200} maxWidth={500}>
            <FileManager 
              context={context}
              fileManagerHook={supabaseFileManager}
            />
          </ResizableSidebar>
        </div>
      )}
    </div>
  );
}

export default function AuthenticatedReplEditor(props: AuthenticatedReplEditorProps) {
  return (
    <AuthProvider>
      <AuthenticatedReplContent {...props} />
    </AuthProvider>
  );
}