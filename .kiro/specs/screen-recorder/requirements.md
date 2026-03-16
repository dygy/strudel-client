# Requirements Document

## Introduction

The Screen Recorder feature adds the ability to capture a video recording of the browser tab — including Hydra visuals, @strudel/draw canvas animations, the code editor, and all other visible UI — along with the live audio output from the Strudel audio pipeline. This complements the existing audio-only recorder by producing a combined video+audio file (WebM) that users can share, archive, or use in presentations. A screen record button in the Header, next to the existing audio record button, controls the recording lifecycle.

## Glossary

- **Screen_Recorder**: The recording engine that captures the browser tab's video stream via the Screen Capture API and combines it with the audio stream from the Strudel audio pipeline into a single video+audio recording.
- **Header**: The top navigation bar of the Strudel REPL that contains playback controls and the existing audio record button, and will host the screen record button.
- **AudioContext**: The Web Audio API AudioContext instance managed by the superdough audio engine, through which all Strudel audio is routed.
- **DestinationGain**: The final GainNode in the SuperdoughOutput audio chain, positioned before the AudioContext destination. This is the tap point for capturing all mixed audio output.
- **Tab_Capture_Stream**: A MediaStream obtained via `navigator.mediaDevices.getDisplayMedia()` configured to capture the current browser tab, providing the video track for the recording.
- **Combined_Stream**: A MediaStream that merges the video track from the Tab_Capture_Stream with the audio track from a MediaStreamDestination node connected to the DestinationGain, used as input to the MediaRecorder.
- **Screen_Recording_Session**: The period between the user clicking the screen record button and clicking the stop button, during which both video and audio output are captured.
- **Hydra_Canvas**: The canvas element (id `hydra-canvas`) used by the @strudel/hydra package to render live-coded visuals.
- **Draw_Canvas**: The canvas element (id `test-canvas`) used by the @strudel/draw package to render pianoroll, pitchwheel, animate, and other visual patterns.

## Requirements

### Requirement 1: Tab Video Capture Setup

**User Story:** As a live coder, I want the screen recorder to capture my entire browser tab, so that all visuals (Hydra, canvas animations, code editor, UI) are included in the recording.

#### Acceptance Criteria

1. WHEN the user initiates a Screen_Recording_Session, THE Screen_Recorder SHALL request a Tab_Capture_Stream via `navigator.mediaDevices.getDisplayMedia()` with the `preferCurrentTab` hint set to true.
2. WHEN the user grants screen capture permission, THE Screen_Recorder SHALL extract the video track from the Tab_Capture_Stream for use in the Combined_Stream.
3. IF the user denies the screen capture permission prompt, THEN THE Screen_Recorder SHALL display an error message indicating that screen capture permission is required and cancel the recording attempt.
4. IF the browser does not support the Screen Capture API (`getDisplayMedia` is undefined), THEN THE Screen_Recorder SHALL hide the screen record button from the Header.

### Requirement 2: Audio Capture for Screen Recording

**User Story:** As a live coder, I want the screen recording to include the audio from my performance, so that the exported video has synchronized sound.

#### Acceptance Criteria

1. WHEN the user initiates a Screen_Recording_Session, THE Screen_Recorder SHALL create a MediaStreamDestination node and connect it to the DestinationGain node of the SuperdoughOutput.
2. THE Screen_Recorder SHALL extract the audio track from the MediaStreamDestination and add it to the Combined_Stream alongside the video track.
3. THE Screen_Recorder SHALL capture audio without introducing audible latency or artifacts to the main audio output routed to the AudioContext destination.
4. IF the AudioContext is not in a "running" state when recording is initiated, THEN THE Screen_Recorder SHALL display an error message indicating that audio playback must be active before screen recording.

### Requirement 3: Combined Stream Recording

**User Story:** As a live coder, I want the video and audio to be recorded together into a single file, so that I get a synchronized video of my performance.

#### Acceptance Criteria

1. WHEN both the video track and audio track are available, THE Screen_Recorder SHALL create a Combined_Stream containing one video track and one audio track.
2. THE Screen_Recorder SHALL create a MediaRecorder using the Combined_Stream with the `video/webm;codecs=vp9,opus` MIME type when supported, falling back to `video/webm;codecs=vp8,opus`, then `video/webm`.
3. THE Screen_Recorder SHALL configure the MediaRecorder with a video bitrate of 2500 kbps.
4. WHILE a Screen_Recording_Session is active, THE Screen_Recorder SHALL collect data chunks incrementally from the MediaRecorder via the `ondataavailable` event.

### Requirement 4: Recording Lifecycle Control

