# Functional Specification: Vinyl Scratch Control

- **Roadmap Item:** Not on the roadmap. The owner requested it in chat on 2026-11-12: "in DJ practice you spin the record back and forth, which funnily replays loops forwards and backwards — make that a control". The owner chose the "scratch the sound itself" variant over "jog the pattern's position". No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner, Dygy)

---

## 1. Overview and Rationale (The "Why")

A DJ can grab the record on a turntable and move it by hand. Pushing it forwards replays the last moment faster and higher. Pulling it back plays it backwards with the familiar "wicka" sound. Holding it still stops the sound. When the DJ lets go, the music carries on.

Strudel generates music as it plays, so there is no record to grab. Today the owner can only get backwards sound by writing it into the code, which can't be done by hand in the moment.

This feature adds a **platter**: an on-screen record the user grabs and moves. While it is held, the user hears the last few seconds of what was playing, moved by their hand. When they let go, they hear the live music again, still on the beat, because the music kept playing underneath the whole time.

**Success looks like:**
- The owner can scratch over a playing track with the mouse, a finger, the keyboard or a MIDI controller's jog wheel, and the result sounds like a record being moved by hand.
- Letting go returns to the live track in time. The beat is not shifted.
- Grabbing and letting go never produce a click, a pop or a sudden jump in volume.
- The track's code and the user's saved work are never touched.

**Words used in this document:**
- **Platter:** the on-screen record that the user grabs.
- **Grab / let go:** pressing on the platter (or the key, or touching the jog wheel) and releasing it.
- **Scratch sound:** what is heard while the platter is held: the last few seconds of the deck's sound, played at the speed and direction of the hand.
- **Deck:** where the sound goes. **Speakers** is the main track. **Headphones** is the headphone preview from the mixer.
- **Live sound:** what the deck plays when nobody holds the platter.

---

## 2. Functional Requirements (The "What")

### 2.1 The platter

- The Mixer settings show a **Scratch** section with a round platter that turns slowly while the deck is playing.
- A small switch next to it picks the deck: **Speakers** (default) or **Headphones**. Headphones is available only when the headphone preview is running.
- A **Scratch** button in the header (and in the compact control bar on phones and tablets) opens a floating platter next to it, so the user can scratch while playing without opening settings. The floating platter and the one in settings are the same control: they share the deck choice and the MIDI assignment.
  - **Acceptance Criteria:**
    - [ ] When the user opens Mixer settings while a track plays, then they see the Scratch section with a platter that turns.
    - [ ] When nothing is playing on the selected deck, then the platter is still and dimmed, and grabbing it makes no sound.
    - [ ] When the headphone preview is not running, then the Headphones option is disabled.
    - [ ] When the user presses the Scratch button in the header, then a floating platter opens next to it, and when they click outside it or press Escape, then it closes.
    - [ ] When the user presses the Scratch button in the compact control bar, then the floating platter opens, sized for a finger.

### 2.2 Scratching by hand (mouse and touch)

- Grabbing the platter replaces the live sound with the scratch sound.
- Moving the platter clockwise plays forwards, and counter-clockwise plays backwards. The faster it moves, the faster the sound plays and the higher it sounds.
- Holding the platter still makes the sound stop, like a record held under a finger.
- The user can go back as far as **8 seconds** before the moment they grabbed. Past that, the sound stops, like the edge of the record. They can't go forwards past the moment they grabbed, either: the sound stops there too.
- Letting go brings the live sound back at once, in time with the beat.
- Touch works the same way, including in the compact layout on phones and tablets. While the user touches the platter, the page doesn't scroll.
  - **Acceptance Criteria:**
    - [ ] Given a track is playing on speakers, when the user grabs the platter and holds it still, then the music goes silent within a tenth of a second, without a click.
    - [ ] When the user drags the platter counter-clockwise, then the last moment of the track is heard backwards.
    - [ ] When the user drags the platter clockwise faster than its normal turn, then the sound is faster and higher than normal.
    - [ ] When the user keeps pulling back for more than 8 seconds' worth, then the sound stops and stays silent until they move forwards again or let go.
    - [ ] When the user lets go, then the live track is heard again within a tenth of a second, on the same beat it would have been on had they never grabbed, without a click.
    - [ ] When the user scratches on a phone in the compact layout, then the platter follows the finger and the page doesn't scroll.

### 2.3 Mouse wheel

