# Design Document - Track Routing Navigation

## Overview

The Track Routing Navigation system provides seamless URL-based navigation between musical tracks in the Strudel REPL while maintaining audio playback continuity. The system uses query parameters to encode track state in URLs, enabling bookmarking, sharing, and browser navigation while preserving the musical flow by allowing previous tracks to continue playing in the background.

## Architecture

The system follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Layer                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ URL/History API │  │ Local Storage   │  │ Page Title  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Routing Layer                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ Track Router    │  │ URL Parser      │  │ History Mgr │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                 Application Layer                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ Track Manager   │  │ UI Controller   │  │ Transition  │ │
│  │                 │  │                 │  │ Manager     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Audio Layer                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ Playback Engine │  │ Audio Context   │  │ Pattern     │ │
│  │                 │  │                 │  │ Scheduler   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Track Router

The central component responsible for URL-based navigation:

```typescript
interface TrackRouter {
  // Navigation methods
  navigateToTrack(trackId: string, options?: NavigationOptions): Promise<void>;
  getCurrentTrackId(): string | null;
  
  // URL management
  updateURL(trackId: string): void;
  parseTrackFromURL(): string | null;
  
  // History management
  pushState(trackId: string): void;
  replaceState(trackId: string): void;
  
  // Event handling
  onTrackChange(callback: (trackId: string) => void): void;
  onURLChange(callback: (trackId: string) => void): void;
}

interface NavigationOptions {
  preservePlayback?: boolean;
  animate?: boolean;
  updateHistory?: boolean;
}
```

### URL Parser

Handles URL query parameter parsing and generation:

```typescript
interface URLParser {
  parseTrackId(url: string): string | null;
  generateTrackURL(trackId: string, baseURL?: string): string;
  validateTrackId(trackId: string): boolean;
  sanitizeTrackId(trackId: string): string;
}
```

### Track Manager

Manages track data and state persistence:

```typescript
interface TrackManager {
  // Track operations
  getTrack(trackId: string): Track | null;
  saveTrack(track: Track): void;
  deleteTrack(trackId: string): void;
  getAllTracks(): Track[];
  
  // State management
  setCurrentTrack(trackId: string): void;
  getCurrentTrack(): Track | null;
  setPlayingTrack(trackId: string): void;
  getPlayingTrack(): Track | null;
}

interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string;
  metadata?: TrackMetadata;
}

interface TrackMetadata {
  description?: string;
  tags?: string[];
  tempo?: number;
  key?: string;
}
```

### Transition Manager

Handles smooth visual transitions between tracks:

```typescript
interface TransitionManager {
  transitionToTrack(fromTrack: Track, toTrack: Track): Promise<void>;
  setTransitionDuration(duration: number): void;
  getTransitionDuration(): number;
  
  // Animation methods
  fadeOut(element: HTMLElement): Promise<void>;
  fadeIn(element: HTMLElement): Promise<void>;
  slideTransition(from: HTMLElement, to: HTMLElement): Promise<void>;
}
```

### Playback Controller

Manages audio playback continuity:

```typescript
interface PlaybackController {
  // Playback state
  isPlaying(): boolean;
  getCurrentlyPlayingTrack(): string | null;
  
  // Playback control
  startTrack(trackId: string): void;
  stopTrack(trackId: string): void;
  pauseTrack(trackId: string): void;
  
  // Background playback
  allowBackgroundPlayback(trackId: string): void;
  stopBackgroundPlayback(trackId: string): void;
}
```

## Data Models

### Navigation State

```typescript
interface NavigationState {
  currentTrackId: string | null;
  playingTrackId: string | null;
  previousTrackId: string | null;
  navigationHistory: string[];
  isTransitioning: boolean;
}
```

### URL Structure

The system uses a simple query parameter structure:

```
https://strudel.cc/?track={trackId}
https://strudel.cc/?track={trackId}&folder={folderId}
https://strudel.cc/?track={trackId}&step={stepIndex}  // For multitrack
```

Examples:
- `https://strudel.cc/?track=abc123def456` - Basic track navigation
- `https://strudel.cc/?track=abc123def456&folder=beats` - Track in folder
- `https://strudel.cc/?track=abc123def456&step=2` - Specific step in multitrack

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After reviewing all potential properties from the prework analysis, I identified several areas where properties can be consolidated:

- Properties 1.1, 1.3, and 1.4 all relate to URL handling and can be combined into a comprehensive URL routing property
- Properties 2.1, 2.2, and 2.4 all test playback continuity and can be unified
- Properties 3.1 and 3.2 both test transition animations and can be combined
- Properties 4.3 and 4.4 both test UI state indication and can be merged
- Properties 7.1, 7.2, and 7.3 all test browser history and can be consolidated

### Core Properties

**Property 1: URL routing consistency**
*For any* valid track ID, navigating to a URL with that track parameter should load the corresponding track, and switching to any track should update the URL to reflect the current track
**Validates: Requirements 1.1, 1.2, 1.4**

**Property 2: URL persistence across sessions**
*For any* track state encoded in a URL, refreshing the page should restore the exact same track and state
**Validates: Requirements 1.3**

**Property 3: Invalid track ID handling**
*For any* invalid or malformed track ID in the URL, the system should gracefully handle the error and show an appropriate default state
**Validates: Requirements 1.5**

**Property 4: Playback continuity during navigation**
*For any* track switch while audio is playing, the previous track should continue playing until explicitly stopped, and the new track content should load without interrupting audio
**Validates: Requirements 2.1, 2.2, 2.4**

