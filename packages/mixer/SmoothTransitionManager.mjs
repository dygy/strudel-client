/**
 * SmoothTransitionManager - Manages smooth volume transitions for track updates
 *
 * Provides configurable fade-down/fade-up transitions when users update their
 * live code, creating a Spotify-like listening experience during live coding.
 *
 * @class SmoothTransitionManager
 * @license AGPL-3.0-or-later
 */

const STORAGE_KEY = 'strudel-smooth-transitions';
const DEFAULT_ENABLED = false;
const DEFAULT_DURATION = 2.0;
const MIN_DURATION = 0.5;
const MAX_DURATION = 10.0;
// A failed transition brings the volume back over this many seconds, never in one step:
// tails of the old track (reverb, delay) may still be ringing under the silenced output.
const RESTORE_RAMP = 0.08;

export class SmoothTransitionManager {
  /**
   * Create a SmoothTransitionManager
   *
   * @param {AudioContext} audioContext - Web Audio API context
   * @param {Object} replInstance - StrudelMirror repl instance for pattern evaluation
   * @param {Object} options - Configuration options
   * @param {GainNode} options.destinationGain - GainNode to control (from SuperdoughAudioController)
   * @param {Function} options.cleanupCanvases - Optional function to clean up canvases
   * @param {boolean} options.enabled - Enable smooth transitions (default: false)
   * @param {number} options.duration - Transition duration in seconds (default: 2.0)
   */
  constructor(audioContext, replInstance, options = {}) {
    this.audioContext = audioContext;
    this.replInstance = replInstance;
    this.destinationGain = options.destinationGain;
    this.cleanupCanvases = options.cleanupCanvases || null;

    // State
    this.enabled = DEFAULT_ENABLED;
    this.duration = DEFAULT_DURATION;
    this.isTransitioning = false;
    this.queuedCode = null;
    this.queuedRestart = false;
    this.queuedPrepare = null;
    this.targetVolume = 1.0;

    // Restore settings from localStorage
    this.restoreSettings();

    // Apply any options passed to constructor (override restored settings)
    if (options.enabled !== undefined) {
      this.enabled = Boolean(options.enabled);
    }
    if (options.duration !== undefined) {
      this.duration = this.validateDuration(options.duration);
    }

    console.log('[SmoothTransitionManager] Initialized', {
      enabled: this.enabled,
      duration: this.duration,
    });
  }

