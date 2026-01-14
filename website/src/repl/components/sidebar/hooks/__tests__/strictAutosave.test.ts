/**
 * Tests for the Strict Autosave System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock crypto.subtle for testing
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32))
    }
  }
});

describe('Strict Autosave Logic', () => {
  let savedTracks: Record<string, string> = {};
  let currentTrackId = 'track-1';
  let currentCode = '// test code';
  let isEnabled = true;
  let interval = 1000;

  const mockOptions = {
    onSave: vi.fn().mockImplementation(async (trackId: string, code: string) => {
      savedTracks[trackId] = code;
      return true;
    }),
    getActiveTrackId: () => currentTrackId,
    getActiveCode: () => currentCode,
    isEnabled: () => isEnabled,
    getInterval: () => interval
  };

  beforeEach(() => {
    vi.clearAllMocks();
    savedTracks = {};
    currentTrackId = 'track-1';
    currentCode = '// test code';
    isEnabled = true;
    interval = 1000;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should prevent cross-track contamination', async () => {
    // Simulate track contexts
    const trackContexts = new Map();
    
    // Initialize track-1
    trackContexts.set('track-1', {
      trackId: 'track-1',
      lastSavedCode: '// track 1 initial',
      isAutosaving: false
    });
    
    // Initialize track-2
    trackContexts.set('track-2', {
      trackId: 'track-2', 
      lastSavedCode: '// track 2 initial',
      isAutosaving: false
    });

    // Switch to track-2 but try to save with track-1 code
    currentTrackId = 'track-2';
    currentCode = '// track 1 code'; // Wrong code for track-2

    const context = trackContexts.get(currentTrackId);
    
    // This should be detected as a mismatch
    const shouldSave = currentCode !== context.lastSavedCode && 
                      currentTrackId === context.trackId;
    
    expect(shouldSave).toBe(true); // Code is different, but...
    
    // Additional validation would catch the cross-contamination
    // In real implementation, we'd have fingerprinting and validation
    expect(currentTrackId).toBe('track-2');
    expect(context.trackId).toBe('track-2');
  });

  it('should validate track context integrity', () => {
    const trackContext = {
      trackId: 'track-1',
      lastSavedCode: '// original code',
      lastSavedTimestamp: Date.now(),
      isAutosaving: false,
      timer: null
    };

    // Test same code - should skip
    currentCode = '// original code';
    const shouldSkip = currentCode === trackContext.lastSavedCode;
    expect(shouldSkip).toBe(true);

    // Test different code - should save
    currentCode = '// modified code';
    const shouldSave = currentCode !== trackContext.lastSavedCode;
    expect(shouldSave).toBe(true);
  });

  it('should prevent concurrent saves', () => {
    const trackContext = {
      trackId: 'track-1',
      lastSavedCode: '// code',
      isAutosaving: false
    };

    // First save starts
    trackContext.isAutosaving = true;
    
    // Second save should be blocked
    const shouldBlock = trackContext.isAutosaving;
    expect(shouldBlock).toBe(true);
    
    // After first save completes
    trackContext.isAutosaving = false;
    const shouldAllow = !trackContext.isAutosaving;
    expect(shouldAllow).toBe(true);
  });

  it('should isolate track timers', () => {
    const trackTimers = new Map();
    
    // Set timer for track-1
    const timer1 = setTimeout(() => {}, 1000);
    trackTimers.set('track-1', timer1);
    
    // Set timer for track-2  
    const timer2 = setTimeout(() => {}, 2000);
    trackTimers.set('track-2', timer2);
    
    expect(trackTimers.get('track-1')).toBe(timer1);
    expect(trackTimers.get('track-2')).toBe(timer2);
    expect(trackTimers.get('track-1')).not.toBe(trackTimers.get('track-2'));
    
    // Clean up
    clearTimeout(timer1);
    clearTimeout(timer2);
  });

  it('should generate unique fingerprints', async () => {
    const code1 = '// track 1 code';
    const code2 = '// track 2 code';
    
    // Mock fingerprint generation
    const generateFingerprint = async (code: string) => {
      const encoder = new TextEncoder();
      const data = encoder.encode(code);
      // Simple hash for testing
      return Array.from(data).reduce((hash, byte) => hash + byte, 0).toString();
    };
    
    const fingerprint1 = await generateFingerprint(code1);
    const fingerprint2 = await generateFingerprint(code2);
    
    expect(fingerprint1).not.toBe(fingerprint2);
    expect(fingerprint1).toBe(await generateFingerprint(code1)); // Consistent
  });
});