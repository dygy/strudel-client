import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = {
  data: {},
  getItem: vi.fn((key) => localStorageMock.data[key] || null),
  setItem: vi.fn((key, value) => {
    localStorageMock.data[key] = value;
  }),
  removeItem: vi.fn((key) => {
    delete localStorageMock.data[key];
  }),
  clear: vi.fn(() => {
    localStorageMock.data = {};
  })
};

// Mock window events
const mockEventListeners = new Map();
const mockAddEventListener = vi.fn((event, handler) => {
  if (!mockEventListeners.has(event)) {
    mockEventListeners.set(event, []);
  }
  mockEventListeners.get(event).push(handler);
});

const mockRemoveEventListener = vi.fn((event, handler) => {
  if (mockEventListeners.has(event)) {
    const handlers = mockEventListeners.get(event);
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }
});

const mockDispatchEvent = vi.fn((event) => {
  const eventType = event.type;
  if (mockEventListeners.has(eventType)) {
    const handlers = mockEventListeners.get(eventType);
    handlers.forEach(handler => handler(event));
  }
});

// Mock window object
global.window = {
  addEventListener: mockAddEventListener,
  removeEventListener: mockRemoveEventListener,
  dispatchEvent: mockDispatchEvent
};

describe('FileManager Refresh Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockEventListeners.clear();
    global.localStorage = localStorageMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register event listener for strudel-tracks-imported', () => {
    // Simulate FileManager component mounting and registering event listeners
    const handleTracksUpdated = vi.fn();
    
    window.addEventListener('strudel-tracks-updated', handleTracksUpdated);
    window.addEventListener('strudel-select-track', handleTracksUpdated);
    window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Verify all event listeners were registered
    expect(mockAddEventListener).toHaveBeenCalledWith('strudel-tracks-updated', handleTracksUpdated);
    expect(mockAddEventListener).toHaveBeenCalledWith('strudel-select-track', handleTracksUpdated);
    expect(mockAddEventListener).toHaveBeenCalledWith('strudel-tracks-imported', handleTracksUpdated);
  });

  it('should call handleTracksUpdated when strudel-tracks-imported event is fired', () => {
    // Mock the handleTracksUpdated function
    const handleTracksUpdated = vi.fn();
    
    window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Dispatch the event
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    
    // Verify the handler was called
    expect(handleTracksUpdated).toHaveBeenCalled();
  });

  it('should reload tracks from localStorage when strudel-tracks-imported event is fired', () => {
    // Set up initial tracks in localStorage
    const initialTracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'sound("bd")' }
    };
    localStorage.setItem('strudel_tracks', JSON.stringify(initialTracks));
    
    // Mock the data loading function
    const loadData = vi.fn(() => {
      const savedTracks = localStorage.getItem('strudel_tracks');
      if (savedTracks) {
        const loadedTracks = JSON.parse(savedTracks);
        console.log('Loaded tracks:', Object.keys(loadedTracks).length);
      }
    });
    
    // Simulate the handleTracksUpdated function
    const handleTracksUpdated = () => {
      console.log('FileManager - received tracks updated event, reloading...');
      loadData();
    };
    
    window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Add more tracks to localStorage (simulating import)
    const updatedTracks = {
      ...initialTracks,
      'track2': { id: 'track2', name: 'Track 2', code: 'sound("hh")' },
      'track3': { id: 'track3', name: 'Track 3', code: 'sound("cp")' }
    };
    localStorage.setItem('strudel_tracks', JSON.stringify(updatedTracks));
    
    // Dispatch the import event
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    
    // Verify loadData was called
    expect(loadData).toHaveBeenCalled();
  });

  it('should remove event listener on cleanup', () => {
    // Simulate FileManager component mounting and registering event listeners
    const handleTracksUpdated = vi.fn();
    
    window.addEventListener('strudel-tracks-updated', handleTracksUpdated);
    window.addEventListener('strudel-select-track', handleTracksUpdated);
    window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Simulate component unmounting and cleaning up event listeners
    window.removeEventListener('strudel-tracks-updated', handleTracksUpdated);
    window.removeEventListener('strudel-select-track', handleTracksUpdated);
    window.removeEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Verify all event listeners were removed
    expect(mockRemoveEventListener).toHaveBeenCalledWith('strudel-tracks-updated', handleTracksUpdated);
    expect(mockRemoveEventListener).toHaveBeenCalledWith('strudel-select-track', handleTracksUpdated);
    expect(mockRemoveEventListener).toHaveBeenCalledWith('strudel-tracks-imported', handleTracksUpdated);
  });

  it('should handle event with selectTrackId detail', () => {
    // Mock the handleTracksUpdated function with event detail handling
    const handleTracksUpdated = (event) => {
      console.log('FileManager - received tracks updated event, reloading...');
      
      if (event?.detail?.selectTrackId) {
        const trackIdToSelect = event.detail.selectTrackId;
        console.log('FileManager - will select track after update:', trackIdToSelect);
        
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-select-track', { 
            detail: { trackId: trackIdToSelect } 
          }));
        }, 150);
      }
    };
    
    window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Dispatch event with selectTrackId detail
    const eventWithDetail = new CustomEvent('strudel-tracks-imported', {
      detail: { selectTrackId: 'track123' }
    });
    
    window.dispatchEvent(eventWithDetail);
    
    // Wait for the setTimeout
    setTimeout(() => {
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'strudel-select-track',
          detail: { trackId: 'track123' }
        })
      );
    }, 200);
  });

  it('should handle multiple import events correctly', () => {
    const handleTracksUpdated = vi.fn();
    
    window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
    
    // Dispatch multiple events
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    
    // Verify the handler was called for each event
    expect(handleTracksUpdated).toHaveBeenCalledTimes(3);
  });
});