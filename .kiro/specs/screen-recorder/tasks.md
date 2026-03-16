# Implementation Plan: Screen Recorder

## Overview

Implement a screen recording feature that captures the browser tab (video via `getDisplayMedia`) combined with Strudel's audio output (via `DestinationGain`) into a downloadable WebM file. The implementation follows the existing audio recorder architecture with a parallel `ScreenRecorderEngine` class, a `useScreenRecorder` hook, and Header/context integration with mutual exclusion between audio and screen recorders.

## Tasks

- [x] 1. Add `generateScreenFilename` to formatUtils
  - [x] 1.1 Implement `generateScreenFilename(date: Date): string` in `website/src/repl/recording/formatUtils.ts`
    - Returns `strudel-screen-YYYY-MM-DD-HHmmss.webm` with zero-padded date components
    - Follows the same pattern as existing `generateFilename`
    - _Requirements: 6.2_

  - [ ]* 1.2 Write property test for `generateScreenFilename`
    - **Property 9: Screen filename generation**
    - Generate random Date objects, verify filename matches `strudel-screen-YYYY-MM-DD-HHmmss.webm` pattern
    - Add to existing `website/src/repl/recording/__tests__/formatUtils.test.ts`
    - **Validates: Requirements 6.2**

- [x] 2. Implement `ScreenRecorderEngine`
  - [x] 2.1 Create `website/src/repl/recording/ScreenRecorderEngine.ts`
    - Implement `ScreenRecorderEngine` class with constructor accepting `AudioContext` and `ScreenRecorderCallbacks`
    - Implement static `isSupported()` method checking for `getDisplayMedia` availability
    - Implement `getState()` returning `ScreenRecorderState`
    - Implement internal state management with `onStateChange` callback
    - _Requirements: 1.4, 4.1_

  - [x] 2.2 Implement `start(destinationGain: GainNode): Promise<void>`
    - Validate AudioContext is "running" state before proceeding
    - Call `getDisplayMedia({ video: { displaySurface: 'browser' }, preferCurrentTab: true, audio: false })`
    - Create `MediaStreamDestination`, connect to `destinationGain`
    - Build combined `MediaStream` with one video track + one audio track
    - Select MIME type with fallback chain: `video/webm;codecs=vp9,opus` → `video/webm;codecs=vp8,opus` → `video/webm`
    - Create `MediaRecorder` with `videoBitsPerSecond: 2_500_000` and `timeslice: 1000`
    - Set up `ondataavailable` for incremental chunk collection
    - Listen for video track `"ended"` event for external stop handling (browser "Stop sharing")
    - Start elapsed time timer
    - Handle all error cases: permission denied, no supported MIME type, MediaRecorder constructor failure
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4, 4.6_

  - [x] 2.3 Implement `stop(): Promise<Blob>`
    - Stop MediaRecorder, assemble chunks into WebM Blob
    - Stop all video tracks on the tab capture stream
    - Disconnect MediaStreamDestination from DestinationGain
    - Clear chunk store and timer
    - Reset state to idle
    - Handle empty recording case (zero chunks)
    - _Requirements: 6.1, 6.3, 9.1, 9.2, 9.3_

  - [x] 2.4 Implement `destroy(): Promise<void>`
    - Stop recording if active, release all resources
    - Null all references
    - _Requirements: 9.4_

  - [ ]* 2.5 Write property test: Error handling on invalid preconditions
    - **Property 1: Error handling on invalid preconditions**
    - Generate random error conditions (AudioContext states, DOMException types), verify engine transitions to error state
    - Test file: `website/src/repl/recording/__tests__/ScreenRecorderEngine.test.ts`
    - **Validates: Requirements 1.3, 2.4**

  - [ ]* 2.6 Write property test: Recording toggle round-trip
    - **Property 2: Recording toggle round-trip**
    - Generate random valid start/stop sequences with mocked streams, verify state transitions and non-empty blob
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 2.7 Write property test: Combined stream composition
    - **Property 3: Combined stream composition**
    - Generate random numbers of video/audio tracks in mock streams, verify combined stream has exactly 1 video + 1 audio
    - **Validates: Requirements 2.2, 3.1**

  - [ ]* 2.8 Write property test: MIME type fallback selection
    - **Property 4: MIME type fallback selection**
    - Generate random boolean combinations for `isTypeSupported` across three MIME candidates, verify correct selection
    - **Validates: Requirements 3.2**

  - [ ]* 2.9 Write property test: Incremental chunk collection
    - **Property 5: Incremental chunk collection**
    - Generate random sequences of Blob chunks, fire as `ondataavailable`, verify chunk store accumulates correctly
    - **Validates: Requirements 3.4**

  - [ ]* 2.10 Write property test: External stop handling
    - **Property 7: External stop handling**
    - Simulate video track "ended" event on active recording, verify engine stops and produces blob
    - **Validates: Requirements 4.6**

  - [ ]* 2.11 Write property test: Blob assembly on stop
    - **Property 8: Blob assembly on stop**
    - Generate random non-empty chunk sequences, call stop(), verify blob is non-empty with video/webm type
    - **Validates: Requirements 6.1**

  - [ ]* 2.12 Write property test: Resource cleanup after recording
    - **Property 10: Resource cleanup after recording**
    - After stop(), verify all video tracks ended, MediaStreamDestination disconnected, chunk store empty
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement `useScreenRecorder` hook
  - [x] 4.1 Create `website/src/repl/recording/useScreenRecorder.ts`
    - Accept `isAudioRecording: boolean` parameter for mutual exclusion
    - Lazily create `ScreenRecorderEngine` on first toggle (AudioContext may not exist at mount)
    - Expose `isScreenRecording`, `screenRecordingElapsedSeconds`, `handleScreenRecordToggle`, `screenRecordingError`, `isScreenRecordingSupported`
    - On toggle start: check `isAudioRecording`, get `destinationGain` from `getSuperdoughAudioController()`, call `engine.start()`
    - On toggle stop: call `engine.stop()`, trigger auto-download of WebM blob using `generateScreenFilename`
    - Handle `onExternalStop` callback from engine (browser "Stop sharing") — auto-download and reset state
    - Register `beforeunload` handler for emergency download of in-progress recording
    - Cleanup engine on unmount via `destroy()`
    - _Requirements: 4.2, 4.3, 4.6, 6.1, 6.2, 8.1, 8.2, 9.4_

