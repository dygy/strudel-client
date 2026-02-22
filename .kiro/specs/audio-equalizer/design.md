# Design Document: Audio Equalizer

## Overview

The audio equalizer feature provides users with precise frequency control over Strudel's audio output, similar to Spotify's equalizer interface. The equalizer will be implemented as a Web Audio API-based processing chain that integrates with the existing AudioMixer architecture, applying consistent frequency shaping to both live and preview audio streams.

The design follows a modular approach with three main components:
1. **AudioEqualizer** - Core equalizer logic using BiquadFilterNode chains
2. **EqualizerUI** - React-based user interface with visual feedback
3. **Integration Layer** - Hooks into AudioMixer and PreviewEngine

The equalizer will support 10 frequency bands, provide visual frequency response curves, include genre-based presets, and persist user settings across sessions.

## Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Strudel Audio Flow                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ destinationGain  │
                    │  (superdough)    │
                    └──────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
          ┌──────────────────┐  ┌──────────────────┐
          │  Live Stream     │  │ Preview Stream   │
          │  AudioStream     │  │  AudioStream     │
          └──────────────────┘  └──────────────────┘
                    │                   │
                    ▼                   ▼
          ┌──────────────────┐  ┌──────────────────┐
          │ AudioEqualizer   │  │ AudioEqualizer   │
          │ (10-band chain)  │  │ (10-band chain)  │
          └──────────────────┘  └──────────────────┘
                    │                   │
                    ▼                   ▼
          ┌──────────────────┐  ┌──────────────────┐
          │ MediaStreamDest  │  │ MediaStreamDest  │
          └──────────────────┘  └──────────────────┘
                    │                   │
                    ▼                   ▼
          ┌──────────────────┐  ┌──────────────────┐
          │ Live Device      │  │ Preview Device   │
          │ (Speakers)       │  │ (Headphones)     │
          └──────────────────┘  └──────────────────┘
```

### Integration Points

The equalizer integrates at two critical points in the audio chain:

1. **AudioStream Integration**: Each AudioStream instance (live and preview) will have its own AudioEqualizer instance inserted between the inputGain and mediaStreamDest nodes.

2. **PreviewEngine Integration**: The PreviewEngine's independent audio chain will have its equalizer inserted between the controller's destinationGain and the mediaStreamDest.

### Component Hierarchy

```
AudioMixer
├── liveStream (AudioStream)
│   └── equalizer (AudioEqualizer)
└── previewStream (AudioStream)
    └── equalizer (AudioEqualizer)

PreviewEngine
└── equalizer (AudioEqualizer)
```

## Components and Interfaces

### AudioEqualizer Class

The core equalizer implementation using Web Audio API.

```javascript
/**
 * AudioEqualizer - Multi-band parametric equalizer
 * 
 * Creates a chain of BiquadFilterNodes for frequency shaping.
 * Supports enable/disable, presets, and real-time parameter updates.
 */
class AudioEqualizer {
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this.isEnabled = true;
    this.bands = [];
    this.inputNode = null;
    this.outputNode = null;
    this.bypassNode = null;
    
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
  initialize() {
    // Create input/output nodes for routing
    this.inputNode = this.audioContext.createGain();
    this.outputNode = this.audioContext.createGain();
    this.bypassNode = this.audioContext.createGain();
    
    // Create filter chain
    let previousNode = this.inputNode;
    
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
    
    // Setup bypass path
    this.inputNode.connect(this.bypassNode);
    this.bypassNode.connect(this.outputNode);
    this.bypassNode.gain.value = 0; // Bypass disabled by default
  }

  /**
   * Connect audio source to equalizer input
   */
  getInput() {
    return this.inputNode;
  }

  /**
   * Get equalizer output for connection to next node
   */
  getOutput() {
    return this.outputNode;
  }