- Turning the mouse wheel over the platter nudges it, like a quick push or pull. When the wheel stops, the live sound comes back on its own after a short moment.
  - **Acceptance Criteria:**
    - [ ] When the user scrolls the wheel down over the platter, then a short backwards scratch is heard, and about a quarter of a second after the wheel stops, the live sound returns.
    - [ ] When the user scrolls the wheel over the platter, then the page itself doesn't scroll.

### 2.4 Keyboard

- Holding a shortcut scratches without the mouse: one key combination pulls back, the other pushes forwards, at normal speed. Releasing the keys brings the live sound back.
- The keys are **Alt+Shift+←** (pull back) and **Alt+Shift+→** (push forwards). They act on the deck selected in the Scratch section and work whether or not the platter is open. While the user is typing in the code editor, these keys keep their usual editor meaning and don't scratch.
- The shortcut is listed in the Shortcuts tab.
  - **Acceptance Criteria:**
    - [ ] Given a track is playing, when the user holds the pull-back shortcut, then the track is heard backwards for as long as the keys are held, and when they release it, then the live track returns on the beat.
    - [ ] When the user presses Alt+Shift+← while the cursor is in the code editor, then the editor selects as usual and nothing is scratched.
    - [ ] When the user opens the Shortcuts tab, then the scratch shortcut is listed.

### 2.5 MIDI jog wheel

- A user with a MIDI controller can assign its jog wheel to the platter. They press **Learn** in the Scratch section and turn the jog wheel, and from then on the jog wheel moves the platter.
- Touching or turning the jog wheel grabs the platter. When it stops moving for a quarter of a second, it lets go.
- The assignment is remembered in this browser.
- **Forget** removes the assignment.
  - **Acceptance Criteria:**
    - [ ] Given a MIDI controller is connected, when the user presses Learn and turns its jog wheel, then the Scratch section shows the controller's name and the assigned control.
    - [ ] When the user turns the assigned jog wheel backwards, then the track is heard backwards, and when it stops, then the live sound returns within half a second.
    - [ ] When the user reloads the page, then the jog wheel is still assigned.
    - [ ] When the browser has no MIDI support or the user denies MIDI access, then Learn is disabled and a short note explains why, while the platter keeps working.
    - [ ] When the user presses Learn and no control is turned within 10 seconds, then Learn stops and the previous assignment (if any) is kept.

### 2.6 What stays the same

- The track's code, the editor and saved work are never touched by scratching. Autosave sees no change.
- While the platter is held, the music keeps running underneath. Pressing Stop while scratching stops everything and lets go of the platter.
- A track switch or an Update while the platter is held behaves as it does today. The platter is released first.
- Recordings (audio and screen) capture what the user hears on speakers, including the scratch.
- The equalizer still applies to the scratched sound.
- **Logged out and admin read-only view:** the platter works the same wherever the mixer works, since it changes only what is heard and stores nothing with the account.
  - **Acceptance Criteria:**
    - [ ] When the user scratches and lets go, then the editor shows no unsaved changes and nothing is saved.
    - [ ] Given an audio recording is running, when the user scratches, then the scratch is heard in the recording.
    - [ ] When the user presses Stop while holding the platter, then the music stops and the platter is released.
    - [ ] When the user scratches on speakers, then the headphone preview is not affected, and the other way round.

### 2.7 Languages

- Every new label, hint and message is translated into all 9 interface languages.
  - **Acceptance Criteria:**
    - [ ] When the user switches the interface to any of the 9 languages, then the Scratch section shows no untranslated text.

---

## 3. Scope and Boundaries

### In-Scope

- The platter in Mixer settings and as a floating platter opened from the header and the compact control bar.
- Mouse drag, touch, mouse wheel, keyboard shortcut and MIDI jog wheel (learned).
- Both decks: speakers and headphone preview.

### Out-of-Scope

- Moving the music's position itself: jumping a loop forwards or backwards, or nudging the beat ("beat-jump" or pattern jog). This is a possible later feature.
- A spin-back or brake effect when letting go. Releasing always returns to live at once.
- A crossfader "cut" control for scratch combos (transformer, chirp).
- Scratch sound effects that aren't from the track itself, such as vinyl noise or crackle.
- Saving scratch moves into the track's code.
- MIDI controller presets for specific models. Only learning works.
- Other roadmap items, including publishing the local helper for the assistant.

---

## Change Log

_Dated amendments made after the spec was first written — typically by `/awos:spec` in Update Mode when a bug fix changed documented behavior. Each entry records the date, the source reference (bug id or fix description), and what behavior changed and why. Leave empty until the first amendment._

- [YYYY-MM-DD] — [source reference] — [what behavior changed and why]
