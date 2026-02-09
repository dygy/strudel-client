/**
 * TransitionMixer - Handles smooth transitions between live and preview streams
 * 
 * Provides instant switch and crossfade transition methods with
 * mutual exclusion to prevent overlapping transitions.
 * 
 * @class TransitionMixer
 * @license AGPL-3.0-or-later
 */

export class TransitionMixer {
  /**
   * Create a TransitionMixer
   * 
   * @param {AudioContext} audioContext - Web Audio API context
   * @param {AudioStream} liveStream - Live audio stream
   * @param {AudioStream} previewStream - Preview audio stream
   */
  constructor(audioContext, liveStream, previewStream) {
    this.audioContext = audioContext;
    this.liveStream = liveStream;
    this.previewStream = previewStream;
    this.isTransitioning = false;
  }

  /**
   * Execute a transition
   * 
   * @param {string} type - Transition type ('instant' or 'crossfade')
   * @param {number} duration - Duration in seconds (for crossfade)
   * @returns {Promise<void>}
   */
  async execute(type, duration = 2.0) {
    if (this.isTransitioning) {
      throw new Error('Transition already in progress');
    }

    this.isTransitioning = true;
    
    try {
      // Notify transition start
      this.notifyTransitionState('start', type, duration);
      
      switch (type) {
        case 'instant':
          await this.instantSwitch();
          break;
        case 'crossfade':
          await this.crossfade(duration);
          break;
        default:
          throw new Error(`Unknown transition type: ${type}`);
      }
      
      // Notify transition complete
      this.notifyTransitionState('complete', type, duration);
    } catch (err) {
      // Notify transition error
      this.notifyTransitionState('error', type, duration, err);
      throw err;
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Instant switch transition
   * 
   * Immediately swaps the gain values of live and preview streams.
   * 
   * @returns {Promise<void>}
   */
  async instantSwitch() {
    const now = this.audioContext.currentTime;
    
    // Instantly swap volumes
    this.liveStream.inputGain.gain.setValueAtTime(0, now);
    this.previewStream.inputGain.gain.setValueAtTime(1, now);
    
    console.log('Instant switch transition complete');
  }

  /**
   * Crossfade transition
   * 
   * Gradually fades out the live stream while fading in the preview stream
   * over the specified duration.
   * 
   * @param {number} duration - Duration in seconds
   * @returns {Promise<void>}
   */
  async crossfade(duration) {
    const now = this.audioContext.currentTime;
    const endTime = now + duration;
    
    // Cancel any scheduled changes
    this.liveStream.inputGain.gain.cancelScheduledValues(now);
    this.previewStream.inputGain.gain.cancelScheduledValues(now);
    
    // Schedule gain ramps
    this.liveStream.inputGain.gain.setValueAtTime(
      this.liveStream.inputGain.gain.value,
      now
    );
    this.liveStream.inputGain.gain.linearRampToValueAtTime(0, endTime);
    
    this.previewStream.inputGain.gain.setValueAtTime(
      this.previewStream.inputGain.gain.value,
      now
    );
    this.previewStream.inputGain.gain.linearRampToValueAtTime(1, endTime);
    
    // Wait for transition to complete
    await new Promise(resolve => setTimeout(resolve, duration * 1000));
    
    console.log(`Crossfade transition complete (${duration}s)`);
  }

  /**
   * Notify transition state change
   * 
   * @param {string} state - Transition state ('start', 'complete', 'error')
   * @param {string} type - Transition type
   * @param {number} duration - Transition duration
   * @param {Error} error - Error object (if state is 'error')
   */
  notifyTransitionState(state, type, duration, error = null) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mixer-transition', {
        detail: {
          state,
          type,
          duration,
          error: error ? error.message : null,
          timestamp: Date.now(),
        },
      }));
    }
  }

  /**
   * Get transition state
   * 
   * @returns {Object} Current transition state
   */
  getState() {
    return {
      isTransitioning: this.isTransitioning,
    };
  }

  /**
   * Cleanup and destroy the transition mixer
   */
  destroy() {
    // Cancel any ongoing transitions
    if (this.isTransitioning) {
      console.warn('Destroying TransitionMixer while transition in progress');
    }
    
    this.liveStream = null;
    this.previewStream = null;
    this.audioContext = null;
    this.isTransitioning = false;
  }
}
