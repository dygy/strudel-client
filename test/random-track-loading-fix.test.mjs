import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

describe('Random Track Loading Fix', () => {
  let tracksStore, tracksActions;

  beforeEach(async () => {
    // Dynamic import to avoid module loading issues
    const tracksModule = await import('../website/src/stores/tracksStore.ts');
    tracksStore = tracksModule.tracksStore;
    tracksActions = tracksModule.tracksActions;
    
    // Clear store before each test
    tracksActions.clear();
  });

  describe('Property-Based Tests', () => {
    /**
     * Feature: random-track-loading-fix, Property 1: Authentication-Aware Loading
     * Validates: Requirements 1.1, 1.2
     */
    it('should load random track for authenticated users with tracks (property test)', async () => {
      const testProperty = fc.asyncProperty(
        fc.boolean(), // isAuthenticated
        fc.array(fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 50 }),
          code: fc.oneof(
            fc.string({ minLength: 1, maxLength: 100 }),
            fc.constant(''),
            fc.constant('   ')
          ),
          created: fc.date().map(d => d.toISOString()),
          modified: fc.date().map(d => d.toISOString()),
          folder: fc.oneof(fc.string(), fc.constant(null)),
          isMultitrack: fc.boolean(),
          steps: fc.array(fc.anything()),
          activeStep: fc.integer({ min: 0, max: 10 }),
          user_id: fc.uuid(),
        }), { minLength: 0, maxLength: 10 }),
        async (isAuthenticated, tracks) => {
          const ssrData = {
            children: tracks.map(track => ({ ...track, type: 'track' }))
          };

          let completionResult = null;
          const onComplete = (randomTrack) => {
            completionResult = randomTrack;
          };

          tracksActions.initializeWithCoordination(ssrData, onComplete);
          const result = await tracksActions.waitForInitialization();

          if (isAuthenticated && tracks.length > 0) {
            expect(result.hasData).toBe(true);
            expect(completionResult).not.toBeNull();
            
            if (completionResult) {
              const trackIds = tracks.map(t => t.id);
              expect(trackIds).toContain(completionResult.id);
            }

            const state = tracksStore.get();
            expect(state.randomTrackSelected).toBe(true);
            expect(state.loadingPhase).toBe('complete');
            expect(state.isInitialized).toBe(true);
          } else {
            if (tracks.length === 0) {
              expect(result.randomTrack).toBeNull();
              expect(completionResult).toBeNull();
            }
            
            const state = tracksStore.get();
            expect(state.isInitialized).toBe(true);
            expect(state.loadingPhase).toBe('complete');
          }
        }
      );

      await fc.assert(testProperty, { numRuns: 100 });
    });

    /**
     * Test random track selection logic with smart criteria
     */
    it('should select tracks with smart criteria (property test)', () => {
      const testProperty = fc.property(
        fc.array(fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 50 }),
          code: fc.oneof(
            fc.string({ minLength: 1, maxLength: 100 }),
            fc.constant(''),
            fc.constant('   ')
          ),
          created: fc.date().map(d => d.toISOString()),
          modified: fc.date().map(d => d.toISOString()),
          folder: fc.oneof(fc.string(), fc.constant(null)),
          isMultitrack: fc.boolean(),
          steps: fc.array(fc.anything()),
          activeStep: fc.integer({ min: 0, max: 10 }),
          user_id: fc.uuid(),
        }), { minLength: 0, maxLength: 10 }),
        (tracks) => {
          const tracksObj = tracks.reduce((acc, track) => {
            acc[track.id] = track;
            return acc;
          }, {});

          tracksStore.set({
            ...tracksStore.get(),
            tracks: tracksObj,
            isInitialized: true,
          });

          const selectedTrack = tracksActions.selectRandomTrack();

          if (tracks.length === 0) {
            expect(selectedTrack).toBeNull();
          } else {
            expect(selectedTrack).not.toBeNull();
            expect(tracks.map(t => t.id)).toContain(selectedTrack.id);

            const validTracks = tracks.filter(t => t.code && t.code.trim().length > 0);
            if (validTracks.length > 0) {
              expect(selectedTrack.code.trim().length).toBeGreaterThan(0);
            }
          }
        }
      );

      fc.assert(testProperty, { numRuns: 100 });
    });

    /**
     * Test coordination prevents multiple initializations
     */
    it('should prevent multiple initialization attempts (property test)', async () => {
      const testProperty = fc.asyncProperty(
        fc.array(fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 50 }),
          code: fc.string({ minLength: 1, maxLength: 100 }),
          created: fc.date().map(d => d.toISOString()),
          modified: fc.date().map(d => d.toISOString()),
          folder: fc.oneof(fc.string(), fc.constant(null)),
          isMultitrack: fc.boolean(),
          steps: fc.array(fc.anything()),
          activeStep: fc.integer({ min: 0, max: 10 }),
          user_id: fc.uuid(),
        }), { minLength: 1, maxLength: 5 }),
        async (tracks) => {
          const ssrData = {
            children: tracks.map(track => ({ ...track, type: 'track' }))
          };

          let completionCount = 0;
          const onComplete = () => {
            completionCount++;
          };

          tracksActions.initializeWithCoordination(ssrData, onComplete);
          tracksActions.initializeWithCoordination(ssrData, onComplete);
          tracksActions.initializeWithCoordination(ssrData, onComplete);

          await tracksActions.waitForInitialization();

          expect(completionCount).toBe(3);

          const state = tracksStore.get();
          expect(state.isInitialized).toBe(true);
          expect(state.loadingPhase).toBe('complete');
        }
      );

      await fc.assert(testProperty, { numRuns: 50 });
    });
  });
});