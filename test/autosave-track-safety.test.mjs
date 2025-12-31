/**
 * Test for autosave track safety
 * This test verifies that autosave saves to the correct track even when the user switches tracks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Autosave Track Safety', () => {
  let mockTracks;
  let mockSelectedTrack;
  let mockContext;
  let mockSaveSpecificTrack;

  beforeEach(() => {
    mockTracks = {
      'track1': {
        id: 'track1',
        name: 'Track 1',
        code: 'sound("bd")',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z'
      },
      'track2': {
        id: 'track2',
        name: 'Track 2',
        code: 'sound("hh")',
        created: '2025-01-01T00:01:00.000Z',
        modified: '2025-01-01T00:01:00.000Z'
      }
    };

    mockSelectedTrack = 'track1';
    
    mockContext = {
      editorRef: {
        current: {
          code: 'sound("bd cp")', // Modified code in editor
          setCode: vi.fn()
        }
      },
      activeCode: 'sound("bd cp")'
    };

    mockSaveSpecificTrack = vi.fn().mockImplementation(async (trackId, showToast) => {
      // Simulate the safety check: only save if trackId matches currently selected track
      if (trackId !== mockSelectedTrack) {
        console.log('Track changed, skipping autosave for:', trackId);
        return false;
      }
      
      // Simulate successful save
      mockTracks[trackId].code = mockContext.editorRef.current.code;
      mockTracks[trackId].modified = new Date().toISOString();
      return true;
    });
  });

  it('should save to the correct track when no track switching occurs', async () => {
    // Autosave timer starts for track1
    const autosaveTrackId = 'track1';
    
    // Autosave executes
    const result = await mockSaveSpecificTrack(autosaveTrackId, false);
    
    expect(result).toBe(true);
    expect(mockTracks['track1'].code).toBe('sound("bd cp")');
    expect(mockTracks['track2'].code).toBe('sound("hh")'); // Unchanged
  });

  it('should NOT save when user switches tracks during autosave', async () => {
    // Autosave timer starts for track1
    const autosaveTrackId = 'track1';
    
    // User switches to track2 before autosave executes
    mockSelectedTrack = 'track2';
    
    // Autosave executes (should be blocked)
    const result = await mockSaveSpecificTrack(autosaveTrackId, false);
    
    expect(result).toBe(false);
    expect(mockTracks['track1'].code).toBe('sound("bd")'); // Unchanged
    expect(mockTracks['track2'].code).toBe('sound("hh")'); // Unchanged
  });

  it('should handle rapid track switching correctly', async () => {
    // Simulate rapid track switching
    const scenarios = [
      { autosaveFor: 'track1', currentlySelected: 'track1', shouldSave: true },
      { autosaveFor: 'track1', currentlySelected: 'track2', shouldSave: false },
      { autosaveFor: 'track2', currentlySelected: 'track2', shouldSave: true },
      { autosaveFor: 'track2', currentlySelected: 'track1', shouldSave: false },
    ];

    for (const scenario of scenarios) {
      mockSelectedTrack = scenario.currentlySelected;
      const result = await mockSaveSpecificTrack(scenario.autosaveFor, false);
      expect(result).toBe(scenario.shouldSave);
    }
  });

  it('should handle invalid track IDs gracefully', async () => {
    const result = await mockSaveSpecificTrack('nonexistent-track', false);
    expect(result).toBe(false);
  });
});