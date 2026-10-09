/**
 * Basic tests for AudioMixer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioMixer } from '../AudioMixer.mjs';
import { stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

describe('AudioMixer', () => {
  let audioContext;
  let mixer;

  beforeEach(async () => {
    // Per-test stubs: the root config runs with isolate:false, so globals must not outlive this file.
    stubWebAudio();
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
    unstubWebAudio();
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

    it('routes each stream through a 10-band equalizer', async () => {
      await mixer.initialize();

      for (const stream of [mixer.liveStream, mixer.previewStream]) {
        const eq = stream.getState().equalizer;
        expect(eq.isEnabled).toBe(true);
        expect(eq.bands.map((b) => b.frequency)).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
        // inputGain feeds the EQ input, not the media stream directly
        expect(stream.getInput().connections).toContain(stream.equalizer.getInput());
        expect(stream.getInput().connections).not.toContain(stream.mediaStreamDest);
      }
    });

    it('does not re-create streams when initialize is called twice', async () => {
      await mixer.initialize();
      const live = mixer.liveStream;

      await mixer.initialize();

      expect(mixer.liveStream).toBe(live);
    });

    it('rejects initialization when the AudioContext cannot build the EQ chain', async () => {
      const broken = new AudioContext();
      broken.createBiquadFilter = undefined;
      const brokenMixer = new AudioMixer(broken);

      await expect(brokenMixer.initialize()).rejects.toThrow('AudioMixer initialization failed');
      expect(brokenMixer.isInitialized).toBe(false);
    });
  });

  describe('Device Management', () => {
    beforeEach(async () => {
      await mixer.initialize();
    });

    it('gets available audio devices', async () => {
      const devices = await mixer.getAvailableDevices();
      
      expect(Array.isArray(devices)).toBe(true);
      expect(devices.map((d) => d.deviceId)).toEqual(['default', 'device1', 'device2']);
    });

    it('excludes non-output devices from the device list', async () => {
      const devices = await mixer.getAvailableDevices();

      expect(devices.every((d) => d.kind === 'audiooutput')).toBe(true);
      expect(devices.map((d) => d.deviceId)).not.toContain('mic');
    });

    it('sets devices for both streams', async () => {
      await mixer.setDevices('device1', 'device2');
      
      expect(mixer.config.liveDeviceId).toBe('device1');
      expect(mixer.config.previewDeviceId).toBe('device2');
      expect(mixer.liveStream.audioElement.sinkId).toBe('device1');
      expect(mixer.previewStream.audioElement.sinkId).toBe('device2');
    });

    it('refuses to set devices before initialization', async () => {
      const fresh = new AudioMixer(audioContext);

      await expect(fresh.setDevices('device1', 'device2')).rejects.toThrow('Not initialized');
      expect(fresh.config.liveDeviceId).toBeNull();
      fresh.destroy();
    });
  });

  describe('Configuration Persistence', () => {
    it('persists configuration to localStorage', async () => {
      await mixer.initialize();
      await mixer.setDevices('device1', 'device2');
      
      mixer.persistConfig();
      
      const stored = localStorage.getItem('strudel-mixer-config');
      expect(stored).not.toBeNull();
      
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