  /**
   * Enable or disable the equalizer
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    // Smooth transition to avoid clicks
    const now = this.audioContext.currentTime;
    const transitionTime = 0.01; // 10ms
    
    if (enabled) {
      // Enable EQ path, disable bypass
      this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, now);
      this.outputNode.gain.linearRampToValueAtTime(1, now + transitionTime);
      this.bypassNode.gain.setValueAtTime(this.bypassNode.gain.value, now);
      this.bypassNode.gain.linearRampToValueAtTime(0, now + transitionTime);
    } else {
      // Disable EQ path, enable bypass
      this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, now);
      this.outputNode.gain.linearRampToValueAtTime(0, now + transitionTime);
      this.bypassNode.gain.setValueAtTime(this.bypassNode.gain.value, now);
      this.bypassNode.gain.linearRampToValueAtTime(1, now + transitionTime);
    }
  }

  /**
   * Update a specific band's parameters
   */
  setBand(index, { gain, Q }) {
    if (index < 0 || index >= this.bands.length) return;
    
    const band = this.bands[index];
    const now = this.audioContext.currentTime;
    
    if (gain !== undefined) {
      band.filter.gain.setValueAtTime(gain, now);
      band.config.gain = gain;
    }
    
    if (Q !== undefined) {
      band.filter.Q.setValueAtTime(Q, now);
      band.config.Q = Q;
    }
  }

  /**
   * Apply a preset configuration
   */
  applyPreset(preset) {
    const presetConfig = EQUALIZER_PRESETS[preset];
    if (!presetConfig) return;
    
    presetConfig.gains.forEach((gain, index) => {
      this.setBand(index, { gain });
    });
  }

  /**
   * Reset all bands to flat (0 dB)
   */
  reset() {
    this.bands.forEach((band, index) => {
      this.setBand(index, { gain: 0, Q: 1.0 });
    });
  }

  /**
   * Get current equalizer state
   */
  getState() {
    return {
      isEnabled: this.isEnabled,
      bands: this.bands.map(b => ({ ...b.config }))
    };
  }

  /**
   * Restore equalizer state
   */
  setState(state) {
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
   * Get frequency response data for visualization
   * Returns arrays of frequencies and magnitude responses
   */
  getFrequencyResponse(frequencies) {
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
  destroy() {
    this.bands.forEach(band => {
      band.filter.disconnect();
    });
    this.inputNode?.disconnect();
    this.outputNode?.disconnect();
    this.bypassNode?.disconnect();
    this.bands = [];
  }
}
```

### Equalizer Presets

Predefined equalizer configurations for common use cases:

```javascript
const EQUALIZER_PRESETS = {
  flat: {
    name: 'Flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  rock: {
    name: 'Rock',
    gains: [5, 3, -2, -3, -1, 1, 3, 4, 5, 5]
  },
  pop: {
    name: 'Pop',
    gains: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1]
  },
  jazz: {
    name: 'Jazz',
    gains: [4, 3, 1, 2, -1, -1, 0, 1, 3, 4]
  },
  classical: {
    name: 'Classical',
    gains: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4]
  },
  bassBoost: {
    name: 'Bass Boost',
    gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0]
  },
  trebleBoost: {
    name: 'Treble Boost',
    gains: [0, 0, 0, 0, 0, 0, 2, 4, 6, 8]
  },
  vocal: {
    name: 'Vocal',
    gains: [-2, -2, -1, 1, 3, 4, 3, 1, -1, -2]
  }
};
```

### AudioStream Integration

Modify AudioStream to include equalizer in the audio chain:

```javascript
// In AudioStream.initialize()
async initialize() {
  if (this.isInitialized) return;

  this.inputGain = this.audioContext.createGain();
  this.inputGain.gain.value = 1.0;

  // Create equalizer
  this.equalizer = new AudioEqualizer(this.audioContext);

  // Connect: inputGain -> equalizer -> mediaStreamDest
  this.inputGain.connect(this.equalizer.getInput());
  
  this.mediaStreamDest = this.audioContext.createMediaStreamDestination();
  this.equalizer.getOutput().connect(this.mediaStreamDest);

  // ... rest of initialization
}
```

### PreviewEngine Integration

Similar integration for PreviewEngine's independent audio chain:

```javascript
// In PreviewEngine.initialize()
async initialize() {
  // ... existing initialization ...

  // Create equalizer for preview engine
  this.equalizer = new AudioEqualizer(this.audioContext);

  // Reconnect: destGain -> equalizer -> mediaStreamDest
  destGain.disconnect();
  destGain.connect(this.equalizer.getInput());
  this.equalizer.getOutput().connect(this.mediaStreamDest);

  // ... rest of initialization
}
```

### EqualizerUI Component

React component for the equalizer user interface:

```typescript
interface EqualizerUIProps {
  mixer: AudioMixer;
  previewEngine: PreviewEngine;
}

