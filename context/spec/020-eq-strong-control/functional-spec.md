# Functional Specification: Strong EQ Control: Wider Range, Low/High Cut, Genre Presets

- **Roadmap Item:** Not on the roadmap. Requested by the owner in chat on 2026-11-12, right after the fix that put the EQ on the speakers ([008](../008-audio-equalizer/), ada694c). It extends the 10-band EQ. No GitHub issue.
- **Status:** Completed
- **Author:** Claude (for the owner, Dygy)

---

## 1. Overview and Rationale (The "Why")

The EQ now affects the speakers. The owner wants **strong** control, and today's EQ is too gentle for that:
- Each band moves only 12 dB up or down. The genres the owner plays (Brazilian funk, automotivo, montagem, phonk) are built on exaggerated sound: huge sub-bass, cut mids, sharp highs. A 12 dB step is not enough to reach it.
- There is no way to remove everything below or above a frequency. Ten bands can only dip a region, not cut it off. DJs use a low cut to thin a track out and a high cut to muffle it.
- The 22 presets are listening profiles (Pop, Jazz, Classical…). None of them fits the owner's genres.

**Success looks like:**
- A band pushed to its maximum is clearly and instantly audible on the speakers.
- The owner can cut everything below or above a chosen frequency and hear it disappear.
- The owner picks a genre preset (for example Phonk) and the sound changes into a recognisable version of that genre's character, without distortion.
- No change to the EQ produces a click, a pop or a sudden jump in volume.
- Settings saved before this change still load as they were.

**Words used in this document:**
- **Band:** one of the 10 sliders, each shaping one frequency region (31 Hz to 16 kHz).
- **Low cut:** removes everything below a chosen frequency. Musicians also call it a high-pass.
- **High cut:** removes everything above a chosen frequency. Musicians also call it a low-pass.
- **Output level:** the overall loudness after the EQ.
- **Both outputs:** the speakers and the headphone preview. Both always follow the same EQ settings (unchanged from spec 008).

---

## 2. Functional Requirements (The "What")

### 2.1 Wider band range

- Each band can be set anywhere from −24 dB to +24 dB. Today the limit is −12 dB to +12 dB.
  - **Acceptance Criteria:**
    - [ ] When the user drags a band slider to its top, then the slider reads +24 dB and the response curve shows a +24 dB peak at that band.
    - [ ] When the user drags a band slider to its bottom, then the slider reads −24 dB.
    - [ ] When the user opens the EQ, then the curve's scale and the hint text both show the range as −24 dB to +24 dB.
    - [ ] When the user uses the touch EQ on a phone (compact layout), then each band also reaches −24 dB and +24 dB.

### 2.2 Low cut and high cut

- The EQ has a **Low cut** and a **High cut** control, each with an adjustable frequency and an Off position. Both are off by default.
- The low cut runs from 20 Hz to 1 kHz. The high cut runs from 1 kHz to 20 kHz.
- A cut is steep: about 24 dB of loss per octave past the chosen frequency. One octave past it the sound is largely gone, not just quieter.
- The response curve shows both cuts.
  - **Acceptance Criteria:**
    - [ ] Given music is playing, when the user turns the low cut on and sets it to 200 Hz, then the bass and kick disappear from the speakers and the curve drops off below 200 Hz.
    - [ ] Given music is playing, when the user turns the high cut on and sets it to 2 kHz, then the hats and highs disappear and the curve drops off above 2 kHz.
    - [ ] When the user sets a cut to Off, then the curve shows no drop at that end and the sound returns.
    - [ ] When the user sweeps a cut's frequency while music plays, then the sound follows the sweep smoothly, with no clicks or zipper noise.
    - [ ] When the user uses the touch EQ on a phone, then both cuts are also available and adjustable.

### 2.3 No distortion from big boosts

- A large boost must not make the speakers distort.
- The EQ has an **Output level** control, from −24 dB to +6 dB, default 0 dB.
- While the EQ is on, a protection stage stops the output from clipping. When the protection is acting, the user sees a small "limiting" indicator.
  - **Acceptance Criteria:**
    - [ ] Given a loud track is playing, when the user sets several low bands to +24 dB, then the bass gets much louder but the sound does not crackle or break up, and the "limiting" indicator lights up.
    - [ ] When the user lowers the output level, then the overall loudness drops smoothly and the indicator goes out once the signal is under the limit.
    - [ ] Given the EQ is flat with both cuts off and output level 0 dB, when the user switches the EQ on and off while music plays, then they hear no difference.

