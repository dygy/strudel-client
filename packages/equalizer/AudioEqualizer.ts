import { EQUALIZER_PRESETS } from './presets.js';

/**
 * Band configuration interface
 */
interface BandConfig {
  frequency: number;
  type: BiquadFilterType;
  gain: number;
  Q: number;
}

/**
 * Band state interface
 */
interface Band {
  filter: BiquadFilterNode;
  config: BandConfig;
}

/**
 * Equalizer state interface
 */
export interface EqualizerState {
  isEnabled: boolean;
  bands: BandConfig[];
}

/**
 * Band update parameters
 */
export interface BandUpdate {
  gain?: number;
  Q?: number;
}

/**
 * AudioEqualizer - Multi-band parametric equalizer
 * 
 * Creates a chain of BiquadFilterNodes for frequency shaping.
 * Supports enable/disable, presets, and real-time parameter updates.
 */
export class AudioEqualizer {
  private audioContext: AudioContext;
  private isEnabled: boolean;
  private bands: Band[];
  private inputNode: GainNode | null;
  private outputNode: GainNode | null;
  private bandConfig: BandConfig[];

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.isEnabled = true;
    this.bands = [];
    this.inputNode = null;
    this.outputNode = null;
    
    // Default 10-band configuration
    this.bandConfig = [
      { frequency: 31, type: 'lowshelf', gain: 0, Q: 1.0 },
      { frequency: 62, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 125, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 250, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 500, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 1000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 2000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 4000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 8000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 16000, type: 'highshelf', gain: 0, Q: 1.0 }
    ];
    
    this.initialize();
  }

  /**
   * Initialize the filter chain
   */
  private initialize(): void {
    // Create input/output nodes for routing
    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    
    // Create filter chain
    let previousNode: AudioNode = this.inputNode;
    
    for (const config of this.bandConfig) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = config.type;
      filter.frequency.value = config.frequency;
      filter.gain.value = config.gain;
      filter.Q.value = config.Q;
      
      previousNode.connect(filter);
      this.bands.push({
        filter,
        config: { ...config }
      });
      previousNode = filter;
    }
    
    // Connect last filter to output
    previousNode.connect(this.outputNode);
  }

  /**
   * Connect audio source to equalizer input
   */
  getInput(): GainNode {
    if (!this.inputNode) {
      throw new Error('Equalizer not initialized');
    }
    return this.inputNode;
  }

  /**
   * Get equalizer output for connection to next node
   */
  getOutput(): GainNode {
    if (!this.outputNode) {
      throw new Error('Equalizer not initialized');
    }
    return this.outputNode;
  }

  /**
   * Enable or disable the equalizer
   * When disabled, all bands are set to 0 dB (flat response)
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    
    if (enabled) {
      // Restore band gains from config
      this.bands.forEach((band, index) => {
        const now = this.audioContext.currentTime;
        band.filter.gain.setValueAtTime(band.config.gain, now);
      });
    } else {
      // Set all bands to 0 dB (flat/bypass)
      this.bands.forEach((band) => {
        const now = this.audioContext.currentTime;
        band.filter.gain.setValueAtTime(0, now);
      });
    }
  }

  /**
   * Get current equalizer state
   */
  getState(): EqualizerState {
    return {
      isEnabled: this.isEnabled,
      bands: this.bands.map(b => ({ ...b.config }))
    };
  }

  /**
   * Restore equalizer state
   */
  setState(state: EqualizerState): void {
    if (state.isEnabled !== undefined) {
      this.setEnabled(state.isEnabled);
    }
    if (state.bands) {
      state.bands.forEach((bandState, index) => {
        this.setBand(index, bandState);
      });
    }
  }

  /**
   * Update a specific band's parameters
   */
  setBand(index: number, { gain, Q }: BandUpdate): void {
    if (index < 0 || index >= this.bands.length) return;
    
    const band = this.bands[index];
    const now = this.audioContext.currentTime;
    
    if (gain !== undefined) {
      // Clamp gain to [-12, 12] dB range
      const clampedGain = Math.max(-12, Math.min(12, gain));
      band.filter.gain.setValueAtTime(clampedGain, now);
      band.config.gain = clampedGain;
    }
    
    if (Q !== undefined) {
      // Clamp Q to [0.5, 4.0] range
      const clampedQ = Math.max(0.5, Math.min(4.0, Q));
      band.filter.Q.setValueAtTime(clampedQ, now);
      band.config.Q = clampedQ;
    }
  }

  /**
   * Reset all bands to flat (0 dB)
   */
  reset(): void {
    this.bands.forEach((_band, index) => {
      this.setBand(index, { gain: 0, Q: 1.0 });
    });
  }

  /**
   * Apply a preset configuration
   */
  applyPreset(preset: string): void {
    const presetConfig = EQUALIZER_PRESETS[preset];
    if (!presetConfig) {
      console.warn(`Unknown preset: ${preset}`);
      return;
    }
    
    presetConfig.gains.forEach((gain, index) => {
      this.setBand(index, { gain });
    });
  }

  /**
   * Get frequency response data for visualization
   * Returns array of dB values for the given frequencies
   */
  getFrequencyResponse(frequencies: Float32Array): Float32Array {
    const magResponse = new Float32Array(frequencies.length);
    const phaseResponse = new Float32Array(frequencies.length);
    
    // Initialize with unity gain
    magResponse.fill(1.0);
    
    // Accumulate response from each band
    this.bands.forEach(band => {
      const bandMag = new Float32Array(frequencies.length);
      const bandPhase = new Float32Array(frequencies.length);
      
      band.filter.getFrequencyResponse(frequencies, bandMag, bandPhase);
      
      // Multiply magnitudes (add in dB domain)
      for (let i = 0; i < frequencies.length; i++) {
        magResponse[i] *= bandMag[i];
      }
    });
    
    // Convert to dB
    const dbResponse = new Float32Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i++) {
      dbResponse[i] = 20 * Math.log10(magResponse[i]);
    }
    
    return dbResponse;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.bands.forEach(band => {
      band.filter.disconnect();
    });
    this.inputNode?.disconnect();
    this.outputNode?.disconnect();
    this.bands = [];
  }
}
