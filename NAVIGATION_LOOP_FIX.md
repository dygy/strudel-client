# Navigation Loop Fix

## Problem Identified

The smooth navigation was causing a loop where tracks would load multiple times, preventing users from switching tracks properly. The issue was:

1. User clicks track → `handleTrackSelect` calls `loadTrack(track)`
2. `handleTrackSelect` dispatches `strudel-navigate-track` event  
3. ReplEditor's smooth navigation handler receives event and calls `loadTrack(track)` AGAIN
4. This created duplicate loading and prevented proper track switching

## Root Cause

The ReplEditor's smooth navigation event handler was unnecessarily calling `fileManagerHook.loadTrack(track)` even though the track was already loaded by `handleTrackSelect`. This created a duplicate loading cycle.

## Solution Applied

### 1. Removed Duplicate Track Loading
**File**: `website/src/repl/components/ReplEditor.tsx`

**Before**:
```typescript
const handleSmoothNavigation = (event: CustomEvent) => {
  const { track, url } = event.detail;
  
  // Update the file manager to load the new track
  if (fileManagerHook && typeof fileManagerHook === 'object' && fileManagerHook.loadTrack) {
    fileManagerHook.loadTrack(track); // ❌ DUPLICATE CALL
  }
  
  // Update document title
  document.title = `Strudel REPL - ${track.name}`;
};
```

**After**:
```typescript
const handleSmoothNavigation = (event: CustomEvent) => {
  const { track, url } = event.detail;
  
  // Note: Track is already loaded by handleTrackSelect, no need to load again
  // Just update the document title
  if (!document.title.includes(track.name)) {
    document.title = `Strudel REPL - ${track.name}`;
  }
};
```

### 2. Optimized Global Save Manager Registration
**File**: `website/src/repl/components/ReplEditor.tsx`

**Before**:
```typescript
useEffect(() => {
  if (fileManagerHook && context) {
    globalSaveManager.register(fileManagerHook, context);
    return () => globalSaveManager.unregister();
  }
}, [fileManagerHook, context]); // ❌ Re-registers on every change
```

**After**:
```typescript
// Use refs to prevent unnecessary re-registrations
const fileManagerRef = useRef(fileManagerHook);
const contextRef = useRef(context);

useEffect(() => {
  fileManagerRef.current = fileManagerHook;
  contextRef.current = context;
}, [fileManagerHook, context]);

useEffect(() => {
  if (fileManagerRef.current && contextRef.current) {
    globalSaveManager.register(fileManagerRef.current, contextRef.current);
    return () => globalSaveManager.unregister();
  }
}, []); // ✅ Register only once
```

## Expected Behavior After Fix

1. **Single Track Loading**: Each track loads only once when selected
2. **Smooth Navigation**: URL updates immediately without page reloads
3. **No Loops**: No duplicate `loadTrack` calls in the console
4. **Stable Registration**: Global save manager registers once, not on every render

## Navigation Flow (Fixed)

1. User clicks track in file manager
2. `handleTrackSelect()` calls `loadTrack(track)` once
3. `handleTrackSelect()` updates URL with `pushState()`
4. `handleTrackSelect()` dispatches `strudel-navigate-track` event
5. ReplEditor receives event and updates document title only
6. Track loads successfully without loops

## Testing

The fix should resolve:
- ✅ Track switching works immediately
- ✅ No duplicate loading in console logs
- ✅ Smooth navigation without page reloads
- ✅ Proper URL updates
- ✅ Stable component behavior

The navigation system should now work smoothly without the loading loops that were preventing track switching.