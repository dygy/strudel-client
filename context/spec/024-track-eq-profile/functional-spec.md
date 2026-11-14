# Functional Specification: A Track Recommends Its Listening EQ

- **Roadmap Item:** Not on the roadmap. Requested by the owner on 2026-11-13 (in Russian): "track generation submits to Strudel the content profile, so we know how best to play the track". The owner chose "suggestion + Apply". No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner)

---

## 1. Overview and Rationale (The "Why")

MIDI-grep (the owner's other project) generates Strudel tracks from real recordings and measures, band by band, how the render differs from the original. It can tell how a track is best listened to: for example "the render is 4 dB light in the sub". Today there is nowhere to put that knowledge, so the owner has to guess an EQ preset for every generated track.

A track's code may now carry one listening-EQ recommendation as a comment line. Strudel shows it in the EQ panel as a suggestion with an **Apply** button. Because it is a comment, the music itself never changes, and upstream Strudel ignores it.

**Success looks like:**
- The owner plays a generated track, opens the EQ and sees what the track recommends and why, in plain words.
- One press of Apply sets the EQ to the recommendation, smoothly and saved like any other EQ change.
- Nothing changes on its own: the owner's EQ stays as it is until they press Apply.

---

## 2. Functional Requirements (The "What")

### 2.1 The recommendation line

- A track's code may contain a line of this shape (one line, a line comment at the start of the line):
  ```
  // @eq-profile {"v":1,"preset":"automotivo","bands":[{"frequency":31,"gain":3.1}, … 10 bands],"lowCut":null,"highCut":{"enabled":true,"frequency":14000},"outputGain":0,"basis":"instrumental vs render","why":"render is 4 dB light in the sub versus the original"}
  ```
- Only the first such line counts. The recommendation may name a preset, give the 10 bands, or both.
- A line that cannot be read (broken JSON, an unknown version, a value out of the EQ's range, missing bands with no known preset) is ignored. The browser console gets one warning saying why; the REPL shows no error and the music is unaffected.
  - **Acceptance Criteria:**
    - [ ] Given code with a valid `// @eq-profile` line, when it is evaluated, then the EQ panel shows the recommendation.
    - [ ] Given code whose `// @eq-profile` line has broken JSON, an unknown `v`, or a band gain of +30 dB, when it is evaluated, then the music plays, no error is shown in the REPL, no recommendation is shown, and the console has a warning naming the problem.
    - [ ] Given code with two `// @eq-profile` lines, when it is evaluated, then only the first one is used.

### 2.2 "Track recommends" in the EQ panel

- The EQ panel (desktop and phone layouts) shows a **Track recommends** block when the code that is **playing** has a recommendation:
  - the preset name, when the recommendation names a known preset;
  - what the recommended settings do, in the same plain words as the description under the preset picker (spec 021);
  - the recommendation's `why` sentence, as written in the code;
  - an **Apply** button.
- The block follows what is playing on the speakers, not the editor while it is being edited: it changes when new code is evaluated (Play, Update, Ctrl+Enter, a track switch of any type) and disappears when playback stops or the playing code has no recommendation.
- The user's EQ does not change by itself when a track with a recommendation starts.
- When the EQ already matches the recommendation and is on, the button reads **Applied** and is disabled.
  - **Acceptance Criteria:**
    - [ ] Given a track with a recommendation is playing, when the user opens the EQ panel on desktop, then they see "Track recommends", the preset name, the description, the why sentence and Apply.
    - [ ] Given the same, when the user opens the EQ on a phone, then the same block is shown.
    - [ ] Given a track with a recommendation starts playing, then the user's EQ settings and the preset picker are unchanged.
    - [ ] Given the user edits the recommendation line in the editor without evaluating, then the block still shows what is playing.
    - [ ] When playback stops, or code without a recommendation is evaluated, then the block disappears.

### 2.3 Apply

- Apply sets the recommended bands, low cut, high cut and output level. A recommendation without bands applies its preset, exactly as picking that preset in the picker does.
- The preset picker then shows the preset when the settings equal one (the named one first), otherwise Custom.
- If the EQ is off, Apply turns it on. The block says so before the press.
- The change is smooth (the same glides as any EQ change, no click), reaches both the speakers' and the headphones' EQ, and is saved like any other EQ change, so it survives a reload.
  - **Acceptance Criteria:**
    - [ ] Given a recommendation with 10 bands that equal Automotivo, when the user presses Apply, then the bands, cuts and output change to those values, the picker shows Automotivo, and after a reload the same settings load.
    - [ ] Given a recommendation with bands that equal no preset, when the user presses Apply, then the picker shows Custom.
    - [ ] Given a recommendation with only a preset, when the user presses Apply, then the result is the same as picking that preset.
    - [ ] Given the EQ is off, when the user presses Apply, then the EQ is on with the recommended settings, and nothing of the recommendation was heard while it was off.
    - [ ] After Apply, the button reads Applied; when the user then moves a band, it reads Apply again.

### 2.4 Languages, signed-out users and the admin view

- The block's own words (title, Apply, Applied, the "turns the EQ on" note, the preset line) exist in all 9 languages. The `why` sentence is shown as written in the code.
- Signed-out users, the admin read-only view and `/embed` behave the same as the EQ does today: the block appears wherever the EQ panel is shown.
  - **Acceptance Criteria:**
    - [ ] When the user switches the app language, then the block's words appear in that language.

### 2.5 What the user hears, and unsaved work

- Evaluating code with a recommendation changes nothing audible. Apply changes the EQ with the existing glides.
- The recommendation is part of the track's code, so it is saved with the track like any other line; nothing else about saving changes.

---

## 3. Scope and Boundaries

### In-Scope

- Reading the first `// @eq-profile` line of the playing code, validating it, and showing it in the EQ panel (desktop and phone) with Apply.
- The new words in 9 languages.
- The exact reading rules, written down for the producer (MIDI-grep) in the technical spec §2.1.

### Out-of-Scope

- Applying the recommendation automatically.
- The MCP server (spec 018) reporting the recommendation from `get_track` / `check_code`: left out, see the technical spec §3.
- Writing the line: MIDI-grep's job, in its own repo.
- Translating the `why` sentence.
- Any change to the EQ's sound processing, presets or saved-settings format.
