import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { AuthInitializer } from '../../components/auth/AuthInitializer';
import ReplEditor from './ReplEditor';
import { useSupabaseFileManager } from './sidebar/hooks/useSupabaseFileManager';
import { useReplContext } from '../useReplContext';
import type { SSRData } from '@src/types/ssr';

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
  context?: ReplContext; // Make context optional since we'll create our own
  ssrData?: SSRData | null;
  readOnly?: boolean;
}

function AuthenticatedReplContent({ context: externalContext, ssrData, readOnly = false, ...editorProps }: AuthenticatedReplEditorProps) {
  const { isAuthenticated, loading } = useAuth();

  // Create standard REPL context with readOnly option
  const replContext = useReplContext({ readOnly });

  // Always call the hook - it will handle authentication state internally
  const supabaseFileManager = useSupabaseFileManager(replContext, ssrData);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Require authentication - redirect to login if not authenticated
  if (!isAuthenticated) {
    // This should not happen due to server-side redirect, but handle it as fallback
    window.location.href = '/login';
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // Only authenticated users can access the REPL - always use Supabase storage
  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      {/* Sync Error Display */}
      {supabaseFileManager && typeof supabaseFileManager === 'object' && supabaseFileManager.isAuthenticated && supabaseFileManager.syncError && (
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

      {/* Main REPL Editor - always use Supabase FileManager for authenticated users */}
      <ReplEditor
        context={replContext}
        fileManagerHook={supabaseFileManager}
        ssrData={ssrData}
        readOnly={readOnly}
        {...editorProps}
      />
    </div>
  );
}

export default function AuthenticatedReplEditor(props: AuthenticatedReplEditorProps) {
  return (
    <>
      <AuthInitializer />
      <AuthenticatedReplContent {...props} />
    </>
  );
}