  /**
   * Restore settings from localStorage
   * @private
   */
  restoreSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);

        if (settings.enabled !== undefined) {
          this.enabled = Boolean(settings.enabled);
        }

        if (settings.duration !== undefined) {
          this.duration = this.validateDuration(settings.duration);
        }

        console.log('[SmoothTransitionManager] Settings restored from localStorage', {
          enabled: this.enabled,
          duration: this.duration,
        });
      }
    } catch (error) {
      console.warn('[SmoothTransitionManager] Failed to restore settings:', error);
      // Continue with defaults
    }
  }

  /**
   * Persist settings to localStorage
   * @private
   */
  persistSettings() {
    try {
      const settings = {
        enabled: this.enabled,
        duration: this.duration,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('[SmoothTransitionManager] Failed to persist settings:', error);
      // Continue without persistence
    }
  }

  /**
   * Validate and clamp duration to valid range
   * @private
   * @param {number} duration - Duration to validate
   * @returns {number} Validated duration
   */
  validateDuration(duration) {
    const num = Number(duration);
    if (isNaN(num)) {
      console.warn('[SmoothTransitionManager] Invalid duration, using default');
      return DEFAULT_DURATION;
    }
    return Math.max(MIN_DURATION, Math.min(MAX_DURATION, num));
  }

  /**
   * Update transition settings
   * @param {Object} settings - Settings to update
   * @param {boolean} settings.enabled - Enable/disable smooth transitions
   * @param {number} settings.duration - Transition duration in seconds
   */
  updateSettings(settings) {
    if (settings.enabled !== undefined) {
      this.enabled = Boolean(settings.enabled);
    }

    if (settings.duration !== undefined) {
      this.duration = this.validateDuration(settings.duration);
    }

    this.persistSettings();

    console.log('[SmoothTransitionManager] Settings updated', {
      enabled: this.enabled,
      duration: this.duration,
    });
  }

  /**
   * Get current settings
   * @returns {Object} Current settings
   */
  getSettings() {
    return {
      enabled: this.enabled,
      duration: this.duration,
      isTransitioning: this.isTransitioning,
    };
  }

  /**
   * Execute a smooth transition to new code: fade down, (optionally restart the clock),
   * clean up canvases, evaluate, fade up.
   *
   * By default the new code is hot-swapped into the running scheduler, keeping its cycle
   * position and tempo. Pass `{ restart: true }` when switching to a DIFFERENT track: once
   * the output is silent, `repl.stop()` resets the clock so the new track starts at cycle 0
   * (and its own `setcps` applies on top of the reset tempo). The restart only ever happens
   * after the fade down has finished, so it is inaudible.
   *
   * If a restarted track fails to evaluate (the repl reports pattern errors itself and does
   * not throw, so this is detected as "the scheduler did not start"), the transition does
   * not fade up over silence: it fails like any other transition (volume restored by a short
   * ramp, `smooth-transition-transition-error` event with `detail.evaluateFailed: true`) and
   * rejects with an error whose `evaluateFailed` is `true`.
   *
   * @param {string} newCode - The new pattern code to evaluate
   * @param {Object} [options]
   * @param {boolean} [options.restart=false] - Restart playback at cycle 0 while silent (track switch)
   * @param {Function} [options.prepare] - Async hook awaited while silent, after the restart and
   *   canvas cleanup and before evaluate (e.g. reset the old track's tempo, effects and sounds
   *   without the change being heard). Errors are logged and ignored.
   * @returns {Promise<void>}
   */
  async executeTransition(newCode, { restart = false, prepare } = {}) {
    // If transition already in progress, queue this one
    if (this.isTransitioning) {
      console.log('[SmoothTransitionManager] Transition in progress, queueing update');
      this.queueTransition(newCode, { restart, prepare });
      return;
    }

    this.isTransitioning = true;

    try {
      // Ensure audio context is running
      await this.ensureAudioContextRunning();

      // Phase 1: Fade down current track
      console.log('[SmoothTransitionManager] Starting fade down');
      await this.fadeDown(this.duration);

      // Only a track switch stops the pattern. Cyclist.stop() resets the clock, so the
      // evaluate below starts the new track at cycle 0 (onToggle also resets cps; the new
      // code's setcps runs during evaluate and wins). An in-place update must NOT stop:
      // it hot-swaps at the current position. The output is silent here, so no click.
      if (restart && this.replInstance && this.replInstance.stop) {
        console.log('[SmoothTransitionManager] Track switch: restarting at cycle 0 while silent');
        this.replInstance.stop();
      }

      // Phase 2: Clean up OLD canvases (the website callback also clears Hydra)
      // This ensures old draw() canvases are removed before new ones are created
      if (this.cleanupCanvases) {
        console.log('[SmoothTransitionManager] Cleaning up old draw canvases');
        try {
          this.cleanupCanvases();
          console.log('[SmoothTransitionManager] Draw canvases cleaned');
        } catch (error) {
          console.warn('[SmoothTransitionManager] Could not cleanup draw canvases:', error);
        }
      }

      // Phase 3: Caller's reset, while silent (so e.g. a tempo reset is not heard on the old track)
      if (prepare) {
        try {
          await prepare();
        } catch (error) {
          console.warn('[SmoothTransitionManager] prepare() failed:', error);
        }
      }

      // Small delay to ensure cleanup completes
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Phase 4: Evaluate new code (hot-swap; this will create new canvases)
      if (this.replInstance && this.replInstance.evaluate) {
        console.log('[SmoothTransitionManager] Evaluating new code');
        // Await it: repl.evaluate is async (transpile, samples(), setPattern). Fading up
        // before it resolves would ramp the OLD pattern back up, then cut to the new one.
        await this.replInstance.evaluate(newCode);

        // After a restart a successful evaluate autostarts the scheduler. If it is still
        // stopped, the new track failed: don't fade up over silence.
        if (restart && this.replInstance.scheduler && this.replInstance.scheduler.started === false) {
          const error = new Error('The new track failed to evaluate');
          error.evaluateFailed = true;
          throw error;
        }
      }

      // Phase 5: Fade up new track
      console.log('[SmoothTransitionManager] Starting fade up');
      await this.fadeUp(this.duration, this.targetVolume);

      console.log('[SmoothTransitionManager] Transition complete');
    } catch (error) {
      console.error('[SmoothTransitionManager] Transition failed:', error);

      // Restore volume to prevent muted audio: a short ramp from the current level, not a jump.
      if (this.destinationGain) {
        const gain = this.destinationGain.gain;
        const now = this.audioContext.currentTime;
        const current = gain.value; // read before cancelling: the level the ramp starts from
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(current, now);
        gain.linearRampToValueAtTime(this.targetVolume, now + RESTORE_RAMP);
      }

      // Emit error event for UI notification. `evaluateFailed`: the new track's code is broken
      // and nothing is playing (vs. the transition itself failing).
      this.emitEvent('transition-error', { error: error.message, evaluateFailed: Boolean(error.evaluateFailed) });

      throw error;
    } finally {
      this.isTransitioning = false;

      // Process any queued transitions
      await this.processQueue();
    }
  }

  /**
   * Queue a transition for later execution
   * @private
   * @param {string} newCode - Code to queue
   * @param {Object} [options]
   * @param {boolean} [options.restart=false] - The queued transition is a track switch
   * @param {Function} [options.prepare] - See executeTransition
   */
  queueTransition(newCode, { restart = false, prepare } = {}) {
    // Only keep the most recent queued code (replace if multiple). A track switch that was
    // queued and then superseded is still a switch away from what is playing, so the
    // restart flag (and a pending reset) is sticky until the queue is drained.
    const pending = this.queuedCode !== null;
    this.queuedRestart = pending ? Boolean(this.queuedRestart || restart) : Boolean(restart);
    this.queuedPrepare = prepare || (pending ? this.queuedPrepare : null);
    this.queuedCode = newCode;
    console.log('[SmoothTransitionManager] Transition queued', { restart: this.queuedRestart });
  }

  /**
   * Process queued transitions
   * @private
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.queuedCode !== null) {
      const code = this.queuedCode;
      const restart = this.queuedRestart;
      const prepare = this.queuedPrepare || undefined;
      this.queuedCode = null;
      this.queuedRestart = false;
      this.queuedPrepare = null;

      console.log('[SmoothTransitionManager] Processing queued transition');
      await this.executeTransition(code, { restart, prepare });
    }
  }

  /**
   * Ensure AudioContext is running
   * @private
   * @returns {Promise<void>}
   */
  async ensureAudioContextRunning() {
    if (this.audioContext.state === 'suspended') {
      console.log('[SmoothTransitionManager] Resuming suspended AudioContext');
      try {
        await Promise.race([
          this.audioContext.resume(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('AudioContext resume timeout')), 5000)),
        ]);
      } catch (error) {
        throw new Error('Failed to resume AudioContext: ' + error.message);
      }
    }
  }

  /**
   * Emit custom event
   * @private
   * @param {string} eventName - Event name
   * @param {Object} detail - Event detail
   */
  emitEvent(eventName, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(`smooth-transition-${eventName}`, {
          detail: {
            ...detail,
            timestamp: Date.now(),
          },
        }),
      );
    }
  }

  /**
   * Fade down current track to silence
   * @private
   * @param {number} duration - Fade duration in seconds
   * @returns {Promise<void>}
   */
  async fadeDown(duration) {
    if (!this.destinationGain) {
      console.warn('[SmoothTransitionManager] No destinationGain available for fade down');
      return;
    }

    const now = this.audioContext.currentTime;
    const endTime = now + duration;

    // Cancel any scheduled changes
    this.destinationGain.gain.cancelScheduledValues(now);

    // Set current value and schedule fade to 0
    this.destinationGain.gain.setValueAtTime(this.destinationGain.gain.value, now);
    this.destinationGain.gain.linearRampToValueAtTime(0, endTime);

    // Wait for fade to complete
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));

    console.log(`[SmoothTransitionManager] Fade down complete (${duration}s)`);
  }

  /**
   * Fade up new track to target volume
   * @private
   * @param {number} duration - Fade duration in seconds
   * @param {number} targetVolume - Target volume level (0-1)
   * @returns {Promise<void>}
   */
  async fadeUp(duration, targetVolume) {
    if (!this.destinationGain) {
      console.warn('[SmoothTransitionManager] No destinationGain available for fade up');
      return;
    }

    const now = this.audioContext.currentTime;
    const endTime = now + duration;

    // Cancel any scheduled changes
    this.destinationGain.gain.cancelScheduledValues(now);

    // Start from 0 and fade to target volume
    this.destinationGain.gain.setValueAtTime(0, now);
    this.destinationGain.gain.linearRampToValueAtTime(targetVolume, endTime);

    // Wait for fade to complete
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));

    console.log(`[SmoothTransitionManager] Fade up complete (${duration}s, target: ${targetVolume})`);
  }

  /**
   * Cleanup resources
   */
  destroy() {
    console.log('[SmoothTransitionManager] Destroying');

    // Clear any queued transitions
    this.queuedCode = null;
    this.queuedRestart = false;
    this.queuedPrepare = null;

    // Reset state
    this.isTransitioning = false;

    // Clear references
    this.audioContext = null;
    this.replInstance = null;
    this.destinationGain = null;
  }
}
