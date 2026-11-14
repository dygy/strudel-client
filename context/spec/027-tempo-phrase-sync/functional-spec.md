# Functional Specification: Tempo and Phrase Sync

- **Roadmap Item:** Phase 6 — Live sets: "Tempo and phrase sync: match the next track's tempo before a transition and start it on a phrase boundary (4/8/16 cycles)". No GitHub issue.
- **Status:** Approved
- **Author:** Claude (for the owner). The owner chose these on 2026-11-14: a 4-way Tempo choice (Jump / Glide during / Match then glide / Keep set tempo), and phrases counted from the playing track's own start, with 16 added.

---

## 1. Overview and Rationale (The "Why")

Spec 017 gave track switches two timing options:
- **Snap to** (off / next cycle / 4 / 8) counts boundaries from the scheduler's cycle 0. Each switch shifts the new track so that its cycle 0 lands where the transition begins. After a couple of switches, "next 8 cycles" no longer matches the playing track's 8-cycle phrases: the switch lands in the middle of a phrase, the way a DJ would never mix.
- **Tempo glide** only chooses how the tempo moves *during* the overlap. With it off, the old track jumps to the new track's tempo at the moment the transition begins, which is audible on the old track. Nothing lets the new track come in at the old track's tempo, the way a DJ beatmatches the incoming record before it is heard. Nothing lets the whole set hold one tempo either.

**Desired outcome:**
- Switches land at the end of the playing track's phrase.
- The incoming track can be tempo-matched to the one already playing, then either slide to its own tempo once it is alone, or stay at the set's tempo.

**Success looks like:**
- With Snap to 8, a switch always begins exactly 8, 16, 24… cycles after the playing track's own cycle 0. That holds however many switches came before it.
- With Match then glide, the old track is never heard changing tempo. The new track comes in at the old tempo, and only after the old one is gone does it move to its own.
- With Keep set tempo, a run of switches stays at the tempo the first track set.

---

## 2. Functional Requirements (The "What")

### 2.1 Phrase boundaries (Snap to)

- **Snap to** offers: Off, next cycle, next 4 cycles, next 8 cycles, **next 16 cycles**.
- The boundaries are counted from **the playing track's own cycle 0**. That is the moment the track started: when Play was pressed, or where the previous transition placed it. They are not counted from the scheduler's cycle 0.
- The description under Snap to says this in plain words: phrases are counted from where the playing track began.
- Cut's "at least the next cycle" also counts the track's own cycles.
- With Snap off, a switch still begins on the next beat (unchanged from 017).
- Everything else stays as in 017:
  - Snap applies to every type except Off.
  - The Update button shows the waiting state until the boundary.
  - Changing Snap during a wait doesn't change the waiting switch.
- **Acceptance Criteria:**
  - [ ] Given the playing track's cycle 0 sits at scheduler cycle 6 (it came in through an earlier transition), and Snap is 8, when the user presses Update for another track at scheduler cycle 9, then the transition begins at scheduler cycle 14, the track's own cycle 8. It does not begin at cycle 16.
  - [ ] Given Snap is 16 and a track has played since Play was pressed, when the user presses Update at the track's cycle 20, then the transition begins at its cycle 32.
  - [ ] Given a track came in through a Dip, whose new track starts after the fade-down, when the next switch uses Snap 4, then the boundaries count from where that track's audio started.
  - [ ] Given Cut, Snap off, and a playing track whose cycle 0 sits at scheduler cycle 2.5, when the user presses Update at scheduler cycle 4.1, then the new track starts at scheduler cycle 5.5.
  - [ ] Given a saved Snap value that isn't offered (e.g. 2 or "abc"), when the settings load, then Snap is Off.
  - [ ] Snap to shows 5 choices including "16 cycles", in the settings panel on desktop and in the compact layout. The description mentions the track's start.

### 2.2 Tempo choice

The **Tempo glide** checkbox becomes a **Tempo** choice with four options. Like the other modifiers, it applies to every type except Off and persists after a reload. "Old tempo" is the playing track's tempo when the transition begins. "New tempo" is the tempo the new track's code sets, or the default tempo if it sets none.

