# Functional Specification: Scratch Feel Controls

- **Roadmap Item:** Not on the roadmap. This follows spec [023](../023-vinyl-scratch-realism/). On 2026-11-14 the owner asked for all the improvement suggestions from the end of the 023 session (in Russian: "go do all please"). Two of those suggestions are about the scratch: let the owner tune the feel (brake, motor) instead of fixed constants, and let them choose how coarse the snap is. No GitHub issue.
- **Status:** Approved
- **Author:** Claude (for the owner)

---

## 1. Overview and Rationale (The "Why")

Spec 023 made the platter behave like a record, but every number is fixed:
- the brake takes 0.1 s;
- the motor spin-up takes 0.4 s;
- Snap rounds to one beat (a quarter cycle) or doesn't round at all.

Real decks expose these as controls. Technics turntables have start and brake knobs, and CDJs have "vinyl speed adjust: touch/brake, release/start". Different scratches want different settings. A baby scratch wants a fast brake. A slow "spin-back" wants a long release. A hip-hop drop wants to land on the bar, not the beat.

**Success looks like:** the owner sets the brake and the spin-up to taste, chooses a snap grid, and the setting is remembered.

---

## 2. Functional Requirements (The "What")

### 2.1 Snap grid

- The spec 023 "Snap to beat" switch becomes a **Snap** choice with four options: **Off**, **½ beat**, **Beat** (the default, the same as 023's "on") and **Bar** (one cycle, 4 beats).
- The amount the track moves after a release is rounded to the nearest multiple of the chosen step. It is not rounded when Off is chosen.
- Earlier saved settings carry over: 023's "on" becomes Beat, and "off" becomes Off.
  - **Acceptance Criteria:**
    - [ ] Given Snap is Bar, when the user lets go of a record that has fallen about 3.4 beats behind, then the track ends up exactly 1 bar (4 beats) behind. Given about 1.6 beats, the nearest bar is 0, so the motor catches up and the track doesn't move.
    - [ ] Given Snap is ½ beat, when the record has fallen about 1.3 beats behind, then the track ends up exactly 1.5 beats behind.
    - [ ] Given Snap is Beat, the behaviour is identical to spec 023's "on", and given Off, identical to 023's "off".
    - [ ] Given a stored 023 value of `false`, when the page loads, then Snap shows Off; given `true` or nothing stored, Beat.

### 2.2 Brake and spin-up controls

- The Scratch section gets two sliders:
  - **Brake** sets how long a grabbed record takes to stop. Range 0.02–1.0 s, default 0.1 s.
  - **Spin-up** sets how long the motor takes to bring a released record to speed. Range 0.1–2.0 s, default 0.4 s.
- A **Reset** button restores both defaults.
- The sound and the on-screen platter follow the chosen times together.
- With Snap on, the spin-up may stretch from half to double the chosen spin-up time to land on the grid, as 023 did around 0.4 s with 0.2–0.8 s.
- Changing a slider during a scratch applies from the next grab or release. A brake or spin-up already in progress is never cut short.
  - **Acceptance Criteria:**
    - [ ] Given Brake is 0.5 s, when the user grabs a turning record and holds still, then the sound slows to a stop over about half a second, with no click.
    - [ ] Given Spin-up is 1.5 s, when the user lets go with Snap Off, then the sound reaches normal speed and pitch after about 1.5 s, and the platter does the same.
    - [ ] Given the defaults, the behaviour is identical to spec 023.
    - [ ] When the user presses Reset, then Brake shows 0.1 s and Spin-up shows 0.4 s.
    - [ ] Values outside the range, or damaged stored values, fall back to the defaults.

### 2.3 Remembered, both decks, all languages

- The settings are remembered on this device. They apply to both decks, the speakers and the headphones.
- New strings go into all 9 languages: Snap and its four options, Brake, Spin-up, Reset, and a hint.
  - **Acceptance Criteria:**
    - [ ] When the user reloads the page, then Snap, Brake and Spin-up are as they were left.
    - [ ] When the user scratches the headphones deck, then the chosen brake and spin-up apply there too.
    - [ ] When the user opens the Scratch section in any of the 9 languages, then the new labels appear in that language.

**Unsaved work, logged out, admin:** these are device settings, which touch no code and no saved track. They work the same whether the user is logged in or out. The admin read-only view is unaffected.

---

## 3. Scope and Boundaries

### In-Scope
- The Snap grid choice (Off / ½ beat / Beat / Bar), migrated from the 023 switch.
- The Brake and Spin-up sliders, the Reset button, persistence, both decks.

### Out-of-Scope
- Per-deck different settings.
- MIDI mapping of the sliders.
- Changing the hand-over, the 8-second reach, or the correction rate limits.
