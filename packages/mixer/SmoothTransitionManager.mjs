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
   * Execute a smooth transition to new code
   * @param {string} newCode - The new pattern code to evaluate
   * @returns {Promise<void>}
   */
  async executeTransition(newCode) {
    // If transition already in progress, queue this one
    if (this.isTransitioning) {
      console.log('[SmoothTransitionManager] Transition in progress, queueing update');
      this.queueTransition(newCode);
      return;
    }
    
    this.isTransitioning = true;
    
    try {
      // Ensure audio context is running
      await this.ensureAudioContextRunning();
      
      // Phase 1: Fade down current track
      console.log('[SmoothTransitionManager] Starting fade down');
      await this.fadeDown(this.duration);
      
      // Phase 2: Stop current pattern (this will trigger onToggle but won't clean canvases due to flag)
      if (this.replInstance && this.replInstance.stop) {
        console.log('[SmoothTransitionManager] Stopping current pattern');
        this.replInstance.stop();
      }
      
      // Phase 3: Clean up OLD regular canvases (but not Hydra)
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
      
      // Phase 4: Small delay to ensure cleanup completes
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Phase 5: Evaluate new code (this will create new canvases)
      if (this.replInstance && this.replInstance.evaluate) {
        console.log('[SmoothTransitionManager] Evaluating new code');
        this.replInstance.evaluate(newCode);
      }
      
      // Phase 6: Fade up new track
      console.log('[SmoothTransitionManager] Starting fade up');
      await this.fadeUp(this.duration, this.targetVolume);
      
      console.log('[SmoothTransitionManager] Transition complete');
    } catch (error) {
      console.error('[SmoothTransitionManager] Transition failed:', error);
      
      // Restore volume to prevent muted audio
      if (this.destinationGain) {
        const now = this.audioContext.currentTime;
        this.destinationGain.gain.cancelScheduledValues(now);
        this.destinationGain.gain.setValueAtTime(this.targetVolume, now);
      }
      
      // Emit error event for UI notification
      this.emitEvent('transition-error', { error: error.message });
      
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
   */
  queueTransition(newCode) {
    // Only keep the most recent queued code (replace if multiple)
    this.queuedCode = newCode;
    console.log('[SmoothTransitionManager] Transition queued');
  }

  /**
   * Process queued transitions
   * @private
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.queuedCode !== null) {
      const code = this.queuedCode;
      this.queuedCode = null;
      
      console.log('[SmoothTransitionManager] Processing queued transition');
      await this.executeTransition(code);
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
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AudioContext resume timeout')), 5000)
          )
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
      window.dispatchEvent(new CustomEvent(`smooth-transition-${eventName}`, {
        detail: {
          ...detail,
          timestamp: Date.now(),
        },
      }));
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
    this.destinationGain.gain.setValueAtTime(
      this.destinationGain.gain.value,
      now
    );
    this.destinationGain.gain.linearRampToValueAtTime(0, endTime);
    
    // Wait for fade to complete
    await new Promise(resolve => setTimeout(resolve, duration * 1000));
    
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
    await new Promise(resolve => setTimeout(resolve, duration * 1000));
    
    console.log(`[SmoothTransitionManager] Fade up complete (${duration}s, target: ${targetVolume})`);
  }

  /**
   * Cleanup resources
   */
  destroy() {
    console.log('[SmoothTransitionManager] Destroying');
    
    // Clear any queued transitions
    this.queuedCode = null;
    
    // Reset state
    this.isTransitioning = false;
    
    // Clear references
    this.audioContext = null;
    this.replInstance = null;
    this.destinationGain = null;
  }
}
