# Requirements Document

## Introduction

This document specifies the requirements for an audio equalizer feature in Strudel, a web-based live coding music environment. The equalizer will provide users with precise control over frequency response, similar to Spotify's equalizer, enabling them to shape their sound output. The equalizer must apply to both preview audio and the main source device output, integrate seamlessly with the existing mixer architecture, and provide visual feedback to help users understand how their adjustments affect the audio.

## Glossary

- **Equalizer (EQ)**: An audio processing tool that adjusts the balance of frequency components in an audio signal
- **Band**: A specific frequency range in the equalizer that can be independently adjusted
- **Gain**: The amount of boost or cut applied to a frequency band, measured in decibels (dB)
- **Q Factor**: The bandwidth or width of a frequency band; higher Q means narrower band
- **Frequency Response Curve**: A visual representation showing how the equalizer affects different frequencies
- **BiquadFilterNode**: Web Audio API node used to implement individual EQ bands
- **Preview_Engine**: The audio engine that plays preview audio in Strudel
- **Source_Device**: The main audio output device for Strudel's live coding output
- **Audio_Mixer**: The existing mixer system that manages audio routing and processing
- **Preset**: A predefined set of equalizer settings optimized for specific music genres or use cases
- **Flat Response**: An equalizer state where all bands have 0 dB gain (no modification)

## Requirements

### Requirement 1: Multi-Band Parametric Equalizer

**User Story:** As a musician, I want to control multiple frequency bands independently, so that I can precisely shape my sound across the entire frequency spectrum.

#### Acceptance Criteria

1. THE Equalizer SHALL provide at least 10 frequency bands covering the range from 31 Hz to 16000 Hz
2. WHEN a user adjusts a band, THE Equalizer SHALL modify only that specific frequency range
3. THE Equalizer SHALL support gain adjustment from -12 dB to +12 dB for each band
4. THE Equalizer SHALL allow Q factor adjustment from 0.5 to 4.0 for each band
5. THE Equalizer SHALL use Web Audio API BiquadFilterNode for each band implementation

### Requirement 2: Dual Audio Path Processing

**User Story:** As a live coder, I want the equalizer to affect both my preview audio and main output, so that I can hear consistent sound quality across all audio paths.

#### Acceptance Criteria

1. WHEN the Equalizer is enabled, THE Equalizer SHALL apply processing to the Preview_Engine audio output
2. WHEN the Equalizer is enabled, THE Equalizer SHALL apply processing to the Source_Device audio output
3. WHEN equalizer settings are changed, THE Audio_Mixer SHALL update both audio paths simultaneously
4. THE Equalizer SHALL integrate with the existing AudioMixer.mjs architecture without breaking existing functionality
5. WHEN switching between preview and live modes, THE Equalizer SHALL maintain consistent settings across both paths

### Requirement 3: Visual Frequency Response Display

**User Story:** As a user learning audio processing, I want to see a visual representation of how my EQ settings affect frequencies, so that I can understand the impact of my adjustments.

#### Acceptance Criteria

1. THE EQ_UI SHALL display a frequency response curve showing the combined effect of all bands
2. WHEN a user adjusts any band, THE EQ_UI SHALL update the frequency response curve in real-time
3. THE EQ_UI SHALL display frequency labels on the horizontal axis from 20 Hz to 20000 Hz
4. THE EQ_UI SHALL display gain labels on the vertical axis from -12 dB to +12 dB
5. THE EQ_UI SHALL use a logarithmic scale for frequency display to match human hearing perception
6. THE EQ_UI SHALL highlight the currently adjusted band when a user interacts with band controls

### Requirement 4: Equalizer Presets

**User Story:** As a user who wants quick results, I want to select from predefined equalizer presets, so that I can quickly apply professional sound profiles without manual adjustment.

#### Acceptance Criteria

1. THE Equalizer SHALL provide at least 8 preset options: Flat, Rock, Pop, Jazz, Classical, Bass Boost, Treble Boost, and Vocal
2. WHEN a user selects a preset, THE Equalizer SHALL apply all band settings for that preset within 50 milliseconds
3. THE Equalizer SHALL allow users to modify preset settings after selection
4. THE Equalizer SHALL indicate which preset is currently active in the UI
5. WHEN a user modifies a preset, THE EQ_UI SHALL display "Custom" as the active preset name

### Requirement 5: Individual Band Controls

**User Story:** As an audio engineer, I want precise control over each frequency band's parameters, so that I can create custom equalizer curves for my specific needs.

#### Acceptance Criteria

1. THE EQ_UI SHALL provide a gain slider for each frequency band
2. THE EQ_UI SHALL provide a Q factor control for each frequency band
3. WHEN a user adjusts a band's gain, THE Equalizer SHALL update the audio processing within 10 milliseconds
4. THE EQ_UI SHALL display the current gain value in dB for each band
5. THE EQ_UI SHALL display the center frequency in Hz for each band
6. THE EQ_UI SHALL allow users to reset individual bands to 0 dB gain

