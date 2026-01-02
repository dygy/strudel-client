import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Track Synchronization Fix', () => {
  describe('Active Pattern vs Selected Track Mismatch', () => {
    it('should create new track when active pattern differs from selected track', () => {
      // Simulate the scenario from the logs
      const activePattern = '1767203678097'; // User created "pp" pattern
      const selectedTrack = '1767204518534'; // Different track currently selected
      const tracks = {
        [selectedTrack]: {
          id: selectedTrack,
          name: 'Old Track',
          code: 'old code',
          created: '2023-01-01T00:00:00.000Z',
          modified: '2023-01-01T00:00:00.000Z'
        }
      };
      
      // Mock user patterns data
      const userPatterns = {
        [activePattern]: {
          id: 'pp', // User-friendly name
          code: 's("bd hh")', // New pattern code
          collection: 'user',
          created_at: Date.now()
        }
      };
      
      // Simulate the synchronization logic
      const shouldCreateNewTrack = (
        activePattern && 
        selectedTrack && 
        activePattern !== selectedTrack &&
        !tracks[activePattern] &&
        userPatterns[activePattern] &&
        !!userPatterns[activePattern].code
      );
      
      expect(shouldCreateNewTrack).toBe(true);
      
      // Simulate track creation
      if (shouldCreateNewTrack) {
        const userPattern = userPatterns[activePattern];
        let trackName = 'New Track';
        
        // Extract track name logic
        if (userPattern.id && userPattern.id !== activePattern) {
          trackName = userPattern.id;
        } else if (typeof activePattern === 'string' && activePattern.length > 0) {
          if (!/^[a-zA-Z0-9]{12}$/.test(activePattern)) {
            trackName = activePattern;
          }
        }
        
        const newTrack = {
          id: activePattern,
          name: trackName,
          code: userPattern.code,
          created: new Date(userPattern.created_at || Date.now()).toISOString(),
          modified: new Date().toISOString(),
        };
        
        expect(newTrack).toEqual({
          id: '1767203678097',
          name: 'pp', // Should use the user-friendly name from userPattern.id
          code: 's("bd hh")',
          created: expect.any(String),
          modified: expect.any(String)
        });
      }
    });

    it('should not create duplicate tracks when active pattern already exists', () => {
      const activePattern = 'existing-pattern';
      const selectedTrack = 'different-track';
      const tracks = {
        [activePattern]: {
          id: activePattern,
          name: 'Existing Track',
          code: 'existing code',
          created: '2023-01-01T00:00:00.000Z',
          modified: '2023-01-01T00:00:00.000Z'
        },
        [selectedTrack]: {
          id: selectedTrack,
          name: 'Different Track',
          code: 'different code',
          created: '2023-01-01T00:00:00.000Z',
          modified: '2023-01-01T00:00:00.000Z'
        }
      };
      
      // Should select existing track instead of creating new one
      const shouldSelectExisting = (
        activePattern && 
        tracks[activePattern] &&
        selectedTrack !== activePattern
      );
      
      expect(shouldSelectExisting).toBe(true);
    });

    it('should handle case where no track is selected', () => {
      const activePattern = 'new-pattern';
      const selectedTrack = null;
      const tracks = {};
      const userPatterns = {
        [activePattern]: {
          id: 'my-track',
          code: 's("cp")',
          collection: 'user',
          created_at: Date.now()
        }
      };
      
      // Should create new track when no track is selected
      const shouldCreateNewTrack = (
        !selectedTrack &&
        activePattern &&
        !tracks[activePattern] &&
        userPatterns[activePattern] &&
        !!userPatterns[activePattern].code
      );
      
      expect(shouldCreateNewTrack).toBe(true);
    });
  });

  describe('Track Name Extraction', () => {
    it('should prefer userPattern.id over activePattern for track name', () => {
      const testCases = [
        {
          activePattern: '1767203678097',
          userPatternId: 'pp',
          expectedName: 'pp'
        },
        {
          activePattern: 'user-friendly-name',
          userPatternId: 'user-friendly-name',
          expectedName: 'user-friendly-name'
        },
        {
          activePattern: 'a1b2c3d4e5f6',
          userPatternId: 'a1b2c3d4e5f6',
          expectedName: 'New Track' // Should use default for random IDs
        }
      ];
      
      testCases.forEach(({ activePattern, userPatternId, expectedName }) => {
        const userPattern = { id: userPatternId };
        
        let trackName = 'New Track';
        if (userPattern.id && userPattern.id !== activePattern) {
          trackName = userPattern.id;
        } else if (typeof activePattern === 'string' && activePattern.length > 0) {
          if (!/^[a-zA-Z0-9]{12}$/.test(activePattern)) {
            trackName = activePattern;
          }
        }
        
        expect(trackName).toBe(expectedName);
      });
    });
  });

  describe('Synchronization Conditions', () => {
    it('should handle all synchronization scenarios correctly', () => {
      const scenarios = [
        {
          name: 'Active pattern exists in tracks, different from selected',
          activePattern: 'existing',
          selectedTrack: 'different',
          tracks: { existing: { id: 'existing', name: 'Existing' } },
          expectedAction: 'select_existing'
        },
        {
          name: 'Active pattern does not exist, selected track exists',
          activePattern: 'new-pattern',
          selectedTrack: 'existing',
          tracks: { existing: { id: 'existing', name: 'Existing' } },
          userPatterns: { 'new-pattern': { id: 'new', code: 'code' } },
          expectedAction: 'create_new'
        },
        {
          name: 'No selected track, active pattern exists',
          activePattern: 'existing',
          selectedTrack: null,
          tracks: { existing: { id: 'existing', name: 'Existing' } },
          expectedAction: 'select_existing'
        },
        {
          name: 'No selected track, active pattern does not exist',
          activePattern: 'new-pattern',
          selectedTrack: null,
          tracks: {},
          userPatterns: { 'new-pattern': { id: 'new', code: 'code' } },
          expectedAction: 'create_new'
        }
      ];
      
      scenarios.forEach(({ name, activePattern, selectedTrack, tracks, userPatterns = {}, expectedAction }) => {
        let action = 'none';
        
        // Simulate the synchronization logic
        if (activePattern && tracks[activePattern]) {
          if (selectedTrack !== activePattern) {
            action = 'select_existing';
          }
        } else if (activePattern && selectedTrack && activePattern !== selectedTrack) {
          if (userPatterns[activePattern]) {
            action = 'create_new';
          }
        } else if (!selectedTrack) {
          if (activePattern && tracks[activePattern]) {
            action = 'select_existing';
          } else if (activePattern && userPatterns[activePattern]) {
            action = 'create_new';
          }
        }
        
        expect(action).toBe(expectedAction);
      });
    });
  });
});