# Implementation Plan: Audio Recorder

## Overview

Implement a browser-based audio recorder for the Strudel REPL that taps into the existing superdough audio pipeline at the DestinationGain node. The recorder captures live audio via MediaRecorder, supports WAV and MP3 export, and integrates into the Header component with elapsed time display. Implementation proceeds bottom-up: pure utilities first, then the core engine, then UI integration.

## Tasks

- [x] 1. Create format utilities and directory structure
  - [x] 1.1 Create `website/src/repl/recording/formatUtils.ts` with `formatElapsedTime(seconds: number): string` (MM:SS zero-padded) and `generateFilename(date: Date, format: 'wav' | 'mp3'): string` (pattern: `strudel-recording-YYYY-MM-DD-HHmmss.{ext}`)
    - _Requirements: 2.5, 4.2, 5.3_

  - [ ]* 1.2 Write property test for elapsed time formatting
    - **Property 3: Elapsed time formatting**
    - Test with fast-check: for any non-negative integer, output matches `MM:SS` pattern with correct zero-padding
    - Test file: `website/src/repl/recording/__tests__/formatUtils.test.ts`
    - **Validates: Requirements 2.5**

  - [ ]* 1.3 Write property test for filename generation
    - **Property 6: Export filename generation**
    - Test with fast-check: for any Date and format in {wav, mp3}, output matches `strudel-recording-YYYY-MM-DD-HHmmss.{format}` with zero-padded date components
    - Test file: `website/src/repl/recording/__tests__/formatUtils.test.ts`
    - **Validates: Requirements 4.2, 5.3**

- [x] 2. Implement WAV encoder
  - [x] 2.1 Create `website/src/repl/recording/wavEncoder.ts` with `encodeWAV(audioBuffer: AudioBuffer): Blob`
    - Produce PCM 16-bit stereo RIFF/WAVE with correct 44-byte header
    - Handle interleaving of left/right channels and float32-to-int16 conversion
    - _Requirements: 4.1_

  - [ ]* 2.2 Write property test for WAV encoding correctness
    - **Property 5: WAV encoding correctness**
    - Test with fast-check: for any 2-channel AudioBuffer (varying lengths, sample rates), verify RIFF/WAVE header bytes: format=PCM(1), numChannels=2, bitsPerSample=16, correct sampleRate, data chunk size = numSamples × 2 × 2
    - Test file: `website/src/repl/recording/__tests__/wavEncoder.test.ts`
    - **Validates: Requirements 4.1**

- [x] 3. Implement MP3 encoder with Web Worker
  - [x] 3.1 Create `website/src/repl/recording/mp3Worker.ts` — Web Worker that receives Float32Array channel data and encodes to MP3 via lamejs at 192 kbps, posting back the resulting Blob
    - _Requirements: 5.2_

  - [x] 3.2 Create `website/src/repl/recording/mp3Encoder.ts` with `encodeMP3(audioBuffer: AudioBuffer, bitrate?: number): Promise<Blob>` and `isMP3Available(): boolean`
    - Spawns the mp3Worker, transfers channel data, returns the encoded Blob
    - `isMP3Available()` checks if lamejs can be loaded
    - _Requirements: 5.2, 5.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement AudioRecorderEngine
  - [x] 5.1 Create `website/src/repl/recording/AudioRecorderEngine.ts` implementing the `AudioRecorderEngine` class
    - `constructor(audioContext, options?)` — stores audioContext, sets up RecorderState, applies memoryWarningThresholdMB default (500)
    - `start(destinationGain)` — validates audioContext.state === "running", creates MediaStreamDestination, connects to destinationGain, creates MediaRecorder (audio/webm;codecs=opus), starts timer interval updating elapsedSeconds and estimatedSizeMB, fires onStateChange callback
    - `stop()` — stops MediaRecorder, disconnects MediaStreamDestination, clears timer, assembles chunks into Blob, returns it
    - `getState()` — returns current RecorderState
    - `destroy()` — calls stop if recording, nulls all references, clears chunk store
    - Memory warning: when estimatedSizeMB > threshold, invoke onMemoryWarning callback
    - Error handling: MediaRecorder onerror salvages existing chunks, suspended AudioContext returns error state
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 3.1, 3.2, 3.3, 7.1, 7.2, 7.3_

  - [ ]* 5.2 Write property test for memory warning threshold
    - **Property 7: Memory warning threshold**
    - Test with fast-check: for any sequence of chunk sizes, verify onMemoryWarning fires iff cumulative bytes > 524,288,000
    - Test file: `website/src/repl/recording/__tests__/AudioRecorderEngine.test.ts`
    - **Validates: Requirements 7.2**