### 2.4 Genre presets

- New presets set the bands, the cuts and the output level together. Each preset's output level is chosen so it plays at roughly the same loudness as Flat.
- The new presets are:
  - **Brazilian Funk**
  - **Automotivo**
  - **Montagem**
  - **Funk Agressivo**
  - **Mandelão**
  - **Phonk**
  - **Drift Phonk**
  - **Electro**
  - **Techno**
  - **Drum & Bass**
  - **Dubstep**
  - **Trap**
- The existing 22 presets stay as they are and keep their sound. They don't use the cuts: picking one turns both cuts off and sets the output level to 0 dB.
- In the preset list the genre presets are grouped together, separate from the listening profiles.
- Changing any band, cut or the output level after picking a preset shows the preset as **Custom**, as today.
  - **Acceptance Criteria:**
    - [ ] When the user picks Phonk, then the bands, the cuts and the output level change to Phonk's values, the curve updates, and the preset list shows Phonk.
    - [ ] Given music is playing, when the user switches between any two presets, then the sound changes smoothly with no click and no sudden jump in loudness.
    - [ ] Given a genre preset with cuts on, when the user picks Pop, then both cuts turn off and the output level returns to 0 dB.
    - [ ] When the user moves a band after picking a genre preset, then the preset list shows Custom.
    - [ ] When the user opens the preset list in any of the 9 languages, then every genre preset has a name in that language. Genre names that are normally left untranslated, such as "Phonk", may stay as they are.

### 2.5 EQ off is a true bypass

- When the EQ is off, the sound is unchanged: no band boost or cut, no low or high cut, no output level change and no protection stage. The settings are remembered for when it comes back on (unchanged from spec 008).
  - **Acceptance Criteria:**
    - [ ] Given Phonk is selected, when the user switches the EQ off, then the sound returns to the original track over a fraction of a second, with no click.
    - [ ] Given the EQ is off, when the user moves bands, cuts or the output level, or picks a preset, then they hear no change, and switching it on applies the new settings.

### 2.6 Saved settings

- The EQ settings, including bands, cuts, output level, the selected preset and on/off, are kept across reloads on this device, as today.
- Settings saved before this change still load exactly as they were, with both cuts off and output level 0 dB.
- If saved settings are damaged or out of range, the EQ starts flat instead of breaking, as today.
  - **Acceptance Criteria:**
    - [ ] Given the user set a band to +20 dB, the low cut to 80 Hz and the output level to −6 dB, when they reload the page, then those values are restored and heard.
    - [ ] Given settings saved before this change, when the user reloads after this change, then the EQ sounds and looks exactly as before.
    - [ ] Given damaged saved EQ settings, when the user opens the app, then the EQ starts flat and the panel works.

### 2.7 Everyone gets the same EQ

- The EQ is a setting on this device. It works the same when the user is signed out and in the admin read-only view, as today.
  - **Acceptance Criteria:**
    - [ ] When a signed-out user opens the EQ, then the wider range, the cuts and the genre presets are all available.

---

## 3. Scope and Boundaries

### In-Scope

- Band range of −24 dB to +24 dB.
- Low cut and high cut, each with frequency and Off.
- Output level control and the protection stage that stops distortion, with its indicator.
- 12 genre presets that use bands, cuts and output level, named in all 9 languages.
- The response curve, the desktop EQ and the touch EQ all show the new controls.
- Loading settings saved in the old format.

### Out-of-Scope

- Recordings: they stay without the EQ (decided in the 008 fix).
- User-made presets (saving your own named preset).
- Per-track EQ, or EQ written in the pattern code.
- Moving or adding bands, or changing a band's width.
- Different EQ settings for the speakers and the headphone preview.
- Sound written in the dough worklet. It doesn't pass through the EQ (known since the 008 fix).
- Other roadmap items.

---

## Change Log

- (none yet)
