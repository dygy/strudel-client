# Requirements Document

## Introduction

This document specifies requirements for a DJ-style audio preview feature that enables live coders to preview code changes on headphones before pushing them live to speakers. The system uses a TRUE DUAL-ENGINE architecture: the live audio chain uses the existing `StrudelMirror` repl with the singleton `superdough()` controller, while the preview chain uses an independent `PreviewEngine` with its own `SuperdoughAudioController` and `repl()` instance.

The core workflow is: Play (speakers) → Play Preview (headphones, independent engine) → Stop Preview (headphones stop, speakers untouched) → Update (stop preview + evaluate code on live repl). Both engines share the same `AudioContext` but have completely independent audio controllers, orbits, and pattern schedulers — the performer can hear different patterns on speakers vs headphones simultaneously.

## Glossary

- **Preview_Engine**: The system component that creates an independent audio chain (own SuperdoughAudioController + repl instance) for previewing code on headphones
- **Live_Chain**: The existing main `StrudelMirror` repl → singleton `superdough()` → `getSuperdoughAudioController()` → `audioContext.destination` (speakers)
- **Preview_Chain**: The `PreviewEngine`'s independent audio path: `previewRepl` → `superdough(value, t, dur, cps, cycle, previewController)` → `previewController.output.destinationGain` → `MediaStreamDest` → `HTMLAudioElement.setSinkId(headphoneDeviceId)`
- **Audio_Device**: A physical or virtual audio output device (speakers, headphones, etc.)
- **SuperdoughAudioController**: The class that manages Web Audio orbits and output chain; the live chain uses the singleton instance, the preview chain creates its own
- **Superdough_Function**: The `superdough()` function in `@strudel/superdough` that accepts an optional 6th `_controller` parameter to override the default singleton audio controller
- **Repl_Instance**: A pattern scheduler created by the `repl()` factory from `@strudel/core`; the live chain uses `StrudelMirror`'s built-in repl, the preview chain creates its own via `repl()`
- **Web_Audio_Context**: The browser's Web Audio API context (single shared instance used by both engines)
- **Pattern**: A musical sequence defined in Strudel code

## Requirements

### Requirement 1: Dual-Engine Audio Architecture

**User Story:** As a live coder, I want an independent preview audio engine, so that I can hear my code changes on headphones while the audience continues hearing the live pattern on speakers.

#### Acceptance Criteria

1. THE Preview_Engine SHALL create its own SuperdoughAudioController instance, independent from the singleton used by the Live_Chain
2. THE Preview_Engine SHALL create its own Repl_Instance via the `repl()` factory, independent from the StrudelMirror repl used by the Live_Chain
3. WHEN the Preview_Engine evaluates code, THE Superdough_Function SHALL receive the preview's SuperdoughAudioController as the 6th `_controller` parameter, routing audio through the Preview_Chain instead of the Live_Chain
4. THE Preview_Engine SHALL disconnect its controller's `destinationGain` from `audioContext.destination` and route it through `MediaStreamDest` → `HTMLAudioElement` for device-specific output
5. WHEN the Preview_Engine is playing, THE Live_Chain SHALL continue playing its current pattern on speakers without interruption
6. THE Preview_Engine and Live_Chain SHALL share the same Web_Audio_Context instance

### Requirement 2: Preview Device Selection

**User Story:** As a live coder, I want to route preview audio to my headphones, so that only I hear the preview while the audience hears the live stream on speakers.

#### Acceptance Criteria

1. THE Preview_Engine SHALL allow users to select an Audio_Device for preview output via `HTMLAudioElement.setSinkId(deviceId)`
2. WHEN an Audio_Device is selected for preview, THE Preview_Engine SHALL persist the device ID to localStorage under key `strudel-preview-device`
3. WHEN the browser is refreshed, THE Preview_Engine SHALL restore the previously selected preview Audio_Device from localStorage
4. WHEN a selected Audio_Device becomes unavailable, THE Preview_Engine SHALL fall back to the system default device and clear the stored device ID
5. IF `setSinkId` is not supported by the browser, THEN THE Preview_Engine SHALL log a warning and continue with default audio routing
6. WHEN audio devices change (plug/unplug), THE MixerSettings component SHALL refresh the device list automatically

### Requirement 3: Preview Workflow

**User Story:** As a live coder, I want to preview my code changes on headphones before pushing them live, so that I can refine patterns without the audience hearing mistakes.

#### Acceptance Criteria

1. THE Header component SHALL display a "Play Preview" button when the Preview_Engine is initialized
2. WHEN "Play Preview" is clicked, THE Preview_Engine SHALL evaluate the current editor code on its independent Repl_Instance, routing audio to the preview Audio_Device only
3. WHEN "Stop Preview" is clicked, THE Preview_Engine SHALL stop its Repl_Instance, silencing headphone output while the Live_Chain continues on speakers
4. WHEN "Update" is pressed while previewing, THE System SHALL stop the Preview_Engine and evaluate the current editor code on the Live_Chain (main StrudelMirror repl)
5. THE System SHALL visually indicate preview mode with a highlighted button state (blue tint background)

