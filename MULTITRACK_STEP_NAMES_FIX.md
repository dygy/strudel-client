# Multitrack Step Names in URLs

## Problem
Multitrack tracks were using step indices in URLs (e.g., `?step=0`, `?step=1`) instead of step names. Additionally, when navigating to a multitrack track without a step parameter, it wasn't automatically redirecting to the first step.

## Requirements
1. URLs should use step names instead of indices: `?step=step-name`
2. When navigating to a multitrack track without a step parameter, automatically redirect to include the first step
3. Step names should be slugified for URL safety (e.g., "Step 1" becomes "step-1")

## Solution

### 1. Updated Slug Utilities
**File**: `website/src/lib/slugUtils.ts`

Changed `extractStepFromUrl` to return step name (string) instead of step index (number):

```typescript
// Before
export function extractStepFromUrl(urlPath: string): number | null {
  // ... returned step index as number
}

// After
export function extractStepFromUrl(urlPath: string): string | null {
  // ... returns step name as string
}
```

Added new utility functions:
- `findStepIndexByName()` - Find step index by step name in a track
- `getStepSlug()` - Convert step name to URL-safe slug

### 2. Updated Step Switching Logic
**File**: `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts`

Modified `switchToStep` to use step names in URLs:

```typescript
// Generate URL with step name instead of index
const stepName = track.steps[stepIndex].name;
const stepSlug = trackNameToSlug(stepName);
const stepUrl = `${trackUrl}?step=${stepSlug}`;

// Update document title with step name
document.title = `Strudel REPL - ${track.name} (${stepName})`;
```

### 3. Updated Track Selection Logic
**File**: `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts`

Modified `handleTrackSelect` to automatically add first step for multitrack tracks:

```typescript
// For multitrack tracks, always add the first step to the URL
if (track.isMultitrack && track.steps && track.steps.length > 0) {
  const firstStepName = track.steps[0].name;
  const firstStepSlug = trackNameToSlug(firstStepName);
  trackUrl = `${trackUrl}?step=${firstStepSlug}`;
}
```

### 4. Updated SSR Route
**File**: `website/src/pages/repl/[...trackPath].astro`

Added automatic redirection for multitrack tracks without step parameter:

```typescript
// Check if this is a multitrack and if we need to redirect to add step parameter
if (targetTrack.isMultitrack && targetTrack.steps && targetTrack.steps.length > 0) {
  const currentUrl = new URL(Astro.request.url);
  const stepParam = currentUrl.searchParams.get('step');
  
  // If no step parameter, redirect to include the first step
  if (!stepParam) {
    const firstStepSlug = slugify(targetTrack.steps[0].name);
    trackUrl = `${trackUrl}?step=${firstStepSlug}`;
    return Astro.redirect(trackUrl);
  }
}
```

Also updated random track redirection to include first step for multitrack tracks.

### 5. Updated Active Pattern Handling
**File**: `website/src/repl/components/sidebar/hooks/useSupabaseFileManager.ts`

Modified the activePattern effect to parse step names from URLs:

```typescript
// Split by ? to separate path from query params
const [pathPart, queryPart] = activePattern.split('?');

// Parse step parameter if present
let stepName: string | null = null;
if (queryPart) {
  const params = new URLSearchParams(queryPart);
  stepName = params.get('step');
}

// Find step index by name
if (stepName && targetTrack?.isMultitrack && targetTrack.steps) {
  const stepSlug = trackNameToSlug(stepName);
  targetStepIndex = targetTrack.steps.findIndex(step => 
    trackNameToSlug(step.name) === stepSlug
  );
  
  if (targetStepIndex === -1) {
    console.warn('Step not found, defaulting to first step');
    targetStepIndex = 0;
  }
}
```

## URL Format Examples

### Before
- Single track: `/repl/track-name`
- Multitrack (no step): `/repl/track-name` (no automatic redirect)
- Multitrack with step: `/repl/track-name?step=0`

### After
- Single track: `/repl/track-name`
- Multitrack (no step): `/repl/track-name?step=step-1` (automatic redirect)
- Multitrack with step: `/repl/track-name?step=step-1`
- Multitrack in folder: `/repl/trance/looking-for-a-miracle?step=intro`

## Benefits

1. **Human-Readable URLs**: Step names are more meaningful than indices
2. **Consistent Behavior**: Multitrack tracks always show which step is active
3. **Better UX**: Automatic redirect ensures users always land on a valid step
4. **Shareable Links**: URLs with step names are easier to understand and share
5. **Resilient**: If step name not found, falls back to first step

## Testing

To verify the fix:

1. Navigate to a multitrack track without step parameter (e.g., `/repl/trance/looking-for-a-miracle`)
   - Should automatically redirect to `/repl/trance/looking-for-a-miracle?step=step-1` (or whatever the first step is named)

2. Click on different steps in a multitrack track
   - URL should update to show step name: `?step=intro`, `?step=verse`, etc.

3. Share a URL with a step name
   - Should load the correct step when opened

4. Browser back/forward navigation
   - Should correctly navigate between steps

## Files Modified

1. `website/src/lib/slugUtils.ts` - Updated step utilities to use names instead of indices
2. `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts` - Updated step switching and track selection
3. `website/src/pages/repl/[...trackPath].astro` - Added automatic redirect for multitrack tracks
4. `website/src/repl/components/sidebar/hooks/useSupabaseFileManager.ts` - Updated activePattern parsing

## Status

✅ **COMPLETE** - All changes implemented
- No TypeScript errors
- Step names used in URLs instead of indices
- Automatic redirect to first step for multitrack tracks
- Backward compatible (falls back to first step if step not found)