- [x] 5. Integrate into `useReplContext`
  - [x] 5.1 Wire `useScreenRecorder` in `website/src/repl/useReplContext.tsx`
    - Import and call `useScreenRecorder(audioRecorder.isRecording)`
    - Add screen recorder fields to the `ReplContext` interface: `isScreenRecording`, `screenRecordingElapsedSeconds`, `handleScreenRecordToggle`, `isScreenRecordingSupported`
    - Pass `screenRecorder.isScreenRecording` to audio recorder for mutual exclusion
    - Expose all screen recorder state in the returned context object
    - _Requirements: 8.1, 8.2_

  - [x] 5.2 Update `useAudioRecorder` for mutual exclusion
    - Add `isScreenRecording` parameter to `useAudioRecorder` (or pass via context)
    - Check `isScreenRecording` before starting audio recording; set error if active
    - _Requirements: 8.1, 8.2_

- [x] 6. Integrate screen record button into Header
  - [x] 6.1 Update `website/src/repl/components/Header.tsx`
    - Add screen recorder props to `ReplContext` interface in Header: `isScreenRecording`, `screenRecordingElapsedSeconds`, `handleScreenRecordToggle`, `isScreenRecordingSupported`
    - Render screen record button next to audio record button with video camera icon (Heroicons `VideoCameraIcon`)
    - Show button only when: not embedded, not zen mode, and `isScreenRecordingSupported` is true
    - When screen recording: show red highlight background, `recording-pulse` animation, elapsed time via `formatElapsedTime`
    - Disable audio record button when screen recording is active (with tooltip)
    - Disable screen record button when audio recording is active (with tooltip)
    - _Requirements: 4.1, 4.4, 4.5, 8.1, 8.2_

  - [x] 6.2 Update `website/src/repl/components/ReplEditor.tsx`
    - Add screen recorder fields to the local `ReplContext` interface
    - Ensure screen recorder context flows through to Header
    - _Requirements: 4.1_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The implementation follows the existing audio recorder architecture (`AudioRecorderEngine` + `useAudioRecorder`) as the reference pattern
- Property tests use fast-check with Vitest (minimum 100 iterations per property)
- Checkpoints ensure incremental validation
