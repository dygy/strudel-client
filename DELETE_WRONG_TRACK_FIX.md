# Delete Wrong Track Fix

## Problem
When deleting a track that was NOT currently selected/viewed, the system would:
1. Navigate to the deleted track's URL (e.g., `/repl/rythm-style`)
2. Break the application state
3. Show "track not found" errors
4. Leave the user on a broken page

**Example**: User is viewing "track-a", deletes "rythm-style" from the file tree → URL changes to `/repl/rythm-style` (broken).

## Root Cause
The `confirmDelete` function in `useFileManagerOperations.ts` was using the wrong track ID:

```typescript
// WRONG - Used selectedTrack instead of trackToDelete
const trackToDelete = tracks[selectedTrack];
```

This caused it to:
1. Delete the wrong track (the selected one, not the one user clicked delete on)
2. Check if the wrong track was in the URL
3. Navigate to the wrong track's URL

The bug existed because:
- `deleteTrack()` correctly sets `trackToDelete` state with the clicked track's ID
- But `confirmDelete()` ignored that state and used `selectedTrack` instead
- `trackToDelete` prop wasn't being passed to the operations hook

## Solution

### 1. Added trackToDelete Prop
Updated `UseFileManagerOperationsProps` interface to include `trackToDelete`:

```typescript
interface UseFileManagerOperationsProps {
  tracks: Record<string, Track>;
  folders: Record<string, Folder>;
  selectedTrack: string | null;
  trackToDelete: string | null;  // Added this
  // ... other props
}
```

### 2. Used Correct Track ID
Updated `confirmDelete` to use `trackToDelete` prop instead of `selectedTrack`:

```typescript
export function useFileManagerOperations({
  tracks,
  folders,
  selectedTrack,
  trackToDelete: trackToDeleteId,  // Renamed to avoid confusion
  // ...
}) {
  const confirmDelete = useCallback(async () => {
    if (!tracks || !setTracks || !trackToDeleteId) return;
    
    // Use the correct track ID
    const trackToDelete = tracks[trackToDeleteId];
    // ...
  }, [tracks, setTracks, trackToDeleteId, /* ... */]);
}
```

### 3. Fixed URL Comparison
Changed from ID-based URL matching to slug-based URL matching:

```typescript
// OLD - Wrong approach (compared IDs)
const currentUrlTrackId = window.location.pathname.match(/^\/repl\/([^\/]+)$/)?.[1];
const isDeletingCurrentUrlTrack = currentUrlTrackId === trackToDelete.id;

// NEW - Correct approach (compares full URLs)
const currentPath = window.location.pathname;
const trackUrl = generateTrackUrlPath(trackToDelete.name, trackToDelete.folder, folders);
const isDeletingCurrentUrlTrack = currentPath === trackUrl;
```

This properly handles:
- Root tracks: `/repl/track-name`
- Folder tracks: `/repl/folder/track-name`
- Nested folders: `/repl/folder/subfolder/track-name`

### 4. Updated Safe Defaults
Added `trackToDelete: null` to the safe defaults in `FileManagerRefactored.tsx`:

```typescript
const operations = useFileManagerOperations(fileManagerState ? {
  ...fileManagerState,  // Includes trackToDelete from state
  context,
  t,
  deleteTrack: fileManagerState.deleteTrack,
} : {
  // Safe defaults
  trackToDelete: null,  // Added this
  // ...
});
```

## Files Modified

### Core Logic
**File**: `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts`

- Added `trackToDelete` to props interface
- Renamed prop to `trackToDeleteId` in destructuring for clarity
- Updated `confirmDelete` to use `trackToDeleteId` instead of `selectedTrack`
- Fixed URL comparison to use slug-based URLs
- Updated dependency array to include `trackToDeleteId` and `folders`

### Integration
**File**: `website/src/repl/components/sidebar/FileManagerRefactored.tsx`

- Added `trackToDelete: null` to safe defaults object

### State Management
**File**: `website/src/repl/components/sidebar/hooks/useFileManager.ts` (no changes needed)

- Already returns `trackToDelete` in state
- Already sets it correctly in `deleteTrack` function

## Behavior After Fix

### Deleting Non-Selected Track
1. User views "track-a" at `/repl/track-a`
2. User clicks delete on "rythm-style" in file tree
3. Modal shows: "Delete rythm-style?"
4. User confirms
5. "rythm-style" is deleted
6. URL stays at `/repl/track-a` ✅
7. User continues working on "track-a" ✅

### Deleting Currently Viewed Track
1. User views "track-a" at `/repl/track-a`
2. User clicks delete on "track-a" in file tree
3. Modal shows: "Delete track-a?"
4. User confirms
5. "track-a" is deleted
6. URL navigates to next available track (e.g., `/repl/track-b`) ✅
7. User sees "track-b" loaded ✅

### Deleting Last Track
1. User views "last-track" at `/repl/last-track`
2. User clicks delete on "last-track"
3. User confirms
4. "last-track" is deleted
5. URL navigates to `/repl` ✅
6. Editor is cleared ✅

## Testing

### Test Cases
- [x] Delete non-selected track → URL doesn't change
- [x] Delete currently viewed track → navigates to next track
- [x] Delete last track → navigates to `/repl`
- [x] Delete track in folder → correct URL comparison
- [x] Delete track with same name in different folder → correct track deleted

### Before Fix
```
Action: Delete "rythm-style" (not selected)
Current URL: /repl/track-a
Result: URL changes to /repl/rythm-style ❌
State: Broken, track not found ❌
```

### After Fix
```
Action: Delete "rythm-style" (not selected)
Current URL: /repl/track-a
Result: URL stays at /repl/track-a ✅
State: Working, track-a still loaded ✅
```

## Related Issues Fixed

This fix also resolves:
- Incorrect track being deleted when multiple tracks selected rapidly
- URL jumping to deleted track's URL unexpectedly
- State corruption after deletion
- "Track not found" errors after deletion

## Implementation Date
January 14, 2026

## Status
✅ Complete - Delete now correctly uses trackToDelete state
