# Multitrack Step Navigation Fix

## Problem

Multitrack steps were still using the old ID-based navigation system instead of the new URL-based routing with proper step handling. When users clicked on steps in multitrack patterns, the navigation would go to track IDs instead of using proper step URLs.

## Solution Applied

### 1. Updated switchToStep Function

**File**: `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts`

**Changes**:
- Removed old `context.trackRouter` approach
- Implemented URL-based step navigation with query parameters
- Added `setActivePattern` call to update state
- Uses `replaceState` instead of `pushState` for step changes (doesn't create new history entries)

**Before**:
```typescript
// Update URL with step information if TrackRouter is available
if (context.trackRouter && selectedTrack === trackId) {
  try {
    await context.trackRouter.navigateToTrack(trackId, { 
      step: stepIndex, 
      replace: true, 
      skipUrlUpdate: false 
    });
  } catch (error) {
    console.error('FileManager - Failed to update URL for step:', error);
  }
}
```

**After**:
```typescript
// Update URL with step information using new URL-based system
if (selectedTrack === trackId) {
  try {
    // Generate track URL with step parameter
    const trackUrl = generateTrackUrlPath(track.name, track.folder);
    const stepUrl = `${trackUrl}?step=${stepIndex}`;
    
    // Update activePattern to include step
    setActivePattern(stepUrl);
    
    // Update browser URL
    window.history.replaceState(
      { trackId: track.id, trackName: track.name, step: stepIndex }, 
      '', 
      stepUrl
    );
    
    // Update document title
    document.title = `Strudel REPL - ${track.name} (Step ${stepIndex + 1})`;
  } catch (error) {
    console.error('FileManager - Failed to update URL for step:', error);
  }
}
```

### 2. Enhanced URL Parsing for Steps

**File**: `website/src/lib/slugUtils.ts`

**Added**:
- Updated `parseTrackUrlPath` to strip query parameters before parsing
- Added new `extractStepFromUrl` function to extract step parameter from URLs

**New Function**:
```typescript
/**
 * Extract step parameter from URL
 * Input: /repl/track-name?step=2
 * Output: 2 (or null if no step parameter)
 */
export function extractStepFromUrl(urlPath: string): number | null {
  const url = new URL(urlPath, 'http://localhost');
  const stepParam = url.searchParams.get('step');
  
  if (stepParam && !isNaN(parseInt(stepParam))) {
    const step = parseInt(stepParam);
    return step >= 0 ? step : null;
  }
  
  return null;
}
```

### 3. Updated Synchronization Effect for Steps

**File**: `website/src/repl/components/sidebar/hooks/useSupabaseFileManager.ts`

**Changes**:
- Added step parameter extraction from URLs
- Load specific step when URL contains step parameter
- Set `selectedStepTrack` when loading a step

**Enhanced Logic**:
```typescript
// Check for step parameter
targetStep = extractStepFromUrl(activePattern);

// If there's a step parameter and track is multitrack, load that step
if (targetStep !== null && targetTrack.isMultitrack && targetTrack.steps && targetTrack.steps[targetStep]) {
  const trackWithStep = {
    ...targetTrack,
    activeStep: targetStep,
    code: targetTrack.steps[targetStep].code
  };
  setSelectedTrack(targetTrack.id);
  setSelectedStepTrack(targetTrack.id);
  loadTrack(trackWithStep);
  console.log('SupabaseFileManager - loaded step:', targetStep);
} else {
  setSelectedTrack(targetTrack.id);
  loadTrack(targetTrack);
}
```

## URL Format for Steps

### Regular Tracks
- **Root track**: `/repl/track-name`
- **Folder track**: `/repl/folder1/folder2/track-name`

### Multitrack Steps
- **Root track step**: `/repl/track-name?step=0`
- **Folder track step**: `/repl/folder1/folder2/track-name?step=2`

### Step Numbering
- Steps are zero-indexed (step=0 is the first step)
- Document title shows human-friendly numbering (Step 1, Step 2, etc.)

## Navigation Behavior

### Step Navigation
1. User clicks step in multitrack
2. `switchToStep()` generates step URL with query parameter
3. `setActivePattern(stepUrl)` updates state
4. `replaceState()` updates browser URL (no new history entry)
5. Document title updates to show step number
6. Step code loads in editor

### Why replaceState?
- Steps within the same track use `replaceState` instead of `pushState`
- This prevents cluttering browser history with every step change
- Users can still use back button to go to previous tracks
- Step changes within a track don't create new history entries

## Browser Navigation Support

### Back/Forward Buttons
- Navigating back/forward between tracks works correctly
- If URL contains step parameter, that step loads automatically
- Synchronization effect handles step loading from URL

### Direct URL Access
- Users can bookmark specific steps: `/repl/my-track?step=3`
- Sharing URLs with step parameters works correctly
- SSR handles step parameters in initial page load

## Expected Behavior

### Console Logs (Clean):
```
FileManager - switchToStep called for track: my-track step: 2
FileManager - updating URL for step: 2
FileManager - step URL updated to: /repl/my-track?step=2
SupabaseFileManager - parsed URL path: { folderPath: null, trackSlug: 'my-track', step: 2 }
SupabaseFileManager - loaded step: 2
```

### What You Should See:
- ✅ Step URLs use query parameters: `/repl/track-name?step=2`
- ✅ Document title shows step number: "Strudel REPL - Track Name (Step 3)"
- ✅ Browser URL updates when switching steps
- ✅ No new history entries for step changes within same track
- ✅ Browser back/forward works correctly
- ✅ Direct step URLs work when shared or bookmarked

## Testing

Try these scenarios:
1. Click different steps in a multitrack → URL should update with step parameter
2. Use browser back button → Should navigate to previous track, not previous step
3. Bookmark a step URL → Should load that specific step when visited
4. Share a step URL → Should work for other users
5. Check console logs → Should see clean step loading without errors

## Files Modified

1. `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts`
   - Updated `switchToStep` to use URL-based navigation
   - Added `setActivePattern` call for step URLs
   - Uses `replaceState` for step changes

2. `website/src/lib/slugUtils.ts`
   - Updated `parseTrackUrlPath` to handle query parameters
   - Added `extractStepFromUrl` function

3. `website/src/repl/components/sidebar/hooks/useSupabaseFileManager.ts`
   - Enhanced synchronization effect to handle step parameters
   - Added step loading logic
   - Imported `extractStepFromUrl` utility

## Result

Multitrack step navigation now works correctly with the new URL-based routing system. Steps use clean query parameter URLs, browser navigation works properly, and step URLs can be shared and bookmarked.