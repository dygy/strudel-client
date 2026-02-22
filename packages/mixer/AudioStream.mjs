/**
 * AudioStream - Represents a single audio output stream (Live or Preview)
 * 
 * Uses MediaStreamDestination + HTMLAudioElement.setSinkId() to route
 * audio from the shared AudioContext to a specific output device.
 * 
 * @class AudioStream
 * @license AGPL-3.0-or-later
 */

import { AudioEqualizer } from '@strudel/equalizer';

export class AudioStream {
  /**
   * @param {string} name - 'live' or 'preview'
   * @param {AudioContext} audioContext - Shared AudioContext
   */
  constructor(name, audioContext) {
    this.name = name;
    this.audioContext = audioContext;
    
    // Audio routing: inputGain → equalizer → mediaStreamDest → audioElement
    this.inputGain = null;
    this.equalizer = null;
    this.mediaStreamDest = null;
    this.audioElement = null;
    
    this.deviceId = null;
    this.isInitialized = false;
    this.isActive = false;
  }

  /**
   * Initialize the stream's audio routing chain
   */
  async initialize() {
    if (this.isInitialized) return;

    // Gain node to control this stream's volume
    this.inputGain = this.audioContext.createGain();
    this.inputGain.gain.value = 1.0;

    // Create equalizer
    this.equalizer = new AudioEqualizer(this.audioContext);

    // Connect: inputGain -> equalizer -> mediaStreamDest
    this.inputGain.connect(this.equalizer.getInput());

    // MediaStreamDestination captures audio into a MediaStream
    this.mediaStreamDest = this.audioContext.createMediaStreamDestination();
    this.equalizer.getOutput().connect(this.mediaStreamDest);

    // HTMLAudioElement plays the stream - setSinkId routes to specific device
    this.audioElement = new Audio();
    this.audioElement.srcObject = this.mediaStreamDest.stream;

    this.isInitialized = true;

    // Start playback (will be silent until audio is connected)
    try {
      await this.audioElement.play();
    } catch (err) {
      // Expected before user interaction
      console.warn(`[AudioStream:${this.name}] play() deferred until user interaction`);
    }

    console.log(`[AudioStream:${this.name}] initialized with equalizer`);
  }

  /**
   * Ensure the audio element is playing (call after user interaction)
   */
  async ensurePlaying() {
    if (this.audioElement && this.audioElement.paused) {
      try {
        await this.audioElement.play();
      } catch (err) {
        console.warn(`[AudioStream:${this.name}] play() failed:`, err);
      }
    }
  }

  /**
   * Route this stream to a specific output device
   * @param {string|null} deviceId - Device ID or null/'' for default
   */
  async setDevice(deviceId) {
    if (!this.isInitialized) {
      throw new Error(`AudioStream ${this.name} not initialized`);
    }

    const normalizedId = deviceId || '';
    
    if (normalizedId === (this.deviceId || '')) return;

    if (!this.audioElement.setSinkId) {
      console.warn(`[AudioStream:${this.name}] setSinkId not supported`);
      return;
    }

    try {
      await this.audioElement.setSinkId(normalizedId);
      this.deviceId = deviceId;
      console.log(`[AudioStream:${this.name}] routed to device: ${deviceId || 'default'}`);
    } catch (err) {
      console.error(`[AudioStream:${this.name}] setDevice failed:`, err);
      this.deviceId = null;
      throw err;
    }
  }

  /**
   * Get the input GainNode (connect audio sources here)
   * @returns {GainNode}
   */
  getInput() {
    return this.inputGain;
  }

  setGain(value) {
    if (this.inputGain) {
      this.inputGain.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  getGain() {
    return this.inputGain?.gain.value ?? 0;
  }

  getState() {
    return {
      name: this.name,
      isInitialized: this.isInitialized,
      isActive: this.isActive,
      deviceId: this.deviceId,
      gain: this.getGain(),
      equalizer: this.equalizer?.getState(),
    };
  }

  destroy() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }
    if (this.equalizer) {
      this.equalizer.destroy();
      this.equalizer = null;
    }
    if (this.inputGain) {
      this.inputGain.disconnect();
      this.inputGain = null;
    }
    this.mediaStreamDest = null;
    this.isInitialized = false;
    console.log(`[AudioStream:${this.name}] destroyed`);
  }
}
