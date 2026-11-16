# Functional Specification: Master FX

- **Roadmap Item:** Phase 6 — Live sets: "Master FX: filter, delay/reverb throw, beat-repeat and brake on the master bus." No GitHub issue.
- **Status:** Draft
- **Author:** Claude (for the owner). The owner chose these on 2026-11-16:
  - the FX sit **before the EQ** and are **in every recording**, the analyser and the meter;
  - the **brake goes through the scratch deck**: the same curve and the same Brake / Spin-up sliders as spec 025;
  - throws, beat-repeat and brake work **while held**;
  - a **Master FX panel** in Settings, plus a compact row in the **performance view**.

---

## 1. Overview and Rationale (The "Why")

A DJ mixer has a few effects on the whole output that the performer reaches for between and during tracks: a filter knob, a delay or reverb "throw" that sends a phrase off into echo, a beat-repeat (roll) and a brake. In Strudel today the only way to get any of these is to edit the track's code, which changes the track, needs Update, and doesn't follow the hand.

**Desired outcome:** five master effects, played live by mouse, touch or MIDI, that shape everything on the speakers (every track, during transitions too) without touching any track's code.

**Success looks like:**
- During a set, the performer sweeps the filter, throws the last beat of a phrase into delay, rolls a beat, and brakes the record at the end — all from a controller.
- Nothing is heard when the effects are at rest: the output is the same as today.
- Turning any effect on or off never clicks.
- The recording sounds the way the room heard it.

---

## 2. Functional Requirements (The "What")

### 2.1 Where the effects act

- On the **speakers (main) output** only. Everything playing there goes through them: superdough sounds, `.dough()`, `.supradough()`, and both tracks during a transition or a manual crossfader mix (spec 031).
- **Order:** `track sound → scratch → master FX → main level (Dip, transitions) → EQ → speakers volume → speakers`.
- **Recordings include the FX:** the normal recording and Record as heard (spec 026) alike. So do the EQ analyser (spec 026) and the performance-view meter (spec 030).
- **The headphones (preview, Cue) are not affected.**
- **At rest the effects are silent:** filter centred, nothing held. The output is then the same as today, within float rounding.
- **Acceptance Criteria:**
  - [ ] Given all effects at rest, when a track plays, then the speakers output matches the output without the FX stage (measured: the difference stays below −90 dBFS).
  - [ ] Given a delay throw while recording, then the delay echoes are in the recorded file.
  - [ ] Given a set item cued on the headphones, when the delay throw is held, then the headphones get no echo.
  - [ ] Given a track using `.dough()` and one using `.supradough()`, when the filter is turned, then both are filtered.

### 2.2 Filter (one knob)

- One knob, −100 … +100, **centre (0) is off**. A small dead zone around the centre (±3) is off too.
- **Left** is a low-pass: the cutoff falls from 20 kHz at the centre to 150 Hz at −100, on an exponential curve, so the sweep sounds even.
- **Right** is a high-pass: the cutoff rises from 20 Hz at the centre to 6 kHz at +100.
- **Resonance** slider in the panel: 0–100 %, default 30 %. It is remembered in this browser.
- The knob's position is **not** remembered: every page load starts centred, so a reload never comes up filtered.
- Double-click (or double-tap) the knob to centre it. Changes glide (no zipper noise). Crossing the centre from one side to the other doesn't click.
- **Acceptance Criteria:**
  - [ ] Given the knob at −100, then a 1 kHz tone is attenuated by at least 18 dB and a 100 Hz tone by less than 3 dB.
  - [ ] Given the knob at +100, then a 100 Hz tone is attenuated by at least 18 dB and a 10 kHz tone by less than 3 dB.
  - [ ] Given the knob at 0 or ±2, then the output equals the dry output (§2.1 rest criterion).
  - [ ] Given the knob moved from −50 to +50 in 20 ms, then the output has no sample-to-sample step larger than the input's own.
  - [ ] Given a reload with the knob at −60, then it comes back at 0 and resonance comes back as it was set.

### 2.3 Delay throw and reverb throw

