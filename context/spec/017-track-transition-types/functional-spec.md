# Functional Specification: Transition Types for Switching Tracks

- **Roadmap Item:** Not on the roadmap. Requested by the owner in chat on 2026-10-30, in a research session on automatic track mixing. It extends Smooth transitions ([009](../009-smooth-track-transitions/)). No GitHub issue.
- **Status:** In Review
- **Author:** Claude (for the owner, Dygy)

---

## 1. Overview and Rationale (The "Why")

When the owner plays a set, they move from one track to the next. Today there are only two ways that sounds:
- **Off:** the old track stops and the new one starts at once.
- **Smooth transitions on:** the old track fades to silence, then the new track fades up from its beginning.

Both are a gap between tracks, not a mix. A DJ blends two tracks: the next one comes in on the beat while the old one is still playing, bass lines are swapped, filters open, the old track dissolves into an echo. Every track wants a different blend, so the choice has to be at hand during the set, not buried in settings.

This feature replaces the on/off switch with a choice of **transition types**. The user can change the type at any moment while music plays, and each track switch uses the type selected at the moment it starts.

**Success looks like:**
- The owner can play a set where consecutive switches use different transition types, choosing each one without stopping the music.
- An overlapping transition never has a moment of silence, and the two tracks stay in time with each other.
- No transition produces a click, a pop or a sudden jump in volume.
- Editing the track that is playing and pressing Update still changes it in place, exactly as today.

**Words used in this document:**
- **Switch:** something is playing, the user has picked a different track, and they press Update. Only a switch uses a transition. Update on the track that is already playing is never a switch (unchanged from spec 009).
- **Old track / new track:** the track playing before the switch, and the one picked.
- **Cycle:** the musical unit Strudel counts time in. Every track already has a tempo in cycles.
- **Overlapping types:** crossfade, filter sweep, bass swap and layered intro, where both tracks are heard at the same time.

---

## 2. Functional Requirements (The "What")

### 2.1 Choosing a transition type

