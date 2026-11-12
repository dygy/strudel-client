/**
 * PreviewEngine - Independent audio engine for preview stream
 *
 * Creates a second SuperdoughAudioController + repl instance so that
 * preview audio is completely independent from the live audio chain.
 * The live pattern keeps playing on speakers while the preview pattern
 * plays on headphones.
 *
 * Audio chain:
 *   previewRepl → previewSuperdough(controller) → previewController.output
 *     → channelMerger → [scratch node, spec 019] → destinationGain → equalizer
 *     → MediaStreamDest → HTMLAudioElement.setSinkId(headphones)
 *
 * @class PreviewEngine
 * @license AGPL-3.0-or-later
 */

import { AudioEqualizer, applyEqualizerSettings, loadEqualizerSettings } from '@strudel/equalizer';
import { ScratchDeck } from './scratch/ScratchDeck.mjs';

export class PreviewEngine {
  /**
   * @param {AudioContext} audioContext - Shared AudioContext
   * @param {object} deps - Injected dependencies to avoid cross-package singleton issues
   * @param {Function} deps.superdough - The superdough function (with _controller param)
   * @param {Function} deps.repl - The repl() factory from @strudel/core
   * @param {Function} deps.getTime - Time function for the repl scheduler
   * @param {new (ctx: AudioContext) => any} deps.SuperdoughAudioController - Controller class
   * @param {Function} [deps.transpiler] - Code transpiler
   */
  constructor(audioContext, deps) {
    this.audioContext = audioContext;
    this.deps = deps;

    this.controller = null; // Own SuperdoughAudioController
    this.replInstance = null; // Own repl instance
    this.equalizer = null; // Own AudioEqualizer
    this.audioElement = null; // HTMLAudioElement for device routing
    this.mediaStreamDest = null;
    /** The headphone deck's scratch node (spec 019); created lazily by ensureScratchDeck(). */
    this.scratchDeck = null;
    this.isInitialized = false;
    this.isPlaying = false;
    this.deviceId = null;
  }

  /**
   * Initialize the preview engine's independent audio chain.
   */
  async initialize() {
    if (this.isInitialized) return;

    const { SuperdoughAudioController, superdough, repl, getTime, transpiler } = this.deps;
    const ac = this.audioContext;

    // 1. Create our own controller with its own orbits and output chain
    this.controller = new SuperdoughAudioController(ac);

    // 2. Disconnect the controller's default output from audioContext.destination
    //    and route it through equalizer → MediaStreamDest → HTMLAudioElement for device routing
    const destGain = this.controller.output.destinationGain;
    try {
      destGain.disconnect();
    } catch (e) {
      /* may not be connected */
    }

    // Create equalizer, with the saved settings applied now: the headphones hear the EQ without
    // the settings panel having been opened (spec 008).
    this.equalizer = new AudioEqualizer(ac);
    try {
      const saved = loadEqualizerSettings();
      if (saved) {
        applyEqualizerSettings(this.equalizer, saved);
      }
    } catch (err) {
      console.warn('[PreviewEngine] could not apply saved EQ settings:', err);
    }

    // Connect: destGain → equalizer → mediaStreamDest
    destGain.connect(this.equalizer.getInput());

    this.mediaStreamDest = ac.createMediaStreamDestination();
    this.equalizer.getOutput().connect(this.mediaStreamDest);

    this.audioElement = new Audio();
    this.audioElement.srcObject = this.mediaStreamDest.stream;

    // 3. Create a custom output function that uses OUR controller
    const previewController = this.controller;
    const previewOutput = (hap, _deadline, hapDuration, cps, t) => {
      const value =
        typeof hap.ensureObjectValue === 'function'
          ? (hap.ensureObjectValue(), hap.value)
          : typeof hap.value === 'object'
            ? hap.value
            : { s: hap.value };
      return superdough(value, t, hapDuration, cps, hap.whole?.begin?.valueOf?.() ?? 0, previewController);
    };

    // 4. Create our own repl instance with the custom output
    this.replInstance = repl({
      defaultOutput: previewOutput,
      getTime,
      transpiler,
      onToggle: (started) => {
        this.isPlaying = started;
        console.log(`[PreviewEngine] ${started ? 'started' : 'stopped'}`);
      },
    });

    // The headphone scratch deck (spec 019) is NOT created here: initialize() runs at page
    // mount, before any user gesture. ensureScratchDeck() creates it when the preview starts.

    this.isInitialized = true;
    console.log('[PreviewEngine] initialized with independent audio chain and equalizer');
  }

  /**
   * Create and attach the headphone scratch deck (spec 019) on first use: the worklet module
   * and its 8-second ring are loaded only once the preview actually plays. evaluate() starts
   * this; the website awaits it to register the deck. Repeated calls share one deck; a deck
   * whose attach failed is retried.
   * @returns {Promise<ScratchDeck|null>} The attached deck, or null when not initialized, when
   *   the deck could not attach, or when destroy() ran meanwhile.
   */
  async ensureScratchDeck() {
    if (!this.isInitialized || !this.controller) return null;
    if (!this.scratchDeck) this.scratchDeck = new ScratchDeck(this.audioContext, this.controller);
    const deck = this.scratchDeck;
    const attached = await deck.attach();
    if (this.scratchDeck !== deck) return null; // destroy() ran while the worklet loaded
    return attached ? deck : null;
  }

  /**
   * Ensure the audio element is playing (needs user gesture).
   */
  async ensurePlaying() {
    if (this.audioElement && this.audioElement.paused) {
      try {
        await this.audioElement.play();
      } catch (err) {
        console.warn('[PreviewEngine] play() deferred:', err.message);
      }
    }
  }

  /**
   * Route preview audio to a specific device (headphones).
   * @param {string|null} deviceId
   */
  async setDevice(deviceId) {
    if (!this.audioElement) return;
    const id = deviceId || '';
    if (!this.audioElement.setSinkId) {
      console.warn('[PreviewEngine] setSinkId not supported');
      return;
    }
    try {
      await this.audioElement.setSinkId(id);
      this.deviceId = deviceId;
      console.log(`[PreviewEngine] routed to device: ${deviceId || 'default'}`);
    } catch (err) {
      console.error('[PreviewEngine] setDevice failed:', err);
      this.deviceId = null;
    }
  }

  /**
   * Evaluate code on the preview engine (plays on headphones).
   * @param {string} code - Strudel pattern code
   */
  async evaluate(code) {
    if (!this.isInitialized) {
      throw new Error('PreviewEngine not initialized');
    }
    await this.ensurePlaying();
    // After a gesture: create the scratch deck now, without delaying the preview start.
    this.ensureScratchDeck();
    return this.replInstance.evaluate(code);
  }

  /**
   * Stop preview playback.
   */
  stop() {
    if (this.replInstance) {
      this.replInstance.stop();
      this.isPlaying = false;
    }
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    this.stop();
    if (this.scratchDeck) {
      this.scratchDeck.destroy();
      this.scratchDeck = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }
    if (this.equalizer) {
      this.equalizer.destroy();
      this.equalizer = null;
    }
    if (this.controller?.output?.destinationGain) {
      try {
        this.controller.output.destinationGain.disconnect();
      } catch (e) {
        /* ok */
      }
    }
    this.mediaStreamDest = null;
    this.controller = null;
    this.replInstance = null;
    this.isInitialized = false;
    this.isPlaying = false;
    console.log('[PreviewEngine] destroyed');
  }
}
