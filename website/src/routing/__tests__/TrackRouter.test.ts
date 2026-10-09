import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { TrackRouter } from '../TrackRouter';
import { URLParser } from '../URLParser';

// Mock window.location and window.history for testing
const mockLocation = {
  href: 'https://example.com/',
  pathname: '/',
  search: '',
  hash: '',
};

const mockHistory = {
  pushState: vi.fn(),
  replaceState: vi.fn(),
};

const mockDocument = {
  title: 'Strudel',
};

// Mock event listeners
const mockEventListeners: { [key: string]: EventListener[] } = {};
const mockAddEventListener = vi.fn((event: string, listener: EventListener) => {
  if (!mockEventListeners[event]) {
    mockEventListeners[event] = [];
  }
  mockEventListeners[event].push(listener);
});

const mockRemoveEventListener = vi.fn((event: string, listener: EventListener) => {
  if (mockEventListeners[event]) {
    const index = mockEventListeners[event].indexOf(listener);
    if (index > -1) {
      mockEventListeners[event].splice(index, 1);
    }
  }
});

// Helper to trigger popstate events
const triggerPopstate = () => {
  const listeners = mockEventListeners['popstate'] || [];
  listeners.forEach((listener) => {
    listener(new PopStateEvent('popstate'));
  });
};

// Canonical slug-shaped identifiers (lowercase alphanumerics joined by single hyphens).
// TrackRouter writes `/repl/<slug of its argument>`, so for these the expected URL is literally `/repl/<id>`.
const slugArb = fc.stringMatching(/^[a-z0-9]{1,8}(-[a-z0-9]{1,8}){0,2}$/);

