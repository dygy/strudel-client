# Requirements Document

## Introduction

The Audio Recorder feature adds the ability to capture live audio output from the Strudel REPL directly in the browser. A record button in the Header allows users to start and stop recording their live coding performances, including any real-time code changes and pattern updates made during the session. The recorded audio is then exportable as a WAV or MP3 file for sharing, archiving, or further production work.

## Glossary

- **Recorder**: The audio recording engine that captures the audio output stream from the Strudel audio pipeline using the Web Audio API MediaRecorder interface.
- **Header**: The top navigation bar of the Strudel REPL that contains playback controls (play, stop, update, preview) and will host the record button.
- **AudioContext**: The Web Audio API AudioContext instance managed by the superdough audio engine, through which all Strudel audio is routed.
- **DestinationGain**: The final GainNode in the SuperdoughOutput audio chain, positioned before the AudioContext destination. This is the tap point for capturing all mixed audio output.
- **MediaStreamDestination**: A Web Audio API node (createMediaStreamDestination) that provides a MediaStream from an audio graph, enabling recording via MediaRecorder.
- **Recording_Session**: The period between the user clicking the record button and clicking the stop button, during which all audio output is captured.
- **Export_Dialog**: The UI element presented to the user after a Recording_Session ends, allowing the user to download the recorded audio in a chosen format.

## Requirements

### Requirement 1: Audio Capture Setup

**User Story:** As a live coder, I want the recorder to tap into the existing audio output chain, so that all sounds I produce are captured without affecting playback quality.

#### Acceptance Criteria

1. WHEN the user initiates a Recording_Session, THE Recorder SHALL create a MediaStreamDestination node and connect it to the DestinationGain node of the SuperdoughOutput.
2. THE Recorder SHALL capture audio without introducing audible latency or artifacts to the main audio output routed to the AudioContext destination.
3. WHEN the Recording_Session ends, THE Recorder SHALL disconnect the MediaStreamDestination node from the DestinationGain node.
4. IF the AudioContext is not in a "running" state when recording is initiated, THEN THE Recorder SHALL display an error message indicating that audio playback must be active before recording.

### Requirement 2: Recording Lifecycle Control

**User Story:** As a live coder, I want to start and stop recording with a single button in the Header, so that I can easily capture my performances.

#### Acceptance Criteria

1. THE Header SHALL display a record button when the Strudel REPL is not in embedded mode and not in zen mode.
2. WHEN the user clicks the record button while no Recording_Session is active, THE Recorder SHALL start a new Recording_Session and begin capturing audio data.
3. WHEN the user clicks the record button while a Recording_Session is active, THE Recorder SHALL stop the Recording_Session and finalize the captured audio data.
4. WHILE a Recording_Session is active, THE Header SHALL display the record button in a visually distinct "recording" state (e.g., red highlight or pulsing indicator).
5. WHILE a Recording_Session is active, THE Header SHALL display the elapsed recording duration in minutes and seconds format (MM:SS).

### Requirement 3: Live Code Changes During Recording

**User Story:** As a live coder, I want the recording to seamlessly capture all audio changes when I update my patterns mid-performance, so that the recording reflects my full creative session.

#### Acceptance Criteria

1. WHILE a Recording_Session is active, THE Recorder SHALL continue capturing audio without interruption when the user evaluates new code via the update action.
2. WHILE a Recording_Session is active, THE Recorder SHALL continue capturing audio without interruption when the user toggles playback (stop and restart).
3. WHILE a Recording_Session is active AND the user stops playback, THE Recorder SHALL capture silence until playback resumes or the Recording_Session ends.

### Requirement 4: Audio Export as WAV

**User Story:** As a live coder, I want to download my recording as a WAV file, so that I have a lossless copy of my performance.

#### Acceptance Criteria

1. WHEN a Recording_Session ends, THE Recorder SHALL encode the captured audio data into WAV format (PCM, 16-bit, stereo, at the AudioContext sample rate).
2. WHEN the WAV encoding is complete, THE Recorder SHALL trigger a browser file download with the filename format "strudel-recording-YYYY-MM-DD-HHmmss.wav".
3. IF the captured audio data is empty (zero duration), THEN THE Recorder SHALL display a warning message and skip the file download.

### Requirement 5: Audio Export as MP3

**User Story:** As a live coder, I want to download my recording as an MP3 file, so that I have a smaller file suitable for sharing online.

#### Acceptance Criteria

1. THE Export_Dialog SHALL allow the user to choose between WAV and MP3 format before downloading.
2. WHEN the user selects MP3 format, THE Recorder SHALL encode the captured audio data into MP3 format at a bitrate of 192 kbps.
3. WHEN the MP3 encoding is complete, THE Recorder SHALL trigger a browser file download with the filename format "strudel-recording-YYYY-MM-DD-HHmmss.mp3".
4. IF the browser does not support MP3 encoding (e.g., lamejs library fails to load), THEN THE Recorder SHALL disable the MP3 option in the Export_Dialog and display a message indicating that only WAV export is available.

### Requirement 6: Recording State Persistence Across UI Interactions

**User Story:** As a live coder, I want the recording to continue even when I interact with other UI elements like the file manager or settings panel, so that my recording is not accidentally interrupted.

#### Acceptance Criteria

1. WHILE a Recording_Session is active, THE Recorder SHALL maintain the recording when the user opens or closes the file manager sidebar.
2. WHILE a Recording_Session is active, THE Recorder SHALL maintain the recording when the user navigates between tracks using the file manager.
3. IF the user navigates away from the REPL page or closes the browser tab while a Recording_Session is active, THEN THE Recorder SHALL attempt to finalize and download the recording before the page unloads.

### Requirement 7: Memory Management for Long Recordings

**User Story:** As a live coder, I want to record long performances without the browser running out of memory, so that I can capture extended sessions reliably.

#### Acceptance Criteria

1. THE Recorder SHALL store captured audio chunks incrementally rather than accumulating raw audio buffers in a single contiguous array.
2. IF the estimated recording size exceeds 500 MB, THEN THE Recorder SHALL display a warning to the user indicating high memory usage and suggest stopping the recording.
3. WHEN a Recording_Session ends or is finalized, THE Recorder SHALL release all captured audio data from memory after the file download completes.
