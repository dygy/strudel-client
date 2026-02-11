# Implementation Tasks

## Status: Complete

All tasks for the MIDI-grep embed integration have been completed.

## Completed Tasks

### Task 1: Embed Page
- [x] Create `/embed.astro` page with minimal REPL
- [x] Pass `embedded=true` prop to Repl component
- [x] Disable authentication requirements for embed
- [x] Ensure full audio synthesis capabilities work

### Task 2: CodeMirror Access
- [x] Verify `.cm-content` element exposes `cmView.view`
- [x] Test `view.dispatch()` for programmatic code insertion
- [x] Document the correct API usage

### Task 3: Audio Context Access
- [x] Verify `getAudioContext()` is exposed globally
- [x] Test `setSinkId()` for device routing
- [x] Document timing requirements (after play click)

### Task 4: Sample Loading
- [x] Verify GM samples load without authentication
- [x] Verify drum machine samples load without authentication
- [x] Test sample caching behavior

### Task 5: Background Operation
- [x] Test with offscreen window position
- [x] Verify audio doesn't throttle in background
- [x] Document required Chrome flags

## Integration Testing

Tested with:
- macOS Sonoma 15.2
- Chrome/Chromium via Puppeteer
- BlackHole 2ch virtual audio device
- ffmpeg for recording

Test track: Regime CLT (Dj Brunin XM, Aurora Shukita)
Result: Successful audio recording with 100% accuracy

## Usage

After deployment to `strudel.dygy.app`, MIDI-grep will use:

```bash
node dist/record-strudel-blackhole.js input.strudel -o output.wav -d 30
```

The `--local` flag (for localhost:4321) will be deprecated once deployed.

## Future Improvements

1. **WebSocket API**: Direct code injection without DOM manipulation
2. **Headless Mode**: True headless with virtual audio (requires Chrome Audio Capture)
3. **Batch Processing**: Multiple recordings without browser restart