interface BandControl {
  frequency: number;
  gain: number;
  Q: number;
}

export function EqualizerUI({ mixer, previewEngine }: EqualizerUIProps) {
  const [isEnabled, setIsEnabled] = useState(true);
  const [bands, setBands] = useState<BandControl[]>([]);
  const [activePreset, setActivePreset] = useState('flat');
  const [frequencyResponse, setFrequencyResponse] = useState<Float32Array | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    const saved = loadEqualizerSettings();
    if (saved) {
      setIsEnabled(saved.isEnabled);
      setBands(saved.bands);
      setActivePreset(saved.preset);
      applySettingsToEqualizers(saved);
    }
  }, []);

  // Update frequency response curve when bands change
  useEffect(() => {
    updateFrequencyResponse();
  }, [bands]);

  const handleEnableToggle = () => {
    const newEnabled = !isEnabled;
    setIsEnabled(newEnabled);
    
    // Apply to both equalizers
    mixer?.liveStream?.equalizer?.setEnabled(newEnabled);
    mixer?.previewStream?.equalizer?.setEnabled(newEnabled);
    previewEngine?.equalizer?.setEnabled(newEnabled);
    
    saveEqualizerSettings({ isEnabled: newEnabled, bands, preset: activePreset });
  };

  const handleBandChange = (index: number, gain: number, Q?: number) => {
    const newBands = [...bands];
    newBands[index] = { ...newBands[index], gain, Q: Q ?? newBands[index].Q };
    setBands(newBands);
    
    // Apply to all equalizers
    mixer?.liveStream?.equalizer?.setBand(index, { gain, Q });
    mixer?.previewStream?.equalizer?.setBand(index, { gain, Q });
    previewEngine?.equalizer?.setBand(index, { gain, Q });
    
    setActivePreset('custom');
    saveEqualizerSettings({ isEnabled, bands: newBands, preset: 'custom' });
  };

  const handlePresetChange = (presetName: string) => {
    const preset = EQUALIZER_PRESETS[presetName];
    if (!preset) return;
    
    const newBands = bands.map((band, i) => ({
      ...band,
      gain: preset.gains[i]
    }));
    
    setBands(newBands);
    setActivePreset(presetName);
    
    // Apply to all equalizers
    mixer?.liveStream?.equalizer?.applyPreset(presetName);
    mixer?.previewStream?.equalizer?.applyPreset(presetName);
    previewEngine?.equalizer?.applyPreset(presetName);
    
    saveEqualizerSettings({ isEnabled, bands: newBands, preset: presetName });
  };

  const handleReset = () => {
    handlePresetChange('flat');
  };

  return (
    <div className="equalizer-ui">
      <div className="equalizer-header">
        <h3>Equalizer</h3>
        <button onClick={handleEnableToggle}>
          {isEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <FrequencyResponseChart 
        frequencyResponse={frequencyResponse}
        bands={bands}
      />

      <PresetSelector
        presets={Object.keys(EQUALIZER_PRESETS)}
        activePreset={activePreset}
        onChange={handlePresetChange}
      />

      <BandControls
        bands={bands}
        onChange={handleBandChange}
      />

      <button onClick={handleReset}>Reset to Flat</button>
    </div>
  );
}
```

### FrequencyResponseChart Component

Visual representation of the frequency response curve:

```typescript
interface FrequencyResponseChartProps {
  frequencyResponse: Float32Array | null;
  bands: BandControl[];
}

