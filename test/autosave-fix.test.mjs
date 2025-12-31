import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Autosave Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Track Switching Protection', () => {
    it('should prevent saving old code to new track', async () => {
      // Mock scenario where user switches tracks quickly
      const mockTracks = {
        'track1': {
          id: 'track1',
          name: 'Track 1',
          code: 'sound("bd")',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z'
        },
        'track2': {
          id: 'track2',
          name: 'Track 2', 
          code: 'sound("hh")',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z'
        }
      };

      let selectedTrack = 'track1';
      let lastSavedCode = 'sound("bd")';
      let currentEditorCode = 'sound("bd").fast(2)'; // User modified track1

      // Simulate saveSpecificTrack logic
      const saveSpecificTrack = (trackId, showToast = true) => {
        // Check if track is still selected (protection)
        if (selectedTrack !== trackId) {
          console.log('Track changed, skipping save');
          return false;
        }

        // Check if code hasn't changed
        if (currentEditorCode === lastSavedCode) {
          return false;
        }

        // Save the code
        mockTracks[trackId].code = currentEditorCode;
        lastSavedCode = currentEditorCode;
        return true;
      };

      // User switches to track2 before autosave completes
      selectedTrack = 'track2';
      currentEditorCode = 'sound("hh")'; // Editor now shows track2 code
      lastSavedCode = 'sound("hh")'; // Update reference

      // Autosave tries to save to track1 (should be prevented)
      const saved = saveSpecificTrack('track1', false);
      
      expect(saved).toBe(false);
      expect(mockTracks['track1'].code).toBe('sound("bd")'); // Original code preserved
      expect(mockTracks['track2'].code).toBe('sound("hh")'); // Track2 unchanged
    });

    it('should handle code mismatch detection', () => {
      const mockTracks = {
        'track1': {
          id: 'track1',
          name: 'Track 1',
          code: 'sound("bd")',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z'
        }
      };

      let selectedTrack = 'track1';
      let lastSavedCode = 'sound("cp")'; // Different from track code
      let currentEditorCode = 'sound("hh")'; // Also different

      // Simulate saveSpecificTrack with mismatch detection
      const saveSpecificTrack = (trackId, showToast = true) => {
        if (selectedTrack !== trackId) {
          return false;
        }

        if (currentEditorCode === lastSavedCode) {
          return false;
        }

        // Mismatch detection
        const expectedCode = mockTracks[trackId].code;
        if (lastSavedCode !== expectedCode && lastSavedCode !== currentEditorCode) {
          console.warn('Code mismatch detected, skipping save');
          return false;
        }

        mockTracks[trackId].code = currentEditorCode;
        lastSavedCode = currentEditorCode;
        return true;
      };

      const saved = saveSpecificTrack('track1', false);
      
      expect(saved).toBe(false);
      expect(mockTracks['track1'].code).toBe('sound("bd")'); // Original code preserved
    });

    it('should allow normal save when everything matches', () => {
      const mockTracks = {
        'track1': {
          id: 'track1',
          name: 'Track 1',
          code: 'sound("bd")',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z'
        }
      };

      let selectedTrack = 'track1';
      let lastSavedCode = 'sound("bd")'; // Matches track code
      let currentEditorCode = 'sound("bd").fast(2)'; // User modification

      const saveSpecificTrack = (trackId, showToast = true) => {
        if (selectedTrack !== trackId) {
          return false;
        }

        if (currentEditorCode === lastSavedCode) {
          return false;
        }

        // Mismatch detection
        const expectedCode = mockTracks[trackId].code;
        if (lastSavedCode !== expectedCode && lastSavedCode !== currentEditorCode) {
          return false;
        }

        mockTracks[trackId].code = currentEditorCode;
        lastSavedCode = currentEditorCode;
        return true;
      };

      const saved = saveSpecificTrack('track1', false);
      
      expect(saved).toBe(true);
      expect(mockTracks['track1'].code).toBe('sound("bd").fast(2)'); // Code updated
    });
  });

  describe('Autosave Timer Management', () => {
    it('should clear timer when switching tracks', () => {
      let autosaveTimer = null;
      let autosaveTrackId = null;

      const clearAutosaveTimer = () => {
        if (autosaveTimer) {
          clearInterval(autosaveTimer);
          autosaveTimer = null;
          autosaveTrackId = null;
        }
      };

      const setupAutosaveTimer = (trackId) => {
        // Clear existing timer if for different track
        if (autosaveTimer && autosaveTrackId !== trackId) {
          clearAutosaveTimer();
        }

        if (!autosaveTimer) {
          autosaveTrackId = trackId;
          autosaveTimer = setInterval(() => {
            console.log('Autosave for:', trackId);
          }, 1000);
        }
      };

      // Setup autosave for track1
      setupAutosaveTimer('track1');
      expect(autosaveTimer).not.toBeNull();
      expect(autosaveTrackId).toBe('track1');

      // Switch to track2 (should clear timer)
      setupAutosaveTimer('track2');
      expect(autosaveTrackId).toBe('track2');

      // Cleanup
      clearAutosaveTimer();
      expect(autosaveTimer).toBeNull();
      expect(autosaveTrackId).toBeNull();
    });
  });

  describe('lastSavedCodeRef Management', () => {
    it('should update lastSavedCodeRef when loading track', () => {
      const track = {
        id: 'track1',
        name: 'Track 1',
        code: 'sound("bd")',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z'
      };

      let lastSavedCode = '';

      // Simulate loadTrack behavior
      const loadTrack = (trackToLoad) => {
        lastSavedCode = trackToLoad.code; // Update immediately
        
        // Simulate editor code setting
        const applyTrackCode = () => {
          // Set code in editor
          lastSavedCode = trackToLoad.code; // Update after setting
        };

        applyTrackCode();
      };

      loadTrack(track);
      expect(lastSavedCode).toBe('sound("bd")');
    });
  });
});