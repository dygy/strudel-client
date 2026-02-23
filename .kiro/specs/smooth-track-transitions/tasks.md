# Implementation Plan: Smooth Track Transitions

## Overview

This implementation adds configurable smooth volume transitions when users update their live code in Strudel. The feature consists of three main components: a `SmoothTransitionManager` class for orchestrating transitions, UI controls in `MixerSettings`, and integration with the existing REPL context. The implementation follows a bottom-up approach, building the core transition logic first, then adding UI controls, and finally integrating with the REPL.

## Tasks

- [x] 1. Create SmoothTransitionManager core class
  - [x] 1.1 Implement SmoothTransitionManager constructor and initialization
    - Create `packages/mixer/SmoothTransitionManager.mjs`
    - Implement constructor accepting audioContext, replInstance, and options
    - Initialize state: enabled, duration, isTransitioning, queuedCode, targetVolume
    - Implement restoreSettings() to load from localStorage
    - _Requirements: 1.4, 4.4, 7.3_
  
  - [x] 1.2 Implement fadeDown method for volume fade out
    - Use Web Audio API linearRampToValueAtTime to fade volume to 0
    - Accept duration parameter
    - Return promise that resolves when fade completes
    - Cancel any scheduled values before starting fade
    - _Requirements: 2.1, 2.2_
  
  - [x] 1.3 Implement fadeUp method for volume fade in
    - Use Web Audio API linearRampToValueAtTime to fade volume to target
    - Accept duration and targetVolume parameters
    - Return promise that resolves when fade completes
    - Cancel any scheduled values before starting fade
    - _Requirements: 3.1, 3.2, 3.3, 6.1_
  
  - [x] 1.4 Implement executeTransition method for complete transition flow
    - Check if transition already in progress, queue if so
    - Set isTransitioning flag
    - Call fadeDown with configured duration
    - Stop current pattern via replInstance.stop()
    - Evaluate new code via replInstance.evaluate()
    - Call fadeUp with configured duration and targetVolume
    - Clear isTransitioning flag
    - Process queue if any pending transitions
    - _Requirements: 2.3, 5.1, 5.2, 5.3, 5.4_
  
  - [x] 1.5 Implement settings management methods
    - Implement updateSettings(settings) to update enabled and duration
    - Validate duration range (0.5 - 10.0 seconds)
    - Implement getSettings() to return current settings
    - Implement persistSettings() to save to localStorage
    - _Requirements: 1.2, 1.3, 4.2, 4.3, 7.1, 7.2_
  
  - [x] 1.6 Implement queue management methods
    - Implement queueTransition(newCode) to store pending code
    - Implement processQueue() to execute queued transitions
    - Ensure only one queued transition at a time (replace if multiple)
    - _Requirements: 5.3, 5.4_
  
  - [x] 1.7 Implement error handling and cleanup
    - Add try-catch in executeTransition with volume restoration on error
    - Implement ensureAudioContextRunning() to handle suspended context
    - Implement destroy() method for cleanup
    - Add error event emission for UI notification
    - _Requirements: All (error handling)_

- [ ] 2. Add unit tests for SmoothTransitionManager
  - [ ]* 2.1 Write unit tests for core transition logic
    - Test fadeDown reduces volume to 0
    - Test fadeUp increases volume to target
    - Test sequential phase execution
    - Test instant mode bypasses transitions
    - _Requirements: 2.1, 2.4, 3.1, 3.2, 3.4, 5.1_
  
  - [ ]* 2.2 Write unit tests for settings management
    - Test settings persistence to localStorage
    - Test settings restoration from localStorage
    - Test duration validation and clamping
    - Test default values when localStorage empty
    - _Requirements: 1.2, 1.3, 1.4, 4.2, 4.3, 4.4, 7.1, 7.2, 7.3_
  
  - [ ]* 2.3 Write unit tests for queue management
    - Test queueing when transition in progress
    - Test queue processing after completion
    - Test queue replacement on multiple updates
    - _Requirements: 5.2, 5.3, 5.4_
  
  - [ ]* 2.4 Write unit tests for error handling
    - Test error recovery and volume restoration
    - Test localStorage unavailable handling
    - Test AudioContext suspended handling
    - Test invalid settings handling
    - _Requirements: All (error handling)_

