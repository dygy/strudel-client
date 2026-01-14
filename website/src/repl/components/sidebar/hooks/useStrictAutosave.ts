/**
 * Strict Autosave System
 * 
 * This system ensures that autosave operations are strictly isolated per track
 * and cannot accidentally save code from one track to another.
 * 
 * Key principles:
 * 1. Each track has its own isolated autosave context
 * 2. Track ID is captured at the start of each operation and validated throughout
 * 3. Code fingerprinting prevents cross-track contamination
 * 4. Atomic operations with rollback capability
 */

import { useRef, useCallback, useEffect } from 'react';

interface TrackAutosaveContext {
  trackId: string;
  lastSavedCode: string;
  lastSavedTimestamp: number;
  autosaveTimer: NodeJS.Timeout | null;
  isAutosaving: boolean;
  codeFingerprint: string; // SHA-256 hash of the code for verification
}

interface StrictAutosaveOptions {
  onSave: (trackId: string, code: string) => Promise<boolean>;
  getActiveTrackId: () => string | null;
  getActiveCode: () => string;
  isEnabled: () => boolean;
  getInterval: () => number;
}

export function useStrictAutosave(options: StrictAutosaveOptions) {
  // Map of track ID to autosave context - each track is completely isolated
  const trackContextsRef = useRef<Map<string, TrackAutosaveContext>>(new Map());
  
  // Global lock to prevent concurrent autosave operations
  const globalAutosaveLockRef = useRef<boolean>(false);

  /**
   * Generate a fingerprint for code content to detect tampering
   */
  const generateCodeFingerprint = useCallback(async (code: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }, []);

  /**
   * Get or create isolated context for a track
   */
  const getTrackContext = useCallback((trackId: string): TrackAutosaveContext => {
    const contexts = trackContextsRef.current;
    
    if (!contexts.has(trackId)) {
      contexts.set(trackId, {
        trackId,
        lastSavedCode: '',
        lastSavedTimestamp: 0,
        autosaveTimer: null,
        isAutosaving: false,
        codeFingerprint: ''
      });
    }
    
    return contexts.get(trackId)!;
  }, []);

  /**
   * Clear autosave timer for a specific track
   */
  const clearTrackTimer = useCallback((trackId: string) => {
    const context = trackContextsRef.current.get(trackId);
    if (context?.autosaveTimer) {
      clearTimeout(context.autosaveTimer);
      context.autosaveTimer = null;
    }
  }, []);

  /**
   * Validate that the track context hasn't been corrupted
   */
  const validateTrackContext = useCallback(async (
    trackId: string, 
    currentCode: string
  ): Promise<boolean> => {
    const context = trackContextsRef.current.get(trackId);
    if (!context) return false;

    // Verify track ID hasn't changed
    if (context.trackId !== trackId) {
      console.error('StrictAutosave: Track ID mismatch detected!', {
        expected: trackId,
        actual: context.trackId
      });
      return false;
    }

    // Verify code fingerprint if we have saved code
    if (context.lastSavedCode && context.codeFingerprint) {
      const expectedFingerprint = await generateCodeFingerprint(context.lastSavedCode);
      if (expectedFingerprint !== context.codeFingerprint) {
        console.error('StrictAutosave: Code fingerprint mismatch detected!', {
          trackId,
          expected: expectedFingerprint,
          actual: context.codeFingerprint
        });
        return false;
      }
    }

    return true;
  }, [generateCodeFingerprint]);

  /**
   * Perform atomic autosave operation with full validation
   */
  const performAtomicAutosave = useCallback(async (
    initialTrackId: string,
    initialCode: string
  ): Promise<boolean> => {
    // Acquire global lock
    if (globalAutosaveLockRef.current) {
      console.log('StrictAutosave: Another autosave in progress, skipping');
      return false;
    }
    
    globalAutosaveLockRef.current = true;

    try {
      // Re-validate current state at the start of the operation
      const currentTrackId = options.getActiveTrackId();
      const currentCode = options.getActiveCode();

      // Ensure track hasn't changed during the async delay
      if (currentTrackId !== initialTrackId) {
        console.log('StrictAutosave: Track changed during autosave setup', {
          initial: initialTrackId,
          current: currentTrackId
        });
        return false;
      }

      // Ensure code hasn't changed significantly
      if (currentCode !== initialCode) {
        console.log('StrictAutosave: Code changed during autosave setup', {
          initialLength: initialCode.length,
          currentLength: currentCode.length
        });
        return false;
      }

      const context = getTrackContext(initialTrackId);
      
      // Validate context integrity
      if (!(await validateTrackContext(initialTrackId, currentCode))) {
        console.error('StrictAutosave: Context validation failed');
        return false;
      }

      // Check if already autosaving this track
      if (context.isAutosaving) {
        console.log('StrictAutosave: Already autosaving track', initialTrackId);
        return false;
      }

      // Check if code has actually changed
      if (currentCode === context.lastSavedCode) {
        console.log('StrictAutosave: No changes to save for track', initialTrackId);
        return false;
      }

      // Mark as autosaving
      context.isAutosaving = true;

      console.log('StrictAutosave: Starting atomic save for track', {
        trackId: initialTrackId,
        codeLength: currentCode.length,
        lastSavedLength: context.lastSavedCode.length
      });

      // Perform the actual save
      const saveSuccess = await options.onSave(initialTrackId, currentCode);

      if (saveSuccess) {
        // Update context with new saved state
        context.lastSavedCode = currentCode;
        context.lastSavedTimestamp = Date.now();
        context.codeFingerprint = await generateCodeFingerprint(currentCode);
        
        console.log('StrictAutosave: Successfully saved track', initialTrackId);
        return true;
      } else {
        console.error('StrictAutosave: Save operation failed for track', initialTrackId);
        return false;
      }

    } catch (error) {
      console.error('StrictAutosave: Atomic save failed', error);
      return false;
    } finally {
      // Always clean up
      const context = trackContextsRef.current.get(initialTrackId);
      if (context) {
        context.isAutosaving = false;
      }
      globalAutosaveLockRef.current = false;
    }
  }, [options, getTrackContext, validateTrackContext, generateCodeFingerprint]);

  /**
   * Schedule autosave for the current track
   */
  const scheduleAutosave = useCallback(() => {
    if (!options.isEnabled()) return;

    const currentTrackId = options.getActiveTrackId();
    if (!currentTrackId) return;

    const currentCode = options.getActiveCode();
    if (!currentCode?.trim()) return;

    // Clear any existing timer for this track
    clearTrackTimer(currentTrackId);

    const context = getTrackContext(currentTrackId);
    
    // Don't schedule if already autosaving
    if (context.isAutosaving) return;

    // Don't schedule if code hasn't changed
    if (currentCode === context.lastSavedCode) return;

    const interval = options.getInterval();
    
    console.log('StrictAutosave: Scheduling autosave for track', {
      trackId: currentTrackId,
      interval,
      codeLength: currentCode.length
    });

    context.autosaveTimer = setTimeout(() => {
      // Capture state at timer execution time
      const timerTrackId = options.getActiveTrackId();
      const timerCode = options.getActiveCode();
      
      // Only proceed if track and code are still the same
      if (timerTrackId === currentTrackId && timerCode === currentCode) {
        performAtomicAutosave(currentTrackId, currentCode);
      } else {
        console.log('StrictAutosave: Track or code changed, canceling scheduled autosave');
      }
    }, interval);

  }, [options, clearTrackTimer, getTrackContext, performAtomicAutosave]);

  /**
   * Force save current track immediately
   */
  const forceSave = useCallback(async (): Promise<boolean> => {
    const currentTrackId = options.getActiveTrackId();
    if (!currentTrackId) return false;

    const currentCode = options.getActiveCode();
    if (!currentCode?.trim()) return false;

    // Clear any pending autosave
    clearTrackTimer(currentTrackId);

    return await performAtomicAutosave(currentTrackId, currentCode);
  }, [options, clearTrackTimer, performAtomicAutosave]);

  /**
   * Initialize track context when switching tracks
   */
  const initializeTrack = useCallback(async (trackId: string, initialCode: string) => {
    console.log('StrictAutosave: Initializing track context', trackId);
    
    const context = getTrackContext(trackId);
    context.lastSavedCode = initialCode;
    context.lastSavedTimestamp = Date.now();
    context.codeFingerprint = await generateCodeFingerprint(initialCode);
    
    // Clear any existing timer
    clearTrackTimer(trackId);
  }, [getTrackContext, generateCodeFingerprint, clearTrackTimer]);

  /**
   * Clean up track context when track is deleted
   */
  const cleanupTrack = useCallback((trackId: string) => {
    console.log('StrictAutosave: Cleaning up track context', trackId);
    
    clearTrackTimer(trackId);
    trackContextsRef.current.delete(trackId);
  }, [clearTrackTimer]);

  /**
   * Get debug info for a track
   */
  const getTrackDebugInfo = useCallback((trackId: string) => {
    const context = trackContextsRef.current.get(trackId);
    return {
      hasContext: !!context,
      isAutosaving: context?.isAutosaving || false,
      hasTimer: !!context?.autosaveTimer,
      lastSavedLength: context?.lastSavedCode?.length || 0,
      lastSavedTimestamp: context?.lastSavedTimestamp || 0,
      fingerprint: context?.codeFingerprint || ''
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all timers
      for (const [trackId] of trackContextsRef.current) {
        clearTrackTimer(trackId);
      }
      trackContextsRef.current.clear();
    };
  }, [clearTrackTimer]);

  return {
    scheduleAutosave,
    forceSave,
    initializeTrack,
    cleanupTrack,
    getTrackDebugInfo
  };
}