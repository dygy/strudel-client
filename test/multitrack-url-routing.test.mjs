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
  }
};

// Set up global mocks
global.window = mockWindow;
global.document = mockWindow.document;

// Import modules after setting up mocks
const { URLParser } = await import('../website/src/routing/URLParser.ts');
const { TrackRouter } = await import('../website/src/routing/TrackRouter.ts');

describe('Multitrack URL Routing', () => {
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('URLParser', () => {
    it('should parse track ID from URL', () => {
      mockWindow.location.href = 'http://localhost:3000/?track=test123';
      mockWindow.location.search = '?track=test123';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBe('test123');
    });

    it('should parse step from URL', () => {
      mockWindow.location.href = 'http://localhost:3000/?track=test123&step=2';
      mockWindow.location.search = '?track=test123&step=2';
      
      const step = URLParser.getCurrentStep();
      expect(step).toBe(2);
    });

    it('should return null for invalid step', () => {
      mockWindow.location.href = 'http://localhost:3000/?track=test123&step=invalid';
      mockWindow.location.search = '?track=test123&step=invalid';
      
      const step = URLParser.getCurrentStep();
      expect(step).toBe(null);
    });

    it('should update URL with track and step', () => {
      URLParser.updateTrackInURL('test123', false, 2);
      
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test123&step=2'
      );
    });

    it('should update URL with track only', () => {
      URLParser.updateTrackInURL('test123', false);
      
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test123'
      );
    });

    it('should remove step when not provided', () => {
      mockWindow.location.search = '?track=test123&step=2';
      
      URLParser.updateTrackInURL('test123', false);
      
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test123'
      );
    });

    it('should clear track and step from URL', () => {
      URLParser.clearTrackFromURL(true);
      
      expect(mockWindow.history.replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/'
      );
    });
  });

  describe('TrackRouter', () => {
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

    it('should navigate to track with step', async () => {
      await router.navigateToTrack('test123', { step: 2 });
      
      expect(mockConfig.onNavigationStart).toHaveBeenCalledWith('test123');
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('test123', null, 2);
      expect(mockConfig.onNavigationComplete).toHaveBeenCalledWith('test123');
      
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test123&step=2'
      );
    });

    it('should navigate to track without step', async () => {
      await router.navigateToTrack('test123');
      
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('test123', null, undefined);
      
      expect(mockWindow.history.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test123'
      );
    });

    it('should skip URL update when requested', async () => {
      await router.navigateToTrack('test123', { skipUrlUpdate: true, step: 2 });
      
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('test123', null, 2);
      expect(mockWindow.history.pushState).not.toHaveBeenCalled();
      expect(mockWindow.history.replaceState).not.toHaveBeenCalled();
    });

    it('should replace URL when requested', async () => {
      await router.navigateToTrack('test123', { replace: true, step: 2 });
      
      expect(mockWindow.history.replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test123&step=2'
      );
    });

    it('should clear current track and step', async () => {
      // First navigate to a track with step
      await router.navigateToTrack('test123', { step: 2 });
      
      // Then clear
      await router.clearCurrentTrack();
      
      expect(mockConfig.onTrackChange).toHaveBeenLastCalledWith(null, 'test123', undefined);
      expect(mockWindow.history.replaceState).toHaveBeenLastCalledWith(
        null,
        '',
        '/'
      );
    });

    it('should restore track and step from URL on initialization', async () => {
      mockWindow.location.href = 'http://localhost:3000/?track=test123&step=2';
      mockWindow.location.search = '?track=test123&step=2';
      
      const newRouter = new TrackRouter(mockConfig);
      await newRouter.initialize();
      
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('test123', null, 2);
      
      newRouter.destroy();
    });

    it('should update page title with track ID', async () => {
      await router.navigateToTrack('test123');
      
      expect(mockWindow.document.title).toBe('Strudel - Track test123');
    });

    it('should reset page title when clearing track', async () => {
      await router.navigateToTrack('test123');
      await router.clearCurrentTrack();
      
      expect(mockWindow.document.title).toBe('Strudel');
    });
  });

  describe('Integration', () => {
    it('should handle complete multitrack step navigation flow', async () => {
      const mockConfig = {
        onTrackChange: vi.fn(),
        onNavigationStart: vi.fn(),
        onNavigationComplete: vi.fn()
      };
      
      const router = new TrackRouter(mockConfig);
      
      // Navigate to track
      await router.navigateToTrack('multitrack123');
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', null, undefined);
      
      // Switch to step 1
      await router.navigateToTrack('multitrack123', { step: 1, replace: true });
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', 'multitrack123', 1);
      
      // Switch to step 2
      await router.navigateToTrack('multitrack123', { step: 2, replace: true });
      expect(mockConfig.onTrackChange).toHaveBeenCalledWith('multitrack123', 'multitrack123', 2);
      
      // Verify URL updates
      expect(mockWindow.history.replaceState).toHaveBeenLastCalledWith(
        null,
        '',
        '/?track=multitrack123&step=2'
      );
      
      router.destroy();
    });
  });
});