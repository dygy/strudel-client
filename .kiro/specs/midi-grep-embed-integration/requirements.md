# Requirements Document

## Introduction

This document specifies requirements for the MIDI-grep Embed Integration feature. The `/embed` endpoint provides a headless-friendly REPL that enables automated audio recording of Strudel patterns via Puppeteer and the BlackHole virtual audio device.

MIDI-grep is a tool that extracts musical content from audio files (or YouTube URLs) and generates Strudel code. To compare the generated code's audio output with the original audio, MIDI-grep needs to record real Strudel playback. The embed endpoint enables this by providing:
1. A lightweight REPL without authentication requirements
2. Programmatic code insertion via CodeMirror's dispatch API
3. AudioContext access for routing audio to BlackHole

## Glossary

- **MIDI_Grep**: A Go CLI tool that extracts musical content from audio and generates Strudel code
- **Embed_Endpoint**: The `/embed` route that renders a minimal, authentication-free Strudel REPL
- **BlackHole**: A macOS virtual audio device that routes system audio for recording
- **Puppeteer**: A Node.js library for browser automation
- **CodeMirror_Dispatch**: The API method to programmatically insert code into the editor
- **SetSinkId**: The Web Audio API method to route AudioContext output to a specific device
- **Superdough**: Strudel's audio synthesis engine

## Requirements

### Requirement 1: Embed Endpoint Availability

**User Story:** As a MIDI-grep user, I want an unauthenticated REPL endpoint, so that automated scripts can load and play Strudel code without login.

#### Acceptance Criteria

1. THE `/embed` route SHALL render the Strudel REPL with `embedded=true` prop
2. THE Embed_Endpoint SHALL NOT require authentication to access
3. THE Embed_Endpoint SHALL load all Strudel sound libraries (GM, drum machines) without authentication
4. THE Embed_Endpoint SHALL support the same code evaluation as the main REPL

### Requirement 2: Programmatic Code Insertion

**User Story:** As a MIDI-grep automation script, I want to insert Strudel code programmatically, so that I can test generated patterns.

#### Acceptance Criteria

1. THE CodeMirror editor SHALL expose its view instance via `cmContent.cmView.view`
2. THE System SHALL support code replacement via `view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: code}})`
3. WHEN code is dispatched, THE editor SHALL evaluate it as if typed manually
4. THE System SHALL support the full Strudel DSL including all sound sources and effects

### Requirement 3: Autoplay Without Gesture

**User Story:** As a Puppeteer script, I want playback to start without user interaction, so that recording can be automated.

#### Acceptance Criteria

1. THE System SHALL support the `--autoplay-policy=no-user-gesture-required` Chrome flag
2. WHEN the play button is clicked programmatically, THE AudioContext SHALL start without gesture requirement
3. THE System SHALL expose `getAudioContext()` globally for AudioContext access
4. THE AudioContext SHALL be accessible immediately after clicking play

### Requirement 4: Audio Device Routing via setSinkId

**User Story:** As a recording script, I want to route audio to BlackHole, so that I can capture the output via ffmpeg.

#### Acceptance Criteria

1. THE AudioContext SHALL support `setSinkId(deviceId)` for output device selection
2. WHEN `setSinkId` is called with a valid device ID, THE audio SHALL route to that device
3. THE System SHALL allow device enumeration via `navigator.mediaDevices.enumerateDevices()`
4. THE System SHALL allow microphone permission requests for device enumeration
5. THE `setSinkId` call SHALL work AFTER clicking play (after superdough initialization)

### Requirement 5: Playback State Detection

**User Story:** As a recording script, I want to know when playback has started, so that I can begin recording at the right time.

#### Acceptance Criteria

1. THE System SHALL indicate playback state via AudioContext.state === 'running'
2. ALTERNATIVELY, THE System MAY indicate playback via a "stop" button appearing in the UI
3. THE System SHALL emit console messages indicating superdough initialization ("[superdough] ready")
4. THE System SHALL emit console messages for sample loading ("[sampler] load sound...")

### Requirement 6: Sample Loading

**User Story:** As a MIDI-grep user, I want all samples to load correctly, so that the recorded audio matches what a human would hear.

#### Acceptance Criteria

1. THE System SHALL load General MIDI samples (gm_* prefix) from the configured sample server
2. THE System SHALL load drum machine samples (RolandTR808, etc.) from the configured sample server
3. THE System SHALL cache samples in the browser for reuse across recordings
4. THE embed endpoint SHALL use the default browser context (not incognito) to preserve cache

### Requirement 7: Hidden Window Operation

**User Story:** As a MIDI-grep user, I want the browser window to be hidden during recording, so that it doesn't interrupt my work.

#### Acceptance Criteria

1. THE Puppeteer script SHALL support offscreen window positioning (--window-position=-32000,-32000)
2. THE Puppeteer script SHALL support minimal window size (--window-size=1,1)
3. THE System SHALL NOT throttle audio when the window is in background
4. THE Chrome flags SHALL include --disable-background-timer-throttling
5. THE Chrome flags SHALL include --disable-backgrounding-occluded-windows
6. THE Chrome flags SHALL include --disable-renderer-backgrounding

## Integration Flow

```
MIDI-grep CLI
    │
    ├── Generate Strudel code from audio
    │
    ├── Start ffmpeg recording from BlackHole
    │
    ├── Launch Puppeteer browser
    │   └── Navigate to https://strudel.dygy.app/embed
    │
    ├── Grant microphone permission (for device enumeration)
    │
    ├── Find BlackHole device ID via enumerateDevices()
    │
    ├── Insert code via CodeMirror dispatch API
    │
    ├── Click play button
    │
    ├── Call getAudioContext().setSinkId(blackholeId)
    │
    ├── Wait for playback (AudioContext.state === 'running')
    │
    ├── Record for duration
    │
    ├── Stop playback
    │
    └── Close browser, stop ffmpeg
```

## Technical Notes

### Why not use strudel.cc?

The public strudel.cc could work, but using the self-hosted instance at strudel.dygy.app provides:
- Guaranteed availability (not dependent on external service)
- Consistent sample loading (same server)
- No rate limiting or abuse concerns from automated access

### Why setSinkId timing matters

The `setSinkId()` call MUST happen AFTER clicking play because:
1. Superdough creates the AudioContext lazily on first play
2. Before play, `getAudioContext()` returns null
3. After play, the context exists and can be routed

### CodeMirror dispatch vs alternatives

The dispatch API is the correct way to insert code because:
- `textContent` modification doesn't trigger CodeMirror's internal state
- Clipboard paste has permission issues in automated browsers
- URL hash encoding works but verification is complex with newlines
