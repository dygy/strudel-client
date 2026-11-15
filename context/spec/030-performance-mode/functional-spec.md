# Functional Specification: Performance Mode

- **Roadmap Item:** Phase 6 — Live sets: "Performance mode: full-screen view with large code, now and next, set timer, levels; guard against closing the tab." No GitHub issue.
- **Status:** Draft
- **Author:** Claude (for the owner). The owner chose these on 2026-11-15: enter with a header button **and** a key; the code stays **editable** in the view, which also shows Now/Next, a set timer and levels; the close-tab guard is on **whenever music plays**, in any view.

---

## 1. Overview and Rationale (The "Why")

During a live set the REPL shows everything at once: the header, the sidebar library, the settings panel, small code. On a projector or a laptop on a booth, the code is hard to read, and nothing shows at a glance:
- what is playing and what comes next;
- how long the set has run;
- whether the output is close to clipping.

Worse, one stray Cmd+W or a click on a bookmark kills the music in the middle of a set.

**Desired outcome:** one key turns the REPL into a stage view: the code large and editable, a strip with Now/Next, Cue/Go, Play/Update, the set and track clocks and a master level meter, and nothing else. Closing or leaving the tab while music plays asks first.

**Success looks like:**
- Alt+Shift+P goes in and out of the view in the middle of a track with no audible change, and the editor keeps its text, cursor and undo history.
- The set clock shows the time since Play, across any number of track switches.
- Cmd+W while music plays shows the browser's "Leave site?" prompt; with the music stopped, it closes without asking.

---

## 2. Functional Requirements (The "What")

### 2.1 Entering and leaving

- **Enter:** a **Perform** button in the header (desktop), an item in the compact More menu (compact layout), or **Alt+Shift+P** anywhere in the REPL, the code editor included. The key is matched by the physical key (on macOS Option+Shift+P types "∏"), and no character reaches the editor.
- **Leave:** Alt+Shift+P again, the **Exit** button in the strip, or leaving the browser's full screen (e.g. Esc).
- **Browser full screen.** Entering asks the browser for full screen. If the browser refuses (an embed, a denied permission, iOS Safari), the view still fills the whole window. Leaving the view also leaves the browser's full screen if the view entered it.
- **Nothing about the music changes.** Entering or leaving never stops, restarts or re-evaluates the pattern, and it never touches the audio graph except the level meter's passive tap (§2.4).
- **The editor is the same editor.** Its text, cursor, selection, undo history, unsaved changes and autosave are untouched. Nothing is saved or discarded by entering or leaving.
- **Not remembered across reloads.** After a reload the REPL opens in its normal view.
- **Acceptance Criteria:**
  - [ ] Given the normal view, when the user presses Alt+Shift+P with the focus in the editor, then the performance view opens and the editor text is unchanged (no "∏" or "P" typed).
  - [ ] Given the performance view, when the user presses Alt+Shift+P, clicks Exit, or the browser leaves full screen, then the normal view comes back.
  - [ ] Given the header, the Perform button opens the view; in the compact layout the More menu has a Perform item that does the same.
  - [ ] Given the browser refuses full screen, when the user enters, then the view still covers the window and no error reaches the user.
  - [ ] Given a pattern playing, when the user enters and leaves the view 10 times, then the scheduler never stops, the pattern is not re-evaluated, and no audio node is left behind (node count equal before and after).
  - [ ] Given unsaved edits and undo history, when the user enters, edits, and leaves, then the edits are there and Undo walks back through edits made before and during the view.
  - [ ] Given the view is open, when the page reloads, then it opens in the normal view.

### 2.2 Layout

- **Hidden:** the header, the sidebar library, the settings panel, the compact bars.
- **The strip** (one row at the top; wraps to two rows on narrow screens):
  - **Play/Stop** and **Update**, doing what the header buttons do.
  - **Now / Next** when a set is playing (spec 022): the same texts as the set bar, with the **Cue/Go** button (Alt+Shift+N keeps working). Without a set: **Now** shows the open track's name, and there is no Next or Cue/Go.
  - **Clocks** (§2.3), **level meter** (§2.4).
  - **A− / A+**: the code's font size in this view, from 16 to 64 px in steps of 4, default 28 px, remembered across reloads. The normal view's font size is not changed.
  - **Exit**.
- **The editor** fills the rest of the screen at the view's font size. It stays editable (read-only only where it already is: the admin read-only view). Evaluation errors still show.
- **Acceptance Criteria:**
  - [ ] Given the view, then the header, sidebar, settings panel and compact bars are not visible, and the editor fills the space under the strip.
  - [ ] Given a set playing with a Next item, then the strip shows Now and Next with the same texts as the set bar, and the Cue/Go button does what the set bar's does.
  - [ ] Given no set playing, then the strip shows the open track's name as Now, and no Next or Cue/Go.
  - [ ] Given font size 28, when the user clicks A+ three times, then the code is 40 px; after a reload and re-entering it is still 40 px, and the normal view's font size is unchanged. It never goes below 16 or above 64.
  - [ ] Given the view, Play/Stop and Update behave exactly like the header's buttons.
  - [ ] Given the admin read-only view, the performance view opens and the editor stays read-only.
  - [ ] Given a 375 px wide window, the strip wraps without horizontal scrolling and every control stays reachable; in an RTL language the strip is mirrored.

### 2.3 Clocks

