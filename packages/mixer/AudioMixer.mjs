/**
 * AudioMixer - Dual-device audio routing for live/preview streams
 *
 * Intercepts Strudel's superdough output and splits it into two
 * independently-routable streams via MediaStreamDestination + setSinkId.
 *
 * @class AudioMixer
 * @license AGPL-3.0-or-later
 */

import { AudioStream } from './AudioStream.mjs';
import { TransitionMixer } from './TransitionMixer.mjs';
import { ErrorNotifier } from './ErrorNotifier.mjs';

export class AudioMixer {
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this.liveStream = null;
    this.previewStream = null;
    this.transitionMixer = null;
    this.errorNotifier = new ErrorNotifier();
    this.isInitialized = false;
    this.isConnected = false;
    this._destinationGain = null;

    this.config = {
      liveDeviceId: null,
      previewDeviceId: null,
      transitionType: 'crossfade',
      transitionDuration: 2.0,
      ...options,
    };
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      this.restoreConfig();

      this.liveStream = new AudioStream('live', this.audioContext);
      await this.liveStream.initialize();

      this.previewStream = new AudioStream('preview', this.audioContext);
      await this.previewStream.initialize();

      this.transitionMixer = new TransitionMixer(
        this.audioContext,
        this.liveStream,
        this.previewStream,
      );

      this.isInitialized = true;

      // Restore saved devices (non-fatal — stale device IDs are cleared)
      try {
        if (this.config.liveDeviceId) {
          await this.liveStream.setDevice(this.config.liveDeviceId).catch((e) => {
            console.warn('[AudioMixer] restore live device failed, clearing:', e.message);
            this.config.liveDeviceId = null;
          });
        }
        if (this.config.previewDeviceId) {
          await this.previewStream.setDevice(this.config.previewDeviceId).catch((e) => {
            console.warn('[AudioMixer] restore preview device failed, clearing:', e.message);
            this.config.previewDeviceId = null;
          });
        }
      } catch (e) {
        console.warn('[AudioMixer] device restore error (non-fatal):', e.message);
        this.config.liveDeviceId = null;
        this.config.previewDeviceId = null;
      }
      this.persistConfig();

      // NOTE: Don't auto-connect here. The caller must call
      // connectToDestinationGain(gainNode) with the real superdough
      // destinationGain after audio has started. This avoids module
      // singleton mismatches when the mixer is in a separate package.
      console.log('[AudioMixer] initialized (not yet connected to audio)');
    } catch (err) {
      console.error('[AudioMixer] init failed:', err);
      this.isInitialized = false;
      throw new Error('AudioMixer initialization failed: ' + err.message);
    }
  }

  /**
   * Connect to the destinationGain and split to both streams.
   * The caller MUST pass the real GainNode from the same module singleton
   * that produces audio. This avoids cross-package singleton issues.
   *
   * Before: destinationGain -> audioContext.destination
   * After:  destinationGain -> live inputGain -> live device
   *                         -> preview inputGain -> preview device
   *
   * @param {GainNode} gainNode - The destinationGain from SuperdoughOutput
   */
  connectToDestinationGain(gainNode) {
    if (this.isConnected) return;

    if (!gainNode) {
      console.warn('[AudioMixer] connectToDestinationGain called with no gainNode');
      return;
    }

    // Disconnect from default destination (speakers)
    try {
      gainNode.disconnect();
    } catch (e) {
      /* may already be disconnected */
    }

    // Split to both streams
    gainNode.connect(this.liveStream.getInput());
    gainNode.connect(this.previewStream.getInput());

    // Default: only live stream audible, preview muted
    this.liveStream.setGain(1);
    this.previewStream.setGain(0);

    this.isConnected = true;
    this._destinationGain = gainNode;
    console.log('[AudioMixer] audio split to live + preview');
  }

  async ensureStreamsPlaying() {
    if (!this.isInitialized) return;
    await this.liveStream.ensurePlaying();
    await this.previewStream.ensurePlaying();
  }

  async getAvailableDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audiooutput');
    } catch (err) {
      return [];
    }
  }

  async setDevices(liveDeviceId, previewDeviceId) {
    if (!this.isInitialized) throw new Error('Not initialized');

    if (liveDeviceId !== undefined) {
      try {
        await this.liveStream.setDevice(liveDeviceId);
        this.config.liveDeviceId = liveDeviceId;
      } catch (e) {
        console.warn('[AudioMixer] Failed to set live device:', e.message);
        this.config.liveDeviceId = null;
      }
    }
    if (previewDeviceId !== undefined) {
      try {
        await this.previewStream.setDevice(previewDeviceId);
        this.config.previewDeviceId = previewDeviceId;
      } catch (e) {
        console.warn('[AudioMixer] Failed to set preview device:', e.message);
        this.config.previewDeviceId = null;
      }
    }
    this.persistConfig();
  }

  async transition(type = this.config.transitionType, duration = this.config.transitionDuration) {
    if (!this.isInitialized) throw new Error('Not initialized');
    if (this.transitionMixer.isTransitioning) throw new Error('Transition in progress');

    await this.transitionMixer.execute(type, duration);

    const temp = this.liveStream;
    this.liveStream = this.previewStream;
    this.previewStream = temp;
    this.transitionMixer.liveStream = this.liveStream;
    this.transitionMixer.previewStream = this.previewStream;
  }

  persistConfig() {
    try {
      localStorage.setItem(
        'strudel-mixer-config',
        JSON.stringify({
          liveDeviceId: this.config.liveDeviceId,
          previewDeviceId: this.config.previewDeviceId,
          transitionType: this.config.transitionType,
          transitionDuration: this.config.transitionDuration,
        }),
      );
    } catch (e) {
      /* ok */
    }
  }

  restoreConfig() {
    try {
      const stored = localStorage.getItem('strudel-mixer-config');
      if (stored) this.config = { ...this.config, ...JSON.parse(stored) };
    } catch (e) {
      /* ok */
    }
  }

  reset() {
    localStorage.removeItem('strudel-mixer-config');
    this.config = {
      liveDeviceId: null,
      previewDeviceId: null,
      transitionType: 'crossfade',
      transitionDuration: 2.0,
    };
  }

  getState() {
    return {
      isInitialized: this.isInitialized,
      isConnected: this.isConnected,
      config: { ...this.config },
      liveStream: this.liveStream?.getState(),
      previewStream: this.previewStream?.getState(),
      isTransitioning: this.transitionMixer?.isTransitioning ?? false,
    };
  }

  destroy() {
    // Reconnect to default destination on cleanup
    if (this.isConnected && this._destinationGain) {
      try {
        this._destinationGain.disconnect();
        this._destinationGain.connect(this.audioContext.destination);
      } catch (e) {
        /* best effort */
      }
    }

    this.liveStream?.destroy();
    this.previewStream?.destroy();
    this.transitionMixer?.destroy();
    this.liveStream = null;
    this.previewStream = null;
    this.transitionMixer = null;
    this._destinationGain = null;
    this.isInitialized = false;
    this.isConnected = false;
  }
}