| Option | During the transition | After it |
|---|---|---|
| **Jump** (default) | Both tracks at the new tempo from the moment the transition begins (today's Tempo glide off). | New tempo. |
| **Glide during** | The tempo moves steadily from old to new over the transition (today's Tempo glide on). | New tempo. |
| **Match, then glide** | Both tracks at the **old** tempo; the old track never changes tempo. | Once the old track is gone, the tempo moves steadily from old to new over the selected Length (in cycles). |
| **Keep set tempo** | Both tracks at the old tempo. | The new track stays at the old tempo. The set keeps its tempo across switches. |

- **Dip and Cut.** They have no overlap, so Glide during is greyed out for them, as Tempo glide was. Match, then glide and Keep set tempo do work: the new track starts at the old tempo. With Match, then glide, the slide to the new tempo then runs over the selected Length (Cut has no length of its own).
- **Keep set tempo holds while the track plays unchanged.**
  - When the user updates the same track (a hot swap) and its code still sets the same tempo, the set tempo stays.
  - If the code now sets a different tempo, the user changed it on purpose: that tempo applies at once, and the hold ends.
  - A track with no tempo in its code also keeps the set tempo on hot swaps.
  - Stop ends the hold. Pressing Play starts the track at its own tempo.
- **A slide after the transition (Match, then glide)** is cancelled in these cases, and the tempo is never fought over:
  - When a hot swap of the playing track sets a tempo, that tempo applies at once.
  - When the next switch begins, it starts from the tempo the slide has reached.
  - On Stop.
- **Setting migration:**
  - A saved Tempo glide on becomes Glide during.
  - Off or nothing becomes Jump.
  - An unknown saved value becomes Jump.
- The quick transition picker next to Update is unchanged: it shows type and length only.
- **Acceptance Criteria:**
  - [ ] Given Crossfade, Length 4 and Jump, when switching from a 120 BPM track to a 140 BPM track, then both are heard at 140 BPM from the start of the transition (017 behaviour kept).
  - [ ] Given Crossfade, Length 4 and Glide during, when switching from 120 to 140 BPM, then the tempo rises steadily from 120 to 140 BPM over the 4 cycles (017 behaviour kept).
  - [ ] Given Crossfade, Length 4 and Match, then glide, when switching from 120 to 140 BPM, then the tempo stays at 120 BPM until the transition ends, then rises steadily to 140 BPM over the next 4 cycles, and stays there.
  - [ ] Given Cut and Match, then glide, with Length 8, when switching from 120 to 140 BPM, then the new track starts at 120 BPM and reaches 140 BPM 8 cycles later.
  - [ ] Given Keep set tempo, when switching from a 120 BPM track to a 140 BPM track and then to a 90 BPM track, then everything is heard at 120 BPM.
  - [ ] Given Keep set tempo and a 140 BPM track now playing at 120, when the user updates it with only a note changed (its code still says 140), then the tempo stays 120. When the user changes its tempo to 150 and updates, the tempo becomes 150.
  - [ ] Given a slide after a transition is running, when the user updates the playing track and its code sets a tempo, then that tempo applies at once and the slide stops.
  - [ ] Given a slide after a transition is running, when the next switch begins, then its "old tempo" is the tempo the slide had reached.
  - [ ] Given a slide after a transition or a held set tempo, when the user presses Stop and then Play, then the track plays at its own tempo.
  - [ ] Given Tempo glide was saved on before this change, when the user opens the settings, then Tempo shows Glide during. Saved off shows Jump.
  - [ ] When the user selects Dip or Cut, then Glide during is greyed out, and the other three options can still be chosen.
  - [ ] Every tempo change during a slide happens in small steps (at least 16 per cycle, as 017's glide does), never as one jump.

### 2.3 What the user hears, and other rules

- **No clicks or gaps.** Tempo changes are scheduler tempo changes, as in 017's glide. Cycle continuity is kept, so no notes are dropped or doubled.
- **Unsaved work** is not affected. Settings are stored like the other transition settings.
- **Logged out, admin read-only view, embed:** the transition settings behave exactly as in 017.
- **Set playlist (022):** a Go uses these global Snap and Tempo settings, like any switch.
- **Languages:** new and changed strings go into all 9 locales:
  - the Tempo label;
  - the 4 options;
  - a one-line description of each option;
  - the 16-cycle Snap label;
  - the reworded Snap description.

---

## 3. Scope and Boundaries

### In-Scope

- Snap boundaries counted from the playing track's cycle 0, and a 16-cycle option.
- The 4-way Tempo choice, replacing the Tempo glide checkbox, with the setting migrated.
- The slide after the transition, and the Keep set tempo hold, with their cancellation rules.

### Out-of-Scope

- Detecting a track's tempo from its audio, or tempo changes that aren't `setcps`/`setcpm` (a track's tempo is what its code sets).
- Per-item Snap or Tempo in a set (022 keeps them global).
- A phrase countdown or a progress display while a switch waits; 017's waiting state stays as it is.
- A master tempo control or a tap-tempo button.
- The MCP server's switch tools: they use the same global settings, unchanged.

---

## Change Log

- (none yet)