- **While held**, the button sends the whole output into the effect. On release the send closes. What is already in the delay or reverb **rings out** naturally (the tail), while the dry sound continues as before.
- The dry sound is never turned down by a throw.
- **Delay:** the time is a fraction of a cycle, so it follows the tempo: 1/8, 3/16, 1/4 or 3/8 of a cycle (default 3/16). It follows tempo changes (Glide, spec 027) by gliding, not jumping. Feedback 0–90 % (default 55 %). Level 0–100 % (default 70 %).
- **Reverb:** decay 1–8 s (default 3 s), level 0–100 % (default 70 %).
- These settings live in the Master FX panel and are remembered in this browser.
- The send opens and closes over ≤ 10 ms, so it doesn't click.
- **Stop** (Play/Stop) closes both sends and fades the tails out within 0.2 s, so nothing echoes on after Stop.
- **Acceptance Criteria:**
  - [ ] Given cps 0.5 and 3/16, when Delay is held over one hit, then echoes repeat every 0.375 s, each about 55 % of the previous.
  - [ ] Given Delay held then released, then echoes of sound played while held continue and decay; sound played after the release gets no echo.
  - [ ] Given Reverb held for one beat then released, then a reverb tail of about the set decay follows; the dry signal level never drops during the throw.
  - [ ] Given a throw ringing out, when Stop is pressed, then the output is silent within 0.2 s.
  - [ ] Given press and release, then the send gain changes by ramps of ≤ 10 ms (measured on the gain's automation).

### 2.4 Beat-repeat (roll)

- **While held**, the output repeats a short slice, in time with the track. On release the live sound comes straight back **at the point the track has reached**, as if it had been playing underneath all along (the track never stops or shifts).
- **Length:** 1/2, 1/4, 1/8 or 1/16 of a cycle (default 1/4), chosen in the panel and in the performance row. It is remembered.
- **Grid:** the slice starts at the last grid line of that length, counted from the playing track's own start (as Snap, spec 027). So a press slightly after the beat still repeats from the beat. If the press is inside the slice's first pass, the live sound simply continues to the end of the slice, then repeats it.
- Changing the length while held takes effect at the next repeat.
- The loop points crossfade over 3 ms, so the repeats don't click; so do press and release.
- **Acceptance Criteria:**
  - [ ] Given cps 0.5 and length 1/4, when Beat-repeat is held for 2 s, then the output is a 0.5 s slice repeated (each repeat equal to the first within the crossfades), starting on a quarter-cycle line of the track.
  - [ ] Given a release at time t, then the output after t equals what the track plays at t (not what it played at the press).
  - [ ] Given a press 0.1 s after a quarter-cycle line (length 1/4, cps 0.5), then the output continues unchanged until 0.4 s after the press and then repeats from the line.
  - [ ] Given press, repeat boundaries and release, then no sample-to-sample step exceeds the program's own.

### 2.5 Brake

- **While held**, the speakers' record brakes to a stop over the **Brake** time (spec 025 slider, 0.02–1 s) and stays stopped (silent). **On release** the motor spins it back up over the **Spin-up** time, and the track carries on from where the record is, then rejoins live exactly as after a scratch (spec 023, Snap to beat as set there).
- It always acts on the **speakers' deck**, whichever deck the scratch section has selected.
- If the speakers' record is already held by the platter or the MIDI jog, the Brake button does nothing until it is let go.
- The panel's brake row says "Uses the scratch Brake and Spin-up times" and links to those sliders, so the two brakes are understood as one.
- **Acceptance Criteria:**
  - [ ] Given Brake time 0.5 s, when Brake is held, then the output slows to silence in about 0.5 s and stays silent while held.
  - [ ] Given a release, then the sound spins up over the Spin-up time and the track continues (deck event `release`, followed by the hand-over to live).
  - [ ] Given the scratch section's selected deck is the headphones, when Brake is held, then the speakers brake and the headphones don't.
  - [ ] Given the platter is held by the mouse, when Brake is pressed, then nothing changes.

### 2.6 Holding: buttons, touch and MIDI

- The four hold effects (Delay, Reverb, Beat-repeat, Brake) start on press and stop on release: mouse button, touch, a MIDI note (note-on → note-off) or a MIDI CC button (≥ 64 → < 64).
- **No stuck effects:** losing the pointer (pointer cancel, leaving the window, the tab going hidden) releases what that pointer held. A MIDI control that is unbound or disconnected while held releases.
- Several effects can be held at once (for example Delay plus Filter, or Beat-repeat plus Reverb).
- **Acceptance Criteria:**
  - [ ] Given Delay held with the mouse, when the window loses focus, then Delay releases.
  - [ ] Given Beat-repeat bound to note 40, when note-on 40 arrives, then it starts; note-off 40 stops it.
  - [ ] Given Delay and Beat-repeat held together, then both act (the repeated slice goes into the delay).

### 2.7 MIDI (the spec 031 panel)

- New rows in Settings → MIDI, group **Master FX**:
  - **Filter** — continuous; CC 0 = −100, 127 = +100, and 62–66 = centre (off). Soft takeover as for every continuous target (spec 031 §2.3).
  - **Delay throw, Reverb throw, Beat-repeat, Brake** — a new **hold** kind: the press starts it and the release stops it. Learn binds on the first note-on or CC press, as for buttons.
  - **Repeat length** — button: steps 1/2 → 1/4 → 1/8 → 1/16 → 1/2.
- One control can't be bound twice (spec 031). Export and import include these rows.
- **Acceptance Criteria:**
  - [ ] Given Filter bound to CC 50 and picked up, when CC 50 = 0, then the knob is −100; = 64 gives centre; = 127 gives +100. The on-screen knob follows.
  - [ ] Given Brake bound to a pad, when the pad is held then released, then the record brakes and then spins up.
  - [ ] Given an export with Master FX bindings, when imported on a cleared panel, then they work again.

### 2.8 On screen

- **Settings → Master FX**, after Mixer settings:
  - the filter knob and resonance;
  - Delay (time, feedback, level) and Reverb (decay, level), each with its hold button;
  - Beat-repeat with its length choice and hold button;
  - Brake hold button, with the note from §2.5;
  - **All FX off**: centres the filter and releases every hold.
- **Performance view** (spec 030): one compact row with the filter knob, the repeat length, and the four hold buttons. It fits the strip at phone width (wraps, never scrolls sideways).
- A held effect is lit on screen, whichever input holds it (mouse, touch or MIDI). The filter knob shows its side (LP / HP) and is plainly off at the centre.
- Keyboard: every hold button works with Space/Enter held down (keydown starts, keyup stops), and is labelled for screen readers.
- RTL locales mirror the layout but **not** the filter direction: left stays low-pass, as on hardware (the same rule as the 031 crossfader).
- **Acceptance Criteria:**
  - [ ] Given Delay held via MIDI, then the on-screen Delay button shows as held.
  - [ ] Given All FX off while Delay and Beat-repeat are held and the filter at −40, then both release and the filter is centred.
  - [ ] Given the performance view at 375 px wide, then the FX row is fully visible with no horizontal scroll.
  - [ ] Given Hebrew, then the panel mirrors and the filter's left end is still LP.

### 2.9 Strudel-specific behaviour

- **Unsaved work:** untouched. The effects never change a track's code, the editor, or any save path.
- **What is heard:** every on/off, sweep, loop point and stop is a ramp or crossfade (§2.2–2.5); at rest the output is unchanged.
- **Logged out:** everything works; nothing is stored on the server.
- **Admin read-only view:** the effects work on what the admin plays, as any other listener; nothing is saved.
- **Locales:** all new strings in all 9 locales.
- **Storage:** effect settings (resonance, delay time/feedback/level, reverb decay/level, repeat length) in localStorage; no schema change, no new secret.

---

## 3. Scope and Boundaries

### In-Scope
- Filter, delay throw, reverb throw, beat-repeat and brake on the speakers output, before the EQ.
- The Master FX settings panel and the performance-view row.
- MIDI rows in the 031 panel, including the new hold kind.

### Out-of-Scope
- FX on the headphones / preview output.
- FX written into a track's code, or saved per track or per set item.
- Automating the FX in a set (for example "throw on Go").
- More effects (flanger, bitcrush, gater) — later items if wanted.
- The loudness meter and the analyser before/after the EQ (next roadmap item).
