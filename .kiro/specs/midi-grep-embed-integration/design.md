# Design Document

## Overview

The MIDI-grep embed integration enables automated Strudel audio recording through the `/embed` endpoint. This design documents the existing implementation and the integration points used by MIDI-grep's Puppeteer-based recording system.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MIDI-grep CLI                            │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ Audio Input  │───▶│ Strudel Gen  │───▶│ BlackHole Record │   │
│  │ (YouTube/WAV)│    │ (Go + Python)│    │ (Node.js)        │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                                                 │                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Puppeteer Browser                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                strudel.dygy.app/embed                     │   │
│  │                                                           │   │
│  │  ┌─────────────┐   ┌─────────────┐   ┌────────────────┐  │   │
│  │  │ CodeMirror  │──▶│  Strudel    │──▶│ AudioContext   │  │   │
│  │  │  (dispatch) │   │  (superdough)│   │ (setSinkId)    │  │   │
│  │  └─────────────┘   └─────────────┘   └────────────────┘  │   │
│  │                                              │            │   │
│  └──────────────────────────────────────────────┼────────────┘   │
│                                                 │                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BlackHole Virtual Device                      │
│                           │                                      │
│                           ▼                                      │
│                    ffmpeg Recording                              │
│                           │                                      │
│                           ▼                                      │
│                    render.wav Output                             │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Embed Page (`/embed.astro`)

The embed page renders a minimal REPL without authentication:

```astro
<Repl client:only="react" embedded />
```

Key characteristics:
- No header navigation
- No sidebar/file browser
- No authentication checks
- Full audio synthesis capabilities

### 2. CodeMirror Integration

The editor exposes its internal view for programmatic access:

```javascript
const cmContent = document.querySelector('.cm-content');
const view = cmContent.cmView.view;

// Replace all content
view.dispatch({
  changes: { from: 0, to: view.state.doc.length, insert: code }
});
```

### 3. Audio Routing

Strudel exposes a global `getAudioContext()` function:

```javascript
// After clicking play (superdough initialized)
const ctx = window.getAudioContext();
await ctx.setSinkId(blackholeDeviceId);
```

### 4. Device Enumeration

BlackHole device discovery:

```javascript
// Request permission first
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
stream.getTracks().forEach(track => track.stop());

// Enumerate devices
const devices = await navigator.mediaDevices.enumerateDevices();
const blackhole = devices.find(d =>
  d.kind === 'audiooutput' && d.label.includes('BlackHole')
);
```

## Puppeteer Script Flow

The `record-strudel-blackhole.ts` script implements this flow:

1. **Start ffmpeg** recording from BlackHole device
2. **Launch browser** with required flags:
   - `--autoplay-policy=no-user-gesture-required`
   - `--use-fake-ui-for-media-stream`
   - `--disable-background-timer-throttling`
   - `--window-position=-32000,-32000` (hidden)
3. **Grant permissions** via `context.overridePermissions()`
4. **Navigate** to embed endpoint
5. **Request mic** to enable device enumeration
6. **Find BlackHole** device ID
7. **Insert code** via CodeMirror dispatch
8. **Click play** button
9. **Route audio** via `setSinkId()` (AFTER play)
10. **Wait** for playback (AudioContext.state === 'running')
11. **Record** for specified duration
12. **Stop** and close browser

## Error Handling

### Playback Detection

The script detects playback via two methods:
1. **Stop button** appears (strudel.cc main site)
2. **AudioContext.state** === 'running' (embed mode)

```javascript
isPlaying = await page.evaluate(() => {
  // Check for stop button
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent?.toLowerCase().includes('stop')) return true;
  }
  // Check AudioContext state
  const ctx = window.getAudioContext?.();
  return ctx && ctx.state === 'running';
});
```

### Sample Loading

The script waits for samples to load before recording:
- Console messages indicate loading: `[sampler] load sound "..."`
- 2-second buffer after playback starts

## Security Considerations

The embed endpoint is intentionally unauthenticated to support automation. This is acceptable because:
1. It's read-only (no data modification)
2. It's rate-limited by browser resource usage
3. It's self-hosted (no impact on public infrastructure)