**User Story:** As a live coder, I want to start and stop screen recording with a single button in the Header, so that I can easily capture my visual performances.

#### Acceptance Criteria

1. THE Header SHALL display a screen record button next to the existing audio record button when the Strudel REPL is not in embedded mode, not in zen mode, and the browser supports the Screen Capture API.
2. WHEN the user clicks the screen record button while no Screen_Recording_Session is active, THE Screen_Recorder SHALL initiate a new Screen_Recording_Session.
3. WHEN the user clicks the screen record button while a Screen_Recording_Session is active, THE Screen_Recorder SHALL stop the Screen_Recording_Session and finalize the captured data.
4. WHILE a Screen_Recording_Session is active, THE Header SHALL display the screen record button in a visually distinct "recording" state with a red highlight and a video camera icon.
5. WHILE a Screen_Recording_Session is active, THE Header SHALL display the elapsed recording duration in minutes and seconds format (MM:SS).
6. IF the Tab_Capture_Stream ends externally (the user stops sharing via the browser's built-in "Stop sharing" control), THEN THE Screen_Recorder SHALL automatically stop the Screen_Recording_Session and finalize the recording.

### Requirement 5: Live Code Changes During Screen Recording

**User Story:** As a live coder, I want the screen recording to seamlessly capture all visual and audio changes when I update my patterns mid-performance, so that the recording reflects my full creative session.

#### Acceptance Criteria

1. WHILE a Screen_Recording_Session is active, THE Screen_Recorder SHALL continue capturing video and audio without interruption when the user evaluates new code via the update action.
2. WHILE a Screen_Recording_Session is active, THE Screen_Recorder SHALL continue capturing video and audio without interruption when the user toggles playback (stop and restart).
3. WHILE a Screen_Recording_Session is active AND the user stops playback, THE Screen_Recorder SHALL capture the visual state of the tab (including the idle UI) and silence until playback resumes or the Screen_Recording_Session ends.

### Requirement 6: Video Export as WebM

**User Story:** As a live coder, I want to download my screen recording as a WebM file, so that I have a video of my performance to share online.

#### Acceptance Criteria

1. WHEN a Screen_Recording_Session ends, THE Screen_Recorder SHALL assemble the captured data chunks into a single WebM Blob.
2. WHEN the WebM Blob is ready, THE Screen_Recorder SHALL trigger a browser file download with the filename format "strudel-screen-YYYY-MM-DD-HHmmss.webm".
3. IF the captured data is empty (zero chunks or zero duration), THEN THE Screen_Recorder SHALL display a warning message and skip the file download.

### Requirement 7: Recording State Persistence Across UI Interactions

**User Story:** As a live coder, I want the screen recording to continue even when I interact with other UI elements, so that my recording is not accidentally interrupted.

#### Acceptance Criteria

1. WHILE a Screen_Recording_Session is active, THE Screen_Recorder SHALL maintain the recording when the user opens or closes the file manager sidebar.
2. WHILE a Screen_Recording_Session is active, THE Screen_Recorder SHALL maintain the recording when the user navigates between tracks using the file manager.
3. WHILE a Screen_Recording_Session is active, THE Screen_Recorder SHALL maintain the recording when the user opens or closes settings panels.

### Requirement 8: Mutual Exclusion with Audio Recorder

**User Story:** As a live coder, I want clear feedback when both recorders cannot run simultaneously, so that I avoid conflicts between the audio-only and screen recording features.

#### Acceptance Criteria

1. WHILE a Screen_Recording_Session is active, THE Header SHALL disable the audio record button and display a tooltip indicating that audio-only recording is unavailable during screen recording.
2. WHILE an audio Recording_Session is active, THE Header SHALL disable the screen record button and display a tooltip indicating that screen recording is unavailable during audio-only recording.

### Requirement 9: Resource Cleanup

**User Story:** As a live coder, I want the screen recorder to release all resources after recording, so that my browser does not consume unnecessary memory or keep capturing my screen.

#### Acceptance Criteria

1. WHEN a Screen_Recording_Session ends, THE Screen_Recorder SHALL stop all tracks on the Tab_Capture_Stream.
2. WHEN a Screen_Recording_Session ends, THE Screen_Recorder SHALL disconnect the MediaStreamDestination node from the DestinationGain node.
3. WHEN a Screen_Recording_Session ends or is finalized, THE Screen_Recorder SHALL release all captured data chunks from memory after the file download completes.
4. WHEN the REPL component unmounts, THE Screen_Recorder SHALL destroy all active resources including any ongoing Screen_Recording_Session.
