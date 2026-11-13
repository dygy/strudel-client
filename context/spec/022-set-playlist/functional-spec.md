# Functional Specification: Set Playlist

- **Roadmap Item:** Phase 6, item 1, "Set playlist": an ordered queue of tracks for a live set, with a transition per item and a "next" key that cues the next track on headphones and then mixes it onto the speakers. The owner picked it from the Phase 6 ideas in chat on 2026-11-13. No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner, Dygy)

---

## 1. Overview and Rationale (The "Why")

During a live set the performer plays one track after another. Today, picking the next track means finding it in the library tree under pressure, clicking it, starting the headphone preview, then pressing Update. The order of the set lives in the performer's head or on paper, and so does each switch's planned transition.

A **set** is a list the performer prepares in advance. Each item is a track, or one step of a multitrack, and it carries the transition used to bring it in. On stage, one key does the work in two presses:
1. **Cue** loads the next item into the editor and plays it on the headphones. The speakers keep playing the current track.
2. **Go** mixes it onto the speakers with that item's transition.

**Success looks like:**
- The owner plays a whole prepared set without opening the library tree, using only the "next" key (or the Cue/Go button).
- Every switch sounds the way it was planned: the item's transition type and length are used.
- Nothing typed is ever lost while cueing, and the speakers never click, drop out or jump in volume.
- A set prepared on one computer is there on another after signing in.

**Words used in this document:**
- **Set:** a named, ordered list of items that belongs to the signed-in user.
- **Item:** one entry in a set. It points at a track from the library, or at one step of a multitrack. The same track can appear more than once.
- **Now playing:** the item whose music is on the speakers.
- **Up next:** the item that the next Cue will load. Normally it is the one after Now playing.
- **Cue:** load Up next into the editor and play it on the headphones.
- **Go:** mix the cued item onto the speakers.
- **Global transition:** the transition chosen in the existing transition settings.

---

## 2. Functional Requirements (The "What")

### 2.1 Managing sets

- A **Set** tab in the settings panel lists the user's sets. From there the user can create a set, rename it, delete it, and open it for editing or playing.
- A new set is named "Set 1", "Set 2" and so on, and can be renamed. Names are 1–100 characters. Two sets may not share a name.
- Deleting a set asks for confirmation first. It deletes only the set, never the tracks in it.
- Sets are kept with the user's account, so they appear on any computer after signing in.
  - **Acceptance Criteria:**
    - [ ] When a signed-in user opens the Set tab and presses "New set", then a set named "Set N" (the first free number) appears and opens, empty.
    - [ ] When the user renames a set to a name another of their sets already has, then the name is refused with the message "A set with this name already exists" and the old name stays.
    - [ ] When the user renames a set to an empty name, then the name is refused and the old name stays.
    - [ ] When the user deletes a set and confirms, then the set disappears from the list and every track that was in it is still in the library, unchanged.
    - [ ] When the user deletes a set and cancels, then nothing changes.
    - [ ] When the user creates a set on one computer and signs in on another, then the set is there with the same items in the same order.

### 2.2 Building a set

- The user adds items to the open set in two ways:
  - an "Add to set" entry in a track's (or a multitrack step's) menu in the library;
  - an "Add track" button in the Set tab, which offers a searchable list of the user's tracks and steps.
- New items go to the end of the set.
- The user reorders items by dragging. Each item also has "move up" and "move down" buttons, for touch screens and the keyboard.
- The user removes an item with its remove button. Removing an item doesn't touch the track.
- Each item shows the track's name, plus the multitrack's name for a step, and its transition.
- Each item has a **transition** choice. **Default** (the initial value) uses the global transition. The other choices are the types offered in the transition settings (Off, Dip, Cut, Crossfade, Filter sweep, Bass swap, Echo-out, Layered intro), each with a **length** of 1, 2, 4, 8 or 16 cycles. Snap, Tempo glide and Match loudness always come from the global settings.
- The first item's transition applies only when the user Goes to it while something else is already playing on the speakers.
- Changes to a set are saved automatically within 2 seconds. If saving fails, the user sees "Couldn't save the set — retrying", the change stays on screen, and saving is retried.
  - **Acceptance Criteria:**
    - [ ] When the user picks "Add to set" on a track in the library while a set is open, then the track appears as the last item of that set.
    - [ ] When the user picks "Add to set" while no set is open, then they are asked which set to add it to, or to create a new one.
    - [ ] When the user adds a multitrack step, then the item shows the multitrack's name and the step's name.
    - [ ] When the user adds the same track twice, then the set has two separate items for it.
    - [ ] When the user drags the third item above the first, then it becomes the first item, and after a reload the new order is kept.
    - [ ] When the user presses "move up" on the first item, then nothing happens (the button is disabled).
    - [ ] When the user sets an item's transition to Crossfade with a length of 8, then the item shows "Crossfade · 8", and after a reload it still does.
    - [ ] When an item's transition is Default, then the item shows "Default" and switches to it use the global transition as it is at the moment of the Go.
    - [ ] When saving a change fails, then "Couldn't save the set — retrying" is shown and the change is still visible.

