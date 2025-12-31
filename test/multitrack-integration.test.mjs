import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock DOM environment
const mockWindow = {
  location: {
    href: 'http://localhost:3000/',
    pathname: '/',
    search: '',
    hash: '',
    origin: 'http://localhost:3000'
  },
  history: {
    pushState: vi.fn(),
    replaceState: vi.fn()
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  document: {
    title: 'Strudel'
  },
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  },
  dispatchEvent: vi.fn()
};

// Set up global mocks
global.window = mockWindow;
global.document = mockWindow.document;
global.localStorage = mockWindow.localStorage;

// Import modules after setting up mocks
const { URLParser } = await import('../website/src/routing/URLParser.ts');
const { TrackRouter } = await import('../website/src/routing/TrackRouter.ts');

describe('Multitrack Integration', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset window location
    mockWindow.location.href = 'http://localhost:3000/';
    mockWindow.location.pathname = '/';
    mockWindow.location.search = '';
    mockWindow.location.hash = '';
    
    // Reset document title
    mockWindow.document.title = 'Strudel';
    
    // Mock localStorage with sample multitrack data
    const sampleTracks = {
      'multitrack123': {
        id: 'multitrack123',
        name: 'My Multitrack',
        code: 'sound("bd").s(0)',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        isMultitrack: true,
        activeStep: 0,
        steps: [
          {
            id: 'step1',
            name: 'Intro',
            code: 'sound("bd").s(0)',
            created: '2024-01-01T00:00:00.000Z',
            modified: '2024-01-01T00:00:00.000Z'
          },
          {
            id: 'step2',
            name: 'Verse',
            code: 'sound("hh").s(1)',
            created: '2024-01-01T00:00:00.000Z',
            modified: '2024-01-01T00:00:00.000Z'
          },
          {
            id: 'step3',
            name: 'Chorus',
            code: 'sound("cp").s(2)',
            created: '2024-01-01T00:00:00.000Z',
            modified: '2024-01-01T00:00:00.000Z'
          }
        ]
      }
    };
    
    mockWindow.localStorage.getItem.mockImplementation((key) => {
      if (key === 'strudel_tracks') {
        return JSON.stringify(sampleTracks);
      }
      return null;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('URL Step Navigation', () => {
    it('should generate correct URLs for multitrack steps', () => {
      // Test step 0 (should not include step parameter)
      URLParser.updateTrackInURL('multitrack123', false, 0);
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=multitrack123&step=0'
      );

      // Test step 1
      URLParser.updateTrackInURL('multitrack123', false, 1);
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=multitrack123&step=1'
      );

      // Test step 2
      URLParser.updateTrackInURL('multitrack123', false, 2);
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=multitrack123&step=2'
      );
    });

    it('should parse step from URL correctly', () => {
      // Mock URL parsing by updating href as well
      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=0';
      mockWindow.location.search = '?track=multitrack123&step=0';
      expect(URLParser.getCurrentStep()).toBe(0);

      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=1';
      mockWindow.location.search = '?track=multitrack123&step=1';
      expect(URLParser.getCurrentStep()).toBe(1);

      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=2';
      mockWindow.location.search = '?track=multitrack123&step=2';
      expect(URLParser.getCurrentStep()).toBe(2);

      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123';
      mockWindow.location.search = '?track=multitrack123';
      expect(URLParser.getCurrentStep()).toBe(null);
    });

    it('should handle invalid step values gracefully', () => {
      // Test negative step
      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=-1';
      mockWindow.location.search = '?track=multitrack123&step=-1';
      expect(URLParser.getCurrentStep()).toBe(null);

      // Test non-numeric step
      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=abc';
      mockWindow.location.search = '?track=multitrack123&step=abc';
      expect(URLParser.getCurrentStep()).toBe(null);

      // Test empty step
      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=';
      mockWindow.location.search = '?track=multitrack123&step=';
      expect(URLParser.getCurrentStep()).toBe(null);
    });
  });

  describe('TrackRouter Step Integration', () => {
    let router;
    let mockConfig;

    beforeEach(() => {
      mockConfig = {
        onTrackChange: vi.fn(),
        onNavigationStart: vi.fn(),
        onNavigationComplete: vi.fn(),
        onNavigationError: vi.fn()
      };
      
      router = new TrackRouter(mockConfig);
    });

    afterEach(() => {
      if (router) {
        router.destroy();
      }
    });

    it('should handle multitrack step navigation sequence', async () => {
      // Navigate to multitrack
      await router.navigateToTrack('multitrack123');
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', null, undefined);

      // Navigate to step 1
      await router.navigateToTrack('multitrack123', { step: 1, replace: true });
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', 'multitrack123', 1);

      // Navigate to step 2
      await router.navigateToTrack('multitrack123', { step: 2, replace: true });
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', 'multitrack123', 2);

      // Navigate back to step 0
      await router.navigateToTrack('multitrack123', { step: 0, replace: true });
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', 'multitrack123', 0);
    });

    it('should restore multitrack with step from URL', async () => {
      // Set URL to multitrack with step 2
      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=2';
      mockWindow.location.search = '?track=multitrack123&step=2';
      
      const newRouter = new TrackRouter(mockConfig);
      await newRouter.initialize();
      
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', null, 2);
      
      newRouter.destroy();
    });

    it('should handle browser back/forward with steps', async () => {
      // Set URL to multitrack with step 1
      mockWindow.location.href = 'http://localhost:3000/?track=multitrack123&step=1';
      mockWindow.location.search = '?track=multitrack123&step=1';
      
      // Create router and get the popstate listener
      const router = new TrackRouter(mockConfig);
      
      // Find the popstate listener that was registered
      const popstateCall = mockWindow.addEventListener.mock.calls.find(
        call => call[0] === 'popstate'
      );
      
      expect(popstateCall).toBeDefined();
      
      if (popstateCall && popstateCall[1]) {
        // Simulate browser navigation event
        const popstateEvent = new Event('popstate');
        await popstateCall[1](popstateEvent);
        
        // Should navigate to the track and step from URL
        expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', null, 1);
      }
      
      router.destroy();
    });
  });

  describe('Shareable URLs', () => {
    it('should generate shareable URLs for multitrack steps', () => {
      const baseUrl = 'http://localhost:3000/';
      
      // Test different step URLs
      const testCases = [
        { trackId: 'multitrack123', step: 0, expected: `${baseUrl}?track=multitrack123&step=0` },
        { trackId: 'multitrack123', step: 1, expected: `${baseUrl}?track=multitrack123&step=1` },
        { trackId: 'multitrack123', step: 2, expected: `${baseUrl}?track=multitrack123&step=2` },
        { trackId: 'multitrack123', step: undefined, expected: `${baseUrl}?track=multitrack123` }
      ];

      testCases.forEach(({ trackId, step, expected }) => {
        const params = { track: trackId };
        if (step !== undefined) {
          params.step = step.toString();
        }
        
        const queryString = URLParser.buildQueryString(params);
        const url = `${mockWindow.location.origin}${mockWindow.location.pathname}${queryString}`;
        
        expect(url).toBe(expected);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle step navigation without track', () => {
      // Try to set step without track - should be ignored
      URLParser.updateTrackInURL(null, false, 1);
      
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/'
      );
    });

    it('should clear step when clearing track', () => {
      // First set track with step
      URLParser.updateTrackInURL('multitrack123', false, 2);
      
      // Then clear track
      URLParser.clearTrackFromURL(true);
      
      expect(mockWindow.history.replaceState).toHaveBeenLastCalledWith(
        null,
        '',
        '/'
      );
    });

    it('should handle step parameter edge cases', () => {
      // Test step 0 (should be included)
      URLParser.updateTrackInURL('multitrack123', false, 0);
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=multitrack123&step=0'
      );

      // Test negative step (should be excluded)
      URLParser.updateTrackInURL('multitrack123', false, -1);
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=multitrack123'
      );
    });
  });
});