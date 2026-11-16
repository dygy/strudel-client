# Functional Specification: MIDI Mapping for Everything

- **Roadmap Item:** Phase 6 — Live sets: "MIDI mapping for everything: EQ, volume, crossfader, Cue/Go and transition, not just the scratch jog." No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner). The owner chose these on 2026-11-15:
  - new **speakers and headphones volume** controls;
  - a **manual crossfader** that drives the switch to the cued track the way a DJ mixer does;
  - one **MIDI panel** listing every target, each with Learn and Clear;
  - mappings kept **in this browser**, with JSON export and import.

---

## 1. Overview and Rationale (The "Why")

Today a MIDI controller can drive only the scratch jog (spec 019) and the two feel knobs (spec 029). Everything a DJ reaches for during a set needs the mouse:
- the EQ bands;
- the Cue/Go button;
- the transition type.

There is no volume control and no crossfader at all. Transitions run on their own once Go is pressed.

**Desired outcome:**
- Every live control can be bound to a knob, fader or pad in one place.
- There are two new volume controls (speakers, headphones).
- There is a crossfader that lets the performer mix the next track in by hand.

**Success looks like:**
- With a controller plugged in, the performer plays a whole set without touching the mouse: Cue, mix in with the crossfader, ride the EQ, adjust volume.
- A binding survives a reload.
- One control is never bound to two targets.
- Moving a fader never jumps the sound: no clicks, and no sudden level change when a physical fader sits away from the on-screen value.

---

## 2. Functional Requirements (The "What")

### 2.1 Targets

| Group | Target | Kind | What it does |
|---|---|---|---|
| EQ | Band 1 … Band 10 | continuous | Sets that band's gain over its full range (−24 … +24 dB, spec 020). Stored even while the EQ is off and heard once it is on, exactly as the on-screen slider. |
| EQ | EQ on/off | button | Toggles the speakers' EQ. |
| EQ | A/B | button | Switches between the A and B slots (spec 026). |
| Mixer | Speakers volume | continuous | The new speakers level (§2.4). |
| Mixer | Headphones volume | continuous | The new headphones level (§2.4). |
| Mixer | Crossfader | continuous | The manual crossfader (§2.5). |
| Set | Cue/Go | button | Same as the set bar's button and Alt+Shift+N. |
| Transport | Play/Stop | button | Same as the header's Play/Stop. |
| Transport | Update | button | Same as the header's Update. |
| Transition | Next type / Previous type | button | Steps the selected transition type through the list (wrapping). |
| View | Performance mode | button | Same as Alt+Shift+P (spec 030). |
| Scratch | Jog, Brake, Spin-up | (existing) | Shown in the panel with their existing Learn (specs 019, 029); behaviour unchanged. |

