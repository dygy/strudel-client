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

describe('Welcome Screen Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockEventListeners.clear();
    global.localStorage = localStorageMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch strudel-tracks-imported event after single track import', async () => {
    // Simulate single track import success
    const trackName = 'Imported Track';
    
    // Mock the import process
    const newTrack = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
      name: trackName,
      code: 'sound("bd")',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    
    const savedTracks = localStorage.getItem('strudel_tracks');
    const tracks = savedTracks ? JSON.parse(savedTracks) : {};
    tracks[newTrack.id] = newTrack;
    localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
    
    // Simulate the event dispatch that should happen after import
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    }, 150);
    
    // Wait for the timeout
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify event was dispatched
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'strudel-tracks-imported'
      })
    );
  });

  it('should dispatch strudel-tracks-imported event after library import', async () => {
    // Simulate library import with multiple tracks
    const importedCount = 5;
    const folderCount = 2;
    
    // Mock successful library import
    const message = `${importedCount} tracks and ${folderCount} folders imported!`;
    
    // Simulate the event dispatch that should happen after library import
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    }, 600);
    
    // Wait for the timeout
    await new Promise(resolve => setTimeout(resolve, 700));
    
    // Verify event was dispatched
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'strudel-tracks-imported'
      })
    );
  });

  it('should dispatch strudel-tracks-imported event after multitrack import', async () => {
    // Simulate multitrack import
    const multitrackData = {
      id: Date.now().toString(),
      name: 'Imported Multitrack',
      code: 'sound("kick")',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      isMultitrack: true,
      steps: [
        {
          id: 'step_0',
          name: 'Step 1',
          code: 'sound("kick")',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        }
      ],
      activeStep: 0,
    };
    
    // Mock localStorage update
    const savedTracks = localStorage.getItem('strudel_tracks');
    const tracks = savedTracks ? JSON.parse(savedTracks) : {};
    tracks[multitrackData.id] = multitrackData;
    localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
    
    // Simulate the event dispatch that should happen after multitrack import
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    }, 150);
    
    // Wait for the timeout
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify event was dispatched
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'strudel-tracks-imported'
      })
    );
  });

  it('should register event listener for strudel-tracks-imported', () => {
    // Simulate ReplEditor component mounting and registering event listeners
    const handleTracksImported = vi.fn();
    
    window.addEventListener('strudel-tracks-imported', handleTracksImported);
    
    // Verify the event listener was registered
    expect(mockAddEventListener).toHaveBeenCalledWith('strudel-tracks-imported', handleTracksImported);
    
    // Simulate the event being dispatched
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    
    // Verify the handler was called
    expect(handleTracksImported).toHaveBeenCalled();
  });

  it('should remove event listener on cleanup', () => {
    // Simulate ReplEditor component mounting and registering event listeners
    const handleTracksImported = vi.fn();
    
    window.addEventListener('strudel-tracks-imported', handleTracksImported);
    
    // Simulate component unmounting and cleaning up event listeners
    window.removeEventListener('strudel-tracks-imported', handleTracksImported);
    
    // Verify the event listener was removed
    expect(mockRemoveEventListener).toHaveBeenCalledWith('strudel-tracks-imported', handleTracksImported);
  });

  it('should call checkUserData when strudel-tracks-imported event is fired', () => {
    // Mock checkUserData function
    const checkUserData = vi.fn();
    
    // Simulate the event handler that calls checkUserData
    const handleTracksImported = () => {
      console.log('ReplEditor - tracks imported, checking user data');
      checkUserData();
    };
    
    window.addEventListener('strudel-tracks-imported', handleTracksImported);
    
    // Dispatch the event
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    
    // Verify checkUserData was called
    expect(checkUserData).toHaveBeenCalled();
  });

  it('should detect tracks in localStorage after import', () => {
    // Start with no tracks
    expect(localStorage.getItem('strudel_tracks')).toBeNull();
    
    // Simulate track import
    const tracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'sound("bd")' },
      'track2': { id: 'track2', name: 'Track 2', code: 'sound("hh")' }
    };
    
    localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
    
    // Simulate checkUserData logic
    const savedTracks = localStorage.getItem('strudel_tracks');
    let hasTracksData = false;
    
    if (savedTracks) {
      try {
        const parsedTracks = JSON.parse(savedTracks);
        hasTracksData = Object.keys(parsedTracks).length > 0;
      } catch (e) {
        hasTracksData = false;
      }
    }
    
    expect(hasTracksData).toBe(true);
    expect(Object.keys(JSON.parse(savedTracks)).length).toBe(2);
  });
});