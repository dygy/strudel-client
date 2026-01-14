/**
 * Strict File Manager Wrapper
 * 
 * This component wraps the existing file manager with the strict autosave system
 * to prevent cross-track code contamination while maintaining compatibility.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { useStrictFileManager } from './hooks/useStrictFileManager';
import { FileManagerRefactored } from './FileManagerRefactored';

interface StrictFileManagerWrapperProps {
  context: any; // ReplContext
  ssrData?: {
    tracks: any[];
    folders: any[];
  } | null;
  fileManagerHook?: any; // Existing file manager hook for compatibility
}

export function StrictFileManagerWrapper({ 
  context, 
  ssrData, 
  fileManagerHook 
}: StrictFileManagerWrapperProps) {
  
  // Determine storage backend based on available hooks
  const storageBackend = fileManagerHook?.user ? 'supabase' : 'localStorage';
  
  // Create Supabase operations if needed
  const supabaseOperations = fileManagerHook?.user ? {
    saveTracks: async (tracks: Record<string, any>) => {
      // Implementation would depend on existing Supabase operations
      console.log('StrictFileManagerWrapper: Saving tracks to Supabase', Object.keys(tracks).length);
    },
    loadTracks: async () => {
      return fileManagerHook?.tracks || {};
    },
    saveTrack: async (trackId: string, code: string) => {
      return await fileManagerHook?.saveSpecificTrack?.(trackId, false) || false;
    }
  } : undefined;

  // Initialize strict file manager
  const strictFileManager = useStrictFileManager({
    context,
    storageBackend,
    supabaseOperations
  });

  // Ref to track code changes
  const lastCodeRef = useRef<string>('');
  const codeChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Monitor code changes in the editor
   */
  const monitorCodeChanges = useCallback(() => {
    const currentCode = context.editorRef?.current?.code || context.activeCode || '';
    
    if (currentCode !== lastCodeRef.current) {
      lastCodeRef.current = currentCode;
      
      // Debounce code change handling
      if (codeChangeTimeoutRef.current) {
        clearTimeout(codeChangeTimeoutRef.current);
      }
      
      codeChangeTimeoutRef.current = setTimeout(() => {
        strictFileManager.handleCodeChange();
      }, 500); // 500ms debounce
    }
  }, [context, strictFileManager]);

  // Set up code change monitoring
  useEffect(() => {
    const interval = setInterval(monitorCodeChanges, 1000); // Check every second
    return () => {
      clearInterval(interval);
      if (codeChangeTimeoutRef.current) {
        clearTimeout(codeChangeTimeoutRef.current);
      }
    };
  }, [monitorCodeChanges]);

  // Enhanced context with strict autosave
  const enhancedContext = {
    ...context,
    strictFileManager,
    
    // Override handleUpdate to trigger autosave scheduling
    handleUpdate: (data: any, reset?: boolean) => {
      const result = context.handleUpdate(data, reset);
      
      // Schedule autosave after code update
      setTimeout(() => {
        strictFileManager.handleCodeChange();
      }, 100);
      
      return result;
    }
  };

  // Debug panel (only in development)
  const DebugPanel = () => {
    if (process.env.NODE_ENV !== 'development') return null;
    
    const debugInfo = strictFileManager.getDebugInfo();
    
    return (
      <div style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontSize: '12px',
        fontFamily: 'monospace',
        zIndex: 10000,
        maxWidth: '300px'
      }}>
        <div><strong>Strict Autosave Debug</strong></div>
        {debugInfo ? (
          <>
            <div>Track: {debugInfo.trackName} ({debugInfo.trackId})</div>
            <div>Code Length: {debugInfo.codeLength}</div>
            <div>Has Context: {debugInfo.autosave.hasContext ? '✓' : '✗'}</div>
            <div>Is Autosaving: {debugInfo.autosave.isAutosaving ? '✓' : '✗'}</div>
            <div>Has Timer: {debugInfo.autosave.hasTimer ? '✓' : '✗'}</div>
            <div>Last Saved: {debugInfo.autosave.lastSavedLength} chars</div>
            <div>Fingerprint: {debugInfo.autosave.fingerprint.slice(0, 8)}...</div>
          </>
        ) : (
          <div>No active track</div>
        )}
        <div style={{ marginTop: '5px', fontSize: '10px', opacity: 0.7 }}>
          Backend: {storageBackend}
        </div>
      </div>
    );
  };

  return (
    <>
      <FileManagerRefactored 
        context={enhancedContext}
        fileManagerHook={fileManagerHook}
      />
      <DebugPanel />
    </>
  );
}