export function FrequencyResponseChart({ 
  frequencyResponse, 
  bands 
}: FrequencyResponseChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !frequencyResponse) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawFrequencyGrid(ctx, canvas.width, canvas.height);

    // Draw frequency response curve
    drawResponseCurve(ctx, frequencyResponse, canvas.width, canvas.height);

    // Draw band markers
    drawBandMarkers(ctx, bands, canvas.width, canvas.height);
  }, [frequencyResponse, bands]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={300}
      className="frequency-response-chart"
    />
  );
}

function drawFrequencyGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;

  // Frequency lines (logarithmic)
  const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  frequencies.forEach(freq => {
    const x = frequencyToX(freq, width);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    
    // Label
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.fillText(formatFrequency(freq), x - 15, height - 5);
  });

  // Gain lines
  const gains = [-12, -6, 0, 6, 12];
  gains.forEach(gain => {
    const y = gainToY(gain, height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    
    // Label
    ctx.fillText(`${gain} dB`, 5, y - 5);
  });
}

function drawResponseCurve(
  ctx: CanvasRenderingContext2D,
  response: Float32Array,
  width: number,
  height: number
) {
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  ctx.beginPath();

  const frequencies = generateLogFrequencies(20, 20000, response.length);
  
  frequencies.forEach((freq, i) => {
    const x = frequencyToX(freq, width);
    const y = gainToY(response[i], height);
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
}

function frequencyToX(freq: number, width: number): number {
  // Logarithmic scale: 20 Hz to 20 kHz
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const freqLog = Math.log10(freq);
  return ((freqLog - minLog) / (maxLog - minLog)) * width;
}

function gainToY(gain: number, height: number): number {
  // -12 dB to +12 dB
  const normalized = (gain + 12) / 24; // 0 to 1
  return height - (normalized * height);
}

function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return `${freq / 1000}k`;
  }
  return `${freq}`;
}

function generateLogFrequencies(min: number, max: number, count: number): Float32Array {
  const frequencies = new Float32Array(count);
  const minLog = Math.log10(min);
  const maxLog = Math.log10(max);
  const step = (maxLog - minLog) / (count - 1);
  
  for (let i = 0; i < count; i++) {
    frequencies[i] = Math.pow(10, minLog + (step * i));
  }
  
  return frequencies;
}
```

## Data Models

### EqualizerSettings

Persisted equalizer configuration:

```typescript
interface EqualizerSettings {
  isEnabled: boolean;
  preset: string;
  bands: BandSettings[];
}

