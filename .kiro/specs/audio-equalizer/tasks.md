# Implementation Plan: Audio Equalizer

## Overview

This implementation plan breaks down the audio equalizer feature into discrete, incremental coding tasks. The equalizer will be implemented as a new package `@strudel/equalizer` with integration into the existing mixer architecture. Each task builds on previous work, with property-based tests placed close to implementation to catch errors early.

## Tasks

- [x] 1. Create equalizer package structure and core AudioEqualizer class
  - Create `packages/equalizer/` directory with package.json and vite.config.js
  - Implement AudioEqualizer class with 10-band BiquadFilter chain
  - Add enable/disable functionality with bypass path
  - Add getInput() and getOutput() methods for audio routing
  - _Requirements: 1.1, 1.2, 1.5, 6.1_

- [ ]* 1.1 Write property test for band configuration
  - **Property 1: Band Configuration Completeness**
  - **Validates: Requirements 1.1**

- [ ]* 1.2 Write property test for band isolation
  - **Property 2: Band Isolation**
  - **Validates: Requirements 1.2**

- [ ]* 1.3 Write property test for enable/disable state preservation
  - **Property 10: Enable/Disable State Preservation**
  - **Validates: Requirements 6.1, 6.3**

- [x] 2. Implement band parameter controls and validation
  - Add setBand() method with gain and Q factor adjustment
  - Implement parameter clamping (gain: -12 to +12 dB, Q: 0.5 to 4.0)
  - Add getState() and setState() methods for serialization
  - Add reset() method to set all bands to 0 dB
  - _Requirements: 1.3, 1.4, 5.6, 7.1_

- [ ]* 2.1 Write property test for parameter bounds
  - **Property 3: Parameter Bounds**
  - **Validates: Requirements 1.3, 1.4**

- [ ]* 2.2 Write property test for individual band reset
  - **Property 9: Individual Band Reset**
  - **Validates: Requirements 5.6**

- [ ]* 2.3 Write property test for global reset
  - **Property 12: Global Reset**
  - **Validates: Requirements 7.1, 7.2, 7.3**

- [x] 3. Implement equalizer presets system
  - Create EQUALIZER_PRESETS constant with 8 presets (Flat, Rock, Pop, Jazz, Classical, Bass Boost, Treble Boost, Vocal)
  - Add applyPreset() method to AudioEqualizer
  - Implement preset gain configurations based on common EQ curves
  - _Requirements: 4.1, 4.2_

- [ ]* 3.1 Write property test for preset application
  - **Property 7: Preset Application**
  - **Validates: Requirements 4.2**

- [ ]* 3.2 Write property test for preset modification detection
  - **Property 8: Preset Modification Detection**
  - **Validates: Requirements 4.3, 4.5**

- [x] 4. Add frequency response calculation for visualization
  - Implement getFrequencyResponse() method using BiquadFilter.getFrequencyResponse()
  - Generate logarithmic frequency array (20 Hz to 20 kHz)
  - Accumulate response from all bands and convert to dB
  - Add helper function generateLogFrequencies()
  - _Requirements: 3.1, 3.2, 3.5_

- [ ]* 4.1 Write property test for frequency response updates
  - **Property 5: Frequency Response Curve Updates**
  - **Validates: Requirements 3.2**

- [ ]* 4.2 Write property test for logarithmic frequency spacing
  - **Property 6: Logarithmic Frequency Spacing**
  - **Validates: Requirements 3.5**

- [x] 5. Integrate AudioEqualizer into AudioStream
  - Modify AudioStream.initialize() to create equalizer instance
  - Insert equalizer between inputGain and mediaStreamDest
  - Add equalizer getter method to AudioStream
  - Update AudioStream.destroy() to clean up equalizer
  - _Requirements: 2.1, 2.2, 9.2, 9.5_

- [ ]* 5.1 Write unit tests for AudioStream equalizer integration
  - Test equalizer is created during initialization
  - Test audio chain connection (inputGain -> equalizer -> mediaStreamDest)
  - Test equalizer cleanup on destroy
  - _Requirements: 2.1, 2.2, 9.5_

- [x] 6. Integrate AudioEqualizer into PreviewEngine
  - Modify PreviewEngine.initialize() to create equalizer instance
  - Insert equalizer between destinationGain and mediaStreamDest
  - Add equalizer getter method to PreviewEngine
  - Update PreviewEngine.destroy() to clean up equalizer
  - _Requirements: 2.1, 2.2, 9.2, 9.5_

- [ ]* 6.1 Write unit tests for PreviewEngine equalizer integration
  - Test equalizer is created during initialization
  - Test audio chain connection
  - Test equalizer cleanup on destroy
  - _Requirements: 2.1, 2.2, 9.5_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement settings persistence layer
  - Create saveEqualizerSettings() function for localStorage
  - Create loadEqualizerSettings() function with error handling
  - Implement settings schema with enabled state, preset, and band configs
  - Add fallback to flat preset for corrupted/missing data
  - _Requirements: 8.1, 8.2, 8.6_

