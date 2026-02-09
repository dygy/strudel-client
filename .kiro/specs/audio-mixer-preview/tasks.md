# Implementation Plan: DJ-Style Audio Preview with Dual-Engine Architecture

## Overview

The dual-engine architecture is fully implemented and functional. PreviewEngine creates its own SuperdoughAudioController + repl instance for independent preview audio on headphones. The live chain (main StrudelMirror repl) is untouched. MixerSettings uses getAudioDevices() for preview device selection with localStorage persistence. Live output device selection remains available via the existing AudioDeviceSelector in Settings.

## Tasks

- [x] 1. Core PreviewEngine implementation
  - [x] 1.1 Implement PreviewEngine class in packages/mixer/PreviewEngine.mjs
    - Own SuperdoughAudioController, own repl instance, MediaStreamDest audio routing
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_
  - [x] 1.2 Add `_controller` parameter to superdough() in packages/superdough/superdough.mjs
    - 6th parameter overrides singleton getSuperdoughAudioController()
    - _Requirements: 1.3_
  - [x] 1.3 Export PreviewEngine from packages/mixer/index.mjs
    - _Requirements: 10.1_

- [x] 2. Website integration
  - [x] 2.1 Wire PreviewEngine into useReplContext.tsx
    - Create on mount via useEffect, destroy on unmount
    - Inject dependencies: superdough, createRepl, SuperdoughAudioController, transpiler
    - Restore saved preview device from localStorage
    - _Requirements: 1.1, 1.2, 6.2, 7.2_
  - [x] 2.2 Implement handlePreviewToggle in useReplContext.tsx
    - Play Preview: engine.evaluate(editorCode) on headphones
    - Stop Preview: engine.stop(), speakers continue
    - _Requirements: 3.2, 3.3_
  - [x] 2.3 Implement Update-while-previewing in handleEvaluate
    - If isPreviewing: stop preview engine, evaluate code on main repl
    - _Requirements: 3.4_
  - [x] 2.4 Add Play Preview / Stop Preview button to Header.tsx
    - Visible when mixer.isInitialized, blue tint when isPreviewing
    - _Requirements: 3.1, 3.5, 5.1, 5.2_

- [x] 3. Update MixerSettings for PreviewEngine API
  - [x] 3.1 Rewrite MixerSettings.tsx to use PreviewEngine API
    - Removed live device dropdown and transition controls (not applicable to dual-engine)
    - Uses getAudioDevices() from @strudel/webaudio for device enumeration with labels
    - Calls mixer.setDevice(deviceId) for preview routing
    - Persists to localStorage under key 'strudel-preview-device'
    - Lazy device loading on first click, auto-refresh on devicechange
    - Fixed SettingsTab to always show AudioDeviceSelector for live output
    - _Requirements: 2.1, 2.2, 2.6, 4.1, 4.2, 4.3, 4.4, 5.3, 5.4_

- [x] 4. Checkpoint - Build and verify
  - All packages build clean (mixer, superdough, webaudio)

- [x] 5. Add device persistence to PreviewEngine workflow
  - [x] 5.1 Persist preview device selection from MixerSettings to localStorage
    - MixerSettings saves to 'strudel-preview-device' on selection
    - useReplContext restores on init
    - _Requirements: 2.2, 7.1_
  - [x] 5.2 Handle stale device IDs on restore
    - MixerSettings checks if stored device still exists in device list, clears if not
    - _Requirements: 2.4, 7.3_

- [x] 6. Checkpoint - Verify full preview workflow
  - Dual streams confirmed working, device selection functional

- [x] 7. Add proper TypeScript declarations
  - [x] 7.1 Add type declarations for @strudel/mixer (PreviewEngine) in strudel.d.ts
  - [x] 7.2 Add repl() factory type to @strudel/core declaration
  - [x] 7.3 Add superdough, SuperdoughAudioController, getSuperdoughAudioController types to @strudel/webaudio declaration
  - [x] 7.4 Remove all @ts-ignore comments from useReplContext.tsx
  - [x] 7.5 Update i18n translations for all 9 locales (en, ru, es, fr, ar, he, ko, sr, zh)

- [ ]* 8. Write property tests for PreviewEngine
  - [ ]* 8.1 Write property test for preview device persistence round-trip
    - **Property 1: Preview Device Persistence Round-Trip**
    - **Validates: Requirements 2.2, 2.3, 7.1, 7.2**
  - [ ]* 8.2 Write property test for destroy cleanup completeness
    - **Property 2: Destroy Cleanup Completeness**
    - **Validates: Requirements 6.3, 8.4, 9.2**
  - [ ]* 8.3 Write property test for preview independence from live chain
    - **Property 3: Preview Independence from Live Chain**
    - **Validates: Requirements 1.5**
  - [ ]* 8.4 Write property test for destroy-reinitialize cycle safety
    - **Property 4: Destroy-Reinitialize Cycle Safety**
    - **Validates: Requirements 9.1, 9.3**

- [ ]* 9. Write unit tests for PreviewEngine
  - [ ]* 9.1 Write unit tests for PreviewEngine lifecycle
    - _Requirements: 1.1, 1.2, 6.3_
  - [ ]* 9.2 Write unit tests for PreviewEngine device management
    - _Requirements: 2.1, 2.4, 2.5_
  - [ ]* 9.3 Write unit tests for PreviewEngine evaluate/stop
    - _Requirements: 3.2, 3.3, 8.3_

## Notes

- Tasks marked with `*` are optional
- All core functionality is implemented and working
- Legacy classes (AudioMixer, AudioStream, TransitionMixer) remain exported from @strudel/mixer but are unused by the main app
- Live output device uses existing AudioDeviceSelector in Settings (always visible now)
- Preview output device uses MixerSettings with getAudioDevices() for proper labels
