# Technical Specification: Performance Mode

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Claude (for the owner)

---

## 1. High-Level Technical Approach

The performance view is a **layout state** of the existing REPL, not a new page or a second editor:
- One small nanostore holds `open` (not persisted).
- `ReplEditor` puts `data-performance="true"` on its root while it is open, renders a `PerformanceStrip` above the editor slot, and **hides** (CSS `hidden`), never unmounts, the header, sidebar/drawer, panels and compact bar.
  - Unmounting is what zen mode does. It would tear down panel-owned state (EQ panel spectrum tap, scratch panel, the mixer UI) and break §2.1's "nothing about the music changes".
  - The `Code` slot never moves in the tree, so CodeMirror (text, cursor, undo history) is the same instance (spec 016's rule).
- The code's size in the view is a CSS override on the editor root, `font-size: var(--perf-font-size)`, under `[data-performance="true"]`. It does not touch the `fontSize` setting (codemirror.mjs:363 sets `root.style.fontSize` inline, so the override needs `!important` or the strip sets the inline size and restores the setting on exit; see §2.2).
- The clocks are a module-level store fed by the main REPL's `started` and `trackIds().playing`. They count from page load whether or not the view is open.
- The level meter is an `AnalyserNode` pair on the main EQ's output tap (`getMainEqualizerOutputTap()`, the same node Record as heard uses, without the −1 dB trim). It falls back to superdough's `destinationGain` before the EQ is installed. It exists only while the view is open.
- The close-tab guard is one `beforeunload` listener installed with the REPL. It cancels the event only while the main scheduler is started.

Two areas: **web** (store, strip, layout, shortcut, clocks, guard, font size, i18n) and **audio** (the meter's tap, its level maths, its teardown).

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 State: `website/src/repl/performance/performanceStore.ts` (web, new)

- `performanceOpen = atom<boolean>(false)`; `openPerformance()`, `closePerformance()`, `togglePerformance()`.
- `performanceFontSize`: `persistentAtom('strudel-performance-font-size', '28')`, read through `readPerformanceFontSize()`, which clamps to 16–64 and snaps to steps of 4. Junk, a missing value or storage that throws read as 28. `stepPerformanceFontSize(+1 | -1)`.
- **Browser full screen** (`performanceFullscreen.ts`):
  - On open: `document.documentElement.requestFullscreen?.()`. Swallow a rejection or a missing API (iOS, iframes): the view stays as a window-filling layout. Remember whether *we* entered.
  - On close: if we entered and `document.fullscreenElement` is set, `document.exitFullscreen()`.
  - `fullscreenchange` to no fullscreen element while open, after we entered: `closePerformance()` (§2.1, "leaving the browser's full screen").

### 2.2 Layout: `website/src/repl/components/ReplEditor.tsx` (web)

- `const perf = useStore(performanceOpen)`. On the root: `data-performance={perf ? 'true' : undefined}`.
- Wrap or class the Header, `TrackConflictNotice`, sidebar slot, drawer, vertical/horizontal panel and `CompactControlBar` so that `perf` adds `hidden`. **No conditional rendering on `perf`.**
- `{perf && <PerformanceStrip context={context} trackName={currentTrackName(fileManagerHook)} />}` goes right after the Header (the strip mounts and unmounts; it owns only the meter, the clock display and buttons).
- `UserFacingErrorMessage` stays visible.
- Font size: in `website/src/styles` (or a co-located CSS module imported by the strip), `[data-performance='true'] .cm-editor { font-size: var(--perf-font-size) !important; }`, with `--perf-font-size` set on the root from the store. If the inline `root.style.fontSize` from codemirror.mjs wins anyway, set it through `editorRef.current.setFontSize()` on open and restore `settings.fontSize` on close; the test in §4 fixes whichever is used.

### 2.3 The strip: `website/src/repl/components/performance/PerformanceStrip.tsx` (web, new)

- Logical classes only (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`) so RTL mirrors. `flex flex-wrap` so a 375 px window wraps without horizontal scroll.
- Controls, in order:
  - Play/Stop (`context.handleTogglePlay`) and Update (`context.handleEvaluate`), with the header's existing labels and icons (reuse the Header's button components where they are exported, otherwise the same heroicons and i18n keys).
  - Now/Next: from `useSetPlayerContext()` with `itemTextById` (as `SetBar`). When a set is playing, the Cue/Go button reuses `SetBar`'s action (`ctx.press()` or whatever `SetBar` calls; extract a shared hook if needed rather than duplicating). Without a set: Now is `trackName`.
  - `PerformanceClocks` (§2.5) and `LevelMeter` (§2.6).
  - A− / A+ (`stepPerformanceFontSize`), disabled at the bounds.
  - Exit (`closePerformance`).
- Entry points:
  - A **Perform** button in `Header.tsx`, next to the scratch/set controls, hidden in compact (as its siblings).
  - A **Perform** item in `compact/CompactMoreMenu.tsx`.

### 2.4 The key: `website/src/repl/performance/performanceShortcut.ts` (web, new)

- Modelled on `sets/setShortcut.ts`: `isPerformanceKey(e)` is `e.code === 'KeyP' && altKey && shiftKey && !ctrlKey && !metaKey`.
- Capture-phase `keydown` on `document`, with `preventDefault` + `stopPropagation`, ignoring `repeat`. It works inside the editor and types nothing.
- Installed once from `ReplEditor` (an effect with an empty dependency array). Never inert: the view is available signed out and in the admin read-only view.

### 2.5 Clocks: `website/src/repl/performance/performanceClock.ts` (web, new)

- Pure reducer plus a thin ticker, so the maths is testable with injected `now()`:
  - `ClockState = { setMs, trackMs, runningSince: number | null, trackId: string | null }`.
  - `clockTick(state, { now, started, playingTrackId })`:
    - While `started`, the time since `runningSince` accrues to both `setMs` and `trackMs`.
    - A change of `playingTrackId` while started resets `trackMs` to 0 (a hot swap keeps the same id, so it doesn't).
    - `started` turning false freezes both; turning true resumes.
  - `clockResetSet(state, now)` zeroes `setMs` only.
  - `formatClock(ms)` gives `m:ss`, or `h:mm:ss` from 3 600 000 ms.
- `installPerformanceClock({ isStarted, playingTrackId })`: one `setInterval` at 250 ms, started from `ReplEditor` with `() => Boolean(context.started)` and `() => context.trackIds?.().playing ?? null`. Exposes `clockStore` (a nanostore atom) for the display. Cleared on unmount.
- `PerformanceClocks.tsx`: shows `formatClock(setMs)` / `formatClock(trackMs)`. Clicking set time opens a one-item popover with **Reset**.
- `trackIds().playing` changes only when a switch to a different track takes effect (useReplContext.tsx:1109, `trackSwitch.playingTrackId`). Confirm this in the implementation; if it changes at Update press rather than at the transition start, reset on the transition start event instead.

### 2.6 Level meter: `website/src/repl/performance/levelMeter.ts` (audio, new) + `LevelMeter.tsx` (web, new)

- **Tap** (`openLevelMeter(audioContext, source)`):
  - `source = getMainEqualizerOutputTap() ?? getSuperdoughAudioController().output.destinationGain`. Null before audio starts: the meter shows silence and retries via `subscribeMainEqualizer` or on the next open.
  - `ChannelSplitterNode(2)`, then two `AnalyserNode`s (`fftSize` 2048, `smoothingTimeConstant` 0). The source fans out into the splitter; **nothing connects onward to any destination**, so it is inaudible.
  - `read()` returns `{ peakDb: [l, r], rmsDb: [l, r], over: boolean }` from `getFloatTimeDomainData`. `over` means any |sample| ≥ 10^(−0.3/20) ≈ 0.966.
  - `close()` disconnects source→splitter and splitter→analysers. It is idempotent.
  - If the main EQ is re-created (subscribeMainEqualizer fires) while open, re-point to the new tap.
- **Ballistics** (pure, `levelMeter.ts`):
  - `meterBallistics(prev, reading, dtMs)`: the peak marker holds 1500 ms, then falls 20 dB/s; the clip latch holds 2000 ms after the last `over`.
  - The floor is −60 dB, and silence reads `-Infinity`, drawn as an empty bar.
- **Display** (`LevelMeter.tsx`, web): opens the tap on mount and closes it on unmount. A `requestAnimationFrame` loop calls `read()` + `meterBallistics` and draws two bars. The top 1 dB is red. It also draws the clip light.
  - The loop pauses while `document.hidden`; rAF already throttles, but also skip `read()`.
  - `role="meter"` with `aria-valuenow` (the louder channel's peak dB), `aria-label` = Level.

### 2.7 Close-tab guard: `website/src/repl/performance/closeGuard.ts` (web, new)

- `installCloseGuard(isPlaying: () => boolean, win = window)`: a `beforeunload` listener that, when `isPlaying()`, calls `event.preventDefault()` and sets `event.returnValue = ''` (the legacy requirement). Returns the uninstaller.
- Installed once from `ReplEditor` with `() => Boolean(context.editorRef.current?.repl?.scheduler?.started)`. That is the main scheduler only; the preview engine is a separate scheduler and isn't consulted.
- It is a separate listener from the canvas cleanup and the emergency save (useReplContext.tsx:706, useEmergencySave), which keep running as before. `beforeunload` listeners all run; cancelling it doesn't stop the others.

### 2.8 i18n (web)

Ten keys in `website/src/i18n/locales/*/settings.json` (or the namespace the Header uses), in all 9 locales, plus `website/src/i18n/types.ts`:
- `performMode`, `performModeDescription`, `performExit`
- `performSetTime`, `performTrackTime`, `performResetClock`
- `performLevel`, `performClip`
- `performBiggerCode`, `performSmallerCode`

---

## 3. Impact and Risk Analysis

- **Data:** none. No Supabase table, column, RLS policy or migration. The only new persisted value is `strudel-performance-font-size` in localStorage.
- **Runtime:** everything runs in the browser. No new SSR page, API route, env var or secret. The worker size is unaffected beyond the client bundle (the strip ships in the REPL island).
- **Audio graph:** the meter's tap only, while the view is open.
  - It adds 1 `ChannelSplitterNode` and 2 `AnalyserNode`s as a fan-out from the EQ output (or destinationGain), and adds no edge to any destination.
  - All are disconnected on close.
  - It has no gain node and no ramp, because it never feeds the speakers.
  - The preview engine (its own `AudioContext`) is untouched, so preview audio never reaches the meter.
- **Upstream impact:** none. Nothing in `@strudel/*` changes. `superdough`'s `destinationGain` and `getSuperdoughAudioController` are read, not modified.
- **Risks:**
  - **Hiding vs. unmounting.** Zen mode unmounts; this must not. A test asserts that the panel and sidebar stay mounted (in the DOM, `hidden`) while the view is open.
  - **Fullscreen and Esc.** In browser full screen, Esc is consumed by the browser, which fires `fullscreenchange`; the view closes then. Outside full screen, Esc is left to the editor (autocomplete close); the spec does not make Esc a leave key there.
  - **`beforeunload` in tests and in sign-out.** A sign-out that navigates while music plays will show the prompt. That is intended (§2.5): the user is playing.
  - **Font override vs. inline style.** See §2.2; the test pins the effective size.

---

## 4. Testing Strategy

- **Unit (vitest, jsdom):**
  - `performanceStore`: toggle; font size clamp/snap/junk/throwing storage.
  - `performanceShortcut`: Alt+Shift+P matched by code, repeat ignored, Ctrl/Cmd variants ignored, the event stopped (nothing typed).
  - `performanceFullscreen`: request rejected → still open; `fullscreenchange` after we entered closes; close exits only if we entered.
  - `performanceClock`: AC 2.3 rows with an injected clock (90 s, stop/resume to 6:00, track switch resets track only, same id keeps it, reset, h:mm:ss).
  - `levelMeter`: with `packages/mixer/test/webAudioMock.mjs` or a local fake — a −6 dBFS sine reads −6 ± 1; ≥ −0.3 dBFS sets `over`, −1 dBFS doesn't; latch 2 s, peak hold 1.5 s; `close()` disconnects everything and is idempotent; nothing is connected to `destination`.
  - `closeGuard`: playing → cancelled + returnValue; stopped → not; uninstall removes it.
- **Component (RTL):**
  - `ReplEditor`/strip: open hides but keeps mounted (header, panel, sidebar present with `hidden`); the editor node is the same element before and after; the strip shows Now/Next/Cue-Go with a set, and Now = track name without one; A+/A− bounds; Exit closes.
  - Header Perform button and the compact More item open it.
- **Browser (Playwright, `/awos:verify`):**
  - Enter/leave 10× while playing: scheduler `started` stays true, node count stable.
  - The meter reads on a playing track and reads silence with only preview.
  - The beforeunload handler is checked by dispatching a cancellable event.
  - 375 px and an RTL locale screenshots.