- [ ] 3. Add property-based tests for SmoothTransitionManager
  - [ ]* 3.1 Write property test for settings persistence round-trip
    - **Property 1: Settings Persistence Round-Trip**
    - **Validates: Requirements 1.2, 1.3, 1.4, 4.3, 4.4, 7.1, 7.2, 7.3**
    - Generate random enabled (boolean) and duration (0.5-10.0)
    - Save settings, create new manager, restore, verify equality
    - Run 100 iterations
  
  - [ ]* 3.2 Write property test for fade volume correctness
    - **Property 2: Fade Down Reaches Zero**
    - **Property 7: Fade Up Reaches Target Volume**
    - **Validates: Requirements 2.1, 3.2, 6.1**
    - Generate random starting volumes and target volumes
    - Execute fade down, verify final volume is 0
    - Execute fade up, verify final volume equals target
    - Run 100 iterations
  
  - [ ]* 3.3 Write property test for transition timing bounds
    - **Property 3: Transition Timing Bounds**
    - **Validates: Requirements 2.2, 3.3**
    - Generate random durations (0.5-10.0)
    - Measure actual fade completion time
    - Verify completion within duration + tolerance (0.1s)
    - Run 100 iterations
  
  - [ ]* 3.4 Write property test for queue behavior
    - **Property 12: Update Queueing During Transition**
    - **Property 13: Queued Transition Execution**
    - **Validates: Requirements 5.3, 5.4**
    - Generate random sequences of transition requests
    - Verify queueing when busy
    - Verify queue execution after completion
    - Run 100 iterations

- [ ] 4. Checkpoint - Ensure all SmoothTransitionManager tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update MixerSettings UI component
  - [x] 5.1 Add smooth transitions toggle control
    - Add checkbox/toggle for enabling smooth transitions
    - Add label "Smooth Track Transitions"
    - Add description "Fade between tracks when updating code"
    - Connect to SmoothTransitionManager.updateSettings()
    - Load initial state from manager.getSettings()
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 5.2 Add transition duration slider control
    - Add range slider for duration (0.5 - 10.0 seconds, step 0.5)
    - Add label "Transition Duration"
    - Show current value in seconds
    - Only visible when smooth transitions enabled
    - Connect to SmoothTransitionManager.updateSettings()
    - Load initial state from manager.getSettings()
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [x] 5.3 Update MixerSettings props interface
    - Add optional smoothTransitionManager prop to MixerSettingsProps
    - Update component to accept and use the manager instance
    - _Requirements: All (integration)_

- [x] 6. Integrate SmoothTransitionManager with useReplContext
  - [x] 6.1 Initialize SmoothTransitionManager in useReplContext
    - Import SmoothTransitionManager
    - Create ref for manager instance
    - Initialize manager in useEffect after editor and audio context ready
    - Get destinationGain from SuperdoughAudioController
    - Pass audioContext, replInstance, and destinationGain to constructor
    - Add cleanup in useEffect return
    - _Requirements: All (integration)_
  
  - [x] 6.2 Modify handleEvaluate to use smooth transitions
    - Check if manager exists and smooth transitions enabled
    - If enabled, call manager.executeTransition(code)
    - If disabled, use existing instant evaluation logic
    - Preserve existing preview mode handling
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 5.1_
  
  - [x] 6.3 Pass manager instance to MixerSettings component
    - Add smoothTransitionManager to ReplContext interface
    - Pass manager from useReplContext to components that render MixerSettings
    - _Requirements: All (integration)_
  
  - [x] 6.4 Handle target volume changes during transitions
    - Listen for volume changes from SuperdoughAudioController
    - Update manager.targetVolume when master volume changes
    - Ensure fade up uses current target volume
    - _Requirements: 6.2, 6.3_

- [ ] 7. Add integration tests for smooth transitions
  - [ ]* 7.1 Write integration test for UI to manager communication
    - Test toggle changes update manager settings
    - Test duration slider updates manager settings
    - Test settings persist across component remounts
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3_
  
  - [ ]* 7.2 Write integration test for REPL evaluation flow
    - Test handleEvaluate uses smooth transitions when enabled
    - Test handleEvaluate uses instant mode when disabled
    - Test rapid updates trigger queueing
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4_
  
  - [ ]* 7.3 Write integration test for preview mode isolation
    - Test smooth transitions don't affect preview stream
    - Test preview crossfade continues working
    - Test live and preview maintain independent settings
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 8. Add package exports and documentation
  - [x] 8.1 Export SmoothTransitionManager from mixer package
    - Add export to `packages/mixer/index.mjs`
    - Update package.json exports if needed
    - _Requirements: All (integration)_
  
  - [x] 8.2 Add JSDoc documentation to SmoothTransitionManager
    - Document all public methods with parameters and return types
    - Add usage examples in class-level JSDoc
    - Document error conditions and edge cases
    - _Requirements: All (documentation)_
  
  - [x] 8.3 Update mixer package README
    - Add section describing smooth transitions feature
    - Include code examples for usage
    - Document settings and configuration options
    - _Requirements: All (documentation)_

- [x] 9. Final checkpoint - Ensure all tests pass and feature works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests ensure components work together correctly
- The implementation follows bottom-up approach: core logic → tests → UI → integration
