# Requirements Document

## Introduction

This feature adds configurable smooth volume transitions when users update their live code in Strudel. When enabled, track changes will fade down the current track, then fade up the new track, creating a Spotify-like listening experience. This prevents jarring audio cuts during live coding sessions and provides a more polished performance experience.

## Glossary

- **Track**: A musical pattern created by evaluating user code in Strudel
- **Update**: The action of evaluating new code (triggered by pressing Ctrl+Enter or the update button)
- **Smooth_Transition**: A two-phase volume fade: fade down current track to silence, then fade up new track to target volume
- **Transition_Duration**: The time in seconds for each fade phase (down and up)
- **Target_Volume**: The user's configured master volume setting
- **Settings_Panel**: The UI panel where mixer and audio settings are configured
- **Instant_Switch**: The current default behavior where tracks change immediately without fading

## Requirements

### Requirement 1: Smooth Transition Toggle

**User Story:** As a live coder, I want to enable or disable smooth track transitions in settings, so that I can choose between instant updates and gradual fades based on my performance style.

#### Acceptance Criteria

1. WHEN the Settings_Panel is opened, THE System SHALL display a toggle control for smooth transitions
2. WHEN the smooth transition toggle is enabled, THE System SHALL persist this preference to localStorage
3. WHEN the smooth transition toggle is disabled, THE System SHALL persist this preference to localStorage
4. WHEN the application loads, THE System SHALL restore the smooth transition preference from localStorage
5. THE System SHALL default to disabled (instant switch) when no preference is stored

### Requirement 2: Fade Down Current Track

**User Story:** As a live coder, I want the current track to fade out smoothly when I update my code, so that the transition sounds natural and professional.

#### Acceptance Criteria

1. WHEN smooth transitions are enabled AND the user triggers an update, THE System SHALL fade the current track volume from its current level to 0
2. WHEN fading down the current track, THE System SHALL complete the fade within the configured Transition_Duration
3. WHEN the fade down completes, THE System SHALL stop the current track
4. IF smooth transitions are disabled, THEN THE System SHALL stop the current track instantly without fading

### Requirement 3: Fade Up New Track

**User Story:** As a live coder, I want the new track to fade in smoothly after the old track fades out, so that the transition feels continuous and controlled.

#### Acceptance Criteria

1. WHEN the current track fade down completes, THE System SHALL start the new track at volume 0
2. WHEN the new track starts, THE System SHALL fade its volume from 0 to the Target_Volume
3. WHEN fading up the new track, THE System SHALL complete the fade within the configured Transition_Duration
4. IF smooth transitions are disabled, THEN THE System SHALL start the new track instantly at Target_Volume

### Requirement 4: Configurable Transition Duration

**User Story:** As a live coder, I want to configure how long transitions take, so that I can match the transition speed to my musical tempo and performance style.

#### Acceptance Criteria

1. WHEN the Settings_Panel is opened, THE System SHALL display a duration control for transition timing
2. THE System SHALL allow transition durations between 0.5 and 10 seconds
3. WHEN the user changes the transition duration, THE System SHALL persist this value to localStorage
4. WHEN the application loads, THE System SHALL restore the transition duration from localStorage
5. THE System SHALL default to 2.0 seconds when no duration is stored

### Requirement 5: Sequential Transition Phases

**User Story:** As a live coder, I want the fade down to complete before the fade up begins, so that there's a clear separation between the old and new tracks.

#### Acceptance Criteria

1. WHEN a smooth transition executes, THE System SHALL complete the fade down phase before starting the fade up phase
2. WHEN a transition is in progress, THE System SHALL prevent new transitions from starting
3. IF the user triggers an update during a transition, THEN THE System SHALL queue the update to execute after the current transition completes
4. WHEN a queued update exists AND the current transition completes, THE System SHALL immediately start the queued transition

### Requirement 6: Volume Level Preservation

**User Story:** As a live coder, I want the new track to reach my configured volume level, so that I don't have to readjust volume after each update.

#### Acceptance Criteria

1. WHEN fading up a new track, THE System SHALL fade to the current Target_Volume setting
2. IF the user changes the Target_Volume during a transition, THEN THE System SHALL adjust the fade target to the new volume
3. WHEN a transition completes, THE System SHALL ensure the new track is playing at exactly the Target_Volume

### Requirement 7: Settings Persistence

**User Story:** As a live coder, I want my transition preferences to persist across sessions, so that I don't have to reconfigure them every time I use Strudel.

#### Acceptance Criteria

1. WHEN the smooth transition toggle changes, THE System SHALL save the setting to localStorage immediately
2. WHEN the transition duration changes, THE System SHALL save the setting to localStorage immediately
3. WHEN the application initializes, THE System SHALL load all transition settings from localStorage
4. IF localStorage is unavailable, THEN THE System SHALL use default values without errors

### Requirement 8: Integration with Existing Mixer

**User Story:** As a developer, I want smooth transitions to work with the existing mixer system, so that preview and live streams remain independent.

#### Acceptance Criteria

1. WHEN smooth transitions are enabled, THE System SHALL apply transitions only to the live stream
2. WHEN using preview mode, THE System SHALL continue using the existing crossfade transition system
3. WHEN switching between live and preview, THE System SHALL maintain independent transition behaviors
4. THE System SHALL not interfere with the existing TransitionMixer functionality
