# Synchronization Fix - URL-Based Routing

## Problem Identified

The track navigation was causing duplicate `loadTrack` calls, preventing users from switching tracks properly. The root cause was a mismatch between the old ID-based system and the new URL-based routing system.

### The Issue

1. User clicks "rythm_style" track
2. `handleTrackSelect` calls `loadTrack(rythm_style)` ✅
3. `handleTrackSelect` updates URL to `/repl/rythm-style`
4. URL change triggers `setActivePattern('/repl/rythm-style')`
5. `activePattern` change triggers synchronization effect
6. Synchronization effect tries to use `/repl/rythm-style` as a track ID
7. Lookup fails, but then loads the wrong track (old selected track) ❌

### Root Cause

The synchronization effects in both `useSupabaseFileManager.ts` and `useFileManager.ts` were designed for the old system where `activePattern` was a track ID. In the new URL-based routing system, `activePattern` is a URL path like `/repl/folder/track-name`, not a track ID.

The old code was doing:
```typescript
if (tracks[activePattern] && selectedTrack !== activePattern) {
  loadTrack(tracks[activePattern]); // ❌ activePattern is a URL, not an ID
}
```

## Solution Applied

### 1. Fixed Synchronization in useSupabaseFileManager.ts

**File**: `website/src/repl/components/sidebar/hooks/useSupabaseFileManager.ts`

**Changes**:
- Added imports for `parseTrackUrlPath` and `findTrackByFolderAndSlug`
- Modified synchronization effect to parse URL paths and find tracks correctly
- Added backward compatibility for legacy track ID format

**Before**:
```typescript
// Handle activePattern changes (URL routing)
useEffect(() => {
  if (!isInitialized || !activePattern || !user) return;
  
  // If the activePattern exists in tracks and is different from selected track, load it
  if (tracks[activePattern] && selectedTrack !== activePattern) {
    setSelectedTrack(activePattern);
    loadTrack(tracks[activePattern]); // ❌ Wrong: activePattern is URL, not ID
  }
}, [activePattern, isInitialized, selectedTrack, loadTrack, tracks, user, selectedStepTrack]);
```

**After**:
```typescript
// Handle activePattern changes (URL routing)
useEffect(() => {
  if (!isInitialized || !activePattern || !user) return;
  
  if (selectedStepTrack) {
    console.log('SupabaseFileManager - skipping activePattern load due to step selection');
    return;
  }

  // NEW: activePattern is now a URL path, not a track ID
  // Parse the URL to find the actual track
  let targetTrack = null;
  
  if (activePattern.startsWith('/repl/')) {
    // Parse URL path to find track
    const parsedPath = parseTrackUrlPath(activePattern);
    
    if (parsedPath) {
      const { folderPath, trackSlug } = parsedPath;
      const tracksArray = Object.values(tracks);
      targetTrack = findTrackByFolderAndSlug(tracksArray, folderPath, trackSlug);
      console.log('SupabaseFileManager - parsed URL path:', { folderPath, trackSlug, foundTrack: targetTrack?.name });
    }
  } else {
    // Fallback: try to find by track ID (backward compatibility)
    targetTrack = tracks[activePattern];
    console.log('SupabaseFileManager - using activePattern as track ID (legacy)');
  }

  // If we found a target track and it's different from selected track, load it
  if (targetTrack && selectedTrack !== targetTrack.id) {
    console.log('SupabaseFileManager - loading track from URL synchronization:', targetTrack.name);
    setSelectedTrack(targetTrack.id);
    loadTrack(targetTrack);
  } else if (targetTrack) {
    console.log('SupabaseFileManager - track already selected, skipping load');
  }
}, [activePattern, isInitialized, selectedTrack, loadTrack, tracks, user, selectedStepTrack]);
```

### 2. Fixed Synchronization in useFileManager.ts

**File**: `website/src/repl/components/sidebar/hooks/useFileManager.ts`

Applied the same fix to the localStorage-based file manager for consistency.

### 3. Previous Fixes (Already Applied)

**File**: `website/src/repl/components/ReplEditor.tsx`
- Removed duplicate `loadTrack` call from smooth navigation handler
- Optimized global save manager registration to prevent unnecessary re-renders

## How It Works Now

### Navigation Flow (Fixed)

1. User clicks track in file manager
2. `handleTrackSelect()` calls `loadTrack(track)` once
3. `handleTrackSelect()` updates URL with `pushState()` to `/repl/folder/track-name`
4. `handleTrackSelect()` dispatches `strudel-navigate-track` event
5. ReplEditor receives event and updates document title only (no duplicate load)
6. URL change triggers `setActivePattern('/repl/folder/track-name')`
7. Synchronization effect parses URL path to find track
8. If track is already selected, skip loading (prevents duplicate)
9. If track is different, load it (handles browser navigation)

### URL Parsing Logic

The synchronization effect now:
1. Checks if `activePattern` starts with `/repl/`
2. If yes, parses it as a URL path using `parseTrackUrlPath()`
3. Extracts `folderPath` and `trackSlug` from the URL
4. Finds the track using `findTrackByFolderAndSlug()`
5. Compares with `selectedTrack` to avoid duplicate loads
6. Falls back to legacy track ID lookup for backward compatibility

## Expected Behavior After Fix

1. **Single Track Loading**: Each track loads only once when selected
2. **No Duplicate Calls**: Console shows only one `loadTrack` call per navigation
3. **Smooth Navigation**: URL updates immediately without page reloads
4. **Browser Navigation**: Back/forward buttons work correctly
5. **Folder Support**: Tracks in folders are found correctly by URL path

## Testing Checklist

- ✅ Click track in file manager → loads once
- ✅ No duplicate `loadTrack` calls in console
- ✅ URL updates to correct path with folder support
- ✅ Browser back/forward buttons work
- ✅ Tracks in folders load correctly
- ✅ No loading loops or stuck navigation

## Technical Details

### URL Format
- **Root tracks**: `/repl/track-name`
- **Folder tracks**: `/repl/folder1/folder2/track-name`
- **Main repl**: `/repl`

### activePattern Values
- **New system**: URL path (e.g., `/repl/folder/track-name`)
- **Legacy system**: Track ID (e.g., `abc123xyz`)
- **Backward compatible**: Both formats supported

### Key Functions Used
- `parseTrackUrlPath(url)`: Extracts folder path and track slug from URL
- `findTrackByFolderAndSlug(tracks, folderPath, trackSlug)`: Finds track by folder and name
- `trackNameToSlug(name)`: Converts track name to URL-safe slug

## Files Modified

1. `website/src/repl/components/sidebar/hooks/useSupabaseFileManager.ts`
   - Fixed synchronization effect to parse URL paths
   - Added proper imports for slug utilities

2. `website/src/repl/components/sidebar/hooks/useFileManager.ts`
   - Applied same fix for localStorage-based manager
   - Ensures consistency across both storage backends

3. `website/src/repl/components/ReplEditor.tsx` (previous fix)
   - Removed duplicate loadTrack call
   - Optimized global save manager registration

## Result

The navigation system now works correctly with URL-based routing. Track switching is smooth, fast, and reliable without any duplicate loading or navigation loops.