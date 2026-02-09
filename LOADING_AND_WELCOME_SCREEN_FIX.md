# Loading and Welcome Screen Fix

## Problem Summary
After importing tracks from an archive, the welcome screen was still showing instead of automatically loading a track. Additionally, the "No tracks yet" message was appearing during loading states.

## Root Causes

### 1. Undefined `tracks` Variable Error
**File**: `website/src/repl/components/sidebar/FileManagerRefactored.tsx`
- The `useTracks()` hook was called but the variable was defined after a conditional return
- This caused a `ReferenceError: tracks is not defined` at line 1221

### 2. "No Tracks Yet" Message During Loading
**File**: `website/src/repl/components/sidebar/FileTree.tsx`
- The `showEmptyState` logic was `tree.length === 0 && hasAnyData`
- This showed the message even when data was still loading
- The message appeared during SSR data initialization

### 3. Welcome Screen Always Showing
**File**: `website/src/repl/components/ReplEditor.tsx`
- Multiple issues with welcome screen logic:
  - Unnecessary `showWelcomeDelayed` state with 2-second delay
  - Unused `shouldRenderEditor` state that was always `false`
  - Duplicate welcome screen rendering logic
  - No auto-selection of tracks after import

## Fixes Applied

### Fix 1: Moved `useTracks()` Hook Call
**File**: `website/src/repl/components/sidebar/FileManagerRefactored.tsx`

Added a comment to clarify that hooks must be called at the top level:

```typescript
export function FileManagerRefactored({ context, fileManagerHook, readOnly = false }: FileManagerProps) {
  const { t, i18n } = useTranslation(['files', 'common', 'tabs', 'auth']);
  
  // CRITICAL: Call useTracks() at the top level before any conditional returns
  const tracks = useTracks();
  
  // ... rest of component
}
```

### Fix 2: Updated Empty State Logic
**File**: `website/src/repl/components/sidebar/FileTree.tsx`

Changed the `showEmptyState` calculation to only show when NOT loading:

```typescript
// Before
const showEmptyState = tree.length === 0 && hasAnyData;

// After
const showEmptyState = !isLoading && tree.length === 0 && !hasAnyData;
```

Now the "No tracks yet" message only appears when:
- NOT loading (`!isLoading`)
- Tree is empty (`tree.length === 0`)
- AND there's no data at all (`!hasAnyData`)

### Fix 3: Simplified Welcome Screen Logic
**File**: `website/src/repl/components/ReplEditor.tsx`

#### Removed Unnecessary State
```typescript
// REMOVED:
const [showWelcomeDelayed, setShowWelcomeDelayed] = useState(false);
const [shouldRenderEditor, setShouldRenderEditor] = useState(false);

// KEPT:
const [codeComponentKey] = useState(() => Math.random().toString(36));
```

#### Simplified Welcome Screen Condition
```typescript
// Before
const shouldShowWelcome = showWelcomeDelayed && tracks.isInitialized && !tracks.hasTracks && !tracks.isLoading;

// After
const shouldShowWelcome = tracks.isInitialized && !tracks.hasTracks && !tracks.isLoading;
```

#### Fixed Duplicate Rendering
```typescript
// Before (showing welcome screen in TWO cases)
{shouldShowWelcome ? (
  <WelcomeScreen ... />
) : !shouldRenderEditor ? (
  <WelcomeScreen ... />
) : (
  <Code ... />
)}

// After (single condition)
{shouldShowWelcome ? (
  <WelcomeScreen ... />
) : (
  <Code ... />
)}
```

### Fix 4: Auto-Select Track After Import
**File**: `website/src/repl/components/ReplEditor.tsx`

Added auto-selection logic to the `handleTracksImported` function:

```typescript
const handleTracksImported = async () => {
  console.log('🔥 ReplEditor: Tracks imported, refreshing store');
  if (fileManagerHook?.isAuthenticated) {
    await tracks.loadFromAPI();
    
    // After loading, auto-select the first track if none is selected
    setTimeout(() => {
      const tracksArray = Object.values(fileManagerHook.tracks || {});
      if (tracksArray.length > 0 && !fileManagerHook.selectedTrack) {
        console.log('🔥 ReplEditor: Auto-selecting first track after import');
        const firstTrack = tracksArray[0];
        fileManagerHook.loadTrack(firstTrack);
      }
    }, 200);
  }
};
```

## Behavior After Fixes

### On Page Load (SSR)
1. `tracks.isLoading` is `true` → FileTree shows empty div (no message)
2. `tracks.isInitialized` is `false` → Welcome screen doesn't show
3. SSR data loads → `tracks.isInitialized` becomes `true`, `tracks.hasTracks` becomes `true`
4. Editor shows with track code loaded

### After Import
1. User imports tracks from ZIP
2. `strudel-tracks-imported` event fires
3. Store refreshes with `tracks.loadFromAPI()`
4. First track is auto-selected with `fileManagerHook.loadTrack(firstTrack)`
5. Track code loads into editor
6. Welcome screen hides because `tracks.hasTracks` is now `true`

### When No Tracks Exist
1. `tracks.isInitialized` is `true`
2. `tracks.hasTracks` is `false`
3. `tracks.isLoading` is `false`
4. Welcome screen shows with "Create" and "Import" buttons

## Files Modified
1. `website/src/repl/components/sidebar/FileManagerRefactored.tsx`
2. `website/src/repl/components/sidebar/FileTree.tsx`
3. `website/src/repl/components/ReplEditor.tsx`

## Testing Checklist
- [x] No console errors on page load
- [x] Welcome screen shows when no tracks exist
- [x] Welcome screen hides when tracks are imported
- [x] First track auto-selects after import
- [x] Track code loads into editor after import
- [x] "No tracks yet" message only shows when truly empty (not during loading)
- [x] SSR data loads without showing welcome screen flash

## Technical Notes

### State Synchronization
All components now use the shared `tracks` store from `useTracks()` hook for synchronization:
- `tracks.isLoading` - indicates data is being fetched
- `tracks.isInitialized` - indicates store has been initialized
- `tracks.hasTracks` - computed from `Object.keys(tracks.tracks).length > 0`

### Loading States
The loading flow is now clean and predictable:
1. Initial: `isLoading=true, isInitialized=false` → Show nothing
2. Loading: `isLoading=true, isInitialized=true` → Show empty div
3. Loaded with tracks: `isLoading=false, hasTracks=true` → Show editor
4. Loaded without tracks: `isLoading=false, hasTracks=false` → Show welcome screen

This eliminates the "macaroni peperoni code" by using a single source of truth (the tracks store) instead of multiple disconnected state variables.