### Requirement 4: MixerSettings UI for Preview Device

**User Story:** As a live coder, I want a settings panel to select my preview headphone device, so that I can configure which output receives preview audio.

#### Acceptance Criteria

1. THE MixerSettings component SHALL display a dropdown of available audio output devices for preview device selection
2. WHEN a preview device is selected in MixerSettings, THE Preview_Engine SHALL route audio to that device via `setSinkId`
3. THE MixerSettings component SHALL display a status indicator when the Preview_Engine is initialized
4. WHEN audio devices change (plug/unplug), THE MixerSettings component SHALL refresh the device list via `navigator.mediaDevices.addEventListener('devicechange', ...)`

### Requirement 5: Visual Feedback and Status Indication

**User Story:** As a live coder, I want clear visual indicators of preview state, so that I always know whether I'm previewing or live.

#### Acceptance Criteria

1. THE Header SHALL display a "Play Preview" / "Stop Preview" toggle button with distinct visual states
2. WHEN in preview mode, THE "Play Preview" button SHALL display a highlighted background (blue tint)
3. WHEN the Preview_Engine is initialized, THE MixerSettings SHALL display a green status indicator
4. THE MixerSettings SHALL display the currently selected preview Audio_Device

### Requirement 6: Web Audio API Integration

**User Story:** As a developer, I want the preview engine to integrate with Strudel's existing audio system without breaking existing functionality.

#### Acceptance Criteria

1. THE Preview_Engine SHALL use the shared Web_Audio_Context (not create a separate one)
2. THE Preview_Engine SHALL receive its dependencies (superdough function, repl factory, SuperdoughAudioController class, getTime, transpiler) via constructor injection to avoid cross-package singleton issues
3. WHEN the Preview_Engine is destroyed, THE destroy() method SHALL disconnect all audio nodes, pause the HTMLAudioElement, and clean up the Repl_Instance
4. THE Preview_Engine SHALL support the existing Strudel audio features (effects, orbits, synthesis) since it creates its own full SuperdoughAudioController with independent orbits

### Requirement 7: State Persistence and Recovery

**User Story:** As a live coder, I want my preview device selection to persist across sessions, so that I don't have to reconfigure my headphone output each time.

#### Acceptance Criteria

1. THE System SHALL persist the preview Audio_Device ID to localStorage under key `strudel-preview-device`
2. WHEN the browser is refreshed, THE System SHALL restore the previous preview device selection
3. WHEN restoring configuration, THE System SHALL validate that the selected Audio_Device is still available and clear stale device IDs

### Requirement 8: Error Handling and Recovery

**User Story:** As a live coder, I want the preview engine to handle errors gracefully, so that audio issues don't interrupt my performance.

#### Acceptance Criteria

1. WHEN an Audio_Device fails or disconnects, THE Preview_Engine SHALL fall back to the default device and log a warning
2. WHEN setSinkId is not supported by the browser, THE Preview_Engine SHALL log a warning and continue with default routing
3. WHEN Preview_Engine initialization fails, THE System SHALL log the error and continue without preview capability (live audio unaffected)
4. WHEN the Preview_Engine is destroyed (e.g., React unmount), THE destroy() method SHALL fully clean up audio nodes and the Repl_Instance

### Requirement 9: React Lifecycle Compatibility

**User Story:** As a developer, I want the preview engine to work correctly with React's component lifecycle, so that mount/unmount cycles don't corrupt audio routing.

#### Acceptance Criteria

1. WHEN React causes unmount/remount, THE Preview_Engine SHALL handle the destroy-then-reinitialize cycle without corrupting the Live_Chain audio routing
2. WHEN destroy() is called, THE Preview_Engine SHALL fully disconnect its own audio nodes without affecting the Live_Chain's connection to `audioContext.destination`
3. WHEN a new Preview_Engine instance is created after a previous one was destroyed, THE System SHALL initialize a fresh independent audio chain

### Requirement 10: Legacy Mixer Classes

**User Story:** As a developer, I want the legacy AudioMixer, AudioStream, and TransitionMixer classes to remain exported from `@strudel/mixer`, so that existing code referencing them does not break.

#### Acceptance Criteria

1. THE `@strudel/mixer` package SHALL continue to export AudioMixer, AudioStream, TransitionMixer, ErrorNotifier, and KeyboardShortcutManager alongside PreviewEngine
2. THE legacy classes (AudioMixer, AudioStream, TransitionMixer) SHALL remain functional but are not used by the main application's preview workflow