// Setup global mocks
beforeEach(() => {
  vi.stubGlobal('window', {
    location: mockLocation,
    history: mockHistory,
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
  });

  vi.stubGlobal('document', mockDocument);

  // Reset mocks
  mockHistory.pushState.mockClear();
  mockHistory.replaceState.mockClear();
  mockAddEventListener.mockClear();
  mockRemoveEventListener.mockClear();

  // Reset location
  mockLocation.href = 'https://example.com/';
  mockLocation.pathname = '/';
  mockLocation.search = '';
  mockLocation.hash = '';

  // Reset document
  mockDocument.title = 'Strudel';

  // Clear event listeners
  Object.keys(mockEventListeners).forEach((key) => {
    delete mockEventListeners[key];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrackRouter', () => {
  describe('Basic functionality', () => {
    it('should initialize without errors', async () => {
      const router = new TrackRouter();
      await expect(router.initialize()).resolves.not.toThrow();
      expect(router.isReady()).toBe(true);
    });

    it('should navigate to track and update URL', async () => {
      const router = new TrackRouter();
      await router.initialize();

      await router.navigateToTrack('test-track');

      expect(mockHistory.pushState).toHaveBeenCalledTimes(1);
      expect(mockHistory.pushState).toHaveBeenCalledWith(null, '', '/repl/test-track');
      expect(mockHistory.replaceState).not.toHaveBeenCalled();
    });

    it('should slugify the identifier into the path and append a step query', async () => {
      const router = new TrackRouter();
      await router.initialize();

      await router.navigateToTrack('My Cool Track', { step: 2 });

      expect(mockHistory.pushState).toHaveBeenCalledWith(null, '', '/repl/my-cool-track?step=2');
    });

    it('should replace instead of push when replace is requested', async () => {
      const router = new TrackRouter();
      await router.initialize();

      await router.navigateToTrack('test-track', { replace: true });

      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/repl/test-track');
      expect(mockHistory.pushState).not.toHaveBeenCalled();
    });

    it('should not touch the URL or title when skipUrlUpdate is set', async () => {
      const router = new TrackRouter();
      await router.initialize();

      await router.navigateToTrack('test-track', { skipUrlUpdate: true });

      expect(mockHistory.pushState).not.toHaveBeenCalled();
      expect(mockHistory.replaceState).not.toHaveBeenCalled();
      expect(mockDocument.title).toBe('Strudel');
      expect(router.getNavigationState().currentTrackId).toBe('test-track');
    });

    it('should write the base repl URL when the current track is cleared', async () => {
      const router = new TrackRouter();
      await router.initialize();
      await router.navigateToTrack('test-track');

      await router.clearCurrentTrack();

      expect(mockHistory.replaceState).toHaveBeenLastCalledWith(null, '', '/repl');
      expect(mockDocument.title).toBe('Strudel');
    });

    it('should update page title when navigating', async () => {
      const router = new TrackRouter();
      await router.initialize();

      await router.navigateToTrack('test-track');

      expect(mockDocument.title).toBe('Strudel - Track test-track');
    });
  });

  describe('Property Tests', () => {
    /**
     * Feature: track-routing-navigation, Property 10: Browser history integration
     * For any sequence of track navigation, the browser back/forward buttons should
     * correctly navigate through the track history and update the page title
     */
    it('should maintain browser history integration consistency', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(slugArb, { minLength: 1, maxLength: 5 }), async (trackIds) => {
          // The spy is module-level and only cleared by vitest's beforeEach, i.e. once per
          // `it`, not once per property run — clear it so earlier runs/shrinks can't satisfy
          // (or pollute the failure output of) this run's assertions.
          mockHistory.pushState.mockClear();
          mockHistory.replaceState.mockClear();

          const router = new TrackRouter();
          await router.initialize();

          // Navigate through all tracks
          for (const trackId of trackIds) {
            await router.navigateToTrack(trackId);

            // Verify URL was updated to this track's path (and not to an earlier one)
            expect(mockHistory.pushState).toHaveBeenLastCalledWith(null, '', `/repl/${trackId}`);

            // Verify page title was updated
            expect(mockDocument.title).toBe(`Strudel - Track ${trackId}`);
          }

          // One history entry per navigation, in order
          expect(mockHistory.pushState.mock.calls.map((c) => c[2])).toEqual(trackIds.map((id) => `/repl/${id}`));
          expect(mockHistory.replaceState).not.toHaveBeenCalled();

          // Verify navigation state
          const state = router.getNavigationState();
          expect(state.currentTrackId).toBe(trackIds[trackIds.length - 1]);

          router.destroy();
        }),
        { numRuns: 50 }, // Reduced runs for async tests
      );
    });

    /**
     * Property test for navigation state consistency
     */
    it('should maintain navigation state consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
          async (trackId) => {
            const router = new TrackRouter();
            await router.initialize();

            // Initial state should be clean
            let state = router.getNavigationState();
            expect(state.currentTrackId).toBeNull();
            expect(state.isNavigating).toBe(false);

            // Navigate to track
            await router.navigateToTrack(trackId);

            // State should be updated
            state = router.getNavigationState();
            expect(state.currentTrackId).toBe(trackId);
            expect(state.viewingTrackId).toBe(trackId);
            expect(state.isNavigating).toBe(false);

            // Clear track
            await router.clearCurrentTrack();

            // State should be cleared
            state = router.getNavigationState();
            expect(state.currentTrackId).toBeNull();
            expect(state.viewingTrackId).toBeNull();
            expect(state.previousTrackId).toBe(trackId);

            router.destroy();
          },
        ),
        { numRuns: 50 },
      );
    });

    /**
     * Property test for URL restoration on initialization
     */
    it('should restore track from URL on initialization', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
          async (trackId) => {
            // Set up legacy URL with track parameter (still supported as a fallback)
            mockLocation.href = `https://example.com/?track=${trackId}`;
            mockLocation.pathname = '/';
            mockLocation.search = `?track=${trackId}`;
            mockHistory.pushState.mockClear();
            mockHistory.replaceState.mockClear();

            const onTrackChange = vi.fn();
            const router = new TrackRouter({ onTrackChange });

            // Initialize should restore track from URL
            await router.initialize();

            // Verify track was restored; the third argument is the (absent) step
            const state = router.getNavigationState();
            expect(state.currentTrackId).toBe(trackId);
            expect(onTrackChange).toHaveBeenCalledTimes(1);
            expect(onTrackChange).toHaveBeenCalledWith(trackId, null, undefined);
            // Restoring must not rewrite the URL the user landed on
            expect(mockHistory.pushState).not.toHaveBeenCalled();
            expect(mockHistory.replaceState).not.toHaveBeenCalled();

            router.destroy();
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should restore track and step from a path-based URL on initialization', async () => {
      await fc.assert(
        fc.asyncProperty(slugArb, fc.integer({ min: 0, max: 20 }), async (trackSlug, step) => {
          mockLocation.pathname = `/repl/${trackSlug}`;
          mockLocation.href = `https://example.com/repl/${trackSlug}?step=${step}`;
          mockLocation.search = `?step=${step}`;
          mockHistory.pushState.mockClear();
          mockHistory.replaceState.mockClear();

          const onTrackChange = vi.fn();
          const router = new TrackRouter({ onTrackChange });
          await router.initialize();

          expect(router.getNavigationState().currentTrackId).toBe(trackSlug);
          // step 0 is falsy and router.initialize passes `step || undefined`
          expect(onTrackChange).toHaveBeenCalledWith(trackSlug, null, step || undefined);
          expect(mockHistory.pushState).not.toHaveBeenCalled();
          expect(mockHistory.replaceState).not.toHaveBeenCalled();

          router.destroy();
        }),
        { numRuns: 50 },
      );
    });

    it('should not restore any track when the URL has none', async () => {
      mockLocation.pathname = '/repl';
      mockLocation.href = 'https://example.com/repl';
      const onTrackChange = vi.fn();
      const router = new TrackRouter({ onTrackChange });

      await router.initialize();

      expect(router.getNavigationState().currentTrackId).toBeNull();
      expect(onTrackChange).not.toHaveBeenCalled();
      expect(router.isReady()).toBe(true);
    });

    /**
     * Property test for callback invocation consistency
     */
    it('should invoke callbacks consistently during navigation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
            { minLength: 1, maxLength: 3 },
          ),
          async (trackIds) => {
            const onTrackChange = vi.fn();
            const onNavigationStart = vi.fn();
            const onNavigationComplete = vi.fn();

            const router = new TrackRouter({
              onTrackChange,
              onNavigationStart,
              onNavigationComplete,
            });

            await router.initialize();

            let previousTrackId: string | null = null;

            for (const trackId of trackIds) {
              await router.navigateToTrack(trackId);

              // Verify callbacks were called
              expect(onNavigationStart).toHaveBeenCalledWith(trackId);
              expect(onNavigationComplete).toHaveBeenCalledWith(trackId);
              // Third argument is the step; none was requested
              expect(onTrackChange).toHaveBeenLastCalledWith(trackId, previousTrackId, undefined);

              previousTrackId = trackId;
            }

            // Verify total call counts
            expect(onNavigationStart).toHaveBeenCalledTimes(trackIds.length);
            expect(onNavigationComplete).toHaveBeenCalledTimes(trackIds.length);
            expect(onTrackChange).toHaveBeenCalledTimes(trackIds.length);

            router.destroy();
          },
        ),
        { numRuns: 30 },
      );
    });
  });
});
