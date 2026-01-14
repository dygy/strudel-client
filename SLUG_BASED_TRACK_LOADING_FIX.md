# Slug-Based Track Loading Fix

## Problem
The client-side code was selecting a random track instead of respecting the URL path. When navigating to `/repl/molten`, the SSR would correctly find the track, but the client would load a different random track like `momat`.

**Root Cause**: SSR was passing `targetTrackId` (UUID) to the client, but the client's `tracksStore.initializeWithCoordination` was trying to match tracks by ID. However, the URL contains the track slug (name), not the ID, so we need to match by slug instead.

## Solution
Migrated from ID-based track matching to slug-based track matching:

1. **SSR Changes** (`website/src/pages/repl/[...trackPath].astro`):
   - Added `targetTrackSlug` variable to store the track slug from URL
   - Pass both `targetTrackSlug` and `targetFolderPath` in `ssrData` to client
   - Keep `targetTrackId` for backward compatibility but prioritize slug matching

2. **Type Changes** (`website/src/types/ssr.ts`):
   - Added `targetTrackSlug?: string | null` to `SSRData` interface
   - Added `targetFolderPath?: string | null` to `SSRData` interface
   - Marked `targetTrackId` as legacy

3. **Store Changes** (`website/src/stores/tracksStore.ts`):
   - Updated `initializeWithCoordination` to use `targetTrackSlug` instead of `targetTrackId`
   - Match tracks by converting track name to slug and comparing with URL slug
   - Also match by folder path to handle tracks with same names in different folders
   - Removed legacy URL query parameter fallback (no longer needed with path-based routing)

4. **Client Changes** (`website/src/repl/components/ReplEditor.tsx`):
   - Pass entire `ssrData` object (including `targetTrackSlug` and `targetFolderPath`) to `tracksStore`
   - Ensure hierarchical data structure is preserved while passing additional fields

## Key Changes

### Before (ID-based matching):
```typescript
const targetTrackId = ssrData?.targetTrackId;
if (targetTrackId) {
  targetTrack = updatedState.tracks[targetTrackId] || null;
}
```

### After (Slug-based matching):
```typescript
const targetTrackSlug = ssrData?.targetTrackSlug;
const targetFolderPath = ssrData?.targetFolderPath;

if (targetTrackSlug) {
  const tracks = Object.values(updatedState.tracks);
  targetTrack = tracks.find(track => {
    const trackSlug = track.name.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const trackMatches = trackSlug === targetTrackSlug;
    const folderMatches = (track.folder || null) === (targetFolderPath || null);
    return trackMatches && folderMatches;
  }) || null;
}
```

## Benefits
1. **URL is single source of truth**: Track selection is based on URL slug, not internal IDs
2. **Folder support**: Correctly handles tracks with same names in different folders
3. **No random track selection**: Client respects the URL and loads the exact track requested
4. **SSR-driven**: Track selection happens on server, client just displays it
5. **Backward compatible**: Still passes `targetTrackId` for any legacy code

## Testing
1. Navigate to `/repl/molten` - should load the "molten" track
2. Navigate to `/repl/folder1/track-name` - should load "track-name" from "folder1"
3. Refresh page - should stay on the same track
4. Navigate between tracks - should smoothly switch without page reloads
5. Browser back/forward - should navigate between tracks correctly

## Files Modified
- `website/src/pages/repl/[...trackPath].astro` - SSR route with slug passing
- `website/src/types/ssr.ts` - SSRData type with slug fields
- `website/src/stores/tracksStore.ts` - Slug-based track matching
- `website/src/repl/components/ReplEditor.tsx` - Pass slug data to store