interface BandSettings {
  frequency: number;
  gain: number;
  Q: number;
}
```

### Storage Schema

LocalStorage key: `strudel-equalizer-settings`

```json
{
  "isEnabled": true,
  "preset": "rock",
  "bands": [
    { "frequency": 31, "gain": 5, "Q": 1.0 },
    { "frequency": 62, "gain": 3, "Q": 1.0 },
    { "frequency": 125, "gain": -2, "Q": 1.0 },
    { "frequency": 250, "gain": -3, "Q": 1.0 },
    { "frequency": 500, "gain": -1, "Q": 1.0 },
    { "frequency": 1000, "gain": 1, "Q": 1.0 },
    { "frequency": 2000, "gain": 3, "Q": 1.0 },
    { "frequency": 4000, "gain": 4, "Q": 1.0 },
    { "frequency": 8000, "gain": 5, "Q": 1.0 },
    { "frequency": 16000, "gain": 5, "Q": 1.0 }
  ]
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Band Configuration Completeness

*For any* AudioEqualizer instance, the equalizer should have exactly 10 bands with frequencies [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] Hz.

**Validates: Requirements 1.1**

### Property 2: Band Isolation

*For any* band index and gain adjustment, when adjusting that band's gain, all other bands should maintain their previous gain values unchanged.

**Validates: Requirements 1.2**

### Property 3: Parameter Bounds

*For any* band adjustment, gain values should be clamped to the range [-12, 12] dB and Q values should be clamped to the range [0.5, 4.0].

**Validates: Requirements 1.3, 1.4**

### Property 4: Dual Path Consistency

*For any* equalizer setting change, both the live stream equalizer and preview stream equalizer should have identical band configurations after the change.

**Validates: Requirements 2.3, 2.5**

### Property 5: Frequency Response Curve Updates

*For any* band gain adjustment, the frequency response curve data should change to reflect the new gain value at that band's frequency.

**Validates: Requirements 3.2**

### Property 6: Logarithmic Frequency Spacing

*For any* two consecutive frequency markers on the display, the ratio between their frequencies should be constant (logarithmic spacing).

**Validates: Requirements 3.5**

### Property 7: Preset Application

*For any* preset selection, applying the preset should set all band gains to match the preset's defined gain values.

**Validates: Requirements 4.2**

### Property 8: Preset Modification Detection

*For any* preset, after applying it and then modifying any band, the active preset name should change to "Custom".

**Validates: Requirements 4.3, 4.5**

### Property 9: Individual Band Reset

*For any* band with non-zero gain, resetting that band should set its gain to 0 dB while leaving other bands unchanged.

**Validates: Requirements 5.6**

### Property 10: Enable/Disable State Preservation

*For any* equalizer configuration, disabling and then re-enabling the equalizer should preserve all band settings (gains and Q factors).

**Validates: Requirements 6.1, 6.3**

### Property 11: Bypass Functionality

*For any* equalizer state, when disabled, the audio output should be identical to the input (bypass active).

**Validates: Requirements 6.2**

### Property 12: Global Reset

*For any* equalizer configuration, calling reset should set all bands to 0 dB gain while maintaining the current enabled/disabled state.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 13: Settings Persistence Round-Trip

*For any* valid equalizer configuration (enabled state, preset, and all band settings), saving to localStorage and then loading should restore an equivalent configuration.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 14: Multiple Band Updates

*For any* set of band indices and gain values, updating all bands simultaneously should result in each band having its corresponding new gain value.

**Validates: Requirements 10.4**

## Error Handling

### Invalid Parameter Handling

The equalizer must gracefully handle invalid inputs:

1. **Out-of-range gain values**: Clamp to [-12, 12] dB range
2. **Out-of-range Q values**: Clamp to [0.5, 4.0] range
3. **Invalid band indices**: Ignore requests for non-existent bands
4. **Invalid preset names**: Log warning and maintain current settings
5. **Corrupted localStorage data**: Fall back to flat preset defaults

### Audio Context Errors

Handle Web Audio API errors gracefully:

1. **Suspended AudioContext**: Attempt to resume before operations
2. **Node connection failures**: Log error and attempt reconnection
3. **Device routing failures**: Fall back to default device
4. **Missing setSinkId support**: Disable device selection UI

### UI Error States

Display appropriate feedback for error conditions:

1. **Failed to load settings**: Show notification and use defaults
2. **Failed to save settings**: Show warning but continue operation
3. **Audio processing errors**: Display error message and disable EQ
4. **Device enumeration failures**: Show "No devices available" message

### Cleanup and Resource Management

Ensure proper cleanup to prevent memory leaks:

1. **Disconnect all audio nodes** when equalizer is destroyed
2. **Remove event listeners** when components unmount
3. **Clear animation frames** when charts are unmounted
4. **Cancel pending async operations** during cleanup

## Testing Strategy

### Dual Testing Approach

The equalizer feature will be validated using both unit tests and property-based tests:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs
- Both approaches are complementary and necessary for comprehensive coverage

### Property-Based Testing

We will use **fast-check** (JavaScript property-based testing library) to implement the correctness properties defined above. Each property test will:

- Run a minimum of 100 iterations with randomized inputs
- Reference its corresponding design property in a comment tag
- Tag format: `// Feature: audio-equalizer, Property N: [property description]`

Example property test structure:

```javascript
import fc from 'fast-check';

// Feature: audio-equalizer, Property 2: Band Isolation
test('adjusting one band does not affect other bands', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 9 }), // band index
      fc.float({ min: -12, max: 12 }), // gain value
      (bandIndex, gain) => {
        const eq = new AudioEqualizer(audioContext);
        const initialState = eq.getState();
        
        eq.setBand(bandIndex, { gain });
        const newState = eq.getState();
        
        // Verify other bands unchanged
        for (let i = 0; i < 10; i++) {
          if (i !== bandIndex) {
            expect(newState.bands[i].gain).toBe(initialState.bands[i].gain);
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

### Unit Testing Focus

Unit tests will cover:

1. **Specific examples**: Applying known presets and verifying exact gain values
2. **Edge cases**: Empty localStorage, corrupted data, missing devices
3. **Integration points**: Equalizer integration with AudioMixer and PreviewEngine
4. **UI interactions**: Button clicks, slider adjustments, preset selection
5. **Error conditions**: Invalid inputs, failed device routing, audio context errors

### Test Coverage Goals

- Core AudioEqualizer class: 90%+ coverage
- Integration with AudioStream: 85%+ coverage
- UI components: 80%+ coverage (excluding visual rendering)
- Persistence layer: 95%+ coverage

### Testing Tools

- **Vitest**: Test runner (existing in Strudel)
- **fast-check**: Property-based testing library
- **@testing-library/react**: React component testing
- **Web Audio API mocks**: Mock AudioContext and nodes for testing

### Performance Testing

While not automated, manual performance testing should verify:

1. CPU usage remains below 5% during continuous playback
2. No audio dropouts when adjusting multiple bands
3. Smooth transitions when enabling/disabling equalizer
4. Responsive UI on mobile devices (tested on real devices)

### Integration Testing

Test equalizer integration with existing Strudel features:

1. Verify equalizer works with live coding patterns
2. Test equalizer during mixer transitions (crossfade, cut)
3. Verify equalizer persists across page reloads
4. Test equalizer with different audio output devices
5. Verify equalizer works in both preview and live modes

## Implementation Notes

### Web Audio API Considerations

1. **Filter Types**: Use 'lowshelf' for lowest band, 'highshelf' for highest band, 'peaking' for middle bands
2. **Automation**: Use `setValueAtTime` and `linearRampToValueAtTime` for smooth parameter changes
3. **Frequency Response**: Use `getFrequencyResponse()` method for visualization data
4. **Node Lifecycle**: Always disconnect nodes before destroying to prevent memory leaks

### Performance Optimizations

1. **Debounce UI updates**: Throttle frequency response curve updates to 60 FPS
2. **Lazy initialization**: Only create equalizer when first accessed
3. **Efficient rendering**: Use canvas for frequency response (better than SVG for real-time updates)
4. **Minimize reflows**: Batch DOM updates in UI components

### Browser Compatibility

1. **BiquadFilterNode**: Supported in all modern browsers
2. **setSinkId**: Check for support before enabling device selection
3. **AudioContext.resume()**: Required for iOS Safari
4. **localStorage**: Wrap in try-catch for privacy mode

### Accessibility Considerations

1. **Keyboard navigation**: All controls accessible via keyboard
2. **ARIA labels**: Proper labels for screen readers
3. **Focus indicators**: Clear visual focus states
4. **Value announcements**: Announce gain changes to screen readers
5. **Reduced motion**: Respect prefers-reduced-motion for animations

### Mobile Considerations

1. **Touch targets**: Minimum 44x44 pixels for all interactive elements
2. **Responsive layout**: Stack controls vertically on narrow screens
3. **Gesture support**: Swipe to adjust sliders
4. **Performance**: Optimize canvas rendering for mobile GPUs
5. **Battery impact**: Monitor and minimize CPU usage

## Future Enhancements

Potential future improvements (out of scope for initial implementation):

1. **Custom presets**: Allow users to save their own preset configurations
2. **Spectrum analyzer**: Real-time frequency spectrum display
3. **Auto-EQ**: Analyze audio and suggest optimal EQ settings
4. **Per-pattern EQ**: Different EQ settings for different patterns
5. **Parametric bands**: Allow users to adjust center frequencies
6. **Dynamic EQ**: Frequency-dependent compression
7. **EQ matching**: Match frequency response of reference audio
8. **Preset sharing**: Export/import presets as JSON files
