/**
 * Basic tests for AudioMixer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioMixer } from '../AudioMixer.mjs';

describe('AudioMixer', () => {
  let audioContext;
  let mixer;

  beforeEach(async () => {
    audioContext = new AudioContext();
    mixer = new AudioMixer(audioContext);
  });

  afterEach(() => {
    if (mixer) {
      mixer.destroy();
    }
    if (audioContext) {
      audioContext.close();
    }
  });

  describe('Initialization', () => {
    it('creates mixer with default configuration', () => {
      expect(mixer).toBeDefined();
      expect(mixer.config.transitionType).toBe('crossfade');
      expect(mixer.config.transitionDuration).toBe(2.0);
      expect(mixer.isInitialized).toBe(false);
    });

    it('accepts custom configuration options', () => {
      const customMixer = new AudioMixer(audioContext, {
        transitionType: 'instant',
        transitionDuration: 1.0,
      });
      
      expect(customMixer.config.transitionType).toBe('instant');
      expect(customMixer.config.transitionDuration).toBe(1.0);
      
      customMixer.destroy();
    });

    it('initializes both live and preview streams', async () => {
      await mixer.initialize();
      
      expect(mixer.isInitialized).toBe(true);
      expect(mixer.liveStream).toBeDefined();
      expect(mixer.previewStream).toBeDefined();
      expect(mixer.transitionMixer).toBeDefined();
    });

    it('creates streams with correct names', async () => {
      await mixer.initialize();
      
      expect(mixer.liveStream.name).toBe('live');
      expect(mixer.previewStream.name).toBe('preview');
    });
  });

  describe('Device Management', () => {
    beforeEach(async () => {
      await mixer.initialize();
    });

    it('gets available audio devices', async () => {
      const devices = await mixer.getAvailableDevices();
      
      expect(Array.isArray(devices)).toBe(true);
      // Mock setup provides 3 devices
      expect(devices.length).toBeGreaterThan(0);
    });

    it('sets devices for both streams', async () => {
      await mixer.setDevices('device1', 'device2');
      
      expect(mixer.config.liveDeviceId).toBe('device1');
      expect(mixer.config.previewDeviceId).toBe('device2');
    });
  });

  describe('Configuration Persistence', () => {
    it('persists configuration to localStorage', async () => {
      await mixer.initialize();
      await mixer.setDevices('device1', 'device2');
      
      mixer.persistConfig();
      
      const stored = localStorage.getItem('strudel-mixer-config');
      expect(stored).toBeDefined();
      
      const config = JSON.parse(stored);
      expect(config.liveDeviceId).toBe('device1');
      expect(config.previewDeviceId).toBe('device2');
    });

    it('restores configuration from localStorage', () => {
      const testConfig = {
        liveDeviceId: 'test-live',
        previewDeviceId: 'test-preview',
        transitionType: 'instant',
        transitionDuration: 1.5,
      };
      
      localStorage.setItem('strudel-mixer-config', JSON.stringify(testConfig));
      
      const newMixer = new AudioMixer(audioContext);
      newMixer.restoreConfig();
      
      expect(newMixer.config.liveDeviceId).toBe('test-live');
      expect(newMixer.config.previewDeviceId).toBe('test-preview');
      expect(newMixer.config.transitionType).toBe('instant');
      
      newMixer.destroy();
    });

    it('resets configuration to defaults', async () => {
      await mixer.initialize();
      await mixer.setDevices('device1', 'device2');
      mixer.persistConfig();
      
      mixer.reset();
      
      expect(mixer.config.liveDeviceId).toBeNull();
      expect(mixer.config.previewDeviceId).toBeNull();
      expect(mixer.config.transitionType).toBe('crossfade');
      
      const stored = localStorage.getItem('strudel-mixer-config');
      expect(stored).toBeNull();
    });
  });

  describe('State Management', () => {
    it('returns current mixer state', async () => {
      await mixer.initialize();
      
      const state = mixer.getState();
      
      expect(state.isInitialized).toBe(true);
      expect(state.config).toBeDefined();
      expect(state.liveStream).toBeDefined();
      expect(state.previewStream).toBeDefined();
      expect(state.isTransitioning).toBe(false);
    });
  });

  describe('Cleanup', () => {
    it('destroys mixer and cleans up resources', async () => {
      await mixer.initialize();
      
      mixer.destroy();
      
      expect(mixer.isInitialized).toBe(false);
      expect(mixer.liveStream).toBeNull();
      expect(mixer.previewStream).toBeNull();
      expect(mixer.transitionMixer).toBeNull();
    });
  });
});