### 2.3 Playing a set: Cue and Go

- The user starts playing a set with **Play set** in the Set tab. Up next becomes the first item, or the item the user selected. While a set is playing, a **set bar** shows in the header (and in the compact control bar on phones and tablets). It shows Now playing, Up next and one button, labelled **Cue** or **Go** depending on what the next press does.
- The **next key** is **Alt+Shift+N**. It works anywhere in the REPL, including inside the code editor. It does what the set bar's button would do. Holding the key down counts as one press.
- **Cue** (first press):
  - Any unsaved changes to the track in the editor are saved before anything else happens, exactly as when picking a track in the library.
  - Up next's code is loaded into the editor. For a step, the multitrack opens on that step. The page address changes to that track, as when picking it in the library.
  - Up next starts playing on the headphones. If the headphone preview is already playing something, it switches to Up next.
  - The speakers keep playing Now playing, untouched.
  - The button now reads **Go**.
- While cued, the user can edit the code and hear the change on the headphones as usual. The edits are saved to that track like any other edit.
- **Go** (second press):
  - The headphone preview stops.
  - The cued item, including any edits made while it was cued, is mixed onto the speakers with the item's transition (or the global transition if it is Default), the same way a track switch sounds today.
  - The cued item becomes Now playing, and the item after it becomes Up next. The button reads **Cue** again.
  - If nothing is playing on the speakers, Go simply starts the item, with no transition.
- **There is no Go without a Cue.** A user who doesn't want to listen first presses the key twice: Cue, then Go.
- **Choosing another item:** clicking an item in the Set tab while a set is playing makes it Up next. If something was already cued, the cue is cancelled first: the headphones stop, and the editor keeps the cued track (nothing is lost).
- **Cancelling a cue:** stopping the headphone preview (its existing button) while cued cancels the cue. Up next stays the same, and the button reads **Cue** again.
- **Pressing Update while cued** does what Update does today: it stops the preview and pushes the editor's code to the speakers, with the item's transition. It counts as Go.
- **End of the set:** when Now playing is the last item, the set bar shows "End of set" in place of Up next, and the next key does nothing.
- **Stopping:** pressing Stop on the speakers doesn't end the set. Pressing Go then starts the cued item, or Up next, with no transition. **End set** (in the set bar's menu and in the Set tab) hides the set bar. The music keeps playing.
- **After a reload** of the page while a set was playing, the Set tab reopens that set with the same Now playing and Up next. Nothing plays until the user presses play or the next key.
  - **Acceptance Criteria:**
    - [ ] Given a set of three items is playing with item 1 on the speakers, when the user presses Alt+Shift+N, then item 2's code is in the editor, item 2 is heard on the headphones, item 1 keeps playing on the speakers with no change in sound, and the button reads "Go".
    - [ ] Given item 2 is cued, when the user presses Alt+Shift+N, then the headphones stop, item 2 is mixed onto the speakers with item 2's transition, the set bar shows item 2 as Now playing and item 3 as Up next, and the button reads "Cue".
    - [ ] Given item 2's transition is "Cut · 1" and the global transition is Crossfade, when the user Goes to item 2, then the switch is a Cut of 1 cycle.
    - [ ] Given item 2's transition is Default and the global transition is "Dip · 4", when the user Goes to item 2, then the switch is a Dip of 4 cycles.
    - [ ] Given the editor holds unsaved changes to item 1's track, when the user Cues item 2, then item 1's track is saved with those changes before item 2 loads.
    - [ ] Given item 2 is cued and the user changes its code, when the user Goes, then the speakers play the edited code and item 2's track is saved with the edit.
    - [ ] Given the cursor is in the code editor, when the user presses Alt+Shift+N, then the set advances and no character is typed into the code.
    - [ ] When the user holds Alt+Shift+N down, then the set advances by one press only.
    - [ ] Given item 2 is cued, when the user stops the headphone preview, then the button reads "Cue" and Up next is still item 2.
    - [ ] Given item 2 is cued, when the user clicks item 3 in the Set tab, then the headphones stop, item 2's code stays in the editor, and Up next is item 3.
    - [ ] Given item 2 is cued, when the user presses Update, then it behaves exactly as Go.
    - [ ] Given the last item is Now playing, when the user presses Alt+Shift+N, then nothing happens and the set bar shows "End of set".
    - [ ] Given nothing plays on the speakers and Up next is item 1, when the user Cues and then Goes, then item 1 starts on the speakers without a transition.
    - [ ] Given a set is playing with item 2 on the speakers, when the user reloads the page, then the set reopens with item 2 as Now playing and item 3 as Up next, and nothing plays until they press play or the next key.
    - [ ] When the user presses End set, then the set bar disappears and the music on the speakers keeps playing.
    - [ ] When the user plays a set in the compact layout on a phone, then the set bar is in the compact control bar, and its button Cues and Goes.

