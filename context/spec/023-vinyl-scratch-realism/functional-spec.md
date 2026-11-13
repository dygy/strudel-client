# Functional Specification: Vinyl Scratch That Behaves Like a Real Record

- **Roadmap Item:** Not on the roadmap. Owner feedback in chat on 2026-11-13 about spec [019](../019-vinyl-scratch-control/), which shipped 2026-11-12: the platter "doesn't move anything, it's like a fake that plays reverse sound, not like vinyl DJs". The owner named three problems: the sound doesn't follow the hand, there is no inertia, and the track doesn't move after letting go. They chose "like vinyl, with quantize". No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner)

---

## 1. Overview and Rationale (The "Why")

Spec 019 lets the user grab a platter and hear the last 8 seconds moved by hand. In use, it doesn't feel like a record:
- **The first push does nothing.** Most scratches start by pushing the record forwards. Today grabbing pins the sound to the exact grab moment, so a forward push is silent, and only pulling back sounds. That makes it feel like "a reverse sound effect".
- **There is no inertia.** A real record slows under the finger, and when released, the motor brings it back up to speed. You hear the pitch slide down, and then up. Today the sound cuts out in a hundredth of a second and comes back at full speed.
- **The record doesn't move.** On a real deck, if you hold the record for a beat or pull it back, the music continues from where the record is, so it is now later in the track. Today letting go jumps back to where the track would have been had nobody touched it, so scratching changes nothing.

**Success looks like:**
- A DJ who knows turntables does a baby scratch (forward and back on the same sound) and a hold-and-release, and says it behaves like vinyl.
- After letting go, the track carries on from where the record was, still in time with the beat grid, with "Snap to beat" on.
- No click, pop or volume jump at grab, at release, or at the hand-over back to the live track.

---

## 2. Functional Requirements (The "What")

### 2.1 The sound follows the hand both ways

- From the moment the user grabs, they can move the record **forwards and backwards**. Forwards goes as far as "now", the newest sound the deck has played. Backwards goes up to 8 seconds back, as in spec 019.
- Moving faster plays faster and higher; holding still is silent; reversing direction is heard at once, as the familiar back-and-forth "wicka".
- This applies to every way of scratching: mouse, touch, mouse wheel, Alt+Shift+←/→ and a MIDI jog wheel.
  - **Acceptance Criteria:**
    - [ ] Given a track is playing, when the user grabs the platter and immediately pushes it forwards, then they hear the sound they just heard, played forwards at the speed of the push. It is not silence.
    - [ ] When the user moves the platter quickly back and forth over a small arc, then each change of direction is heard as the sound reversing, with no gap longer than the moment the hand is still.
    - [ ] When the user holds the platter still, then the sound is silent.

### 2.2 Inertia: brake and motor

- **Grabbing a turning record** brings it to a stop over about 0.1 seconds. The pitch audibly drops, rather than cutting out.
- **Letting go** starts the motor, which brings the record up to normal speed over about 0.4 seconds. The pitch audibly rises.
- The on-screen platter shows the same slow-down and spin-up.
  - **Acceptance Criteria:**
    - [ ] Given a track is playing, when the user grabs the platter and doesn't move it, then the sound slows down and stops over about a tenth of a second, without a click.
    - [ ] When the user lets go after holding the record still, then the sound starts slow and low and reaches normal speed and pitch within about half a second.
    - [ ] When the user lets go, then the on-screen platter speeds up to its normal turn over the same time.

### 2.3 The track continues from where the record is

- After letting go, the track continues from the record's position. If the user held the record still for 2 beats, the track is now 2 beats later than it would have been. If they pulled back 1 beat, it is 1 beat further behind.
- This change persists: the track keeps playing from the new position until it is stopped, as on a real deck. Stopping and starting the track resets the position as it does today.
- The hand-over from the record back to the live track is seamless. The user hears the music continue, not a jump or a doubled beat.
- Code and saved work are never touched, as in spec 019.
  - **Acceptance Criteria:**
    - [ ] Given a 4-beat loop is playing with a kick on beat 1, when the user holds the record still for exactly 2 beats and lets go, then after the spin-up the kick lands where beat 3 used to be: the track is 2 beats behind.
    - [ ] When the record is let go, then within about a second the music is coming from the live track again, with no audible jump, repeat or gap at the hand-over.
    - [ ] Given the track was shifted by a scratch, when the user presses Update with the same code, then the track keeps its shifted position, so a hot swap doesn't undo the scratch.
    - [ ] Given the track was shifted by a scratch, when the user stops and starts it, then it starts from the beginning, as today.

### 2.4 Snap to beat (quantize)

- A **Snap to beat** switch in the Scratch section is on by default. While it is on, the amount the track moves is rounded to the nearest beat (a quarter of a cycle), so the kick stays on the grid even if the hand was sloppy. The motor's spin-up stretches or shortens slightly, which is inaudible as a jump, to land exactly on the rounded amount.
- While it is off, the track continues exactly from where the record was: pure vinyl, and the beat can end up off the grid.
- The setting is remembered on this device.
  - **Acceptance Criteria:**
    - [ ] Given Snap to beat is on, when the user lets go of a record that has fallen about 1.8 beats behind (hold plus brake and spin-up), then the track ends up exactly 2 beats behind and the kick lands on the grid.
    - [ ] Given Snap to beat is off, when the user lets go of a record that has fallen about 1.8 beats behind, then the track ends up 1.8 beats behind, off the grid.
    - [ ] When the user reloads the page, then the Snap to beat setting is as they left it.

### 2.5 Both decks, all inputs, no lost work

- Everything above works on the speakers deck and on the headphones deck. A scratch on one deck doesn't move the other.
- If a scratch is in progress when the user presses Update, switches track or stops, it is let go first, as in spec 019.
- New strings go into all 9 languages: "Snap to beat" and its hint.
  - **Acceptance Criteria:**
    - [ ] When the user scratches the headphones deck, then only the headphone track moves; the speakers keep playing unchanged.
    - [ ] When the user opens the Scratch section in any of the 9 languages, then "Snap to beat" and its hint appear in that language.

---

## 3. Scope and Boundaries

### In-Scope

- Forward and backward movement from the grab moment, up to the newest sound played.
- Brake on grab and motor spin-up on release, on screen and in sound.
- The track continuing from the record's position after release, persistent until stop.
- Snap to beat, on by default and remembered.
- Both decks and every input.

### Out-of-Scope

- Moving forwards past the newest sound (into the future of the track).
- Pitch or tempo faders, cueing, needle-drop to a point in the track, and a second simultaneous deck on the speakers.
- Recordings: they include the scratch, as in spec 019, and are unchanged in design.
- Changing the 8-second reach.

---

## Change Log

- 2026-11-13 — feature testing (023) — §2.4 criteria reworded: the lag counts the brake (+~0.05 s carried) and the spin-up (+~0.2 s lost), so "held 1.8 beats" is stated as "fallen 1.8 beats behind". §2.2's "within about half a second" applies with Snap off; with Snap on the spin-up stretches 0.2–0.8 s to land on the beat.
