# @strudel/mixer

DJ-style audio mixer with preview stream for Strudel live coding.

## Features

- **Dual Audio Streams**: Independent live and preview audio processing chains
- **Device Selection**: Route each stream to different audio output devices
- **Preview Mode**: Test code changes safely before going live
- **Smooth Transitions**: Instant switch or crossfade between streams
- **State Persistence**: Configuration saved across browser sessions
- **Error Handling**: Graceful fallbacks and clear error messages

## Installation

```bash
pnpm add @strudel/mixer
```

## Usage

```javascript
import { AudioMixer } from '@strudel/mixer';

// Create audio context
const audioContext = new AudioContext();

// Initialize mixer
const mixer = new AudioMixer(audioContext, {
  transitionType: 'crossfade',
  transitionDuration: 2.0
});

await mixer.initialize();

// Get available audio devices
const devices = await mixer.getAvailableDevices();

// Set output devices
await mixer.setDevices(
  'live-device-id',    // Live stream to speakers
  'preview-device-id'  // Preview stream to headphones
);

// Evaluate code on preview stream
await mixer.previewStream.evaluate('sound("bd sd")');

// Transition preview to live
await mixer.transition('crossfade', 2.0);
```

## API

### AudioMixer

Main mixer manager coordinating dual streams.

- `initialize()` - Set up both audio streams
- `setDevices(liveDeviceId, previewDeviceId)` - Configure output routing
- `getAvailableDevices()` - List available audio output devices
- `transition(type, duration)` - Move preview stream to live
- `persistConfig()` - Save configuration to localStorage
- `restoreConfig()` - Restore saved configuration

### AudioStream

Individual audio stream with independent pattern evaluation.

- `initialize()` - Set up audio chain and Repl
- `setDevice(deviceId)` - Route to specific audio device
- `evaluate(code, autostart)` - Run Strudel code on this stream
- `clear()` - Stop playback and reset pattern
- `setGain(value)` - Adjust stream volume

### TransitionMixer

Handles smooth transitions between streams.

- `execute(type, duration)` - Perform transition
- `instantSwitch()` - Immediate stream swap
- `crossfade(duration)` - Gradual volume crossfade

## License

AGPL-3.0-or-later
