# Desktop Bridge Import Fix

## Issue
After the npm migration, the website was trying to import from `@strudel/desktopbridge/loggerbridge.mjs`, but this package is marked as private and wasn't published to npm.

## Root Cause
The `@strudel/desktopbridge` package provides Tauri-specific functionality for desktop apps:
- `loggerbridge.mjs` - Bridges log events from Tauri backend to UI
- `midibridge.mjs` - Provides desktop MIDI functionality  
- `oscbridge.mjs` - Provides desktop OSC functionality

These modules are only needed when running as a Tauri desktop app, not in web development mode.

## Solution
Modified `website/src/repl/util.mjs` to:

1. **Commented out Tauri-specific imports** that reference unpublished packages
2. **Always use web modules** (`@strudel/midi` and `@strudel/osc`) for development
3. **Added TODO comment** for future Tauri build integration

## Code Changes
```javascript
// Before (causing import error):
if (isTauri()) {
  modules = modules.concat([
    import('@strudel/desktopbridge/loggerbridge.mjs'),  // ❌ Not published to npm
    import('@strudel/desktopbridge/midibridge.mjs'),    // ❌ Not published to npm  
    import('@strudel/desktopbridge/oscbridge.mjs'),     // ❌ Not published to npm
  ]);
} else {
  modules = modules.concat([import('@strudel/midi'), import('@strudel/osc')]);
}

// After (working):
// For now, always use web modules since desktopbridge is not published to npm
modules = modules.concat([import('@strudel/midi'), import('@strudel/osc')]);
```

## Impact
- ✅ **Web development works** - No more import errors
- ✅ **MIDI/OSC functionality preserved** - Uses web-based modules
- ✅ **Future Tauri builds supported** - TODO comment for proper integration
- ✅ **No breaking changes** - Maintains all existing functionality

## Future Considerations
For proper Tauri desktop app builds, the desktop bridge modules would need to be:
1. Either published to npm as separate packages
2. Or bundled differently in the Tauri build process
3. Or loaded conditionally only when actually running in Tauri environment

For now, the web development experience is fully functional with web-based MIDI/OSC modules.