- In Mixer Settings, the "Smooth transitions" on/off switch is replaced by a group of radio buttons named **Transition**, with these options:

  | Option | What the user hears |
  |---|---|
  | **Off** | The old track stops and the new track starts from its beginning at once (today's behaviour with smooth transitions off). |
  | **Dip** | The old track fades to silence, then the new track fades up from its beginning (today's smooth transition). |
  | **Cut** | No fade: the old track plays to the next cycle boundary and the new track starts exactly on it, on the beat. |
  | **Crossfade** | The new track comes in under the old one: the old track gets quieter while the new one gets louder, and both are heard together for the whole transition. |
  | **Filter sweep** | Like crossfade, but the old track gets thinner (its low end is filtered away) while the new track opens up from muffled to full. |
  | **Bass swap** | Both tracks play together. For the first half the new track plays without its low end. At the midpoint the bass swaps: the old track loses its low end and the new track gets its own. The old track then fades out. |
  | **Echo-out** | The old track stops playing new notes and dissolves into an echo that dies away over the transition. The new track starts at full volume when the echo begins. |
  | **Layered intro** | The new track's parts (layers) come in one at a time, evenly spread over the transition, while the old track fades out. |

  - Each option has a one-line description under the group, in the user's language.
  - **Acceptance Criteria:**
    - [ ] When the user opens Mixer Settings, then they see a "Transition" group with the eight options above, exactly one of them selected, and no separate smooth-transitions on/off switch.
    - [ ] When the user selects an option, then the description below the group changes to that option's description.
    - [ ] When the user selects an option and reloads the page, then the same option is still selected.
    - [ ] Given the user had "Smooth transitions" turned on before this feature, when they open Mixer Settings for the first time after it ships, then "Dip" is selected.
    - [ ] Given the user had "Smooth transitions" turned off, or never changed it, when they open Mixer Settings, then "Off" is selected.

### 2.2 Transition length

- One **Length** control sets how long a transition lasts, in cycles: 1, 2, 4, 8 or 16. It replaces today's slider in seconds. The default is 4 cycles.
- For Dip, the fade down and the fade up each last the chosen length.
- For the overlapping types and Echo-out, the whole transition lasts the chosen length.
- Cut has no length; the control is greyed out while Cut or Off is selected.
- A user who had a length in seconds keeps the closest available length in cycles at the default tempo (one cycle = 2 seconds).
- **Acceptance Criteria:**
  - [ ] When the user opens Mixer Settings, then they see a Length control offering 1, 2, 4, 8 and 16 cycles, with 4 selected by default.
  - [ ] Given Crossfade and a length of 4 cycles are selected, when the user switches tracks, then the old track is no longer heard exactly 4 cycles after the transition began.
  - [ ] Given Dip and a length of 2 cycles are selected, when the user switches tracks, then the old track reaches silence after 2 cycles and the new track reaches full volume 2 cycles after that.
  - [ ] When the user selects Off or Cut, then the Length control is shown greyed out and cannot be changed.
  - [ ] Given the user had a smooth-transition length of 4 seconds saved before this feature, when they open Mixer Settings, then Length shows 2 cycles.

### 2.3 Modifiers

Three extra options sit under the Transition group. Each one is off by default, persists after a reload, and applies to every type except Off.

- **Snap to:** off, next cycle, next 4 cycles, next 8 cycles. When set, a switch waits until the next boundary of that size before it begins. Until then the old track keeps playing unchanged, and the Update button shows that a switch is waiting. Cut always waits for at least the next cycle boundary, even with Snap off.
- **Tempo glide:** during an overlapping transition, both tracks always play at one shared tempo, in time with each other. With Tempo glide off, that tempo is the new track's from the moment the transition begins. With Tempo glide on, it moves gradually from the old track's tempo to the new track's over the length of the transition. For Dip and Cut, Tempo glide has no audible effect and is greyed out.
- **Match loudness:** the new track is brought to about the same loudness the old track had, so a switch never jumps to much louder or much quieter music.

- **Acceptance Criteria:**
  - [ ] Given Snap is set to "next 4 cycles", when the user presses Update for a different track in the middle of cycle 9, then the old track plays unchanged until cycle 12 begins and the transition starts at that boundary.
  - [ ] Given Snap is set and a switch is waiting, when the user looks at the Update button, then it shows a waiting state until the transition begins.
  - [ ] Given Cut is selected and Snap is off, when the user presses Update for a different track, then the new track starts on the next cycle boundary.
  - [ ] Given Crossfade, a 4-cycle length and Tempo glide on, when the old track runs at 120 BPM and the new one at 140 BPM, then the shared tempo rises steadily from 120 to 140 BPM over the 4 cycles and the new track continues at 140 BPM.
  - [ ] Given Crossfade with Tempo glide off, when the user switches from a 120 BPM track to a 140 BPM track, then both tracks are heard at 140 BPM, on the same beat, from the start of the transition.
  - [ ] Given Match loudness is on, when the user switches from a quiet track to a track that is much louder at the same volume setting, then the new track's level, from 2 cycles after the transition ends, is within 3 dB of the old track's level before it, and the level change happens gradually.
  - [ ] When the user selects Dip or Cut, then Tempo glide is shown greyed out.

### 2.4 Changing the type during a set

- The current transition type and length can also be changed from a small **transition picker** next to the Update button, without opening Mixer Settings. The picker and Mixer Settings always show the same choice.
- A switch uses the type, length and modifiers that are selected at the moment it **begins**. Changing them while a transition runs does not change that transition; it applies to the next switch.
- **Acceptance Criteria:**
  - [ ] When a track is playing, then the transition picker is visible next to the Update button and shows the selected type.
  - [ ] When the user selects Echo-out in the transition picker, then Mixer Settings also shows Echo-out selected.
  - [ ] Given Crossfade is selected, when the user switches tracks, changes the picker to Bass swap during the transition, and switches to a third track after it ends, then the first switch is a crossfade to its end and the second switch is a bass swap.
  - [ ] Given a set is playing, when the user changes the transition type, then the music keeps playing without a gap or change in volume.

### 2.5 What the user hears

- No transition type produces a click, a pop or a sudden jump in volume. Every volume change is gradual, except for Cut and Off, which are a deliberate instant change.
- During an overlapping transition there is no moment of silence, and the two tracks stay on the same beat.
- When a transition ends, nothing of the old track is still heard, including long held notes. The only exception is Echo-out, whose echo has died away by the end of the transition.
- The new track starts from its own beginning, as with today's switches.
- The volume the user has set is the same before and after a transition.
- **Acceptance Criteria:**
  - [ ] When the user switches tracks with any type, then the sound is free of clicks and pops at the start, during and at the end of the transition.
  - [ ] Given Crossfade, Filter sweep, Bass swap or Layered intro, when the user switches tracks, then sound is heard continuously from the start to the end of the transition.
  - [ ] Given the old track holds a long note or pad, when a Crossfade transition ends, then that note is no longer heard.
  - [ ] Given Echo-out, when the transition ends, then the old track's echo is no longer heard.
  - [ ] When any transition ends, then the new track plays from its own first cycle, at the volume the user had set before the switch.
  - [ ] Given Layered intro and a new track with four layers, when the user switches with a length of 8 cycles, then one more layer becomes audible about every 2 cycles until all four are playing.
  - [ ] Given Layered intro and a new track with a single layer, when the user switches tracks, then it sounds the same as a crossfade.

### 2.6 What stays the same, and the error cases

- **Updating the playing track** is never a transition: the edit takes effect in place, with no fade and no restart, whatever type is selected.
- **Nothing playing:** pressing Update or Play starts the track straight away, with no transition.
- **Another switch while a transition runs:** the running transition finishes; then the app moves on to the most recently picked track, using the type selected at that moment. Pressing Update again for the track already being switched to does nothing.
- **The new track has an error:** the old track keeps playing at its normal volume, as if no switch had been requested, and the usual error message for the code is shown.
- **Visuals and code highlighting:** during an overlapping transition, the editor highlights only the new track's code. Pictures drawn by the old track disappear by the end of the transition.
- **Headphone preview** is not affected: previewing on headphones never uses a transition, and a transition on the speakers never changes what the headphones play.
- **Unsaved work** is not affected: choosing a type or performing a transition never changes or saves a track's code.
- **Logged out and admin read-only view:** the settings and the picker work the same wherever Update switches tracks, since they are stored in the browser and not with the account.
- **Languages:** all new labels and descriptions appear in all 9 languages the app supports.
- **Acceptance Criteria:**
  - [ ] Given Crossfade is selected, when the user edits the playing track and presses Update, then the change is heard in place with no fade and the track does not restart.
  - [ ] Given nothing is playing, when the user picks a track and presses Update, then it starts immediately with no fade.
  - [ ] Given a transition to track B is running, when the user picks track C and presses Update, then the transition to B finishes, and a transition from B to C begins right after.
  - [ ] Given a transition to track B is running, when the user presses Update again for track B, then nothing changes and the transition continues.
  - [ ] Given any type except Off, when the user switches to a track whose code has an error, then the old track keeps playing at the same volume and the error is shown.
  - [ ] Given Crossfade, when the transition is running, then only the new track's code is highlighted in the editor.
  - [ ] Given headphone preview is playing, when the user switches tracks on the speakers with Crossfade, then the headphones keep playing the preview unchanged.
  - [ ] Given the user has unsaved changes in the editor, when they change the transition type, then the editor content and its unsaved state are unchanged.
  - [ ] When the user views Mixer Settings in each of the 9 languages, then every transition label and description is translated.
  - [ ] When the user views Mixer Settings in a right-to-left language, then the Transition group and the picker are laid out right to left.

---

## 3. Scope and Boundaries

### In-Scope

- The eight transition types, the Length control in cycles and the three modifiers (Snap to, Tempo glide, Match loudness).
- Choosing them in Mixer Settings and in a picker next to the Update button, while music plays.
- Carrying over the existing smooth-transitions choice and length.
- Translations in all 9 languages.

### Out-of-Scope

- **Auto-DJ / radio mode:** playing a folder or the whole library one track after another automatically. Separate feature.
- **Key-aware choice of the next track:** picking a next track whose musical key fits. Separate feature.
- **Shuffle:** the shuffle button still switches without any transition. Routing it through transitions is a separate bug fix.
- **Transitions on the headphone preview**, or between headphones and speakers.
- **A type per track:** saving a preferred transition with each track. The choice is global and changed by hand.
- **Custom transitions:** users designing their own transition types.
- **Storing the settings with the account:** they stay per browser, as today.
- The compact (phone) layout itself, which spec [016](../016-responsive-repl-layout/) covers. On compact screens the picker goes wherever that layout puts the Update button.

---

## Change Log

_Leave empty until the first amendment._