- **Set time:** the time the main output has played since the page loaded or since the user reset it. It keeps counting through track switches, transitions and hot swaps. Stop pauses it; Play resumes it. Clicking it offers **Reset** to zero.
- **Track time:** the time since the playing track started: since Play, or since a switch to a different track began its transition. A hot swap of the same track doesn't reset it. Stop pauses it, like set time.
- The clocks count whether or not the view is open, so opening it in the middle of a set shows the real elapsed time.
- Format `m:ss`, `h:mm:ss` from one hour.
- **Acceptance Criteria:**
  - [ ] Given the page loaded and Play pressed 90 s ago, then set time shows `1:30`.
  - [ ] Given 5 minutes of play, Stop for 1 minute, then Play for 1 more, then set time shows `6:00`.
  - [ ] Given a switch to another track 20 s ago, then track time shows `0:20` and set time is not reset; an Update of the same code doesn't reset track time.
  - [ ] Given set time `12:00`, when the user resets it, then it shows `0:00` and counts on while music plays.
  - [ ] Given 1 h 2 min 5 s of play, then set time shows `1:02:05`.

### 2.4 Level meter

- Two bars, left and right, of the **main output as heard on the speakers** (after the EQ, the same point "Record as heard" uses). It doesn't include the headphone preview.
- A peak marker holds for 1.5 s. The top 1 dB of the scale is red.
- A **clip light** latches for 2 s whenever the output reaches −0.3 dBFS (|sample| ≥ 0.966). That is the EQ limiter's ceiling (spec 020): the speakers never get more, so reaching it means the limiter is squashing the mix or, without the EQ, the output is clipping.
- The meter's tap exists only while the view is open: it is added on enter, removed on exit, and adds nothing audible. It stops drawing while the tab is hidden.
- **Acceptance Criteria:**
  - [ ] Given a sine at −6 dBFS on the main output, then both bars read −6 dB ± 1 dB.
  - [ ] Given a sample at or above −0.3 dBFS, then the clip light turns on and goes off 2 s after the last such sample; at −1 dBFS it stays off.
  - [ ] Given only the headphone preview playing, then the meter reads silence.
  - [ ] Given enter then exit, then the analyser node is disconnected and the audio graph has the same nodes as before entering.

### 2.5 Close-tab guard

- While the main output plays (in any view, not only the performance view), closing the tab, reloading or navigating away asks the browser's standard "Leave site?" question. The browser decides its wording; the app can't change it.
- While stopped, nothing asks. The headphone preview alone doesn't count as playing.
- Switching tracks, opening folders and other moves inside the app don't trigger it (they don't unload the page).
- The existing unload work (emergency save of unsaved edits) is unchanged and still runs if the user leaves anyway.
- **Answering "Stay" changes nothing.** The visuals keep drawing and a recording keeps recording. Work that tears things down (clearing the canvases, the recorders' emergency save) runs only when the page really goes (`pagehide`).
- **While recording,** closing also asks, even with the music stopped. If the user leaves anyway, the recording so far is downloaded as the recorder's raw WebM (best effort: the browser may drop a download started during unload). The previous emergency save waited for an asynchronous stop and a WAV conversion that a closing page never finishes, and its fallback already saved WebM data under a `.wav` name.
- **Acceptance Criteria:**
  - [ ] Given the main output playing, when the page is about to unload, then the `beforeunload` event is cancelled (the browser asks).
  - [ ] Given the main output stopped, when the page is about to unload, then the event is not cancelled.
  - [ ] Given only the preview playing, then the event is not cancelled.
  - [ ] Given unsaved edits and the user leaves anyway, then the emergency save still runs as before.
  - [ ] Given music playing with a scope drawing and a recording running, when `beforeunload` is cancelled ("Stay"), then the draw loop keeps running, the canvases are not cleared, and the recorder is not stopped and downloads nothing.
  - [ ] Given a recording running and the music stopped, when the page is about to unload, then the event is cancelled; on `pagehide` the chunks so far are downloaded as `.webm`.

### 2.6 Strings

New strings go into all 9 locales: Perform, Exit, Set time, Track time, Reset, Level, Clip, Bigger code, Smaller code, and the Perform item's description. Now/Next, Cue/Go, Play/Stop and Update reuse their existing strings.

---

## 3. Scope and Boundaries

### Behaviour notes (cross-cutting)

- **Unsaved work:** untouched; same editor, same save paths (§2.1).
- **What the user hears:** nothing changes on enter or leave (§2.1); the meter tap is passive (§2.4).
- **Logged out:** the view works on whatever the REPL shows; without sets there is no Next or Cue/Go.
- **Admin read-only view:** the view works; the editor stays read-only.
- **Locales:** all 9 get the new strings (§2.6).

### In-Scope

- The view, its strip, the key, the header button and compact menu item, the font size setting, the clocks, the level meter, and the close-tab guard.

### Out-of-Scope

- A second-screen or audience view (a separate window with only the code).
- LUFS loudness, a spectrum, or a before/after EQ analyser (roadmap: Loudness meter and analyser).
- MIDI mapping of the view's buttons (roadmap: MIDI mapping for everything).
- Writing a tracklist with timestamps (roadmap: Set recording with a tracklist).
- Hiding the code entirely, or a "lock" that disables editing.

---

## Change Log

- 2026-11-15 — Draft from the owner's choices.
- 2026-11-15 — Clip light at −0.3 dBFS (the EQ limiter's ceiling), not 0 dBFS.
- 2026-11-15 — Review #1 (accepted): "Stay" must not stop recordings or clear visuals; canvas cleanup and the recorders' emergency save moved to `pagehide`; recording also asks on close; emergency recording file is WebM. Review #3: the track-conflict notice stays visible in the view (§2.2 hidden list unchanged: it was never listed).
