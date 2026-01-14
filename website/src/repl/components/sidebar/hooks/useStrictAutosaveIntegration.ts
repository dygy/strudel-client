/**
 * Strict Autosave Integration
 *
 * This hook provides a simple way to integrate the strict autosave system
 * with existing file managers, ensuring backward compatibility while
 * preventing cross-track code contamination.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useSettings } from '@src/settings';
import { migration } from '@src/lib/secureApi.ts';

interface StrictAutosaveIntegrationOptions {
  fileManagerHook: any; // The existing file manager hook
  context: any; // ReplContext
  enableDebugMode?: boolean;
}

export function useStrictAutosaveIntegration(options: StrictAutosaveIntegrationOptions) {
  const { fileManagerHook, context, enableDebugMode = false } = options;

  // Settings
  const { isAutosaveEnabled, autosaveInterval } = useSettings();

  // Track the last code change to trigger autosave
  const lastCodeRef = useRef<string>('');
  const codeChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Monitor code changes and trigger autosave
   */
  const monitorCodeChanges = useCallback(() => {
    if (!isAutosaveEnabled || !fileManagerHook?.selectedTrack) return;

    const currentCode = context.editorRef?.current?.code || context.activeCode || '';

    if (currentCode !== lastCodeRef.current) {
      lastCodeRef.current = currentCode;

      // Clear existing timeout
      if (codeChangeTimeoutRef.current) {
        clearTimeout(codeChangeTimeoutRef.current);
      }

      // Debounce code changes
      codeChangeTimeoutRef.current = setTimeout(() => {
        if (fileManagerHook?.handleCodeChange) {
          fileManagerHook.handleCodeChange();
        } else if (fileManagerHook?.scheduleTrackAutosave) {
          fileManagerHook.scheduleTrackAutosave(fileManagerHook.selectedTrack);
        }
      }, 500); // 500ms debounce
    }
  }, [isAutosaveEnabled, fileManagerHook, context]);

  /**
   * Set up code change monitoring
   */
  useEffect(() => {
    if (!isAutosaveEnabled) return;

    const interval = setInterval(monitorCodeChanges, 1000); // Check every second

    return () => {
      clearInterval(interval);
      if (codeChangeTimeoutRef.current) {
        clearTimeout(codeChangeTimeoutRef.current);
      }
    };
  }, [monitorCodeChanges, isAutosaveEnabled]);

  /**
   * Enhanced save function with validation
   */
  const enhancedSave = useCallback(async (showToast: boolean = true) => {
    if (!fileManagerHook?.selectedTrack) {
      console.warn('StrictAutosaveIntegration: No track selected for save');
      return false;
    }

    // Use the file manager's save function if it has strict autosave
    if (fileManagerHook.saveCurrentTrack) {
      return await fileManagerHook.saveCurrentTrack(showToast);
    }

    // Fallback to basic save
    console.warn('StrictAutosaveIntegration: Using fallback save method');
    return false;
  }, [fileManagerHook]);

  /**
   * Get debug information
   */
  const getDebugInfo = useCallback(() => {
    const fileManagerDebug = fileManagerHook?.getDebugInfo?.();

    return {
      fileManager: fileManagerDebug,
      integration: {
        isAutosaveEnabled,
        autosaveInterval,
        selectedTrack: fileManagerHook?.selectedTrack,
        hasStrictAutosave: !!fileManagerHook?.scheduleTrackAutosave,
        lastCodeLength: lastCodeRef.current.length
      }
    };
  }, [fileManagerHook, isAutosaveEnabled, autosaveInterval]);

  /**
   * Force save current track
   */
  const forceSave = useCallback(async () => {
    return await enhancedSave(true);
  }, [enhancedSave]);

  /**
   * Check if strict autosave is properly integrated
   */
  const isStrictAutosaveActive = useCallback(() => {
    return !!(
      fileManagerHook?.scheduleTrackAutosave &&
      fileManagerHook?.getTrackAutosaveContext &&
      fileManagerHook?.cleanupTrackAutosaveContext
    );
  }, [fileManagerHook]);

  // Set up keyboard save handler
  useEffect(() => {
    const handleSave = () => {
      console.log('StrictAutosaveIntegration: Handling save event');
      enhancedSave(true);
    };

    document.addEventListener('strudel-save', handleSave as EventListener);
    return () => document.removeEventListener('strudel-save', handleSave as EventListener);
  }, [enhancedSave]);

  // Log integration status in development
  useEffect(() => {
    if (enableDebugMode) {
      console.log('StrictAutosaveIntegration: Integration status', {
        isStrictAutosaveActive: isStrictAutosaveActive(),
        isAutosaveEnabled,
        selectedTrack: fileManagerHook?.selectedTrack,
        hasFileManager: !!fileManagerHook
      });
    }
  }, [enableDebugMode, isStrictAutosaveActive, isAutosaveEnabled, fileManagerHook]);

  return {
    // Status
    isStrictAutosaveActive: isStrictAutosaveActive(),
    isAutosaveEnabled,
    autosaveInterval,

    // Actions
    forceSave,
    enhancedSave,

    // Debug
    getDebugInfo,
  };
}