- [ ]* 8.1 Write property test for settings persistence round-trip
  - **Property 13: Settings Persistence Round-Trip**
  - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [ ]* 8.2 Write unit tests for persistence edge cases
  - Test corrupted localStorage data handling
  - Test missing localStorage data (first load)
  - Test localStorage quota exceeded
  - _Requirements: 8.6_

- [x] 9. Create EqualizerUI React component
  - Create EqualizerUI component with enable/disable toggle
  - Add preset selector dropdown with 8 presets
  - Implement band controls with gain sliders for each of 10 bands
  - Add reset button with confirmation
  - Display current preset name (or "Custom" when modified)
  - _Requirements: 4.4, 4.5, 5.1, 5.4, 5.5, 6.5, 7.4, 11.1_

- [ ]* 9.1 Write unit tests for EqualizerUI component
  - Test enable/disable toggle updates state
  - Test preset selection applies preset
  - Test band adjustment marks preset as "Custom"
  - Test reset button functionality
  - _Requirements: 4.4, 4.5, 6.5_

- [x] 10. Implement FrequencyResponseChart component
  - Create canvas-based chart component
  - Implement drawFrequencyGrid() with logarithmic frequency axis
  - Implement drawResponseCurve() to visualize frequency response
  - Add drawBandMarkers() to show band positions
  - Implement helper functions: frequencyToX(), gainToY(), formatFrequency()
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 10.1 Write unit tests for chart helper functions
  - Test frequencyToX() logarithmic mapping
  - Test gainToY() linear mapping
  - Test formatFrequency() formatting (Hz vs kHz)
  - Test generateLogFrequencies() spacing
  - _Requirements: 3.5_

- [x] 11. Wire EqualizerUI to AudioMixer and PreviewEngine
  - Add equalizer state management hooks (useState, useEffect)
  - Implement handleEnableToggle to update both live and preview equalizers
  - Implement handleBandChange to update all equalizers simultaneously
  - Implement handlePresetChange to apply presets to all equalizers
  - Add auto-save on settings changes (debounced to 500ms)
  - Load saved settings on component mount
  - _Requirements: 2.3, 2.5, 4.3, 8.1, 8.2_

- [ ]* 11.1 Write property test for dual path consistency
  - **Property 4: Dual Path Consistency**
  - **Validates: Requirements 2.3, 2.5**

- [ ]* 11.2 Write property test for multiple band updates
  - **Property 14: Multiple Band Updates**
  - **Validates: Requirements 10.4**

- [x] 12. Integrate EqualizerUI into MixerSettings panel
  - Add EqualizerUI component to MixerSettings.tsx
  - Pass mixer and previewEngine props to EqualizerUI
  - Add collapsible section for equalizer controls
  - Ensure consistent styling with existing mixer settings
  - _Requirements: 11.1, 11.2_

- [ ]* 12.1 Write integration tests for MixerSettings
  - Test EqualizerUI renders in settings panel
  - Test equalizer continues processing when panel is closed
  - Test equalizer works with mixer transitions
  - _Requirements: 11.1, 11.4, 9.3_

- [x] 13. Add mobile responsive design
  - Implement responsive layout for narrow screens (min 320px)
  - Stack band controls vertically on mobile
  - Adjust frequency response chart size for mobile
  - Ensure touch targets are minimum 44x44 pixels
  - Add collapsible sections for advanced controls on mobile
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 14. Add accessibility features
  - Add ARIA labels to all controls
  - Implement keyboard navigation for band controls
  - Add focus indicators for all interactive elements
  - Announce gain value changes to screen readers
  - Add tooltips/help text for equalizer controls
  - _Requirements: 11.5_

- [x] 15. Implement error handling and edge cases
  - Add try-catch for localStorage operations
  - Handle suspended AudioContext (call resume())
  - Handle missing setSinkId support gracefully
  - Add error boundaries for UI components
  - Log warnings for invalid inputs
  - _Requirements: Error Handling section_

- [ ]* 15.1 Write unit tests for error handling
  - Test localStorage errors (privacy mode, quota exceeded)
  - Test invalid preset names
  - Test invalid band indices
  - Test out-of-range parameter values
  - _Requirements: Error Handling section_

- [x] 16. Add package exports and documentation
  - Export AudioEqualizer, EQUALIZER_PRESETS from package
  - Add JSDoc comments to all public methods
  - Create README.md with usage examples
  - Add TypeScript type definitions (.d.ts)
  - Update package.json with proper exports
  - _Requirements: Documentation_

- [x] 17. Final checkpoint - Integration testing
  - Test equalizer with live coding patterns
  - Test equalizer during mixer transitions (crossfade, cut)
  - Verify settings persist across page reloads
  - Test with different audio output devices
  - Verify equalizer works in both preview and live modes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based and unit tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties using fast-check library
- Unit tests validate specific examples, edge cases, and integration points
- The equalizer is implemented as a separate package for modularity and reusability
- Integration happens in phases: core class → AudioStream → PreviewEngine → UI → settings panel
