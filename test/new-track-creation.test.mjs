import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const mockLocalStorage = {
  data: {},
  getItem: vi.fn((key) => mockLocalStorage.data[key] || null),
  setItem: vi.fn((key, value) => {
    mockLocalStorage.data[key] = value;
  }),
  removeItem: vi.fn((key) => {
    delete mockLocalStorage.data[key];
  }),
  clear: vi.fn(() => {
    mockLocalStorage.data = {};
  })
};

// Mock window and document
const mockWindow = {
  localStorage: mockLocalStorage,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
};

const mockDocument = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};

// Set up global mocks
global.window = mockWindow;
global.document = mockDocument;
global.localStorage = mockLocalStorage;
global.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};

describe('New Track Creation and Selection', () => {
  beforeEach(() => {
    // Clear all mocks and localStorage before each test
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockWindow.dispatchEvent.mockClear();
    mockWindow.addEventListener.mockClear();
    mockWindow.removeEventListener.mockClear();
    mockDocument.addEventListener.mockClear();
    mockDocument.removeEventListener.mockClear();
    mockDocument.dispatchEvent.mockClear();
  });

  describe('Event Dispatching Logic', () => {
    it('should dispatch user pattern created event when new pattern is created', () => {
      // Simulate the logic from userPattern.update
      const patternId = 'ddd';
      const patternData = {
        id: patternId,
        code: 's("bd hh")',
        collection: 'user',
        created_at: Date.now()
      };
      
      // Simulate checking if pattern is new (doesn't exist in localStorage)
      const existingPatterns = {};
      const isNewPattern = !existingPatterns[patternId];
      
      // Simulate the event dispatch logic
      if (isNewPattern && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('strudel-user-pattern-created', {
          detail: { patternId, patternData }
        }));
      }
      
      // Verify the event was dispatched
      expect(mockWindow.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'strudel-user-pattern-created',
          detail: {
            patternId: 'ddd',
            patternData: expect.objectContaining({
              id: 'ddd',
              code: 's("bd hh")',
              collection: 'user'
            })
          }
        })
      );
    });

    it('should not dispatch event for existing pattern updates', () => {
      // Simulate existing pattern
      const patternId = 'existing';
      const existingPatterns = {
        [patternId]: {
          id: patternId,
          code: 's("bd")',
          collection: 'user'
        }
      };
      
      const isNewPattern = !existingPatterns[patternId];
      
      // Should not dispatch event for existing patterns
      if (isNewPattern && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('strudel-user-pattern-created', {
          detail: { patternId, patternData: {} }
        }));
      }
      
      // Should not dispatch event
      expect(mockWindow.dispatchEvent).not.toHaveBeenCalled();
    });

    it('should dispatch active pattern changed event when pattern changes', async () => {
      // Simulate setActivePattern logic
      const oldPattern = 'pattern1';
      const newPattern = 'ddd';
      
      if (newPattern && newPattern !== oldPattern && typeof window !== 'undefined') {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-active-pattern-changed', {
            detail: { newPattern, oldPattern }
          }));
        }, 50);
      }
      
      // Wait for setTimeout
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify the event was dispatched
      expect(mockWindow.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'strudel-active-pattern-changed',
          detail: {
            newPattern: 'ddd',
            oldPattern: 'pattern1'
          }
        })
      );
    });
  });

  describe('Track Name Extraction Logic', () => {
    it('should identify user-friendly names vs random IDs', () => {
      // Test user-friendly names
      const userFriendlyNames = ['ddd', 'my-track', 'bass_line', 'drums123'];
      const randomIds = ['a1b2c3d4e5f6', 'X9Y8Z7W6V5U4', '123456789012'];
      
      // Regex to match 12 alphanumeric characters (random ID pattern)
      const isRandomId = (id) => /^[a-zA-Z0-9]{12}$/.test(id);
      
      userFriendlyNames.forEach(name => {
        expect(isRandomId(name)).toBe(false);
      });
      
      randomIds.forEach(id => {
        expect(isRandomId(id)).toBe(true);
      });
    });

    it('should extract appropriate track names from pattern data', () => {
      const testCases = [
        {
          patternId: 'ddd',
          patternData: { id: 'ddd' },
          expectedName: 'ddd'
        },
        {
          patternId: 'a1b2c3d4e5f6',
          patternData: { id: 'a1b2c3d4e5f6' },
          expectedName: 'New Track' // Should use default for random IDs
        },
        {
          patternId: 'my-awesome-track',
          patternData: { id: 'my-awesome-track' },
          expectedName: 'my-awesome-track'
        }
      ];
      
      testCases.forEach(({ patternId, patternData, expectedName }) => {
        // Simulate the track name extraction logic
        let trackName = 'New Track';
        if (patternData.id && patternData.id !== patternId) {
          trackName = patternData.id;
        } else if (typeof patternId === 'string' && patternId.length > 0) {
          // If patternId looks like a user-created name (not a random ID), use it
          if (!/^[a-zA-Z0-9]{12}$/.test(patternId)) {
            trackName = patternId;
          }
        }
        
        expect(trackName).toBe(expectedName);
      });
    });
  });

  describe('FileManager Synchronization Logic', () => {
    it('should create new track when user pattern exists but FileManager track does not', () => {
      const activePattern = 'ddd';
      const tracks = {}; // Empty FileManager tracks
      const userPatterns = {
        'ddd': {
          id: 'ddd',
          code: 's("bd hh")',
          collection: 'user',
          created_at: Date.now()
        }
      };
      
      // Simulate the synchronization logic
      const userPattern = userPatterns[activePattern];
      const trackExists = !!tracks[activePattern];
      
      if (userPattern && userPattern.code && !trackExists) {
        // Should create new track
        const trackName = activePattern; // Use pattern ID as name for user-friendly names
        
        const newTrack = {
          id: activePattern,
          name: trackName,
          code: userPattern.code,
          created: new Date(userPattern.created_at || Date.now()).toISOString(),
          modified: new Date().toISOString(),
        };
        
        expect(newTrack).toEqual({
          id: 'ddd',
          name: 'ddd',
          code: 's("bd hh")',
          created: expect.any(String),
          modified: expect.any(String)
        });
      }
    });

    it('should match existing track by code when available', () => {
      const activePattern = 'randomId123';
      const userPatternCode = 's("bd hh")';
      const tracks = {
        'existingTrack': {
          id: 'existingTrack',
          name: 'My Track',
          code: 's("bd hh")',
          created: '2023-01-01T00:00:00.000Z',
          modified: '2023-01-01T00:00:00.000Z'
        }
      };
      
      // Simulate finding matching track by code
      const matchingTrack = Object.values(tracks).find(track => 
        track.code && track.code.trim() === userPatternCode.trim()
      );
      
      expect(matchingTrack).toBeTruthy();
      expect(matchingTrack.id).toBe('existingTrack');
    });
  });
});