- [x] 6. Implement useAudioRecorder hook
  - [x] 6.1 Create `website/src/repl/recording/useAudioRecorder.ts`
    - Manages AudioRecorderEngine lifecycle via useRef
    - Exposes: `isRecording`, `elapsedSeconds`, `handleRecordToggle`, `exportBlob`, `clearExport`, `error`
    - `handleRecordToggle`: if idle, gets destinationGain from `getSuperdoughAudioController().output.destinationGain` and calls engine.start(); if recording, calls engine.stop() and sets exportBlob
    - Registers `beforeunload` handler for emergency save (best-effort WAV download)
    - Cleans up engine on unmount
    - _Requirements: 2.2, 2.3, 6.3, 7.3_

- [x] 7. Implement ExportDialog component
  - [x] 7.1 Create `website/src/repl/components/ExportDialog.tsx`
    - Props: `audioBlob: Blob`, `audioContext: AudioContext`, `onClose: () => void`
    - Decodes audioBlob via `audioContext.decodeAudioData` to get AudioBuffer
    - Shows format selection buttons (WAV / MP3), disables MP3 if `isMP3Available()` returns false with explanatory message
    - Shows encoding progress indicator during WAV/MP3 encoding
    - On format select: encodes via `encodeWAV` or `encodeMP3`, generates filename via `generateFilename(new Date(), format)`, triggers browser download via `URL.createObjectURL` + anchor click, then revokes URL
    - Handles empty recording (zero duration): shows warning, skips download
    - Handles MP3 encoding failure: shows error, falls back to WAV option
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Integrate recorder into Header and ReplContext
  - [x] 9.1 Wire `useAudioRecorder` into `useReplContext` (`website/src/repl/useReplContext.tsx`)
    - Call `useAudioRecorder()` inside `useReplContext`
    - Add `isRecording`, `recordingElapsedSeconds`, `handleRecordToggle`, `exportBlob`, `clearExport` to the returned context object
    - Update the `ReplContext` interface to include these fields
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 9.2 Add record button and elapsed time display to Header (`website/src/repl/components/Header.tsx`)
    - Update the local `ReplContext` interface to include `isRecording`, `recordingElapsedSeconds`, `handleRecordToggle`
    - Add a record button (red circle icon) next to the existing play/stop/update/preview buttons, hidden in embedded and zen modes
    - When `isRecording` is true: apply visually distinct recording state (red highlight/pulse CSS), show elapsed time formatted via `formatElapsedTime`
    - Wire button onClick to `handleRecordToggle`
    - _Requirements: 2.1, 2.4, 2.5_

  - [x] 9.3 Render ExportDialog in `ReplEditor.tsx`
    - When `context.exportBlob` is non-null, render `<ExportDialog>` with the blob, audioContext from `getAudioContext()`, and `onClose` calling `context.clearExport()`
    - _Requirements: 5.1_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design uses TypeScript throughout — all files are `.ts` / `.tsx`
- fast-check is already available as a root devDependency
- Vitest is the test runner (root `vitest.config.mjs`)
- lamejs needs to be added as a dependency (`pnpm add lamejs` in the website package)
- Property tests validate universal correctness properties from the design document
- Recording persists across code evaluations, playback toggles, and UI interactions by design — the MediaRecorder runs independently of the Strudel repl lifecycle