### 2.4 What the user hears

- Cue never changes what the speakers play. The only change is that the headphones start.
- Go sounds exactly like a track switch with the same transition does today. There are no clicks, gaps or sudden jumps in volume beyond what the chosen transition does itself.
  - **Acceptance Criteria:**
    - [ ] When the user Cues, then the speakers' level is unchanged before, during and after the Cue.
    - [ ] When the user Goes with a Crossfade, then the speakers' level changes smoothly, with no sudden jump.

### 2.5 Items that can't be played

- If a track in a set is renamed or moved to another folder, the item follows it and shows the new name.
- If a track (or a multitrack step) in a set is deleted, its item stays in the set marked **Missing**. Cue skips a missing item and cues the next playable one, showing "Skipped a missing track". If no playable item is left, it shows "End of set".
- If a cued track's code fails to run, the error appears as it does today, the speakers keep playing Now playing, and the button stays **Go**. The user can fix the code and press Go, or cancel the cue.
  - **Acceptance Criteria:**
    - [ ] When the user renames a track that is in a set, then the item shows the new name.
    - [ ] When the user deletes a track that is in a set, then its item shows "Missing".
    - [ ] Given Up next is missing and the item after it is playable, when the user Cues, then the item after it is cued and "Skipped a missing track" is shown.
    - [ ] Given the cued code has an error, when the user Goes, then the error is shown, the speakers keep playing Now playing, and the button still reads "Go".

### 2.6 Who sees sets

- Sets need a signed-in user. When signed out, the Set tab says "Sign in to build a set" and the next key does nothing.
- A user sees and changes only their own sets.
- The admin read-only view of other users' tracks doesn't show sets.
  - **Acceptance Criteria:**
    - [ ] When a signed-out visitor opens the Set tab, then they see "Sign in to build a set" and no set controls.
    - [ ] When a signed-out visitor presses Alt+Shift+N, then nothing happens.
    - [ ] When user A is signed in, then none of user B's sets appear, and none can be opened or changed.

### 2.7 Languages

- Every new label and message appears in all 9 languages of the app, and the set bar and Set tab lay out correctly in right-to-left languages.
  - **Acceptance Criteria:**
    - [ ] When the app is in Hebrew or Arabic, then the Set tab and set bar show translated text and mirror correctly.
    - [ ] When the app is in any of the 9 languages, then no set label shows an untranslated key.

---

## 3. Scope and Boundaries

### In-Scope

- Creating, renaming and deleting sets, kept with the user's account.
- Adding tracks and multitrack steps to a set, reordering and removing items, and a transition type and length per item.
- The set bar, the Cue/Go button, the Alt+Shift+N key, and picking Up next by hand.
- Missing tracks, the end of a set, reload recovery, the compact layout, and all 9 languages.

### Out-of-Scope

- Matching tempo between tracks before a transition, or starting a transition on a phrase boundary (Phase 6 idea 2).
- A full-screen performance view (idea 3).
- Assigning Cue/Go to a MIDI controller (idea 4: MIDI mapping).
- Writing a tracklist with timestamps into a recording (idea 7).
- Track tags, tempo and key fields, and filtering by them (idea 10).
- Building or playing sets through the AI assistant (MCP) (idea 12).
- Sharing a set with other people, or a public link to it.
- Going back to the previous item with a key. The user can click it in the Set tab instead.
- Snap, Tempo glide and Match loudness per item. They stay global.
- Playing a set automatically, without key presses (auto-advance after N cycles).

---

## Change Log

- [YYYY-MM-DD] — [source reference] — [what behavior changed and why]
