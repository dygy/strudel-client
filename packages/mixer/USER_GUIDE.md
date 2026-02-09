# DJ-Style Audio Mixer User Guide

## Overview

The Strudel Audio Mixer brings professional DJ workflow to live coding. Preview your code changes on a separate audio output (like headphones) before pushing them live to your audience.

## Quick Start

### Basic Workflow

1. **Select Audio Devices**
   - Choose your main output device (speakers/PA system) for Live
   - Choose your preview device (headphones) for Preview

2. **Edit in Preview Mode**
   - Click "Preview" to switch to preview mode
   - Your code changes will play through headphones only
   - The live output continues unchanged

3. **Transition to Live**
   - When ready, click "Instant Switch" for immediate transition
   - Or click "Crossfade" for smooth 2-second blend
   - Your preview becomes the new live output

## UI Components

### Mode Toggle
- **Live** (🔊): Code runs on main output
- **Preview** (🎧): Code runs on preview output
- Active mode shown with colored badge in top-right corner

### Device Selection
- **Live Output**: Main speakers/PA system
- **Preview Output**: Headphones or secondary device
- Devices auto-detected from your system

### Transition Controls
- **Instant Switch**: Immediate cut to preview
- **Crossfade**: Smooth 2-second blend
- Buttons disabled when preview is inactive

### Visual Indicators
- **Mode Badge**: Shows current mode (Live/Preview)
- **Editor Border**: Red for Live, Blue for Preview
- **Health Indicator**: Stream status and polyphony

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Toggle between Live and Preview modes |
| `Ctrl+Shift+I` | Instant transition to Live |
| `Ctrl+Shift+X` | Crossfade to Live |
| `Ctrl+Shift+S` | Stop preview stream |

## Common Workflows

### Testing New Ideas
```
1. Switch to Preview mode (Ctrl+Shift+M)
2. Edit your code
3. Press Ctrl+Enter to evaluate
4. Listen on headphones
5. If good, crossfade to live (Ctrl+Shift+X)
```

### Quick Fixes
```
1. Keep Live playing
2. Switch to Preview
3. Fix the issue
4. Test on headphones
5. Instant switch when ready (Ctrl+Shift+I)
```

### Building Complex Patterns
```
1. Work in Preview mode
2. Iterate and refine
3. Test multiple variations
4. Transition only when perfect
```

## Device Setup

### Recommended Hardware
- **USB Audio Interface**: 2+ outputs
- **Headphones**: Connected to output 2
- **Speakers**: Connected to output 1

### Browser Permissions
- Allow audio device access when prompted
- Refresh device list if new devices connected

### Troubleshooting Devices
- If device not listed, check browser permissions
- Try refreshing the page
- Ensure device is connected before opening Strudel
- Some browsers require HTTPS for device selection

## Best Practices

### Performance Tips
- Preview uses same polyphony as live
- Complex patterns on both streams may hit limits
- Health indicator shows polyphony usage
- Simplify patterns if you see warnings

### Workflow Tips
- Always test in preview before going live
- Use instant switch for rhythmic changes
- Use crossfade for melodic/ambient transitions
- Stop preview when not needed to save resources

### Live Performance
- Set up devices before the show
- Test both outputs before starting
- Keep preview volume lower than live
- Practice transitions during soundcheck

## Error Messages

### "Preview stream is not active"
- Start playback in preview mode first
- Press Ctrl+Enter to evaluate code

### "Device selection failed"
- Device may be in use by another app
- Try selecting a different device
- Check browser audio permissions

### "Polyphony limit exceeded"
- Simplify your patterns
- Stop preview when not needed
- Reduce number of simultaneous voices

### "Transition already in progress"
- Wait for current transition to complete
- Transitions take 2 seconds for crossfade

## Advanced Features

### Configuration Persistence
- Device selections saved automatically
- Restored on next session
- Stored in browser localStorage

### Resource Monitoring
- Automatic polyphony tracking
- Warnings at 90% capacity
- Preview quality reduced if limit exceeded

### Error Recovery
- Graceful fallback to default device
- Preview failures don't affect live
- Automatic error notifications

## Examples

### Example 1: Basic DJ Workflow
```javascript
// Start with a simple pattern live
sound("bd sd").fast(2)

// Switch to preview (Ctrl+Shift+M)
// Try a variation
sound("bd sd hh cp").fast(2)

// Like it? Crossfade to live (Ctrl+Shift+X)
```

### Example 2: Building Layers
```javascript
// Live: Keep the beat going
sound("bd sd").fast(2)

// Preview: Add melody
stack(
  sound("bd sd").fast(2),
  note("c3 eb3 g3").s("sawtooth")
)

// Transition when ready
```

### Example 3: Testing Effects
```javascript
// Live: Clean sound
sound("bd sd hh cp").fast(2)

// Preview: Test with reverb
sound("bd sd hh cp").fast(2).room(0.8).size(0.9)

// Compare before transitioning
```

## FAQ

**Q: Can I use the mixer without multiple audio devices?**
A: Yes, but you'll hear both streams on the same output. The workflow still helps you test before committing changes.

**Q: Does the mixer work on mobile?**
A: Device selection requires desktop browser with Web Audio API support. Basic functionality works on mobile.

**Q: Can I customize keyboard shortcuts?**
A: Not yet, but it's planned for a future update.

**Q: What happens if I close the browser?**
A: Device preferences are saved and restored automatically.

**Q: Can I use this with MIDI controllers?**
A: Yes, MIDI works independently of the mixer.

## Support

For issues or questions:
- Discord: #strudel channel on TidalCycles server
- Forum: TidalCycles club forum
- Repository: Codeberg/GitHub issues

## License

AGPL-3.0-or-later - See LICENSE file for details
