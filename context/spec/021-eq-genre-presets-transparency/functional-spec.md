# Functional Specification: EQ Genre Presets for Every Family, and What Each Preset Does

- **Roadmap Item:** Not on the roadmap. Requested by the owner in chat on 2026-11-13, after spec [020](../020-eq-strong-control/) shipped: "add all possible genres, let's be transparent". No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner)

---

## 1. Overview and Rationale (The "Why")

Spec 020 added 12 genre presets, and the owner liked them ("Phonk sounds great"). Now they want a preset for every genre they might play, and they want to **see what a preset does**. Today a preset is only a name: the user can't tell why Drift Phonk sounds the way it does without reading 10 sliders and two cut values.

**Success looks like:**
- The owner finds a preset for any common genre they play, grouped by family, without scrolling through an unsorted list.
- Under the preset picker, the owner reads in plain words what the current sound shaping does, and why that suits the genre.
- No preset is louder or quieter than Flat by more than 3 dB, so trying presets doesn't startle anyone.

---

## 2. Functional Requirements (The "What")

### 2.1 Genre presets in four families

- The preset picker groups the genre presets by family:
  - **Brazilian & Latin:** Brazilian Funk, Automotivo, Montagem, Funk Agressivo, Mandelão (existing); Bruxaria, Mandelão Slowed, Funk Carioca (old school), Baile Funk, Reggaeton, Dembow, Cumbia, Afro House, Amapiano (new).
  - **Phonk, Hip-Hop & Trap:** Phonk, Drift Phonk, Trap (existing); Brazilian Phonk, House Phonk, Memphis, Boom Bap, Lo-fi Hip-Hop, UK Drill, NY Drill, Rage, Plugg, Cloud Rap, Jersey Club (new).
  - **Electronic & Club:** Electro, Techno, Drum & Bass, Dubstep (existing); House, Deep House, Tech House, Minimal, Hard Techno, Trance, Psytrance, Hardstyle, Gabber, UK Garage, Jungle, Breakbeat, Synthwave, Hyperpop, Future Bass, Riddim (new).
  - **Live & Other:** Rock, Metal, Punk, Funk (US), Disco, Soul, Reggae, Dub, Ambient, Chillout, Lo-fi (all new).
- The 22 listening profiles (Flat, Pop, Jazz…) stay as one separate group.
- Existing presets keep their sound, and a saved selection of any of them still loads.
- Every preset uses the wider range, the cuts and the output level from spec 020 where the genre calls for it.
  - **Acceptance Criteria:**
    - [ ] When the user opens the preset picker, then they see five groups in this order: Brazilian & Latin, Phonk, Hip-Hop & Trap, Electronic & Club, Live & Other, and Profiles; each group contains exactly the presets listed above.
    - [ ] When the user picks Amapiano, then the bands, the cuts and the output level change to Amapiano's values and the picker shows Amapiano.
    - [ ] Given the user had Phonk selected before this change, when they reload, then Phonk is still selected and sounds the same as before.
    - [ ] Given music is playing, when the user picks any two presets one after the other, then the change is smooth, with no click, and every genre preset plays within 3 dB of Flat's loudness (the 22 listening profiles keep their spec 008 values, some of which are up to about 3.7 dB louder).

### 2.2 What the preset does

- Under the preset picker there is a short description of the current settings, in plain words:
  - **What it does:** the main boosts and cuts by region (sub, bass, low-mids, mids, presence, air) with their size in dB, the low cut and the high cut if on, and the output level if not 0 dB. Regions changed by less than 2 dB are not mentioned.
  - **Why** (genre presets only): one sentence on the genre's sound that the shaping serves, for example "the 808 sub and cowbell carry the track; the muffled top gives the tape-drift feel".
- When the settings are Custom, only "What it does" is shown, describing the current settings. When everything is flat, it says so ("No change: flat").
- The description updates as soon as the user moves a band, a cut or the output level.
- The phone (compact) layout shows the same description.
  - **Acceptance Criteria:**
    - [ ] When the user picks Drift Phonk, then under the picker they read the sub boost, the scooped low-mids, the presence lift, the low cut at 25 Hz, the high cut at 14 kHz and the output at −8 dB, followed by a one-sentence "why".
    - [ ] When the user moves the 4 kHz band after picking a preset, then the picker shows Custom, the "why" sentence disappears and "What it does" reflects the new value.
    - [ ] When the user resets to Flat, then the description reads "No change: flat".
    - [ ] When the user switches the app language, then the description and the "why" sentence appear in that language.
    - [ ] When the user opens the EQ on a phone, then the description is shown under the preset picker.

### 2.3 Languages, signed-out users and the admin view

- All new preset names, family names, region words and "why" sentences exist in all 9 languages. Genre names that are normally left untranslated may stay as they are.
- Signed-out users and the admin read-only view get everything, as in spec 020.
  - **Acceptance Criteria:**
    - [ ] When the user opens the picker in any of the 9 languages, then every preset and family has a name and every genre preset has a "why" sentence in that language.
    - [ ] When a signed-out user opens the EQ, then all families and descriptions are available.

---

## 3. Scope and Boundaries

### In-Scope

- 47 new genre presets, with the 12 existing ones regrouped into 4 families.
- The plain-words description of the current settings, plus a "why" sentence for genre presets.
- All strings in 9 languages.

### Out-of-Scope

- Any change to how the EQ processes sound (spec 020's chain is unchanged).
- Searching or filtering presets, favourites, and user-made presets.
- Changing the 22 profile presets' values.
- Recordings, which stay without the EQ.

---

## Change Log

- 2026-11-13 — feature testing (021) — AC 2.1.4 narrowed to genre presets: four listening profiles (acoustic +3.24, bassBoost +3.71, piano +3.47, rnb +3.62 dB vs Flat) predate this spec and their values are out of scope (§3).
