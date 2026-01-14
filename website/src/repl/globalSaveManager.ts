/**
 * Global Save Manager - URL-Based Version
 * 
 * Provides a global interface for emergency saves that can be accessed
 * from anywhere in the application, especially beforeunload handlers.
 * Uses URL as the source of truth for track ID instead of state management.
 */

import { URLParser } from '../routing/URLParser';

interface SaveManager {
  fileManagerHook: any;
  context: any;
}

class GlobalSaveManager {
  private saveManager: SaveManager | null = null;
  private isSaving = false;

  /**
   * Register the current file manager and context
   */
  register(fileManagerHook: any, context: any) {
    this.saveManager = { fileManagerHook, context };
    console.log('GlobalSaveManager: Registered file manager and context');
  }

  /**
   * Unregister the current save manager
   */
  unregister() {
    this.saveManager = null;
    console.log('GlobalSaveManager: Unregistered save manager');
  }

  /**
   * Get current track identifier from URL (source of truth)
   */
  private getCurrentTrackIdentifierFromURL(): string | null {
    if (typeof window === 'undefined') return null;
    return URLParser.getCurrentTrackIdentifier();
  }

  /**
   * Check if there are unsaved changes - URL-based
   */
  hasUnsavedChanges(): boolean {
    if (!this.saveManager) return false;

    try {
      const { fileManagerHook, context } = this.saveManager;
      
      if (!fileManagerHook || !context) return false;

      // Get track identifier from URL (source of truth)
      const currentTrackId = this.getCurrentTrackIdentifierFromURL();
      if (!currentTrackId) return false;

      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      if (!currentCode.trim()) return false;

      const currentTracks = fileManagerHook.tracks || {};
      const trackData = currentTracks[currentTrackId];

      if (!trackData) {
        // Track not found in state - might be a new track or loading
        console.log('GlobalSaveManager: Track not found in state:', currentTrackId);
        return false;
      }

      const hasChanges = currentCode !== trackData.code;
      
      if (hasChanges) {
        console.log('GlobalSaveManager: Unsaved changes detected', {
          trackId: currentTrackId,
          trackName: trackData.name,
          currentLength: currentCode.length,
          savedLength: trackData.code.length
        });
      }

      return hasChanges;
    } catch (error) {
      console.error('GlobalSaveManager: Error checking unsaved changes:', error);
      return false;
    }
  }

  /**
   * Perform emergency save - URL-based
   */
  async performEmergencySave(): Promise<boolean> {
    if (!this.saveManager || this.isSaving) {
      return false;
    }

    this.isSaving = true;

    try {
      const { fileManagerHook, context } = this.saveManager;
      
      if (!fileManagerHook || !context) {
        console.log('GlobalSaveManager: No file manager or context available');
        return false;
      }

      // Get track ID from URL (source of truth)
      const currentTrackId = this.getCurrentTrackIdentifierFromURL();
      if (!currentTrackId) {
        console.log('GlobalSaveManager: No track ID in URL');
        return true; // Not an error, just nothing to save
      }

      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      if (!currentCode.trim()) {
        console.log('GlobalSaveManager: No code to save');
        return true; // Not an error, just nothing to save
      }

      // Check if track exists in state
      const currentTracks = fileManagerHook.tracks || {};
      const trackData = currentTracks[currentTrackId];
      
      if (!trackData) {
        console.warn('GlobalSaveManager: Track not found in state:', currentTrackId);
        return false;
      }

      // Check if code has actually changed
      if (currentCode === trackData.code) {
        console.log('GlobalSaveManager: No changes detected');
        return true; // No changes, success
      }

      console.log('🚨 GlobalSaveManager: Emergency save in progress', {
        trackId: currentTrackId,
        trackName: trackData.name,
        codeLength: currentCode.length,
        source: 'URL-based'
      });

      // Perform the save using URL-based track ID
      let result = false;
      
      if (fileManagerHook.saveSpecificTrack) {
        result = await fileManagerHook.saveSpecificTrack(currentTrackId, false);
      } else if (fileManagerHook.saveCurrentTrack && fileManagerHook.selectedTrack === currentTrackId) {
        // Only use saveCurrentTrack if the selected track matches URL
        result = await fileManagerHook.saveCurrentTrack(false);
      } else {
        console.warn('GlobalSaveManager: No suitable save method available');
        return false;
      }
      
      if (result) {
        console.log('✅ GlobalSaveManager: Emergency save successful (URL-based)');
      } else {
        console.error('❌ GlobalSaveManager: Emergency save failed (URL-based)');
      }
      
      return result;
      
    } catch (error) {
      console.error('GlobalSaveManager: Emergency save error:', error);
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Get current save status
   */
  getStatus() {
    const currentTrackId = this.getCurrentTrackIdentifierFromURL();
    return {
      isRegistered: !!this.saveManager,
      isSaving: this.isSaving,
      hasUnsavedChanges: this.hasUnsavedChanges(),
      currentTrackId,
      source: 'URL-based'
    };
  }
}

// Global instance
export const globalSaveManager = new GlobalSaveManager();

// Setup global beforeunload handler
if (typeof window !== 'undefined') {
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (globalSaveManager.hasUnsavedChanges()) {
      console.log('🚨 Global beforeunload: Unsaved changes detected (URL-based)');
      
      // Show browser confirmation
      const message = 'You have unsaved changes. Are you sure you want to leave?';
      event.preventDefault();
      event.returnValue = message;
      
      // Attempt emergency save (non-blocking)
      globalSaveManager.performEmergencySave().then(success => {
        console.log('Global beforeunload: Emergency save result (URL-based):', success);
      }).catch(error => {
        console.error('Global beforeunload: Emergency save error:', error);
      });
      
      return message;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden' && globalSaveManager.hasUnsavedChanges()) {
      console.log('🚨 Global visibilitychange: Performing emergency save (URL-based)');
      globalSaveManager.performEmergencySave();
    }
  };

  const handlePageHide = () => {
    if (globalSaveManager.hasUnsavedChanges()) {
      console.log('🚨 Global pagehide: Performing emergency save (URL-based)');
      globalSaveManager.performEmergencySave();
    }
  };

  // Add global event listeners
  window.addEventListener('beforeunload', handleBeforeUnload);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  
  console.log('GlobalSaveManager: Global event listeners registered (URL-based)');
}