- **Continuous** targets accept an absolute CC (0–127, mapped linearly over the target's range). The crossfader maps 0 to the left end and 127 to the right.
- **Button** targets accept a note-on (velocity > 0) or a CC press (value ≥ 64 after a value < 64). A held button doesn't repeat. Note-off and the CC release do nothing.
- **Acceptance Criteria:**
  - [ ] Given Band 3 is bound to CC 20, when the controller sends CC 20 = 127, then Band 3 is +24 dB; = 0 gives −24 dB; = 64 gives about 0 dB. The on-screen slider follows.
  - [ ] Given the EQ is off and Band 3 is bound, when the knob moves, then the value is stored and the slider moves, nothing changes audibly, and turning the EQ on brings the new curve in.
  - [ ] Given Cue/Go is bound to a pad (note 36), when the pad is hit once, then the set Cues; when it's hit again, the set Goes. A held pad acts once.
  - [ ] Given Next type is bound, when it's pressed on the last type, then the first type is selected (wrap), and the transition settings show it.
  - [ ] Given Play/Stop, Update and Performance mode are bound, then each does exactly what its on-screen equivalent does.

### 2.2 The MIDI panel

- A **MIDI** section in Settings, after the Mixer settings.
- The status line shows one of:
  - "No MIDI support in this browser";
  - "Allow MIDI to start" (no permission asked yet);
  - "Permission denied";
  - the connected input names.
- The browser is asked for MIDI access only when the user presses Learn, or when stored mappings exist (as the jog does today).
- Every target from §2.1 is listed in its group, showing its binding ("Launch Control · ch 1 · CC 20", or "—"), a **Learn** button and a **Clear** button.
- **Learn:**
  - Pressing Learn arms that row. The next control the user moves is bound to it.
  - A continuous target needs 3 messages from the same CC within 300 ms, as the jog learn does, so a stray message doesn't bind.
  - A button target binds on the first note-on or CC press.
  - Learn gives up after 10 s (the row shows "Timed out") or on Esc. Either way, the previous binding stays.
  - One row learns at a time, across this panel, the jog and the feel knobs.
- **A control can't be bound twice.** If the moved control is already bound to another target (including the jog or a feel knob), Learn refuses. It shows which target holds the control, and the binding is not changed.
- **Clear** removes one binding. **Clear all** removes every binding in this panel (the jog and feel knobs keep theirs) after a confirmation in the panel itself, not a browser dialog.
- **Export** downloads `strudel-midi-map.json`. **Import** reads such a file. An invalid file changes nothing and says why.
- **Acceptance Criteria:**
  - [ ] Given no stored mappings, when the page loads, then the browser is not asked for MIDI access; when the user presses Learn, it is asked.
  - [ ] Given Learn on Band 1 and the user turns CC 21 three times within 300 ms, then Band 1 shows "ch 1 · CC 21" and the knob drives it.
  - [ ] Given Learn on Band 1 and one stray CC message only, then nothing is bound.
  - [ ] Given CC 21 is bound to Band 1, when Learn on Band 2 receives CC 21, then it is refused with "Already used by Band 1", and Band 1 keeps CC 21.
  - [ ] Given the jog is bound to CC 30, when Learn on any panel row receives CC 30, then it is refused, naming the jog. The reverse also holds: the jog's Learn refuses a CC bound in the panel.
  - [ ] Given Learn armed, when 10 s pass or Esc is pressed, then the row shows it timed out or was cancelled, and the old binding remains.
  - [ ] Given bindings, when the page reloads, then they work again with no Learn.
  - [ ] Given Export, then a JSON file with every panel binding downloads; Import of that file on a cleared panel restores them; Import of a malformed file changes nothing and shows an error.
  - [ ] Given a browser without Web MIDI, then the panel says so and every Learn button is disabled.

### 2.3 Soft takeover (no jumps)

- A continuous target (EQ band, volume, crossfader) ignores its control until the control **reaches the current value**. "Reaches" means it crosses the value, or comes within 2 % of the range. After that the control drives the target.
- The row shows "Move to pick up" while a control hasn't picked up yet.
- A change made on screen (mouse) drops the pickup again for that target.
- **Acceptance Criteria:**
  - [ ] Given speakers volume is 80 % and its fader sits at 10 %, when the fader moves to 20 %, then the volume stays 80 %; when the fader passes 80 %, then the volume follows from there.
  - [ ] Given a picked-up EQ knob, when the user drags that band on screen to another value, then the knob must pick up again.

### 2.4 Volumes

- **Speakers volume** (main output) and **Headphones volume** (preview output). Each runs 0–100 %, default 100 %, on a dB-feeling taper. 100 % is unity: today's level, so nothing changes for anyone who never touches them.
- On-screen sliders sit in the Mixer settings: speakers always, headphones when the preview engine is active.
- Remembered in this browser.
- Every change is a short gain ramp (no clicks), never a jump. Volume never fights the transition engine: a Dip still dips, and its restore returns to the volume set here.
- **Acceptance Criteria:**
  - [ ] Given the speakers volume moves from 100 % to 50 %, then the level ramps over ≤ 30 ms with no discontinuity (measured: no sample-to-sample step on a sine). The headphones are unchanged.
  - [ ] Given speakers volume 50 % and a Dip transition, then the dip goes down and comes back to 50 %, not to 100 %.
  - [ ] Given a reload, then both volumes come back.
  - [ ] Given no one touched the volumes, then the output is bit-for-bit the level it is today (unity).

### 2.5 Manual crossfader

A crossfader mixes the **next** track in by hand. The "next" track is, in order:
1. the set's cued item, when a set is cued (spec 022);
2. otherwise the track open in the editor, when it differs from the playing track (the switch Update would make).

With no next track, the crossfader does nothing, and the panel says "Nothing cued".

- **Sides.** The playing track owns one end of the fader: the left at first. Moving the fader toward the other end mixes the next track in.
  - Reaching the far end (the last 2 %) **completes** the switch: the next track becomes the playing track, the old one stops, and the playing side flips to that end. So the next mix goes the other way, as on a DJ mixer.
  - Returning to the playing end (the first 2 %) **abandons** the mix. The old track plays alone again, and the next track stays cued.
- **What is heard.** The mix uses the selected transition type's shape (Crossfade, Filter sweep, Bass swap, Layered intro…), with the fader position as its progress instead of time.
  - Off, Cut and Dip have no in-between, so with them the crossfader uses Crossfade.
  - Echo-out uses its echo on the old track.
- **Tempo and phrase.** The new track starts on the next phrase boundary (Snap, spec 027) when the fader first leaves the playing end. The Tempo choice applies as it would for a timed transition, with "during" meaning "while the fader is between the ends".
- **Go and the timed path still work.** Pressing Go (or Cue/Go) during a manual mix completes it with the timed transition from the current position. Starting a timed Go while the fader sits in the middle is not possible: the mix is already in progress.
- **Soft takeover applies** (§2.3). After a completed switch, the fader is already at the new playing end, so nothing jumps.
- **On screen.** A Crossfader slider sits in the Mixer settings and in the performance view strip. It shows A/B ends and which end is playing, and it can be dragged with the mouse.
- **Acceptance Criteria:**
  - [ ] Given a set with a cued item and the fader at the left (playing) end, when the fader moves to 30 %, then the cued track starts on the next phrase boundary on the speakers, mixed at progress 0.3 of the selected type. The set shows the mix in progress.
  - [ ] Given a mix at 30 %, when the fader returns to the left end, then the new track stops, the old plays alone at full level, and the item is still cued.
  - [ ] Given a mix in progress, when the fader reaches the right end, then the switch completes: the set advances (Now = the new item), the old track stops, and the playing end is now the right.
  - [ ] Given the playing end is the right, then the next mix starts when the fader moves left, and completes at the left end.
  - [ ] Given Cut as the selected type, then the manual mix sounds as a Crossfade.
  - [ ] Given a mix at 50 %, when Go is pressed, then the switch completes with the timed transition from progress 0.5.
  - [ ] Given no set cued and the editor showing the playing track, then moving the crossfader changes nothing.
  - [ ] Given no set and the editor showing a different track, when the fader goes from the left end to the right, then the playing track switches to the editor's track, the same as Update would.
  - [ ] Given a mix in progress, then the old and new tracks' levels follow the fader with no clicks (gain measured over a sweep).

### 2.6 Persistence, privacy, sessions

- Mappings and volumes live in this browser's localStorage. Nothing is sent to the server, and there is no schema change.
- **Logged out:** everything works; mappings don't need an account.
- **Admin read-only view:** the mixer, EQ and transport targets work, as their on-screen controls do. Nothing writes to tracks.
- **Unsaved work:** untouched; no target edits code. Update saves exactly as the button does.

### 2.7 Strings

New strings go into all 9 locales:
- the panel title and status lines;
- the group names, the target names and the binding text;
- Learn, Clear, Clear all (with its confirmation), Export, Import and the import errors;
- "Move to pick up", "Timed out", "Already used by …", "Nothing cued";
- the volume and crossfader labels and the A/B ends.

---

## 3. Scope and Boundaries

### In-Scope

- §2.1 targets, the MIDI panel, Learn/Clear/Clear all/Export/Import, soft takeover, the two volumes, the manual crossfader, its slider in the Mixer settings and the performance strip, and the one-Learn-at-a-time rule generalised to all MIDI learns.

### Out-of-Scope

- MIDI output or LED feedback to the controller.
- Controller presets (pre-made maps for specific hardware).
- Relative/endless encoders for continuous targets (the jog keeps its relative mode).
- Mappings stored in the account, or several named maps.
- Mapping the transition length or Snap, scratch-feel sliders beyond 029, or any code-editing action.
- Keyboard remapping.

---

## Change Log

- 2026-11-15 — Draft from the owner's choices.
- 2026-11-16 — Implementation decisions (accepted at review):
  - **The crossfader:**
    - is inert while the speakers are stopped;
    - starts a mix only after it has been at the playing end, so a fader parked mid-way never brings a track in at half level (new string "Move to the playing end to start a mix");
    - keeps its row left-to-right in RTL locales, to match the hardware fader;
    - in the editor path, uses a forced switch (no instant fallback).
  - **EQ bands from MIDI** snap to the slider's 0.5 dB step.
  - **MIDI status and Learn:** both gain `'failed'` (MIDI unavailable for a reason other than permission), with its own string.
  - **Import** is strict: one bad entry rejects the file.
- 2026-11-16 — Review fixes:
  - **Voices are tagged by side** (an additive superdough fork addition, `_mixSide`). Abandon releases only the new track; complete and hand-over release the old one.
  - **Abandon restores** the EQ recommendation, title and active code, and re-cues the cued item's own code.
  - **Stop during a manual mix** is "cancelled" (still cued, no toast).
  - **Cue/Go and Alt+Shift+N** hand a manual mix over even without a set.
  - **Jog/feel conflicts** with a panel binding name the holder.
  - **Esc** cancels any Learn.
  - **Known limit:** outputs that forward every control (OSC) also receive `_mixSide` during a manual mix.
