/**
 * Emergency Save Hook
 * 
 * Provides emergency save functionality that can be called from beforeunload
 * or other critical moments to prevent data loss.
 */

import { useCallback, useRef } from 'react';

interface EmergencySaveOptions {
  getFileManagerHook: () => any;
  getContext: () => any;
  timeout?: number;
}

export function useEmergencySave(options: EmergencySaveOptions) {
  const { getFileManagerHook, getContext, timeout = 1500 } = options;
  const isSavingRef = useRef(false);

  /**
   * Perform emergency save with timeout
   */
  const performEmergencySave = useCallback(async (): Promise<boolean> => {
    if (isSavingRef.current) {
      console.log('EmergencySave: Already saving, skipping');
      return false;
    }

    isSavingRef.current = true;
    
    try {
      const fileManagerHook = getFileManagerHook();
      const context = getContext();
      
      if (!fileManagerHook || !context) {
        console.log('EmergencySave: No file manager or context available');
        return false;
      }

      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      const selectedTrack = fileManagerHook.selectedTrack;
      
      if (!selectedTrack || !currentCode.trim()) {
        console.log('EmergencySave: No track selected or no code to save');
        return true; // Not an error, just nothing to save
      }

      // Check if code has changed
      const currentTracks = fileManagerHook.tracks || {};
      const trackData = currentTracks[selectedTrack];
      
      if (!trackData) {
        console.warn('EmergencySave: Selected track not found');
        return false;
      }

      if (currentCode === trackData.code) {
        console.log('EmergencySave: No changes detected');
        return true; // No changes, success
      }

      console.log('🚨 EmergencySave: Saving changes before unload', {
        trackId: selectedTrack,
        trackName: trackData.name,
        codeLength: currentCode.length
      });

      // Create a promise with timeout
      const savePromise = new Promise<boolean>(async (resolve) => {
        try {
          let result = false;
          
          if (fileManagerHook.saveCurrentTrack) {
            result = await fileManagerHook.saveCurrentTrack(false);
          } else if (fileManagerHook.saveSpecificTrack) {
            result = await fileManagerHook.saveSpecificTrack(selectedTrack, false);
          }
          
          resolve(result);
        } catch (error) {
          console.error('EmergencySave: Save error:', error);
          resolve(false);
        }
      });

      // Race against timeout
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => {
          console.warn('EmergencySave: Timeout reached');
          resolve(false);
        }, timeout);
      });

      const result = await Promise.race([savePromise, timeoutPromise]);
      
      if (result) {
        console.log('✅ EmergencySave: Successfully saved');
      } else {
        console.error('❌ EmergencySave: Failed to save');
      }
      
      return result;
      
    } catch (error) {
      console.error('EmergencySave: Critical error:', error);
      return false;
    } finally {
      isSavingRef.current = false;
    }
  }, [getFileManagerHook, getContext, timeout]);

  /**
   * Check if there are unsaved changes
   */
  const hasUnsavedChanges = useCallback((): boolean => {
    try {
      const fileManagerHook = getFileManagerHook();
      const context = getContext();
      
      if (!fileManagerHook || !context) return false;

      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      const selectedTrack = fileManagerHook.selectedTrack;
      const currentTracks = fileManagerHook.tracks || {};
      const trackData = currentTracks[selectedTrack];

      return !!(selectedTrack && trackData && currentCode && currentCode !== trackData.code);
    } catch (error) {
      console.error('EmergencySave: Error checking unsaved changes:', error);
      return false;
    }
  }, [getFileManagerHook, getContext]);

  return {
    performEmergencySave,
    hasUnsavedChanges,
    isSaving: isSavingRef.current
  };
}