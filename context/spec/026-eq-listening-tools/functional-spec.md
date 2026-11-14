# Functional Specification: EQ Listening Tools

- **Roadmap Item:** Not on the roadmap. It follows specs [020](../020-eq-strong-control/), [021](../021-eq-genre-presets-transparency/) and [024](../024-track-eq-profile/). On 2026-11-14 the owner asked for all the improvement suggestions (in Russian: "go do all please"). No GitHub issue.
- **Status:** Approved
- **Author:** Claude (for the owner)

---

## 1. Overview and Rationale (The "Why")

The EQ is now strong: ±24 dB, cuts, a limiter and 81 presets. Judging what it does is still hard:
- **Comparing two settings** means re-entering them by hand. The On/Off switch compares against no EQ at all, not against another setting.
- **You can't see the music.** The panel draws the EQ curve but not the sound it is shaping, so it is guesswork where the kick or the harshness sits.
- **Recordings never include the EQ.** Spec 008 chose this on purpose: a recording is the track. Sometimes the owner wants a file that sounds like what they heard.
- **Four listening profiles are louder than Flat**: Acoustic +3.24, Bass Boost +3.71, Piano +3.47 and R&B +3.62 dB. Louder sounds "better", so comparing them with other presets is biased. Spec 021 had to narrow its criterion because of this.

Spec 026 does not change the MIDI latency. A proposal to add the EQ's 6 ms look-ahead only while the EQ is on was dropped. The EQ insert, and its 6 ms delay, sits on the speaker path whether the EQ is on or off (`mainEqualizer.ts`, spec 020), so the fixed 40 ms default is already right in both states.

---

## 2. Functional Requirements (The "What")

### 2.1 A/B slots

- The EQ panel gets two slots, **A** and **B**. The current settings are always one of them. Pressing the other slot letter switches the whole EQ to that slot: bands, cuts, output, bypass and the preset name.
- Each slot keeps its own changes, and both are remembered on this device.
- At first B is a copy of A. A **Copy A→B** action (or B→A, depending on which slot is active) copies the active slot into the other one.
- The switch is smooth, using the existing glide, with no click.
- A/B applies to both EQ instances, the speakers and the headphone preview, because the panel drives both, as today.
  - **Acceptance Criteria:**
    - [ ] Given A is Flat and B is Phonk, when the user switches A→B→A, then the EQ follows each time, with no click, and the panel shows the active slot's settings and preset name.
    - [ ] When the user edits a band while B is active and then switches to A, then A is unchanged; switching back to B shows the edit.
    - [ ] When the user reloads the page, then both slots and the active one are as they were left.
    - [ ] Saved settings from before spec 026 load into slot A, and B starts as a copy.
    - [ ] Given a spec 024 recommendation, when the user presses Apply, then the recommendation goes into the active slot only.

### 2.2 Spectrum analyzer

- Behind the EQ curve, the panel draws the live spectrum of what the speakers play, after the EQ. It is smoothed, uses the same frequency axis as the curve, and is drawn quieter than the curve.
- A **Spectrum** toggle shows or hides it. It is on by default and remembered.
- It draws only while the panel is visible and music is playing, so it costs nothing otherwise. It has no audible effect.
  - **Acceptance Criteria:**
    - [ ] Given music is playing and the spectrum is on, when the user opens the EQ panel, then a spectrum moves behind the curve. A low-cut at 200 Hz visibly removes the area below 200 Hz.
    - [ ] When playback stops, then the spectrum falls to silence and the drawing stops (no animation frames while stopped).
    - [ ] When the user turns Spectrum off, then nothing is drawn and the analysis is disconnected.
    - [ ] Turning the spectrum on or off changes nothing in the sound (measured: no change to the output samples).

### 2.3 Record as heard

- The recording controls get a **Record as heard (with EQ)** option. It is off by default, which keeps spec 008's behaviour.
- When it is on, audio recordings and screen recordings take the sound after the EQ and its limiter, exactly what the speakers play.
- The option is remembered. Changing it during a recording applies to the next recording.
  - **Acceptance Criteria:**
    - [ ] Given the option is off, a recording is identical to today's: before the EQ.
    - [ ] Given the option is on and a +12 dB bass boost, when the user records, then the file has the boosted bass. The sound handed to the recorder peaks under 0 dBFS because of the limiter. The lossy encoder (WebM/Opus) may overshoot by a fraction of a dB in the file (measured +0.15 dBFS), as any lossy codec can.
    - [ ] Given the option is on, when the user records a screen capture, then its audio is after the EQ too.
    - [ ] Given the option is on but the main EQ is not installed yet (audio not started), the recording falls back to the pre-EQ tap and doesn't fail.

### 2.4 Profiles loudness-matched

- The four listening profiles that are more than 3 dB louder than Flat get a lower output level. Their character, the band shape, is unchanged, and they now play within 3 dB of Flat.
- Spec 021's acceptance criterion 2.1.4 is restored to its original scope: every preset, genre presets and profiles, plays within 3 dB of Flat.
  - **Acceptance Criteria:**
    - [ ] Every one of the 81 presets measures within ±3 dB of Flat with the existing pink-noise loudness helper.
    - [ ] The band gains and cuts of Acoustic, Bass Boost, Piano and R&B are unchanged; only their output level changes.
    - [ ] A user's saved settings that came from one of these profiles load exactly as saved, because saved settings store values, not the preset.

### 2.5 Languages

- New strings go into all 9 languages: A, B, the copy action, Spectrum, Record as heard, and the hints.
  - **Acceptance Criteria:**
    - [ ] In each of the 9 languages, the new controls show in that language.

**Unsaved work, logged out, admin:** these are device settings, which touch no code and no saved track. They work the same logged in or out. The admin read-only view is unaffected. Recordings are local files, as today.

---

## 3. Scope and Boundaries

### In-Scope
- A/B slots, the spectrum analyzer (main, after the EQ), the Record-as-heard option, the profile output-level match, and the spec 021 criterion restored.

### Out-of-Scope
- More than two slots, or named user presets.
- A spectrum of the headphone preview or of the input before the EQ.
- Changing the MIDI latency (dropped; see §1).
- Recording the headphone preview.

---

## Change Log

- 2026-11-14 — implementation (026). AC 2.3.2 now separates the recorder's input, which the limiter keeps under 0 dBFS (measured peak 0.9989), from the encoded file, where Opus overshoots slightly (measured +0.15 dBFS). The limiter is left unchanged for recordings.
- 2026-11-14 — implementation (026). The A/B, Spectrum and Record-as-heard controls live in a shared `EqualizerListeningControls` component, used by both the desktop and the compact panel. Record as heard sits in the EQ panel because the app has no recording-options panel.
