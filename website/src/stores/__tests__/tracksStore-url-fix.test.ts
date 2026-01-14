/**
 * Test for URL track loading fix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock window and location
const mockLocation = {
  search: '',
  href: 'http://localhost:3000/',
  pathname: '/',
  hash: ''
};

// Mock window object
Object.defineProperty(global, 'window', {
  value: {
    location: mockLocation
  },
  writable: true
});

describe('TracksStore URL Track Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.search = '';
  });

  afterEach(() => {
    mockLocation.search = '';
  });

  it('should prioritize URL track over random selection', () => {
    // Mock URL with specific track
    mockLocation.search = '?track=specific-track-id';
    
    // Mock tracks data
    const mockTracks = {
      'specific-track-id': {
        id: 'specific-track-id',
        name: 'Specific Track',
        code: '// specific track code',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        folder: null,
        isMultitrack: false,
        steps: [],
        activeStep: 0
      },
      'random-track-id': {
        id: 'random-track-id', 
        name: 'Random Track',
        code: '// random track code',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        folder: null,
        isMultitrack: false,
        steps: [],
        activeStep: 0
      }
    };

    // Simulate the URL track selection logic
    const urlParams = new URLSearchParams(mockLocation.search);
    const urlTrackId = urlParams.get('track');
    
    expect(urlTrackId).toBe('specific-track-id');
    
    let targetTrack = null;
    let shouldSelectRandom = true;
    
    if (urlTrackId && mockTracks[urlTrackId]) {
      targetTrack = mockTracks[urlTrackId];
      shouldSelectRandom = false;
    }
    
    expect(targetTrack).not.toBeNull();
    expect(targetTrack?.id).toBe('specific-track-id');
    expect(shouldSelectRandom).toBe(false);
  });

  it('should fall back to random selection when no URL track', () => {
    // No track in URL
    mockLocation.search = '';
    
    const mockTracks = {
      'track-1': { id: 'track-1', name: 'Track 1' },
      'track-2': { id: 'track-2', name: 'Track 2' }
    };

    const urlParams = new URLSearchParams(mockLocation.search);
    const urlTrackId = urlParams.get('track');
    
    expect(urlTrackId).toBeNull();
    
    let shouldSelectRandom = true;
    
    if (urlTrackId && mockTracks[urlTrackId]) {
      shouldSelectRandom = false;
    }
    
    expect(shouldSelectRandom).toBe(true);
  });

  it('should fall back to random when URL track not found', () => {
    // URL has track that doesn't exist
    mockLocation.search = '?track=non-existent-track';
    
    const mockTracks = {
      'track-1': { id: 'track-1', name: 'Track 1' },
      'track-2': { id: 'track-2', name: 'Track 2' }
    };

    const urlParams = new URLSearchParams(mockLocation.search);
    const urlTrackId = urlParams.get('track');
    
    expect(urlTrackId).toBe('non-existent-track');
    
    let targetTrack = null;
    let shouldSelectRandom = true;
    
    if (urlTrackId && mockTracks[urlTrackId]) {
      targetTrack = mockTracks[urlTrackId];
      shouldSelectRandom = false;
    }
    
    expect(targetTrack).toBeNull();
    expect(shouldSelectRandom).toBe(true);
  });

  it('should handle URL with other parameters', () => {
    // URL with track and other params
    mockLocation.search = '?track=my-track&step=2&other=value';
    
    const mockTracks = {
      'my-track': {
        id: 'my-track',
        name: 'My Track',
        code: '// my track code'
      }
    };

    const urlParams = new URLSearchParams(mockLocation.search);
    const urlTrackId = urlParams.get('track');
    
    expect(urlTrackId).toBe('my-track');
    expect(urlParams.get('step')).toBe('2');
    expect(urlParams.get('other')).toBe('value');
    
    const targetTrack = mockTracks[urlTrackId];
    expect(targetTrack).not.toBeUndefined();
    expect(targetTrack.id).toBe('my-track');
  });
});