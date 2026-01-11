# Requirements Document

## Introduction

The REPL sometimes loads default code instead of random tracks when users visit `/repl`, even when they are authenticated and have tracks available. This creates a poor user experience where users expect to see their content but get generic default code instead.

## Glossary

- **REPL**: The main code editor interface where users write and execute Strudel code
- **Default_Code**: Generic placeholder code shown when no user tracks are available
- **Random_Track**: A randomly selected track from the user's saved tracks
- **SSR_Data**: Server-side rendered data containing tracks and folders
- **Authentication_State**: The current user authentication status and session validity
- **Tracks_Store**: The centralized store managing tracks and folders data
- **Race_Condition**: When multiple asynchronous operations complete in unpredictable order

## Requirements

### Requirement 1: Authenticated Random Track Loading

**User Story:** As an authenticated user with saved tracks, I want to see a random track loaded when I visit the REPL, so that I can immediately start working with my content instead of seeing default code.

#### Acceptance Criteria

1. WHEN an authenticated user visits `/repl` AND has saved tracks, THE System SHALL load a random track instead of default code
2. WHEN the random track is selected, THE System SHALL load the track's code into the editor
3. WHEN SSR data is available with tracks, THE System SHALL use SSR data for immediate random track selection
4. WHEN SSR data is not available, THE System SHALL wait for Supabase data to load before selecting a random track
5. THE System SHALL ensure the random track selection happens after authentication is confirmed

### Requirement 2: Race Condition Prevention

**User Story:** As a user, I want the REPL to load consistently regardless of network timing, so that I don't see flickering between default code and my actual tracks.

#### Acceptance Criteria

1. WHEN authentication and track loading happen simultaneously, THE System SHALL coordinate their completion before showing content
2. WHEN default code is initially loaded, THE System SHALL replace it with a random track once tracks are available
3. WHEN tracks are loading, THE System SHALL show a loading state instead of default code
4. THE System SHALL prevent multiple random track selections from racing against each other
5. THE System SHALL ensure only one track loading operation happens at a time

### Requirement 3: Fallback Behavior

**User Story:** As a user without saved tracks or with authentication issues, I want to see appropriate content, so that the REPL remains functional in all scenarios.

#### Acceptance Criteria

1. WHEN a user has no saved tracks, THE System SHALL show a welcome screen with introductory content
2. WHEN authentication fails or times out, THE System SHALL show default code with appropriate messaging
3. WHEN track loading fails, THE System SHALL fall back to default code and show an error message
4. WHEN a user is not authenticated, THE System SHALL show default code immediately without waiting
5. THE System SHALL provide clear feedback about why default code is shown instead of user tracks

### Requirement 4: Performance and User Experience

**User Story:** As a user, I want the REPL to load quickly and smoothly, so that I can start coding without delays or confusion.

#### Acceptance Criteria

1. WHEN SSR data is available, THE System SHALL use it for immediate track loading without additional API calls
2. WHEN loading tracks from Supabase, THE System SHALL show progress indicators
3. THE System SHALL complete random track loading within 5 seconds of page load
4. WHEN track loading exceeds timeout, THE System SHALL fall back to default code
5. THE System SHALL cache authentication state to avoid repeated checks during track loading

### Requirement 5: State Synchronization

**User Story:** As a developer, I want the tracks store and file manager to stay synchronized, so that the UI reflects the correct data state.

#### Acceptance Criteria

1. WHEN tracks are loaded via SSR, THE System SHALL update both the tracks store and file manager state
2. WHEN tracks are loaded via Supabase API, THE System SHALL ensure both stores reflect the same data
3. WHEN a random track is selected, THE System SHALL update the active pattern state
4. THE System SHALL prevent duplicate track loading operations
5. THE System SHALL ensure the selected track is marked as active in all relevant stores