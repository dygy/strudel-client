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
 *     → headphones volume (spec 031) → MediaStreamDest → HTMLAudioElement.setSinkId(headphones)
 *
 * @class PreviewEngine
 * @license AGPL-3.0-or-later
 */

import { AudioEqualizer, applyEqualizerSettings, loadEqualizerSettings } from '@strudel/equalizer';
import { getActiveSoundIds, releaseSounds } from 'superdough';
import { ScratchDeck } from './scratch/ScratchDeck.mjs';
import { PatternOffset, ScratchHandOver } from './scratch/ScratchShift.mjs';
import {
  HEADPHONES_VOLUME_STORAGE_KEY,
  clampVolume,
  createVolumeNode,
  readVolume,
  setVolume,
  writeVolume,
} from './volume.mjs';

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export class PreviewEngine {
  /**
   * @param {AudioContext} audioContext - Shared AudioContext
   * @param {object} deps - Injected dependencies to avoid cross-package singleton issues
   * @param {Function} deps.superdough - The superdough function (with _controller param)
   * @param {Function} deps.repl - The repl() factory from @strudel/core
   * @param {Function} deps.getTime - Time function for the repl scheduler
   * @param {new (ctx: AudioContext) => any} deps.SuperdoughAudioController - Controller class
   * @param {Function} [deps.transpiler] - Code transpiler
   * @param {{getActiveSoundIds: Function, releaseSounds: Function}} [deps.voices] - superdough's
   *   voice listing and release (spec 023; default: superdough's exports)
   * @param {Storage|null} [deps.storage] - Where the headphones volume is kept (spec 031; default:
   *   localStorage)
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
    /** Spec 023: the headphone track's scratch offset (its repl's editPattern), reset on stop. */
    this.scratchOffset = new PatternOffset({ getRepl: () => this.replInstance });
    /** @type {ScratchHandOver|null} */
    this.scratchHandOver = null;
    this.isInitialized = false;
    this.isPlaying = false;
    this.deviceId = null;
    /** Spec 031: the headphones volume node, the last node before the device sink (created once). */
    this.volumeNode = null;
    /** Spec 031: the headphones volume level, 0..1 (1 = unity), remembered in this browser. */
    this.volume = readVolume(this._storage(), HEADPHONES_VOLUME_STORAGE_KEY);
  }

  /** @private */
  _storage() {
    return this.deps?.storage !== undefined ? this.deps.storage : defaultStorage();
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
    // Spec 031: the headphones volume is the last node, after the EQ (at level 1 its gain is exactly 1).
    this.volumeNode = createVolumeNode(ac, this.volume);
    this.equalizer.getOutput().connect(this.volumeNode);
    this.volumeNode.connect(this.mediaStreamDest);

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
      // Spec 023: a scratch moves the headphone track (and only it) later by its lag.
      editPattern: (pattern) => this.scratchOffset.editPattern(pattern),
      onToggle: (started) => {
        this.isPlaying = started;
        if (!started) {
          // The next start is at cycle 0, and a record still spinning up has nothing to land on.
          this.scratchOffset.reset();
          this.scratchDeck?.abort();
        }
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
    if (!this.scratchDeck) {
      this.scratchDeck = new ScratchDeck(this.audioContext, this.controller);
      // Spec 023: the settled lag shifts this repl only; only this controller's voices are released.
      const previewController = this.controller;
      const voices = this.deps.voices ?? { getActiveSoundIds, releaseSounds };
      this.scratchHandOver = new ScratchHandOver(this.scratchDeck, {
        getRepl: () => this.replInstance,
        offset: this.scratchOffset,
        voices: {
          getActiveSoundIds: () => voices.getActiveSoundIds(previewController),
          releaseSounds: (...args) => voices.releaseSounds(...args),
        },
        // Long notes restarted after the shift play on the headphones too (review 1).
        trigger: (value, t, duration, cps, cycle) =>
          this.deps.superdough(value, t, duration, cps, cycle, previewController),
      });
    }
    const deck = this.scratchDeck;
    const attached = await deck.attach();
    if (this.scratchDeck !== deck) return null; // destroy() ran while the worklet loaded
    return attached ? deck : null;
  }

  /**
   * Spec 031: set the headphones volume. It ramps over 20 ms (never a jump) and is remembered in
   * this browser. Before initialize() the level is kept and applied when the chain is built.
   * @param {number} v01 - 0..1 (clamped); 1 is unity, today's level.
   * @returns {boolean} Whether a ramp was scheduled (false when unchanged or not built yet).
   */
  setVolume(v01) {
    if (typeof v01 !== 'number' || !Number.isFinite(v01)) return false;
    this.volume = clampVolume(v01);
    writeVolume(this._storage(), HEADPHONES_VOLUME_STORAGE_KEY, this.volume);
    return this.volumeNode ? setVolume(this.volumeNode.gain, this.volume, this.audioContext) : false;
  }

  /**
   * Spec 031: the headphones volume level, 0..1.
   * @returns {number}
   */
  getVolume() {
    return this.volume;
  }

  /**
   * Spec 031: the headphones volume node (on the preview's own AudioContext), or null before
   * initialize(). It belongs to the engine: don't disconnect it.
   * @returns {GainNode|null}
   */
  getVolumeNode() {
    return this.volumeNode;
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
    this.scratchHandOver?.destroy();
    this.scratchHandOver = null;
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
    if (this.volumeNode) {
      try {
        this.volumeNode.disconnect();
      } catch (e) {
        /* ok */
      }
      this.volumeNode = null;
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
