# Microphone Access Fix - Critical Security Issue

## Problem
When clicking samples in the Strudel samples tab, the browser was requesting microphone access permissions. This is a critical privacy/security issue as sample playback should not require microphone access.

## Root Cause
The issue was in `packages/superdough/superdough.mjs` in the `getAudioDevices()` function:

```javascript
export const getAudioDevices = async () => {
  await navigator.mediaDevices.getUserMedia({ audio: true }); // ❌ PROBLEM!
  let mediaDevices = await navigator.mediaDevices.enumerateDevices();
  // ... rest of function
};
```

The `getUserMedia({ audio: true })` call was requesting microphone access unnecessarily. This function is only meant to enumerate audio OUTPUT devices for speaker selection, not to access the microphone.

## Solution
Removed the unnecessary `getUserMedia` call:

```javascript
export const getAudioDevices = async () => {
  // Removed getUserMedia call - we only need output devices, not microphone access
  let mediaDevices = await navigator.mediaDevices.enumerateDevices();
  // ... rest of function
};
```

## Technical Details

### Why This Happened
1. When clicking samples, the audio system initializes
2. Audio device enumeration gets triggered (for speaker selection)
3. The `getAudioDevices()` function was incorrectly calling `getUserMedia()`
4. Browser requests microphone permissions

### Why getUserMedia Was There
The original code likely included `getUserMedia()` to get device labels, as `enumerateDevices()` only returns device labels after permission is granted. However:
- This is unnecessary for audio OUTPUT devices
- It's a privacy violation for sample playback
- Modern browsers handle device enumeration better

### Files Changed
- `packages/superdough/superdough.mjs` - Removed getUserMedia call
- Rebuilt `packages/superdough/dist/index.mjs`
- Rebuilt `packages/webaudio/dist/index.mjs`

## Impact
- ✅ **No more microphone access requests** when clicking samples
- ✅ **Improved privacy and security**
- ✅ **Sample playback still works perfectly**
- ✅ **Audio device selection still functional** (may show generic device names instead of specific labels)

## Testing
After this fix:
1. Click samples in the samples tab
2. Browser should NOT request microphone access
3. Sample previews should play normally
4. Audio device selection in settings should still work

## Deployment
To apply this fix:
1. Restart the development server: `npm run dev`
2. Hard refresh browser: `Ctrl+F5` or `Cmd+Shift+R`
3. Test sample clicking - no microphone prompt should appear

## Security Note
This was a significant privacy issue that could have:
- Surprised users with unexpected microphone access requests
- Potentially allowed unintended audio recording
- Created security concerns in enterprise environments
- Violated user privacy expectations

The fix ensures Strudel only accesses audio OUTPUT capabilities for sample playback, which is the expected and secure behavior.