### Requirement 6: Enable and Disable Functionality

**User Story:** As a performer, I want to quickly enable or disable the equalizer, so that I can compare processed and unprocessed audio during my performance.

#### Acceptance Criteria

1. THE Equalizer SHALL provide a master enable/disable toggle
2. WHEN the Equalizer is disabled, THE Audio_Mixer SHALL bypass all EQ processing
3. WHEN the Equalizer is disabled, THE Equalizer SHALL maintain all current settings for re-enabling
4. WHEN toggling the Equalizer state, THE Audio_Mixer SHALL transition smoothly without audio clicks or pops
5. THE EQ_UI SHALL clearly indicate whether the Equalizer is currently enabled or disabled

### Requirement 7: Reset and Default Settings

**User Story:** As a user experimenting with settings, I want to reset the equalizer to default values, so that I can start fresh if my adjustments don't work out.

#### Acceptance Criteria

1. THE Equalizer SHALL provide a reset button that sets all bands to 0 dB gain
2. WHEN the reset button is activated, THE Equalizer SHALL restore the Flat preset settings
3. WHEN resetting, THE Equalizer SHALL maintain its enabled/disabled state
4. THE EQ_UI SHALL confirm the reset action to prevent accidental resets
5. WHEN the Equalizer is first initialized, THE Equalizer SHALL start with Flat preset settings

### Requirement 8: Settings Persistence

**User Story:** As a regular user, I want my equalizer settings to be saved, so that I don't have to reconfigure them every time I use Strudel.

#### Acceptance Criteria

1. WHEN a user changes equalizer settings, THE Equalizer SHALL save the settings to localStorage within 500 milliseconds
2. WHEN Strudel loads, THE Equalizer SHALL restore previously saved settings from localStorage
3. THE Equalizer SHALL persist the enabled/disabled state across sessions
4. THE Equalizer SHALL persist the active preset selection across sessions
5. THE Equalizer SHALL persist all individual band settings (gain and Q factor) across sessions
6. IF no saved settings exist, THE Equalizer SHALL initialize with Flat preset settings

### Requirement 9: Mixer Architecture Integration

**User Story:** As a developer maintaining Strudel, I want the equalizer to integrate cleanly with existing mixer code, so that the system remains maintainable and extensible.

#### Acceptance Criteria

1. THE Equalizer SHALL extend the existing AudioMixer.mjs class or integrate as a plugin
2. THE Equalizer SHALL use the existing audio routing infrastructure in AudioStream.mjs
3. THE Equalizer SHALL work correctly with the TransitionMixer.mjs for smooth transitions
4. THE Equalizer SHALL not interfere with existing mixer functionality (volume, mute, solo)
5. WHEN the Audio_Mixer is destroyed, THE Equalizer SHALL properly clean up all Web Audio nodes

### Requirement 10: Real-Time Performance

**User Story:** As a live performer, I want the equalizer to process audio without latency or glitches, so that my performance remains smooth and responsive.

#### Acceptance Criteria

1. WHEN processing audio, THE Equalizer SHALL introduce less than 5 milliseconds of additional latency
2. WHEN adjusting equalizer settings, THE Audio_Mixer SHALL update without causing audio dropouts or clicks
3. THE Equalizer SHALL process audio efficiently to maintain CPU usage below 5% on modern devices
4. WHEN multiple bands are adjusted simultaneously, THE Equalizer SHALL update all bands smoothly
5. THE Equalizer SHALL maintain stable performance during continuous audio playback for at least 60 minutes

### Requirement 11: Settings UI Integration

**User Story:** As a user, I want to access equalizer controls from the settings panel, so that I can adjust audio settings alongside other mixer controls.

#### Acceptance Criteria

1. THE EQ_UI SHALL be accessible from the existing settings panel in MixerSettings.tsx
2. THE EQ_UI SHALL use React components consistent with the existing Strudel UI design
3. THE EQ_UI SHALL be responsive and work on both desktop and mobile devices
4. WHEN the settings panel is closed, THE Equalizer SHALL continue processing audio with current settings
5. THE EQ_UI SHALL provide tooltips or help text explaining equalizer controls for new users

### Requirement 12: Mobile and Desktop Support

**User Story:** As a mobile user, I want to use the equalizer on my phone or tablet, so that I can shape my sound regardless of my device.

#### Acceptance Criteria

1. THE EQ_UI SHALL render correctly on screens with minimum width of 320 pixels
2. THE EQ_UI SHALL support touch gestures for adjusting band controls on mobile devices
3. THE EQ_UI SHALL adapt the frequency response curve display to available screen space
4. THE EQ_UI SHALL provide appropriately sized touch targets (minimum 44x44 pixels) for mobile interaction
5. WHEN on mobile devices, THE EQ_UI SHALL prioritize essential controls and hide advanced options in collapsible sections