**Property 5: UI state consistency**
*For any* navigation state, the system should clearly distinguish between the currently playing track and the currently viewed track in the interface
**Validates: Requirements 2.5, 4.3, 4.4**

**Property 6: Transition timing compliance**
*For any* track switch, the transition animation should complete within 300ms and display loading states appropriately
**Validates: Requirements 3.1, 3.2, 3.3**

**Property 7: Track metadata display completeness**
*For any* track displayed in the navigation interface, all required metadata (name, creation date, description) should be visible
**Validates: Requirements 4.2**

**Property 8: Data persistence reliability**
*For any* track creation or modification, the changes should be immediately saved to local storage and restored on application restart
**Validates: Requirements 5.1, 5.2, 5.3**

**Property 9: Track management operations**
*For any* track management operation (create, duplicate, rename, delete), the operation should complete successfully and maintain data integrity
**Validates: Requirements 6.2, 6.3, 6.4, 6.5**

**Property 10: Browser history integration**
*For any* sequence of track navigation, the browser back/forward buttons should correctly navigate through the track history and update the page title
**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

**Property 11: URL shareability**
*For any* track state, the generated URL should contain sufficient information to restore the track state when accessed by another user
**Validates: Requirements 8.1, 8.2, 8.5**

## Error Handling

### URL Parsing Errors
- Invalid track IDs: Show default track or welcome screen
- Malformed URLs: Redirect to clean URL with default track
- Missing tracks: Display "Track not found" message with options to create or import

### Storage Errors
- Quota exceeded: Implement cleanup strategies and user notifications
- Corruption: Attempt recovery with backup mechanisms
- Access denied: Graceful degradation with session-only storage

### Navigation Errors
- Circular references: Detect and break navigation loops
- Concurrent modifications: Implement optimistic locking
- Network issues: Cache navigation state locally

### Playback Errors
- Audio context issues: Provide fallback audio handling
- Resource loading failures: Show appropriate error messages
- Timing conflicts: Implement audio scheduling conflict resolution

## Testing Strategy

### Unit Testing Approach

Unit tests will focus on individual component functionality:

- **URL Parser**: Test URL generation and parsing with various track IDs
- **Track Manager**: Test CRUD operations and state management
- **Transition Manager**: Test animation timing and completion
- **Playback Controller**: Test audio state management

### Property-Based Testing Approach

Property-based tests will use **fast-check** as the testing library, configured to run a minimum of 100 iterations per property. Each property-based test will be tagged with a comment referencing the corresponding correctness property.

**Property Test Examples:**

```typescript
// **Feature: track-routing-navigation, Property 1: URL routing consistency**
test('URL routing maintains consistency', () => {
  fc.assert(fc.property(
    fc.string().filter(isValidTrackId),
    (trackId) => {
      const url = generateTrackURL(trackId);
      const parsedId = parseTrackFromURL(url);
      return parsedId === trackId;
    }
  ), { numRuns: 100 });
});

// **Feature: track-routing-navigation, Property 4: Playback continuity during navigation**
test('Navigation preserves playback continuity', () => {
  fc.assert(fc.property(
    fc.array(fc.string().filter(isValidTrackId), { minLength: 2 }),
    (trackIds) => {
      const [currentTrack, nextTrack] = trackIds;
      startPlayback(currentTrack);
      navigateToTrack(nextTrack, { preservePlayback: true });
      return isStillPlaying(currentTrack) && isDisplaying(nextTrack);
    }
  ), { numRuns: 100 });
});
```

### Integration Testing

Integration tests will verify component interactions:

- Router + Track Manager: Test track loading and URL updates
- Transition Manager + UI: Test smooth visual transitions
- Playback Controller + Router: Test audio continuity during navigation
- Browser History + Router: Test back/forward navigation

### End-to-End Testing

E2E tests will validate complete user workflows:

- Navigate between tracks using UI
- Use browser back/forward buttons
- Refresh page and verify state restoration
- Share URLs and verify track loading
- Test keyboard navigation

## Performance Considerations

### URL Updates
- Debounce URL updates to prevent excessive history entries
- Use `replaceState` for intermediate navigation states
- Batch URL parameter updates

### Track Loading
- Implement lazy loading for track content
- Cache frequently accessed tracks
- Preload adjacent tracks in navigation

### Transition Animations
- Use CSS transforms for hardware acceleration
- Implement animation frame scheduling
- Provide reduced motion alternatives

### Storage Operations
- Batch localStorage writes
- Implement background persistence
- Use compression for large track data

## Security Considerations

### URL Validation
- Sanitize track IDs to prevent XSS
- Validate URL parameters before processing
- Implement rate limiting for navigation requests

### Data Persistence
- Encrypt sensitive track data
- Validate data integrity on load
- Implement secure backup mechanisms

### Cross-Origin Sharing
- Validate shared track URLs
- Implement content security policies
- Sanitize imported track data

## Browser Compatibility

### Modern Browser Features
- History API (pushState/replaceState)
- URLSearchParams for query parsing
- Local Storage for persistence
- CSS Transitions for animations

### Fallback Strategies
- Hash-based routing for older browsers
- Session storage fallback
- JavaScript-based animations
- Progressive enhancement approach

## Integration with Existing Systems

### FileManager Integration
- Extend existing track storage format
- Maintain compatibility with current track operations
- Integrate with folder structure

### Settings Integration
- Add routing preferences to settings
- Respect existing UI preferences
- Maintain theme and layout consistency

### Audio Engine Integration
- Work with existing Playback Engine
- Respect audio context limitations
- Maintain pattern scheduling integrity

### User Pattern System
- Bridge with existing user pattern utilities
- Maintain backward compatibility
- Support migration from old system