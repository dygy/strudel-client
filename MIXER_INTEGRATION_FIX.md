# Audio Mixer Integration Fix

## Summary

Fixed the audio mixer implementation to properly support dual-device audio output with live/preview mode switching.

## Changes Made

### 1. Fixed AudioStream.mjs - MediaStreamDestination Approach

**Problem**: The initial implementation tried to use separate AudioContexts per stream with `AudioContext.setSinkId()`, but this doesn't work with Strudel's architecture because superdough uses a global shared AudioContext.

**Solution**: Switched to the MediaStreamDestination + HTMLAudioElement.setSinkId() approach:
- Each stream uses the shared AudioContext
- Creates a MediaStreamDestination to capture audio
- Routes the stream to an HTMLAudioElement
- Uses HTMLAudioElement.setSinkId() to route to different devices

**Key Changes**:
- Removed separate AudioContext creation per stream
- Added MediaStreamDestination and HTMLAudioElement
- Changed setSinkId() to use HTMLAudioElement instead of AudioContext
- Added getOutputNode() method to expose the gain node for audio routing

### 2. Fixed AudioMixer.mjs - Strudel Integration

**Problem**: The mixer wasn't actually routing Strudel's audio through the streams.

**Solution**: Added integration with Strudel's superdough engine:
- Added `connectStrudelAudio()` method that disconnects superdough from main destination
- Connects superdough's destinationGain to the mixer's live stream
- Added `switchToStream()` method to route audio between live and preview

**Key Changes**:
- Added `connectStrudelAudio()` in initialize()
- Added `switchToStream(streamName)` method
- Fixed `setDevices()` to handle undefined deviceIds properly

### 3. Fixed MixerSettings.tsx

**Problem**: Called non-existent `mixer.saveConfig()` method.

**Solution**: The method is actually called `persistConfig()`, but it's already called internally by `setDevices()`, so no explicit call needed.

**Key Changes**:
- Removed incorrect `mixer.saveConfig()` calls
- Added status indicator showing when mixer is active
- Added warning icon for mixer not available state

### 4. Added Mixer Mode Toggle in Header

**Problem**: The "Play at Mixer" button was removed, but it's actually needed for switching between live and preview modes.

**Solution**: Restored the button and made it a mode toggle:
- Shows current mode (Live/Preview)
- Clicking switches between modes
- Visual indicator (blue background) when in preview mode
- Routes audio to the selected stream's device

**Key Changes**:
- Added `mixerMode` state in useReplContext
- Added `handleMixerModeToggle()` function
- Updated Header to show mode toggle button
- Button shows "Live" or "Preview" based on current mode

## How It Works

### Device Routing Flow

1. **Initialization**:
   - AudioMixer creates two AudioStreams (live and preview)
   - Each stream creates a MediaStreamDestination from the shared AudioContext
   - Each stream creates an HTMLAudioElement connected to the MediaStreamDestination
   - Superdough's audio is disconnected from main destination and routed to live stream

2. **Device Selection**:
   - User selects devices in Settings > Audio Mixer
   - `mixer.setDevices(liveDeviceId, previewDeviceId)` is called
   - Each stream calls `audioElement.setSinkId(deviceId)` to route to the selected device
   - Configuration is persisted to localStorage

3. **Mode Switching**:
   - User clicks the Live/Preview button in header
   - `handleMixerModeToggle()` is called
   - `mixer.switchToStream(newMode)` disconnects superdough from current stream
   - Reconnects superdough to the selected stream (live or preview)
   - Audio now plays through the selected device

### Audio Path

```
Strudel Pattern Code
  ↓
superdough() function
  ↓
SuperdoughAudioController.destinationGain
  ↓
[Mixer switches this connection based on mode]
  ↓
Live Stream OR Preview Stream
  ↓
outputGain (for volume control)
  ↓
MediaStreamDestination
  ↓
HTMLAudioElement.setSinkId(deviceId)
  ↓
Physical Audio Device (speakers/headphones)
```

## Testing

To test the mixer:

1. **Build the mixer package**:
   ```bash
   pnpm --filter @strudel/mixer build
   ```

2. **Start the dev server**:
   ```bash
   pnpm dev
   ```

3. **Test device routing**:
   - Open Settings > Audio Mixer
   - Select different devices for Live and Preview
   - Click the Live/Preview button in header to switch modes
   - Play a pattern - it should play through the selected device

4. **Verify dual-device output**:
   - Connect two audio devices (e.g., speakers and headphones)
   - Set Live to speakers, Preview to headphones
   - Switch to Preview mode
   - Play a pattern - should hear it in headphones only
   - Switch to Live mode
   - Play a pattern - should hear it in speakers only

## Known Limitations

1. **Browser Support**: HTMLAudioElement.setSinkId() is only supported in Chrome/Edge. Firefox and Safari will fall back to default device.

2. **Single Stream Active**: Currently, only one stream plays at a time (either live or preview). To support simultaneous playback (for transitions), we would need to create separate Repl instances per stream.

3. **No Transition Support Yet**: The transition functionality (crossfade between streams) is implemented in TransitionMixer but not yet wired up to the UI.

## Next Steps

To fully implement the mixer as designed:

1. **Add Transition Button**: Add a button to trigger crossfade from preview to live
2. **Separate Repl Instances**: Create separate Repl instances for each stream to enable simultaneous playback
3. **Keyboard Shortcuts**: Add keyboard shortcuts for mode switching and transitions
4. **Visual Feedback**: Add more visual indicators showing which stream is active
5. **Error Handling**: Add better error messages when device selection fails

## Files Modified

- `packages/mixer/AudioStream.mjs` - Fixed device routing approach
- `packages/mixer/AudioMixer.mjs` - Added Strudel integration
- `website/src/repl/components/panel/MixerSettings.tsx` - Fixed method calls, added status
- `website/src/repl/components/Header.tsx` - Added mode toggle button
- `website/src/repl/useReplContext.tsx` - Added mixer mode state and toggle handler

## References

- [Chrome Blog: AudioContext.setSinkId()](https://developer.chrome.com/blog/audiocontext-setsinkid/)
- [MDN: HTMLMediaElement.setSinkId()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId)
- [Stack Overflow: Dual Device Audio Output](https://stackoverflow.com/questions/56501693/chrome-play-audio-on-two-outputs-with-htmlaudioelement-setsinkid)
